// The engine connection's windows (src/engine-connection-window.js) with a fake Electron: in remote
// mode the engine is tested before its window opens; the window loads `<url>/?token=` with no preload
// in its own sandboxed session; leaving the engine's origin, a refused token or a page that does not
// load shows the connection page; the page's channels answer only that page, never give the token
// back, test before saving, and refuse to switch while runs are in progress here.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');
const conn = require('../src/engine-connection');
const { createEngineConnection } = require('../src/engine-connection-window');

const TOKEN = 'tok-0123456789abcdef';
const URL_ = 'http://my-pc:7300';

function fakeElectron() {
  const windows = [];
  class FakeContents extends EventEmitter {
    constructor() { super(); this.sent = []; this.openHandler = null; }
    setWindowOpenHandler(fn) { this.openHandler = fn; }
    send(channel) { this.sent.push(channel); }
    getURL() { return this.url || ''; }
  }
  class FakeWindow extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.webContents = new FakeContents(); this.destroyed = false; windows.push(this); }
    loadURL(u) { this.loadedUrl = u; }
    loadFile(f, options) { this.loadedFile = f; this.loadOptions = options; }
    isDestroyed() { return this.destroyed; }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('closed'); }
    // the window's X (or BrowserWindow.close()): closed like a destroy here
    close() { this.destroy(); }
    getBounds() { return { x: 0, y: 0, width: this.opts.width || 0, height: this.opts.height || 0 }; }
    isMinimized() { return false; }
    restore() {}
    focus() { this.focused = true; }
  }
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const shell = { opened: [], openExternal(u) { this.opened.push(u); } };
  const ses = {
    ua: 'Mozilla/5.0 Chrome/140 Electron/44.0.0',
    getUserAgent() { return this.ua; },
    setUserAgent(u) { this.ua = u; },
    setPermissionRequestHandler(fn) { this.request = fn; },
    setPermissionCheckHandler(fn) { this.check = fn; },
  };
  const session = { partitions: [], fromPartition(p) { this.partitions.push(p); return ses; } };
  return { BrowserWindow: FakeWindow, windows, handlers, ipcMain, shell, session, ses };
}

const engineAnswer = (status, body) => async () => ({ status, ok: status === 200, json: async () => body });
const ENGINE_OK = engineAnswer(200, { app: '9.9.9', contract: 'abc123' });

function setup({ mode = 'remote', saved = { mode: 'remote', address: URL_, token: TOKEN }, fetch = ENGINE_OK, prepareRestart = () => {}, screen = null } = {}) {
  const e = fakeElectron();
  const store = { value: { ...saved }, writes: [], read() { return { ...this.value }; }, write(c) { this.writes.push(c); this.value = { ...c }; } };
  const relaunched = [];
  const quits = [];
  const main = mode === 'local' ? new e.BrowserWindow({ main: true }) : null;
  const c = createEngineConnection({
    ...e,
    dirname: path.join('app', 'src'),
    store,
    version: { app: '9.9.9', contract: 'abc123' },
    mode,
    windowOptions: { width: 1500, height: 950, backgroundColor: '#0e1014', title: 'Multiagent Orchestrator' },
    mainWindow: () => main,
    prepareRestart,
    relaunch: () => relaunched.push(true),
    quit: () => quits.push(true),
    screen,
    fetch,
  });
  const pageOf = () => e.windows.find((w) => w.loadedFile && !w.destroyed);
  const remoteOf = () => e.windows.find((w) => w.loadedUrl && !w.destroyed);
  // calls a page channel as the page would (or as `sender`)
  const call = (channel, arg, sender = pageOf()?.webContents) => e.handlers.get(channel)({ sender }, arg);
  return { e, c, store, relaunched, quits, main, pageOf, remoteOf, call };
}

const decision = (over = {}) => ({ mode: 'remote', url: URL_, host: 'my-pc:7300', token: TOKEN, address: URL_, ...over });
const navEvent = () => ({ prevented: false, preventDefault() { this.prevented = true; } });

test('remote mode: the engine answers, its window loads <url>/?token= with no preload, isolated and sandboxed, in its own session', async () => {
  const s = setup();
  await s.c.startRemote(decision());
  const w = s.remoteOf();
  assert.ok(w, 'the remote window is open');
  assert.equal(w.loadedUrl, `${URL_}/?token=${TOKEN}`);
  const prefs = w.opts.webPreferences;
  assert.equal(prefs.preload, undefined, 'no preload for remote content');
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.partition, conn.PARTITION);
  assert.match(w.opts.title, /engine on my-pc:7300/);
  assert.match(s.e.ses.ua, new RegExp(`${conn.CLIENT_MARK}$`), 'the page can tell it is inside the desktop app');
  assert.equal(s.pageOf(), undefined, 'no connection page');
  // the clipboard only, for the engine's origin
  let granted = null;
  s.e.ses.request(null, 'clipboard-sanitized-write', (ok) => { granted = ok; }, { requestingUrl: `${URL_}/src/renderer/index.html` });
  assert.equal(granted, true);
  s.e.ses.request(null, 'media', (ok) => { granted = ok; }, { requestingUrl: `${URL_}/` });
  assert.equal(granted, false);
});

