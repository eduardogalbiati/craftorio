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
    inputs: { task: 'Add the feature', repo_path: repo },
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
