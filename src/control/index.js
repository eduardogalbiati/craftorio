// The control channel (#336): outside sessions (a terminal, another agent) drive the running app through
// its own channels instead of editing workspace files. Off by default (setting controlChannel,
// Settings › Execution). When on, the app listens on 127.0.0.1 only, on a free port, and writes
// <workspace>/control/endpoint.json { url, token } (a new random token on every start); off, or the
// app quitting, closes the port and deletes the file.
//   POST /api/<channel>   Authorization: Bearer <token>, body { "arg": ... }  ->  as src/server/index.js
// Only the channels of src/control/allowlist.js are answered (others: 403 naming the channel); no
// argument may cross a human gate (confirmGate). Every call is appended to control/calls.jsonl.
// The calls go to the running app's own service: actions dispatch as from the screen, and no second
// engine opens the workspace (#112). scripts/ctl.js is the small client.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const workspace = require('../workspace');
const { CHANNELS, GATE_ARGS } = require('./allowlist');
const {
  bearer,
  callChannel,
  HttpError,
  readJson,
  sameOrigin,
  sendJson,
  tokenCheck,
} = require('../server');

const SUMMARY_CHARS = 200;

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
 * @returns { update(), stop(), status() }: update() follows the setting and resolves the status
 *          { enabled, url, port, file, error }
 */
function createControlChannel({ service }) {
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
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
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
        if (!sameOrigin(req) || !hosts.has(req.headers.host)) throw new HttpError(403, 'Cross-origin requests are not allowed.');
        if (!isToken(bearer(req))) throw new HttpError(401, 'Missing or invalid token: read it from control/endpoint.json.');
        if (channel === null) throw new HttpError(404, 'Not found: use POST /api/<channel>.');
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
        const body = await readJson(req);
        args = summarize(body.arg);
        if (!CHANNELS.has(channel) || !Object.hasOwn(service.api, channel)) {
          throw new HttpError(403, `Channel not allowed for outside sessions: ${channel}`);
        }
        const gateArg = body.arg && typeof body.arg === 'object' ? GATE_ARGS.find((k) => body.arg[k] != null && body.arg[k] !== false) : null;
        if (gateArg) throw new HttpError(403, `${channel}: ${gateArg} is refused, outside sessions never cross a human gate.`);
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
          fs.writeFileSync(file, `${JSON.stringify({ url, token, pid: process.pid, started: new Date().toISOString() }, null, 2)}\n`);
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
    if (!wanted) { error = null; return status(); }
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

module.exports = { createControlChannel };
