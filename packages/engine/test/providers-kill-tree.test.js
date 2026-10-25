// packages/engine/engine/providers.js killTree (#318): on POSIX it signals the child's whole process group
// (SIGTERM, then SIGKILL after a grace), so a grandchild started by a shell dies with it. Windows
// uses `taskkill /T /F` (unchanged): this real-process check runs on Linux/macOS only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const { killTree } = require('../engine/providers');

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

test('killTree: kills the grandchild of a detached shell too (process group)', { skip: process.platform === 'win32' && 'POSIX only', timeout: 20000 }, async (t) => {
  const child = spawn('sh', ['-c', 'sleep 30 & echo $!; wait'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let grandPid = 0;
  t.after(() => { if (grandPid && alive(grandPid)) { try { process.kill(grandPid, 'SIGKILL'); } catch {} } try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
  grandPid = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = /(\d+)\s*\n/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    child.on('error', reject);
    setTimeout(() => reject(new Error('no grandchild pid printed')), 5000);
  });
  assert.equal(alive(grandPid), true, 'the grandchild should be running before killTree');

  killTree(child);

  for (let i = 0; i < 60 && alive(grandPid); i++) await new Promise((r) => setTimeout(r, 50));
  assert.throws(() => process.kill(grandPid, 0), (e) => e.code === 'ESRCH');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('killTree: a grandchild that ignores SIGTERM is killed after the grace period', { skip: process.platform === 'win32' && 'POSIX only', timeout: 20000 }, async (t) => {
  // an ignored signal is inherited: both the shell and its sleep ignore SIGTERM
  const child = spawn('sh', ['-c', 'trap "" TERM; sleep 30 & echo $!; wait'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let grandPid = 0;
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
  grandPid = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = /(\d+)\s*\n/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    child.on('error', reject);
    setTimeout(() => reject(new Error('no grandchild pid printed')), 5000);
  });

  killTree(child);

  await sleep(500);
  assert.equal(alive(grandPid), true, 'SIGTERM is ignored: still running within the grace period');
  for (let i = 0; i < 100 && alive(grandPid); i++) await sleep(50);
  assert.equal(alive(grandPid), false, 'killed by SIGKILL after the grace period');
});

test('killTree: a child that does not lead its own group is still stopped', { skip: process.platform === 'win32' && 'POSIX only', timeout: 20000 }, async (t) => {
  const child = spawn('sleep', ['30'], { stdio: 'ignore' });
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve(signal)));
  await new Promise((resolve, reject) => { child.on('spawn', resolve); child.on('error', reject); });

  killTree(child);

  const signal = await Promise.race([exited, sleep(5000).then(() => 'still running')]);
  assert.equal(signal, 'SIGTERM');
});

test('OWN_GROUP: children get their own process group on macOS and Linux, never on Windows', () => {
  const { OWN_GROUP } = require('../engine/providers');
  assert.equal(OWN_GROUP.detached, process.platform === 'win32' ? false : true);
});
