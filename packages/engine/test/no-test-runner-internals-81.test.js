// #81 internals: a suite with no test runner (`not_run` + `no_command`) in the gates and the prompts that
// read `tested`, the routing with `no_tests: ask`, and a workflow that does not name not_run.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { routedStatus } = require('../engine/suite-no-command');
const { loadWorkflow, evalExpr, render } = require('../engine/workflow');

const workflow = (name) => loadWorkflow(path.join(__dirname, '..', '..', '..', 'workflows', `${name}.yaml`));
const NO_COMMAND = { status: 'not_run', no_command: true, reason: 'no test command', message: 'The suite was not run: no test command.' };

test('#81 no test command goes on whatever no_tests says (it is not the no-tests policy)', () => {
  for (const [name, on] of [['feature', 'build'], ['fix', 'verify_change']]) {
    const step = workflow(name).steps.find((s) => s.id === 'suite');
    const ctx = { inputs: { no_tests: 'ask', e2e_tests: 'off' }, vars: {}, steps: { suite: { output: NO_COMMAND } }, output: NO_COMMAND };
    const tr = step.transitions.find((x) => x.when === undefined || evalExpr(x.when, ctx));
    assert.deepEqual([tr.goto, tr.set], [on, { tested: 'no test command' }]);
  }
});

test('#81 fix: an Approve at verify_failed after the verifier\'s rounds keeps "no test command"', () => {
  const gate = workflow('fix').steps.find((s) => s.id === 'verify_failed');
  const ctx = { approved: true, rejected: false, previous_step: 'verify_change', inputs: { mode: 'local' }, vars: { tested: 'no test command' }, steps: { suite: { output: NO_COMMAND } }, output: {} };
  const tr = gate.transitions.find((x) => evalExpr(x.when, ctx));
  assert.deepEqual([tr.goto, render(tr.set.tested, ctx).trim()], ['push_main', 'no test command']);
});

test('#81 feature: the build and verify prompts say "not tested: no test command"', () => {
  for (const id of ['build', 'verify_change']) {
    const step = workflow('feature').steps.find((s) => s.id === id);
    assert.match(String(step.prompt), /vars\.tested == 'no test command'/, id);
  }
});

test('#81 a workflow that does not name not_run still routes a suite with no test runner as blocked', () => {
  const r = routedStatus(NO_COMMAND, { transitions: [{ when: "output.status == 'blocked'", goto: 'x' }] });
  assert.equal(r.status, 'blocked');
  assert.match(r.reason, /test_command/);
});
