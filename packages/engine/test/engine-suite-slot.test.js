// One whole-suite round at a time per machine (#455): a `type: suite` round that runs the whole suite
// takes the machine-wide `suite` slot (packages/engine/engine/machine-slot.js, like the screenshot slot of #199)
// before its command starts and frees it when the round ends, however it ends; a focused round (a
// list of test files) and the simulated suite never take it. While another run holds it, the round
// waits and the engine logs `kind: suite_slot` naming the holder (run, pid); the wait is not counted
// in the round's timeout or duration. A dead holder, or a hold older than the suite's own limit
// (SUITE_MAX_HOLD_MS), is taken over. A child the round starts (the suite's own `npm test`) inherits
// the slot through SUITE_SLOT_ENV, as SCREENSHOT_SLOT_ENV does for screenshots.
// runSuite gets the slot through `slot: { dir, holder, onWait, pollMs }` (no `slot`: no slot taken,
// as the existing runSuite tests call it) and a stubbed `run`, so no process is spawned. The engine
// tests call WorkflowRun.prototype.suiteRound on a small run state (like
// test/release-focused-no-commit-364.test.js) whose machine runs the real runSuite with a stubbed
// `run`; the machine-wide folder is a temp folder (TEMP/TMP and MULTIAGENT_LOCKS_DIR point at it).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const machineSlot = require('../engine/machine-slot');
const suiteStep = require('../engine/suite-step');
const { WorkflowRun } = require('../engine/workflow');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const tmp = (t, prefix = 'suite-slot-') => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
};

const SLOT = 'suite';
const slotPath = (dir) => path.join(dir, `${SLOT}.slot`);
const readHold = (dir) => { try { return JSON.parse(fs.readFileSync(slotPath(dir), 'utf8')); } catch { return null; } };

// another run's hold of the suite slot, written as machine-slot.js writes it
function hold(dir, { pid = process.pid, holder = 'run-a', started = Date.now(), token = 'other-token' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(slotPath(dir), JSON.stringify({ pid, host: os.hostname(), token, started, holder }));
}

// the pid of a process that has already exited
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

// a project whose whole suite is `npm test` (node --test), with one test file
function project(t) {
  const cwd = tmp(t, 'suite-slot-project-');
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }));
  fs.mkdirSync(path.join(cwd, 'test'));
  fs.writeFileSync(path.join(cwd, 'test', 'a.test.js'), '1\n');
  return cwd;
}

// a stubbed `run`: records each call (time, timeout, env, the slot file at that moment)
function fakeRun(dir, { code = 0, act = null } = {}) {
  const calls = [];
  const run = async (opts) => {
    calls.push({ at: Date.now(), timeoutMs: opts.timeoutMs, env: opts.env || {}, hold: readHold(dir) });
    if (act) return act(opts);
    return { code, timedOut: false, error: null };
  };
  return { run, calls };
}

// ---- machine-slot.js: the `suite` slot ---------------------------------------------------------

test('machine-slot names a `suite` slot with its own inherit variable, apart from the screenshot slot (#455)', () => {
  assert.equal(machineSlot.SUITE_SLOT, 'suite');
  assert.equal(typeof machineSlot.SUITE_SLOT_ENV, 'string');
  assert.ok(machineSlot.SUITE_SLOT_ENV.length > 0);
  assert.notEqual(machineSlot.SUITE_SLOT_ENV, machineSlot.SCREENSHOT_SLOT_ENV);
});

test('the suite slot is held longer than a whole suite may run: SUITE_MAX_HOLD_MS is at least 30 min (#455)', () => {
  assert.equal(typeof machineSlot.SUITE_MAX_HOLD_MS, 'number');
  assert.ok(machineSlot.SUITE_MAX_HOLD_MS >= 30 * 60e3, `SUITE_MAX_HOLD_MS ${machineSlot.SUITE_MAX_HOLD_MS}`);
});

test('a live suite hold of 20 minutes is kept: a long suite is not taken over at the screenshot limit (#455)', (t) => {
  const dir = tmp(t);
  hold(dir, { started: Date.now() - 20 * 60e3 });
  const held = machineSlot.slotHolder(SLOT, { dir });
  assert.equal(held === null, false, 'a running suite of 20 min still holds the slot');
  assert.equal(held.pid, process.pid);
});

test('a suite hold older than SUITE_MAX_HOLD_MS is taken over (#455)', (t) => {
  const dir = tmp(t);
  hold(dir, { started: Date.now() - (machineSlot.SUITE_MAX_HOLD_MS || 0) - 60e3 });
  assert.equal(machineSlot.slotHolder(SLOT, { dir }) === null, true);
  assert.equal(fs.existsSync(slotPath(dir)), false, 'the stale hold is removed');
});

