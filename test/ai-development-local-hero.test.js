// workflows/ai-development-local-hero.yaml (#220): the tests-first workflow. Mock runs of the whole
// flow (acceptance tests → red check → develop → review → suite → merge), on a git repository in a
// temp folder so the developer's turn can change files; the mock writes no real code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow, evalExpr } = require('../src/engine/workflow');
// not from ./engine-helpers: requiring it registers that file's software-development matrix as tests here
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', 'workflows', 'ai-development-local-hero.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// a repository on main with one production file, and the run's branch checked out: the developer's
// commits must not be on main, or the guard reads them as part of the base (changedTestFiles ^main)
function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

// A mock run of the workflow. `mockSequences` shapes the mock's answers (suite.red_check: the red
// check's runner result per visit); `onTurn(repo, n)` plays the developer's side effects before its n-th turn.
// `answers: { stepId: [[choice, feedback], ...] }`: the owner's answer per visit of a gate (default: the
// first choice); `beforeAnswer(stepId, n)` runs just before the n-th answer of a gate (e.g. a long wait).
async function runAiDev(t, { mockSequences = {}, onTurn, failAgent, inputs = {}, answers = {}, beforeAnswer } = {}) {
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    // the paths below are the lean ones (no extra test step, no E2E); the defaults are pinned by their own test
    inputs: { task: 'Add the feature', repo_path: repo, unit_tests: 'run_existing', e2e_tests: 'off', ...inputs },
    mock: true,
    runsDir,
    // the reviewer approves the change on its first look, unless a test says otherwise
    mockSequences: { verdict: ['approved'], ...mockSequences },
  });
  // failAgent: that agent's turn fails, as when its CLI crashes (the boundary of the mock provider)
  if (failAgent) {
    const turnOf = run.runAgentStep.bind(run);
    run.runAgentStep = (step, st, name) => (name === failAgent ? Promise.reject(new Error(`${name} crashed (simulated)`)) : turnOf(step, st, name));
  }
  const events = [];
  let turn = 0;
  const answered = {};
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const n = (answered[ev.step_id] = (answered[ev.step_id] || 0) + 1);
      const [choice, feedback] = (answers[ev.step_id] || [])[n - 1] || [ev.choices[0].id, undefined];
      setImmediate(() => {
        if (beforeAnswer) beforeAnswer(ev.step_id, n);
        run.resolveApproval(ev.approval_id, choice, 'user', feedback);
      });
    }
    if (ev.type === 'session.message_sent' && ev.step_id === 'develop' && onTurn) onTurn(repo, ++turn);
  });
  await run.start();
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const promptsOf = (step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step).map((e) => e.prompt);
  const prompts = promptsOf('develop');
  return { events, transitions, prompts, promptsOf, finished: events.find((e) => e.type === 'workflow.finished'), repo };
}

test('ai-development-local-hero: the normal path runs the acceptance tests, the red check, develop, review, suite, then merges', { timeout: 120000 }, async (t) => {
  const { transitions, finished, prompts } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions, [
    'acceptance_tests>red_check',
    'red_check>develop',
    // #151: the mock developer lists one screen, so its screenshots are taken in automatic mode too
    'develop>developer_screenshots',
    'developer_screenshots>code_review',
    'code_review>suite',
    'suite>build',
    'build>evidence',
    'evidence>verify_change',
    'verify_change>end',
  ]);
  // the developer is given the acceptance tests the test writer wrote (the mock's placeholder name)
  assert.match(prompts[0], /Acceptance tests \(written before the code, from the task\): \(simulated\) tests_added\./);
});

