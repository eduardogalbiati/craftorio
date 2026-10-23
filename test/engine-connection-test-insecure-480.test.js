// #480: the connection page's Test follows Save's rule, and the page asks the main process whether an
// address needs the insecure opt-in (engine-connection:check, the one insecureAddress rule). Without
// the opt-in, Test of a plain-http LAN address never contacts the engine, so the saved token is not
// sent in clear text.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');
const { createEngineConnection } = require('../src/engine-connection-window');

const TOKEN = 'tok-0123456789abcdef';
const LAN = 'http://192.168.1.10:7300';

function setup() {
  const windows = [];
  class FakeWindow extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; this.destroyed = false; windows.push(this); }
    loadURL(u) { this.loadedUrl = u; }
    loadFile(f) { this.loadedFile = f; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    close() { this.destroy(); }
    getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
    isMinimized() { return false; }
    restore() {}
    focus() {}
  }
  const handlers = new Map();
  const ses = { getUserAgent: () => 'UA', setUserAgent() {}, setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeSendHeaders() {} } };
  const fetched = [];
  const main = new FakeWindow({ main: true });
  const c = createEngineConnection({
    BrowserWindow: FakeWindow,
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    shell: { openExternal() {} },
    session: { fromPartition: () => ses },
    dirname: path.join('app', 'src'),
    store: { read: () => ({ mode: 'local', address: LAN, token: TOKEN }), write() {} },
    version: { app: '9.9.9', contract: 'abc123' },
    mode: 'local',
    windowOptions: {},
    mainWindow: () => main,
    prepareRestart() {},
    relaunch() {},
    quit() {},
    fetch: async (...a) => { fetched.push(a); return { status: 200, ok: true, json: async () => ({ app: '9.9.9', contract: 'abc123' }) }; },
  });
  c.openPage();
  const page = windows.find((w) => w.loadedFile);
  const call = (channel, arg) => handlers.get(channel)({ sender: page.webContents }, arg);
  return { call, fetched };
}

test('#480 Test of a plain-http LAN address without the opt-in is refused before the engine is contacted', async () => {
  const s = setup();
  const r = await s.call('engine-connection:test', { address: LAN, token: '' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insecure');
  assert.match(r.message, /not encrypted/);
  assert.deepEqual(s.fetched, [], 'no request, so the saved token never goes out');
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});

test('#480 Test with the opt-in contacts the engine', async () => {
  const s = setup();
  const r = await s.call('engine-connection:test', { address: LAN, token: '', insecure: true });
  assert.equal(r.ok, true);
  assert.equal(s.fetched.length, 1);
});

test('#480 engine-connection:check answers the main process rule for the page', async () => {
  const s = setup();
  assert.match((await s.call('engine-connection:check', { address: LAN })).insecure, /not encrypted/);
  for (const ok of ['http://localhost:7300', 'http://100.101.102.103:7300', 'my-pc.tail1234.ts.net', 'https://192.168.1.10:7300', '']) {
    assert.equal((await s.call('engine-connection:check', { address: ok })).insecure, null, ok);
  }
});
