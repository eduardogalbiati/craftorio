// #414: a run's tests write their scratch files in the run's own temp folder (runs/<id>/tmp). The
// stray-process watcher (#390, #406) must attribute a process whose files are under runs/<id>/tmp
// to run <id>: flagged with that run once it has ended, never flagged while it is in progress.
//
// Seam: the runs area (packages/engine/service/areas/runs.js) `watchStrayProcesses()` hands the app's guard
// `{ runs, onStray }`; the test gives that to a guard made with a fake process sampler and clock
// (createMemoryGuard, the system boundary), and checks guard.strayProcesses() and the notifications.
// The same harness as test/service/stray-resumed-worktree-406.test.js.
//
// Assumptions:
// - A resumed run (#250) gets its own id, so its tests write under runs/<resumed id>/tmp although it
//   works in the earlier run's worktree; such a process is named with the resumed run.
// - watchStrayProcesses() returns early in simulation-only mode: the test clears
//   MULTIAGENT_SIMULATION_ONLY around the call (restored after) and never starts a run.
// Modules are required inside each test, so this file loads before the code exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FINISHED = '20261015-212604-8f1f5b9a';
const RESUMED = '20261015-231000-eb7d7414';
const T0 = Date.parse('2026-10-15T21:26:04.000Z');
const iso = (ms) => new Date(ms).toISOString();

const loadArea = () => require('../../service/areas/runs');
const loadGuard = () => require('../../engine/memory-guard');
const loadWorkspace = () => require('../../domains/workspace/workspace');

/** A run folder as the engine leaves it; `alive`: owner.json of another live process, no summary. */
function writeRun(runsDir, runId, { status, worktree, resumedFrom = null, startMs = T0, alive = false }) {
  const dir = path.join(runsDir, runId);
  fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  const events = [
    { ts: iso(startMs), type: 'workflow.started', run_id: runId, workflow: 'software-development', file: 'software-development.yaml', inputs: { task: 'x' },
      ...(resumedFrom ? { resumed_from: { run_id: resumedFrom, step: 'develop' } } : {}) },
    { ts: iso(startMs + 1000), type: 'worktree.ready', dir: worktree, work_dir: worktree, reused: !!resumedFrom },
    { ts: iso(startMs + 2000), type: 'step.started', step_id: 'develop', visit: 1, step_type: 'agent', agent: 'developer' },
  ];
  if (alive) {
    fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.ppid, host: os.hostname(), started_at: iso(Date.now()), heartbeat_at: iso(Date.now()) }));
  } else {
    const summary = {
      run_id: runId, workflow: 'software-development', status, started_at: iso(startMs), finished_at: iso(startMs + 600e3), duration_ms: 600e3,
      cost_usd: 0, sessions: [], ...(resumedFrom ? { resumed_from: { run_id: resumedFrom, step: 'develop' } } : {}),
      worktree: { dir: worktree, work_dir: worktree, branch: 'fix-414' },
    };
    events.push({ ts: iso(startMs + 600e3), type: 'workflow.finished', status, summary });
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary));
  }
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

/** A scratch workspace with a finished run (its worktree still there) and the runs area on it. */
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-414-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ws = loadWorkspace().setupWorkspace(dir, { persist: false });
  const wt = path.join(ws.worktrees, FINISHED);
  fs.mkdirSync(wt, { recursive: true });
  writeRun(ws.runs, FINISHED, { status: 'failed', worktree: wt });
  const notices = [];
  const area = loadArea()({ ws, events: new EventEmitter(), notify: (n) => notices.push(n) });

  const { sharedMemoryGuard, createMemoryGuard } = loadGuard();
  const shared = sharedMemoryGuard();
  assert.ok(shared, 'the memory guard is on by default');
  const original = shared.watchStrays;
  let handed = null;
  shared.watchStrays = (next) => { handed = next; };
  const sim = process.env.MULTIAGENT_SIMULATION_ONLY;
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  try { area.watchStrayProcesses(); } finally {
    process.env.MULTIAGENT_SIMULATION_ONLY = sim;
    shared.watchStrays = original;
  }
  assert.equal(typeof handed?.runs, 'function', 'watchStrayProcesses hands the guard its runs');

  const guards = [];
  t.after(() => guards.forEach((g) => g.close()));
  const check = (procsOf) => {
    let cpu = 0;
    let clock = 0;
    const guard = createMemoryGuard({
      limitBytes: 1024 ** 4, floorBytes: 0, intervalMs: 60000, strayIntervalMs: 60000,
      sampler: async () => procsOf(cpu), freeMemory: async () => null, kill: async () => {}, now: () => clock,
      runs: handed.runs, onStray: handed.onStray,
    });
    guards.push(guard);
    // one sample, then one where the process used 90% of a core
    const busyTick = async () => { await guard.tick(); cpu += 9000; clock += 10000; await guard.tick(); };
    return { guard, busyTick };
  };
  return { ws, wt, notices, check };
}

// a test's child process running a script it wrote in the run's temp folder
const helperUnder = (tmp, pid = 4242) => (cpuMs) => [
  { pid, ppid: 1, commandLine: `node ${path.join(tmp, 'gitcfg-x1y2', 'hook.js')}`, bytes: 1, cpuMs },
];
const strayList = async (guard) => (await guard.strayProcesses()).map((s) => [s.pid, s.runId]);

test('#414 a busy process left under a finished run\'s runs/<id>/tmp is flagged with that run', async (t) => {
  const { ws, notices, check } = setup(t);
  const { guard, busyTick } = check(helperUnder(path.join(ws.runs, FINISHED, 'tmp')));
  await busyTick();
  assert.deepEqual(await strayList(guard), [[4242, FINISHED]]);
  assert.deepEqual(notices.map((n) => n.target), [{ runId: FINISHED }]);
});

test('#414 a process under the tmp of a run in progress (resumed into an earlier worktree, alive in another app process) is not a stray', async (t) => {
  const { ws, wt, notices, check } = setup(t);
  writeRun(ws.runs, RESUMED, { status: 'running', worktree: wt, resumedFrom: FINISHED, startMs: T0 + 5400e3, alive: true });
  const { guard, busyTick } = check(helperUnder(path.join(ws.runs, RESUMED, 'tmp')));
  await busyTick();
  assert.deepEqual(await strayList(guard), [], 'a live run\'s test helper is not a stray');
  assert.equal(notices.length, 0, 'no notification');
});

test('#414 after a resumed run ends, a busy process left under its own runs/<id>/tmp is flagged with the resumed run', async (t) => {
  const { ws, wt, notices, check } = setup(t);
  writeRun(ws.runs, RESUMED, { status: 'success', worktree: wt, resumedFrom: FINISHED, startMs: T0 + 5400e3 });
  const { guard, busyTick } = check(helperUnder(path.join(ws.runs, RESUMED, 'tmp')));
  await busyTick();
  assert.deepEqual(await strayList(guard), [[4242, RESUMED]]);
  assert.deepEqual(notices.map((n) => n.target), [{ runId: RESUMED }]);
});
