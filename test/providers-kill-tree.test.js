// src/engine/providers.js killTree (#318): on POSIX it signals the child's whole process group
// (SIGTERM, then SIGKILL after a grace), so a grandchild started by a shell dies with it. Windows
// uses `taskkill /T /F` (unchanged): this real-process check runs on Linux/macOS only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const { killTree } = require('../src/engine/providers');

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
