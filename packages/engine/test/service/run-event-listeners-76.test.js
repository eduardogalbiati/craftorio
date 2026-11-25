// #76 acceptance, written before the code: the service's 'run:event' listeners (service.events) are a known,
// fixed number, so starting the app prints no MaxListenersExceededWarning, and that warning still means a leak.
//
// The contract assumed here:
// - the service's own listeners, plus the desktop host's two (apps/desktop/host/main.js: the broadcast of
//   PUSHED_EVENTS and keep awake) or the served engine's one (packages/engine/server/index.js), raise no
//   MaxListenersExceededWarning for 'run:event';
// - the limit is finite and above 0, and 50 listeners more than the service's own still raise the warning;
// - the number of listeners does not grow with the projects, the runs or the windows (WebSocket clients).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createServer } = require('../../server');
const { PUSHED_EVENTS } = require('../../service/manifest');
const { makeService, resolveAndWait, untilTrue, watchRuns } = require('./helpers');

const TOKEN = 'test-token-0123456789abcdef';

// the MaxListenersExceededWarnings of 'run:event' from now on
function leakWarnings(t) {
  const seen = [];
  const onWarning = (w) => { if (w.name === 'MaxListenersExceededWarning' && w.type === 'run:event') seen.push(w.message); };
  process.on('warning', onWarning);
  t.after(() => process.off('warning', onWarning));
  // node emits a warning on a later tick
  return async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    return seen;
  };
}

const listeners = (service) => service.events.listenerCount('run:event');

// the served engine on a random port, closed at the end of the test
async function serve(t, service) {
  const server = createServer({ service, token: TOKEN });
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `ws://127.0.0.1:${server.address().port}/ws`;
}

test('#76 the service with the desktop host\'s listeners raises no run:event MaxListenersExceededWarning', { timeout: 60000 }, async (t) => {
  const warnings = leakWarnings(t);
  const { service } = makeService(t);
  // what apps/desktop/host/main.js does: the broadcast of every pushed event, then keep awake
  for (const channel of PUSHED_EVENTS) service.events.on(channel, () => {});
  service.events.on('run:event', () => {});
  assert.equal((await warnings()).join('\n'), '');
});

test('#76 the served engine raises no run:event MaxListenersExceededWarning', { timeout: 60000 }, async (t) => {
  const warnings = leakWarnings(t);
  const { service } = makeService(t);
  await serve(t, service);
  assert.equal((await warnings()).join('\n'), '');
});

test('#76 a real leak is still caught: the limit is finite, and 50 more listeners raise the warning', { timeout: 60000 }, async (t) => {
  const warnings = leakWarnings(t);
  const { service } = makeService(t);
  const limit = service.events.getMaxListeners();
  assert.equal(Number.isFinite(limit) && limit > 0, true, `getMaxListeners(): ${limit}`);
  assert.equal((await warnings()).join('\n'), '', 'no warning before the leak');
  const leaked = Array.from({ length: 50 }, () => () => {});
  for (const fn of leaked) service.events.on('run:event', fn);
  t.after(() => { for (const fn of leaked) service.events.off('run:event', fn); });
  assert.equal((await warnings()).length, 1, `${listeners(service)} listeners over a limit of ${limit}`);
});

test('#76 projects and runs add no run:event listener', { timeout: 60000 }, async (t) => {
  const { service, api } = makeService(t);
  const { gates } = watchRuns(service); // this test's own listener, in every count below
  const before = listeners(service);
  for (const name of ['One', 'Two', 'Three']) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'listeners-76-'));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const p = await api['projects:create']({ name, folder });
    await api['projects:runs']({ id: p.id });
  }
  assert.equal((await api['projects:list']()).length, 3);
  assert.equal(listeners(service), before, 'after three projects');
  for (const ending of ['first', 'second']) {
    const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
    await untilTrue(() => gates.has(runId));
    await resolveAndWait(api, runId, gates.get(runId), true);
    assert.equal(listeners(service), before, `after the ${ending} run`);
  }
});

test('#76 windows connected to the served engine, then closed, add no run:event listener', { timeout: 60000 }, async (t) => {
  const { service } = makeService(t);
  const url = await serve(t, service);
  const before = listeners(service);
  const windows = await Promise.all([1, 2, 3, 4].map(() => new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    t.after(() => ws.terminate());
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  })));
  assert.equal(windows.length, 4);
  assert.equal(listeners(service), before, 'with four windows open');
  await Promise.all(windows.map((ws) => new Promise((resolve) => { ws.on('close', resolve); ws.close(); })));
  assert.equal(listeners(service), before, 'once they closed');
});
