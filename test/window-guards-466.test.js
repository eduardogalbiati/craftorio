// #466: no window of the app navigates away from the app's page or attaches a webview.
// CONTRACT (acceptance tests written before the code):
//   NEW module src/window-guards.js exports guardWindow(webContents, { openExternal }).
//   It registers on `webContents` (an EventEmitter-like: `.on(name, fn)` and `setWindowOpenHandler(fn)`):
//   - 'will-navigate' (event, url): ALWAYS event.preventDefault(), for any URL (file:, about:,
//     javascript:, http(s)); an http(s) URL goes to openExternal(url) once; any other never does.
//   - 'will-attach-webview' (event): event.preventDefault().
//   - the window-open handler returns { action: 'deny' } and calls openExternal only for http(s).
//   Fake webContents: a node EventEmitter plus setWindowOpenHandler(fn) { this.openHandler = fn }.
//   openExternal is a recorded stub (the system boundary: the OS browser).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

// resolved inside each test: the module does not exist until the change lands
const load = () => require('../src/window-guards.js');

function guarded() {
  const { guardWindow } = load();
  assert.equal(typeof guardWindow, 'function', 'src/window-guards.js exports guardWindow (#466)');
  const wc = new EventEmitter();
  wc.setWindowOpenHandler = function (fn) { this.openHandler = fn; };
  const opened = [];
  guardWindow(wc, { openExternal: (url) => { opened.push(url); } });
  return { wc, opened };
}

const fakeEvent = () => ({ prevented: false, preventDefault() { this.prevented = true; } });

function navigate(wc, url) {
  const ev = fakeEvent();
  wc.emit('will-navigate', ev, url);
  return ev.prevented;
}

test('#466 will-navigate to a file: URL (a form or a dropped file) is prevented and never opened outside', () => {
  const { wc, opened } = guarded();
  assert.equal(navigate(wc, 'file:///C:/tmp/x.html'), true);
  assert.equal(opened.length, 0);
});

test('#466 will-navigate to about:, javascript: and data: URLs is prevented and never opened outside', () => {
  const { wc, opened } = guarded();
  assert.equal(navigate(wc, 'about:blank'), true);
  assert.equal(navigate(wc, 'javascript:alert(1)'), true);
  assert.equal(navigate(wc, 'data:text/html,<h1>x</h1>'), true);
  assert.equal(opened.length, 0);
});

test('#466 will-navigate to an http(s) URL is prevented and opened once in the browser', () => {
  const { wc, opened } = guarded();
  assert.equal(navigate(wc, 'https://example.com/a'), true);
  assert.equal(navigate(wc, 'http://example.com/b'), true);
  assert.deepEqual(opened, ['https://example.com/a', 'http://example.com/b']);
});

test('#466 will-attach-webview is prevented', () => {
  const { wc } = guarded();
  const ev = fakeEvent();
  wc.emit('will-attach-webview', ev, {}, {});
  assert.equal(ev.prevented, true);
});

test('#466 window.open is denied; an http(s) URL goes to the browser, a file: URL does not', () => {
  const { wc, opened } = guarded();
  assert.equal(typeof wc.openHandler, 'function', 'a window-open handler is set');
  assert.equal(wc.openHandler({ url: 'https://example.com/c' }).action, 'deny');
  assert.equal(wc.openHandler({ url: 'file:///C:/tmp/x.html' }).action, 'deny');
  assert.equal(wc.openHandler({ url: 'javascript:alert(1)' }).action, 'deny');
  assert.deepEqual(opened, ['https://example.com/c']);
});
