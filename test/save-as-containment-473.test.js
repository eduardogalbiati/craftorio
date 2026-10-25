// #473 (SEC-8) acceptance tests, written before the code: `save_as` (src/engine/run/outputs.js
// saveOutput) writes only under the run folder, the run's worktree or the project folder.
//
// Interface the developer implements (assumptions, documented here):
//   - saveOutput(step, scope, text, output) resolves each target as today (relative to the run
//     folder), then compares its real path (the nearest existing parent's realpath, as
//     src/domains/oracle/oracle-tools.js does) with the real paths of the allowed roots: this.runDir,
//     this.ctx.worktree_dir (the run's checkout) and the project folder.
//   - A target outside them is not written: saveOutput emits a `log` event (level warn or error,
//     step_id = the step's id, the message naming save_as and the refused path) and throws an Error
//     whose message names save_as, so the step fails with that reason.
// Seam: a WorkflowRun built and never started, saveOutput called the way a run calls it (as
// test/engine-gates-outputs-346.test.js does).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../src/engine/workflow');

const FIXTURE = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-save-as-473 }
providers:
  claude: { type: claude-code, command: claude, args: ["-p"] }
agents:
  dev: { provider: claude, session: ephemeral }
steps:
  - id: develop
    agent: dev
    prompt: "Implement it."
`;

function tmpDir(t, prefix) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// A run whose run folder is <tmp>/a/b/runs/<id> (so ../../x stays inside the temp folder) and whose
// worktree is another temp folder
function newRun(t) {
  const dir = tmpDir(t, 'save-as-473-');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, FIXTURE);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'a', 'b', 'runs'), skillsDirs: [] });
  fs.mkdirSync(run.runDir, { recursive: true });
  const worktree = tmpDir(t, 'save-as-473-wt-');
  run.ctx.worktree_dir = worktree;
  run.orchestrator = { id: 'orchestrator' };
  const events = [];
  run.on('event', (ev) => events.push(ev));
  return { run, events, worktree };
}

const save = (run, saveAs) => run.saveOutput({ id: 'develop', save_as: saveAs }, { ...run.ctx, agent: 'dev' }, 'the answer', null);
const savedPaths = (events) => events.filter((e) => e.type === 'file.saved').map((e) => e.path);
const refusalLogs = (events) => events.filter((e) => e.type === 'log' && e.step_id === 'develop' && /save_as/i.test(String(e.message)));

test('#473 save_as "../../x" (outside the run folder) throws an error naming save_as', (t) => {
  const { run } = newRun(t);
  assert.throws(() => save(run, '../../x'), /save_as/i);
});

test('#473 save_as "../../x" writes no file', (t) => {
  const { run, events } = newRun(t);
  const target = path.resolve(run.runDir, '../../x');
  try { save(run, '../../x'); } catch { /* the refusal: asserted in its own test */ }
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(savedPaths(events), []);
});

test('#473 save_as "../../x" emits a log event for the step naming save_as', (t) => {
  const { run, events } = newRun(t);
  try { save(run, '../../x'); } catch { /* the refusal */ }
  assert.equal(refusalLogs(events).length, 1, JSON.stringify(events.filter((e) => e.type === 'log').map((e) => e.message)));
});

test('#473 save_as an absolute path in another temp folder throws and writes nothing', (t) => {
  const { run, events } = newRun(t);
  const outside = tmpDir(t, 'save-as-473-outside-');
  const target = path.join(outside, 'stolen.md');
  assert.throws(() => save(run, target), /save_as/i);
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(savedPaths(events), []);
});

test('#473 save_as through a link inside the run folder that points outside is refused (real path)', (t) => {
  const { run, events } = newRun(t);
  const outside = tmpDir(t, 'save-as-473-outside-');
  fs.symlinkSync(outside, path.join(run.runDir, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => save(run, 'escape/stolen.md'), /save_as/i);
  assert.equal(fs.existsSync(path.join(outside, 'stolen.md')), false);
  assert.deepEqual(savedPaths(events), []);
});

test('#473 save_as a relative path under the run folder is written', (t) => {
  const { run, events } = newRun(t);
  save(run, 'out/answer.md');
  const target = path.join(run.runDir, 'out', 'answer.md');
  assert.equal(fs.readFileSync(target, 'utf8'), 'the answer');
  assert.equal(savedPaths(events).length, 1);
});

test('#473 save_as an absolute path under the run\'s worktree is written', (t) => {
  const { run, events, worktree } = newRun(t);
  const target = path.join(worktree, 'docs', 'answer.md');
  save(run, target);
  assert.equal(fs.readFileSync(target, 'utf8'), 'the answer');
  assert.equal(savedPaths(events).length, 1);
});
