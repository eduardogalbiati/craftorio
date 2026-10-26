// Acceptance tests for #588 (written before the code): the test-id check no longer assumes the
// old layout (`src/renderer`, one `features/steps`). The rule takes several step definition folders
// (the root `features/steps` and each `fronts/<id>/features/steps` here), and the bundled workflow's
// `testid_check` step reads the project's folders from the workflow inputs `ui_folders` and
// `steps_folders` (defaults `src/renderer/` and `features/steps`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('@multiagent/engine/engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOW = path.join(ROOT, 'workflows', 'ai-development-local-hero.yaml');
const load = () => require('@multiagent/engine/engine/test-ids');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const tempDir = (t, prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
};
const ids = (missing) => missing.map((m) => ({ id: m.id, files: [...m.files].sort() })).sort((a, b) => a.id.localeCompare(b.id));

// a project laid out like this repository: a UI kit, a front with its own views and step definitions
function frontsLayout(dir) {
  write(dir, 'features/steps/app.steps.js', "page.getByTestId('kit-header'); page.getByTestId('shell-root');\n");
  write(dir, 'fronts/build/features/steps/run.steps.js', "page.getByTestId('run-card'); page.getByTestId('really-absent');\n");
  write(dir, 'packages/ui-kit/app.js', 'html`<header data-testid="kit-header"></header>`;\n');
  write(dir, 'fronts/build/views/run/run.js', 'html`<div data-testid="run-card"></div>`;\n');
  write(dir, 'apps/web/renderer/index.html', '<main data-testid="shell-root"></main>\n');
}
const FRONTS_UI = ['packages/ui-kit', 'fronts', 'apps/web/renderer'];

test('#588 missingTestIds: several step folders are read, and an id is missing only when no UI folder defines it', (t) => {
  const { missingTestIds } = load();
  const root = tempDir(t, 'testid-588-');
  frontsLayout(root);
  const missing = missingTestIds(root, { steps: ['features/steps', 'fronts/build/features/steps'], renderer: FRONTS_UI });
  assert.deepEqual(ids(missing), [{ id: 'really-absent', files: ['fronts/build/features/steps/run.steps.js'] }]);
});

test('#588 missingTestIds: on this repository, the root and every front\'s step definitions find their ids in the UI folders', () => {
  const { missingTestIds, stepFiles } = load();
  const fronts = fs.readdirSync(path.join(ROOT, 'fronts')).filter((id) => fs.existsSync(path.join(ROOT, 'fronts', id, 'features', 'steps')));
  assert.ok(fronts.length > 0, 'this repository has fronts with step definitions');
  const steps = ['features/steps', ...fronts.map((id) => `fronts/${id}/features/steps`)];
  const renderer = ['packages/ui-kit', ...fronts.map((id) => `fronts/${id}`), 'apps/desktop/renderer', 'apps/web/renderer'];
  const read = stepFiles(ROOT, { steps }).map((f) => path.relative(ROOT, path.resolve(ROOT, String(f))).replace(/\\/g, '/'));
  for (const folder of steps) assert.ok(read.some((f) => f.startsWith(`${folder}/`)), `the step definitions of ${folder} are read`);
  assert.deepEqual(missingTestIds(ROOT, { steps, renderer }).map((m) => m.id), []);
});

// the bundled workflow's testid_check step alone (its own fields, its inputs), run on `repo`
async function runHeroCheck(t, repo, inputs) {
  const hero = loadWorkflow(WORKFLOW);
  const check = hero.steps.find((s) => s.id === 'testid_check');
  const declared = Object.fromEntries(['ui_folders', 'steps_folders'].filter((k) => hero.inputs[k]).map((k) => [k, hero.inputs[k]]));
  const dir = tempDir(t, 'testid-588-wf-');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, JSON.stringify({
    name: 'testid-588',
    orchestrator: { worktree: { repo: repo.replace(/\\/g, '/'), base: 'main', remote: false } },
    agents: { dev: { provider: 'claude' } },
    inputs: { task: { type: 'string', required: true }, ...declared },
    steps: [{ ...check, transitions: [{ when: 'true', goto: 'end' }] }],
  }));
  const run = new WorkflowRun({ file, inputs: { task: 'check', ...inputs }, mock: true, runsDir: dir });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  return { finished: events.find((e) => e.type === 'workflow.finished'), output: events.find((e) => e.type === 'step.finished' && e.step_id === 'testid_check')?.output };
}
function commitRepo(t, fill) {
  const repo = tempDir(t, 'testid-588-repo-');
  git(repo, 'init', '-q');
  fill(repo);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  return repo;
}

test('#588 run: the workflow\'s testid_check reads the step and UI folders the run\'s inputs name', { timeout: 60000 }, async (t) => {
  const repo = commitRepo(t, frontsLayout);
  const { finished, output } = await runHeroCheck(t, repo, {
    ui_folders: ['packages/ui-kit/', 'fronts/', 'apps/web/renderer/'],
    steps_folders: ['features/steps', 'fronts/build/features/steps'],
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(output.status, 'missing');
  assert.deepEqual(ids(output.missing), [{ id: 'really-absent', files: ['fronts/build/features/steps/run.steps.js'] }], 'kit-header, run-card and shell-root are defined; only really-absent is missing');
});

test('#588 run: with no input set, the workflow\'s testid_check keeps features/steps and src/renderer', { timeout: 60000 }, async (t) => {
  const repo = commitRepo(t, (dir) => {
    write(dir, 'features/steps/board.steps.js', "page.getByTestId('present-id'); page.getByTestId('absent-id');\n");
    write(dir, 'src/renderer/index.html', '<main data-testid="present-id"></main>\n');
  });
  const { finished, output } = await runHeroCheck(t, repo, {});
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(output.status, 'missing');
  assert.deepEqual(ids(output.missing), [{ id: 'absent-id', files: ['features/steps/board.steps.js'] }]);
});
