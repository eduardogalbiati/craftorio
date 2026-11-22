// #751 acceptance (tests first): window.api's captureWindow in apps/web/renderer/api-http.js, the api of
// the desktop app's remote engine window and of a browser tab, no longer throws "Capturing the window
// is only available in the desktop app.".
//
// The interface these tests expect (the developer implements it; this file is not edited):
// - The remote window's preload (apps/desktop/host/remote-window-preload.js, contract in
//   apps/desktop/test/host/engine-connection-window-751.test.js) exposes `window.desktopCapture`
//   with `capturePage()` → a PNG data URL. When it is there, api.captureWindow() resolves exactly
//   what it gives (the native capture is preferred), without asking the engine.
// - Without it (a browser tab), captureWindow does the capture in the page (a vendored DOM-to-canvas
//   or getDisplayMedia of the current tab): it never rejects with the desktop-only error. Whether
//   it gives a real picture needs a real DOM: the E2E scenarios check it, not this file.
// api-http.js is loaded as the page does (a vm sandbox, a fake XMLHttpRequest for the manifest,
// a fake WebSocket and fetch at the engine's boundary).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');

const ROOT = path.join(__dirname, '..', '..', '..');
const API_HTTP = path.join(ROOT, 'apps', 'web', 'renderer', 'api-http.js');
const PRELOAD = path.join(ROOT, 'apps', 'desktop', 'host', 'remote-window-preload.js');
const SHOT = 'data:image/png;base64,TkFUSVZF';
const DESKTOP_ONLY = /only available in the desktop app/;

function makeDocument() {
  const el = (tag) => ({
    tagName: String(tag).toUpperCase(), localName: String(tag).toLowerCase(), children: [], dataset: {}, style: {}, attrs: {}, hidden: false, textContent: '', innerHTML: '', className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, removeAttribute(k) { delete this.attrs[k]; },
    append(...n) { this.children.push(...n); }, appendChild(n) { this.children.push(n); return n; }, prepend(...n) { this.children.unshift(...n); },
    remove() {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }),
  });
  return {
    readyState: 'complete', body: el('body'), head: el('head'), documentElement: el('html'), hidden: false, visibilityState: 'visible',
    createElement: el, createTextNode: (t) => ({ textContent: String(t) }),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
  };
}

// api-http.js in a sandbox; `bridge`: the preload's window.desktopCapture (or none: a browser tab)
function loadPage({ bridge = null, remote = !!bridge } = {}) {
  const manifest = (() => { const { DESKTOP } = require('@craftorio/engine/service/manifest'); return DESKTOP; })();
  assert.ok(manifest.some((e) => e.method === 'captureWindow'), 'the manifest still declares captureWindow');
  const posts = [];
  function FakeXHR() { this.readyState = 0; }
  FakeXHR.prototype.open = function open(_m, url) { this.url = url; };
  FakeXHR.prototype.setRequestHeader = function setRequestHeader() {};
  FakeXHR.prototype.send = function send() { this.status = 200; this.readyState = 4; this.responseText = JSON.stringify({ result: manifest, contract: null }); };
  class FakeWebSocket { constructor(url) { this.url = String(url); this.readyState = 0; } send() {} close() {} addEventListener() {} removeEventListener() {} }
  Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  const sandbox = {
    document: makeDocument(),
    location: { protocol: 'http:', host: 'engine.invalid:7300', href: 'http://engine.invalid:7300/apps/web/renderer/index.html', reload() {} },
    navigator: { userAgent: `Mozilla/5.0 Chrome/140${remote ? ' Electron/44.0.0 MultiagentRemoteClient' : ''}`, clipboard: {}, onLine: true },
    XMLHttpRequest: FakeXHR,
    WebSocket: FakeWebSocket,
    fetch: async (url, opts = {}) => {
      posts.push({ url: String(url), arg: opts.body ? JSON.parse(opts.body).arg : null });
      return { ok: false, status: 404, headers: { get: () => 'application/json' }, json: async () => ({ error: 'not here' }), text: async () => '{}' };
    },
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
    URL, queueMicrotask, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    innerWidth: 1000, innerHeight: 500, devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {},
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  if (bridge) sandbox.desktopCapture = bridge;
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_HTTP, 'utf8'), sandbox, { filename: 'api-http.js' });
  return { api: sandbox.window.api, posts };
}

// what the real preload exposes, run with a fake `electron` whose invoke answers SHOT
function preloadBridge() {
  assert.equal(fs.existsSync(PRELOAD), true, 'apps/desktop/host/remote-window-preload.js exists');
  const exposed = {};
  const electron = {
    contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value; } },
    ipcRenderer: { invoke: async () => SHOT, on() {}, send() {} },
  };
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    return request === 'electron' ? electron : original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(PRELOAD)];
    require(PRELOAD);
  } finally {
    Module._load = original;
    delete require.cache[require.resolve(PRELOAD)];
  }
  return exposed;
}

test('#751 api-http.js: with the preload\'s desktopCapture, captureWindow resolves its native capture, without asking the engine', async () => {
  let asked = 0;
  const { api, posts } = loadPage({ bridge: { capturePage: async () => { asked++; return SHOT; } } });
  assert.equal(typeof api.captureWindow, 'function');
  const out = await api.captureWindow();
  assert.equal(out, SHOT);
  assert.equal(asked, 1);
  assert.deepEqual(posts.filter((p) => /capture/.test(p.url)).map((p) => p.url), [], 'no capture request to the engine');
});

test('#751 api-http.js: the real remote-window preload\'s exposure is what captureWindow uses', async () => {
  const exposed = preloadBridge();
  assert.deepEqual(Object.keys(exposed), ['desktopCapture']);
  const { api } = loadPage({ bridge: exposed.desktopCapture });
  assert.equal(await api.captureWindow(), SHOT);
});

test('#751 api-http.js: in a browser tab (no preload) captureWindow is not the desktop-only stub', async () => {
  const { api } = loadPage();
  assert.equal(typeof api.captureWindow, 'function');
  // a real picture needs a real DOM (E2E): here only "it does not refuse as desktop-only" is checked;
  // a capture still pending after 1 s counts as trying
  const outcome = await Promise.race([
    Promise.resolve().then(() => api.captureWindow()).then((v) => ({ ok: true, v }), (e) => ({ ok: false, message: String(e?.message || e) })),
    new Promise((r) => setTimeout(() => r({ pending: true }), 1000)),
  ]);
  if (outcome.ok === false) assert.doesNotMatch(outcome.message, DESKTOP_ONLY);
});
