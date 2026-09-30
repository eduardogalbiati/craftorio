const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { setupWorkspace } = require('../src/workspace');
const { createService } = require('../src/service');
const { createServer } = require('../src/server');

const TOKEN = 'test-token-0123456789abcdef';
const WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-server
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
`;

// A server on a random port over a temporary workspace.
async function start(t, { auth = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-ws-'));
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
  const service = createService({ host: { trashItem: async () => {}, appVersion: '1.2.3', isPackaged: false } });
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-server.yaml'), WORKFLOW);
  const server = createServer({ service, auth, token: TOKEN });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    service.shutdown();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { server, service, base };
}

// Raw request (no URL normalization, so path traversal attempts reach the server as written).
function request(base, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
const bearer = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const callApi = (base, channel, arg, headers = bearer) => request(base, { method: 'POST', path: `/api/${channel}`, headers, body: { arg } });

test('refuses a weak token', () => {
  assert.throws(() => createServer({ service: { api: {}, notifications: {}, events: { on() {} } }, token: 'short' }), /at least 16/);
});

test('API calls need the token and return the channel result', async (t) => {
  const { base } = await start(t);
  assert.equal((await callApi(base, 'projects:list', null, { 'Content-Type': 'application/json' })).status, 401);
  assert.equal((await callApi(base, 'projects:list', null, { Authorization: 'Bearer wrong-token-000000000' })).status, 401);
  const ok = await callApi(base, 'projects:list');
  assert.deepEqual([ok.status, ok.json], [200, { result: [] }]);
  assert.equal((await callApi(base, 'app:info')).json.result.version, '1.2.3');
  const wf = await callApi(base, 'workflows:list');
  assert.ok(wf.json.result.some((w) => w.file === 'fixture-server.yaml'));
});

test('unknown channels, wrong methods, bad bodies and channel errors', async (t) => {
  const { base } = await start(t);
  assert.equal((await callApi(base, 'nope:nothing')).status, 404);
  assert.equal((await callApi(base, 'constructor')).status, 404);
  assert.equal((await request(base, { path: '/api/projects:list', headers: bearer })).status, 405);
  assert.equal((await request(base, { method: 'POST', path: '/api/projects:list', headers: bearer, body: '{not json' })).status, 400);
  const err = await callApi(base, 'projects:runs', { id: 'missing' });
  assert.deepEqual([err.status, err.json.error], [500, 'Project not found: missing']);
});

test('refuses requests from another origin', async (t) => {
  const { base } = await start(t);
  const r = await callApi(base, 'projects:list', null, { ...bearer, Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const same = await callApi(base, 'projects:list', null, { ...bearer, Origin: base });
  assert.equal(same.status, 200);
});

test('a browser opening ?token= gets a cookie and the UI', async (t) => {
  const { base } = await start(t);
  assert.equal((await request(base, { path: '/?token=wrong' })).status, 401);
  const boot = await request(base, { path: `/?token=${TOKEN}` });
  assert.equal(boot.status, 302);
  assert.equal(boot.headers.location, '/');
  const cookie = boot.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const jar = { Cookie: cookie.split(';')[0] };

  assert.equal((await request(base, { path: '/', headers: jar })).headers.location, '/src/renderer/index.html');
  const page = await request(base, { path: '/src/renderer/index.html', headers: jar });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.text, /api-http\.js/);
  assert.equal((await request(base, { path: '/node_modules/marked/lib/marked.umd.js', headers: jar })).status, 200);
  assert.equal((await callApi(base, 'projects:list', null, { ...jar, 'Content-Type': 'application/json' })).status, 200);
  // without the cookie, even the UI needs the token
  assert.equal((await request(base, { path: '/src/renderer/index.html' })).status, 401);
});

test('serves only the UI folders: no source, no other packages, no traversal', async (t) => {
  const { base } = await start(t);
  const get = (p) => request(base, { path: p, headers: bearer }).then((r) => r.status);
  assert.equal(await get('/src/renderer/app.js'), 200);
  assert.equal(await get('/src/main.js'), 404);
  assert.equal(await get('/src/auth-config.js'), 404);
  assert.equal(await get('/package.json'), 404);
  assert.equal(await get('/node_modules/ws/package.json'), 404);
  assert.equal(await get('/src/renderer/../../package.json'), 404);
  assert.equal(await get('/src/renderer/%2e%2e/%2e%2e/package.json'), 404);
  assert.equal(await get('/src/renderer/..%5c..%5cpackage.json'), 404);
});

test('the WebSocket needs the token and streams run events', async (t) => {
  const { base } = await start(t);
  const wsUrl = base.replace('http', 'ws') + '/ws';

  const refused = await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => {});
  });
  assert.equal(refused, 401);
  const crossSite = await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${TOKEN}` }, origin: 'https://evil.example' });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => {});
  });
  assert.equal(crossSite, 403);

  const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${TOKEN}` } });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  t.after(() => ws.close());
  const types = [];
  const finished = new Promise((resolve) => ws.on('message', (data) => {
    const { channel, payload } = JSON.parse(data);
    if (channel !== 'run:event') return;
    types.push(payload.type);
    if (payload.type === 'workflow.finished') resolve(payload);
  }));
  // fire-and-forget messages for unknown terminals and garbage are ignored
  ws.send(JSON.stringify({ channel: 'term:input', arg: { id: 'nope', data: 'x' } }));
  ws.send('not json');

  const started = await callApi(base, 'run:start', { file: 'fixture-server.yaml', inputs: {}, mock: true });
  assert.equal(started.status, 200);
  const end = await finished;
  assert.equal(end.status, 'success');
  assert.ok(types.includes('workflow.started') && types.includes('step.finished'));
  assert.equal((await callApi(base, 'runs:list')).json.result.runs[0].runId, started.json.result.runId);
});

test('the auth channels are served and account changes are pushed', async (t) => {
  const listeners = new Set();
  let s = { configured: true, required: true, user: null };
  const auth = {
    state: () => s,
    refresh: async () => s,
    signIn: async (provider) => { s = { ...s, user: { email: `${provider}@example.com` } }; listeners.forEach((cb) => cb(s)); return s; },
    cancelSignIn: () => s,
    signOut: async () => s,
    onChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
  const { base, server } = await start(t, { auth });
  assert.ok(server.channels().includes('auth:signIn'));
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { Authorization: `Bearer ${TOKEN}` } });
  await new Promise((r) => ws.on('open', r));
  t.after(() => ws.close());
  const pushed = new Promise((resolve) => ws.on('message', (d) => { const m = JSON.parse(d); if (m.channel === 'auth:changed') resolve(m.payload); }));
  const r = await callApi(base, 'auth:signIn', 'google');
  assert.equal(r.json.result.user.email, 'google@example.com');
  assert.equal((await pushed).user.email, 'google@example.com');
});

// #77: window.api (desktop and browser) is built at runtime from the channel manifest
// (src/service/manifest.js), not from a hand-listed method per file: nothing here parses source
// text for method names any more.

// src/preload.js requires 'electron' at load and calls contextBridge.exposeInMainWorld once: stub
// both so the module can run under plain Node, and capture what it exposed.
function loadPreloadApi(manifest) {
  const electronPath = require.resolve('electron');
  const preloadPath = require.resolve('../src/preload.js');
  let exposed = null;
  require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: {
      contextBridge: { exposeInMainWorld: (_name, api) => { exposed = api; } },
      ipcRenderer: { sendSync: (channel) => (channel === 'api:manifest' ? manifest : undefined) },
    },
  };
  delete require.cache[preloadPath];
  try {
    require(preloadPath);
  } finally {
    delete require.cache[preloadPath];
    delete require.cache[electronPath];
  }
  return exposed;
}

// src/renderer/api-http.js is a browser IIFE (window, fetch, XMLHttpRequest, WebSocket): run it in
// a small vm sandbox with just enough of those to build window.api from a stubbed manifest fetch.
function loadApiHttpApi(manifest) {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'api-http.js'), 'utf8');
  function FakeXHR() {}
  FakeXHR.prototype.open = function open() {};
  FakeXHR.prototype.send = function send() { this.status = 200; this.responseText = JSON.stringify({ result: manifest }); };
  function FakeWebSocket() { this.readyState = 0; }
  FakeWebSocket.OPEN = 1;
  const sandbox = {
    window: {}, navigator: { clipboard: {} }, location: { protocol: 'http:', host: 'sandbox.invalid' },
    XMLHttpRequest: FakeXHR, WebSocket: FakeWebSocket, fetch: async () => ({ ok: true, json: async () => ({ result: null }) }),
    setTimeout, clearTimeout, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.api;
}

test('GET /api/manifest lists every channel, and the desktop and browser clients build the exact same methods from it', async (t) => {
  const { base, service } = await start(t, { auth: { state() {}, refresh() {}, signIn() {}, cancelSignIn() {}, signOut() {}, onChange: () => () => {} } });
  const res = await request(base, { path: '/api/manifest', headers: bearer });
  assert.equal(res.status, 200);
  const manifest = res.json.result;
  const named = new Set(manifest.map((e) => e.channel || e.send || e.event));
  for (const c of [...Object.keys(service.api), ...Object.keys(service.notifications), 'auth:signIn']) assert.ok(named.has(c), c);

  const preload = loadPreloadApi(manifest);
  const browser = loadApiHttpApi(manifest);
  const methodsOf = (api, extra) => Object.keys(api).filter((k) => !extra.includes(k)).sort();
  const preloadMethods = methodsOf(preload, ['platform']);
  const browserMethods = methodsOf(browser, ['platform', 'onReconnect']);
  assert.ok(preloadMethods.length > 30);
  assert.deepEqual(preloadMethods, browserMethods);
});

test('a channel manifest declaring the same channel twice is refused', () => {
  const { declarations } = require('../src/service/manifest');
  assert.throws(() => declarations([{ channel: 'x:y', method: 'a' }, { channel: 'x:y', method: 'b' }]), /x:y is declared twice/);
  assert.throws(() => declarations([{ channel: 'a:b', method: 'same' }, { channel: 'c:d', method: 'same' }]), /method same is declared twice/);
});
