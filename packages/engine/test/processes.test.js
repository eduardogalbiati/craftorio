// Processes left running in a run's worktree (packages/engine/engine/processes.js).
// selectProcesses is checked on hand-made process lists; stopProcessesIn on real processes:
// an orphan started from a program inside a temporary "worktree" (a link to node) is stopped, a
// process outside it is not.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { commandMentions, selectProcesses, stopProcessesIn } = require('../engine/processes');

function tempDir(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'procs-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return base;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

test('selectProcesses: programs run from the worktree and their trees; nothing outside it, never this process', (t) => {
  const base = tempDir(t);
  const wt = path.join(base, 'worktrees', 'run-1');
  const sibling = path.join(base, 'worktrees', 'run-10'); // same prefix, another run
  fs.mkdirSync(wt, { recursive: true });
  const electron = path.join(wt, 'node_modules', 'electron', 'dist', 'electron.exe');
  const procs = [
    { pid: 1, ppid: 0, exe: '/sbin/init' },
    { pid: 10, ppid: 1, exe: '/usr/bin/app' }, // the orchestrator's parent
    { pid: 11, ppid: 10, exe: '/usr/bin/node', cwd: wt }, // the orchestrator itself (self)
    { pid: 12, ppid: 11, exe: '/usr/bin/bash', cwd: wt }, // an embedded terminal it opened in the worktree
    { pid: 20, ppid: 999, exe: electron }, // orphan: its npx was killed
    { pid: 21, ppid: 20, exe: '/usr/bin/gpu-helper' }, // its child, outside the worktree
    { pid: 22, ppid: 21, exe: '/usr/bin/renderer' }, // grandchild
    { pid: 30, ppid: 1, exe: path.join(sibling, 'node_modules', 'electron', 'dist', 'electron.exe') },
    { pid: 31, ppid: 1, exe: '/usr/bin/electron', cwd: base }, // the user's app, elsewhere
    { pid: 40, ppid: 1, exe: '/usr/bin/node', cwd: path.join(wt, 'web') }, // a dev server left behind
    { pid: 41, ppid: 1, exe: '/usr/bin/zsh', cwd: wt, tty: true }, // the user's own shell there
    { pid: 50, ppid: 1, exe: null, cwd: null }, // system process (no access)
  ];
  const found = selectProcesses(procs, wt, { self: 11 });
  assert.deepEqual(found.map((p) => [p.pid, p.reason]).sort((a, b) => a[0] - b[0]), [
    [20, 'executable'], [21, 'child'], [22, 'child'], [40, 'cwd'],
  ]);
});

test('selectProcesses: case-insensitive paths match on Windows/macOS file systems only', (t) => {
  const base = tempDir(t);
  const wt = path.join(base, 'Run-1');
  fs.mkdirSync(wt);
  const procs = [{ pid: 5, ppid: 1, exe: path.join(base, 'RUN-1', 'tool.exe') }];
  assert.deepEqual(selectProcesses(procs, wt, { self: 2, caseInsensitive: true }).map((p) => p.pid), [5]);
  assert.deepEqual(selectProcesses(procs, wt, { self: 2, caseInsensitive: false }), []);
});

test('selectProcesses: a runner naming a file of the worktree (#390), not a sibling run, the bare folder or a terminal', (t) => {
  const base = tempDir(t);
  const wt = path.join(base, 'worktrees', 'run-1');
  const sibling = path.join(base, 'worktrees', 'run-10');
  fs.mkdirSync(wt, { recursive: true });
  const node = path.join(base, 'nodejs', 'node.exe');
  const procs = [
    { pid: 1, ppid: 0, exe: null, cmd: null },
    { pid: 20, ppid: 1, exe: node, cmd: `"${node}" --test ${path.join(wt, 'test', 'slow', 'a.slow.test.js')}` }, // a test worker
    { pid: 21, ppid: 20, exe: path.join(base, 'bin', 'helper.exe'), cmd: 'helper.exe --serve' }, // its child
    { pid: 30, ppid: 1, exe: node, cmd: `"${node}" ${path.join(sibling, 'b.js')}` }, // another run, same prefix
    { pid: 31, ppid: 1, exe: node, cmd: `"${node}" ${path.join(sibling, 'run-1', 'c.js')}` }, // run-1 inside another folder
    { pid: 40, ppid: 1, exe: node, cmd: `"${node}" scripts/x.js --dir ${wt}` }, // the folder itself, no file of it
    { pid: 50, ppid: 1, exe: path.join(base, 'bin', 'bash'), cmd: `bash ${path.join(wt, 'run.sh')}`, tty: true }, // the owner's terminal
  ];
  const found = selectProcesses(procs, wt, { self: 999 });
  assert.deepEqual(found.map((p) => [p.pid, p.reason]).sort((a, b) => a[0] - b[0]), [[20, 'command'], [21, 'child']]);
});

test('commandMentions: a file under the folder, never the folder alone nor a sibling sharing its prefix (#390)', (t) => {
  const base = tempDir(t);
  const wt = path.join(base, 'Run-1');
  assert.equal(commandMentions(`node ${path.join(wt, 'a.js')}`, wt), true);
  assert.equal(commandMentions(`node ${path.join(wt, 'a.js')}`, wt + path.sep), true, 'a trailing separator on the folder');
  assert.equal(commandMentions(`node ${wt}`, wt), false, 'the folder alone');
  assert.equal(commandMentions(`node ${path.join(base, 'Run-10', 'a.js')}`, wt), false, 'a sibling sharing the prefix');
  assert.equal(commandMentions('', wt), false);
  assert.equal(commandMentions(`node ${path.join(wt, 'a.js')}`, ''), false);
  const upper = `node ${path.join(wt, 'a.js').toUpperCase()}`;
  assert.equal(commandMentions(upper, wt, { caseInsensitive: true }), true);
  assert.equal(commandMentions(upper, wt, { caseInsensitive: false }), false);
});

test('commandMentions: on Windows a command line with forward slashes names the folder too (#390)', { skip: path.sep !== '\\' && 'Windows paths only' }, () => {
  const wt = 'C:\\ws\\worktrees\\run-1';
  assert.equal(commandMentions('node C:/ws/worktrees/run-1/test/a.test.js', wt, { caseInsensitive: true }), true);
  assert.equal(commandMentions('node c:/WS/worktrees/run-10/test/a.test.js', wt, { caseInsensitive: true }), false);
});

test('stopProcessesIn: stops an orphan running a program from the folder, leaves other processes alone', { timeout: 60000 }, async (t) => {
  const base = tempDir(t);
  const wt = path.join(base, 'wt-run');
  const bin = path.join(wt, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  // a program inside the worktree, like node_modules/electron/dist/electron.exe
  const exe = path.join(bin, path.basename(process.execPath));
  try { fs.linkSync(process.execPath, exe); } catch { fs.copyFileSync(process.execPath, exe); fs.chmodSync(exe, 0o755); }

  const pidFile = path.join(base, 'orphan.pid');
  // the parent starts the program detached and exits at once, as an agent's killed `npx` would
  const launcher = `const c = require('child_process').spawn(${JSON.stringify(exe)}, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', cwd: ${JSON.stringify(wt)} });`
    + ` require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); c.unref();`;
  execFileSync(process.execPath, ['-e', launcher], { stdio: 'ignore' });
  const orphan = +fs.readFileSync(pidFile, 'utf8');

  const outside = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', cwd: os.tmpdir() });
  try {
    assert.ok(alive(orphan));
    const stopped = await stopProcessesIn(wt);
    assert.deepEqual(stopped.map((p) => [p.pid, p.reason, p.stopped]), [[orphan, 'executable', true]]);
    for (let i = 0; i < 50 && alive(orphan); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(!alive(orphan), 'the orphan is stopped');
    assert.ok(alive(outside.pid), 'a process outside the folder keeps running');
    assert.ok(alive(process.pid));
  } finally {
    // before the folder is removed (a running program locks it on Windows)
    outside.kill('SIGKILL');
    try { process.kill(orphan, 'SIGKILL'); } catch { /* stopped */ }
  }

  assert.deepEqual(await stopProcessesIn(wt), [], 'nothing left the second time');
  assert.deepEqual(await stopProcessesIn(path.join(base, 'missing')), []);
});
