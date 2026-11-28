// #406 "Stray-process alerts flag a resumed run's own processes": acceptance tests written before
// the code.
//
// A run resumed from a step (#250) gets a new id but works in the earlier run's worktree
// (worktrees/<earlier id>). The stray check (#390) must count that folder (and its -base sibling) as
// live while any run using it is in progress, here or in another app process; name a stray under it
// with the last run that used it; and memory:stopStray must refuse a process under a worktree a live
// run uses, whatever run the stray was flagged for.
//
// Seams:
// - The runs area (packages/engine/service/areas/runs.js) `watchStrayProcesses()`: it hands the app's guard
//   `{ runs, onStray }` through `sharedMemoryGuard().watchStrays` (the #390 contract). The test takes
//   what it hands over and gives it to a guard made with a fake process sampler and clock
//   (createMemoryGuard, the system boundary: the machine's processes and time), so what is checked is
//   the guard's observable result: strayProcesses(), the notifications, stopStray.
// - The guard alone (createMemoryGuard): stopStray refuses a process under a live run's worktree.
// Run folders are written by hand the way the engine leaves them: workflow.started (resumed_from),
// worktree.ready (dir), summary.json (status, worktree.dir) once finished, owner.json while alive.
// "Alive in another app process" = an owner.json of another live process of this host (process.ppid).
//
// Assumptions:
// - The area may tell liveness from its `active` runs (a WorkflowRun with status, worktree.dir and
//   resume.worktree.dir) and from the run folders on disk; both are written here.
// - watchStrayProcesses() returns early in simulation-only mode: the test clears
//   CRAFTORIO_SIMULATION_ONLY around the call (restored after) and never starts a run.
// Modules are required inside each test, so this file loads before the code exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FINISHED = '20261015-114050-7aaa0962';
const RESUMED = '20261015-131216-eb7d74a7';
const T0 = Date.parse('2026-10-15T11:40:50.000Z');
const iso = (ms) => new Date(ms).toISOString();

const loadArea = () => require('../../service/areas/runs');
const loadGuard = () => require('../../engine/memory-guard');
const loadWorkspace = () => require('../../domains/workspace/workspace');
const loadNotifier = () => require('../../domains/workspace/notifications');

/** A run folder as the engine leaves it; `alive`: owner.json of another live process, no summary. */
function writeRun(runsDir, runId, { status, worktree, resumedFrom = null, startMs = T0, alive = false }) {
  const dir = path.join(runsDir, runId);
  fs.mkdirSync(dir, { recursive: true });
  const events = [
    { ts: iso(startMs), type: 'workflow.started', run_id: runId, workflow: 'software-development', file: 'software-development.yaml', inputs: { task: 'x' },
      ...(resumedFrom ? { resumed_from: { run_id: resumedFrom, step: 'develop' } } : {}) },
    { ts: iso(startMs + 1000), type: 'worktree.ready', dir: worktree, work_dir: worktree, reused: !!resumedFrom },
    { ts: iso(startMs + 2000), type: 'step.started', step_id: 'develop', visit: 1, step_type: 'agent', agent: 'developer' },
  ];
  if (alive) {
    fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.ppid, host: os.hostname(), started_at: iso(Date.now()), heartbeat_at: iso(Date.now()) }));
  } else {
    fs.rmSync(path.join(dir, 'owner.json'), { force: true });
    const summary = {
      run_id: runId, workflow: 'software-development', status, started_at: iso(startMs), finished_at: iso(startMs + 600e3), duration_ms: 600e3,
      cost_usd: 0, sessions: [], ...(resumedFrom ? { resumed_from: { run_id: resumedFrom, step: 'develop' } } : {}),
      worktree: { dir: worktree, work_dir: worktree, branch: 'fix-375' },
    };
    events.push({ ts: iso(startMs + 600e3), type: 'workflow.finished', status, summary });
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary));
  }
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

