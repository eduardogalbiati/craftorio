// #467: the IPC handlers answer only the app's own page, in a window's top frame.
// CONTRACT (acceptance tests written before the code):
//   NEW module src/ipc-guard.js exports guardIpc(ipcMain, { appPage, log }) →
//   { handle(channel, fn), on(channel, fn) }, registering on ipcMain (ipcMain.handle(channel, listener)
//   / ipcMain.on(channel, listener)) a listener (event, arg) that calls fn(arg) (and, for handle,
//   returns its result) only when the sender is trusted:
//     event.senderFrame === event.sender.mainFrame (the top frame, not a subframe) AND
//     isAppPage(event.senderFrame.url, appPage) (src/permissions.js; a query string is fine: the
//     Agents window loads index.html?window=agents&agent=<id>).
//   A refused call: fn never runs, log(...) is called exactly once; a `handle` listener rejects or
//   throws; an `on` listener does nothing and never throws. A null senderFrame is refused, no crash.
//   Fake ipcMain: records listeners in Maps. Event: const mainFrame = { url };
//   { sender: { mainFrame }, senderFrame: mainFrame }.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

// resolved inside each test: the module does not exist until the change lands
const load = () => require('../src/ipc-guard.js');

const APP_PAGE = path.join(os.tmpdir(), 'app', 'renderer', 'index.html');
const APP_URL = pathToFileURL(APP_PAGE).href;
const FOREIGN_URL = pathToFileURL(path.join(os.tmpdir(), 'x.html')).href;

function setup() {
  const { guardIpc } = load();
  assert.equal(typeof guardIpc, 'function', 'src/ipc-guard.js exports guardIpc (#467)');
  const handles = new Map();
  const ons = new Map();
  const ipcMain = {
    handle(channel, listener) { handles.set(channel, listener); },
    on(channel, listener) { ons.set(channel, listener); return this; },
  };
  const logs = [];
  const ipc = guardIpc(ipcMain, { appPage: APP_PAGE, log: (...a) => { logs.push(a.map(String).join(' ')); } });
  const calls = [];
  ipc.handle('runs:list', (arg) => { calls.push(arg); return { ok: true, got: arg }; });
  ipc.on('notify:seen', (arg) => { calls.push(arg); });
  return { handles, ons, logs, calls };
}

// the top frame of a window showing `url`
function topFrame(url) {
  const mainFrame = { url };
  return { sender: { mainFrame }, senderFrame: mainFrame };
}

test('#467 the app page in the top frame: the handle channel runs with the argument and answers its result', async () => {
  const { handles, calls, logs } = setup();
  const result = await handles.get('runs:list')(topFrame(APP_URL), 'p1');
  assert.equal(result.ok, true);
  assert.equal(result.got, 'p1');
  assert.deepEqual(calls, ['p1']);
  assert.equal(logs.length, 0);
});

test('#467 the Agents window (the app page with ?window=agents&agent=oracle) goes through', async () => {
  const { handles, calls } = setup();
  const result = await handles.get('runs:list')(topFrame(`${APP_URL}?window=agents&agent=oracle`), 'p2');
  assert.equal(result.got, 'p2');
  assert.deepEqual(calls, ['p2']);
});

test('#467 the app page on an `on` channel: the fn runs with the argument', () => {
  const { ons, calls } = setup();
  ons.get('notify:seen')(topFrame(APP_URL), 'n1');
  assert.deepEqual(calls, ['n1']);
});

test('#467 a different file: page is refused: the handle rejects, the fn never runs, logged once', async () => {
  const { handles, calls, logs } = setup();
  await assert.rejects(async () => handles.get('runs:list')(topFrame(FOREIGN_URL), 'x'));
  assert.equal(calls.length, 0);
  assert.equal(logs.length, 1);
});

test('#467 a subframe showing the app URL is refused (senderFrame is not sender.mainFrame)', async () => {
  const { handles, calls, logs } = setup();
  const ev = { sender: { mainFrame: { url: APP_URL } }, senderFrame: { url: APP_URL } };
  await assert.rejects(async () => handles.get('runs:list')(ev, 'x'));
  assert.equal(calls.length, 0);
  assert.equal(logs.length, 1);
});

test('#467 a null senderFrame (the frame is gone) is refused without crashing', async () => {
  const { handles, calls, logs } = setup();
  const ev = { sender: { mainFrame: { url: APP_URL } }, senderFrame: null };
  await assert.rejects(async () => handles.get('runs:list')(ev, 'x'));
  assert.equal(calls.length, 0);
  assert.equal(logs.length, 1);
});

test('#467 an http page is refused', async () => {
  const { handles, calls, logs } = setup();
  await assert.rejects(async () => handles.get('runs:list')(topFrame('https://evil.example/index.html'), 'x'));
  assert.equal(calls.length, 0);
  assert.equal(logs.length, 1);
});

test('#467 an `on` channel from a foreign page: the fn never runs, the listener does not throw, logged once', () => {
  const { ons, calls, logs } = setup();
  assert.doesNotThrow(() => ons.get('notify:seen')(topFrame(FOREIGN_URL), 'x'));
  assert.equal(calls.length, 0);
  assert.equal(logs.length, 1);
});

test('#467 an `on` channel with a null senderFrame: the fn never runs, the listener does not throw', () => {
  const { ons, calls } = setup();
  assert.doesNotThrow(() => ons.get('notify:seen')({ sender: { mainFrame: { url: APP_URL } }, senderFrame: null }, 'x'));
  assert.equal(calls.length, 0);
});

// a sync channel (preload's sendSync: api:manifest, terminal:external-sync) answers through
// event.returnValue; a refused one must still answer, or the page's sendSync never returns
function syncChannel() {
  const { guardIpc } = load();
  const ons = new Map();
  const ipc = guardIpc({ handle() {}, on(channel, listener) { ons.set(channel, listener); } }, { appPage: APP_PAGE, log: () => {} });
  ipc.on('api:manifest', (_arg, e) => { e.returnValue = 'the manifest'; });
  return ons.get('api:manifest');
}

test('#467 a sync channel from the app page answers through the event (returnValue)', () => {
  const ev = topFrame(APP_URL);
  syncChannel()(ev);
  assert.equal(ev.returnValue, 'the manifest');
});

test('#467 a sync channel from a foreign page is refused with a null answer (the caller is not left waiting)', () => {
  const ev = topFrame(FOREIGN_URL);
  syncChannel()(ev);
  assert.equal(ev.returnValue, null);
  assert.equal('returnValue' in ev, true);
});
