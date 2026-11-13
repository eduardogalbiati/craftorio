// Phone gates (#226): a small web page, served by the running app on its own port, that shows only
// the open human gates and lets the OWNER answer them from a paired phone. Never an agent: every
// answer needs a paired device's token (Authorization: Bearer), the gate's own short-lived signed
// link (`t`) and an explicit confirmation (`confirm: true`) sent by the page after the owner pressed
// "Confirm" on a screen that shows the chosen button's meaning. Nothing else of the app (runs
// control, files, terminals, settings, the /api channels) is reachable on this port.
//
//   GET  /                         the gates page (pairs the phone from `?pair=<code>`, then lists the gates)
//   POST /pair                     { code, name } → { token, device: { id, name } }; wrong or used code → 403;
//                                  10 wrong codes from one address in 15 min → 429 (SEC-20)
//   GET  /gates.json               Bearer device → { gates: [{ runId, approvalId, stepId, message, url, … }] }
//   GET  /gates/<run>/<id>?t=      the gate (its summary, recommendation, evidence, buttons); bad t → 403
//   GET  /gates/<run>/<id>?t=&answer=<choice>   the confirmation page; a GET never answers
//   POST /gates/<run>/<id>/answer  Bearer device, { t, answer, confirm: true, feedback? } → { ok: true }
//                                  401 device, 403 link, 400 confirmation or answer, 409 gate not open
//
// Gate links are `<url>/gates/<run>/<id>?t=<payload>.<hmac>`, payload { r, a, exp }, signed with the
// workspace's key (`<workspace>/phone-gates/secret`, HMAC-SHA256), valid `linkTtlMs` (30 min). A gate
// link alone shows the gate's text (summary, recommendation, evidence) to whoever holds it; answering
// still needs a paired device (SEC-20). Paired devices are kept in the workspace
// (`<workspace>/phone-gates/devices.json`: id, name, the SHA-256 of their token, pairedAt, lastSeen);
// a revoked device is removed and its token stops working at once. The answer goes through the
// service's answerPhoneGate (packages/engine/service/areas/phone-gates.js, never a channel): the gate's
// `approval.resolved` event records `answered_by: 'owner', via: 'mobile', device` (docs/agents/storage.md).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  gatePage,
  gatesPage,
  noticePage,
  securityHeaders,
  translator,
} = require('./mobile-gates-page');

const LINK_TTL_MS = 30 * 60e3;
const CODE_TTL_MS = 10 * 60e3;
const MAX_BODY = 64 * 1024;
// wrong pairing codes one address may send in the window before /pair answers 429 (SEC-20)
const PAIR_MAX_FAILURES = 10;
const PAIR_WINDOW_MS = 15 * 60e3;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: read off a screen

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request body too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new HttpError(400, 'The body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders() });
  res.end(JSON.stringify(body));
};

// A run's issues may be objects, bare numbers or junk: keep the valid numbers, never fail the list (#819).
const phoneIssues = (issues) => (Array.isArray(issues) ? issues : [])
  .map((i) => Number(i?.number ?? i)).filter(Boolean).map((number) => ({ number }));

// ---- the server -----------------------------------------------------------------------------------
// ---- paired devices (<workspace>/phone-gates/devices.json; the token itself is never stored) -------
const devicesFile = (ws) => path.join(ws.root, 'phone-gates', 'devices.json');
function readDevices(ws) {
  try { const j = JSON.parse(fs.readFileSync(devicesFile(ws), 'utf8')); return Array.isArray(j.devices) ? j.devices : []; } catch { return []; }
}
function writeDevices(ws, list) {
  fs.mkdirSync(path.dirname(devicesFile(ws)), { recursive: true });
  fs.writeFileSync(devicesFile(ws), JSON.stringify({ devices: list }, null, 2));
}
/** The paired devices, without their token hash: [{ id, name, pairedAt, lastSeen }] */
const listDevices = (ws) => readDevices(ws).map(({ id, name, pairedAt, lastSeen }) => ({ id, name, pairedAt, lastSeen }));
/** Unpairs a device: its token stops working at once. → false when it was not paired */
function revokeDevice(ws, deviceId) {
  const list = readDevices(ws);
  if (!list.some((d) => d.id === deviceId)) return false;
  writeDevices(ws, list.filter((d) => d.id !== deviceId));
  return true;
}
/** The key gate links are signed with (<workspace>/phone-gates/secret): created once, so links sent in
 *  notifications keep working across restarts and Settings saves until they expire */
