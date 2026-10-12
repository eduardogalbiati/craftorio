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
// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// its runs are in test/slow/testid-check-246.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../src/engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', 'workflows', 'ai-development-local-hero.yaml');

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

// a workflow with only a test_ids step on the given folders, run on `repo` (worktree_dir = the repository)
async function runCheckOnly(t, repo, folders) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'testid-check-wf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, JSON.stringify({
    name: 'testid-only',
    orchestrator: { worktree: { repo: repo.replace(/\\/g, '/'), base: 'main', remote: false } },
    agents: { dev: { provider: 'claude' } },
    steps: [{ id: 'check', type: 'test_ids', ...folders, transitions: [{ when: 'true', goto: 'end' }] }],
  }));
  const run = new WorkflowRun({ file, inputs: { task: 'check' }, mock: true, runsDir: dir });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  return { finished: events.find((e) => e.type === 'workflow.finished'), output: events.find((e) => e.type === 'step.finished' && e.step_id === 'check')?.output };
}

test('#246 run: a test_ids step uses the project\'s own step and renderer folders, and is skipped with a note when its step folder has no definitions', { timeout: 60000 }, async (t) => {
  const repo = makeRepo(t, { steps: false });
  write(repo, 'e2e/steps/login.steps.ts', "page.getByTestId('login-button'); page.getByTestId('po-split-card');\n");
  write(repo, 'web/ui/login.html', '<button data-testid="login-button">Log in</button>\n');
  const own = await runCheckOnly(t, repo, { steps: 'e2e/steps', renderer: 'web/ui' });
  assert.equal(own.finished.status, 'success', own.finished.error);
  assert.equal(own.output.status, 'missing');
  assert.deepEqual(own.output.missing, [{ id: 'po-split-card', files: ['e2e/steps/login.steps.ts'] }], 'login-button is in web/ui; src/renderer is not read');
  const none = await runCheckOnly(t, repo, { steps: 'tests/bdd/steps', renderer: 'web/ui' });
  assert.equal(none.output.status, 'skipped');
  assert.match(none.output.message, /tests\/bdd\/steps/, 'the note names the folder it looked in');
});