/**
 * A scratch workspace with the finished run's worktree (and its -base) and the runs area on it.
 * Returns { ws, area, wt, base, notices, check(procsOf) } where check() builds a guard on what the
 * area hands the app's guard, with a fake sampler (procsOf(cpuMs)) and clock.
 */
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-406-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ws = loadWorkspace().setupWorkspace(dir, { persist: false });
  const wt = path.join(ws.worktrees, FINISHED);
  const base = path.join(ws.worktrees, `${FINISHED}-base`);
  fs.mkdirSync(wt, { recursive: true });
  fs.mkdirSync(base, { recursive: true });
  writeRun(ws.runs, FINISHED, { status: 'failed', worktree: wt });
  const notices = [];
  // #129: the guard is off by default; the stray watch only works with it turned on
  const guardOn = { enabled: true, limitPercent: 30, floorPercent: 10 };
  fs.writeFileSync(ws.settings, JSON.stringify({ memoryGuard: guardOn }));
  const area = loadArea()({ ws, events: new EventEmitter(), notify: (n) => notices.push(n) });

  const { sharedMemoryGuard, createMemoryGuard, configureMemoryGuard } = loadGuard();
  configureMemoryGuard(guardOn);
  t.after(() => configureMemoryGuard({ enabled: false, limitPercent: 25, floorPercent: 10 }));
  const shared = sharedMemoryGuard();
  assert.ok(shared, 'the memory guard is turned on');
  const original = shared.watchStrays;
  let handed = null;
  shared.watchStrays = (next) => { handed = next; };
  const sim = process.env.CRAFTORIO_SIMULATION_ONLY;
  delete process.env.CRAFTORIO_SIMULATION_ONLY;
  try { area.watchStrayProcesses(); } finally {
    process.env.CRAFTORIO_SIMULATION_ONLY = sim;
    shared.watchStrays = original;
  }
  assert.equal(typeof handed?.runs, 'function', 'watchStrayProcesses hands the guard its runs');

  const guards = [];
  t.after(() => guards.forEach((g) => g.close()));
  const check = (procsOf) => {
    let cpu = 0;
    let clock = 0;
    const killed = [];
    const guard = createMemoryGuard({
      limitBytes: 1024 ** 4, floorBytes: 0, intervalMs: 60000, strayIntervalMs: 60000,
      sampler: async () => procsOf(cpu), freeMemory: async () => null, kill: async (pid) => { killed.push(pid); }, now: () => clock,
      runs: handed.runs, onStray: handed.onStray,
    });
    guards.push(guard);
    // one sample, then one where the processes used 90% of a core
    const busyTick = async () => { await guard.tick(); cpu += 9000; clock += 10000; await guard.tick(); };
    return { guard, killed, busyTick };
  };
  return { ws, area, wt, base, notices, check };
}

const suiteUnder = (dir, pid = 4242) => (cpuMs) => [
  { pid, ppid: 1, commandLine: `node --test ${path.join(dir, 'test', 'service', 'channel-sweep-runner.js')}`, bytes: 1, cpuMs },
];
const strayList = async (guard) => (await guard.strayProcesses()).map((s) => [s.pid, s.runId]);

// ---- a worktree in use is live --------------------------------------------------------------------

test('#406 a run resumed into an earlier run\'s worktree, alive in another app process: its processes are not strays', async (t) => {
  const { ws, wt, notices, check } = setup(t);
  writeRun(ws.runs, RESUMED, { status: 'running', worktree: wt, resumedFrom: FINISHED, startMs: T0 + 5400e3, alive: true });
  const { guard, busyTick } = check(suiteUnder(wt));
  await busyTick();
  assert.deepEqual(await strayList(guard), [], 'the resumed run\'s suite is not a stray');
  assert.equal(notices.length, 0, 'no notification');
});

test('#406 a run resumed into an earlier run\'s worktree, in progress in this app: its processes are not strays', async (t) => {
  const { ws, area, wt, notices, check } = setup(t);
  writeRun(ws.runs, RESUMED, { status: 'running', worktree: wt, resumedFrom: FINISHED, startMs: T0 + 5400e3 });
  fs.rmSync(path.join(ws.runs, RESUMED, 'summary.json'), { force: true });
  area.active.set(RESUMED, { runId: RESUMED, status: 'running', worktree: { dir: wt, workDir: wt }, resume: { worktree: { dir: wt, branch: 'fix-375' } } });
  const { guard, busyTick } = check(suiteUnder(wt));
  await busyTick();
  assert.deepEqual(await strayList(guard), [], 'the resumed run\'s suite is not a stray');
  assert.equal(notices.length, 0, 'no notification');
});

test('#406 the -base folder of a worktree a resumed run uses is live too', async (t) => {
  const { ws, wt, base, notices, check } = setup(t);
  writeRun(ws.runs, RESUMED, { status: 'running', worktree: wt, resumedFrom: FINISHED, startMs: T0 + 5400e3, alive: true });
  const { guard, busyTick } = check(suiteUnder(base));
  await busyTick();
  assert.deepEqual(await strayList(guard), [], 'a process under the -base folder is not a stray');
  assert.equal(notices.length, 0, 'no notification');
});

// ---- stop never touches a live run ----------------------------------------------------------------

test('#406 stopStray refuses a process flagged for the finished run once a resumed run uses its worktree', async (t) => {
  const { ws, wt, check } = setup(t);
  const { guard, killed, busyTick } = check(suiteUnder(wt));
  await busyTick();
  assert.deepEqual(await strayList(guard), [[4242, FINISHED]], 'flagged while nobody used the worktree');
  // the owner resumes the run into the same worktree before stopping the stray
  writeRun(ws.runs, RESUMED, { status: 'running', worktree: wt, resumedFrom: FINISHED, startMs: T0 + 5400e3, alive: true });
  await assert.rejects(guard.stopStray(4242), /running|live/i);
  assert.deepEqual(killed, [], 'nothing was stopped');
});