test('ai-development-local-hero: an acceptance test that already passes is reported to develop as already green', { timeout: 120000 }, async (t) => {
  const { transitions, finished, prompts } = await runAiDev(t, { mockSequences: { suite: { red_check: ['pass'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions[1], 'red_check>develop', 'a green check goes straight to develop');
  assert.match(prompts[0], /already green/, 'the develop prompt names the tests that already pass');
});

test('ai-development-local-hero: acceptance tests that cannot run go back to the test writer once, then on to develop', { timeout: 120000 }, async (t) => {
  const { transitions, finished } = await runAiDev(t, { mockSequences: { suite: { red_check: ['broken', 'fail'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.slice(0, 4), [
    'acceptance_tests>red_check',
    'red_check>acceptance_tests',
    'acceptance_tests>red_check',
    'red_check>develop',
  ]);
});

test('ai-development-local-hero: acceptance tests still broken after the one send-back go on to develop, not round again', { timeout: 120000 }, async (t) => {
  const { transitions, finished } = await runAiDev(t, { mockSequences: { suite: { red_check: ['broken', 'broken'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'red_check>acceptance_tests').length, 1);
  assert.equal(transitions.filter((x) => x === 'acceptance_tests>red_check').length, 2);
  assert.ok(transitions.includes('red_check>develop'));
});

test('ai-development-local-hero: a developer turn that changes an acceptance test is refused, and the developer\'s own test file is not', { timeout: 120000 }, async (t) => {
  // the protected file is the one the test writer's step reports (the mock's placeholder name)
  const acceptance = '(simulated) tests_added';
  const { events, finished, prompts } = await runAiDev(t, {
    mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } },
    onTurn(repo, n) {
      if (n === 1) {
        fs.writeFileSync(path.join(repo, acceptance), 'changed by the developer\n');
        fs.writeFileSync(path.join(repo, 'test-own.test.js'), "require('node:test');\n");
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '-m', 'develop: change the acceptance test');
      }
      if (n === 2) {
        git(repo, 'rm', '-q', acceptance);
        git(repo, 'commit', '-q', '-m', 'put the acceptance test back');
      }
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  const refused = events.filter((e) => e.type === 'tests.refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].protected, true);
  assert.equal(refused[0].agent, 'developer');
  assert.deepEqual(refused[0].files, ['(simulated) tests_added'], 'only the acceptance test is refused');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /- \(simulated\) tests_added/);
});

test('ai-development-local-hero: the developer may add its own test file: the protection does not cover it', { timeout: 120000 }, async (t) => {
  const { events, finished } = await runAiDev(t, {
    mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } },
    onTurn(repo, n) {
      if (n === 1) {
        fs.writeFileSync(path.join(repo, 'test-own.test.js'), "require('node:test');\n");
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '-m', 'develop: its own internal test');
      }
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(events.filter((e) => e.type === 'tests.refused').length, 0);
});

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
test('ai-development-local-hero: a task with nothing testable goes straight from acceptance_tests to develop, through a mock run', { skip: 'the mock cannot return an empty tests_added (src/engine/providers.js, array case): needs a sequence for it' }, () => {});

// #179: the developer reviews its own diff (code-review skill's checklist and rules) before answering,
// and says what it checked in `self_review`, which the reviewer reads.
test('ai-development-local-hero (#179): the develop prompt ends with a self-review of `git diff <base>...HEAD` against the code-review skill', () => {
  const develop = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'develop');
  assert.match(develop.prompt, /self[- ]review/i);
  assert.match(develop.prompt, /git diff [^\s`]+\.\.\.HEAD/, 'the diff of the branch against its base');
  assert.match(develop.prompt, /code-review/, 'against the code-review skill\'s checklist and rules');
  assert.match(develop.prompt, /self_review/, 'the answer lists what it checked and changed in self_review');
  assert.match(develop.prompt, /sub-agent/i, 'one exploration sub-agent may read a large diff');
});

test('ai-development-local-hero (#179): develop\'s output schema accepts self_review; the acceptance tests stay protected in develop', () => {
  const wf = loadWorkflow(WORKFLOW);
  const develop = wf.steps.find((s) => s.id === 'develop');
  assert.ok(develop.output_schema.properties.self_review, 'develop output_schema has a self_review property');
  assert.equal(develop.agent, 'developer');
  const protect = (wf.agents.developer.protect_files || []).join('\n');
  assert.match(protect, /steps\.acceptance_tests\.output\.tests_added/, 'the developer\'s protect_files still cover the acceptance tests');
});

test('ai-development-local-hero (#179): software-development workflows are not changed: no self_review in their develop step', () => {
  const dir = path.join(__dirname, '..', 'workflows');
  const files = fs.readdirSync(dir).filter((f) => /^software-development.*\.yaml$/.test(f));
  assert.ok(files.includes('software-development.yaml'));
  for (const f of files) {
    const develop = loadWorkflow(path.join(dir, f)).steps.find((s) => s.id === 'develop');
    if (!develop) continue;
    assert.equal(develop.output_schema?.properties?.self_review, undefined, `${f}: develop schema has no self_review`);
    assert.doesNotMatch(develop.prompt, /self_review/, `${f}: develop prompt has no self_review`);
  }
});

test('ai-development-local-hero (#179): a mock run shows the developer\'s self_review in the code_review prompt', { timeout: 120000 }, async (t) => {
  const { events, finished, prompts } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  // rendered: the base branch is filled in
  assert.match(prompts[0], /git diff [^\s`{]+\.\.\.HEAD/);
  // the checklist the self-review reads: the code-review skill is loaded into the develop turn
  assert.match(prompts[0], /<skill name="code-review"/, 'the develop prompt carries the code-review skill');
  const developed = events.find((e) => e.type === 'step.finished' && e.step_id === 'develop');
  assert.ok(developed.output.self_review, 'the mock developer answers a self_review (from the schema)');
  // #151: code_review also runs the UI Reviewer; the code reviewer's own session is the one told
  const reviewer = events.find((e) => e.type === 'session.opened' && e.session.agent === 'reviewer');
  assert.ok(reviewer, 'the reviewer has a session');
  const review = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'code_review' && e.session_id === reviewer.session_id);
  assert.ok(review, 'code_review ran');
  assert.match(review.prompt, /self[- ]review/i, 'the reviewer is told about the developer\'s self-review');
  // the mock's value for a string field named self_review (src/engine/providers.js mockString)
  assert.match(review.prompt, /\(simulated\) self_review/, 'the developer\'s self_review is in the prompt');
});

test('ai-development-local-hero: quality first by default, the change\'s unit tests and its E2E scenarios are written and run', () => {
  const wf = loadWorkflow(WORKFLOW);
  assert.equal(wf.inputs.unit_tests.default, 'write_and_run');
  assert.equal(wf.inputs.e2e_tests.default, 'write_and_run');
});

// #151: a UI Reviewer runs next to the code reviewer, right after develop, on the screenshots the
// machine takes in every mode; the final evidence step only collects evidence, it no longer judges the UI.
const fsRead = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

// the goto of the first transition of a step whose `when` holds in this scope (the engine's order)
function firstGoto(step, scope) {
  const tr = step.transitions.find((x) => x.when === undefined || evalExpr(x.when, scope));
  return tr && tr.goto;
}
// develop's answer and the run's state when it finishes a committed turn
function developScope({ mode = 'auto', screenshots = [], files = ['src/engine/workflow.js'] } = {}) {
  return {
    inputs: { mode, validate_every_round: false, screenshots: 'all', issues: [], unit_tests: 'write_and_run', e2e_tests: 'write_and_run', base_branch: 'main' },
    vars: {},
    steps: {},
    output: { committed: true, branch: 'feat', summary: 's', test_notes: 't', self_review: 'r', left_out: [], issues: [], files_changed: files, screenshots },
  };
}
const SCREEN = { name: '151-dashboard-default', caption: 'The dashboard', args: ['--view', 'dashboard'] };
// the sessions a step opened, by agent: { reviewer: [session ids], ui_reviewer: [...] }
function sessionsOf(events, stepId) {
  const out = {};
  for (const e of events) if (e.type === 'session.opened' && e.session.step_id === stepId) (out[e.session.agent] ||= []).push(e.session_id);
  return out;
}

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
  assert.equal(firstGoto(develop, developScope({ screenshots: [], files: ['src/engine/workflow.js', 'docs/agents/engine.md'] })), 'code_review');
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

test('ai-development-local-hero (#151): a mock run with a UI change takes the screenshots, then runs the reviewer and the ui_reviewer in parallel', { timeout: 120000 }, async (t) => {
  const { events, transitions, finished } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(transitions.indexOf('develop>developer_screenshots') >= 0, 'the screenshots run after develop');
  assert.ok(transitions.indexOf('developer_screenshots>code_review') > transitions.indexOf('develop>developer_screenshots'), 'then the review, without the owner\'s gate');
  assert.ok(!transitions.includes('developer_screenshots>developer_check'), 'automatic mode has no developer_check gate');
  const sessions = sessionsOf(events, 'code_review');
  assert.ok(sessions.reviewer?.length, 'the reviewer ran in code_review');
  assert.ok(sessions.ui_reviewer?.length, 'the ui_reviewer ran in code_review');
  // in parallel: both agents are sent their prompt before either answers
  const ids = [...sessions.reviewer, ...sessions.ui_reviewer];
  const firstAnswer = events.findIndex((e) => e.type === 'session.message_received' && ids.includes(e.session_id));
  const sent = (id) => events.findIndex((e) => e.type === 'session.message_sent' && e.session_id === id);
  assert.ok(firstAnswer > 0, 'the review agents answered');
  assert.ok(sent(sessions.reviewer[0]) < firstAnswer && sent(sessions.ui_reviewer[0]) < firstAnswer, 'both prompts are sent before the first answer');
  // the UI Reviewer reviews against both skills: they are in its prompt
  const uiPrompt = events.find((e) => e.type === 'session.message_sent' && e.session_id === sessions.ui_reviewer[0]).prompt;
  assert.match(uiPrompt, /<skill name="ui-conventions"/);
  assert.match(uiPrompt, /<skill name="design-system"/);
});

test('ai-development-local-hero (#151): a blocking UI finding goes back to develop once, and the second review comes before test, suite, E2E and build', { timeout: 120000 }, async (t) => {
  // the mock's ui_findings: one blocking finding on every look (src/engine/providers.js)
  const { transitions, finished, prompts } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] }, ui_findings: true } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'code_review>develop').length, 1, 'one UI fix round, then the run goes on');
  const back = transitions.indexOf('code_review>develop');
  const later = transitions.findIndex((x) => /^(test|suite|e2e|build|evidence)>/.test(x) || /^code_review>(test|suite|e2e|build)$/.test(x));
  assert.ok(back >= 0 && later > back, 'the UI fix round happens before any test/suite/E2E/build');
  assert.equal(transitions.filter((x) => x === 'developer_screenshots>code_review').length, 2, 'the fixed change is captured and reviewed again');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /\(simulated\) problem/, 'the developer is given the blocking UI finding');
});

test('ai-development-local-hero (#151): code findings and a blocking UI finding reach develop together, in one turn', { timeout: 120000 }, async (t) => {
  const { transitions, finished, prompts } = await runAiDev(t, {
    mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] }, verdict: ['changes_requested', 'approved'], ui_findings: true },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'code_review>develop').length, 1, 'one fix round for both reviews');
  assert.match(prompts[1], /\(simulated\) description/, 'the code reviewer\'s finding');
  assert.match(prompts[1], /\(simulated\) problem/, 'the UI Reviewer\'s blocking finding');
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

test('ai-development-local-hero (#151): in a mock run, evidence\'s output carries no UI verdict even when the UI review blocks', { timeout: 120000 }, async (t) => {
  const { events, finished } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] }, ui_findings: true } });
  assert.equal(finished.status, 'success', finished.error);
  const evidence = events.filter((e) => e.type === 'step.finished' && e.step_id === 'evidence');
  assert.equal(evidence.length, 1, 'evidence runs once: it sends nothing back to develop');
  assert.equal(evidence[0].output.ui_findings, undefined);
});

