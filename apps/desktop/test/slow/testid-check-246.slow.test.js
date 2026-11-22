// Acceptance tests for #246 (written before the code): in workflows/feature.yaml the
// orchestrator checks, right after `develop`, that every `data-testid` the E2E step definitions use
// exists in the renderer, and returns the missing ones to the developer before the review (no model
// call, no full suite); the develop prompt also lists them upfront. Mock runs on a git repository in a
// temp folder, as in test/ai-development-e2e.test.js.
//
// The interface these tests fix (the issue leaves the names open):
//   - packages/engine/engine/test-ids.js: `testIdsUsed(source)` → the unique static ids of `getByTestId('…')` in a
//     source text (template strings skipped); `missingTestIds(root, { steps, renderer })` → one
//     `{ id, files }` per id the step definitions use (files: repository-relative, forward slashes)
//     that the renderer folder does not contain; folders default to features/steps and src/renderer;
//   - step `testid_check`: no agent, visited right after develop when the acceptance step wrote
//     scenarios (e2e_scope: scenarios); back to develop at most twice; a project with no BDD steps is
//     skipped with a note in the step's output.
// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// the rest of this file's tests are in test/testid-check-246.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('@craftorio/engine/engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'feature.yaml');
const ISSUE = 'https://github.com/acme/app/issues/246';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

// step definitions as the test writer commits them: one id the renderer has, one it lacks, a dynamic one
const STEPS = [
  "const { Then } = require('./fixtures');",
  "Then('the split card is shown', async ({ page }) => {",
  "  await expect(page.getByTestId('po-split-card')).toBeVisible();",
  "  await expect(page.getByTestId('present-id')).toBeVisible();",
  '  await expect(page.getByTestId(`row-${n}`)).toBeVisible();',
  '});',
  '',
].join('\n');

// a repository on main with a renderer and (unless `steps: false`) BDD scenarios and their steps
function makeRepo(t, { steps = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'testid-check-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  write(dir, 'src/app.js', 'module.exports = 1;\n');
  write(dir, 'src/renderer/index.html', '<main data-testid="present-id"></main>\n');
  if (steps) {
    write(dir, 'features/board.feature', 'Feature: Board\n  @issue-246\n  Scenario: Split a card\n    Then the split card is shown\n');
    write(dir, 'features/steps/board.steps.js', STEPS);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

// the developer's fix: the missing id added to a screen, committed
function addMissingId(repo) {
  write(repo, 'src/renderer/board.js', "export const card = '<div data-testid=\"po-split-card\"></div>';\n");
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'develop: add the split card test id');
}

const ownText = (prompt) => String(prompt || '').replace(/<skill name="[^"]*"[\s\S]*?<\/skill>/g, '');

async function runWithScenarios(t, { repoOptions, mockSequences = {}, onTurn } = {}) {
  const repo = makeRepo(t, repoOptions);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testid-check-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: 'Split a card on the board', issue: ISSUE, repo_path: repo, e2e_tests: 'write_and_run', unit_tests: 'run_existing' },
    mock: true,
    runsDir,
    mockSequences: { verdict: ['approved'], e2e_scope: ['scenarios'], suite: { red_check: ['fail'], suite: ['pass'], e2e: ['pass'] }, ...mockSequences },
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
  const prompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => ownText(e.prompt));
  return { events, transitions, prompts, finished: events.find((e) => e.type === 'workflow.finished') };
}

// ---- mock runs ---------------------------------------------------------------------------------------