test('a suite hold whose process is gone is taken over at once (#455)', async (t) => {
  const dir = tmp(t);
  hold(dir, { pid: deadPid() });
  const got = await machineSlot.acquireSlot(SLOT, { dir, waitMs: 2000, pollMs: 50 });
  t.after(() => got.release());
  assert.ok(got.waitedMs < 1000, `waited ${got.waitedMs} ms`);
  assert.equal(readHold(dir)?.pid, process.pid);
});

test('the screenshot slot keeps its own limit: a 20-minute screenshot hold is taken over (#455)', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'screenshot.slot'), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'x', started: Date.now() - 20 * 60e3, holder: 'run-a' }));
  assert.equal(machineSlot.slotHolder('screenshot', { dir }) === null, true);
});

test('a process started by the suite slot\'s holder inherits it through SUITE_SLOT_ENV and does not wait (#455)', async (t) => {
  const dir = tmp(t);
  hold(dir, { token: 'suite-token-1' });
  const name = machineSlot.SUITE_SLOT_ENV || 'MULTIAGENT_SUITE_SLOT_UNDEFINED';
  const before = process.env[name];
  process.env[name] = 'suite-token-1';
  t.after(() => { if (before === undefined) delete process.env[name]; else process.env[name] = before; });
  const got = await machineSlot.acquireSlot(SLOT, { dir, waitMs: 500, pollMs: 50 });
  assert.equal(got.inherited, true);
  assert.equal(readHold(dir)?.token, 'suite-token-1', 'the holder keeps its slot');
});

// ---- runSuite: a whole-suite round takes the slot ---------------------------------------------

test('runSuite: a whole-suite round holds the suite slot while its command runs, frees it after, and passes the token to the suite (#455)', async (t) => {
  const dir = tmp(t);
  const cwd = project(t);
  const runDir = tmp(t);
  const { run, calls } = fakeRun(dir);
  const out = await suiteStep.runSuite({ command: 'npm test', cwd, runDir, round: 1, run, slot: { dir, holder: 'run-b', pollMs: 50 } });
  assert.equal(out.status, 'pass');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hold === null, false, 'the slot is held while the command runs');
  assert.equal(calls[0].hold.pid, process.pid);
  assert.match(String(calls[0].hold.holder), /run-b/);
  assert.equal(calls[0].env[machineSlot.SUITE_SLOT_ENV || 'MULTIAGENT_SUITE_SLOT_UNDEFINED'], calls[0].hold.token, 'the suite inherits the slot');
  assert.equal(fs.existsSync(slotPath(dir)), false, 'freed when the round ends');
});

test('runSuite: while another run holds the slot, the whole round waits, tells who holds it, and starts once it is freed (#455)', async (t) => {
  const dir = tmp(t);
  const cwd = project(t);
  const runDir = tmp(t);
  hold(dir, { holder: 'run-a' });
  let freedAt = 0;
  const timer = setTimeout(() => { freedAt = Date.now(); fs.rmSync(slotPath(dir), { force: true }); }, 800);
  t.after(() => clearTimeout(timer));
  const waits = [];
  const { run, calls } = fakeRun(dir);
  const out = await suiteStep.runSuite({ command: 'npm test', cwd, runDir, round: 1, run, timeoutMs: 120e3, slot: { dir, holder: 'run-b', pollMs: 50, onWait: (h) => waits.push({ pid: h?.pid ?? null, holder: h?.holder ?? null }) } });
  assert.equal(out.status, 'pass');
  assert.equal(calls.length, 1);
  assert.ok(freedAt > 0 && calls[0].at >= freedAt, 'the command starts only after the other run freed the slot');
  assert.deepEqual(waits, [{ pid: process.pid, holder: 'run-a' }]);
  // the wait is not the round's time: the command gets the whole timeout, the duration leaves the wait out
  assert.equal(calls[0].timeoutMs, 120e3);
  assert.equal(out.timeout_ms, 120e3);
  assert.ok(out.duration_ms < 700, `duration ${out.duration_ms} ms leaves out the ~800 ms wait`);
});

test('runSuite: a focused round (a list of test files) never waits for the suite slot (#455)', async (t) => {
  const dir = tmp(t);
  const cwd = project(t);
  const runDir = tmp(t);
  hold(dir, { holder: 'run-a' });
  const waits = [];
  const { run, calls } = fakeRun(dir);
  const out = await suiteStep.runSuite({ command: 'npm test', cwd, runDir, round: 1, run, files: ['test/a.test.js'], slot: { dir, holder: 'run-b', pollMs: 50, onWait: () => waits.push(1) } });
  assert.equal(out.scope, 'files');
  assert.equal(calls.length, 1);
  assert.equal(waits.length, 0);
  assert.equal(readHold(dir)?.holder, 'run-a', 'the other run keeps its slot');
});