test('remote mode: an engine that cannot be reached shows the connection page with why, and no remote window', async () => {
  const s = setup({ fetch: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); } });
  await s.c.startRemote(decision());
  assert.equal(s.remoteOf(), undefined);
  const page = s.pageOf();
  assert.ok(page, 'the connection page is open');
  assert.equal(page.loadedFile, path.join('app', 'src', 'renderer', 'connection', 'connection.html'));
  assert.equal(page.opts.webPreferences.preload, path.join('app', 'src', 'engine-connection-preload.js'));
  assert.equal(page.opts.webPreferences.sandbox, true);
  assert.equal(page.opts.parent, undefined, 'on its own: there is no other window');
  const state = await s.call('engine-connection:state');
  assert.equal(state.failure.reason, 'unreachable');
  assert.match(state.failure.message, /refused the connection/);
  assert.equal(state.remoteHost, null);
});

test('remote mode: an unusable setting goes straight to the connection page', async () => {
  let asked = 0;
  const s = setup({ fetch: async () => { asked++; return ENGINE_OK(); } });
  await s.c.startRemote(decision({ error: 'No token is saved for the remote engine: type it again.' }));
  assert.equal(asked, 0);
  assert.equal((await s.call('engine-connection:state')).failure.reason, 'setting');
});

test('the remote window keeps to the engine\'s origin: other sites go to the system browser, the connection path opens the page', async () => {
  const s = setup();
  await s.c.startRemote(decision());
  const w = s.remoteOf();
  const same = navEvent();
  w.webContents.emit('will-navigate', same, `${URL_}/src/renderer/index.html`);
  assert.equal(same.prevented, false);
  const away = navEvent();
  w.webContents.emit('will-navigate', away, 'https://github.com/x/y/pull/1');
  assert.equal(away.prevented, true);
  assert.deepEqual(s.e.shell.opened, ['https://github.com/x/y/pull/1']);
  const file = navEvent();
  w.webContents.emit('will-navigate', file, 'file:///C:/secret.txt');
  assert.equal(file.prevented, true);
  assert.equal(s.e.shell.opened.length, 1);
  const redirectHome = navEvent();
  w.webContents.emit('will-redirect', redirectHome, `${URL_}/src/renderer/index.html`);
  assert.equal(redirectHome.prevented, false);
  const redirectAway = navEvent();
  w.webContents.emit('will-redirect', redirectAway, 'http://elsewhere.example/');
  assert.equal(redirectAway.prevented, true);
  assert.equal(s.e.shell.opened.length, 1, 'a redirect never opens the browser');

  assert.deepEqual(w.webContents.openHandler({ url: 'https://example.com/' }), { action: 'deny' });
  assert.deepEqual(s.e.shell.opened, ['https://github.com/x/y/pull/1', 'https://example.com/']);
  assert.deepEqual(w.webContents.openHandler({ url: `${URL_}${conn.CONNECTION_PATH}` }), { action: 'deny' });
  const page = s.pageOf();
  assert.ok(page, 'Change… on the engine\'s page opens the connection page');
  assert.equal(page.opts.parent, w, 'over the remote window');
  assert.equal(page.opts.modal, true);
  assert.equal((await s.call('engine-connection:state')).remoteHost, 'my-pc:7300');
  // asked again: the same page comes forward and reads its state again
  w.webContents.openHandler({ url: `${URL_}${conn.CONNECTION_PATH}` });
  assert.equal(s.e.windows.filter((x) => x.loadedFile).length, 1);
  assert.deepEqual(page.webContents.sent, ['engine-connection:changed']);
});

test('a refused token or a page that does not load replaces the remote window with the connection page', async () => {
  const s = setup();
  await s.c.startRemote(decision());
  const w = s.remoteOf();
  w.webContents.emit('did-navigate', {}, `${URL_}/`, 401);
  assert.equal(w.destroyed, true);
  assert.equal((await s.call('engine-connection:state')).failure.reason, 'token');

  const t = setup();
  await t.c.startRemote(decision());
  const w2 = t.remoteOf();
  w2.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', URL_, true);
  assert.equal(w2.destroyed, false, 'an aborted navigation is not a failure');
  w2.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', URL_, false);
  assert.equal(w2.destroyed, false, 'a frame of the page is not the page');
  w2.webContents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', URL_, true);
  assert.equal(w2.destroyed, true);
  assert.ok(t.pageOf());
  assert.match((await t.call('engine-connection:state')).failure.message, /ERR_CONNECTION_REFUSED/);
});

