// The engine's memory guard (#276): src/engine/memory-guard.js. Written before the module exists:
// it is required inside each test, so this file loads and each test fails on its own.
//
// The API these tests pin down (the developer implements against it):
//
//   createMemoryGuard({ limitBytes?, floorBytes?, intervalMs?, sampler?, freeMemory?, kill?, now? }) -> guard
//     limitBytes  per-process limit; default 25% of os.totalmem()   (exposed as guard.limitBytes)
//     floorBytes  free-memory floor; default 10% of os.totalmem()   (exposed as guard.floorBytes); 0 = no floor
//     intervalMs  sampling period while something is watched (default <= 5000)
//     sampler     async () => [{ pid, ppid, commandLine, bytes }] (bytes: committed/private bytes on
//                 Windows, RSS elsewhere). Default: the real sampler, which never spawns a new
//                 process per sample (one long-lived helper at most).
//     freeMemory  async () => ({ freeBytes, totalBytes }); default: the machine's
//     kill        (pid) => void|Promise: stops a process with its children; default: the real one
//     now         () => ms; default Date.now (the times of the incidents)
//   Nothing is sampled while no watch is active.
//
//   guard.watch({ rootPid, protectedPids?, step, session, onKill?, onReport?, onLog? }) -> { stop() }
//     Each sample, the descendants of rootPid (by ppid, any depth) over limitBytes are stopped with
//     `kill(pid)` and reported to onKill(event). rootPid itself and protectedPids are never stopped:
//     over the limit they go to onReport(event) instead, once per pid per watch. A process outside
//     rootPid's tree is ignored. event = { pid, commandLine (cut to at most 300 chars), bytes,
//     limitBytes, step, session }. onKill may be called at any time after watch() returned.
//     When the sampler fails (throws/rejects), nothing throws: each active watch gets
//     onLog({ level: 'warn', message }) ONCE (message: the memory guard is off), however many
//     samples fail.
//   guard.tick() -> Promise: one sample + enforcement pass now (what the timer does every intervalMs).
//   guard.waitForMemory({ maxWaitMs, onWait? }) -> Promise<{ recovered, waitedMs }>
//     Resolves at once (recovered: true, onWait not called) when floorBytes is 0 or free >= floor;
//     otherwise calls onWait({ freeBytes, totalBytes, floorBytes }) once, polls freeMemory every
//     intervalMs and resolves when free >= floor (recovered: true) or after maxWaitMs
//     (recovered: false). A low-memory wait is recorded as an incident.
//   guard.incidentsBetween(startMs, endMs) -> [incident] overlapping the window:
//     { kind: 'stop', at, pid, commandLine, bytes, limitBytes, step, session }
//     { kind: 'low_memory', start, end }
//   guard.close(): stops the timer and the helper process.
//   memoryProblem({ freeBytes, floorBytes }) -> '' or the reason a new real run cannot start now
//     (like slotProblem in src/service/areas/runs.js), naming memory and the numbers in GB
//     (bytes / 1024^3, one decimal).
//
// Tests: injected sampler/freeMemory/kill (machine-independent), plus one test on real processes
// (fixtures test/fixtures/memory-root.js and memory-hog.js) and one on the real sampler's cost.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const load = () => require('../src/engine/memory-guard');
const MB = 1024 * 1024;
const GB = 1024 * MB;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const killPid = (pid) => { try { if (pid) process.kill(pid, 'SIGKILL'); } catch { /* gone */ } };

// The process list of test (b): root 100 with children, a grandchild, a protected one, and outsiders.
const LONG = `node ${'x'.repeat(1000)}`;
const PROCS = [
  { pid: 1, ppid: 0, commandLine: 'init', bytes: 5 * GB },
  { pid: 100, ppid: 1, commandLine: 'claude -p', bytes: 500 * MB }, // the agent CLI's root: only reported
  { pid: 101, ppid: 100, commandLine: 'node hog.js --big', bytes: 300 * MB }, // over: stopped
  { pid: 102, ppid: 101, commandLine: 'node small.js', bytes: 10 * MB }, // under: left alone
  { pid: 103, ppid: 102, commandLine: LONG, bytes: 400 * MB }, // grandchild over: stopped, command cut
  { pid: 104, ppid: 100, commandLine: 'node protected.js', bytes: 900 * MB }, // protected: only reported
  { pid: 200, ppid: 1, commandLine: 'node outside.js', bytes: 900 * MB }, // outside the tree: ignored
  { pid: 201, ppid: 200, commandLine: 'node outside-child.js', bytes: 900 * MB }, // outside too
];

