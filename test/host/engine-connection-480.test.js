// #480 (SEC-15): the desktop app's window onto a remote engine (src/host/engine-connection.js rules,
// src/host/engine-connection-window.js windows) never sends the token in clear to an arbitrary host.
// CONTRACT (acceptance tests written before the code):
//   - A plain http:// engine address is allowed only when its host is loopback (127.0.0.1,
//     localhost, ::1) or Tailscale (100.64.0.0/10, a *.ts.net name); https:// is always allowed.
//     Any other http host needs the explicit opt-in `insecure: true`:
//       * on the connection setting: decideMode({ connection: { mode: 'remote', address, token,
//         insecure: true } }) → remote; without it → { mode: 'remote', error: <reason> } (the
//         connection page shows it, as for any unusable setting); writeConnection/readConnection keep
//         `insecure: true`;
//       * on the page's Save: engine-connection:save { mode: 'remote', address, token, insecure: true };
//         without it → { saved: false } with nothing written and no restart.
//     (testConnection, the page's Test button, is not part of this contract.)
//   - The remote window's first load carries no token (`token=`) in its address; prepareSession
//     registers session.webRequest.onBeforeSendHeaders([filter,] listener) whose listener, for a
//     request of the engine's origin, answers callback({ requestHeaders }) with
//     `Authorization: Bearer <token>` added (other headers kept), and for any other origin leaves the
//     headers without Authorization (the listener checks the origin itself, whatever the filter).
//   - Permissions: clipboard-read only for an https engine origin; clipboard-sanitized-write for
//     the engine's origin, http or https.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const conn = require('../../src/host/engine-connection');
const { createEngineConnection } = require('../../src/host/engine-connection-window');

const TOKEN = 'tok-0123456789abcdef';

// ---- the address rule (decideMode, the setting) ----------------------------------------------------

const remote = (address, over = {}) => conn.decideMode({ connection: { mode: 'remote', address, token: TOKEN, ...over }, env: {} });

test('#480 a plain-http engine on a LAN address (192.168.1.10) is refused without the insecure opt-in', () => {
  const d = remote('http://192.168.1.10:7300');
  assert.equal(d.mode, 'remote');
  assert.equal(typeof d.error, 'string');
  assert.equal(d.token, undefined, 'no token handed out for a refused address');
});

test('#480 plain http to loopback is accepted', () => {
  assert.equal(remote('http://127.0.0.1:7300').error, undefined);
});

test('#480 plain http to a Tailscale address (100.64.0.0/10) is accepted', () => {
  assert.equal(remote('http://100.101.102.103:7300').error, undefined);
});

test('#480 plain http to a Tailscale MagicDNS name (*.ts.net) is accepted', () => {
  assert.equal(remote('http://my-pc.tail1234.ts.net:7300').error, undefined);
});

test('#480 https to any host is accepted', () => {
  assert.equal(remote('https://engine.example.com').error, undefined);
});

test('#480 the insecure opt-in accepts a plain-http LAN address', () => {
  const d = remote('http://192.168.1.10:7300', { insecure: true });
  assert.deepEqual([d.mode, d.error, d.url], ['remote', undefined, 'http://192.168.1.10:7300']);
});

test('#480 the insecure opt-in is kept by the saved setting', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-connection-480-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, conn.FILE);
  conn.writeConnection(file, { mode: 'remote', address: 'http://192.168.1.10:7300', token: TOKEN, insecure: true });
  assert.equal(conn.readConnection(file).insecure, true);
});

// ---- the windows (a fake Electron, as in test/engine-connection-window.test.js) --------------------

