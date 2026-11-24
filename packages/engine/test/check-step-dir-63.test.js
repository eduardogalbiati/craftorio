// #63: `dir` of a `type: check` step: the folder its command runs in (rendered), instead of the run's
// checkout. That folder is not the run's: the processes running from it are never stopped (#705).
// Seam: WorkflowRun.prototype.runCheckStep on a small run state (as test/child-env-470.test.js), and
// loadWorkflow for the field's place. Real commands (`node -e`) in temp folders.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../engine/workflow');

const CWD = 'node -p "process.cwd()"';
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const gone = async (pid) => { for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100)); };

function tmp(t, name) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `check-dir-${name}-`)));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 }); } catch { /* left in tmp */ } });
  return dir;
}

function runState(t, { worktree = undefined, inputs = {} } = {}) {
  const runDir = tmp(t, 'run');
  return Object.assign(Object.create(WorkflowRun.prototype), {
    mock: false, machine: { simulated: false }, runDir, runId: 'run-63',
    worktree: worktree ? { dir: worktree } : null, ctx: { worktree_dir: worktree, inputs, steps: {} },
    abort: new AbortController(), wf: {}, emitEvent: () => {},
  });
}
const check = (state, step) => state.runCheckStep({ id: 'where', type: 'check', command: CWD, ...step }, { visits: 1 });

// a process running from the folder, not a descendant of this one (the sweep spares its own tree)
function neighbour(t, dir) {
  const file = path.join(dir, 'idle.js');
  const pidFile = path.join(dir, 'idle.pid');
  fs.writeFileSync(file, 'setInterval(() => {}, 1000);\n');
  execFileSync(process.execPath, ['-e', `const c = require('child_process').spawn(process.execPath, [${JSON.stringify(file)}], { detached: true, stdio: 'ignore', cwd: ${JSON.stringify(dir)} }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); c.unref();`], { stdio: 'ignore' });
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  t.after(async () => {
    try { process.kill(pid, 'SIGKILL'); } catch { /* stopped */ }
    await gone(pid);
  });
  return pid;
}

test('#63 a check step with dir runs its command in that folder, rendered from the inputs', async (t) => {
  const project = tmp(t, 'project');
  const out = await check(runState(t, { inputs: { project_path: project } }), { dir: '{{ inputs.project_path }}' });
  assert.equal(out.status, 'pass', out.message);
  assert.deepEqual(out.findings, [project]);
});

test('#63 a check step\'s dir wins over the run\'s checkout; without dir it runs in the checkout', async (t) => {
  const worktree = tmp(t, 'worktree');
  const project = tmp(t, 'project');
  assert.deepEqual((await check(runState(t, { worktree }), { dir: project })).findings, [project]);
  assert.deepEqual((await check(runState(t, { worktree }), {})).findings, [worktree]);
});

test('#63 a check step whose dir does not exist is skipped, never run in the checkout', async (t) => {
  const worktree = tmp(t, 'worktree');
  const out = await check(runState(t, { worktree }), { dir: path.join(worktree, 'missing') });
  assert.equal(out.status, 'skipped');
  assert.deepEqual(out.findings, []);
});

test('#63 #705 a check step with dir leaves the processes running from that folder alone, in a run with a worktree too', { timeout: 60000 }, async (t) => {
  const project = tmp(t, 'project');
  const pid = neighbour(t, project);
  const out = await check(runState(t, { worktree: tmp(t, 'worktree') }), { dir: project });
  assert.equal(out.status, 'pass', out.message);
  assert.equal(alive(pid), true);
});

test('#63 loadWorkflow takes dir on a check step and refuses one that is not text', (t) => {
  const load = (step) => {
    const file = path.join(tmp(t, 'wf'), 'wf.yaml');
    fs.writeFileSync(file, ['name: wf', 'agents:', '  a: { provider: claude, system_prompt: x }', 'steps:', step, ''].join('\n'));
    return loadWorkflow(file);
  };
  assert.equal(load('  - { id: c, type: check, dir: /x, command: "node -v" }').steps[0].dir, '/x');
  assert.throws(() => load('  - { id: c, type: check, dir: [x], command: "node -v" }'), /dir must be a string/);
});
