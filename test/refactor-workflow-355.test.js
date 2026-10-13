// workflows/refactor.yaml (#355): the Refactor workflow, checked without a whole run (the definition,
// its inputs, the skills a language picks, its transitions, its docs). Whole mock runs are in
// test/slow/refactor-workflow-355.slow.test.js. The workflow is loaded inside each test: the file is
// written after these tests (tests first).
// Contract assumed by these tests: steps `pin_behaviour` (the test writer's characterization tests),
// `green_check` (a suite step on those files, `expect: green`: they must pass on the unchanged code),
// `refactor` (the developer, structure only) and `review` ("same behaviour, simpler structure?").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, evalExpr } = require('../src/engine/workflow');

const root = path.join(__dirname, '..');
const WORKFLOW = path.join(root, 'workflows', 'refactor.yaml');
const load = () => loadWorkflow(WORKFLOW);
const stepOf = (wf, id) => {
  const step = wf.steps.find((s) => s.id === id);
  assert.ok(step, `step "${id}" in workflows/refactor.yaml`);
  return step;
};

function newRun(t, inputs) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-355-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  return new WorkflowRun({ file: WORKFLOW, inputs: { task: 'Split the handler', repo_path: root, ...inputs }, mock: true, runsDir });
}

test('refactor workflow: the bundled workflow loads, is named refactor, and starts by pinning the behaviour', () => {
  const wf = load();
  assert.equal(wf.metadata.name, 'refactor');
  assert.equal(wf.steps[0].id, 'pin_behaviour', 'the characterization tests come before any change');
  const ids = wf.steps.map((s) => s.id);
  assert.ok(ids.indexOf('pin_behaviour') < ids.indexOf('refactor'));
  for (const id of ['green_check', 'refactor', 'review']) stepOf(wf, id);
});

test('refactor workflow: the target is an issue or a free target, for any supported language', () => {
  const wf = load();
  for (const name of ['task', 'issue', 'repo_path', 'target', 'language']) assert.ok(wf.inputs[name], `input "${name}"`);
  assert.equal(wf.inputs.language.default, 'js');
  for (const lang of ['js', 'python', 'go', 'java', 'csharp']) assert.ok(wf.inputs.language.enum.includes(lang), lang);
});

test('refactor workflow: the pinned tests must pass on the unchanged code (a green check on exactly those files)', () => {
  const wf = load();
  const check = stepOf(wf, 'green_check');
  assert.equal(check.type, 'suite');
  assert.equal(check.expect, 'green');
  assert.match(String(check.files), /steps\.pin_behaviour\.output\.tests_added/);
  // a pinned test that fails on the unchanged code goes back to the test writer, never on to the refactor
  const failing = check.transitions.find((tr) => evalExpr(tr.when, { output: { status: 'fail' }, steps: {}, inputs: {}, vars: {} }));
  assert.equal(failing.goto, 'pin_behaviour');
  const passing = check.transitions.find((tr) => evalExpr(tr.when, { output: { status: 'pass' }, steps: {}, inputs: {}, vars: {} }));
  assert.equal(passing.goto, 'refactor');
});

test('refactor workflow: the pin step commits its tests and reports them (tests_added, commit)', () => {
  const step = stepOf(load(), 'pin_behaviour');
  const required = (step.output_schema || step.schema || {}).required || [];
  for (const field of ['tests_added', 'commit']) assert.ok(required.includes(field), `pin_behaviour output requires ${field}`);
});

test('refactor workflow: the developer may not edit any test, and the pinned tests are protected', () => {
  const wf = load();
  const agentName = stepOf(wf, 'refactor').agent;
  const agent = wf.agents[agentName];
  assert.equal(agent.edits_tests, false, 'existing tests are not edited either: structure only');
  const protect = JSON.stringify(stepOf(wf, 'refactor').protect_files || agent.protect_files || []);
  assert.match(protect, /steps\.pin_behaviour\.output\.tests_added/);
});

test('refactor workflow: the reviewer answers "same behaviour, simpler structure?" from before/after figures', () => {
  const review = JSON.stringify(stepOf(load(), 'review'));
  assert.match(review, /same_behaviour/);
  assert.match(review, /simpler_structure/);
  for (const figure of ['lines', 'files_touched', 'complexity']) assert.match(review, new RegExp(figure), figure);
});

test('refactor workflow: a behaviour change found by the review goes back to the refactor, not on', () => {
  const review = stepOf(load(), 'review');
  const scope = (verdict) => ({ output: { same_behaviour: verdict, simpler_structure: true, verdict: verdict ? 'approved' : 'changes_requested', results: { reviewer: { same_behaviour: verdict, simpler_structure: true, verdict: verdict ? 'approved' : 'changes_requested' } } }, steps: {}, inputs: {}, vars: {} });
  const onChange = review.transitions.find((tr) => evalExpr(tr.when, scope(false)));
  assert.equal(onChange.goto, 'refactor');
  const onSame = review.transitions.find((tr) => evalExpr(tr.when, scope(true)));
  assert.notEqual(onSame.goto, 'refactor');
});

test('refactor workflow: the full suite and the build audit run as gates', () => {
  const wf = load();
  assert.ok(wf.steps.some((s) => s.type === 'suite' && s.id !== 'green_check'), 'a full-suite step');
  const builder = wf.steps.find((s) => s.agent && JSON.stringify(wf.agents[s.agent].skills || []).includes('build-audit-'));
  assert.ok(builder, 'a step whose agent has the build-audit-<language> skill');
});

test('refactor workflow: a non-JS language picks its own unit-test skill for the pin step', (t) => {
  const skills = stepOf(load(), 'pin_behaviour').skills;
  for (const lang of ['python', 'go']) {
    const names = newRun(t, { language: lang }).skillNames(skills);
    assert.ok(names.includes(`unit-test-writer-${lang}`), `${lang}: ${names.join(', ')}`);
    assert.equal(names.includes('unit-test-writer-js'), false, `${lang}: ${names.join(', ')}`);
  }
});

test('refactor workflow: every step is in a group, and the run records the before/after figures as outputs', () => {
  const wf = load();
  const grouped = new Set((wf.groups || []).flatMap((g) => g.steps));
  for (const s of wf.steps) assert.ok(grouped.has(s.id) || s.id === 'pin_behaviour' || s.id === 'green_check', `step ${s.id} in a group`);
  const outputs = Object.keys(wf.outputs || {});
  for (const name of ['before', 'after']) assert.ok(outputs.includes(name), `output "${name}"`);
});

test('refactor workflow: documented in docs/features and in the README workflow table', () => {
  const fragment = path.join(root, 'docs', 'features', 'refactor.md');
  assert.ok(fs.existsSync(fragment), 'docs/features/refactor.md');
  const text = fs.readFileSync(fragment, 'utf8');
  assert.match(text, /<!-- section:workflows -->/);
  assert.match(text, /workflows\/refactor\.yaml/);
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /refactor\.yaml/);
});