test('#406 guard: stopStray refuses a process under a worktree a live run uses, whatever run it was flagged for', async (t) => {
  const { createMemoryGuard } = loadGuard();
  const wt = path.join(os.tmpdir(), 'ws-406-guard', 'worktrees', FINISHED);
  let list = [{ id: FINISHED, worktree: wt, live: false }];
  let cpu = 0;
  let clock = 0;
  const killed = [];
  const guard = createMemoryGuard({
    limitBytes: 1024 ** 4, floorBytes: 0, intervalMs: 60000, strayIntervalMs: 60000,
    sampler: async () => suiteUnder(wt)(cpu), freeMemory: async () => null, kill: async (pid) => { killed.push(pid); }, now: () => clock,
    runs: () => list,
  });
  t.after(() => guard.close());
  await guard.tick();
  cpu = 9000; clock = 10000;
  await guard.tick();
  assert.deepEqual(await strayList(guard), [[4242, FINISHED]]);
  list = [{ id: FINISHED, worktree: wt, live: false }, { id: RESUMED, worktree: wt, live: true }];
  await assert.rejects(guard.stopStray(4242), /running|live/i);
  assert.deepEqual(killed, [], 'nothing was stopped');
});

// ---- the notice names the right run ---------------------------------------------------------------

test('#406 after the resumed run ends, a leftover process under the worktree is flagged once with the resumed run\'s id', async (t) => {
  const { ws, wt, notices, check } = setup(t);
  writeRun(ws.runs, RESUMED, { status: 'success', worktree: wt, resumedFrom: FINISHED, startMs: T0 + 5400e3 });
  const { guard, busyTick } = check(suiteUnder(wt));
  await busyTick();
  assert.deepEqual(await strayList(guard), [[4242, RESUMED]]);
  await busyTick();
  assert.equal(notices.length, 1, 'one notification per process');
  assert.match(notices[0].title, new RegExp(RESUMED));
  assert.doesNotMatch(notices[0].title, new RegExp(FINISHED));
  assert.deepEqual(notices[0].target, { runId: RESUMED });
});

test('#406 after the resumed run ends, a leftover process under the -base folder is named with the resumed run too', async (t) => {
  const { ws, wt, base, check } = setup(t);
  writeRun(ws.runs, RESUMED, { status: 'failed', worktree: wt, resumedFrom: FINISHED, startMs: T0 + 5400e3 });
  const { guard, busyTick } = check(suiteUnder(base));
  await busyTick();
  assert.deepEqual(await strayList(guard), [[4242, RESUMED]]);
});

// ---- a chain resumed twice (C from B from A, all in worktrees/A) -----------------------------------

const AGAIN = '20261015-150000-c0ffee00';

test('#406 a run resumed twice: while the second resume lives, its processes in the first run\'s worktree are not strays', async (t) => {
  const { ws, wt, notices, check } = setup(t);
  writeRun(ws.runs, RESUMED, { status: 'failed', worktree: wt, resumedFrom: FINISHED, startMs: T0 + 5400e3 });
  writeRun(ws.runs, AGAIN, { status: 'running', worktree: wt, resumedFrom: RESUMED, startMs: T0 + 12000e3, alive: true });
  const { guard, busyTick } = check(suiteUnder(wt));
  await busyTick();
  assert.deepEqual(await strayList(guard), []);
  assert.equal(notices.length, 0, 'no notification');
});

test('#406 a run resumed twice: after the second resume ends, a leftover process is named with it', async (t) => {
  const { ws, wt, notices, check } = setup(t);
  writeRun(ws.runs, RESUMED, { status: 'failed', worktree: wt, resumedFrom: FINISHED, startMs: T0 + 5400e3 });
  writeRun(ws.runs, AGAIN, { status: 'success', worktree: wt, resumedFrom: RESUMED, startMs: T0 + 12000e3 });
  const { guard, busyTick } = check(suiteUnder(wt));
  await busyTick();
  assert.deepEqual(await strayList(guard), [[4242, AGAIN]]);
  assert.deepEqual(notices.map((n) => n.target), [{ runId: AGAIN }]);
});

test('#406 a run that worked in its own worktree is not taken as the last user of another run\'s folder', async (t) => {
  const { ws, wt, check } = setup(t);
  const other = path.join(ws.worktrees, AGAIN);
  fs.mkdirSync(other, { recursive: true });
  writeRun(ws.runs, AGAIN, { status: 'success', worktree: other, startMs: T0 + 12000e3 });
  const { guard, busyTick } = check(suiteUnder(wt));
  await busyTick();
  assert.deepEqual(await strayList(guard), [[4242, FINISHED]]);
});

// ---- what must not change -------------------------------------------------------------------------

test('#406 a worktree nobody resumed: a busy process left under it is flagged once with its own run', async (t) => {
  const { wt, notices, check } = setup(t);
  const { guard, busyTick } = check(suiteUnder(wt));
  await busyTick();
  assert.deepEqual(await strayList(guard), [[4242, FINISHED]]);
  await busyTick();
  assert.equal(notices.length, 1, 'one notification per process');
  assert.deepEqual(notices[0], loadNotifier().strayNotice((await guard.strayProcesses())[0]));
});