function guardWith(load, extra = {}) {
  const kills = [];
  const guard = load().createMemoryGuard({
    limitBytes: 200 * MB, floorBytes: 0, intervalMs: 60000,
    sampler: async () => PROCS.map((p) => ({ ...p })),
    freeMemory: async () => ({ freeBytes: 8 * GB, totalBytes: 16 * GB }),
    kill: (pid) => { kills.push(pid); },
    ...extra,
  });
  return { guard, kills };
}

// ---------------------------------------------------------------------------
// Injected sampler (b)
// ---------------------------------------------------------------------------

test('memory guard (#276): a descendant over the limit is stopped and reported with its step and session; outsiders are ignored', async () => {
  const { guard, kills } = guardWith(load);
  try {
    const killed = [];
    const reported = [];
    guard.watch({ rootPid: 100, protectedPids: [104], step: 'test', session: 'sess-1', onKill: (e) => killed.push(e), onReport: (e) => reported.push(e) });
    await guard.tick();
    assert.deepEqual([...kills].sort((a, b) => a - b), [101, 103], 'only the descendants over the limit are stopped');
    const hog = killed.find((e) => e.pid === 101);
    assert.deepEqual(
      { pid: hog.pid, commandLine: hog.commandLine, bytes: hog.bytes, limitBytes: hog.limitBytes, step: hog.step, session: hog.session },
      { pid: 101, commandLine: 'node hog.js --big', bytes: 300 * MB, limitBytes: 200 * MB, step: 'test', session: 'sess-1' },
    );
    assert.deepEqual(killed.map((e) => e.pid).sort((a, b) => a - b), [101, 103]);
  } finally { guard.close(); }
});

test('memory guard (#276): the command line in a stop event is cut to 300 characters', async () => {
  const { guard } = guardWith(load);
  try {
    const killed = [];
    guard.watch({ rootPid: 100, step: 'test', session: 's', onKill: (e) => killed.push(e) });
    await guard.tick();
    const long = killed.find((e) => e.pid === 103);
    assert.ok(long, 'the grandchild over the limit is stopped');
    assert.ok(long.commandLine.length <= 300, `cut to 300 chars, got ${long.commandLine.length}`);
    assert.ok(long.commandLine.startsWith(LONG.slice(0, 250)), 'the cut keeps the start of the command');
  } finally { guard.close(); }
});

test('memory guard (#276): the root and a protected pid over the limit are only reported, once per pid, never stopped', async () => {
  const { guard, kills } = guardWith(load);
  try {
    const reported = [];
    guard.watch({ rootPid: 100, protectedPids: [104], step: 'develop', session: 's2', onKill: () => {}, onReport: (e) => reported.push(e) });
    await guard.tick();
    await guard.tick();
    assert.ok(!kills.includes(100) && !kills.includes(104), `never stopped: ${kills.join(',')}`);
    assert.deepEqual(reported.map((e) => e.pid).sort((a, b) => a - b), [100, 104], 'each reported once across two samples');
    const root = reported.find((e) => e.pid === 100);
    assert.equal(root.bytes, 500 * MB);
    assert.equal(root.limitBytes, 200 * MB);
    assert.equal(root.step, 'develop');
  } finally { guard.close(); }
});

test('memory guard (#276): processes outside the watched tree are never stopped, even far over the limit', async () => {
  const { guard, kills } = guardWith(load);
  try {
    guard.watch({ rootPid: 100, step: 'test', session: 's', onKill: () => {} });
    await guard.tick();
    for (const pid of [1, 200, 201]) assert.ok(!kills.includes(pid), `pid ${pid} is outside the run's tree`);
    assert.ok(!kills.includes(process.pid), 'never the app itself');
  } finally { guard.close(); }
});

