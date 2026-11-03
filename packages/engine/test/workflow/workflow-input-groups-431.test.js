// #431: two optional fields on a workflow input, `group` (the small label the Product Owner drawer
// draws the option under) and `main: true` (shown before "Show more options"), set in the development
// workflows. Acceptance tests written before the change.
//
// The issue names ai-development-local-hero.yaml, software-development-local-hero.yaml and
// software-development.yaml; #630 merged them into workflows/feature.yaml (its `mode` is now
// local | remote | fork and the old auto | validated `mode` is `validation`, WorkflowInputs.modeInput),
// so feature.yaml is the development workflow checked here. The owner's "Mode" may be either input:
// the main set is Unit tests, E2E tests, Screenshots plus `mode` and/or `validation`, nothing else.
// Groups (owner's example): How it runs (Mode, Validation, Validate every round); Tests (Unit tests,
// E2E tests, Screenshots, E2E command, Test command, Suite red outside the change); Developer (model,
// effort); Checks (Check command). Names are not checked, only who shares a group.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const WORKFLOWS = path.join(__dirname, '..', '..', '..', '..', 'workflows');
const DEV_WORKFLOWS = ['feature.yaml'];
const MODE_KEYS = ['mode', 'validation'];
const TEST_MAIN = ['unit_tests', 'e2e_tests', 'screenshots'];
const inputsOf = (file) => yaml.load(fs.readFileSync(path.join(WORKFLOWS, file), 'utf8')).inputs || {};

for (const file of DEV_WORKFLOWS) {
  test(`#431 ${file}: exactly Mode, Unit tests, E2E tests and Screenshots are main: true`, () => {
    const inputs = inputsOf(file);
    const main = Object.keys(inputs).filter((k) => inputs[k].main === true).sort();
    for (const k of TEST_MAIN) assert.equal(main.includes(k), true, `${k} is main: true (main: ${JSON.stringify(main)})`);
    assert.equal(main.some((k) => MODE_KEYS.includes(k)), true, `mode or validation is main: true (main: ${JSON.stringify(main)})`);
    assert.deepEqual(main.filter((k) => !TEST_MAIN.includes(k) && !MODE_KEYS.includes(k)), [], 'no other input is main');
    const odd = Object.keys(inputs).filter((k) => 'main' in inputs[k] && typeof inputs[k].main !== 'boolean');
    assert.deepEqual(odd, [], '`main` is a boolean wherever it is set');
    // the engine still loads the workflow with the new fields
    const { loadWorkflow } = require('../../engine/run/load');
    assert.doesNotThrow(() => loadWorkflow(path.join(WORKFLOWS, file)));
  });

  // the inputs the Product Owner drawer never draws (#235: task, issue, issues, repo_path, base_branch)
  // need no group
  test(`#431 ${file}: every input the drawer draws has a non-empty group`, () => {
    const inputs = inputsOf(file);
    const NOT_DRAWN = ['task', 'issue', 'issues', 'repo_path', 'base_branch'];
    const missing = Object.keys(inputs).filter((k) => !NOT_DRAWN.includes(k) && (typeof inputs[k].group !== 'string' || !inputs[k].group.trim()));
    assert.deepEqual(missing, [], 'inputs without a group');
  });

  test(`#431 ${file}: Mode shares its group with Validate every round; the tests, the developer and the checks have their groups`, () => {
    const inputs = inputsOf(file);
    const g = (k) => inputs[k]?.group ?? null;
    assert.equal(typeof g('mode') === 'string' && g('mode').length > 0, true, 'mode has a group');
    for (const k of ['validation', 'validate_every_round']) if (k in inputs) assert.equal(g(k), g('mode'), `${k} is in Mode's group`);
    for (const k of ['e2e_tests', 'screenshots', 'e2e_command', 'test_command', 'suite_red_outside_change']) if (k in inputs) assert.equal(g(k), g('unit_tests'), `${k} is in Unit tests' group`);
    assert.notEqual(g('unit_tests'), g('mode'), 'the tests are not in Mode\'s group');
    assert.equal(g('developer_effort'), g('developer_model'), 'the developer\'s effort is with its model');
    assert.equal([g('mode'), g('unit_tests')].includes(g('developer_model')), false, 'the developer has its own group');
    assert.equal([g('mode'), g('unit_tests'), g('developer_model')].includes(g('check_command')), false, 'the checks have their own group');
  });
}
