// #705: a check run on a folder the run does not own (a mock run checks repo_path itself) must
// never stop the other processes running from that folder, e.g. the other test files of the suite
// (they died, unreported, when a mock run's rule_check swept the repository). With the sweep on
// (a run's own worktree) they are still stopped (#390).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runCheck } = require('../engine/check-step');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

const gone = async (pid) => { for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100)); };

// A process like another test file of the suite: node running a file of the folder, from the folder,
// and not a descendant of this process (the sweep spares its own tree): a launcher starts it
// detached and exits at once
function neighbour(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-sweep-'));
  const file = path.join(dir, 'idle.test.js');
  fs.writeFileSync(file, 'setInterval(() => {}, 1000);\n');
  const pidFile = path.join(dir, 'idle.pid');
  const launcher = `const c = require('child_process').spawn(process.execPath, [${JSON.stringify(file)}], { detached: true, stdio: 'ignore', cwd: ${JSON.stringify(dir)} });`
    + ` require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); c.unref();`;
  execFileSync(process.execPath, ['-e', launcher], { stdio: 'ignore' });
  const pid = +fs.readFileSync(pidFile, 'utf8');
  t.after(async () => {
    try { process.kill(pid, 'SIGKILL'); } catch { /* stopped */ }
    // before the folder is removed (a running process locks it on Windows)
    await gone(pid);
    // Windows may hold the folder a moment after the kill: a temp folder left behind is no failure
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 }); } catch { /* left in tmp */ }
  });
  return { dir, pid };
}

test('runCheck with sweep false leaves a process running from the folder alone', { timeout: 60000 }, async (t) => {
  const { dir, pid } = neighbour(t);
  const out = await runCheck({ dir, command: 'node -e "0"', logFile: path.join(dir, 'logs', 'check.log'), sweep: false });
  assert.equal(out.status, 'pass', out.message);
  assert.ok(alive(pid), 'the neighbour process keeps running');
});

test('runCheck sweeps the folder by default: a process left running from it is stopped', { timeout: 60000 }, async (t) => {
  const { dir, pid } = neighbour(t);
  const out = await runCheck({ dir, command: 'node -e "0"', logFile: path.join(dir, 'logs', 'check.log') });
  assert.equal(out.status, 'pass', out.message);
  await gone(pid);
  assert.ok(!alive(pid), 'the process left in the folder is stopped');
});
