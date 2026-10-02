// HTTP + WebSocket transport for the engine service (src/service): the same channels the desktop
// app uses over IPC, so the engine can run on a server and the UI can be used from a browser.
//
//   POST /api/<channel>   body { "arg": ... }  ->  200 { "result": ... } | 4xx/500 { "error": "..." }
//   GET  /api/manifest    { "result": [...] }: the channels window.api is built from (src/service/manifest.js)
//   GET  /ws              WebSocket. The server pushes { "channel", "payload" } (chat:progress, run:event,
//                         supervisor:watch, term:data, term:exit, auth:changed); the client sends { "channel", "arg" }
//                         for the fire-and-forget channels (term:input, term:resize).
//   GET  /                the UI (src/renderer + src/renderer/api-http.js) and the few libraries
//                         it loads from node_modules.
//
// Every request needs the server token: `Authorization: Bearer <token>`, or the cookie the server
// sets when a browser opens /?token=<token>. Requests whose Origin is another site are refused
// (CSRF, cross-site WebSocket hijacking): the engine runs the user's CLIs on the user's files.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { authChannels } = require('../service/manifest');

const ROOT = path.join(__dirname, '..', '..');
// the only folders served as static files (relative to ROOT)
const STATIC_DIRS = ['src/renderer/', 'node_modules/@xterm/xterm/', 'node_modules/@xterm/addon-fit/', 'node_modules/marked/', 'node_modules/dompurify/'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
const COOKIE = 'multiagent_token';
// a pasted image of up to 10 MB travels as base64 (clipboard:saveImage, #130)
const MAX_BODY = 15 * 1024 * 1024;
const PUSHED = ['backlog:changed', 'chat:progress', 'notifications:changed','oracle:changed', 'run:event', 'run:meta', 'supervisor:watch', 'term:data', 'term:exit'];

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
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch { reject(new HttpError(400, 'The body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

/**
 * @param service  the engine service (src/service)
 * @param auth     optional account module (src/auth): adds the auth:* channels and pushes auth:changed
 * @param token    shared secret every client must present (at least 16 characters)
 * @returns an http.Server, not listening yet
 */
function createServer({ service, auth = null, token, root = ROOT }) {
  if (!token || String(token).length < 16) throw new Error('The server needs a token of at least 16 characters.');
  const expected = crypto.createHash('sha256').update(String(token)).digest();
  const isToken = (t) => !!t && crypto.timingSafeEqual(crypto.createHash('sha256').update(String(t)).digest(), expected);
  const cookieToken = (req) => {
    const c = (req.headers.cookie || '').split(/;\s*/).find((x) => x.startsWith(`${COOKIE}=`));
    try { return c ? decodeURIComponent(c.slice(COOKIE.length + 1)) : null; } catch { return null; }
  };
  const authorized = (req) => isToken((req.headers.authorization || '').replace(/^Bearer\s+/i, '')) || isToken(cookieToken(req));
  // Browsers send Origin on cross-site requests; non-browser clients usually send none.
  const sameOrigin = (req) => {
    if (!req.headers.origin) return true;
    try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
  };

  const api = { ...service.api };
  if (auth) for (const { channel, fn } of authChannels(auth)) if (channel) api[channel] = fn;
  // what api-http.js builds window.api from (the service's manifest also declares the desktop-only
  // and account methods, so the browser has them all)
  const manifest = service.manifest || [];

  async function handleApi(req, res, channel) {
    const fn = Object.hasOwn(api, channel) ? api[channel] : null;
    if (!fn) throw new HttpError(404, `Unknown channel: ${channel}`);
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
    const body = await readJson(req);
    let result;
    try {
      result = await fn(body.arg);
    } catch (e) {
      // an error of the channel itself (same message the desktop app shows)
      return sendJson(res, 500, { error: e.message || String(e) });
    }
    sendJson(res, 200, { result: result === undefined ? null : result });
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Use GET.');
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Bad path.'); }
    // backslashes are separators on Windows: an encoded one (%5c) could climb out of the folder
    if (/[\\\0]/.test(rel)) throw new HttpError(404, 'Not found.');
    rel = path.posix.normalize(rel).replace(/^\/+/, '');
    const dir = STATIC_DIRS.find((d) => rel.startsWith(d));
    if (!dir) throw new HttpError(404, 'Not found.');
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
      // a browser opening the URL printed by the server: keep the token in a cookie and drop it
      // from the address bar
      if (req.method === 'GET' && url.searchParams.has('token')) {
        if (!isToken(url.searchParams.get('token'))) throw new HttpError(401, 'Invalid token.');
        url.searchParams.delete('token');
        res.writeHead(302, {
          'Set-Cookie': `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`,
          Location: url.pathname + (url.search || ''),
        });
        return res.end();
      }
      if (!sameOrigin(req)) throw new HttpError(403, 'Cross-origin requests are not allowed.');
      if (!authorized(req)) throw new HttpError(401, 'Missing or invalid token: open the URL printed by the server (with ?token=...).');
      if (url.pathname === '/') {
        res.writeHead(302, { Location: '/src/renderer/index.html' });
        return res.end();
      }
      if (url.pathname === '/api/manifest' && req.method === 'GET') return sendJson(res, 200, { result: manifest });
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
    if (!sameOrigin(req)) return refuse(403, 'Forbidden');
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
  const unsubscribe = PUSHED.map((channel) => {
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

module.exports = { createServer, STATIC_DIRS };