test('#246 run: the develop prompt lists upfront the test ids the scenarios use that the renderer lacks, and where they are used', { timeout: 120000 }, async (t) => {
  const { prompts, finished } = await runWithScenarios(t, { onTurn: (repo, n) => n === 1 && addMissingId(repo) });
  assert.equal(finished.status, 'success', finished.error);
  assert.match(prompts[0], /po-split-card/, 'the missing id is named before the developer starts');
  assert.match(prompts[0], /features\/(steps\/)?board/, 'with the scenario or step file that uses it');
  assert.doesNotMatch(prompts[0], /present-id/, 'an id the renderer already has is not listed');
  assert.doesNotMatch(prompts[0], /row-\$\{/, 'a dynamic id is not listed');
});

test('#246 run: a missing test id goes back to develop with the id, and after the fix the run reaches the review without a full suite in between', { timeout: 120000 }, async (t) => {
  const { events, transitions, prompts, finished } = await runWithScenarios(t, { onTurn: (repo, n) => n === 2 && addMissingId(repo) });
  assert.equal(finished.status, 'success', finished.error);
  // red_check > warm_up (#301) > develop > testid_check
  assert.equal(transitions[transitions.indexOf('acceptance_tests>red_check') + 3], 'develop>testid_check', `the check runs right after develop (got ${transitions.join(', ')})`);
  const back = transitions.indexOf('testid_check>develop');
  assert.ok(back >= 0, `the check returns to develop (got ${transitions.join(', ')})`);
  assert.equal(transitions.filter((x) => x === 'testid_check>develop').length, 1, 'once: the fix is found by the second check');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /po-split-card/, 'the developer is given the missing id');
  assert.match(prompts[1], /features\/(steps\/)?board/, 'and where it is used');
  const review = transitions.findIndex((x, i) => i > back && x.endsWith('>code_review'));
  assert.ok(review > back, 'then the review');
  assert.ok(!transitions.slice(0, review).some((x) => /(^|>)suite(>|$)/.test(x)), 'no full suite before the review');
  assert.equal(transitions.filter((x) => x.startsWith('suite>')).length, 1, 'one suite round in the whole run');
  assert.equal(events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'testid_check').length, 0, 'the check makes no model call');
});

test('#246 run: an id still missing after two returns to develop does not loop: the run goes on and the suite reports it', { timeout: 120000 }, async (t) => {
  const { transitions, finished } = await runWithScenarios(t);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'testid_check>develop').length, 2, `at most twice (got ${transitions.join(', ')})`);
  assert.ok(transitions.includes('code_review>suite'), 'the run goes on to the review and the suite');
});

test('#246 run: on a review-fix round after the two returns are used up, the check goes on to the review instead of develop', { timeout: 120000 }, async (t) => {
  const { transitions, finished } = await runWithScenarios(t, { mockSequences: { verdict: ['changes_requested', 'approved'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(transitions.filter((x) => x === 'testid_check>develop').length, 2, `still at most twice in the run (got ${transitions.join(', ')})`);
  const fix = transitions.indexOf('code_review>develop');
  assert.ok(fix >= 0, `the reviewer asks for changes (got ${transitions.join(', ')})`);
  assert.equal(transitions[fix + 1], 'develop>testid_check', 'the fix is checked');
  const after = transitions.slice(fix + 2);
  assert.notEqual(after[0], 'testid_check>develop', 'no third return');
  const review = after.findIndex((x) => x.endsWith('>code_review'));
  assert.ok(review >= 0 && !after.slice(0, review).some((x) => x.endsWith('>develop')), `develop's own routes lead back to the review (got ${after.join(', ')})`);
});

test('#246 run: a run without scenarios skips the check',{ timeout: 120000 }, async (t) => {
  const { transitions, finished } = await runWithScenarios(t, { mockSequences: { e2e_scope: ['none'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(!transitions.some((x) => x.includes('testid_check')), `no testid_check (got ${transitions.join(', ')})`);
});

test('#246 run: a project with no BDD step definitions skips the check with a note, and does not return to develop', { timeout: 120000 }, async (t) => {
  const { events, transitions, finished } = await runWithScenarios(t, { repoOptions: { steps: false } });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(!transitions.includes('testid_check>develop'), `no return to develop (got ${transitions.join(', ')})`);
  const done = events.find((e) => e.type === 'step.finished' && e.step_id === 'testid_check');
  assert.ok(done, 'the check step is visited when scenarios exist');
  assert.match(JSON.stringify(done.output || {}), /skip/i, 'its output notes that it was skipped');
});
