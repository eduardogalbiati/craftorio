// #49 (review): a secret scan that was skipped is "Not run" in the run chat, with its message, never "Passed".
const test = require('node:test');
const assert = require('node:assert/strict');
const { RunChatModel } = require('../views/runchat/run-chat-model');

function scanItem(output) {
  const m = new RunChatModel();
  const ts = new Date(Date.UTC(2026, 10, 25)).toISOString();
  m.apply({ seq: 0, type: 'workflow.started', run_id: 'r1', workflow: 'fix', ts });
  m.apply({ seq: 1, type: 'step.started', step_id: 'secret_scan', visit: 1, step_type: 'secret_scan', agent: null, ts });
  m.apply({ seq: 2, type: 'step.finished', step_id: 'secret_scan', visit: 1, ts, output: { kind: 'secret_scan', findings: [], ...output } });
  return m.items.find((i) => i.kind === 'orchestrator' && i.step === 'secret_scan');
}

test('#49 a skipped scan is not run, and says why', () => {
  const it = scanItem({ status: 'skipped', message: 'Secrets not scanned: gitleaks is not installed.' });
  assert.equal(it.state, 'not_run');
  assert.equal(it.summary, 'Secrets not scanned: gitleaks is not installed.');
});

test('#49 a pass is passed; a finding or an error is failed', () => {
  assert.equal(scanItem({ status: 'pass', message: 'No secret found.' }).state, 'passed');
  for (const status of ['fail', 'error']) assert.equal(scanItem({ status, message: 'x' }).state, 'failed');
});