test('ai-development-local-hero (#151): the design-system skill holds the app\'s tokens from src/renderer/style.css, apart from ui-conventions', () => {
  const skillPath = path.join(__dirname, '..', 'skills', 'design-system', 'SKILL.md');
  assert.ok(fs.existsSync(skillPath), 'skills/design-system/SKILL.md exists');
  const skill = fs.readFileSync(skillPath, 'utf8');
  assert.match(skill, /^---\r?\nname: design-system\r?\n/);
  assert.match(skill, /src\/renderer\/style\.css/, 'it names where the tokens come from');
  const css = fsRead('src', 'renderer', 'style.css');
  for (const token of ['--bg', '--panel', '--border', '--text', '--muted', '--accent', '--radius']) {
    assert.ok(css.includes(`${token}:`), `${token} is a style.css token`);
    assert.ok(skill.includes(token), `the skill lists ${token}`);
  }
  for (const topic of [/colou?r/i, /spacing/i, /typograph/i, /align/i]) assert.match(skill, topic);
  assert.notEqual(skill, fsRead('skills', 'ui-conventions', 'SKILL.md'));
});

// #151 review round: the one UI round, then a code-only round; fan-out visits are told apart for stalls
const UI_THEN_CODE = { suite: { red_check: ['fail'], suite: ['pass'] }, verdict: ['approved', 'changes_requested', 'approved'], ui_findings: true };

