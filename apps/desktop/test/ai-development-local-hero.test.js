// workflows/ai-development-local-hero.yaml (#220): the tests-first workflow. Mock runs of the whole
// flow (acceptance tests → red check → develop → review → suite → merge), on a git repository in a
// temp folder so the developer's turn can change files; the mock writes no real code.
// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// its runs are in test/slow/ai-development-local-hero.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, evalExpr } = require('@multiagent/engine/engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', 'workflows', 'ai-development-local-hero.yaml');

test('ai-development-local-hero: the transition from acceptance_tests goes to develop when no acceptance test was written', () => {
  const wf = loadWorkflow(WORKFLOW);
  const acceptance = wf.steps.find((s) => s.id === 'acceptance_tests');
  const toDevelop = acceptance.transitions.find((tr) => tr.goto === 'develop');
  assert.ok(toDevelop, 'acceptance_tests has a transition to develop');
  assert.equal(evalExpr(toDevelop.when, { output: { tests_added: [] } }), true);
  assert.equal(evalExpr(toDevelop.when, { output: { tests_added: ['test/a.test.js'] } }), false);
});

// The mock provider returns one placeholder for a list of strings (providers.js, the array case), so
// a run cannot write "nothing testable" yet: the route to develop is checked above, the run is left out here.
test('ai-development-local-hero: a task with nothing testable goes straight from acceptance_tests to develop, through a mock run', { skip: 'the mock cannot return an empty tests_added (packages/engine/engine/providers.js, array case): needs a sequence for it' }, () => {});

// #179's self-review in the develop turn was moved out by #303 (test/develop-turn-303.test.js):
// the code_review step is the review.
test('ai-development-local-hero (#179, #303): the acceptance tests stay protected in develop', () => {
  const wf = loadWorkflow(WORKFLOW);
  const develop = wf.steps.find((s) => s.id === 'develop');
  assert.equal(develop.agent, 'developer');
  const protect = (wf.agents.developer.protect_files || []).join('\n');
  assert.match(protect, /steps\.acceptance_tests\.output\.tests_added/, 'the developer\'s protect_files still cover the acceptance tests');
});

test('ai-development-local-hero (#179): software-development workflows are not changed: no self_review in their develop step', () => {
  const dir = path.join(__dirname, '..', '..', '..', 'workflows');
  const files = fs.readdirSync(dir).filter((f) => /^software-development.*\.yaml$/.test(f));
  assert.ok(files.includes('software-development.yaml'));
  for (const f of files) {
    const develop = loadWorkflow(path.join(dir, f)).steps.find((s) => s.id === 'develop');
    if (!develop) continue;
    assert.equal(develop.output_schema?.properties?.self_review, undefined, `${f}: develop schema has no self_review`);
    assert.doesNotMatch(develop.prompt, /self_review/, `${f}: develop prompt has no self_review`);
  }
});

test('ai-development-local-hero: quality first by default, the change\'s unit tests and its E2E scenarios are written and run', () => {
  const wf = loadWorkflow(WORKFLOW);
  assert.equal(wf.inputs.unit_tests.default, 'write_and_run');
  assert.equal(wf.inputs.e2e_tests.default, 'write_and_run');
});

// #151: a UI Reviewer runs next to the code reviewer, right after develop, on the screenshots the
// machine takes in every mode; the final evidence step only collects evidence, it no longer judges the UI.
const fsRead = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...p), 'utf8');

// the goto of the first transition of a step whose `when` holds in this scope (the engine's order)
function firstGoto(step, scope) {
  const tr = step.transitions.find((x) => x.when === undefined || evalExpr(x.when, scope));
  return tr && tr.goto;
}
// develop's answer and the run's state when it finishes a committed turn
function developScope({ mode = 'auto', screenshots = [], files = ['packages/engine/engine/workflow.js'] } = {}) {
  return {
    inputs: { mode, validate_every_round: false, screenshots: 'all', issues: [], unit_tests: 'write_and_run', e2e_tests: 'write_and_run', base_branch: 'main' },
    vars: {},
    steps: {},
    output: { committed: true, branch: 'feat', summary: 's', test_notes: 't', left_out: [], issues: [], files_changed: files, screenshots },
  };
}
const SCREEN = { name: '151-dashboard-default', caption: 'The dashboard', args: ['--view', 'dashboard'] };

