// #603 acceptance: the engine server keeps its WebSocket clients honest (packages/engine/server/index.js).
//
// A client whose connection died without a close frame stayed in wss.clients forever, and a page
// whose socket froze never knew. The server now checks its sockets periodically.
//
// The interface these tests expect (the developer implements it; this file is not edited):
//
// 1. `createServer({ ..., wsPingIntervalMs })`: the period of the check, in milliseconds (the
//    server has a default of its own, at most a few tens of seconds, when the option is not given;
//    the tests set it short). Every period the server sends a WebSocket ping (ws's `ws.ping()`) to
//    each client, and a client that has not answered the previous ping with a pong by the next
//    period is dropped with `ws.terminate()` (ws's isAlive / pong check).
// 2. A browser page cannot see protocol pings (the browser answers them itself), so the server
//    also sends every client a data frame every period (a heartbeat message, e.g.
//    `{"channel":"ws:ping"}`; its content is free): the page's watchdog (apps/web/renderer/api-http.js)
//    treats a missing heartbeat as a dead socket. A client with nothing pushed to it still receives
//    a message within a couple of periods.
// 3. server.close() stops the periodic check (no timer keeps the process alive).
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const TOKEN = 'test-token-603-0123456789abcdef';
const INTERVAL = 100;

// a service with no channels: only the WebSocket matters here
const fakeService = () => ({ api: {}, notifications: {}, events: { on() {}, off() {} }, manifest: [] });

// the module the change modifies: required inside each test
async function start(t, options = {}) {
  const { createServer } = require('../server');
  const server = createServer({ service: fakeService(), token: TOKEN, wsPingIntervalMs: INTERVAL, ...options });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(() => r())));
  return { server, url: `ws://127.0.0.1:${server.address().port}/ws` };
}

// a client connected to /ws with the token; records the pings, messages and its close
async function connect(t, url, options = {}) {
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${TOKEN}` }, ...options });
  const seen = { pings: 0, messages: 0, closed: false, closedAfterMs: null };
  const openedAt = Date.now();
  ws.on('ping', () => { seen.pings++; });
  ws.on('message', () => { seen.messages++; });
  ws.on('close', () => { seen.closed = true; seen.closedAfterMs = Date.now() - openedAt; });
  ws.on('error', () => {});
  t.after(() => { try { ws.terminate(); } catch { /* already closed */ } });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return { ws, seen };
}

// waits until fn() is true or ms pass; returns fn()'s last value
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  return fn();
}

test('#603 the server pings its WebSocket clients every wsPingIntervalMs; a client answering pongs stays connected', async (t) => {
  const { url } = await start(t);
  const { ws, seen } = await connect(t, url);
  await waitFor(() => seen.pings >= 3, INTERVAL * 20);
  assert.ok(seen.pings >= 3, `${seen.pings} ping(s) in ${INTERVAL * 20} ms with wsPingIntervalMs ${INTERVAL}`);
  // well past several periods: a client that answers is never dropped
  await new Promise((r) => setTimeout(r, INTERVAL * 6));
  assert.equal(seen.closed, false, 'a client answering the pings was dropped');
  assert.equal(ws.readyState, WebSocket.OPEN);
});

test('#603 a client that does not answer the pings is terminated within a few periods', async (t) => {
  const { url } = await start(t);
  // autoPong: false: ws never answers the server's pings (a dead peer, a frozen page)
  const { seen } = await connect(t, url, { autoPong: false });
  const closed = await waitFor(() => seen.closed, INTERVAL * 20);
  assert.ok(seen.pings >= 1, 'the server never pinged the client');
  assert.equal(closed, true, `a client answering no ping was still connected after ${INTERVAL * 20} ms`);
  assert.ok(seen.closedAfterMs <= INTERVAL * 10, `dropped after ${seen.closedAfterMs} ms: more than a few periods of ${INTERVAL} ms`);
});

test('#603 a client with nothing pushed to it still receives a heartbeat message (a data frame a browser page can see)', async (t) => {
  const { url } = await start(t);
  const { seen } = await connect(t, url);
  const got = await waitFor(() => seen.messages >= 2, INTERVAL * 20);
  assert.equal(got, true, `${seen.messages} message(s) in ${INTERVAL * 20} ms with no event pushed`);
  assert.equal(seen.closed, false);
});