test('ai-development-local-hero (#151): after the UI round, a code-only fix round does not show develop the UI findings again', { timeout: 120000 }, async (t) => {
  const { transitions, finished, prompts } = await runAiDev(t, { mockSequences: UI_THEN_CODE });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'code_review>develop').length, 2, 'the UI round, then the code round');
  assert.equal(prompts.length, 3);
  assert.match(prompts[1], /\(simulated\) problem/, 'the UI round shows the blocking UI finding');
  assert.match(prompts[2], /\(simulated\) description/, 'the code round shows the reviewer\'s finding');
  assert.doesNotMatch(prompts[2], /\(simulated\) problem/, 'the UI findings are not sent a second time');
});

test('ai-development-local-hero (#151): code_review visits with different reviewer verdicts are not a same-answer stall', { timeout: 120000 }, async (t) => {
  const { events, transitions, finished } = await runAiDev(t, { mockSequences: UI_THEN_CODE });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'developer_screenshots>code_review').length, 3, 'code_review is visited 3 times');
  const stalls = events.filter((e) => e.type === 'log' && e.kind === 'stall' && e.stall === 'same_output' && e.step_id === 'code_review');
  assert.deepEqual(stalls.map((e) => e.message), []);
});

test('ai-development-local-hero (#151): a failed ui_reviewer does not block the run: the reviewer\'s approval goes on to the suite', { timeout: 120000 }, async (t) => {
  const { events, transitions, finished } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } }, failAgent: 'ui_reviewer' });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(transitions.includes('code_review>suite'), 'the run goes on after the review');
  assert.ok(transitions.includes('suite>build'));
  const review = events.find((e) => e.type === 'step.finished' && e.step_id === 'code_review');
  assert.deepEqual(review.output.failed.map((f) => f.agent), ['ui_reviewer']);
  assert.deepEqual(review.output.succeeded, ['reviewer']);
});

