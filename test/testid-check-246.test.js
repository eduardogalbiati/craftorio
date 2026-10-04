// Acceptance tests for #246 (written before the code): in workflows/ai-development-local-hero.yaml the
// orchestrator checks, right after `develop`, that every `data-testid` the E2E step definitions use
// exists in the renderer, and returns the missing ones to the developer before the review (no model
// call, no full suite); the develop prompt also lists them upfront. Mock runs on a git repository in a
// temp folder, as in test/ai-development-e2e.test.js.
//
// The interface these tests fix (the issue leaves the names open):
//   - src/engine/test-ids.js: `testIdsUsed(source)` → the unique static ids of `getByTestId('…')` in a
//     source text (template strings skipped); `missingTestIds(root, { steps, renderer })` → one
//     `{ id, files }` per id the step definitions use (files: repository-relative, forward slashes)
//     that the renderer folder does not contain; folders default to features/steps and src/renderer;
//   - step `testid_check`: no agent, visited right after develop when the acceptance step wrote
//     scenarios (e2e_scope: scenarios); back to develop at most twice; a project with no BDD steps is
//     skipped with a note in the step's output.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../src/engine/workflow');
// not from ./engine-helpers: requiring it registers that file's software-development matrix as tests here
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', 'workflows', 'ai-development-local-hero.yaml');
const ISSUE = 'https://github.com/acme/app/issues/246';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
// the module the change creates: loaded inside each test
const load = () => require('../src/engine/test-ids');

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

// ---- the shared rule (src/engine/test-ids.js) -------------------------------------------------------

test('#246 testIdsUsed: the static ids of getByTestId, once each, in single or double quotes; template strings are skipped', () => {
  const { testIdsUsed } = load();
  const source = [
    "page.getByTestId('roadmap-bar');",
    'page.getByTestId("po-split-task");',
    "page.getByTestId( 'roadmap-bar' );",
    'page.getByTestId(`nw-${name}`);',
  ].join('\n');
  assert.deepEqual([...testIdsUsed(source)].sort(), ['po-split-task', 'roadmap-bar']);
  assert.deepEqual([...testIdsUsed('')], []);
});

test('#246 missingTestIds: each id the step definitions use that the renderer lacks, with the step files that use it', (t) => {
  const { missingTestIds } = load();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testid-rule-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'features/steps/a.steps.js', "page.getByTestId('present'); page.getByTestId('absent');\n");
  write(root, 'features/steps/b.steps.js', "page.getByTestId('absent'); page.getByTestId('other-absent'); page.getByTestId(`row-${i}`);\n");
  write(root, 'src/renderer/view.js', "html`<div data-testid=\"present\"></div>`;\n");
  const missing = missingTestIds(root).map((m) => ({ id: m.id, files: [...m.files].sort() })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(missing, [
    { id: 'absent', files: ['features/steps/a.steps.js', 'features/steps/b.steps.js'] },
    { id: 'other-absent', files: ['features/steps/b.steps.js'] },
  ]);
});

test('#246 missingTestIds: the project\'s own step and renderer folders when given, and nothing missing when every id is defined', (t) => {
  const { missingTestIds } = load();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testid-rule-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'e2e/steps/login.steps.ts', "page.getByTestId('login-button');\n");
  write(root, 'web/ui/login.html', '<button data-testid="login-button">Log in</button>\n');
  assert.deepEqual(missingTestIds(root, { steps: 'e2e/steps', renderer: 'web/ui' }), []);
  write(root, 'e2e/steps/logout.steps.ts', "page.getByTestId('logout-button');\n");
  assert.deepEqual(missingTestIds(root, { steps: 'e2e/steps', renderer: 'web/ui' }).map((m) => m.id), ['logout-button']);
});

// ---- the workflow ----------------------------------------------------------------------------------

test('#246 workflow: a testid_check step without an agent runs right after develop; the scenarios stay protected from the developer', () => {
  const wf = loadWorkflow(WORKFLOW);
  const check = wf.steps.find((s) => s.id === 'testid_check');
  assert.ok(check, 'the workflow has a testid_check step');
  assert.equal(check.agent, undefined, 'no agent: the orchestrator checks the ids itself');
  assert.equal(check.agents, undefined, 'no fan-out either');
  assert.ok(check.type && check.type !== 'human_approval', `a machine step (got type ${check.type})`);
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(yaml, /protect_files:[\s\S]*?steps\.acceptance_tests\.output\.e2e_files/, 'the developer still never edits the scenarios or their steps');
});

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
  assert.equal(transitions[transitions.indexOf('acceptance_tests>red_check') + 2], 'develop>testid_check', `the check runs right after develop (got ${transitions.join(', ')})`);
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

test('#246 run: a run without scenarios skips the check', { timeout: 120000 }, async (t) => {
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