function fakeElectron() {
  const windows = [];
  class FakeContents extends EventEmitter {
    constructor() { super(); this.sent = []; }
    setWindowOpenHandler(fn) { this.openHandler = fn; }
    send(channel) { this.sent.push(channel); }
    getURL() { return ''; }
  }
  class FakeWindow extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.webContents = new FakeContents(); this.destroyed = false; windows.push(this); }
    loadURL(u) { this.loadedUrl = u; }
    loadFile(f) { this.loadedFile = f; }
    isDestroyed() { return this.destroyed; }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('closed'); }
    close() { this.destroy(); }
    getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
    isMinimized() { return false; }
    restore() {}
    focus() {}
  }
  const handlers = new Map();
  const ses = {
    ua: 'Mozilla/5.0',
    getUserAgent() { return this.ua; },
    setUserAgent(u) { this.ua = u; },
    setPermissionRequestHandler(fn) { this.request = fn; },
    setPermissionCheckHandler(fn) { this.check = fn; },
    // onBeforeSendHeaders([filter,] listener): the last function argument is the listener
    webRequest: { onBeforeSendHeaders(...args) { ses.beforeSendHeaders = args.find((a) => typeof a === 'function') || null; } },
  };
  return {
    BrowserWindow: FakeWindow,
    windows,
    handlers,
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    shell: { openExternal() {} },
    session: { fromPartition: () => ses },
    ses,
  };
}

const ENGINE_OK = async () => ({ status: 200, ok: true, json: async () => ({ app: '9.9.9', contract: 'abc123' }) });

function setup({ mode = 'remote', saved = { mode: 'remote', address: 'http://127.0.0.1:7300', token: TOKEN } } = {}) {
  const e = fakeElectron();
  const store = { value: { ...saved }, writes: [], read() { return { ...this.value }; }, write(c) { this.writes.push(c); this.value = { ...c }; } };
  const relaunched = [];
  const main = mode === 'local' ? new e.BrowserWindow({ main: true }) : null;
  const c = createEngineConnection({
    ...e,
    dirname: path.join('app', 'src', 'host'),
    store,
    version: { app: '9.9.9', contract: 'abc123' },
    mode,
    mainWindow: () => main,
    relaunch: () => relaunched.push(true),
    fetch: ENGINE_OK,
  });
  const pageOf = () => e.windows.find((w) => w.loadedFile && !w.destroyed);
  const remoteOf = () => e.windows.find((w) => w.loadedUrl && !w.destroyed);
  const call = (channel, arg) => e.handlers.get(channel)({ sender: pageOf()?.webContents }, arg);
  return { e, c, store, relaunched, pageOf, remoteOf, call };
}

async function remoteWindow(url) {
  const s = setup();
  const host = new URL(url).host;
  await s.c.startRemote({ mode: 'remote', url, host, token: TOKEN, address: url });
  assert.ok(s.remoteOf(), 'the remote window is open');
  return s;
}

// what the session's onBeforeSendHeaders listener answers for a request: its headers (a plain object)
function sendHeaders(s, url) {
  const listener = s.e.ses.beforeSendHeaders;
  assert.equal(typeof listener, 'function', 'prepareSession registers session.webRequest.onBeforeSendHeaders (#480)');
  let answer = null;
  listener({ url, method: 'GET', requestHeaders: { Accept: 'text/html' } }, (r) => { answer = r; });
  assert.ok(answer, 'the listener answers its callback');
  return { ...(answer.requestHeaders || {}) };
}

const permission = (s, name, requestingUrl) => {
  let granted = null;
  s.e.ses.request(null, name, (ok) => { granted = ok; }, { requestingUrl });
  return granted;
};

test('#480 the remote window\'s first load carries no token in its address', async () => {
  const s = await remoteWindow('http://127.0.0.1:7300');
  assert.equal(s.remoteOf().loadedUrl.includes('token='), false, s.remoteOf().loadedUrl);
});

test('#480 requests to the engine\'s origin carry Authorization: Bearer <token>, other headers kept', async () => {
  const s = await remoteWindow('http://127.0.0.1:7300');
  const headers = sendHeaders(s, 'http://127.0.0.1:7300/api/version');
  assert.deepEqual([headers.Authorization, headers.Accept], [`Bearer ${TOKEN}`, 'text/html']);
});