test('runSuite: the simulated suite never takes or waits for the suite slot (#455)', async (t) => {
  const dir = tmp(t);
  const runDir = tmp(t);
  hold(dir, { holder: 'run-a' });
  const waits = [];
  const out = await suiteStep.runSuite({ command: 'npm test', cwd: '/x', runDir, round: 1, mock: true, mockResult: 'pass', slot: { dir, holder: 'run-b', pollMs: 50, onWait: () => waits.push(1) } });
  assert.equal(out.status, 'pass');
  assert.equal(waits.length, 0);
  assert.equal(readHold(dir)?.holder, 'run-a');
});

test('runSuite: the slot is freed when the round fails, times out or its command throws (#455)', async (t) => {
  const cwd = project(t);
  const ends = {
    fail: async () => ({ code: 1, timedOut: false, error: null }),
    timeout: async () => ({ code: null, timedOut: true, error: null, running: [] }),
    throws: async () => { throw new Error('spawn failed'); },
  };
  for (const [end, act] of Object.entries(ends)) {
    const dir = tmp(t);
    const runDir = tmp(t);
    const { run, calls } = fakeRun(dir, { act });
    await suiteStep.runSuite({ command: 'npm test', cwd, runDir, round: 1, run, slot: { dir, holder: 'run-b', pollMs: 50 } }).catch(() => {});
    assert.equal(calls.length, 1, `${end}: the command ran`);
    assert.equal(calls[0].hold === null, false, `${end}: the slot was held`);
    assert.equal(fs.existsSync(slotPath(dir)), false, `${end}: the slot is freed`);
  }
});

test('runSuite: a run stopped while its suite holds the slot frees it (#455)', async (t) => {
  const dir = tmp(t);
  const cwd = project(t);
  const runDir = tmp(t);
  const abort = new AbortController();
  const act = (opts) => new Promise((resolve) => {
    setTimeout(() => abort.abort(), 50);
    opts.signal.addEventListener('abort', () => resolve({ code: null, timedOut: false, error: new Error('Cancelled') }), { once: true });
  });
  const { run, calls } = fakeRun(dir, { act });
  await suiteStep.runSuite({ command: 'npm test', cwd, runDir, round: 1, run, signal: abort.signal, slot: { dir, holder: 'run-b', pollMs: 50 } }).catch(() => {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hold === null, false, 'the slot was held when the run was stopped');
  assert.equal(fs.existsSync(slotPath(dir)), false);
});

test('runSuite: a run stopped while it waits for the slot never starts its suite and leaves the other run\'s slot (#455)', async (t) => {
  const dir = tmp(t);
  const cwd = project(t);
  const runDir = tmp(t);
  hold(dir, { holder: 'run-a' });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 300);
  t.after(() => clearTimeout(timer));
  const { run, calls } = fakeRun(dir);
  const t0 = Date.now();
  await suiteStep.runSuite({ command: 'npm test', cwd, runDir, round: 1, run, signal: abort.signal, slot: { dir, holder: 'run-b', pollMs: 50 } }).catch(() => {});
  assert.ok(Date.now() - t0 < 5000, 'the wait ends with the run');
  assert.equal(calls.length, 0);
  assert.equal(readHold(dir)?.holder, 'run-a');
});

test('runSuite: a dead holder of the slot is taken over without waiting (#455)', async (t) => {
  const dir = tmp(t);
  const cwd = project(t);
  const runDir = tmp(t);
  hold(dir, { pid: deadPid(), holder: 'run-a' });
  const waits = [];
  const { run, calls } = fakeRun(dir);
  await suiteStep.runSuite({ command: 'npm test', cwd, runDir, round: 1, run, slot: { dir, holder: 'run-b', pollMs: 50, onWait: () => waits.push(1) } });
  assert.equal(calls.length, 1);
  assert.equal(waits.length, 0);
  assert.match(String(calls[0].hold?.holder), /run-b/, 'this round holds the slot it took over');
});

test('runSuite: a hold older than SUITE_MAX_HOLD_MS is taken over without waiting (#455)', async (t) => {
  const dir = tmp(t);
  const cwd = project(t);
  const runDir = tmp(t);
  hold(dir, { holder: 'run-a', started: Date.now() - (machineSlot.SUITE_MAX_HOLD_MS || 0) - 60e3 });
  const waits = [];
  const { run, calls } = fakeRun(dir);
  await suiteStep.runSuite({ command: 'npm test', cwd, runDir, round: 1, run, slot: { dir, holder: 'run-b', pollMs: 50, onWait: () => waits.push(1) } });
  assert.equal(calls.length, 1);
  assert.equal(waits.length, 0);
  assert.match(String(calls[0].hold?.holder), /run-b/);
});

// ---- the engine: a suite step of a run takes the machine-wide slot ----------------------------