test('ai-development-local-hero (#151): a change with screens to capture takes its screenshots right after develop, in automatic mode too', () => {
  const develop = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'develop');
  assert.equal(firstGoto(develop, developScope({ screenshots: [SCREEN] })), 'developer_screenshots');
});

test('ai-development-local-hero (#151): a change to src/renderer/ takes its screenshots after develop even when the developer listed no screen', () => {
  const develop = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'develop');
  assert.equal(firstGoto(develop, developScope({ screenshots: [], files: ['src/renderer/views/runs/runs.js'] })), 'developer_screenshots');
});

test('ai-development-local-hero (#151): a change with no UI skips the screenshots and goes straight to the review', () => {
  const develop = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'develop');
  assert.equal(firstGoto(develop, developScope({ screenshots: [], files: ['packages/engine/engine/workflow.js', 'docs/agents/engine.md'] })), 'code_review');
});

test('ai-development-local-hero (#151): the screenshots go to the review in automatic mode, to the owner\'s gate in validated mode', () => {
  const wf = loadWorkflow(WORKFLOW);
  const develop = wf.steps.find((s) => s.id === 'develop');
  const shots = wf.steps.find((s) => s.id === 'developer_screenshots');
  assert.equal(shots.type, 'screenshots', 'still the machine step (no model cost)');
  assert.equal(firstGoto(develop, developScope({ mode: 'validated', screenshots: [SCREEN] })), 'developer_screenshots');
  const after = (mode) => firstGoto(shots, { inputs: { mode, validate_every_round: false, screenshots: 'all' }, vars: {}, steps: { develop: { output: { screenshots: [SCREEN] } } }, output: { kind: 'screenshots', taken: 1, errors: [] } });
  assert.equal(after('auto'), 'code_review');
  assert.equal(after('validated'), 'developer_check');
});

test('ai-development-local-hero (#151): the ui_reviewer is a read-only, cheaper agent with the ui-conventions and design-system skills', () => {
  const wf = loadWorkflow(WORKFLOW);
  const ui = wf.agents.ui_reviewer;
  assert.ok(ui, 'the workflow declares a ui_reviewer agent');
  assert.deepEqual([...ui.skills].sort(), ['design-system', 'ui-conventions']);
  const tools = ui.capabilities.tools;
  assert.ok(tools.includes('read'), 'it reads the screenshots');
  for (const t of ['edit', 'write']) assert.ok(!tools.includes(t), `read-only: no ${t}`);
  assert.doesNotMatch(String(ui.model), /opus/i, 'a model chosen for cost (not Opus)');
});

test('ai-development-local-hero (#151): code_review fans out to the reviewer and the ui_reviewer, and a UI Reviewer failure alone does not fail it', () => {
  const review = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'code_review');
  assert.deepEqual([...(review.agents || [])].sort(), ['reviewer', 'ui_reviewer']);
  assert.equal(review.min_success, 1, 'one agent answering is enough: a failed UI Reviewer never blocks the run');
});

test('ai-development-local-hero (#151): the evidence step collects evidence but no longer judges the UI', () => {
  const wf = loadWorkflow(WORKFLOW);
  assert.ok(!wf.agents.evidence.skills.includes('ui-conventions'), 'evidence does not load ui-conventions');
  const evidence = wf.steps.find((s) => s.id === 'evidence');
  assert.equal(evidence.output_schema.properties.ui_findings, undefined, 'no ui_findings in its output');
  assert.ok(evidence.output_schema.properties.evidence, 'it still returns the collected evidence');
  for (const tr of evidence.transitions) assert.doesNotMatch(String(tr.when), /ui_findings/, 'no transition on a UI verdict');
  assert.doesNotMatch(evidence.prompt, /ui_findings/, 'the prompt asks for no UI verdict');
});

test('ai-development-local-hero (#151): the design-system skill holds the app\'s tokens from apps/desktop/renderer/style.css, apart from ui-conventions', () => {
  const skillPath = path.join(__dirname, '..', '..', '..', 'skills', 'design-system', 'SKILL.md');
  assert.ok(fs.existsSync(skillPath), 'skills/design-system/SKILL.md exists');
  const skill = fs.readFileSync(skillPath, 'utf8');
  assert.match(skill, /^---\r?\nname: design-system\r?\n/);
  assert.match(skill, /apps\/desktop\/renderer\/style\.css/, 'it names where the tokens come from');
  const css = fsRead('apps', 'desktop', 'renderer', 'style.css');
  for (const token of ['--bg', '--panel', '--border', '--text', '--muted', '--accent', '--radius']) {
    assert.ok(css.includes(`${token}:`), `${token} is a style.css token`);
    assert.ok(skill.includes(token), `the skill lists ${token}`);
  }
  for (const topic of [/colou?r/i, /spacing/i, /typograph/i, /align/i]) assert.match(skill, topic);
  assert.notEqual(skill, fsRead('skills', 'ui-conventions', 'SKILL.md'));
});

