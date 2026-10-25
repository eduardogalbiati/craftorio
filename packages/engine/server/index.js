// HTTP + WebSocket transport for the engine service (packages/engine/service): the same channels the desktop
// app uses over IPC, so the engine can run on a server and the UI can be used from a browser.
//
//   POST /api/<channel>   body { "arg": ... }  ->  200 { "result": ... } | 4xx/500 { "error": "..." }
//   GET  /api/manifest    { "result": [...], "contract" }: the channels window.api is built from
//                         (packages/engine/service/manifest.js) and their contract (contractHash, packages/engine/service/contract.js)
//   GET  /api/version     { "app", "contract" } (#339): the engine's version and the contract it speaks,
//                         as app:version answers it; a client built for another contract shows a banner
//                         (apps/desktop/renderer/api-http.js). Contract tests over HTTP: test/contract/.
//   GET  /ws              WebSocket. The server pushes { "channel", "payload" } (chat:progress, run:event,
//                         supervisor:watch, term:data, term:exit, auth:changed); the client sends { "channel", "arg" }
//                         for the fire-and-forget channels (term:input, term:resize).
//   GET  /                the UI (apps/desktop/renderer + apps/desktop/renderer/api-http.js) and the few libraries
//                         it loads from node_modules.
//
//   POST /session         form body token=<token>: the one-shot sign-in (the 401 page of a browser is
//                         its form) → 303 to / with the cookie; keeps the token out of the address bar
//
// Every request needs the server token: `Authorization: Bearer <token>`, or the cookie the server
// sets after POST /session or when a browser opens /?token=<token> (the desktop app's startUrl). The
// token is full control of the machine (a shell, gate approval, paid runs, #479). The cookie is
// HttpOnly, SameSite=Strict, with a Max-Age renewed by every request it signs in, and Secure when the
// request came over HTTPS (TLS, or x-forwarded-proto: https from a TLS proxy). Requests whose Origin
// is another site are refused (CSRF, cross-site WebSocket hijacking): the engine runs the user's CLIs
// on the user's files. A server bound to loopback answers only a Host of localhost / 127.0.0.1 /
// [::1] (DNS rebinding, SEC-16), as packages/engine/control/index.js does (isLoopbackHost).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const {
  authChannels,
  PUSHED_EVENTS,
} = require('../service/manifest');
const { contractHash } = require('../service/contract');
const { tokenCheck } = require('../domains/cli/token-check');
const { appPackage, appRoot } = require('../domains/workspace/app-root');

const PKG = appPackage();
// The UI folder served (relative to the app root, with a trailing /): the root package.json's
// `multiagent.ui` (the desktop app's renderer until phase 3's apps/web), else apps/desktop/renderer/.
const uiDir = (pkg = PKG) => `${String(pkg.multiagent?.ui || 'apps/desktop/renderer').replace(/\/+$/, '')}/`;
// the shared package's folder, relative to root: the workspace under root (what index.html's relative
// <script> paths name, scripts/docs.js), else wherever @multiagent/shared resolves from here
function sharedDir(root) {
  if (fs.existsSync(path.join(root, 'packages', 'shared', 'package.json'))) return 'packages/shared/';
  try { return `${path.relative(root, path.dirname(require.resolve('@multiagent/shared/package.json'))).split(path.sep).join('/')}/`; } catch { return 'packages/shared/'; }
}
// never served, inside an allowed folder: a package's tests and manifest
const NOT_SERVED = /(^|\/)(test|features|node_modules)\/|(^|\/)package\.json$/;
// the only folders served as static files (relative to the root): the UI, the shared package's pure
// modules index.html loads with a relative path (#345, scripts/docs.js), the UI kit and the fronts
// (phase 3 of docs/reorganisation-study-2026-10.md: the page's scripts and stylesheets, which the
// page also names with relative paths), generated/ (the 3D views, scripts/build-3d.js) and the few
// libraries the page loads; a package's test/, features/ and node_modules/ never (NOT_SERVED). The list
// mirrors the layers scripts/source-tree.js knows (the engine cannot require scripts/): a new layer is
// added in both places.
const STATIC_DIRS = ['packages/ui-kit/', 'fronts/', 'generated/', 'node_modules/@xterm/xterm/', 'node_modules/@xterm/addon-fit/', 'node_modules/marked/', 'node_modules/dompurify/'];
const staticDirs = (root, ui) => [ui, sharedDir(root), ...STATIC_DIRS];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
const COOKIE = 'multiagent_token';
// the cookie lasts a week: then the browser asks for the token again (#479)
const COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60;
// the sign-in form's body: a token, nothing more
const MAX_FORM = 4096;
// a pasted image of up to 10 MB travels as base64 (clipboard:saveImage, #130)
const MAX_BODY = 15 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// the request's body as text, refused (413) past max bytes
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new HttpError(413, 'Request body too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const text = await readBody(req, MAX_BODY);
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'The body is not valid JSON.'); }
}

