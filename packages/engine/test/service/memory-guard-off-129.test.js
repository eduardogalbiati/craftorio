// #129 the memory guard is off by default: what "off" means for the app.
//   - Settings: a new workspace reads it off; turned on through settings:set it stays on;
//   - the shared guard (packages/engine/engine/memory-guard.js sharedSettings, engine/run-settings.js
//     configureGuardFromSettings): none before Settings say otherwise; turned on, it gets the limit and
//     floor of Settings;
//   - off, a real run is never held for memory (runs area memoryHold), no stray-process check starts
//     (watchStrayProcesses: no notification can fire), and Concurrent runs gets no suggestion from the
//     guard's history (settings:machineProfile).
// Seams: the service's channels (makeService); the runs area (packages/engine/service/areas/runs.js) built
// from a small ctx, as stray-run-tmp-414.test.js. The machine's memory is the boundary: the shared guard's
// freeMemory is replaced by a low reading, and its watchStrays records what it is handed. memoryHold and
// watchStrayProcesses do nothing in simulation-only mode: the tests lift it around the call (no run
// starts). The shared guard is process-wide: what a test changes is put back after it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('./helpers');

const loadGuard = () => require('../../engine/memory-guard');
const loadRunSettings = () => require('../../engine/run-settings');
const loadRunsArea = () => require('../../service/areas/runs');
const loadWorkspace = () => require('../../domains/workspace/workspace');
const pct = (p) => Math.round(os.totalmem() * p / 100);
const ON = { enabled: true, limitPercent: 25, floorPercent: 10 };

// the app's shared guard object, whatever Settings say now (configured on to get it, put back after)
function sharedGuard(t) {
  const { configureMemoryGuard, sharedMemoryGuard } = loadGuard();
  configureMemoryGuard({ ...ON });
  const shared = sharedMemoryGuard();
  t.after(() => configureMemoryGuard({ enabled: false, limitPercent: 25, floorPercent: 10 }));
  return shared;
}

// a scratch workspace (its settings.json holds `memoryGuard` when given) and the runs area on it
function runsArea(t, memoryGuard) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-129-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  const ws = loadWorkspace().setupWorkspace(dir, { persist: false });
  if (memoryGuard) loadWorkspace().writeSettings(ws, { memoryGuard });
  const notices = [];
  const area = loadRunsArea()({ ws, events: new EventEmitter(), notify: (n) => notices.push(n), dispatchRoadmaps: async () => {} });
  t.after(() => area.stopDispatchTimers());
  return { area, notices };
}

// runs fn with simulation-only lifted
async function outsideSimulation(fn) {
  const sim = process.env.CRAFTORIO_SIMULATION_ONLY;
  delete process.env.CRAFTORIO_SIMULATION_ONLY;
  try { return await fn(); } finally { process.env.CRAFTORIO_SIMULATION_ONLY = sim; }
}

test('#129 settings:get on a new workspace: the memory guard is off (25% limit, 10% floor kept)', (t) => {
  const { api } = makeService(t);
  const mg = api['settings:get']().memoryGuard;
  assert.deepEqual([mg?.enabled, mg?.limitPercent, mg?.floorPercent], [false, 25, 10]);
});

test('#129 the guard turned on through settings:set (25%, 10%) is read back on, also after another setting is saved', (t) => {
  const { api } = makeService(t);
  api['settings:set']({ memoryGuard: { ...ON } });
  assert.equal(api['settings:get']().memoryGuard?.enabled, true);
  api['settings:set']({ keepAwake: true });
  assert.equal(api['settings:get']().memoryGuard?.enabled, true);
});

test('#129 the shared guard is off until Settings turn it on (a fresh memory-guard module has none)', () => {
  const file = require.resolve('../../engine/memory-guard');
  const cached = require.cache[file];
  delete require.cache[file];
  try {
    assert.equal(require(file).sharedMemoryGuard() === null, true);
  } finally {
    require.cache[file] = cached;
  }
});

test('#129 configureGuardFromSettings with no memoryGuard in Settings gives no guard', (t) => {
  sharedGuard(t);
  for (const s of [{}, null, undefined]) {
    assert.equal(loadRunSettings().configureGuardFromSettings(s) === null, true, `a guard for ${JSON.stringify(s)}`);
  }
});