test('#480 requests to another origin carry no Authorization header', async () => {
  const s = await remoteWindow('http://127.0.0.1:7300');
  const headers = sendHeaders(s, 'https://github.com/eduardogalbiati/multiagent-orchestrator');
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers.authorization, undefined);
});

test('#480 clipboard-read is denied to an http engine origin', async () => {
  const s = await remoteWindow('http://127.0.0.1:7300');
  assert.equal(permission(s, 'clipboard-read', 'http://127.0.0.1:7300/src/renderer/index.html'), false);
});

test('#480 clipboard-read is granted to an https engine origin', async () => {
  const s = await remoteWindow('https://my-pc.tail1234.ts.net');
  assert.equal(permission(s, 'clipboard-read', 'https://my-pc.tail1234.ts.net/src/renderer/index.html'), true);
});

test('#480 clipboard-sanitized-write stays granted to an http engine origin', async () => {
  const s = await remoteWindow('http://127.0.0.1:7300');
  assert.equal(permission(s, 'clipboard-sanitized-write', 'http://127.0.0.1:7300/src/renderer/index.html'), true);
});

test('#480 Save refuses a plain-http LAN engine without the opt-in: nothing written, no restart', async () => {
  const s = setup({ mode: 'local', saved: { mode: 'local', address: '', token: '' } });
  s.c.openPage();
  const r = await s.call('engine-connection:save', { mode: 'remote', address: 'http://192.168.1.10:7300', token: TOKEN });
  assert.equal(r.saved, false);
  assert.deepEqual(s.store.writes, []);
  assert.deepEqual(s.relaunched, []);
});

test('#480 Save with the insecure opt-in saves the plain-http LAN engine with insecure: true', async () => {
  const s = setup({ mode: 'local', saved: { mode: 'local', address: '', token: '' } });
  s.c.openPage();
  const r = await s.call('engine-connection:save', { mode: 'remote', address: 'http://192.168.1.10:7300', token: TOKEN, insecure: true });
  assert.equal(r.saved, true);
  assert.deepEqual(s.store.writes.map((w) => [w.mode, w.address, w.insecure]), [['remote', 'http://192.168.1.10:7300', true]]);
});

// ---- insecureAddress edges and the setting's flag (review 1) ---------------------------------------

const insecure = (address) => conn.insecureAddress(conn.parseAddress(address));

test('#480 insecureAddress: IPv6 loopback, an uppercase *.TS.NET name and https need no opt-in', () => {
  const needing = ['http://[::1]:7300', 'http://MY-PC.TAIL1234.TS.NET:7300', 'https://192.168.1.10'].filter((a) => insecure(a) !== null);
  assert.deepEqual(needing, []);
});

test('#480 insecureAddress: just outside Tailscale\'s 100.64.0.0/10 (100.63.x, 100.128.x) needs the opt-in', () => {
  const free = ['http://100.63.255.255:7300', 'http://100.128.0.1:7300'].filter((a) => typeof insecure(a) !== 'string');
  assert.deepEqual(free, []);
});

test('#480 insecureAddress: an address that does not parse is not called insecure (its own error shows)', () => {
  assert.equal(insecure(''), null);
});

test('#480 the page\'s view of the setting shows the opt-in only when it is on, never the token', () => {
  const on = conn.connectionView({ mode: 'remote', address: 'http://192.168.1.10:7300', token: TOKEN, insecure: true });
  assert.equal(on.insecure, true);
  assert.equal(JSON.stringify(on).includes(TOKEN), false);
  assert.equal('insecure' in conn.connectionView({ mode: 'remote', address: 'http://127.0.0.1:7300', token: TOKEN, insecure: false }), false);
});

test('#480 the saved setting drops an insecure flag that is not true', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-connection-480-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, conn.FILE);
  conn.writeConnection(file, { mode: 'remote', address: 'http://127.0.0.1:7300', token: TOKEN, insecure: false });
  assert.equal('insecure' in JSON.parse(fs.readFileSync(file, 'utf8')), false);
  assert.equal('insecure' in conn.readConnection(file), false);
});