test('memory guard (#276): a stopped watch stops nothing more; nothing is sampled while no watch is active', async () => {
  let samples = 0;
  const { guard, kills } = guardWith(load, { intervalMs: 10, sampler: async () => { samples++; return PROCS.map((p) => ({ ...p })); } });
  try {
    await delay(80);
    assert.equal(samples, 0, 'no watch: no sampling');
    const handle = guard.watch({ rootPid: 100, step: 'test', session: 's', onKill: () => {} });
    await delay(80);
    assert.ok(samples > 0, 'a watch starts the sampling');
    handle.stop();
    const before = kills.length;
    const n = samples;
    await delay(80);
    assert.ok(samples - n <= 1, 'the sampling stops with the last watch');
    await guard.tick();
    assert.equal(kills.length, before, 'a stopped watch stops nothing');
  } finally { guard.close(); }
});

test('memory guard (#276): protectChildren spares the root\'s direct children (the CLI under a .cmd shim) and still stops deeper descendants', async () => {
  const { guard, kills } = guardWith(load);
  try {
    const killed = [];
    const reported = [];
    guard.watch({ rootPid: 100, protectChildren: true, step: 'work', session: 's1', onKill: (e) => killed.push(e), onReport: (e) => reported.push(e) });
    await guard.tick();
    assert.deepEqual(kills, [103], 'only the grandchild over the limit is stopped');
    assert.deepEqual(killed.map((e) => e.pid), [103]);
    await guard.tick();
    assert.deepEqual(reported.map((e) => e.pid).sort((a, b) => a - b), [100, 101, 104], 'the root and its children over the limit are reported once each');
  } finally { guard.close(); }
});

test('memory guard (#276): a stop is an incident inside its time window, not outside', async () => {
  let clock = 1000;
  const { guard } = guardWith(load, { now: () => clock });
  try {
    guard.watch({ rootPid: 100, protectedPids: [104], step: 'suite', session: null, onKill: () => {} });
    await guard.tick();
    clock = 5000;
    const inside = guard.incidentsBetween(900, 1100);
    assert.deepEqual(inside.filter((i) => i.kind === 'stop').map((i) => i.pid).sort((a, b) => a - b), [101, 103]);
    const hog = inside.find((i) => i.pid === 101);
    assert.equal(hog.at, 1000);
    assert.equal(hog.step, 'suite');
    assert.deepEqual(guard.incidentsBetween(1200, 4000), []);
  } finally { guard.close(); }
});

// ---------------------------------------------------------------------------
// The sampler fails (c)
// ---------------------------------------------------------------------------

test('memory guard (#276): a sampler that fails never throws; the watch is told once that the guard is off', async () => {
  const guard = load().createMemoryGuard({
    limitBytes: 200 * MB, floorBytes: 0, intervalMs: 60000,
    sampler: async () => { throw new Error('Get-CimInstance failed'); },
    freeMemory: async () => ({ freeBytes: 8 * GB, totalBytes: 16 * GB }),
    kill: () => { throw new Error('nothing may be stopped'); },
  });
  try {
    const logs = [];
    guard.watch({ rootPid: 100, step: 'test', session: 's', onKill: () => assert.fail('no stop'), onLog: (l) => logs.push(l) });
    await guard.tick();
    await guard.tick();
    await guard.tick();
    assert.equal(logs.length, 1, `one log across three failed samples, got ${logs.length}`);
    assert.equal(logs[0].level, 'warn');
    assert.match(logs[0].message, /memory guard/i);
    assert.match(logs[0].message, /\boff\b/i);
  } finally { guard.close(); }
});

// ---------------------------------------------------------------------------
// The low-memory hold (d, e)
// ---------------------------------------------------------------------------

test('memory guard (#276): waitForMemory waits while free memory is under the floor and resolves when it recovers', async () => {
  const free = [1 * GB, 1 * GB, 1 * GB, 6 * GB];
  let calls = 0;
  const guard = load().createMemoryGuard({
    limitBytes: GB, floorBytes: 3 * GB, intervalMs: 10,
    sampler: async () => [],
    freeMemory: async () => ({ freeBytes: free[Math.min(calls++, free.length - 1)], totalBytes: 32 * GB }),
  });
  try {
    const waits = [];
    const t0 = Date.now();
    const r = await guard.waitForMemory({ maxWaitMs: 10000, onWait: (info) => waits.push(info) });
    const t1 = Date.now();
    assert.equal(r.recovered, true);
    assert.ok(calls >= 4, `free memory polled until it recovered (${calls} reads)`);
    assert.equal(waits.length, 1, 'onWait once, with the numbers');
    assert.deepEqual(waits[0], { freeBytes: 1 * GB, totalBytes: 32 * GB, floorBytes: 3 * GB });
    const low = guard.incidentsBetween(t0, t1).filter((i) => i.kind === 'low_memory');
    assert.equal(low.length, 1, 'the low-memory period is an incident');
    assert.ok(low[0].start <= low[0].end);
    assert.deepEqual(guard.incidentsBetween(t1 + 10000, t1 + 20000), []);
  } finally { guard.close(); }
});

