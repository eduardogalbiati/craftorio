// #367 Machine profile: parallel runs and test workers sized from the machine, shown and overridable.
// Written before the code exists: every module the change creates is required inside each test, so
// this file loads and each test fails on its own.
//
// The API these tests pin down (packages/engine/domains/machine/machine-profile.js; it may re-export pure parts that live in a
// packages/shared/ dual-load module so the renderer can use them too):
//
//   CONSTANTS -> { THREADS_PER_RUN: 4, GB_PER_RUN: 6, MIN_RUNS: 1, MAX_RUNS: 6, ... } (one place)
//   readMachine(osLike = require('os')) -> { threads, totalBytes, freeBytes, platform }
//     threads: osLike.availableParallelism() when it exists, else osLike.cpus().length;
//     totalBytes: osLike.totalmem(); freeBytes: osLike.freemem(); platform: osLike.platform().
//     A value that throws, or is 0 / empty / not a number, is null (never throws itself).
//   machineWorkers(threads) -> integer in [1, threads]: "the machine's workers" (the #366 rule).
//   proposeLimits({ threads, totalBytes }) -> { concurrentRuns, testWorkers } or null when threads or
//     totalBytes is null. totalGB = totalBytes / 1024^3;
//     concurrentRuns = clamp(1, 6, min(floor(threads / 4), floor(totalGB / 6)));
//     testWorkers = max(1, floor(machineWorkers(threads) / concurrentRuns)).
//   resolveLimits(settings, machine) -> { state, concurrentRuns, testWorkers, machine }
//     settings: the workspace settings; the owner's choice is settings.machineProfile =
//     { mode: 'auto' | 'manual', concurrentRuns, testWorkers } (missing = auto).
//     manual: state 'manual' and the manual values, whatever the machine (even unknown);
//     auto + readable machine: state 'auto' and proposeLimits(machine);
//     auto + unreadable machine: state 'unknown' and today's defaults (2 concurrent runs).
//   machineLine(resolved) -> one line for Setup and Settings › Execution, e.g.
//     "This machine: 20 threads, 32 GB → up to 5 runs at once, 1 test worker per run"
//     (GB = totalBytes / 1024^3 rounded); for 'unknown' it says the values could not be read.
//   suggestFromMemoryGuard(events, { now, concurrentRuns }) -> null or
//     { days: ['YYYY-MM-DD', ...] (sorted, local days), runs: [run ids] (sorted, unique), concurrentRuns }
//     events: run events as written to <workspace>/runs/<id>/events.jsonl ({ type, ts (ISO), run_id }):
//     'memory.hold' (packages/engine/engine/run/machine-steps.js) and 'process.killed' (packages/engine/engine/run/turns.js)
//     count, any other type is ignored; only the 7 days before `now` count; a suggestion needs 2+
//     distinct days and proposes concurrentRuns - 1 (never under 1: at 1 there is no suggestion).
//     Pure: it changes nothing (the owner's Apply click does).
//   workerEnv({ testWorkers }) -> { CRAFTORIO_TEST_WORKERS: '<n>', CRAFTORIO_E2E_WORKERS: '<n>' }
//
// Existing seams that gain the env (packages/engine/engine/capabilities.js, packages/engine/engine/suite-step.js):
//   capabilities.agentEnv(scratch, { testWorkers }) adds workerEnv; without the second argument it
//     is unchanged (test/capabilities.test.js).
//   suiteEnv(env, { locksDir, testWorkers }) sets both variables (it drops the inherited CRAFTORIO_*).
//
// Note: the #366 "machine's workers" rule is not in the repository yet, so the test-worker numbers
// are checked against machineWorkers(threads) rather than literal values.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const load = () => require('../../domains/machine/machine-profile');
const capabilities = require('../../engine/capabilities');
const suiteStep = require('../../engine/suite-step');
const workspace = require('../../domains/workspace/workspace');

