// #751 acceptance (tests first): the desktop app's remote engine window (apps/desktop/host/engine-connection-window.js)
// gets a minimal preload exposing the native window capture, and nothing else, so the Findings
// overlay (and the release city's Save image) capture the remote window's real pixels.
//
// The interface these tests expect (the developer implements it; this file is not edited):
// - The remote window's webPreferences.preload is `<dirname>/remote-window-preload.js`; the window
//   stays isolated: contextIsolation true, nodeIntegration false, sandbox true, its own partition.
//   (#746's clipboard needs no preload: it goes through the session's web permissions, so this
//   preload exposes the capture only.)
// - apps/desktop/host/remote-window-preload.js requires only `electron` (sandboxed) and calls
//   contextBridge.exposeInMainWorld('desktopCapture', { capturePage }) once: capturePage() →
//   ipcRenderer.invoke(<one channel>) → the window's PNG data URL. No ipcRenderer, no other key.
// - createEngineConnection registers that channel on ipcMain and answers it only for the remote
//   window's own webContents (e.sender.capturePage() → toDataURL()); another sender is refused.
// The preload is a file the change creates: it is required inside each test, never at load.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');
const conn = require('../../host/engine-connection');
const { createEngineConnection } = require('../../host/engine-connection-window');

const HOST_DIR = path.join(__dirname, '..', '..', 'host');
const PRELOAD = 'remote-window-preload.js';
const TOKEN = 'tok-0123456789abcdef';
const URL_ = 'http://my-pc.tail1234.ts.net:7300';
const HOST = 'my-pc.tail1234.ts.net:7300';
const SHOT = 'data:image/png;base64,UkVNT1RF';

function fakeElectron() {
  const windows = [];
  class FakeContents extends EventEmitter {
    constructor() { super(); this.sent = []; this.captures = 0; }
    setWindowOpenHandler(fn) { this.openHandler = fn; }
    send(channel) { this.sent.push(channel); }
    getURL() { return this.url || ''; }
    async capturePage() { this.captures++; return { toDataURL: () => SHOT, toPNG: () => Buffer.from('png'), isEmpty: () => false }; }
  }
  class FakeWindow extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.webContents = new FakeContents(); this.destroyed = false; windows.push(this); }
    loadURL(u) { this.loadedUrl = u; }
    loadFile(f, options) { this.loadedFile = f; this.loadOptions = options; }
    isDestroyed() { return this.destroyed; }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('closed'); }
    close() { this.destroy(); }
    getBounds() { return { x: 0, y: 0, width: this.opts.width || 0, height: this.opts.height || 0 }; }
    isMinimized() { return false; }
    restore() {}
    focus() {}
  }
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn), on: (channel, fn) => handlers.set(channel, fn) };
  const shell = { opened: [], openExternal(u) { this.opened.push(u); } };
  const ses = {
    ua: 'Mozilla/5.0 Chrome/140 Electron/44.0.0',
    getUserAgent() { return this.ua; },
    setUserAgent(u) { this.ua = u; },
    setPermissionRequestHandler(fn) { this.request = fn; },
    setPermissionCheckHandler(fn) { this.check = fn; },
  };
  const session = { fromPartition: () => ses };
  return { BrowserWindow: FakeWindow, windows, handlers, ipcMain, shell, session };
}

async function remoteWindow() {
  const e = fakeElectron();
  const store = { value: { mode: 'remote', address: URL_, token: TOKEN }, read() { return { ...this.value }; }, write(c) { this.value = { ...c }; } };
  const c = createEngineConnection({
    ...e,
    dirname: path.join('app', 'apps', 'desktop', 'host'),
    store,
    version: { app: '9.9.9', contract: 'abc123' },
    mode: 'remote',
    windowOptions: { width: 1500, height: 950, title: 'Craftorio' },
    relaunch: () => {},
    fetch: async () => ({ status: 200, ok: true, json: async () => ({ app: '9.9.9', contract: 'abc123' }) }),
  });
  await c.startRemote({ mode: 'remote', url: URL_, host: HOST, token: TOKEN, address: URL_ });
  const w = e.windows.find((x) => x.loadedUrl && !x.destroyed);
  assert.ok(w, 'the remote window is open');
  return { e, c, w };
}

