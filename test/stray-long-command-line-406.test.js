// #406 review: stopStray refuses a stray whose command line names its worktree only past the cut
// (300 characters) it keeps: the live run's worktree is matched against the stray's own folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { createMemoryGuard } = require('../src/engine/memory-guard');

test('#406 stopStray refuses a stray under a live run\'s worktree named past the cut of its command line', async (t) => {
  const wt = path.join(os.tmpdir(), 'ws-406-long', 'worktrees', '20261015-114050-7aaa0962');
  const commandLine = `rustc.exe --crate-name jiff ${'--cfg feature="std" '.repeat(30)}--out-dir ${path.join(wt, 'target', 'debug', 'deps')}`;
  let list = [{ id: '20261015-114050-7aaa0962', worktree: wt, live: false }];
  let cpu = 0;
  let clock = 0;
  const killed = [];
  const guard = createMemoryGuard({
    limitBytes: 1024 ** 4, floorBytes: 0, intervalMs: 60000, strayIntervalMs: 60000,
    sampler: async () => [{ pid: 4242, ppid: 1, commandLine, bytes: 1e6, cpuMs: cpu }],
    freeMemory: async () => null, kill: async (pid) => { killed.push(pid); }, now: () => clock,
    runs: () => list,
  });
  t.after(() => guard.close());
  await guard.tick();
  cpu = 9000; clock = 10000;
  await guard.tick();
  const [stray] = await guard.strayProcesses();
  assert.equal(stray?.pid, 4242);
  assert.ok(!stray.commandLine.includes(wt), 'the kept command line no longer names the worktree');
  list = [...list, { id: '20261015-131216-eb7d74a7', worktree: wt, live: true }];
  await assert.rejects(guard.stopStray(4242), /running/);
  assert.deepEqual(killed, []);
});