const GIB = 1024 ** 3;
// sample machines: [threads, total bytes as os.totalmem() reports them (a little under nominal), runs]
const SAMPLES = [
  { name: '8 threads / 16 GB', threads: 8, totalBytes: 16 * GIB, runs: 2 },
  { name: '12 threads / 16 GB', threads: 12, totalBytes: 17_013_587_968, runs: 2 },
  { name: '20 threads / 32 GB', threads: 20, totalBytes: 34_093_666_304, runs: 5 },
  { name: '32 threads / 64 GB', threads: 32, totalBytes: 64 * GIB, runs: 6 },
];
const machine = (threads, totalBytes) => ({ threads, totalBytes, freeBytes: Math.round(totalBytes / 2), platform: 'win32' });
const fakeOs = (o = {}) => ({
  availableParallelism: () => 20,
  cpus: () => new Array(20).fill({ model: 'cpu' }),
  totalmem: () => 32 * GIB,
  freemem: () => 12 * GIB,
  platform: () => 'win32',
  ...o,
});

test('constants: the formula\'s numbers live in one exported place (4 threads and 6 GB per run, 1..6 runs)', () => {
  const { CONSTANTS } = load();
  assert.equal(CONSTANTS.THREADS_PER_RUN, 4);
  assert.equal(CONSTANTS.GB_PER_RUN, 6);
  assert.equal(CONSTANTS.MIN_RUNS, 1);
  assert.equal(CONSTANTS.MAX_RUNS, 6);
});

test('proposeLimits: concurrent runs on sample machines (8/16 -> 2, 12/16 -> 2, 20/32 -> 5, 32/64 -> 6)', () => {
  const { proposeLimits } = load();
  for (const s of SAMPLES) {
    assert.equal(proposeLimits(machine(s.threads, s.totalBytes)).concurrentRuns, s.runs, s.name);
  }
});

test('proposeLimits: test workers per run = the machine\'s workers divided by the concurrent runs, at least 1', () => {
  const { proposeLimits, machineWorkers } = load();
  for (const s of SAMPLES) {
    const workers = machineWorkers(s.threads);
    assert.equal(Number.isInteger(workers) && workers >= 1 && workers <= s.threads, true, `machineWorkers(${s.threads}) = ${workers}`);
    const p = proposeLimits(machine(s.threads, s.totalBytes));
    assert.equal(p.testWorkers, Math.max(1, Math.floor(workers / s.runs)), s.name);
  }
});

test('proposeLimits: a small machine still gets 1 run and 1 test worker (the clamp\'s low end)', () => {
  const { proposeLimits } = load();
  const p = proposeLimits(machine(2, 4 * GIB));
  assert.equal(p.concurrentRuns, 1);
  assert.equal(p.testWorkers >= 1, true);
});

test('readMachine: reads threads (availableParallelism first), total and free memory and the OS from os', () => {
  const { readMachine } = load();
  const m = readMachine(fakeOs({ availableParallelism: () => 20, cpus: () => new Array(16).fill({}) }));
  assert.equal(m.threads, 20);
  assert.equal(m.totalBytes, 32 * GIB);
  assert.equal(m.freeBytes, 12 * GIB);
  assert.equal(m.platform, 'win32');
  const old = readMachine(fakeOs({ availableParallelism: undefined, cpus: () => new Array(12).fill({}) }));
  assert.equal(old.threads, 12);
});

test('unknown machine: values that throw or read 0 are null, nothing is proposed, today\'s defaults apply', () => {
  const { readMachine, proposeLimits, resolveLimits } = load();
  const boom = () => { throw new Error('not available'); };
  for (const osLike of [
    fakeOs({ availableParallelism: boom, cpus: boom, totalmem: boom, freemem: boom }),
    fakeOs({ availableParallelism: () => 0, cpus: () => [], totalmem: () => 0, freemem: () => 0 }),
  ]) {
    const m = readMachine(osLike);
    assert.equal(m.threads, null);
    assert.equal(m.totalBytes, null);
    assert.equal(proposeLimits(m), null);
    const r = resolveLimits({}, m);
    assert.equal(r.state, 'unknown');
    assert.equal(r.concurrentRuns, 2);
    assert.equal(Number.isInteger(r.testWorkers) && r.testWorkers >= 1, true, `testWorkers ${r.testWorkers}`);
  }
});