// the machine-wide folder in a temp folder: os.tmpdir() (machineSlotDir) and MULTIAGENT_LOCKS_DIR
// (slotDir) both lead to <root>/multiagent-orchestrator/locks
function machineFolder(t) {
  const root = tmp(t, 'suite-slot-machine-');
  const dir = path.join(root, 'craftorio', 'locks');
  const saved = {};
  for (const k of ['TEMP', 'TMP', 'TMPDIR', 'MULTIAGENT_LOCKS_DIR']) saved[k] = process.env[k];
  process.env.TEMP = root;
  process.env.TMP = root;
  process.env.TMPDIR = root;
  process.env.MULTIAGENT_LOCKS_DIR = dir;
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  return dir;
}

function repo(t) {
  const dir = tmp(t, 'suite-slot-repo-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), '1\n');
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'run-branch');
  return dir;
}

// a run whose machine runs the real runSuite with a stubbed `run` (nothing spawned)
function engineRun(t, worktree, runId, run) {
  const runDir = path.join(tmp(t, 'suite-slot-run-'), 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const events = [];
  const state = Object.create(WorkflowRun.prototype);
  Object.assign(state, {
    mock: false,
    mockSequences: {},
    machine: { simulated: false, runSuite: (opts) => suiteStep.runSuite({ ...opts, run }), noteFailingOnMain: () => {} },
    runDir,
    runId,
    worktree: { repo: worktree, base: 'main' },
    ctx: { worktree_dir: worktree },
    abort: new AbortController(),
    preexisting: [],
    suiteRuns: { engine: 0 },
    suiteFailedFiles: [],
    fullSuitePassed: false,
    watchMemory: () => ({ stop() {} }),
    emitEvent: (type, data) => events.push({ type, ...data }),
  });
  return { state, events };
}

test('engine: a whole-suite round waits for another run\'s suite slot, logs suite_slot with that run and pid, then runs (#455)', async (t) => {
  const worktree = repo(t);
  const dir = machineFolder(t);
  hold(dir, { holder: 'run-a' });
  let freedAt = 0;
  const timer = setTimeout(() => { freedAt = Date.now(); fs.rmSync(slotPath(dir), { force: true }); }, 1500);
  t.after(() => clearTimeout(timer));
  const { run, calls } = fakeRun(dir);
  const { state, events } = engineRun(t, worktree, 'run-b', run);
  const out = await state.suiteRound({ id: 'suite', type: 'suite', command: 'npm test' }, { visits: 1, outputs: [] }, { execution: 1, reruns: 0, stopped: [] });
  assert.equal(out.status, 'pass', out.message);
  assert.equal(calls.length, 1);
  assert.ok(freedAt > 0 && calls[0].at >= freedAt, 'the suite starts once the other run freed the slot');
  const waits = events.filter((e) => e.type === 'log' && e.kind === 'suite_slot').map((e) => String(e.message));
  assert.equal(waits.length, 1, `one suite_slot log; events: ${JSON.stringify(events.map((e) => e.kind || e.type))}`);
  assert.match(waits[0], /waiting for the suite slot/);
  assert.match(waits[0], /run-a/);
  assert.match(waits[0], new RegExp(String(process.pid)));
});

test('engine: a whole-suite round holds the machine-wide suite slot under the run\'s id and frees it at the end (#455)', async (t) => {
  const worktree = repo(t);
  const dir = machineFolder(t);
  const { run, calls } = fakeRun(dir);
  const { state, events } = engineRun(t, worktree, 'run-b', run);
  const out = await state.suiteRound({ id: 'suite', type: 'suite', command: 'npm test' }, { visits: 1, outputs: [] }, { execution: 1, reruns: 0, stopped: [] });
  assert.equal(out.status, 'pass', out.message);
  assert.equal(calls[0].hold === null, false, 'the slot is held while the suite runs');
  assert.equal(calls[0].hold.pid, process.pid);
  assert.match(String(calls[0].hold.holder), /run-b/);
  assert.equal(fs.existsSync(slotPath(dir)), false);
  assert.equal(events.some((e) => e.kind === 'suite_slot'), false, 'no wait logged when the slot is free');
});

test('engine: a simulated suite round never waits for the suite slot (#455)', async (t) => {
  const worktree = repo(t);
  const dir = machineFolder(t);
  hold(dir, { holder: 'run-a' });
  const { state, events } = engineRun(t, worktree, 'run-b', null);
  state.mock = true;
  state.machine = require('../engine/machine-actions').simulated();
  state.mockSequences = { suite: { suite: ['pass'] } };
  const t0 = Date.now();
  const out = await state.suiteRound({ id: 'suite', type: 'suite', command: 'npm test' }, { visits: 1, outputs: [] }, { execution: 1, reruns: 0, stopped: [] });
  assert.equal(out.status, 'pass');
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(events.some((e) => e.kind === 'suite_slot'), false);
  assert.equal(readHold(dir)?.holder, 'run-a');
});
