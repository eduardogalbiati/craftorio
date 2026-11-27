// #110 acceptance, written before the code: the engine connection page (apps/desktop/renderer/connection/connection.js,
// opened by Settings › Execution › Engine › Change…) in pt-BR shows the connection test's refusal in English: the
// main process's testConnection (apps/desktop/host/engine-connection.js) answers { ok: false, reason, message } with
// an English message ("my-pc:7300 refused the connection: …", "… refused the token: …") and the page shows it as it came.
// The page runs in a vm with a tiny fake DOM; window.connection.test answers what testConnection answers for a
// refused connection and a refused token (an injected fetch, no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const conn = require('../../host/engine-connection');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'connection', 'connection.js'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

const refused = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
const badToken = async () => ({ status: 401, ok: false, json: async () => ({}) });

function element() {
  return {
    textContent: '', value: '', checked: false, disabled: false, hidden: false, placeholder: '', title: '', dataset: {}, listeners: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    focus() {}, select() {},
  };
}

// the page in `lang`, its Test connection pressed with an address and a token → the result line's text
async function testResult(lang, fetchImpl) {
  const I18n = require('@craftorio/shared/i18n');
  const els = new Map();
  const el = (sel) => { if (!els.has(sel)) els.set(sel, element()); return els.get(sel); };
  const answer = (address, token) => conn.testConnection({ address, token, fetch: fetchImpl, timeoutMs: 1000 });
  const sandbox = {
    console, URLSearchParams,
    location: { search: `?lang=${lang}` },
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: el, querySelectorAll: () => [], addEventListener() {}, documentElement: {}, title: '' },
    I18n,
    t: (...a) => I18n.t(...a),
    connection: {
      state: async () => ({ mode: 'local', saved: { mode: 'local', address: '', hasToken: false }, app: '1.0.0', failure: null, alone: false }),
      check: async () => ({ insecure: false }),
      test: async (address, token) => answer(address, token),
      save: async () => ({ saved: false }),
      retry: async () => ({ ok: true }),
      close: async () => true,
      onChanged() {},
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  for (let i = 0; i < 5; i++) await tick();
  el('#cn-address').value = 'my-pc';
  el('#cn-token').value = 'secret-token';
  for (const fn of el('#cn-test').listeners.click || []) await fn({ type: 'click' });
  for (let i = 0; i < 5; i++) await tick();
  return String(el('#cn-result').textContent || '');
}

test.afterEach(() => require('@craftorio/shared/i18n').setLanguage('en'));

test('#110 connection page in pt-BR: a refused connection reads in Portuguese, naming the engine\'s address', async () => {
  const shown = await testResult('pt-BR', refused);
  assert.notEqual(shown, '', 'the result is shown');
  assert.equal(/refused the connection|nothing listens|Start the engine/.test(shown), false, shown);
  assert.equal(shown.includes('my-pc'), true, shown);
});

test('#110 connection page in pt-BR: a refused token reads in Portuguese', async () => {
  const shown = await testResult('pt-BR', badToken);
  assert.notEqual(shown, '', 'the result is shown');
  assert.equal(/refused the token|copy CRAFTORIO_SERVER_TOKEN from/.test(shown), false, shown);
});

test('#110 guard: in English the refusal reads as the engine connection says it', async () => {
  const shown = await testResult('en', refused);
  assert.match(shown, /my-pc:7300 refused the connection/);
});

// ---- the remote engine failed: the page's failure line (#cn-failure-text), at the app's start and on Retry ----
// The main process is the real one (engine-connection-window.js createEngineConnection) with a fake Electron, as
// engine-connection-window.test.js drives it; the page's window.connection calls its channels.
const { EventEmitter } = require('events');
const { createEngineConnection } = require('../../host/engine-connection-window');

const URL_ = 'http://my-pc.tail1234.ts.net:7300';

function fakeElectron() {
  const windows = [];
  class FakeContents extends EventEmitter {
    setWindowOpenHandler() {}
    send() {}
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
  const ses = { getUserAgent: () => 'Chrome/140', setUserAgent() {}, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} };
  return {
    BrowserWindow: FakeWindow, windows, handlers,
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    shell: { openExternal() {} },
    session: { fromPartition: () => ses },
  };
}

// the app started on a remote engine that `startFetch` answers, the page in `lang`; Retry then answers `retryFetch`
// → { start, retried }: the failure line's text at the start and after Retry
async function failureLines(lang, startFetch, retryFetch) {
  const I18n = require('@craftorio/shared/i18n');
  let fetchImpl = startFetch;
  const e = fakeElectron();
  const saved = { mode: 'remote', address: URL_, token: 'tok-0123456789abcdef' };
  const c = createEngineConnection({
    ...e, dirname: path.join('app', 'apps', 'desktop', 'host'),
    store: { read: () => ({ ...saved }), write() {} },
    version: { app: '9.9.9', contract: 'abc123' }, mode: 'remote',
    windowOptions: { width: 1500, height: 950, title: 'Craftorio' },
    mainWindow: () => null, prepareRestart() {}, relaunch() {}, quit() {}, screen: null,
    fetch: (...a) => fetchImpl(...a),
  });
  await c.startRemote({ mode: 'remote', url: URL_, host: 'my-pc.tail1234.ts.net:7300', token: saved.token, address: URL_ });
  const page = e.windows.find((w) => w.loadedFile && !w.destroyed);
  assert.equal(!!page, true, 'the connection page opens with why');
  const call = (channel, arg) => e.handlers.get(channel)({ sender: page.webContents }, arg);

  const els = new Map();
  const el = (sel) => { if (!els.has(sel)) els.set(sel, element()); return els.get(sel); };
  const sandbox = {
    console, URLSearchParams,
    location: { search: `?lang=${lang}` },
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: el, querySelectorAll: () => [], addEventListener() {}, documentElement: {}, title: '' },
    I18n,
    t: (...a) => I18n.t(...a),
    connection: {
      state: async () => call('engine-connection:state'),
      check: async (address) => call('engine-connection:check', { address }),
      test: async (address, token, insecure) => call('engine-connection:test', { address, token, insecure }),
      save: async () => ({ saved: false }),
      retry: async () => call('engine-connection:retry'),
      close: async () => true,
      onChanged() {},
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  for (let i = 0; i < 5; i++) await tick();
  const start = String(el('#cn-failure-text').textContent || '');
  fetchImpl = retryFetch;
  for (const fn of el('#cn-retry').listeners.click || []) await fn({ type: 'click' });
  for (let i = 0; i < 5; i++) await tick();
  return { start, retried: String(el('#cn-failure-text').textContent || '') };
}

test('#110 connection page in pt-BR: the remote engine\'s failure at start and on Retry reads in Portuguese', async () => {
  const { start, retried } = await failureLines('pt-BR', refused, badToken);
  assert.notEqual(start, '', 'the failure at start is shown');
  assert.equal(/refused the connection|nothing listens|Start the engine/.test(start), false, start);
  assert.equal(start.includes('recusou a conexão'), true, start);
  assert.notEqual(retried, '', 'the failure on Retry is shown');
  assert.equal(/refused the token|copy CRAFTORIO_SERVER_TOKEN from/.test(retried), false, retried);
  assert.equal(retried.includes('recusou o token'), true, retried);
});

test('#110 guard: in English the remote engine\'s failure at start and on Retry reads as the main process says it', async () => {
  const { start, retried } = await failureLines('en', refused, badToken);
  assert.match(start, /refused the connection/);
  assert.match(retried, /refused the token/);
});
