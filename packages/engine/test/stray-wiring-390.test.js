// #390 internals: the app's guard is made without runs and gets them later (watchStrays, from the
// runs area); the stray's notification names its run and command; a worktree's file on a command
// line stops a runtime (node) but never a tool opened on it (an editor).
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { createMemoryGuard } = require('../engine/memory-guard');
const { selectProcesses } = require('../engine/processes');
const notifier = require('../domains/workspace/notifications');

const wt = path.join(os.tmpdir(), 'ws-390-wiring', 'worktrees', 'run-1');

test('watchStrays: a guard made without runs flags strays once given them, and stops looking with null', async () => {
  const procs = (cpuMs) => [{ pid: 101, ppid: 1, commandLine: `node --test ${path.join(wt, 'a.test.js')}`, bytes: 1, cpuMs }];
  let cpu = 0;
  let clock = 0;
  const flagged = [];
  const guard = createMemoryGuard({
    limitBytes: 1024 ** 4, floorBytes: 0, intervalMs: 60000, strayIntervalMs: 60000,
    sampler: async () => procs(cpu), freeMemory: async () => null, kill: async () => {}, now: () => clock,
  });
  try {
    await guard.tick();
    assert.deepEqual(await guard.strayProcesses(), [], 'no runs: no stray check');
    guard.watchStrays({ runs: () => [{ id: 'run-1', worktree: wt, live: false }], onStray: (s) => flagged.push(s) });
    await guard.tick();
    cpu = 9000; clock = 10000;
    await guard.tick();
    assert.deepEqual((await guard.strayProcesses()).map((s) => [s.pid, s.runId]), [[101, 'run-1']]);
    assert.deepEqual(flagged.map((s) => s.pid), [101]);
    guard.watchStrays(null);
    assert.deepEqual(await guard.strayProcesses(), []);
    await assert.rejects(guard.stopStray(101), /not a stray/);
  } finally { guard.close(); }
});

test('strayNotice names the run, the process and its command, and opens the run', () => {
  const n = notifier.strayNotice({ pid: 3444, runId: '20261013-000943-59c3bdb4', commandLine: 'node --test x.slow.test.js', cpuShare: 1 });
  assert.equal(n.kind, 'run');
  assert.match(n.title, /20261013-000943-59c3bdb4/);
  assert.match(n.body, /PID 3444, 100% of a core: node --test x\.slow\.test\.js/);
  assert.deepEqual(n.target, { runId: '20261013-000943-59c3bdb4' });
});

test('selectProcesses: a runtime naming a worktree file is stopped, an editor opened on one is not', (t) => {
  fs.mkdirSync(wt, { recursive: true });
  t.after(() => fs.rmSync(path.dirname(path.dirname(wt)), { recursive: true, force: true }));
  const file = path.join(wt, 'notes.md');
  const procs = [
    { pid: 1, ppid: 0, exe: null, cmd: null, cwd: null, tty: false },
    { pid: 10, ppid: 1, exe: path.join(os.tmpdir(), 'nodejs', 'node.exe'), cmd: `node --test "${path.join(wt, 'a.test.js')}"`, cwd: null, tty: false },
    { pid: 11, ppid: 1, exe: null, cmd: `"C:\\Program Files\\nodejs\\node.exe" ${path.join(wt, 'b.js')}`, cwd: null, tty: false },
    { pid: 12, ppid: 1, exe: path.join(os.tmpdir(), 'Windows', 'notepad.exe'), cmd: `notepad.exe ${file}`, cwd: null, tty: false },
    { pid: 13, ppid: 1, exe: null, cmd: `code ${file}`, cwd: null, tty: false },
  ];
  const found = selectProcesses(procs, wt, { self: 999 });
  assert.deepEqual(found.map((p) => [p.pid, p.reason]), [[10, 'command'], [11, 'command']]);
});
