// #57: a project made by "Create new project" is asked its kind, and its first screen gets its screenshots and
// visual review. Acceptance tests written before the code, the cheap ones (the whole mock runs of the issue's
// table are in packages/engine/test/slow/project-kind-new.slow.test.js, the wizard's in
// fronts/build/test/project-wizard-kind-new-57.test.js).
//
// Contract assumed here (the developer implements it):
// - packages/shared/onboarding-model.js: "Create new project" asks a fourth question, `kind`:
//   CREATE_ANSWERS.kind = ['frontend', 'full-stack', 'backend'] (the PROJECT_KINDS values, no "detect", no
//   docs), CREATE_DEFAULTS.kind one of them.
// - onboarding:create's `answers.kind` is saved on the project record (`kind`, what runDefaultsWith reads as
//   the owner's pick), changeable later with projects:update.
// - Plain HTML: a project whose only file is index.html at the root is a frontend (#80's './').
// - Backend unchanged: a service (Go, Node API) still takes no UI step: develop's transitions to
//   developer_screenshots and code_review's ui_reviewer stay false for its change.
// - An explicit `screenshots: off` typed for the run is never overridden by a UI change.
// - docs/readme/043-project-run-defaults.md says what kind a new project has.
// Public seams: the model's exports, the service's channels, runDefaultsWith / resolveRunInputs, the workflow
// YAML evaluated with evalExpr (as packages/engine/test/project/project-ui-folders-80.test.js does).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { projectFacts, runDefaultsWith, resolveRunInputs } = require('../domains/project/project-run-defaults');
const { evalExpr } = require('../engine/run/templates');

const REPO = path.join(__dirname, '..', '..', '..');
const model = () => require('@craftorio/shared/onboarding-model');
const FEATURE = yaml.load(fs.readFileSync(path.join(REPO, 'workflows', 'feature.yaml'), 'utf8'));
const stepOf = (id) => FEATURE.steps.find((s) => s.id === id);
const whensTo = (step, target) => (step.transitions || []).filter((tr) => tr.goto === target).map((tr) => tr.when);

