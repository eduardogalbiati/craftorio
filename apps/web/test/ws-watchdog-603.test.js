// #603 acceptance: the browser client's watchdog on the pushed channel (apps/web/renderer/api-http.js).
//
// The remote-engine window (and the web UI) could silently lose its WebSocket live updates until a
// reload: a socket the server dropped without a close frame, or a frozen one, never fired `close`,
// so api-http.js never reconnected. These tests load api-http.js as the page does (a vm sandbox, a
// fake XMLHttpRequest for the manifest, a fake WebSocket at the boundary) on a fake clock: the
// sandbox's setTimeout / setInterval / Date.now / performance.now all read it.
//
// The interface these tests expect (the developer implements it; this file is not edited):
//
// 1. A socket on which no frame at all arrives (no message: no pushed event, no heartbeat of the
//    server) is noticed as dead and replaced within 30 s of silence, without a reload: api-http.js
//    calls close() on it and opens a new WebSocket by itself, WITHOUT waiting for the dead socket's
//    `close` event (a frozen socket never fires it: the fake's close() fires nothing). Every frame
//    received (any `message`, whatever its channel) counts as a sign of life: frames arriving every
//    2 s keep the socket for good. The silence allowed is more than 2 s and the replacement socket
//    exists at the latest 30 s after the last frame.
// 2. When the replacement socket opens, the `onReconnect` listeners fire (once), so the views
//    read the state again. A late event of the dead socket (its `close` coming after all) does not
//    open yet another socket.
// 3. A connection state the shell can show, in the style of `onReconnect`:
//    - `api.onConnectionChange(cb)` registers `cb(connected)` (connected: a boolean) and returns an
//      unsubscribe function; it is called when the pushed channel goes down (the watchdog found it
//      dead, or the socket closed) with `false`, and when a socket opens again with `true`;
//    - `api.connected`: a boolean, true while a socket is open and alive, false while reconnecting.
//    (These are extra keys on the browser api: apps/desktop/test/server.test.js compares the
//    browser's methods with the preload's and lists `onReconnect` as browser-only; the preload either
//    gets the same keys or that list names them.)
// The in-process desktop app (apps/desktop/host/preload.js, IPC) has no socket and no watchdog.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');

const ROOT = path.join(__dirname, '..', '..', '..');
// the file the change modifies: read inside each test (loadPage), never at load
const API_HTTP = path.join(ROOT, 'apps', 'web', 'renderer', 'api-http.js');

const START = Date.parse('2026-10-25T10:00:00.000Z');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

// A fake clock: timers run in time order when the test advances it.
function makeClock() {
  let now = START;
  let nextId = 1;
  const timers = new Map();
  const errors = [];
  const add = (fn, ms, every, args) => {
    const id = nextId++;
    const delay = Math.max(0, Number(ms) || 0);
    if (typeof fn === 'function') timers.set(id, { fn, at: now + delay, every: every ? Math.max(1, delay) : 0, args });
    return id;
  };
  const clear = (id) => { timers.delete(id); };
  function runUntil(end) {
    for (let guard = 0; guard < 100000; guard++) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.t.at)) next = { id, t };
      if (!next) break;
      now = next.t.at;
      if (next.t.every) next.t.at += next.t.every; else timers.delete(next.id);
      try { next.t.fn(...next.t.args); } catch (e) { errors.push(e); }
    }
    now = end;
  }
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(now); }
    static now() { return now; }
  }
  return {
    errors,
    now: () => now,
    globals: {
      setTimeout: (fn, ms, ...args) => add(fn, ms, false, args),
      clearTimeout: clear,
      setInterval: (fn, ms, ...args) => add(fn, ms, true, args),
      clearInterval: clear,
      Date: FakeDate,
      performance: { now: () => now - START },
    },
    // advances the clock by ms, in small steps, letting the page's promises settle between them
    async advance(ms, step = 250) {
      const end = now + ms;
      while (now < end) {
        runUntil(Math.min(end, now + step));
        await settle();
      }
    },
  };
}

