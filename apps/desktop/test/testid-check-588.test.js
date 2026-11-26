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
const { WorkflowRun, loadWorkflow } = require('@craftorio/engine/engine/workflow');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOW = path.join(ROOT, 'workflows', 'feature.yaml');
const load = () => require('@craftorio/engine/engine/test-ids');

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

test('#588 missingTestIds: overlapping step folders read each step file once', (t) => {
  const { missingTestIds, stepFiles } = load();
  const root = tempDir(t, 'testid-588-');
  write(root, 'features/steps/a.steps.js', "page.getByTestId('absent-id');\n");
  write(root, 'src/renderer/index.html', '<main></main>\n');
  const steps = ['features', 'features/steps', 'features/steps/'];
  assert.deepEqual(stepFiles(root, { steps }), ['features/steps/a.steps.js']);
  assert.deepEqual(missingTestIds(root, { steps }), [{ id: 'absent-id', files: ['features/steps/a.steps.js'] }]);
});

test('#588 missingTestIds: a step definition inside a UI folder does not define the ids it uses', (t) => {
  const { missingTestIds } = load();
  const root = tempDir(t, 'testid-588-');
  write(root, 'fronts/build/features/steps/run.steps.js', "page.getByTestId('only-in-steps'); page.getByTestId('run-card');\n");
  write(root, 'fronts/build/views/run.js', 'html`<div data-testid="run-card"></div>`;\n');
  assert.deepEqual(ids(missingTestIds(root, { steps: 'fronts/build/features/steps', renderer: 'fronts' })), [{ id: 'only-in-steps', files: ['fronts/build/features/steps/run.steps.js'] }]);
});

// ---- the ui_files filter of the workflows' conditions ----------------------------------------------

test('#588 ui_files: the changed files under the UI folders, one folder or a list, slashes normalised, pages and components by extension without folders (#80)', () => {
  const { render } = require('@craftorio/engine/engine/run/templates');
  const under = (files, folders) => Number(render('{{ files | ui_files(folders) | length }}', { files, folders }));
  assert.equal(under(['fronts/build/views/run.js'], ['packages/ui-kit/', 'fronts/']), 1);
  assert.equal(under(['fronts\\build\\views\\run.js', 'packages/ui-kit/app.js', 'docs/x.md'], ['packages/ui-kit', 'fronts']), 2);
  assert.equal(under(['packages/ui-kit/style.css'], 'packages/ui-kit/'), 1, 'one folder as a string');
  assert.equal(under('packages/ui-kit/style.css', ['packages/ui-kit']), 1, 'one file as a string');
  assert.equal(under(['src/renderer-old/x.js', 'lib/src/renderer.js'], ['src/renderer/']), 0, 'a sibling folder or a file of the same name is not under it');
  assert.equal(under(['src/renderer/views/a.js'], null), 0, 'no folders: no src/renderer default (#80)');
  assert.equal(under(['fronts/build/views/run.js'], null), 0);
  assert.equal(under(['index.html', 'web/App.tsx', 'lib/a.js'], []), 2, 'no folders: a page or a component by its extension (#80)');
  assert.equal(under(['index.html', 'css/style.css', 'README.md', 'package.json'], ['./']), 2, 'the root folder: the pages and stylesheets, not any file (#80)');
  assert.equal(under(null, ['fronts']), 0, 'no files changed');
  assert.equal(under([], []), 0);
});

// ---- the inputs as a form sends them -------------------------------------------------------------

test('#588 inputs: the folders typed in a form (comma or one per line) reach the run as lists; without them, the defaults', (t) => {
  const runsDir = tempDir(t, 'testid-588-runs-');
  const newRun = (inputs) => new WorkflowRun({ file: WORKFLOW, inputs: { task: 't', repo_path: ROOT, ...inputs }, mock: true, runsDir });
  const typed = newRun({ ui_folders: 'packages/ui-kit/, fronts/\napps/web/renderer/', steps_folders: 'features/steps\nfronts/build/features/steps\n' }).inputs;
  assert.deepEqual(typed.ui_folders, ['packages/ui-kit/', 'fronts/', 'apps/web/renderer/']);
  assert.deepEqual(typed.steps_folders, ['features/steps', 'fronts/build/features/steps']);
  const none = newRun({}).inputs;
  assert.deepEqual(none.ui_folders, []);
  assert.deepEqual(none.steps_folders, []);
});