function folderWith(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-new-57-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

const NEW_PROJECT = { 'README.md': '# Field Notes\n', '.gitignore': 'node_modules/\n' };
const GO_SERVICE = {
  'go.mod': 'module example.com/svc\n\ngo 1.22\n',
  'main.go': 'package main\n\nfunc main() {}\n',
  'internal/api/handler.go': 'package api\n',
};
const NODE_API = {
  'package.json': JSON.stringify({ name: 'api', scripts: { test: 'node --test' }, dependencies: { express: '^5.0.0' } }),
  'src/server.js': 'require("express")().listen(3000);\n',
};

// the inputs the app starts feature.yaml with for this project (typed first, then the project's run defaults)
const runInputs = (folder, { kind, typed = {} } = {}) => resolveRunInputs({
  typed: { task: 'Change it', repo_path: folder, ...typed },
  project: runDefaultsWith({ project: { folder, ...(kind ? { kind } : {}) } }),
  workflow: FEATURE,
}).values;

// a run of feature.yaml right after develop committed these files, listing these screens
function developScope(inputs, filesChanged, screenshots = [], extra = {}) {
  const out = { committed: true, screenshots, files_changed: filesChanged, issues: [], left_out: [] };
  return {
    inputs, output: out, vars: {}, previous_step: 'develop',
    steps: { develop: { output: out }, acceptance_tests: { output: { e2e_scope: 'none' } } }, ...extra,
  };
}
// whether develop goes on to developer_screenshots, and whether code_review would start the ui_reviewer
const goesToScreenshots = (scope) => whensTo(stepOf('develop'), 'developer_screenshots').some((w) => Boolean(evalExpr(w, scope)));
const startsUiReviewer = (scope) => Boolean(evalExpr(stepOf('code_review').agent_when.ui_reviewer, { ...scope, previous_step: 'developer_screenshots' }));

// ---- asked: "Create new project" asks the project's kind -------------------------------------------------

test('#57 "Create new project" asks the kind: frontend, full-stack or backend (no "detect from the files")', () => {
  assert.deepEqual(model().CREATE_ANSWERS.kind, ['frontend', 'full-stack', 'backend']);
});

test('#57 "Create new project" has a kind picked by default, one of its answers', () => {
  const { CREATE_ANSWERS, CREATE_DEFAULTS } = model();
  assert.equal((CREATE_ANSWERS.kind || []).includes(CREATE_DEFAULTS.kind), true, `default kind: ${CREATE_DEFAULTS.kind}`);
});

test('#57 onboarding:create saves the kind answered on the new project', async (t) => {
  const { makeService } = require('./service/helpers');
  const { api } = makeService(t);
  const s = await api['onboarding:create']({ name: 'Field Notes', starts: 'readme', remote: null, answers: { mode: 'local', ci: 'release', release: 'milestone', kind: 'frontend' } });
  const saved = (await api['projects:list']()).find((p) => p.id === s.projectId);
  assert.equal(saved?.kind, 'frontend');
});

test('#57 the new project\'s kind reaches its run defaults, and the owner can change it later', async (t) => {
  const { makeService } = require('./service/helpers');
  const { api } = makeService(t);
  const s = await api['onboarding:create']({ name: 'Field Notes', starts: 'readme', remote: null, answers: { mode: 'local', ci: 'release', release: 'milestone', kind: 'frontend' } });
  const before = (await api['projects:inputHints'](s.projectId))?.runDefaults?.kind;
  await api['projects:update']({ id: s.projectId, patch: { kind: 'backend' } });
  const after = (await api['projects:inputHints'](s.projectId))?.runDefaults?.kind;
  assert.deepEqual([before, after], ['frontend', 'backend']);
});

// ---- plain HTML: a page at the root counts ---------------------------------------------------------------

test('#57 a project that is only index.html at the root is a frontend', (t) => {
  assert.equal(projectFacts(folderWith(t, { 'index.html': '<!doctype html><title>Home</title>\n' })).kind, 'frontend');
});

test('#57 a project that is only index.html keeps its screenshots on and its root as a UI folder', (t) => {
  const d = runDefaultsWith({ project: { folder: folderWith(t, { 'index.html': '<!doctype html><title>Home</title>\n' }) } });
  assert.deepEqual({ screenshots: d.screenshots, ui_folders: [...d.ui_folders] }, { screenshots: 'changed', ui_folders: ['./'] });
});

// ---- after develop: what the change has, not only what the project had at start -------------------------

test('#57 a new project (kind not picked) whose change adds src/App.jsx goes on to the screenshots after develop', (t) => {
  const inputs = runInputs(folderWith(t, NEW_PROJECT));
  assert.equal(goesToScreenshots(developScope(inputs, ['src/App.jsx'], [{ name: 'home', caption: 'Home', args: ['--view', 'home'] }])), true);
});

test('#57 an explicit screenshots: off typed for the run is never overridden by a UI change', (t) => {
  const inputs = runInputs(folderWith(t, NEW_PROJECT), { typed: { screenshots: 'off' } });
  const scope = developScope(inputs, ['src/App.jsx', 'index.html'], [{ name: 'home', caption: 'Home', args: ['--view', 'home'] }]);
  assert.deepEqual({ screenshots: goesToScreenshots(scope), ui_reviewer: startsUiReviewer(scope) }, { screenshots: false, ui_reviewer: false });
});

test('#57 an owner-chosen backend is respected: a change to src/App.jsx takes no screenshots after develop', (t) => {
  const inputs = runInputs(folderWith(t, NEW_PROJECT), { kind: 'backend' });
  const scope = developScope(inputs, ['src/App.jsx'], [{ name: 'home', caption: 'Home', args: ['--view', 'home'] }]);
  assert.deepEqual({ screenshots: goesToScreenshots(scope), ui_reviewer: startsUiReviewer(scope) }, { screenshots: false, ui_reviewer: false });
});

// ---- backend unchanged: a service still has no UI step ---------------------------------------------------

for (const [name, files, changed] of [
  ['a Go service', GO_SERVICE, ['main.go', 'internal/api/handler.go']],
  ['a Node API', NODE_API, ['src/server.js']],
]) {
  test(`#57 ${name} is still a backend`, (t) => {
    assert.equal(runDefaultsWith({ project: { folder: folderWith(t, files) } }).kind, 'backend');
  });

  test(`#57 ${name}: its change takes no screenshots and no UI review`, (t) => {
    const scope = developScope(runInputs(folderWith(t, files)), changed, []);
    assert.deepEqual({ screenshots: goesToScreenshots(scope), ui_reviewer: startsUiReviewer(scope) }, { screenshots: false, ui_reviewer: false });
  });
}

// ---- docs ------------------------------------------------------------------------------------------------

test('#57 docs/readme/043-project-run-defaults.md says what kind a new project has', () => {
  const text = fs.readFileSync(path.join(REPO, 'docs', 'readme', '043-project-run-defaults.md'), 'utf8');
  const paragraphs = text.split(/\n\s*\n/);
  const says = paragraphs.filter((p) => /\bnew project\b|Create new project/i.test(p) && /\bkind\b/i.test(p));
  assert.equal(says.length > 0, true, 'no paragraph of 043-project-run-defaults.md speaks of a new project\'s kind');
});