test('memory guard (#276): waitForMemory gives up after maxWaitMs and resolves (the step then starts)', async () => {
  const guard = load().createMemoryGuard({
    limitBytes: GB, floorBytes: 3 * GB, intervalMs: 10,
    sampler: async () => [],
    freeMemory: async () => ({ freeBytes: 1 * GB, totalBytes: 32 * GB }),
  });
  try {
    const t0 = Date.now();
    const r = await guard.waitForMemory({ maxWaitMs: 120, onWait: () => {} });
    const waited = Date.now() - t0;
    assert.equal(r.recovered, false);
    assert.ok(waited >= 100 && waited < 3000, `waited ${waited} ms for a max of 120`);
  } finally { guard.close(); }
});

test('memory guard (#276): with floor 0, waitForMemory resolves at once without onWait', async () => {
  const guard = load().createMemoryGuard({
    limitBytes: GB, floorBytes: 0, intervalMs: 10,
    sampler: async () => [],
    freeMemory: async () => ({ freeBytes: 1, totalBytes: 32 * GB }),
  });
  try {
    let waited = 0;
    const t0 = Date.now();
    const r = await guard.waitForMemory({ maxWaitMs: 5000, onWait: () => { waited++; } });
    assert.equal(r.recovered, true);
    assert.equal(waited, 0);
    assert.ok(Date.now() - t0 < 1000);
  } finally { guard.close(); }
});

test('memory guard (#276): the defaults are 25% of RAM per process and a 10% free-memory floor', () => {
  const guard = load().createMemoryGuard({ sampler: async () => [], freeMemory: async () => ({ freeBytes: GB, totalBytes: 2 * GB }) });
  try {
    const total = os.totalmem();
    assert.ok(Math.abs(guard.limitBytes - total * 0.25) < MB, `limit ${guard.limitBytes} vs 25% of ${total}`);
    assert.ok(Math.abs(guard.floorBytes - total * 0.10) < MB, `floor ${guard.floorBytes} vs 10% of ${total}`);
  } finally { guard.close(); }
});

test('memory guard (#276): memoryProblem names the low free memory and the floor; empty when enough is free or no floor', () => {
  const { memoryProblem } = load();
  const why = memoryProblem({ freeBytes: 1.5 * GB, floorBytes: 3.2 * GB });
  assert.match(why, /memory/i);
  assert.match(why, /1\.5 GB/);
  assert.match(why, /3\.2 GB/);
  assert.equal(memoryProblem({ freeBytes: 4 * GB, floorBytes: 3.2 * GB }), '');
  assert.equal(memoryProblem({ freeBytes: 1, floorBytes: 0 }), '');
});

// ---------------------------------------------------------------------------
// The real sampler
// ---------------------------------------------------------------------------

test('memory guard (#276): the real sampler works here and does not start a process per sample', { timeout: 60000 }, async () => {
  const cp = require('child_process');
  const names = ['spawn', 'execFile', 'exec', 'fork', 'spawnSync', 'execFileSync', 'execSync'];
  const original = Object.fromEntries(names.map((n) => [n, cp[n]]));
  let started = 0;
  for (const n of names) cp[n] = function spy(...args) { started++; return original[n].apply(this, args); };
  // a fresh copy of the engine's modules, so they bind the spies
  const engineDir = path.join(__dirname, '..', 'src', 'engine') + path.sep;
  for (const k of Object.keys(require.cache)) if (k.startsWith(engineDir)) delete require.cache[k];
  let guard;
  try {
    guard = load().createMemoryGuard({ limitBytes: 1024 * 1024 * GB, floorBytes: 0, intervalMs: 100 });
    const logs = [];
    const handle = guard.watch({ rootPid: process.pid, step: 'test', session: 's', onKill: () => assert.fail('nothing is over the limit'), onLog: (l) => logs.push(l) });
    for (let i = 0; i < 10; i++) await guard.tick();
    await delay(1000);
    handle.stop();
    assert.deepEqual(logs, [], 'the real sampler works on this machine');
    assert.ok(started <= 2, `at most one long-lived helper for ~20 samples, ${started} processes started`);
  } finally {
    guard?.close();
    for (const n of names) cp[n] = original[n];
  }
});

