// The control channel (#336): outside sessions (a terminal, another agent) drive the running app through
// its own channels instead of editing workspace files. Off by default (setting controlChannel,
// Settings › Execution). When on, the app listens on 127.0.0.1 only, on a free port, and writes
// <workspace>/control/endpoint.json { url, token } (a new random token on every start); off, or the
// app quitting, closes the port and deletes the file.
//   POST /api/<channel>   Authorization: Bearer <token>, body { "arg": ... }  ->  as src/server/index.js
// Only the channels of src/control/allowlist.js are answered (others: 403 naming the channel); no
// argument may cross a human gate (confirmGate), and GUARDS refuse what would remove one (#399:
// workflows:restore of a copy with a gate its default lacks). Every call is appended to control/calls.jsonl.
// The calls go to the running app's own service: actions dispatch as from the screen, and no second
// engine opens the workspace (#112). Two reads for the client (#342), with the token, not logged:
//   GET /api/version    ->  { version }: CONTROL_VERSION, the client refuses another one (exit 3)
//   GET /api/channels   ->  { channels: [{ channel, params, schema }] }: the allowlist, argument schemas
// The client: the multiagent-ctl binary (native/multiagent-ctl, its path in the status as ctlPath);
// scripts/ctl.js for development.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const workspace = require('../workspace');
const { nativeBinaryPath } = require('../domains/machine/native-bin');
const { addedGates, BUNDLED_WORKFLOWS_DIR } = require('../workflows');
const { CHANNELS, GATE_ARGS } = require('./allowlist');
const {
  bearer,
  callChannel,
  HttpError,
  isLoopbackHost,
  readJson,
  sameOrigin,
  sendJson,
  tokenCheck,
} = require('../server');

const SUMMARY_CHARS = 200;

// Refusals only outside sessions get, per channel (#399): the reason, or null to go on.
// workflows:restore never removes a human gate the owner added to a workspace copy.
const GUARDS = {
  'workflows:restore': (service, file) => {
    const ws = service.workspace();
    const gates = ws ? addedGates(BUNDLED_WORKFLOWS_DIR, ws.workflows, file) : [];
    if (!gates.length) return null;
    return `the copy of ${path.basename(String(file || ''))} has human gates its default lacks (${gates.join(', ')}): a restore would remove them, outside sessions never do. Restore it from the app.`;
  },
};

// The version of this HTTP contract (routes, bodies, exit codes the client relies on). Bump it with
// CONTROL_VERSION in native/multiagent-ctl/src/main.rs when either changes incompatibly.
const CONTROL_VERSION = '1';

// the allowlisted channels with their argument schemas (#338), for `multiagent-ctl --list`
function describeChannels(service) {
  const byChannel = new Map((service.manifest || []).filter((e) => e.channel).map((e) => [e.channel, e]));
  return [...CHANNELS].filter((c) => Object.hasOwn(service.api, c)).map((channel) => {
    const e = byChannel.get(channel) || {};
    return { channel, params: e.params ?? null, schema: e.schema?.params ?? null };
  });
}