test('ai-development-local-hero (#151): the docs name the ui_reviewer, the code_review fan-out and the design-system skill', () => {
  // the engine docs are one file per topic (#251), engine.md being their index
  const topics = path.join(__dirname, '..', '..', '..', 'docs', 'agents', 'engine');
  const engine = fs.readdirSync(topics).filter((f) => f.endsWith('.md')).map((f) => fsRead('docs', 'agents', 'engine', f)).join('\n');
  assert.match(engine, /ui_reviewer/);
  assert.match(engine, /code_review[\s\S]{0,300}(fan-out|parallel)|(fan-out|parallel)[\s\S]{0,300}code_review/i);
  assert.match(fsRead('docs', 'agents', 'renderer.md'), /design-system/);
});

test('ai-development-local-hero: the developer runs on Opus 5.5 by default, on Fable 5.1 when the run asks, with 3x the turn timeout', (t) => {
  const make = (inputs) => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-model-'));
    t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
    return new WorkflowRun({ file: WORKFLOW, inputs: { task: 'Add the feature', repo_path: runsDir, ...inputs }, mock: true, runsDir });
  };
  // the engine merges defaults into the agent when it calls it
  const dev = (r) => ({ ...(r.wf.defaults || {}), ...r.wf.agents.developer });
  const opus = make({});
  assert.equal(opus.wf.agents.developer.model, 'claude-opus-5-5');
  assert.equal(opus.turnTimeout(dev(opus)), 30 * 60e3);
  const fable = make({ developer_model: 'claude-fable-5-1' });
  assert.equal(fable.wf.agents.developer.model, 'claude-fable-5-1');
  assert.equal(fable.turnTimeout(dev(fable)), 90 * 60e3);
  assert.equal(fable.wf.agents.reviewer.model, 'claude-opus-5-5', 'the reviewer keeps its own model');
  assert.equal(loadWorkflow(WORKFLOW).orchestrator.limits.max_total_cost_usd, 120);
});

test('ai-development-local-hero (#286): an Extra high developer effort doubles the turn timeout; Default and High keep it', (t) => {
  const make = (inputs) => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-effort-'));
    t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
    return new WorkflowRun({ file: WORKFLOW, inputs: { task: 'Add the feature', repo_path: runsDir, ...inputs }, mock: true, runsDir });
  };
  const timeoutOf = (inputs) => { const r = make(inputs); return r.turnTimeout({ ...(r.wf.defaults || {}), ...r.wf.agents.developer }); };
  assert.equal(timeoutOf({}), 30 * 60e3);
  assert.equal(timeoutOf({ developer_effort: 'default' }), 30 * 60e3);
  assert.equal(timeoutOf({ developer_effort: 'high' }), 30 * 60e3);
  assert.equal(timeoutOf({ developer_effort: 'xhigh' }), 60 * 60e3);
  assert.equal(timeoutOf({ developer_effort: 'xhigh', developer_model: 'claude-fable-5-1' }), 180 * 60e3, '3x for Fable 5.1, then 2x for Extra high');
});

test('ai-development-local-hero (#247): Ask for changes at developer_check goes to acceptance_tests; Approve and Stop are unchanged', () => {
  const gate = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'developer_check');
  const scope = (choice) => ({ choice, inputs: { mode: 'validated', validate_every_round: false, screenshots: 'off', e2e_tests: 'off', unit_tests: 'run_existing' }, vars: {}, steps: {}, output: { choice } });
  assert.equal(firstGoto(gate, scope('changes')), 'acceptance_tests', 'the test writer sees the owner\'s request first');
  assert.equal(firstGoto(gate, scope('approve')), 'code_review');
  assert.equal(firstGoto(gate, scope('stop')), 'end');
});

test('ai-development-local-hero (#247): the acceptance tests step answers criteria_changed and criteria_note', () => {
  const acceptance = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'acceptance_tests');
  const props = acceptance.output_schema.properties;
  assert.equal(props.criteria_changed?.type, 'boolean');
  assert.equal(props.criteria_note?.type, 'string');
});