test('#129 the guard turned on in Settings is configured with their limit and floor', (t) => {
  sharedGuard(t);
  const guard = loadRunSettings().configureGuardFromSettings({ memoryGuard: { enabled: true, limitPercent: 30, floorPercent: 15 } });
  assert.deepEqual([guard !== null, guard?.limitBytes, guard?.floorBytes], [true, pct(30), pct(15)]);
});

test('#129 with the guard off (the default) a real run is never held for memory, even with almost none free', async (t) => {
  const shared = sharedGuard(t);
  const original = shared.freeMemory;
  shared.freeMemory = async () => ({ freeBytes: 1024, totalBytes: os.totalmem() });
  t.after(() => { shared.freeMemory = original; });
  const off = runsArea(t, null);
  const on = runsArea(t, { enabled: true, limitPercent: 25, floorPercent: 20 });
  const held = await outsideSimulation(async () => [await off.area.memoryHold(), await on.area.memoryHold()]);
  // the guard turned on holds it on the same reading: the low memory is real for the app
  assert.deepEqual(held.map((why) => why !== ''), [false, true], JSON.stringify(held));
});

test('#129 with the guard off (the default) no stray-process check starts, so no stray notification', async (t) => {
  const shared = sharedGuard(t);
  const original = shared.watchStrays;
  const handed = [];
  shared.watchStrays = (next) => { handed.push(typeof next?.runs === 'function'); };
  t.after(() => { shared.watchStrays = original; });
  const off = runsArea(t, null);
  const on = runsArea(t, { enabled: true, limitPercent: 25, floorPercent: 20 });
  await outsideSimulation(() => off.area.watchStrayProcesses());
  const whenOff = handed.splice(0).some(Boolean);
  await outsideSimulation(() => on.area.watchStrayProcesses());
  const whenOn = handed.some(Boolean);
  assert.deepEqual([whenOff, whenOn], [false, true]);
});

test('#129 Concurrent runs gets no suggestion from the guard\'s history while the guard is off', (t) => {
  const { service, api } = makeService(t);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 4 } });
  const runs = service.workspace().runs;
  const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
  for (const [id, days] of [['run-a', 1], ['run-b', 3]]) {
    fs.mkdirSync(path.join(runs, id), { recursive: true });
    fs.writeFileSync(path.join(runs, id, 'events.jsonl'), `${JSON.stringify({ type: 'memory.hold', ts: ago(days), run_id: id })}\n`);
  }
  api['settings:set']({ memoryGuard: { enabled: false, limitPercent: 25, floorPercent: 10 } });
  const whenOff = api['settings:machineProfile']().suggestion;
  api['settings:set']({ memoryGuard: { enabled: true, limitPercent: 25, floorPercent: 10 } });
  const whenOn = api['settings:machineProfile']().suggestion;
  assert.deepEqual([whenOff === null, whenOn?.concurrentRuns ?? null], [true, 3]);
});

// settings:set (the Settings › Execution switch): turning the guard on starts the stray-process watch at
// once, turning it off stops it (the guard is handed null), with no restart of the app
test('#129 settings:set turning the guard on starts the stray-process watch, turning it off stops it', async (t) => {
  const shared = sharedGuard(t);
  const original = shared.watchStrays;
  const handed = [];
  shared.watchStrays = (next) => { handed.push(next == null ? 'stop' : typeof next.runs === 'function' ? 'watch' : 'other'); };
  t.after(() => { shared.watchStrays = original; });
  const { api } = makeService(t);
  await outsideSimulation(() => api['settings:set']({ memoryGuard: { enabled: true, limitPercent: 30, floorPercent: 10 } }));
  const afterOn = handed.splice(0);
  await outsideSimulation(() => api['settings:set']({ memoryGuard: { enabled: false, limitPercent: 30, floorPercent: 10 } }));
  const afterOff = handed.splice(0);
  assert.deepEqual([afterOn.at(-1) ?? null, afterOff.includes('watch'), afterOff.at(-1) ?? null], ['watch', false, 'stop']);
});