test('auto: a fresh workspace is in auto mode and gets the machine\'s proposal', () => {
  const { resolveLimits, proposeLimits } = load();
  assert.equal(workspace.DEFAULT_SETTINGS.machineProfile?.mode, 'auto');
  const m = machine(20, 34_093_666_304);
  const p = proposeLimits(m);
  for (const settings of [{}, { machineProfile: { mode: 'auto' } }, { ...workspace.DEFAULT_SETTINGS }]) {
    const r = resolveLimits(settings, m);
    assert.equal(r.state, 'auto');
    assert.equal(r.concurrentRuns, p.concurrentRuns);
    assert.equal(r.testWorkers, p.testWorkers);
  }
});

test('manual wins over auto and stays when the machine changes or cannot be read', () => {
  const { resolveLimits } = load();
  const settings = { machineProfile: { mode: 'manual', concurrentRuns: 3, testWorkers: 1 } };
  for (const m of [machine(8, 16 * GIB), machine(32, 64 * GIB), { threads: null, totalBytes: null, freeBytes: null, platform: null }]) {
    const r = resolveLimits(settings, m);
    assert.equal(r.state, 'manual');
    assert.equal(r.concurrentRuns, 3);
    assert.equal(r.testWorkers, 1);
  }
});

test('machineLine: one line with the machine and what it gets ("This machine: 20 threads, 32 GB → up to 5 runs at once, …")', () => {
  const { resolveLimits, machineLine } = load();
  const r = resolveLimits({}, machine(20, 34_093_666_304));
  const line = machineLine(r);
  assert.match(line, /This machine: 20 threads, 32 GB/);
  assert.match(line, /up to 5 runs at once/);
  assert.match(line, new RegExp(`\\b${r.testWorkers} test workers? per run`));
});