// A child's stdout as lines, with a wait on a line that matches.
function lines(child) {
  const seen = [];
  const waiters = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    for (const line of parts) {
      seen.push({ line, at: Date.now() });
      for (const w of [...waiters]) if (w.test(line)) { waiters.splice(waiters.indexOf(w), 1); w.resolve({ line, at: Date.now() }); }
    }
  });
  const waitFor = (re, ms, what) => {
    const hit = seen.find((s) => re.test(s.line));
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { test: (l) => re.test(l), resolve: (v) => { clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timed out waiting for ${what}`)); }, ms);
      waiters.push(w);
    });
  };
  return { seen, waitFor };
}

// a matcher (anything with test(line)) for "allocated <n>" with n >= mb
const allocatedAtLeast = (mb) => (line) => { const m = /^allocated (\d+)$/.exec(line); return !!m && +m[1] >= mb; };

test('memory guard (#276): on real processes, a run\'s runaway child is stopped within 10 s of passing the limit; its root and an outside process are not', { timeout: 60000 }, async () => {
  // load first: with the module missing the test fails here, before any process is started
  const { createMemoryGuard } = load();
  const fixtures = path.join(__dirname, 'fixtures');
  const marker = `memory-guard-276-${process.pid}`;
  let outside;
  let root;
  let hogPid = null;
  let guard;
  try {
    outside = spawn(process.execPath, [path.join(fixtures, 'memory-hog.js'), '--marker', `${marker}-outside`, '--cap-mb', '300'], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
    const outsideOut = lines(outside);
    await outsideOut.waitFor({ test: allocatedAtLeast(300) }, 20000, 'the outside process to allocate 300 MB');

    guard = createMemoryGuard({ limitBytes: 200 * MB, floorBytes: 0, intervalMs: 500 });
    root = spawn(process.execPath, [path.join(fixtures, 'memory-root.js'), '--marker', `${marker}-inside`, '--cap-mb', '1000'], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
    const rootOut = lines(root);
    hogPid = +(/^child (\d+)$/.exec((await rootOut.waitFor(/^child \d+$/, 10000, 'the child pid')).line)[1]);

    const killed = [];
    const reported = [];
    let onKilled;
    const firstKill = new Promise((resolve) => { onKilled = resolve; });
    guard.watch({
      rootPid: root.pid, step: 'test', session: 'real-1',
      onKill: (e) => { killed.push({ ...e, at: Date.now() }); onKilled(); },
      onReport: (e) => reported.push(e),
    });

    const over = await rootOut.waitFor({ test: allocatedAtLeast(200) }, 20000, 'the child to pass 200 MB');
    await Promise.race([firstKill, delay(20000)]);
    assert.ok(killed.length >= 1, 'the runaway child was stopped');
    const stop = killed.find((e) => e.pid === hogPid);
    assert.ok(stop, `the stop names the child ${hogPid}: ${JSON.stringify(killed.map((e) => e.pid))}`);
    assert.ok(stop.at - over.at < 10000, `stopped ${stop.at - over.at} ms after passing the limit`);
    assert.ok(stop.commandLine.includes(`${marker}-inside`), `the command line has the marker: ${stop.commandLine}`);
    assert.ok(stop.bytes > 200 * MB);
    assert.equal(stop.limitBytes, 200 * MB);
    assert.equal(stop.step, 'test');
    assert.equal(stop.session, 'real-1');

    await rootOut.waitFor(/^child-exit /, 10000, 'the child to end');
    await delay(1500); // three more samples
    assert.ok(alive(root.pid), 'the agent CLI\'s root process is never stopped');
    assert.ok(alive(outside.pid), 'a process outside the run\'s tree is never stopped');
    assert.ok(!killed.some((e) => e.pid === outside.pid || e.pid === root.pid));
  } finally {
    guard?.close();
    killPid(hogPid);
    killPid(root?.pid);
    killPid(outside?.pid);
  }
});