// A minimal document: what api-http.js may touch (the version banner, an indicator of its own).
function makeDocument() {
  const el = (tag) => ({
    tagName: String(tag).toUpperCase(), children: [], dataset: {}, style: {}, attrs: {}, hidden: false, textContent: '', innerHTML: '', className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, removeAttribute(k) { delete this.attrs[k]; },
    append(...n) { this.children.push(...n); }, appendChild(n) { this.children.push(n); return n; }, prepend(...n) { this.children.unshift(...n); },
    remove() {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  });
  const body = el('body');
  return {
    readyState: 'complete', body, head: el('head'), documentElement: el('html'), hidden: false, visibilityState: 'visible',
    createElement: el, createTextNode: (t) => ({ textContent: String(t) }),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
  };
}

// api-http.js in a vm sandbox on the fake clock. Returns the page's api and the sockets it opened.
function loadPage() {
  const src = fs.readFileSync(API_HTTP, 'utf8');
  const clock = makeClock();
  const sockets = [];

  function FakeXHR() { this.readyState = 0; }
  FakeXHR.prototype.open = function open(_m, url) { this.url = url; };
  FakeXHR.prototype.setRequestHeader = function setRequestHeader() {};
  FakeXHR.prototype.send = function send() {
    this.status = 200;
    this.readyState = 4;
    this.responseText = JSON.stringify({ result: [], contract: null });
    if (typeof this.onload === 'function') this.onload();
  };

  // A socket whose close() fires nothing: a frozen socket (or one whose server vanished) never
  // tells the page it closed.
  class FakeWebSocket {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.handlers = {};
      this.closeCalls = 0;
      this.sent = [];
      sockets.push(this);
    }
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter((f) => f !== fn); }
    send(data) { this.sent.push(String(data)); }
    close() { this.closeCalls++; if (this.readyState < 2) this.readyState = 2; }
  }
  Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });

  const location = { protocol: 'http:', host: 'engine.invalid:7300', href: 'http://engine.invalid:7300/apps/web/renderer/index.html', reload() {} };
  const sandbox = {
    document: makeDocument(),
    location,
    navigator: { userAgent: 'node', clipboard: {}, onLine: true },
    XMLHttpRequest: FakeXHR,
    WebSocket: FakeWebSocket,
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ app: '1.0.0', contract: null }), text: async () => '{}' }),
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
    URL,
    queueMicrotask,
    addEventListener() {},
    removeEventListener() {},
    ...clock.globals,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'api-http.js' });

  const fire = (ws, type, extra = {}) => {
    const ev = { type, target: ws, ...extra };
    if (typeof ws[`on${type}`] === 'function') ws[`on${type}`](ev);
    for (const fn of ws.handlers[type] || []) fn(ev);
  };
  const latest = () => sockets.at(-1);
  return {
    api: sandbox.window.api,
    clock,
    sockets,
    latest,
    // the latest socket opens
    async open() {
      const ws = latest();
      assert.ok(ws, 'api-http.js opened a WebSocket');
      ws.readyState = 1;
      fire(ws, 'open');
      await settle();
      return ws;
    },
    // a pushed event arrives on the socket (a frame)
    frame(ws, channel = 'run:event', payload = { type: 'log', run_id: 'r1' }) {
      fire(ws, 'message', { data: JSON.stringify({ channel, payload }) });
    },
    async closeEvent(ws) {
      ws.readyState = 3;
      fire(ws, 'close', { code: 1006, reason: '', wasClean: false });
      await settle();
    },
  };
}

// the connection state as primitives: api.connected and the values given to onConnectionChange
function watchConnection(api) {
  assert.equal(typeof api.onConnectionChange, 'function', 'window.api.onConnectionChange(cb) exists in the browser client');
  const seen = [];
  const off = api.onConnectionChange((connected) => { seen.push(connected === true ? true : connected === false ? false : String(connected)); });
  assert.equal(typeof off, 'function', 'onConnectionChange returns an unsubscribe function, as onReconnect does');
  return { seen, last: () => seen.at(-1) };
}

test('#603 a socket silent for 30 s is closed and replaced without a reload, and onReconnect fires when the new one opens', async () => {
  const page = loadPage();
  let reconnects = 0;
  page.api.onReconnect(() => { reconnects++; });
  const first = await page.open();
  assert.equal(page.sockets.length, 1);

  await page.clock.advance(30000);
  assert.ok(page.sockets.length >= 2, `no new WebSocket within 30 s of silence (still ${page.sockets.length})`);
  assert.ok(first.closeCalls >= 1, 'the dead socket was not closed');
  assert.equal(reconnects, 0, 'onReconnect waits for the new socket to open');

  const count = page.sockets.length;
  await page.open();
  assert.equal(reconnects, 1, 'onReconnect fired once when the new socket opened');

  // the dead socket's close finally arrives: it opens no other socket
  await page.closeEvent(first);
  await page.clock.advance(5000);
  assert.equal(page.sockets.length, count, 'a late close of the dead socket opened another socket');
  assert.equal(reconnects, 1);
});

test('#603 frames keep the socket alive; once they stop, it is replaced within 30 s of the last one', async () => {
  const page = loadPage();
  let reconnects = 0;
  page.api.onReconnect(() => { reconnects++; });
  const ws = await page.open();

  // two minutes of frames every 2 s: the socket is alive, nothing is closed or reopened
  for (let i = 0; i < 60; i++) {
    await page.clock.advance(2000);
    page.frame(ws);
  }
  assert.equal(page.sockets.length, 1, 'a socket receiving frames every 2 s was replaced');
  assert.equal(ws.closeCalls, 0, 'a socket receiving frames every 2 s was closed');
  assert.equal(reconnects, 0);

  // then silence
  await page.clock.advance(30000);
  assert.ok(page.sockets.length >= 2, 'no new WebSocket within 30 s after the last frame');
  assert.ok(ws.closeCalls >= 1, 'the silent socket was not closed');
  await page.open();
  assert.equal(reconnects, 1, 'onReconnect fired once for the replacement socket');
});

test('#603 api.connected and onConnectionChange: down while the channel is dead, up again when the new socket opens', async () => {
  const page = loadPage();
  const conn = watchConnection(page.api);
  await page.open();
  assert.equal(typeof page.api.connected, 'boolean', 'api.connected is a boolean');
  assert.equal(page.api.connected, true, 'connected once the socket opened');

  await page.clock.advance(30000);
  assert.ok(page.sockets.length >= 2, 'the watchdog replaced the silent socket');
  assert.equal(page.api.connected, false, 'not connected while the new socket has not opened');
  assert.equal(conn.last(), false, 'onConnectionChange was told the channel went down');

  await page.open();
  assert.equal(page.api.connected, true, 'connected again once the new socket opened');
  assert.equal(conn.last(), true, 'onConnectionChange was told the channel is back');
});

test('#603 a socket that closes (the engine restarted) reports the channel down at once, and up when it reconnects', async () => {
  const page = loadPage();
  const conn = watchConnection(page.api);
  const ws = await page.open();
  await page.closeEvent(ws);
  assert.equal(page.api.connected, false, 'api.connected is false right after the close');
  assert.equal(conn.last(), false, 'onConnectionChange(false) right after the close');

  await page.clock.advance(5000);
  assert.ok(page.sockets.length >= 2, 'a closed socket is reopened');
  await page.open();
  assert.equal(page.api.connected, true);
  assert.equal(conn.last(), true);
});