test('machineLine: an unreadable machine says so, never NaN, undefined or null', () => {
  const { resolveLimits, machineLine } = load();
  const line = machineLine(resolveLimits({}, { threads: null, totalBytes: null, freeBytes: null, platform: null }));
  assert.match(line, /could ?n[o']t be read/i);
  assert.doesNotMatch(line, /NaN|undefined|null|Infinity/);
});

// seeded memory-guard events: run events as in <workspace>/runs/<id>/events.jsonl
const NOW = Date.parse('2026-10-13T12:00:00Z');
const ev = (type, iso, runId) => ({ type, ts: iso, run_id: runId, step_id: 'suite' });

test('suggestFromMemoryGuard: held or stopped runs on 2 days this week -> lower to one run fewer, with the days and runs', () => {
  const { suggestFromMemoryGuard } = load();
  const events = [
    ev('memory.hold', '2026-10-10T12:00:00Z', 'run-a'),
    ev('process.killed', '2026-10-10T13:00:00Z', 'run-b'),
    ev('process.killed', '2026-10-12T12:00:00Z', 'run-a'),
    ev('log', '2026-10-11T12:00:00Z', 'run-c'),
    ev('workflow.finished', '2026-10-09T12:00:00Z', 'run-d'),
  ];
  const s = suggestFromMemoryGuard(events, { now: NOW, concurrentRuns: 4 });
  assert.notEqual(s, null);
  assert.equal(s.concurrentRuns, 3);
  assert.equal(JSON.stringify(s.days), JSON.stringify(['2026-10-10', '2026-10-12']));
  assert.equal(JSON.stringify(s.runs), JSON.stringify(['run-a', 'run-b']));
});

test('suggestFromMemoryGuard: no suggestion for one day, for days older than 7 days, or at 1 run already', () => {
  const { suggestFromMemoryGuard } = load();
  const oneDay = [ev('memory.hold', '2026-10-12T09:00:00Z', 'r1'), ev('process.killed', '2026-10-12T15:00:00Z', 'r2')];
  assert.equal(suggestFromMemoryGuard(oneDay, { now: NOW, concurrentRuns: 4 }), null);
  const old = [ev('memory.hold', '2026-10-01T12:00:00Z', 'r1'), ev('process.killed', '2026-10-03T12:00:00Z', 'r2'), ev('process.killed', '2026-10-12T12:00:00Z', 'r3')];
  assert.equal(suggestFromMemoryGuard(old, { now: NOW, concurrentRuns: 4 }), null);
  const twoDays = [ev('memory.hold', '2026-10-10T12:00:00Z', 'r1'), ev('process.killed', '2026-10-12T12:00:00Z', 'r2')];
  assert.equal(suggestFromMemoryGuard(twoDays, { now: NOW, concurrentRuns: 1 }), null);
  assert.equal(suggestFromMemoryGuard([], { now: NOW, concurrentRuns: 4 }), null);
});

test('suggestFromMemoryGuard changes nothing by itself: the events and the settings it read are left as they were', () => {
  const { suggestFromMemoryGuard, resolveLimits } = load();
  const settings = { machineProfile: { mode: 'manual', concurrentRuns: 4, testWorkers: 2 } };
  const events = [ev('memory.hold', '2026-10-10T12:00:00Z', 'r1'), ev('process.killed', '2026-10-12T12:00:00Z', 'r2')];
  const before = JSON.stringify({ settings, events });
  const s = suggestFromMemoryGuard(events, { now: NOW, concurrentRuns: resolveLimits(settings, machine(20, 32 * GIB)).concurrentRuns });
  assert.equal(s?.concurrentRuns, 3);
  assert.equal(JSON.stringify({ settings, events }), before);
  assert.equal(resolveLimits(settings, machine(20, 32 * GIB)).concurrentRuns, 4);
});

test('workerEnv: the per-run value as CRAFTORIO_TEST_WORKERS and CRAFTORIO_E2E_WORKERS (strings)', () => {
  const { workerEnv } = load();
  assert.equal(JSON.stringify(workerEnv({ testWorkers: 3 })), JSON.stringify({ CRAFTORIO_TEST_WORKERS: '3', CRAFTORIO_E2E_WORKERS: '3' }));
});

test('a run\'s agents get the workers in their environment (capabilities.agentEnv), unchanged without them', () => {
  const scratch = { workspace: 'C:/run/scratch/workspace', userData: 'C:/run/scratch/user-data' };
  const env = capabilities.agentEnv(scratch, { testWorkers: 2 });
  assert.equal(env.CRAFTORIO_TEST_WORKERS, '2');
  assert.equal(env.CRAFTORIO_E2E_WORKERS, '2');
  assert.equal(env.CRAFTORIO_SIMULATION_ONLY, '1');
  assert.equal(env.CRAFTORIO_WORKSPACE, scratch.workspace);
  assert.equal('CRAFTORIO_TEST_WORKERS' in capabilities.agentEnv(scratch), false);
});

test('the suite the engine runs gets the run\'s workers, not an inherited value (suiteEnv)', () => {
  const { env } = suiteStep.suiteEnv({ PATH: '/bin', CRAFTORIO_TEST_WORKERS: '9', CRAFTORIO_E2E_WORKERS: '9' }, { testWorkers: 2 });
  assert.equal(env.CRAFTORIO_TEST_WORKERS, '2');
  assert.equal(env.CRAFTORIO_E2E_WORKERS, '2');
  assert.equal(env.PATH, '/bin');
});

test('test and build skills tell agents to pass CRAFTORIO_TEST_WORKERS to the runner', () => {
  const skills = path.join(__dirname, '..', '..', '..', '..', 'skills');
  const names = fs.readdirSync(skills).filter((n) => /^(unit-test-writer|e2e-test-writer|build-audit)-/.test(n)).sort();
  assert.equal(names.length >= 18, true, `found ${names.join(', ')}`);
  const missing = names.filter((n) => !fs.readFileSync(path.join(skills, n, 'SKILL.md'), 'utf8').includes('CRAFTORIO_TEST_WORKERS'));
  assert.deepEqual(missing, []);
});