test('Retry opens the engine\'s window when it answers again, and keeps the page with the new reason when not', async () => {
  let up = false;
  const s = setup({ fetch: async () => (up ? ENGINE_OK() : engineAnswer(401, { error: 'no' })()) });
  await s.c.startRemote(decision());
  const page = s.pageOf();
  const still = await s.call('engine-connection:retry');
  assert.equal(still.ok, false);
  assert.equal(still.failure.reason, 'token');
  assert.equal(s.remoteOf(), undefined);
  up = true;
  const r = await s.call('engine-connection:retry', undefined, page.webContents);
  assert.equal(r.ok, true);
  assert.ok(s.remoteOf());
  assert.equal(page.destroyed, true);
  assert.deepEqual(s.quits, [], 'the page that made way for the engine\'s window does not quit the app');
});

test('the page\'s channels answer only the page, and never give the token back', async () => {
  const s = setup();
  await s.c.startRemote(decision());
  assert.throws(() => s.call('engine-connection:state', undefined, s.remoteOf().webContents), /Only the engine connection page/);
  s.remoteOf().webContents.openHandler({ url: `${URL_}${conn.CONNECTION_PATH}` });
  const state = await s.call('engine-connection:state');
  assert.deepEqual(state.saved, { mode: 'remote', address: URL_, hasToken: true });
  assert.equal(state.mode, 'remote');
  assert.equal(state.app, '9.9.9');
  assert.ok(!JSON.stringify(state).includes(TOKEN));
  const tested = await s.call('engine-connection:test', { address: URL_, token: '' });
  assert.equal(tested.ok, true, 'a blank token tests with the saved one');
  assert.ok(!JSON.stringify(tested).includes(TOKEN));
});

test('local mode: Save tests the engine, then saves it with its token and restarts; a failed test saves nothing', async () => {
  let reply = engineAnswer(401, { error: 'Missing or invalid token' });
  const s = setup({ mode: 'local', saved: { mode: 'local', address: '', token: '' }, fetch: async (...a) => reply(...a) });
  s.c.openPage();
  const page = s.pageOf();
  assert.equal(page.opts.parent, s.main, 'over the main window');
  const refused = await s.call('engine-connection:save', { mode: 'remote', address: 'my-pc', token: 'wrong-token-0123456789' });
  assert.equal(refused.saved, false);
  assert.equal(refused.test.reason, 'token');
  assert.deepEqual(s.store.writes, []);
  assert.deepEqual(s.relaunched, []);

  reply = ENGINE_OK;
  const ok = await s.call('engine-connection:save', { mode: 'remote', address: 'my-pc', token: ` ${TOKEN} ` });
  assert.deepEqual([ok.saved, ok.restarting, ok.test.ok], [true, true, true]);
  assert.deepEqual(s.store.writes, [{ mode: 'remote', address: URL_, token: TOKEN }]);
  assert.equal(s.relaunched.length, 1);
});

test('local mode: runs in progress here refuse the switch before anything is saved', async () => {
  const s = setup({ mode: 'local', saved: { mode: 'local', address: '', token: '' }, prepareRestart: () => { throw new Error('1 run is in progress: confirm the restart to interrupt it (r1).'); } });
  s.c.openPage();
  await assert.rejects(s.call('engine-connection:save', { mode: 'remote', address: 'my-pc', token: TOKEN }), /1 run is in progress/);
  assert.deepEqual(s.store.writes, []);
  assert.deepEqual(s.relaunched, []);
});

test('local mode: choosing this computer again changes nothing and restarts nothing', async () => {
  const s = setup({ mode: 'local', saved: { mode: 'local', address: URL_, token: TOKEN } });
  s.c.openPage();
  const r = await s.call('engine-connection:save', { mode: 'local' });
  assert.deepEqual([r.saved, r.restarting], [true, false]);
  assert.deepEqual(s.store.writes, []);
  assert.deepEqual(s.relaunched, []);
});

test('remote mode: Use this computer saves local mode (address and token kept for later) and restarts', async () => {
  const s = setup();
  await s.c.startRemote(decision());
  s.c.openPage();
  const r = await s.call('engine-connection:save', { mode: 'local' });
  assert.deepEqual([r.saved, r.restarting], [true, true]);
  assert.deepEqual(s.store.writes, [{ mode: 'local', address: URL_, token: TOKEN }]);
  assert.equal(s.relaunched.length, 1);
});

// ---- closing the page: Cancel, Esc (the page's), the window's X, Quit -------------------------

