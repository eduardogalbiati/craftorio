// #702 through WorkflowRun and the bundled YAML (no whole run): a Code & Build run (a workflow that
// declares the `evidence` output: feature, fix) whose task or issues name docs/work/<item>/plan.md starts
// with a default `then` to sdlc-record.yaml (shown and editable on the Run screen like any chain); a run
// with no work item, a then given, "Retrospective after" on, or a workflow without `evidence` get none.
// A failed or stopped run never goes on: chain-model blockedReason (living-doc-outputs-651.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');
const { simInputs } = require('../helpers/sim-inputs');

const root = path.join(__dirname, '..', '..', '..', '..');
const wfFile = (name) => path.join(root, 'workflows', `${name}.yaml`);

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-702-then-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const newRun = (t, name, inputs, opts = {}) => new WorkflowRun({ file: wfFile(name), inputs: simInputs({ task: 'Add the feature', repo_path: root, ...inputs }), mock: true, runsDir: tmpDir(t), ...opts });
const plainThen = (then) => JSON.parse(JSON.stringify(then ?? null));

test('#702 a feature run whose task names docs/work/<item>/plan.md starts with a then to sdlc-record for that item', (t) => {
  const then = plainThen(newRun(t, 'feature', { task: 'Step 2 of docs/work/demo/plan.md: the editor' }).then);
  assert.deepEqual([then?.action, then?.workflow, then?.inputs?.item], ['workflow', 'sdlc-record.yaml', 'demo']);
  assert.deepEqual([then?.map?.run, then?.map?.evidence, then?.map?.merged_commit, then?.map?.pr_url],
    ['@run', 'evidence', 'merged_commit', 'pr_url']);
});

test('#702 a fix run whose issue body names the plan also chains sdlc-record', (t) => {
  const issues = [{ number: 12, title: 'Step two', url: 'https://github.com/o/r/issues/12', body: 'Part of docs/work/write-doc/plan.md (step 2).' }];
  const then = plainThen(newRun(t, 'fix', { task: 'Fix the editor' }, { issues }).then);
  assert.deepEqual([then?.workflow, then?.inputs?.item], ['sdlc-record.yaml', 'write-doc']);
});

test('#702 a run with no work item (or only a spec named) chains nothing', (t) => {
  assert.equal(newRun(t, 'feature', { task: 'Add the feature' }).then, null);
  assert.equal(newRun(t, 'feature', { task: 'See docs/work/demo/spec.md' }).then, null);
});

test('#702 a then given or "Retrospective after" on wins over the default sdlc-record then', (t) => {
  const task = 'Step 2 of docs/work/demo/plan.md';
  assert.equal(newRun(t, 'feature', { task }, { then: { action: 'workflow', workflow: 'release.yaml' } }).then?.workflow, 'release.yaml');
  assert.equal(newRun(t, 'feature', { task, retrospective: true }).then?.workflow, 'retrospective.yaml');
});

test('#702 a workflow without the evidence output never gets the default sdlc-record then', (t) => {
  assert.equal(newRun(t, 'analyze-project', { task: 'Map docs/work/demo/plan.md' }).then, null);
});
