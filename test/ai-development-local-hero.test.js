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
async function runAiDev(t, { mockSequences = {}, onTurn } = {}) {
  const repo = makeRepo(t);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dev-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    // the paths below are the lean ones (no extra test step, no E2E); the defaults are pinned by their own test
    inputs: { task: 'Add the feature', repo_path: repo, unit_tests: 'run_existing', e2e_tests: 'off' },
    mock: true,
    runsDir,
    // the reviewer approves the change on its first look, unless a test says otherwise
    mockSequences: { verdict: ['approved'], ...mockSequences },
  });
  const events = [];
  let turn = 0;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices[0].id, 'user', undefined));
    if (ev.type === 'session.message_sent' && ev.step_id === 'develop' && onTurn) onTurn(repo, ++turn);
  });
  await run.start();
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const prompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => e.prompt);
  return { events, transitions, prompts, finished: events.find((e) => e.type === 'workflow.finished'), repo };
}

test('ai-development-local-hero: the normal path runs the acceptance tests, the red check, develop, review, suite, then merges', { timeout: 120000 }, async (t) => {
  const { transitions, finished, prompts } = await runAiDev(t, { mockSequences: { suite: { red_check: ['fail'], suite: ['pass'] } } });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions, [
    'acceptance_tests>red_check',
    'red_check>develop',
    'develop>code_review',
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
  const review = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'code_review');
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