test('ai-development-local-hero (#151): a failed reviewer fails code_review even though the ui_reviewer answered', { timeout: 120000 }, async (t) => {
  const { events, transitions, finished } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } }, failAgent: 'reviewer' });
  assert.ok(!transitions.some((x) => /^code_review>(suite|test|e2e|build)$/.test(x)), 'no approval without the code reviewer');
  const reviews = events.filter((e) => e.type === 'step.finished' && e.step_id === 'code_review');
  assert.ok(reviews.length && reviews.every((e) => e.error === true), 'code_review only finishes as failed');
  assert.ok(events.some((e) => /required: reviewer/.test(String(e.message || e.error || ''))), 'the failure names the required reviewer');
  assert.notEqual(finished?.status, 'success');
});

test('ai-development-local-hero (#151): the docs name the ui_reviewer, the code_review fan-out and the design-system skill', () => {
  const engine = fsRead('docs', 'agents', 'engine.md');
  assert.match(engine, /ui_reviewer/);
  assert.match(engine, /code_review[\s\S]{0,300}(fan-out|parallel)|(fan-out|parallel)[\s\S]{0,300}code_review/i);
  assert.match(fsRead('docs', 'agents', 'renderer.md'), /design-system/);
});

test('ai-development-local-hero: the developer runs on Opus 5.5 by default, on Fable 5.1 when the run asks, with 1.5x the turn timeout', (t) => {
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
  assert.equal(fable.turnTimeout(dev(fable)), 45 * 60e3);
  assert.equal(fable.wf.agents.reviewer.model, 'claude-opus-5-5', 'the reviewer keeps its own model');
  assert.equal(loadWorkflow(WORKFLOW).orchestrator.limits.max_total_cost_usd, 120);
});

