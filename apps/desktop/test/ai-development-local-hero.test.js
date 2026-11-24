// workflows/feature.yaml (#220): the tests-first workflow. Mock runs of the whole
// flow (acceptance tests → red check → develop → review → suite → merge), on a git repository in a
// temp folder so the developer's turn can change files; the mock writes no real code.
// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// its runs are in test/slow/ai-development-local-hero.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, evalExpr } = require('@craftorio/engine/engine/workflow');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', 'workflows', 'feature.yaml');

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
    inputs: { validation: mode, validate_every_round: false, screenshots: 'all', issues: [], unit_tests: 'write_and_run', e2e_tests: 'write_and_run', base_branch: 'main' },
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

test('ai-development-local-hero (#151, #670): a change to src/renderer/ with no screen listed goes back to develop once, then takes its screenshots', () => {
  const develop = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'develop');
  const scope = developScope({ screenshots: [], files: ['src/renderer/views/runs/runs.js'] });
  assert.equal(firstGoto(develop, scope), 'develop');
  assert.equal(firstGoto(develop, { ...scope, vars: { ui_screens_returned: 'yes' } }), 'developer_screenshots');
});

test('ai-development-local-hero (#151): a change with no UI skips the screenshots and goes straight to the review', () => {
  const develop = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'develop');
  assert.equal(firstGoto(develop, developScope({ screenshots: [], files: ['packages/engine/engine/workflow.js', 'docs/agents/engine.md'] })), 'code_review');
});

// #588: the project's UI folders are a workflow input (`ui_folders`, default `src/renderer/`), read by
// every route to developer_screenshots, by the ui_reviewer's agent_when and by its prompt.
// This repository's layout after the reorganisation (#577): the kit, the fronts and each app's renderer.
const REPO_UI = ['packages/ui-kit/', 'fronts/', 'apps/desktop/renderer/', 'apps/web/renderer/'];
const DEFAULTS = (wf) => Object.fromEntries(Object.entries(wf.inputs).filter(([, v]) => v && 'default' in v).map(([k, v]) => [k, v.default]));
// the run's state at each step that routes a committed change (develop, testid_check, the two gates
// answered "continue") and when code_review picks its agents; `inputs` overrides the workflow's defaults.
// #670: develop was already sent back once for its missing screens (vars.ui_screens_returned)
function uiScope(wf, { files, inputs = {}, output } = {}) {
  const develop = { committed: true, branch: 'feat', summary: 's', test_notes: 't', left_out: [], issues: [], files_changed: files, screenshots: [] };
  return {
    inputs: { ...DEFAULTS(wf), mode: 'auto', screenshots: 'changed', issues: [], check_command: '', base_branch: 'main', task: 't', ...inputs },
    vars: { ui_screens_returned: 'yes' },
    steps: { develop: { output: develop } },
    output: output || develop,
    choice: 'continue',
    previous_step: 'developer_screenshots',
  };
}
const ROUTES = [
  ['develop', undefined],
  ['testid_check', { kind: 'test_ids', status: 'pass', missing: [] }],
  ['requirements_left_out', undefined],
  ['issue_not_done', undefined],
];
const step = (wf, id) => wf.steps.find((s) => s.id === id);
const uiReviewerRuns = (wf, scope) => Boolean(evalExpr(step(wf, 'code_review').agent_when.ui_reviewer, scope));

test('ai-development-local-hero (#588): the project\'s UI folders and step definition folders are inputs, src/renderer/ and features/steps by default', () => {
  const wf = loadWorkflow(WORKFLOW);
  const folders = (v) => [].concat(v).map((f) => String(f).replace(/\/+$/, ''));
  assert.ok(wf.inputs.ui_folders, 'the workflow declares a ui_folders input');
  assert.deepEqual(folders(wf.inputs.ui_folders.default), ['src/renderer']);
  assert.ok(wf.inputs.steps_folders, 'the workflow declares a steps_folders input');
  assert.deepEqual(folders(wf.inputs.steps_folders.default), ['features/steps']);
});

for (const file of ['fronts/build/views/run/run.js', 'packages/ui-kit/style.css', 'apps/web/renderer/index.html', 'fronts\\plan\\views\\board\\board.js']) {
  test(`ai-development-local-hero (#588): with this repository's UI folders, a change to ${file} with no screen listed is captured and UI-reviewed`, () => {
    const wf = loadWorkflow(WORKFLOW);
    for (const [id, output] of ROUTES) {
      const scope = uiScope(wf, { files: ['packages/engine/engine/workflow.js', file], inputs: { ui_folders: REPO_UI }, output });
      assert.equal(firstGoto(step(wf, id), scope), 'developer_screenshots', `${id} goes to developer_screenshots`);
    }
    assert.equal(uiReviewerRuns(wf, uiScope(wf, { files: [file], inputs: { ui_folders: REPO_UI } })), true, 'the ui_reviewer runs');
  });
}