// the preload run as Electron would, with a fake `electron`: what it exposes, what it invokes
function loadPreload() {
  const file = path.join(HOST_DIR, PRELOAD);
  assert.equal(fs.existsSync(file), true, `apps/desktop/host/${PRELOAD} exists`);
  const exposed = [];
  const invoked = [];
  const required = [];
  const ipcRenderer = {
    invoke: async (channel, ...args) => { invoked.push({ channel: String(channel), args: JSON.parse(JSON.stringify(args)) }); return SHOT; },
    on() { throw new Error('the capture preload listens to nothing'); },
    send() { throw new Error('the capture preload sends nothing'); },
  };
  const electron = { contextBridge: { exposeInMainWorld: (key, value) => exposed.push({ key: String(key), value }) }, ipcRenderer };
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (parent && parent.filename === file) required.push(String(request));
    if (request === 'electron') return electron;
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(file)];
    require(file);
  } finally {
    Module._load = original;
    delete require.cache[require.resolve(file)];
  }
  return { exposed, invoked, required };
}

// ---------- 1. the remote window has the capture preload, and stays isolated ----------

test('#751 the remote engine window loads the capture preload, isolated, without Node, sandboxed, in its own session', async () => {
  const { w } = await remoteWindow();
  const prefs = w.opts.webPreferences;
  assert.equal(prefs.preload, path.join('app', 'apps', 'desktop', 'host', PRELOAD));
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.partition, conn.PARTITION);
  assert.equal(prefs.nodeIntegrationInSubFrames === true, false, 'no Node in subframes either');
});

test('#751 the capture preload exposes one world key, desktopCapture, with capturePage only', () => {
  const { exposed, required } = loadPreload();
  assert.deepEqual(exposed.map((x) => x.key), ['desktopCapture']);
  const bridge = exposed[0].value;
  assert.deepEqual(Object.keys(bridge).sort(), ['capturePage']);
  assert.equal(typeof bridge.capturePage, 'function');
  assert.deepEqual([...new Set(required)], ['electron'], 'a sandboxed preload requires electron only');
});

test('#751 desktopCapture.capturePage() invokes one channel and resolves the PNG data URL', async () => {
  const { exposed, invoked } = loadPreload();
  const out = await exposed[0].value.capturePage();
  assert.equal(out, SHOT);
  assert.equal(invoked.length, 1);
  assert.equal(invoked[0].channel.length > 0, true);
});

// ---------- the main process answers the capture for the remote window only ----------

test('#751 the main process answers the preload\'s capture channel with the remote window\'s pixels', async () => {
  const { exposed, invoked } = loadPreload();
  await exposed[0].value.capturePage();
  const channel = invoked[0]?.channel || null;
  const { e, w } = await remoteWindow();
  assert.ok(channel, 'the preload\'s channel');
  const handler = e.handlers.get(channel);
  assert.equal(typeof handler, 'function', `createEngineConnection handles ${channel} (handled: ${[...e.handlers.keys()].join(', ')})`);
  const out = await handler({ sender: w.webContents, senderFrame: { url: `${URL_}/` } });
  assert.equal(out, SHOT);
  assert.equal(w.webContents.captures, 1, 'the remote window itself was captured');
});

test('#751 the capture channel refuses a sender that is not the remote window', async () => {
  const { exposed, invoked } = loadPreload();
  await exposed[0].value.capturePage();
  const channel = invoked[0].channel;
  const { e, w } = await remoteWindow();
  const handler = e.handlers.get(channel);
  assert.equal(typeof handler, 'function', `createEngineConnection handles ${channel}`);
  const stranger = new e.BrowserWindow({}).webContents;
  await assert.rejects(async () => handler({ sender: stranger, senderFrame: { url: 'https://evil.example/' } }));
  assert.equal(stranger.captures, 0, 'the other window was not captured');
  assert.equal(w.webContents.captures, 0, 'nor the remote one');
});
