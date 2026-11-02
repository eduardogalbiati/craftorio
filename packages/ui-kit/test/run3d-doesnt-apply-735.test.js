// #735: the run's 3D view dims the steps and agents the run's inputs rule out (run-plan.js), like the run screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Run3DModel } = require('../run3d-model');

const steps = [
  { id: 'develop', type: 'agent', agent: 'developer' },
  { id: 'developer_screenshots', type: 'screenshots' },
  { id: 'testid_check', type: 'testid_check' },
  { id: 'code_review', type: 'agent', agent: 'reviewer · ui_reviewer' },
  { id: 'e2e', type: 'agent', agent: 'test_writer' },
];

function started(inputs) {
  const m = new Run3DModel();
  m.apply({ type: 'workflow.started', ts: 1, run_id: 'r1', workflow: 'feature', steps, inputs });
  return m;
}

test('a backend run (no UI folders, E2E off) dims the UI steps and the UI Reviewer', () => {
  const m = started({ mode: 'remote', ui_folders: [], screenshots: 'off', e2e_tests: 'off' });
  assert.equal(m.doesntApply('developer_screenshots'), 'run.doesnt_apply_no_ui');
  assert.equal(m.doesntApply('testid_check'), 'run.doesnt_apply_no_ui');
  assert.equal(m.doesntApply('ui_reviewer'), 'run.doesnt_apply_no_ui');
  assert.ok(m.doesntApply('e2e'));
  assert.equal(m.doesntApply('develop'), null);
  assert.equal(m.doesntApply('code_review'), null);
});

test('a frontend run dims nothing', () => {
  const m = started({ ui_folders: ['src/renderer/'], screenshots: 'all', e2e_tests: 'write_and_run' });
  assert.deepEqual(m.notApplying, {});
});

test('the dimmed steps survive a dump / restore (the replay)', () => {
  const m = started({ ui_folders: [], e2e_tests: 'off' });
  const copy = new Run3DModel();
  copy.restore(m.dump());
  assert.equal(copy.doesntApply('testid_check'), 'run.doesnt_apply_no_ui');
});
