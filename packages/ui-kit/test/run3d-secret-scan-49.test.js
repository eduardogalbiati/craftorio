// #49 (review): the run's 3D view shows a skipped secret scan as not run, never as done.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Run3DModel, STATUS_LABELS } = require('../run3d-model');

function scanStatus(status, message = '') {
  const m = new Run3DModel();
  m.apply({ type: 'workflow.started', ts: 1, run_id: 'r1', workflow: 'fix', steps: [{ id: 'secret_scan', type: 'secret_scan' }] });
  m.apply({ type: 'step.started', ts: 2, step_id: 'secret_scan', step_type: 'secret_scan', visit: 1 });
  m.apply({ type: 'step.finished', ts: 3, step_id: 'secret_scan', visit: 1, output: { kind: 'secret_scan', status, findings: [], message } });
  return m.state.secret_scan;
}

test('#49 a skipped scan is not run, a pass is done, a finding or an error is failed', () => {
  assert.equal(scanStatus('skipped').status, 'not_run');
  assert.match(scanStatus('skipped', 'Secrets not scanned: off.').note, /Secrets not scanned/);
  assert.equal(scanStatus('pass').status, 'done');
  for (const status of ['fail', 'error']) assert.equal(scanStatus(status).status, 'failed');
});

test('#49 the view has a label for every state of the model', () => {
  const view = fs.readFileSync(path.join(__dirname, '..', 'run3d', 'view.js'), 'utf8');
  for (const status of Object.keys(STATUS_LABELS)) assert.match(view, new RegExp(`\\n  ${status}: label\\(`), status);
});