test('opened from Settings over the app: Cancel closes the page and changes nothing', async () => {
  const s = setup({ mode: 'local', saved: { mode: 'local', address: '', token: '' } });
  s.c.openPage();
  const page = s.pageOf();
  assert.equal((await s.call('engine-connection:state')).alone, false, 'the button reads Cancel');
  assert.deepEqual(await s.call('engine-connection:close'), { closed: true });
  assert.equal(page.destroyed, true);
  assert.equal(s.main.destroyed, false, 'the app stays');
  assert.deepEqual([s.store.writes, s.relaunched, s.quits], [[], [], []]);
  // and it opens again afterwards
  assert.ok(s.c.openPage());
  assert.notEqual(s.pageOf(), page);
});

test('opened from the remote engine\'s Settings: Cancel, or the window\'s X, closes the page and keeps the engine\'s window', async () => {
  const s = setup();
  await s.c.startRemote(decision());
  const remote = s.remoteOf();
  remote.webContents.openHandler({ url: `${URL_}${conn.CONNECTION_PATH}` });
  assert.equal((await s.call('engine-connection:state')).alone, false);
  await s.call('engine-connection:close');
  assert.equal(s.pageOf(), undefined);
  remote.webContents.openHandler({ url: `${URL_}${conn.CONNECTION_PATH}` });
  s.pageOf().close(); // the X
  assert.equal(s.pageOf(), undefined);
  assert.equal(remote.destroyed, false);
  assert.deepEqual([s.store.writes, s.relaunched, s.quits], [[], [], []]);
});

test('alone after the engine failed: the button reads Quit and quits the app; so does the window\'s X', async () => {
  const down = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  const s = setup({ fetch: down });
  await s.c.startRemote(decision());
  assert.equal((await s.call('engine-connection:state')).alone, true, 'the button reads Quit');
  await s.call('engine-connection:close');
  assert.equal(s.pageOf(), undefined);
  assert.equal(s.quits.length, 1, 'never left running without a window');
  assert.deepEqual([s.store.writes, s.relaunched], [[], []]);

  const x = setup({ fetch: down });
  await x.c.startRemote(decision());
  x.pageOf().close();
  assert.equal(x.quits.length, 1);
});

test('a page replaced by another one (the engine failed while Change… was open) does not quit the app', async () => {
  const s = setup();
  await s.c.startRemote(decision());
  const remote = s.remoteOf();
  remote.webContents.openHandler({ url: `${URL_}${conn.CONNECTION_PATH}` });
  const before = s.pageOf();
  remote.webContents.emit('did-navigate', {}, `${URL_}/`, 401);
  assert.equal(before.destroyed, true);
  assert.ok(s.pageOf(), 'the new page says why');
  assert.equal((await s.call('engine-connection:state')).alone, true);
  assert.deepEqual(s.quits, []);
});

test('the page always has the OS title bar with its close button, and fits a small screen', () => {
  const area = { x: 0, y: 0, width: 1093, height: 614 };
  const screen = { getPrimaryDisplay: () => ({ workArea: area }), getDisplayMatching: () => ({ workArea: area }) };
  const s = setup({ mode: 'local', saved: { mode: 'local', address: '', token: '' }, screen });
  s.c.openPage();
  const o = s.pageOf().opts;
  assert.equal(o.frame, true);
  assert.equal(o.closable, true);
  assert.equal(o.resizable, true);
  assert.ok(o.height <= area.height - 24, `height ${o.height}`);
  assert.ok(o.width <= area.width, `width ${o.width}`);
  assert.ok(o.minHeight <= o.height && o.minWidth <= o.width, 'the minimum size fits too');
  // without a screen to ask, the default size
  const d = setup({ mode: 'local', saved: { mode: 'local', address: '', token: '' } });
  d.c.openPage();
  assert.deepEqual([d.pageOf().opts.width, d.pageOf().opts.height], [640, 700]);
});

test('#329 the connection page opens in the language of the engine\'s page that asked for it', async () => {
  const s = setup();
  await s.c.startRemote(decision());
  s.remoteOf().webContents.openHandler({ url: `${URL_}${conn.CONNECTION_PATH}?lang=pt-BR` });
  assert.deepEqual(s.pageOf().loadOptions, { query: { lang: 'pt-BR' } });
  s.pageOf().close();
  s.remoteOf().webContents.openHandler({ url: `${URL_}${conn.CONNECTION_PATH}?lang=%22%3E%3Cscript` });
  assert.equal(s.pageOf().loadOptions, undefined, 'not a language code: no query');
  s.pageOf().close();
  s.c.openPage();
  assert.equal(s.pageOf().loadOptions, undefined, 'from the desktop: the page\'s own remembered language');
});