function linkSecret(ws) {
  const file = path.join(ws.root, 'phone-gates', 'secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch { /* created below */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

// service: { api: { 'runs:active' }, workspace(), answerPhoneGate(runId, approvalId, answer, feedback, deviceId) }
// language(): the workspace interface language, read per request; API errors stay English.
// publicUrl(): the private address from outside (Tailscale, Cloudflare Tunnel) the gate links use, or ''
function createMobileGatesServer({ service, secret, now = Date.now, linkTtlMs = LINK_TTL_MS, publicUrl = () => '', language = () => 'en' } = {}) {
  const key = secret || crypto.randomBytes(32).toString('hex');
  const codes = new Map(); // code → expiry (ms)
  const pairFailures = new Map(); // client address → { count, since (ms) } (SEC-20)
  // too many wrong codes from this address in the window: refused before the code is looked at
  function pairThrottled(ip) {
    const f = pairFailures.get(ip);
    if (f && now() - f.since > PAIR_WINDOW_MS) pairFailures.delete(ip);
    return (pairFailures.get(ip)?.count || 0) >= PAIR_MAX_FAILURES;
  }
  function pairFailed(ip) {
    if (pairFailures.size >= 1000 && !pairFailures.has(ip)) pairFailures.clear(); // never an unbounded map
    const f = pairFailures.get(ip) || { count: 0, since: now() };
    pairFailures.set(ip, { ...f, count: f.count + 1 });
  }
  let server = null;
  let base = null;
  const ws = () => service.workspace();
  function deviceOf(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!m) return null;
    const h = sha(m[1]);
    return readDevices(ws()).find((d) => same(d.tokenHash, h)) || null;
  }

  const sign = (payload) => b64u(crypto.createHmac('sha256', key).update(payload).digest());
  function gateToken(runId, approvalId) {
    const payload = b64u(JSON.stringify({ r: runId, a: approvalId, exp: now() + linkTtlMs }));
    return `${payload}.${sign(payload)}`;
  }
  // true when `t` is a valid, unexpired link of this gate
  function linkOk(t, runId, approvalId) {
    const [payload, mac, extra] = String(t || '').split('.');
    if (!payload || !mac || extra !== undefined || !same(mac, sign(payload))) return false;
    try {
      const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return p.r === runId && p.a === approvalId && Number(p.exp) > now();
    } catch { return false; }
  }

  function openGates() {
    const out = [];
    for (const run of service.api['runs:active']()) {
      for (const g of run.gates || []) out.push({ run, gate: g });
    }
    return out;
  }
  const findGate = (runId, approvalId) => openGates().find((x) => x.run.runId === runId && x.gate.approval_id === approvalId) || null;
  // an Approve / Reject gate answers true / false (like the desktop), with its #213 labels and help
  const choicesOf = (g) => (Array.isArray(g.choices) && g.choices.length ? g.choices : [
    { id: 'approve', label: g.approve?.label || translator(language()).t('approve'), help: g.approve?.help || '', value: true },
    { id: 'reject', label: g.reject?.label || translator(language()).t('reject'), help: g.reject?.help || '', value: false },
  ]);
  const runTitle = (run) => run.title || run.workflow || run.runId;
  const gateLink = (runId, approvalId) => `${publicUrl() || base}/gates/${encodeURIComponent(runId)}/${encodeURIComponent(approvalId)}?t=${encodeURIComponent(gateToken(runId, approvalId))}`;

  // POST /pair: a one-time code from the desktop → a device token
  async function pair(req, res) {
    const ip = req.socket.remoteAddress || '';
    if (pairThrottled(ip)) throw new HttpError(429, 'Too many wrong pairing codes from this address: wait a few minutes.');
    const body = await readJson(req);
    const code = String(body.code || '').trim().toUpperCase();
    const exp = codes.get(code);
    if (!code || !exp || exp < now()) {
      pairFailed(ip);
      throw new HttpError(403, 'Wrong or used pairing code.');
    }
    codes.delete(code);
    const token = crypto.randomBytes(32).toString('base64url');
    const device = { id: `dev-${crypto.randomBytes(6).toString('hex')}`, name: String(body.name || 'Phone').slice(0, 80) };
    writeDevices(ws(), [...readDevices(ws()), { ...device, tokenHash: sha(token), pairedAt: new Date(now()).toISOString(), lastSeen: null }]);
    sendJson(res, 200, { token, device });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://phone.local');
    const parts = url.pathname.split('/').slice(1);
    if (req.method === 'GET' && url.pathname === '/') {
      const p = gatesPage(language());
      res.writeHead(200, p.headers);
      res.end(p.html);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/pair') {
      await pair(req, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/gates.json') {
      if (!deviceOf(req)) throw new HttpError(401, 'This phone is not paired.');
      const gates = openGates().map(({ run, gate }) => ({
        runId: run.runId, approvalId: gate.approval_id, stepId: gate.step_id, message: gate.message, title: runTitle(run),
        projectId: run.projectId || null, issues: phoneIssues(run.issues),
        requestedAt: gate.requested_at || null, serverNow: now(),
        headline: gate.brief?.headline || null, url: gateLink(run.runId, gate.approval_id),
      }));
      sendJson(res, 200, { gates });
      return;
    }
    if (parts[0] === 'gates' && (parts.length === 3 || (parts.length === 4 && parts[3] === 'answer'))) {
      let runId; let approvalId;
      try { runId = decodeURIComponent(parts[1]); approvalId = decodeURIComponent(parts[2]); } catch { throw new HttpError(404, 'Not found.'); }
      if (parts.length === 3 && req.method === 'GET') {
        const t = url.searchParams.get('t');
        if (!linkOk(t, runId, approvalId)) {
          const p = noticePage('link_invalid', language(), 403);
          res.writeHead(p.status, p.headers);
          res.end(p.html);
          return;
        }
        const found = findGate(runId, approvalId);
        if (!found) {
          const p = noticePage('ended', language(), 200, { ended: true, draftKey: `phone-note:${runId}/${approvalId}` });
          res.writeHead(200, p.headers);
          res.end(p.html);
          return;
        }
        const want = url.searchParams.get('answer');
        const chosen = want ? choicesOf(found.gate).find((c) => c.id === want) : null;
        if (want && !chosen) throw new HttpError(400, 'Unknown answer.');
        const p = gatePage(found, t, chosen, language(), choicesOf(found.gate), { expiresAt: JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString('utf8')).exp, serverNow: now() });
        res.writeHead(200, p.headers);
        res.end(p.html);
        return;
      }
      if (parts.length === 4 && req.method === 'POST') {
        const device = deviceOf(req);
        if (!device) throw new HttpError(401, 'This phone is not paired.');
        const body = await readJson(req);
        if (!linkOk(body.t, runId, approvalId)) throw new HttpError(403, 'This link is expired or not for this gate.');
        if (body.confirm !== true) throw new HttpError(400, 'Confirm the answer first.');
        const found = findGate(runId, approvalId);
        if (!found) throw new HttpError(409, 'This gate is no longer waiting.');
        const choice = choicesOf(found.gate).find((c) => c.id === body.answer);
        if (!choice) throw new HttpError(400, 'Unknown answer.');
        const feedback = typeof body.feedback === 'string' && body.feedback.trim() ? body.feedback.slice(0, 2000) : undefined;
        if (choice.feedback_required && !feedback) throw new HttpError(400, 'This answer needs a note.');
        const ok = resolveGate(runId, approvalId, 'value' in choice ? choice.value : choice.id, feedback, device);
        if (!ok) throw new HttpError(409, 'This gate is no longer waiting.');
        writeDevices(ws(), readDevices(ws()).map((d) => (d.id === device.id ? { ...d, lastSeen: new Date(now()).toISOString() } : d)));
        sendJson(res, 200, { ok: true });
        return;
      }
    }
    throw new HttpError(404, 'Not found.');
  }

  const resolveGate = (runId, approvalId, answer, feedback, device) => service.answerPhoneGate(runId, approvalId, answer, feedback, device.id);

  return {
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          handle(req, res).catch((e) => {
            if (res.headersSent) { res.end(); return; }
            sendJson(res, e instanceof HttpError ? e.status : 500, { error: e instanceof HttpError ? e.message : 'Internal error.' });
          });
        });
        server.once('error', reject);
        server.listen(port, host, () => {
          const a = server.address();
          base = `http://${host.includes(':') ? `[${host}]` : host}:${a.port}`;
          resolve({ port: a.port, url: base });
        });
      });
    },
    close() {
      if (!server) return Promise.resolve();
      const s = server;
      server = null;
      return new Promise((resolve) => { s.closeAllConnections?.(); s.close(() => resolve()); });
    },
    url: () => base,
    // a one-time pairing code (Settings shows it as text and as a QR code of pairUrl)
    pair() {
      let code = '';
      for (const b of crypto.randomBytes(8)) code += CODE_CHARS[b % CODE_CHARS.length];
      for (const [c, exp] of codes) if (exp < now()) codes.delete(c);
      codes.set(code, now() + CODE_TTL_MS);
      return { code, url: base ? `${base}/?pair=${code}` : null, expiresAt: new Date(now() + CODE_TTL_MS).toISOString() };
    },
    devices: () => listDevices(ws()),
    revoke: (deviceId) => revokeDevice(ws(), deviceId),
    gateLink,
  };
}

module.exports = {
  createMobileGatesServer,
  LINK_TTL_MS,
  linkSecret,
  listDevices,
  revokeDevice,
};