const readForm = async (req) => new URLSearchParams(await readBody(req, MAX_FORM));

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

// Browsers send Origin on cross-site requests; non-browser clients usually send none.
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}

const isLoopbackAddress = (ip) => /^(::ffff:)?127\.\d+\.\d+\.\d+$/.test(String(ip || '')) || ip === '::1';
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?$/i;

// a Host header naming this machine by a loopback name (with that port when one is given); the
// control channel (packages/engine/control/index.js) uses it too
function isLoopbackHost(host, port = null) {
  const m = LOOPBACK_HOST.exec(String(host || ''));
  return !!m && (port == null || m[2] === String(port));
}

// DNS rebinding (SEC-16): a server bound to loopback (--host 127.0.0.1) answers only a Host that names
// this machine; another name means a page of another site whose name now points here. A server bound
// to another address (0.0.0.0 with --insecure-http, a Tailscale IP) is reached by other names.
const hostAllowed = (req, boundAddress) => !isLoopbackAddress(boundAddress) || isLoopbackHost(req.headers.host);

// came over HTTPS: TLS here, or a TLS reverse proxy in front (its first x-forwarded-proto)
const overHttps = (req) => !!req.socket?.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';

// what a browser without the token sees: the sign-in form (POST /session)
const SIGN_IN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Multiagent Orchestrator: sign in</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font: 13px system-ui, sans-serif; background: #0f1115; color: #e6e8ee; display: grid; place-items: center; min-height: 90vh">
<form method="post" action="/session" style="display: grid; gap: 8px; width: 320px">
<label for="token">Engine token</label>
<input id="token" name="token" type="password" autocomplete="off" required autofocus>
<small>MULTIAGENT_SERVER_TOKEN on the engine's computer, or the token= part of the URL it printed. It is full control of that machine.</small>
<button type="submit">Sign in</button>
</form></body></html>`;

// Calls a channel's function: { status, body } as POST /api/<channel> answers it. An error of the
// channel itself (same message the desktop app shows): a refused input (status 4xx,
// packages/engine/service/common.js requireId/requireText) is the client's error.
async function callChannel(fn, arg) {
  try {
    const result = await fn(arg);
    return { status: 200, body: { result: result === undefined ? null : result } };
  } catch (e) {
    const status = e && e.status >= 400 && e.status < 500 ? e.status : 500;
    return { status, body: { error: (e && e.message) || String(e) } };
  }
}

/**
 * @param service  the engine service (packages/engine/service)
 * @param auth     optional account module (src/auth): adds the auth:* channels and pushes auth:changed
 * @param token    shared secret every client must present (at least 16 characters)
 * @returns an http.Server, not listening yet
 */
function createServer({ service, auth = null, token, root = appRoot(), ui = uiDir() }) {
  const served = staticDirs(root, ui);
  if (!token || String(token).length < 16) throw new Error('The server needs a token of at least 16 characters.');
  const isToken = tokenCheck(token);
  const cookieToken = (req) => {
    const c = (req.headers.cookie || '').split(/;\s*/).find((x) => x.startsWith(`${COOKIE}=`));
    try { return c ? decodeURIComponent(c.slice(COOKIE.length + 1)) : null; } catch { return null; }
  };
  const authorized = (req) => isToken(bearer(req)) || isToken(cookieToken(req));
  // signed in by the cookie: its Max-Age starts again, so a window left open keeps working
  const byCookie = (req) => !isToken(bearer(req)) && isToken(cookieToken(req));
  const pinned = (req) => hostAllowed(req, server.address()?.address);
  const cookieHeader = (req) => `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_S}${overHttps(req) ? '; Secure' : ''}`;

  const api = { ...service.api };
  if (auth) for (const { channel, fn } of authChannels(auth)) if (channel) api[channel] = fn;
  // what api-http.js builds window.api from (the service's manifest also declares the desktop-only
  // and account methods, so the browser has them all)
  const manifest = service.manifest || [];
  const contract = contractHash(manifest);
  // { app, contract } (#339): the service's app:version when it has one (IPC answers the same),
  // else this package's version
  const version = async () => {
    const own = { app: PKG.version, contract };
    if (!api['app:version']) return own;
    try {
      const v = await api['app:version']();
      return { app: v.app, contract: v.contract };
    } catch {
      return own;
    }
  };

  async function handleApi(req, res, channel) {
    const fn = Object.hasOwn(api, channel) ? api[channel] : null;
    if (!fn) throw new HttpError(404, `Unknown channel: ${channel}`);
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
    const body = await readJson(req);
    const answer = await callChannel(fn, body.arg);
    sendJson(res, answer.status, answer.body);
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Use GET.');
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Bad path.'); }
    // backslashes are separators on Windows: an encoded one (%5c) could climb out of the folder
    if (/[\\\0]/.test(rel)) throw new HttpError(404, 'Not found.');
    rel = path.posix.normalize(rel).replace(/^\/+/, '');
    const dir = served.find((d) => rel.startsWith(d));
    if (!dir || NOT_SERVED.test(rel.slice(dir.length))) throw new HttpError(404, 'Not found.');
    const file = path.resolve(root, ...rel.split('/'));
    // and the resolved file must still be inside the allowed folder
    if (!file.startsWith(path.resolve(root, ...dir.split('/').filter(Boolean)) + path.sep)) throw new HttpError(404, 'Not found.');
    let data;
    try { data = fs.readFileSync(file); } catch { throw new HttpError(404, 'Not found.'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!pinned(req)) throw new HttpError(403, 'This server answers only to localhost, 127.0.0.1 or [::1].');
      // a browser opening the URL printed by the server: keep the token in a cookie and drop it
      // from the address bar
      if (req.method === 'GET' && url.searchParams.has('token')) {
        if (!isToken(url.searchParams.get('token'))) throw new HttpError(401, 'Invalid token.');
        url.searchParams.delete('token');
        res.writeHead(302, { 'Set-Cookie': cookieHeader(req), Location: url.pathname + (url.search || '') });
        return res.end();
      }
      if (!sameOrigin(req)) throw new HttpError(403, 'Cross-origin requests are not allowed.');
      // the sign-in form: the token in the body, never in the address or the history
      if (url.pathname === '/session' && req.method === 'POST') {
        const form = await readForm(req);
        if (!isToken(form.get('token'))) throw new HttpError(401, 'Invalid token.');
        res.writeHead(303, { 'Set-Cookie': cookieHeader(req), Location: '/', 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (!authorized(req)) {
        if (req.method === 'GET' && /text\/html/.test(req.headers.accept || '')) {
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
          return res.end(SIGN_IN_PAGE);
        }
        throw new HttpError(401, 'Missing or invalid token: sign in at /session, or open the URL printed by the server.');
      }
      if (byCookie(req)) res.setHeader('Set-Cookie', cookieHeader(req));
      if (url.pathname === '/') {
        res.writeHead(302, { Location: `/${ui}index.html` });
        return res.end();
      }
      if (url.pathname === '/api/manifest' && req.method === 'GET') return sendJson(res, 200, { result: manifest, contract });
      if (url.pathname === '/api/version' && req.method === 'GET') return sendJson(res, 200, await version());
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, decodeURIComponent(url.pathname.slice(5)));
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      sendJson(res, e.status || 500, { error: e.message || String(e) });
    }
  });

  // ---- WebSocket: pushed events and fire-and-forget channels ----------------------------------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const refuse = (status, text) => { socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    if (pathname !== '/ws') return refuse(404, 'Not Found');
    if (!pinned(req) || !sameOrigin(req)) return refuse(403, 'Forbidden');
    if (!authorized(req)) return refuse(401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        const fn = Object.hasOwn(service.notifications, msg?.channel) ? service.notifications[msg.channel] : null;
        if (fn) { try { fn(msg.arg); } catch (e) { console.error(`${msg.channel}:`, e.message); } }
      });
    });
  });

  const broadcast = (channel) => (payload) => {
    const msg = JSON.stringify({ channel, payload });
    for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(msg);
  };
  const unsubscribe = PUSHED_EVENTS.map((channel) => {
    const fn = broadcast(channel);
    service.events.on(channel, fn);
    return () => service.events.off(channel, fn);
  });
  if (auth) unsubscribe.push(auth.onChange(broadcast('auth:changed')));

  // close() would wait forever for open WebSockets and keep-alive connections: end them first
  const close = server.close.bind(server);
  server.close = (cb) => {
    unsubscribe.forEach((off) => off());
    unsubscribe.length = 0;
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    close(cb);
    server.closeIdleConnections();
    return server;
  };
  server.channels = () => Object.keys(api);
  return server;
}

module.exports = {
  bearer,
  callChannel,
  createServer,
  hostAllowed,
  HttpError,
  isLoopbackHost,
  readJson,
  sameOrigin,
  sendJson,
  STATIC_DIRS,
  staticDirs,
  tokenCheck,
  uiDir,
};
