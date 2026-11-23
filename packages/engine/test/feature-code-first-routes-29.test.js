// workflows/feature.yaml (#29), test order "code first": the routes after the tests written after the
// code, checked on the loaded workflow (its transitions evaluated, the develop prompt rendered) with
// no run. A red test goes back to develop once and the run goes on without asking the test writer
// again; the owner's change request (#247, criteria_triage) keeps acceptance_tests ► red_check ►
// develop as with tests first. The whole run's order is in slow/feature-code-first-order-29.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadWorkflow, evalExpr, render } = require('../engine/workflow');

const WORKFLOW = path.join(__dirname, '..', '..', '..', 'workflows', 'feature.yaml');
const wf = loadWorkflow(WORKFLOW);
const step = (id) => wf.steps.find((s) => s.id === id);
// the first transition whose condition holds, as the engine takes them
const next = (id, scope) => {
  const tr = (step(id).transitions || []).find((x) => x.when === undefined || evalExpr(x.when, scope));
  return tr ? tr.goto : null;
};

const INPUTS = { test_order: 'code_first', issues: [], validation: 'auto', screenshots: 'off', e2e_tests: 'off', ui_folders: [] };
const DEVELOP = { committed: true, branch: 'feat', files_changed: ['src/app.js'], issues: [] };
const ACC = { tests_added: ['test/app.test.js'], commit: 'abc1234', branch: 'feat' };

test('#29 code first: a red check with red acceptance tests goes back to develop', () => {
  const scope = {
    inputs: INPUTS, vars: {}, steps: { develop: { output: DEVELOP }, acceptance_tests: { output: ACC } },
    output: { status: 'fail', red_check: { red: ['test/app.test.js'], green: [] } },
  };
  assert.equal(next('red_check', scope), 'develop');
});

test('#29 code first: develop\'s second commit (after the red tests) goes on without writing the acceptance tests again', () => {
  const scope = {
    inputs: INPUTS, vars: {}, previous_step: 'red_check',
    steps: { develop: { output: DEVELOP }, acceptance_tests: { output: ACC }, red_check: { output: { status: 'fail', red_check: { red: ['test/app.test.js'] } } } },
    output: DEVELOP,
  };
  const to = next('develop', scope);
  assert.notEqual(to, 'acceptance_tests');
  assert.notEqual(to, null, 'develop has a route after its commit');
});

test('#29 code first: back from the red check, the develop prompt lists the red acceptance tests as gaps to close', () => {
  const develop = step('develop');
  const scope = {
    inputs: { ...INPUTS, task: 'Add the feature', base_branch: 'main' }, vars: {}, previous_step: 'red_check',
    steps: {
      develop: { output: DEVELOP }, acceptance_tests: { output: ACC },
      red_check: { output: { status: 'fail', message: 'RED-CHECK-MESSAGE', red_check: { red: ['test/app.test.js'], green: ['test/old.test.js'] } } },
    },
  };
  const prompt = render(develop.prompt, scope);
  assert.match(prompt, /fail after your code/);
  assert.match(prompt, /test\/app\.test\.js/);
  assert.doesNotMatch(prompt, /already-green/);
  assert.doesNotMatch(prompt, /RED-CHECK-MESSAGE/);
});

test('#29 E2E first (unchanged): the develop prompt after the red check keeps its message and the already-green hint', () => {
  const develop = step('develop');
  const scope = {
    inputs: { ...INPUTS, test_order: 'e2e_first', task: 'Add the feature', base_branch: 'main' }, vars: {},
    steps: {
      acceptance_tests: { output: ACC },
      red_check: { output: { status: 'fail', message: 'RED-CHECK-MESSAGE', red_check: { red: ['test/app.test.js'], green: ['test/old.test.js'] } } },
    },
  };
  const prompt = render(develop.prompt, scope);
  assert.match(prompt, /RED-CHECK-MESSAGE/);
  assert.match(prompt, /already-green/);
  assert.doesNotMatch(prompt, /fail after your code/);
});

test('#29 code first, owner\'s change request (#247): changed tests go acceptance_tests ► red_check ► develop', () => {
  const steps = { develop: { output: DEVELOP }, acceptance_tests: { output: ACC } };
  const vars = { criteria_triage: 'yes' };
  const changed = { ...ACC, criteria_changed: true, tests_changed: ['test/app.test.js'] };
  assert.equal(next('acceptance_tests', { inputs: INPUTS, vars, steps, output: changed }), 'red_check');
  const red = { status: 'fail', red_check: { red: ['test/app.test.js'], green: [] } };
  assert.equal(next('red_check', { inputs: INPUTS, vars, steps: { ...steps, acceptance_tests: { output: changed } }, output: red }), 'develop');
  // a passing red check after the request goes to develop too (not straight to rule_check)
  const green = { status: 'pass', red_check: { red: [], green: ['test/app.test.js'] } };
  assert.equal(next('red_check', { inputs: INPUTS, vars, steps: { ...steps, acceptance_tests: { output: changed } }, output: green }), 'develop');
});

test('#29 code first, owner\'s change request (#247) that changes no criterion: acceptance_tests goes straight to develop', () => {
  const steps = { develop: { output: DEVELOP }, acceptance_tests: { output: ACC } };
  const out = { ...ACC, criteria_changed: false, tests_changed: [] };
  assert.equal(next('acceptance_tests', { inputs: INPUTS, vars: { criteria_triage: 'yes' }, steps, output: out }), 'develop');
});
