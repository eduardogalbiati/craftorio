// #625 Project mockups: the mockup editor window's owner in the main process, pure of Electron:
// apps/desktop/host/mockups-window.js
// - createMockupsWindow({ BrowserWindow, dirname, statePath }) → { open({ projectId, slug }), current() }: the
//   main window's preload (dirname/preload.js), contextIsolation true, nodeIntegration false; one window at a time
//   (a second open focuses it); its webContents prevents every will-navigate and will-attach-webview and its
//   window-open handler returns { action: 'deny' };
// - resolveMockupRequest(url, workspace) → <workspace>/mockups/<projectId>/<path> for mockup://<projectId>/<path>,
//   null for traversal ('..', '%2e%2e'), another scheme or a .git path;
// - MOCKUP_CSP: default-src 'none', connect-src 'none', no http:/https: source.
// A fake BrowserWindow (the pattern of agents-window-263.test.js). Acceptance tests, written before the code:
// the module is required inside each test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'host');
const load = () => require('../../host/mockups-window.js');

function create(opts) {
  const mod = load();
  assert.equal(typeof mod.createMockupsWindow, 'function', 'apps/desktop/host/mockups-window.js exports createMockupsWindow (#625)');
  return mod.createMockupsWindow(opts);
}

/** A fake Electron: BrowserWindow records its options, loads and listeners; a test emits its events. */
function fakeElectron() {
  const windows = [];
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.listeners = {};
      this.loads = [];
      this.focused = 0;
      this.destroyed = false;
      this.bounds = { x: 10, y: 10, width: 1200, height: 800 };
      const wcListeners = {};
      this.webContents = {
        listeners: wcListeners,
        send() {},
        on(event, fn) { (wcListeners[event] ||= []).push(fn); return this; },
        once(event, fn) { return this.on(event, fn); },
        emit(event, ...args) { for (const fn of [...(wcListeners[event] || [])]) fn(...args); },
        setWindowOpenHandler(fn) { this.openHandler = fn; },
        openDevTools() {},
      };
      windows.push(this);
    }
    loadFile(file, opts) { this.loads.push([file, opts]); return Promise.resolve(); }
    loadURL(url, opts) { this.loads.push([url, opts]); return Promise.resolve(); }
    on(event, fn) { (this.listeners[event] ||= []).push(fn); return this; }
    once(event, fn) { return this.on(event, fn); }
    emit(event, ...args) { for (const fn of [...(this.listeners[event] || [])]) fn({ preventDefault() {} }, ...args); if (event === 'closed') this.destroyed = true; }
    focus() { this.focused++; }
    show() {}
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    restore() {}
    getBounds() { return this.bounds; }
    setMenuBarVisibility() {}
    removeMenu() {}
  }
  return { BrowserWindow, windows };
}

function statePathIn(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-window-625-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'mockups-window.json');
}

function opened(t) {
  const { BrowserWindow, windows } = fakeElectron();
  const mw = create({ BrowserWindow, dirname: SRC, statePath: statePathIn(t) });
  mw.open({ projectId: 'p1', slug: 'home' });
  return { mw, windows };
}
const fakeEvent = () => ({ prevented: false, preventDefault() { this.prevented = true; } });

// ---- createMockupsWindow -----------------------------------------------------------------------

test('#625 open() creates one window with the main window\'s preload, contextIsolation and no nodeIntegration', (t) => {
  const { windows } = opened(t);
  assert.equal(windows.length, 1);
  const prefs = windows[0].options.webPreferences;
  assert.deepEqual([prefs.preload, prefs.contextIsolation, prefs.nodeIntegration], [path.join(SRC, 'preload.js'), true, false]);
});

test('#625 a second open() focuses the live window instead of creating another', (t) => {
  const { mw, windows } = opened(t);
  mw.open({ projectId: 'p1', slug: 'settings' });
  assert.deepEqual([windows.length, windows[0].focused >= 1], [1, true]);
});

test('#625 current() is the live window', (t) => {
  const { mw, windows } = opened(t);
  assert.equal(mw.current() === windows[0], true);
});

test('#625 the editor window prevents will-navigate', (t) => {
  const { windows } = opened(t);
  const ev = fakeEvent();
  windows[0].webContents.emit('will-navigate', ev, 'file:///C:/tmp/x.html');
  assert.equal(ev.prevented, true);
});

test('#625 the editor window prevents will-attach-webview', (t) => {
  const { windows } = opened(t);
  const ev = fakeEvent();
  windows[0].webContents.emit('will-attach-webview', ev, {}, {});
  assert.equal(ev.prevented, true);
});

test('#625 the editor window denies every new window', (t) => {
  const { windows } = opened(t);
  const handler = windows[0].webContents.openHandler;
  assert.equal(typeof handler, 'function', 'no window-open handler');
  assert.deepEqual(handler({ url: 'mockup://p1/screens/home/index.html' }), { action: 'deny' });
});

// ---- resolveMockupRequest ----------------------------------------------------------------------

const WS = path.join(os.tmpdir(), 'ws-625');

