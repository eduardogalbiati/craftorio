// The memory guard sees CPU too (#390): a process still running from a finished run's worktree and
// using CPU (two test workers once ran at 100% for 21 hours) is flagged with its run and command,
// and the owner may stop it; the guard never stops anything on its own and never offers to stop a
// live run's process.
//
// Interface used here (new in #390): createMemoryGuard({ runs }) with runs() → [{ id, worktree, live }];
// the sampler's processes carry cpuMs (CPU time used so far, in ms); after two samples
// guard.strayProcesses() → [{ pid, runId, commandLine, ... }]; guard.stopStray(pid) stops one with
// its children through `kill`.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { createMemoryGuard } = require('../engine/memory-guard');

const MB = 1024 ** 2;
const worktrees = path.join(os.tmpdir(), 'ws-390', 'worktrees');
const wt = (id) => path.join(worktrees, id);
const NODE = path.join(os.tmpdir(), 'nodejs', 'node.exe');
const RUNS = [
  { id: 'run-1', worktree: wt('run-1'), live: false }, // finished
  { id: 'run-10', worktree: wt('run-10'), live: true }, // same prefix, still running
];
const cmd = (...args) => [NODE, ...args].join(' ');

// two samples 10 s apart; cpuMs grows by 9.5 s for a busy process, stays for an idle one
function samples() {
  const at = (cpuA, cpuB) => [cpuA, cpuB];
  const procs = [
    { pid: 101, ppid: 1, commandLine: cmd('--test', path.join(wt('run-1'), 'test', 'slow', 'service-channel-sweep-333.slow.test.js')), cpu: at(1000, 10500) },
    { pid: 106, ppid: 101, commandLine: cmd(path.join(wt('run-1'), 'node_modules', 'helper.js')), cpu: at(0, 0) },
    { pid: 102, ppid: 1, commandLine: cmd(path.join(wt('run-1'), 'server.js')), cpu: at(500, 500) }, // idle
    { pid: 103, ppid: 1, commandLine: cmd('--test', path.join(wt('run-10'), 'test', 'x.test.js')), cpu: at(1000, 10500) }, // live run
    { pid: 104, ppid: 1, commandLine: cmd(path.join(os.tmpdir(), 'elsewhere', 'job.js')), cpu: at(1000, 10500) }, // no run's
  ];
  return [0, 1].map((i) => procs.map(({ cpu, ...p }) => ({ ...p, bytes: 50 * MB, cpuMs: cpu[i] })));
}

async function sampledGuard() {
  const [first, second] = samples();
  let call = 0;
  let clock = 0;
  const kills = [];
  const guard = createMemoryGuard({
    limitBytes: 1024 ** 4, floorBytes: 0, intervalMs: 60000,
    sampler: async () => (call++ === 0 ? first : second),
    freeMemory: async () => ({ freeBytes: 1024 ** 4, totalBytes: 1024 ** 4 }),
    kill: async (pid, descendants) => { kills.push([pid, [...descendants].sort()]); },
    now: () => clock,
    runs: () => RUNS,
  });
  await guard.tick();
  clock = 10000;
  await guard.tick();
  return { guard, kills };
}

test('flags a process of a finished run that keeps using CPU, with its run and its command', async () => {
  const { guard } = await sampledGuard();
  try {
    const strays = await guard.strayProcesses();
    assert.deepEqual(strays.map((s) => [s.pid, s.runId]), [[101, 'run-1']]);
    assert.match(strays[0].commandLine, /service-channel-sweep-333\.slow\.test\.js/);
  } finally { guard.close(); }
});

test('never stops a process on its own, neither a stray nor a live run\'s busy one', async () => {
  const { guard, kills } = await sampledGuard();
  guard.close();
  assert.deepEqual(kills, []);
});

test('stopping a flagged process stops it with its children', async () => {
  const { guard, kills } = await sampledGuard();
  try {
    await guard.stopStray(101);
    assert.deepEqual(kills, [[101, [106]]]);
  } finally { guard.close(); }
});

test('refuses to stop a process of a live run or one it did not flag', async () => {
  const { guard, kills } = await sampledGuard();
  try {
    for (const pid of [103, 102, 104]) {
      try { await guard.stopStray(pid); } catch { /* a refusal may throw */ }
    }
    assert.deepEqual(kills, []);
  } finally { guard.close(); }
});