test('#588 inputs: the Start form shows a list default as text that comes back as the same list', (t) => {
  const WorkflowInputs = require('../../../packages/ui-kit/workflow-inputs');
  const defs = { ui_folders: { label: 'UI folders', type: 'array', default: ['packages/ui-kit/', 'fronts/'] } };
  const html = WorkflowInputs.formHtml(defs, { values: {} });
  const value = (html.match(/data-wi-input="ui_folders"[^>]*?(?:value="([^"]*)"|>([^<]*)<\/textarea>)/) || []).slice(1).find((v) => v !== undefined);
  assert.ok(value !== undefined, 'the field is drawn with its default');
  const read = WorkflowInputs.read({ querySelectorAll: (sel) => (sel === '[data-wi-input]' ? [{ dataset: { wiInput: 'ui_folders' }, type: 'text', value }] : []) });
  const runsDir = tempDir(t, 'testid-588-runs-');
  const run = new WorkflowRun({ file: WORKFLOW, inputs: { task: 't', repo_path: ROOT, ...read }, mock: true, runsDir });
  assert.deepEqual(run.inputs.ui_folders, ['packages/ui-kit/', 'fronts/']);
});

// a plain test_ids step whose fields name several folders with commas
test('#588 run: a test_ids step reads comma-separated step and UI folders', { timeout: 60000 }, async (t) => {
  const repo = commitRepo(t, frontsLayout);
  const step = { id: 'testid_check', type: 'test_ids', steps: 'features/steps, fronts/build/features/steps', renderer: 'packages/ui-kit, fronts ,apps/web/renderer' };
  const { finished, output } = await runStep(t, repo, step, {}, {});
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(output.steps, ['features/steps', 'fronts/build/features/steps']);
  assert.deepEqual(output.renderer, ['packages/ui-kit', 'fronts', 'apps/web/renderer']);
  assert.deepEqual(ids(output.missing), [{ id: 'really-absent', files: ['fronts/build/features/steps/run.steps.js'] }]);
  assert.match(output.message, /packages\/ui-kit, fronts, apps\/web\/renderer/, 'the message names every UI folder');
});

// the bundled workflow's testid_check step alone (its own fields, its inputs), run on `repo`
async function runHeroCheck(t, repo, inputs) {
  const hero = loadWorkflow(WORKFLOW);
  const check = hero.steps.find((s) => s.id === 'testid_check');
  const declared = Object.fromEntries(['ui_folders', 'steps_folders'].filter((k) => hero.inputs[k]).map((k) => [k, hero.inputs[k]]));
  return runStep(t, repo, check, declared, inputs);
}
async function runStep(t, repo, check, declared, inputs) {
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

test('#588 #80 run: with no input set, the workflow\'s testid_check reads features/steps and the whole repository, named as such', { timeout: 60000 }, async (t) => {
  const repo = commitRepo(t, (dir) => {
    write(dir, 'features/steps/board.steps.js', "page.getByTestId('present-id'); page.getByTestId('absent-id');\n");
    write(dir, 'web/index.html', '<main data-testid="present-id"></main>\n');
  });
  const { finished, output } = await runHeroCheck(t, repo, {});
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(output.status, 'missing');
  assert.deepEqual(ids(output.missing), [{ id: 'absent-id', files: ['features/steps/board.steps.js'] }]);
  assert.match(output.message, /are not in the repository:/, 'the root folder reads as "the repository"');
  assert.doesNotMatch(output.message, /src\/renderer/);
});
