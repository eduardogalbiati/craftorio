// Test workers outliving their run (#390): a suite step leaves no process behind, and a run's end
// stops what still runs from its worktree. Real processes in a temporary "worktree": a command
// whose child starts a grandchild that never ends (like `node --test` and its file workers).
// Every process started here ends by itself after a minute, so a failing test leaves nothing behind.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runCommand } = require('../engine/suite-step');
const { stopProcessesIn } = require('../engine/processes');

const SELF_DESTRUCT_MS = 60000;

function tempWorktree(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'stray-390-')));
  // best effort: under a loaded suite Windows may keep the folder locked a while after its processes
  // are gone (the tests check that they are gone); a leftover temp folder is not this test's subject
  t.after(() => { try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* left in the temp folder */ } });
  const wt = path.join(base, 'worktrees', 'run-390');
  fs.mkdirSync(wt, { recursive: true });
  return { base, wt };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gone(pid, withinMs = 5000) {
  for (let t0 = Date.now(); alive(pid) && Date.now() - t0 < withinMs;) await sleep(100);
  return !alive(pid);
}
const killQuietly = (pid) => { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } };

// parent.js starts grandchild.js and either exits at once ('exit') or hangs with it ('hang');
// the pids go to pids.json
function writeScripts(wt) {
  fs.writeFileSync(path.join(wt, 'grandchild.js'),
    `setTimeout(() => process.exit(0), ${SELF_DESTRUCT_MS});\nsetInterval(() => {}, 1000);\n`);
  fs.writeFileSync(path.join(wt, 'parent.js'), [
    "const { spawn } = require('child_process');",
    "const fs = require('fs');",
    "const path = require('path');",
    "const hang = process.argv[2] === 'hang';",
    // on Windows node kills its non-detached children when it exits (libuv's job object): detached
    // there, the grandchild outlives its parent as the test workers did; elsewhere it stays in the group
    "const g = spawn(process.execPath, [path.join(__dirname, 'grandchild.js')], { stdio: hang ? 'inherit' : 'ignore', detached: !hang && process.platform === 'win32' });",
    "fs.writeFileSync(path.join(__dirname, 'pids.json'), JSON.stringify({ parent: process.pid, grandchild: g.pid }));",
    `if (hang) { setTimeout(() => process.exit(0), ${SELF_DESTRUCT_MS}); setInterval(() => {}, 1000); } else g.unref();`,
    '',
  ].join('\n'));
}

const command = (mode) => `"${process.execPath}" parent.js ${mode}`;
const pidsOf = (wt) => JSON.parse(fs.readFileSync(path.join(wt, 'pids.json'), 'utf8'));

test('a suite command that ends leaves no process behind: the grandchild its child started is stopped too', { timeout: 60000 }, async (t) => {
  const { base, wt } = tempWorktree(t);
  writeScripts(wt);
  let pids = null;
  try {
    const r = await runCommand({ command: command('exit'), cwd: wt, env: process.env, timeoutMs: 30000, logFile: path.join(base, 'suite.log') });
    assert.equal(r.code, 0, `the command ends normally: ${fs.readFileSync(path.join(base, 'suite.log'), 'utf8')}`);
    pids = pidsOf(wt);
    assert.equal(await gone(pids.parent), true, 'the child has ended');
    assert.equal(await gone(pids.grandchild), true, 'the grandchild the child left running is stopped when the step ends');
  } finally {
    if (pids) { killQuietly(pids.grandchild); killQuietly(pids.parent); }
  }
});

test('a suite command that times out leaves no process behind: child and grandchild are stopped', { timeout: 60000 }, async (t) => {
  const { base, wt } = tempWorktree(t);
  writeScripts(wt);
  let pids = null;
  try {
    const r = await runCommand({ command: command('hang'), cwd: wt, env: process.env, timeoutMs: 3000, logFile: path.join(base, 'suite.log') });
    assert.equal(r.timedOut, true);
    pids = pidsOf(wt);
    assert.equal(await gone(pids.parent), true, 'the hung child is stopped');
    assert.equal(await gone(pids.grandchild), true, 'the hung grandchild is stopped');
  } finally {
    if (pids) { killQuietly(pids.grandchild); killQuietly(pids.parent); }
  }
});

test("a run's end stops a test worker still running a file of its worktree with the machine's node", { timeout: 60000 }, async (t) => {
  const { base, wt } = tempWorktree(t);
  const file = path.join(wt, 'test', 'slow', 'service-channel-sweep-333.slow.test.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `setTimeout(() => process.exit(0), ${SELF_DESTRUCT_MS});\nsetInterval(() => {}, 1000);\n`);
  const pidFile = path.join(base, 'worker.pid');
  // the worker's parent (the suite) is gone: an orphan, the node executable outside the worktree
  const launcher = `const c = require('child_process').spawn(process.execPath, [${JSON.stringify(file)}], { detached: true, stdio: 'ignore', cwd: ${JSON.stringify(wt)} });`
    + ` require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); c.unref();`;
  execFileSync(process.execPath, ['-e', launcher], { stdio: 'ignore' });
  const worker = +fs.readFileSync(pidFile, 'utf8');
  try {
    assert.equal(alive(worker), true);
    const stopped = await stopProcessesIn(wt);
    assert.deepEqual(stopped.filter((p) => p.pid === worker).map((p) => p.stopped), [true], 'the worker is found and stopped');
    assert.equal(await gone(worker), true, 'the worker is no longer running');
  } finally {
    killQuietly(worker);
  }
});
