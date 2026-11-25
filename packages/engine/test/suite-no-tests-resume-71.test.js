// #71 A run stopped at the gate `no_tests: ask` keeps and resumed there (resume: fromStep the gate, so
// no previous step): the gate says the same as when the suite led to it, and what its answer does.
// Seam: the bundled workflow resumed at its gate (WorkflowRun), no agent step runs; the gate is stopped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');

const ROOT = path.join(__dirname, '..', '..', '..');
const NOT_RUN = { kind: 'suite', status: 'not_run', failures: [], preexisting: [], log: null, reason: 'the project has no tests', message: 'The suite was not run: the project has no tests.' };

// the gate's approval.requested event, the run resumed at it after the suite ended `suite`
async function resumedGate(t, name, gate, suite, stop) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-tests-71-resume-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const run = new WorkflowRun({
    file: path.join(ROOT, 'workflows', `${name}.yaml`),
    inputs: { task: 'x', repo_path: dir, project_path: dir, no_tests: 'ask' },
    mock: true,
    runsDir: path.join(dir, 'runs'),
    resume: { runId: 'prev', fromStep: gate, steps: { suite: { output: suite, visits: 1 } }, sessions: {}, handoffs: {} },
  });
  run.sendToAgent = async () => ({ text: '```json\n{"explanation":"unclear","action":"escalate"}\n```' });
  let asked = null;
  run.on('event', (e) => {
    if (e.type !== 'approval.requested') return;
    asked = e;
    setImmediate(() => run.resolveApproval(e.approval_id, stop));
  });
  await run.start();
  assert.ok(asked, 'the gate asked');
  assert.equal(asked.step_id, gate);
  return asked;
}

test('#71 fix: verify_failed resumed after a suite with nothing to run says Approve goes on to the verification', async (t) => {
  const { message } = await resumedGate(t, 'fix', 'verify_failed', NOT_RUN, false);
  assert.match(message, /no tests/i);
  assert.match(message, /Approve to go on to the verification/);
  assert.doesNotMatch(message, /after the rounds of fixes/);
});

test('#71 feature: test_failed resumed after a suite with nothing to run never says tests fail', async (t) => {
  const { message } = await resumedGate(t, 'feature', 'test_failed', NOT_RUN, 'stop');
  assert.match(message, /no tests/i);
  assert.doesNotMatch(message, /still fail|not tested green/i);
});