// a short, single-line summary of a value for the call log
function summarize(value) {
  let text;
  try { text = JSON.stringify(value); } catch { text = String(value); }
  if (text === undefined) return null;
  return text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS)}… (${text.length} chars)` : text;
}

const controlDir = (ws) => path.join(ws.root, 'control');

/**
 * @param service  the running app's engine service (src/service)
 * @param ctlPath  where the multiagent-ctl client is (main.js: nativeBinaryPath for app.isPackaged)
 * @returns { update(), stop(), status() }: update() follows the setting and resolves the status
 *          { enabled, url, port, file, error, ctlPath }
 */
function createControlChannel({ service, ctlPath = nativeBinaryPath('multiagent-ctl', { isPackaged: false }) }) {
  let server = null;
  let open = null; // { url, port, file, root }
  let error = null;
  let queue = Promise.resolve();

  const status = () => ({
    enabled: !!open,
    url: open?.url || null,
    port: open?.port || null,
    file: open?.file || null,
    error,
    ctlPath,
  });

  function record(root, entry) {
    try {
      fs.mkdirSync(path.join(root, 'control'), { recursive: true });
      fs.appendFileSync(path.join(root, 'control', 'calls.jsonl'), `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
    } catch (e) {
      console.error('control channel log:', e.message);
    }
  }

  function handler({ isToken, root, port }) {
    return async (req, res) => {
      let channel = null;
      let args = null;
      const answer = (status, body) => {
        sendJson(res, status, body);
        if (channel === null) return;
        const outcome = body.error ? { error: String(body.error).slice(0, SUMMARY_CHARS * 2) } : { result: summarize(body.result) };
        record(root, { channel: channel.slice(0, SUMMARY_CHARS), args, status, ...outcome });
      };
      try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/api/')) {
          try { channel = decodeURIComponent(url.pathname.slice(5)); } catch { channel = url.pathname.slice(5); }
        }
        // a page of another site, or one reached by DNS rebinding, never gets in
        if (!sameOrigin(req) || !isLoopbackHost(req.headers.host, port)) throw new HttpError(403, 'Cross-origin requests are not allowed.');
        if (!isToken(bearer(req))) throw new HttpError(401, 'Missing or invalid token: read it from control/endpoint.json.');
        if (channel === null) throw new HttpError(404, 'Not found: use POST /api/<channel>.');
        if (req.method === 'GET' && (channel === 'version' || channel === 'channels')) {
          const body = channel === 'version' ? { version: CONTROL_VERSION } : { channels: describeChannels(service) };
          channel = null; // the client's own reads are not calls: not logged
          sendJson(res, 200, body);
          return;
        }
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
        const body = await readJson(req);
        args = summarize(body.arg);
        if (!CHANNELS.has(channel) || !Object.hasOwn(service.api, channel)) {
          throw new HttpError(403, `Channel not allowed for outside sessions: ${channel}`);
        }
        const gateArg = body.arg && typeof body.arg === 'object' ? GATE_ARGS.find((k) => body.arg[k] != null && body.arg[k] !== false) : null;
        if (gateArg) throw new HttpError(403, `${channel}: ${gateArg} is refused, outside sessions never cross a human gate.`);
        const refusal = GUARDS[channel]?.(service, body.arg);
        if (refusal) throw new HttpError(403, `${channel}: ${refusal}`);
        const result = await callChannel(service.api[channel], body.arg);
        answer(result.status, result.body);
      } catch (e) {
        if (res.headersSent) { res.destroy(); return; }
        answer(e.status || 500, { error: e.message || String(e) });
      }
    };
  }

  function listen(ws) {
    return new Promise((resolve, reject) => {
      const token = crypto.randomBytes(32).toString('hex');
      const isToken = tokenCheck(token);
      const srv = http.createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        srv.off('error', reject);
        srv.on('error', (e) => console.error('control channel:', e.message));
        srv.unref();
        const port = srv.address().port;
        srv.on('request', handler({ isToken, root: ws.root, port }));
        const url = `http://127.0.0.1:${port}`;
        const file = path.join(controlDir(ws), 'endpoint.json');
        try {
          fs.mkdirSync(controlDir(ws), { recursive: true });
          // readable by this user only where the OS honours the mode (SEC-25); the workflow's agents run
          // as this user and can still read it (SECURITY.md, threat model)
          fs.writeFileSync(file, `${JSON.stringify({ url, token, pid: process.pid, started: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
          // the mode only applies to a new file: one left by a crash or an older version keeps its own
          fs.chmodSync(file, 0o600);
        } catch (e) {
          srv.close();
          reject(e);
          return;
        }
        resolve({ srv, open: { url, port, file, root: ws.root } });
      });
    });
  }

  async function close() {
    const srv = server;
    const was = open;
    server = null;
    open = null;
    // synchronous, before any await: done even when the app quits right after
    if (was) {
      try { fs.rmSync(was.file, { force: true }); } catch (e) { console.error('control channel:', e.message); }
    }
    if (srv) {
      await new Promise((resolve) => {
        srv.close(() => resolve());
        srv.closeAllConnections();
      });
    }
  }

  async function apply() {
    const ws = service.workspace();
    let wanted = false;
    try { wanted = !!ws && !!workspace.readSettings(ws).controlChannel; } catch { wanted = false; }
    // off, or another workspace: the old endpoint goes first
    if (open && (!wanted || open.root !== ws.root)) await close();
    if (!wanted) {
      // one app per workspace (#112): a file left by a crash or a forced exit points at a dead app
      if (ws) {
        try { fs.rmSync(path.join(controlDir(ws), 'endpoint.json'), { force: true }); } catch (e) { console.error('control channel:', e.message); }
      }
      error = null;
      return status();
    }
    if (!server) {
      try {
        const opened = await listen(ws);
        server = opened.srv;
        open = opened.open;
        error = null;
      } catch (e) {
        error = `The control channel could not open: ${e.message || e}`;
      }
    }
    return status();
  }

  // transitions run one after the other: a quick off/on never leaves two ports open
  const serial = (fn) => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  return {
    update: () => serial(apply),
    stop: () => serial(async () => { await close(); error = null; return status(); }),
    status,
  };
}

module.exports = { CONTROL_VERSION, createControlChannel };
