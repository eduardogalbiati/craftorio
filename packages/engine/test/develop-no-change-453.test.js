// #453: in ai-development-local-hero a develop turn that rightly changes nothing (the fix is already
// on the branch, e.g. the test writer's commit) goes on to the check and the review instead of
// looping on develop until max_visits fails the run; a branch with no commit since the base still
// goes back to develop. The reviewer is told the developer made no production change.
// Acceptance tests written before the code: the routes are checked on develop's transitions with a
// real git repository in a temp folder as the worktree (the routes read the branch's commits).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadWorkflow, evalExpr, render } = require('../engine/workflow');

const WORKFLOW = path.join(__dirname, '..', '..', '..', 'workflows', 'feature.yaml');
const stepOf = (id) => loadWorkflow(WORKFLOW).steps.find((s) => s.id === id);

// the goto of the first transition of a step whose `when` holds in this scope (the engine's order); a
// route to the secret scan (#49) is followed to where a pass sends it (vars.after_scan)
function firstGoto(step, scope) {
  const tr = step.transitions.find((x) => x.when === undefined || evalExpr(x.when, scope));
  if (!tr || tr.goto !== 'secret_scan') return tr && tr.goto;
  return firstGoto(stepOf('secret_scan'), { ...scope, vars: { ...scope.vars, ...tr.set }, output: { status: 'pass' } });
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });

// a repository on `main` with one commit (also as origin/main), checked out on branch `feat`;
// `testWriterCommit` adds the test writer's commit on `feat`; `checkScript` gives package.json a `check` script
function makeRepo(t, { testWriterCommit, checkScript = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-453-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'commit.gpgsign', 'false');
  const pkg = { name: 'x', version: '1.0.0', scripts: checkScript ? { check: 'node -e 0' } : {} };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'switch', '-q', '-c', 'feat');
  if (testWriterCommit) {
    fs.mkdirSync(path.join(dir, 'test'));
    fs.writeFileSync(path.join(dir, 'test', 'helpers.js'), 'module.exports = {};\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'Fix flaky rmSync in test helpers');
  }
  return dir;
}

// develop's first answer with no production change, after acceptance_tests (no test added; it
// committed only when the branch has its commit)
function noChangeScope(dir, { testWriterCommit }) {
  return {
    worktree_dir: dir,
    inputs: { mode: 'auto', validate_every_round: false, screenshots: 'all', issues: [], unit_tests: 'write_and_run', e2e_tests: 'off', base_branch: 'main', check_command: '' },
    vars: {},
    steps: {
      acceptance_tests: { output: testWriterCommit
        ? { branch: 'feat', tests_added: [], committed: true, commit: 'abc1234', summary: 'fixed the helper' }
        : { branch: 'feat', tests_added: [], committed: false, summary: 'nothing testable' } },
      develop: { visits: 1 },
    },
    output: {
      committed: false, branch: 'feat', summary: 'The fix is already on the branch (the test writer\'s commit): no production change needed.',
      test_notes: 't', left_out: [], issues: [], files_changed: [], screenshots: [],
    },
  };
}

test('#453: develop answering no change on a branch with the test writer\'s commit goes to the review, not back to develop', (t) => {
  const dir = makeRepo(t, { testWriterCommit: true });
  assert.equal(firstGoto(stepOf('develop'), noChangeScope(dir, { testWriterCommit: true })), 'code_review');
});

test('#453: develop answering no change on a branch with the test writer\'s commit goes to rule_check first when the project has a check command', (t) => {
  const dir = makeRepo(t, { testWriterCommit: true, checkScript: true });
  assert.equal(firstGoto(stepOf('develop'), noChangeScope(dir, { testWriterCommit: true })), 'rule_check');
});

test('#453: rule_check passing after a no-change develop goes on to the review', () => {
  const ruleCheck = stepOf('rule_check');
  const scope = {
    inputs: { mode: 'auto', validate_every_round: false, screenshots: 'all', issues: [], base_branch: 'main' },
    vars: {},
    steps: { develop: { output: { committed: false, summary: 'no change', files_changed: [], left_out: [] } } },
    output: { status: 'pass' },
  };
  assert.equal(firstGoto(ruleCheck, scope), 'code_review');
});

test('#453: develop answering no change on a branch with no commit since the base still goes back to develop', (t) => {
  const dir = makeRepo(t, { testWriterCommit: false });
  assert.equal(firstGoto(stepOf('develop'), noChangeScope(dir, { testWriterCommit: false })), 'develop');
});

test('#453: develop answering no change but declaring its own gaps still goes back to develop, even with commits on the branch', (t) => {
  const dir = makeRepo(t, { testWriterCommit: true });
  const scope = noChangeScope(dir, { testWriterCommit: true });
  scope.output.left_out = [{ requirement: 'Route the answer to the review', reason: 'not done yet' }];
  assert.equal(firstGoto(stepOf('develop'), scope), 'develop');
});

test('#453: a simulated run (no worktree) keeps today\'s route: a no-change develop answer goes back to develop', () => {
  const scope = noChangeScope(undefined, { testWriterCommit: true });
  delete scope.worktree_dir;
  assert.equal(firstGoto(stepOf('develop'), scope), 'develop');
});

test('#453: on a review round, a develop answer without a commit (and without no_change) goes back to the reviewer when the branch has commits', (t) => {
  const dir = makeRepo(t, { testWriterCommit: true });
  const scope = noChangeScope(dir, { testWriterCommit: true });
  scope.steps.code_review = { output: { verdict: 'changes_requested', findings: [{ severity: 'major', title: 'add a test' }] } };
  assert.equal(firstGoto(stepOf('develop'), scope), 'code_review');
});

// the code reviewer's prompt for the given develop answer
function reviewerPrompt(develop) {
  return render(stepOf('code_review').prompt, {
    agent: 'reviewer', run_dir: 'C:/runs/r1',
    inputs: { task: 'Fix the flaky EPERM', base_branch: 'main', issues: [], screenshots: 'all', mode: 'auto' },
    vars: {},
    steps: {
      acceptance_tests: { output: { branch: 'feat', tests_added: [], committed: true, commit: 'abc1234' } },
      develop: { output: { branch: 'feat', files_changed: [], left_out: [], ...develop } },
    },
  });
}

test('#453: the reviewer is told the developer made no production change and reads the developer\'s summary', () => {
  // the summary itself does not say "no production change": the prompt must
  const summary = 'The test writer\'s commit abc1234 already fixes the flaky rmSync; nothing left to do in src/.';
  const prompt = reviewerPrompt({ committed: false, summary });
  assert.match(prompt, /no production change/i, 'the prompt says the developer made no production change');
  assert.ok(prompt.includes(summary), 'the prompt quotes the developer\'s summary');
});

test('#453: the reviewer of a committed develop turn is not told there was no production change', () => {
  const prompt = reviewerPrompt({ committed: true, summary: 'Changed the router.', files_changed: ['packages/engine/engine/workflow.js'] });
  assert.doesNotMatch(prompt, /made no production change|no production change was made|without (a|any) production change/i);
});