test('#625 resolveMockupRequest maps mockup://<projectId>/<path> into <workspace>/mockups/<projectId>/', () => {
  assert.equal(load().resolveMockupRequest('mockup://p1/screens/home/index.html', WS), path.join(WS, 'mockups', 'p1', 'screens', 'home', 'index.html'));
});

test('#625 resolveMockupRequest refuses a traversal, plain or percent-encoded', () => {
  const { resolveMockupRequest } = load();
  assert.deepEqual([
    resolveMockupRequest('mockup://p1/../p2/screens/a/index.html', WS),
    resolveMockupRequest('mockup://p1/screens/%2e%2e/%2e%2e/%2e%2e/secret.txt', WS),
  ], [null, null]);
});

test('#625 resolveMockupRequest refuses another scheme', () => {
  assert.equal(load().resolveMockupRequest('https://p1/screens/home/index.html', WS), null);
});

test('#625 resolveMockupRequest refuses a .git path', () => {
  assert.equal(load().resolveMockupRequest('mockup://p1/.git/config', WS), null);
});

// ---- MOCKUP_CSP --------------------------------------------------------------------------------

test('#625 MOCKUP_CSP blocks every source and the network, with no http: or https: source', () => {
  const csp = load().MOCKUP_CSP;
  assert.deepEqual([csp.includes("default-src 'none'"), csp.includes("connect-src 'none'"), /https?:/.test(csp)], [true, true, false]);
});

// ---- serveMockup: what protocol.handle('mockup') answers (D6, D7, D11) ---------------------------

const MODULE = require.resolve('../../host/mockups-window.js');
const PAGE = '<!doctype html><html><head><title>Orders</title></head><body><main data-mid="m1">Orders</main></body></html>';

function servedWorkspace(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-ws-625-'));
  const dir = path.join(ws, 'mockups', 'p1', 'screens', 'orders');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), PAGE);
  fs.mkdirSync(path.join(ws, 'mockups', 'p1', 'kit'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'mockups', 'p1', 'kit', 'tokens.css'), ':root { --primary: #1a73e8; }');
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  return ws;
}

// a fresh copy of the module (its axe script is cached once per process)
function fresh(t, { noAxe = false } = {}) {
  const Module = require('module');
  delete require.cache[MODULE];
  if (noAxe) {
    const original = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (String(request).startsWith('axe-core')) { const e = new Error(`Cannot find module '${request}'`); e.code = 'MODULE_NOT_FOUND'; throw e; }
      return original.call(this, request, ...rest);
    };
    t.after(() => { Module._resolveFilename = original; });
  }
  t.after(() => { delete require.cache[MODULE]; });
  return require(MODULE);
}

test('#625 serveMockup serves a screen with the CSP and the inspector, then the axe script, before </body>', async (t) => {
  const ws = servedWorkspace(t);
  const { serveMockup, MOCKUP_CSP } = fresh(t);
  const res = await serveMockup('mockup://p1/screens/orders/index.html', ws);
  const body = String(res.body);
  const inspectorAt = body.indexOf('mockup:select');
  const axeAt = body.indexOf('mockup:axe');
  assert.deepEqual([res.status, res.headers['content-security-policy'] === MOCKUP_CSP, /text\/html/.test(res.headers['content-type'])], [200, true, true]);
  assert.deepEqual([body.includes('<main data-mid="m1">Orders</main>'), inspectorAt > 0, axeAt > inspectorAt, body.includes('window.axe.run')], [true, true, true, true]);
  assert.equal(body.lastIndexOf('</body>') > axeAt, true, 'the scripts go before </body>');
});

test('#625 serveMockup without axe-core installed serves the screen with only the inspector', async (t) => {
  const ws = servedWorkspace(t);
  const { serveMockup } = fresh(t, { noAxe: true });
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
  const res = await serveMockup('mockup://p1/screens/orders/index.html', ws);
  const body = String(res.body);
  assert.deepEqual([res.status, body.includes('mockup:select'), body.includes('mockup:axe'), body.includes('window.axe')], [200, true, false, false]);
});

test('#625 serveMockup serves a stylesheet as is, with the CSP', async (t) => {
  const ws = servedWorkspace(t);
  const { serveMockup, MOCKUP_CSP } = fresh(t);
  const res = await serveMockup('mockup://p1/kit/tokens.css', ws);
  assert.deepEqual([res.status, String(res.body), /text\/css/.test(res.headers['content-type']), res.headers['content-security-policy'] === MOCKUP_CSP],
    [200, ':root { --primary: #1a73e8; }', true, true]);
});

test('#625 serveMockup answers 404 for a missing file, a traversal or a .git path', async (t) => {
  const ws = servedWorkspace(t);
  const { serveMockup } = fresh(t);
  const statuses = [];
  for (const url of ['mockup://p1/screens/nope/index.html', 'mockup://p1/../secret.txt', 'mockup://p1/.git/config']) statuses.push((await serveMockup(url, ws)).status);
  assert.deepEqual(statuses, [404, 404, 404]);
});