// #247 (acceptance tests, written before the code): Ask for changes at the owner's validation gate
// goes to the test writer first. It triages the request: criteria changed → it updates the affected
// acceptance tests and scenarios, the red check runs on them, then develop; a simple change → nothing
// changes and the run goes straight to develop. The output gains `criteria_changed` and `criteria_note`.
const REQUEST = 'Move the Archive button into the three-dots menu at the top right of the card';
const VALIDATED = { mode: 'validated', screenshots: 'off' };
const withoutSkills = (prompt) => String(prompt || '').replace(/<skill name="[^"]*"[\s\S]*?<\/skill>/g, '');

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

test('ai-development-local-hero (#247): changed criteria: acceptance_tests, the red check on the changed tests, then develop with the owner\'s request and the test writer\'s note', { timeout: 120000 }, async (t) => {
  const { transitions, prompts, finished } = await runAiDev(t, {
    inputs: VALIDATED,
    answers: { developer_check: [['changes', REQUEST], ['approve']] },
    mockSequences: { suite: { red_check: ['fail', 'fail'], suite: ['pass'] }, criteria_changed: [true] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.slice(0, 8), [
    'acceptance_tests>red_check',
    'red_check>develop',
    'develop>developer_check',
    'developer_check>acceptance_tests',
    'acceptance_tests>red_check',
    'red_check>develop',
    'develop>developer_check',
    'developer_check>code_review',
  ]);
  assert.equal(prompts.length, 2);
  assert.ok(prompts[1].includes(REQUEST), 'the developer still receives the owner\'s request');
  assert.match(prompts[1], /\(simulated\) criteria_note/, 'and the test writer\'s note on what changed in the tests');
});

test('ai-development-local-hero (#247): a simple change no test covers goes from acceptance_tests straight to develop, with no red check', { timeout: 120000 }, async (t) => {
  const { transitions, prompts, finished } = await runAiDev(t, {
    inputs: VALIDATED,
    answers: { developer_check: [['changes', REQUEST], ['approve']] },
    // false on every visit: the first visit (not from the gate) still goes to the red check
    mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] }, criteria_changed: [false] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.slice(0, 6), [
    'acceptance_tests>red_check',
    'red_check>develop',
    'develop>developer_check',
    'developer_check>acceptance_tests',
    'acceptance_tests>develop',
    'develop>developer_check',
  ]);
  assert.equal(transitions.filter((x) => x === 'acceptance_tests>red_check').length, 1, 'the red check runs only after the first visit');
  assert.ok(prompts[1].includes(REQUEST), 'the developer receives the owner\'s request');
});

test('ai-development-local-hero (#247): on the visit from the gate the acceptance prompt quotes the owner\'s request and asks for a triage first', { timeout: 120000 }, async (t) => {
  const { promptsOf, finished } = await runAiDev(t, {
    inputs: VALIDATED,
    answers: { developer_check: [['changes', REQUEST], ['approve']] },
    mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] }, criteria_changed: [false] },
  });
  assert.equal(finished.status, 'success', finished.error);
  const [first, fromGate] = promptsOf('acceptance_tests').map(withoutSkills);
  assert.ok(fromGate, 'acceptance_tests ran a second time');
  assert.ok(!first.includes(REQUEST), 'the first visit has no owner request');
  assert.ok(fromGate.includes(REQUEST), 'the owner\'s request is quoted');
  assert.match(fromGate, /validat/i, 'it says the request comes from the owner\'s validation');
  assert.match(fromGate, /triage/i, 'a quick triage first');
  assert.match(fromGate, /criteria_changed/, 'the answer says whether the criteria changed');
  assert.match(fromGate, /weaken/i, 'it never weakens a test to make the current code pass');
  // a short wait: the test writer's session is resumed (the prompt cache is still warm)
  assert.doesNotMatch(fromGate, /<handoff_note>/);
});

