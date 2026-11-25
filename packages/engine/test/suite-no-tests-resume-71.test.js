// #71 A run stopped at the gate `no_tests: ask` keeps and resumed there (resume: fromStep the gate, so
// no previous step): the gate says the same as when the suite led to it, and what its answer does.
// Seam: the bundled workflow resumed at its gate (WorkflowRun), no agent step runs; the gate is stopped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, evalExpr, loadWorkflow, render } = require('../engine/workflow');

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
  let told = '';
  run.sendToAgent = async (agent, prompt) => {
    told += prompt;
    return { text: '```json\n{"explanation":"unclear","action":"escalate"}\n```' };
  };
  let asked = null;
  run.on('event', (e) => {
    if (e.type !== 'approval.requested') return;
    asked = e;
    setImmediate(() => run.resolveApproval(e.approval_id, stop));
  });
  await run.start();
  assert.ok(asked, 'the gate asked');
  assert.equal(asked.step_id, gate);
  return { message: asked.message, told };
}

test('#71 fix: verify_failed resumed after a suite with nothing to run says Approve goes on to the verification', async (t) => {
  const { message, told } = await resumedGate(t, 'fix', 'verify_failed', NOT_RUN, false);
  assert.match(told, /only the owner answers/);
  assert.match(message, /no tests/i);
  assert.match(message, /Approve to go on to the verification/);
  assert.doesNotMatch(message, /after the rounds of fixes/);
});

test('#71 feature: test_failed resumed after a suite with nothing to run never says tests fail', async (t) => {
  const { message, told } = await resumedGate(t, 'feature', 'test_failed', NOT_RUN, 'stop');
  assert.match(told, /only the owner answers/);
  assert.match(message, /no tests/i);
  assert.doesNotMatch(message, /still fail|not tested green/i);
});

const BLOCKED = { ...NOT_RUN, status: 'blocked', reason: 'no test command: set the workflow\'s test_command input', message: 'The suite could not run: no test command: set the workflow\'s test_command input' };

for (const [name, gate, stop, advice] of [['feature', 'test_failed', 'stop', /stop: set the workflow's test_command/], ['fix', 'verify_failed', false, /reject: fix what kept the suite from running/]]) {
  test(`#71 ${name}: ${gate} resumed after a suite that could not run says so and recommends test_command`, async (t) => {
    const { message, told } = await resumedGate(t, name, gate, BLOCKED, stop);
    assert.match(message, /test suite could not run/);
    assert.match(message, /test_command/);
    assert.doesNotMatch(message, /after (the|3) rounds of fixes/);
    assert.match(told, advice);
  });
}

// the gate's text and what its answer records or does agree, whatever step led to it
test('#71 feature: Continue at test_failed records what the gate says, by the step that led to it', () => {
  const gate = loadWorkflow(path.join(ROOT, 'workflows', 'feature.yaml')).steps.find((s) => s.id === 'test_failed');
  for (const [previous_step, tested, says] of [
    ['suite', 'no tests', /not tested: the project has no tests/],
    [null, 'no tests', /not tested: the project has no tests/],
    ['test', 'not green', /reported as not tested green/],
    ['e2e', 'not green', /reported as not tested green/],
    ['heal', 'not green', /reported as not tested green/],
  ]) {
    const ctx = { choice: 'continue', previous_step, inputs: {}, vars: {}, output: {}, steps: { suite: { output: NOT_RUN, visits: 1 }, test: { output: { failure_report: 'f' } }, e2e: { output: { status: 'fail', failures: [] } }, heal: { visits: 1, output: { summary: 's' } } } };
    const tr = gate.transitions.find((x) => evalExpr(x.when, ctx));
    assert.deepEqual([tr.goto, tr.set.tested], ['build', tested], `after ${previous_step}`);
    assert.match(render(gate.message, ctx), says, `after ${previous_step}`);
  }
});