test('ai-development-local-hero (#588): with this repository\'s UI folders, a change outside them skips the screenshots and the UI reviewer', () => {
  const wf = loadWorkflow(WORKFLOW);
  const files = ['packages/engine/engine/workflow.js', 'docs/agents/engine.md'];
  for (const [id, output] of ROUTES) {
    assert.equal(firstGoto(step(wf, id), uiScope(wf, { files, inputs: { ui_folders: REPO_UI }, output })), 'code_review', `${id} goes to code_review`);
  }
  assert.equal(uiReviewerRuns(wf, uiScope(wf, { files, inputs: { ui_folders: REPO_UI } })), false);
});

test('ai-development-local-hero (#588): with no input set, a project with the old layout keeps src/renderer/ as its UI folder', () => {
  const wf = loadWorkflow(WORKFLOW);
  for (const [id, output] of ROUTES) {
    assert.equal(firstGoto(step(wf, id), uiScope(wf, { files: ['src/renderer/views/runs/runs.js'], output })), 'developer_screenshots', `${id}: src/renderer/ is a UI change`);
    assert.equal(firstGoto(step(wf, id), uiScope(wf, { files: ['fronts/build/views/run/run.js'], output })), 'code_review', `${id}: another project's layout is not assumed`);
  }
  assert.equal(uiReviewerRuns(wf, uiScope(wf, { files: ['src/renderer/style.css'] })), true);
  assert.equal(uiReviewerRuns(wf, uiScope(wf, { files: ['packages/ui-kit/style.css'] })), false);
});

test('ai-development-local-hero (#588): without screenshots, the UI reviewer reads the diff of the project\'s UI folders', () => {
  const { render } = require('@craftorio/engine/engine/run/templates');
  const wf = loadWorkflow(WORKFLOW);
  const prompt = (inputs) => render(step(wf, 'code_review').prompt, { ...uiScope(wf, { files: ['packages/ui-kit/style.css'], inputs }), agent: 'ui_reviewer' });
  const diffLine = (text) => text.split('\n').find((l) => /git diff/.test(l)) || '';
  const own = diffLine(prompt({ ui_folders: REPO_UI }));
  for (const folder of REPO_UI) assert.ok(own.includes(folder), `the diff covers ${folder}: ${own}`);
  assert.ok(!own.includes('src/renderer'), `src/renderer/ is not read on this layout: ${own}`);
  assert.ok(diffLine(prompt({})).includes('src/renderer/'), 'the default still diffs src/renderer/');
});

test('ai-development-local-hero (#151): the screenshots go to the review in automatic mode, to the owner\'s gate in validated mode', () => {
  const wf = loadWorkflow(WORKFLOW);
  const develop = wf.steps.find((s) => s.id === 'develop');
  const shots = wf.steps.find((s) => s.id === 'developer_screenshots');
  assert.equal(shots.type, 'screenshots', 'still the machine step (no model cost)');
  assert.equal(firstGoto(develop, developScope({ mode: 'validated', screenshots: [SCREEN] })), 'developer_screenshots');
  const after = (mode) => firstGoto(shots, { inputs: { validation: mode, validate_every_round: false, screenshots: 'all' }, vars: {}, steps: { develop: { output: { screenshots: [SCREEN] } } }, output: { kind: 'screenshots', taken: 1, errors: [] } });
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
  // #630: the second reviewer of the multi-model review (agent_when inputs.review == 'multi_model')
  assert.deepEqual([...(review.agents || [])].sort(), ['reviewer', 'second_reviewer', 'ui_reviewer']);
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

test('ai-development-local-hero (#151): the design-system skill holds the app\'s tokens from packages/ui-kit/style.css, apart from ui-conventions', () => {
  const skillPath = path.join(__dirname, '..', '..', '..', 'skills', 'design-system', 'SKILL.md');
  assert.ok(fs.existsSync(skillPath), 'skills/design-system/SKILL.md exists');
  const skill = fs.readFileSync(skillPath, 'utf8');
  assert.match(skill, /^---\r?\nname: design-system\r?\n/);
  assert.match(skill, /packages\/ui-kit\/style\.css/, 'it names where the tokens come from');
  const css = fsRead('packages', 'ui-kit', 'style.css');
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
  assert.match(fs.readdirSync(path.join(__dirname, '..', '..', '..', 'docs', 'agents', 'renderer')).map((f) => fsRead('docs', 'agents', 'renderer', f)).join('\n'), /design-system/);
});

test('ai-development-local-hero: the developer runs on Opus 5.5 by default, on Fable 5.2 when the run asks, with 3x the turn timeout', (t) => {
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
  const fable = make({ developer_model: 'claude-fable-5-2' });
  assert.equal(fable.wf.agents.developer.model, 'claude-fable-5-2');
  assert.equal(fable.turnTimeout(dev(fable)), 90 * 60e3);
  assert.equal(opus.wf.agents.reviewer.model, 'claude-fable-5-2', 'the reviewer runs on Fable 5.2 (Fable: owner 2026-11-07)');
  assert.equal(fable.wf.agents.reviewer.model, 'claude-fable-5-2', 'the reviewer keeps its own model');
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
  assert.equal(timeoutOf({ developer_effort: 'xhigh', developer_model: 'claude-fable-5-2' }), 180 * 60e3, '3x for Fable 5.2, then 2x for Extra high');
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