test('ai-development-local-hero (#247): changed tests the red check cannot run go back to the test writer once, are checked again, then develop gets the owner\'s request', { timeout: 120000 }, async (t) => {
  const { transitions, prompts, promptsOf, finished } = await runAiDev(t, {
    inputs: VALIDATED,
    answers: { developer_check: [['changes', REQUEST], ['approve']] },
    mockSequences: { suite: { red_check: ['fail', 'broken', 'fail'], suite: ['pass'] }, criteria_changed: [true] },
  });
  assert.equal(finished.status, 'success', finished.error);
  const gate = transitions.indexOf('developer_check>acceptance_tests');
  assert.deepEqual(transitions.slice(gate, gate + 6), [
    'developer_check>acceptance_tests',
    'acceptance_tests>red_check',
    'red_check>acceptance_tests',
    'acceptance_tests>red_check',
    'red_check>develop',
    'develop>developer_check',
  ]);
  const fix = withoutSkills(promptsOf('acceptance_tests')[2]);
  assert.match(fix, /cannot run/, 'the test writer is told which changed files cannot run');
  assert.equal(prompts.length, 2);
  assert.ok(prompts[1].includes(REQUEST), 'the developer still receives the owner\'s request after the detour');
});

test('ai-development-local-hero (#247): after a gate wait longer than the prompt cache, the visit from the gate starts a fresh test-writer session from its handoff note', { timeout: 120000 }, async (t) => {
  const { events, promptsOf, finished } = await runAiDev(t, {
    inputs: VALIDATED,
    answers: { developer_check: [['changes', REQUEST], ['approve']] },
    mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] }, criteria_changed: [false] },
    // the owner answers 7 hours later (the run of #238 waited 6.8 h)
    beforeAnswer(stepId, n) {
      if (stepId === 'developer_check' && n === 1) t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 7 * 3600e3 });
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  const fromGate = promptsOf('acceptance_tests')[1];
  assert.ok(fromGate, 'acceptance_tests ran a second time');
  assert.match(fromGate, /<handoff_note>/, 'a fresh session that starts from the test writer\'s handoff note');
  assert.ok(fromGate.includes(REQUEST), 'with the owner\'s request');
  const rotation = events.filter((e) => e.type === 'log' && e.kind === 'idle_rotation');
  assert.deepEqual(rotation.map((e) => [e.agent, e.step_id]), [['test_writer', 'acceptance_tests']], 'the run notes the fresh start once, for the test writer only');
});
