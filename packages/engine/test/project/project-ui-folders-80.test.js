// #80: a project's UI folders come from its own files. Acceptance tests written before the code:
// - root pages count: a site whose pages sit at the repository root (index.html, cardapio.html) gets a
//   UI folder that covers them, so a change to index.html is a UI change (the `ui_files` filter of
//   packages/engine/engine/run/templates.js, which the workflows' `when:` conditions use);
// - no foreign defaults: no run gets Craftorio's own src/renderer/ or features/steps unless the project
//   has them (the project's run defaults, the bundled workflows' input defaults, the filter without a
//   folder list); an empty project gets empty lists and its first run that adds pages is a UI change;
// - said in the run: result.md (packages/engine/domains/evidence/result-summary.js) says the
//   screenshots and the UI review were skipped because the run has no UI folders;
// - this repository keeps its folders.
// Public seams only: runDefaultsWith, resolveRunInputs, the workflow YAML evaluated with evalExpr,
// renderResultSummary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { runDefaultsWith, resolveRunInputs } = require('../../domains/project/project-run-defaults');
const { evalExpr } = require('../../engine/run/templates');
const { renderResultSummary } = require('../../domains/evidence/result-summary');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const WORKFLOWS = path.join(REPO, 'workflows');
const workflow = (name) => yaml.load(fs.readFileSync(path.join(WORKFLOWS, name), 'utf8'));
const stepOf = (wf, id) => wf.steps.find((s) => s.id === id);
const whensTo = (step, target) => (step.transitions || []).filter((tr) => tr.goto === target).map((tr) => tr.when);

function project(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-folders-80-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}
const defaultsOf = (folder) => runDefaultsWith({ project: { folder } });
// whether some file of the list is under the given UI folders, through the filter (and the condition
// evaluation) the workflows' `when:` conditions use
const isUiChange = (files, folders) => Boolean(evalExpr('files | ui_files(folders) | length', { files, folders }));

// a run of feature.yaml right after develop committed these files
function developScope(inputs, filesChanged, extra = {}) {
  const out = { committed: true, screenshots: [], files_changed: filesChanged, issues: [] };
  return {
    inputs, output: out, vars: {}, previous_step: 'develop',
    steps: { develop: { output: out }, acceptance_tests: { output: { e2e_scope: 'none' } } }, ...extra,
  };
}
const RUN = { task: 'Change the menu page', validation: 'auto', validate_every_round: false, screenshots: 'changed', e2e_tests: 'off', e2e_command: '', issues: [] };

const ROOT_SITE = {
  'index.html': '<!doctype html><title>Home</title>',
  'cardapio.html': '<!doctype html><title>Menu</title>',
  'style.css': 'body { margin: 0 }',
};

// ---- root pages ---------------------------------------------------------------------------------

test('#80 a site with its pages at the root gets a UI folder', (t) => {
  assert.notDeepEqual(defaultsOf(project(t, ROOT_SITE)).ui_folders, []);
});

test('#80 a site with its pages at the root: a change to index.html is a UI change', (t) => {
  const { ui_folders: folders } = defaultsOf(project(t, ROOT_SITE));
  assert.equal(isUiChange(['index.html'], folders), true);
  assert.equal(isUiChange(['cardapio.html'], folders), true);
});

test('#80 a site with its pages at the root keeps the screenshots on (Changed screens)', (t) => {
  assert.equal(defaultsOf(project(t, ROOT_SITE)).screenshots, 'changed');
});

test('#80 a site with its pages at the root: develop goes to the screenshots when it changes a page', (t) => {
  const d = defaultsOf(project(t, ROOT_SITE));
  const inputs = { ...RUN, ui_folders: d.ui_folders, steps_folders: d.steps_folders };
  const whens = whensTo(stepOf(workflow('feature.yaml'), 'develop'), 'developer_screenshots');
  assert.ok(whens.length > 0, 'develop has no transition to developer_screenshots');
  assert.equal(whens.some((w) => evalExpr(w, developScope(inputs, ['index.html', 'cardapio.html']))), true);
});

test('#80 a site with its pages at the root: the code review starts the UI reviewer for a page change', (t) => {
  const d = defaultsOf(project(t, ROOT_SITE));
  const inputs = { ...RUN, ui_folders: d.ui_folders, steps_folders: d.steps_folders };
  const when = stepOf(workflow('feature.yaml'), 'code_review').agent_when.ui_reviewer;
  assert.equal(evalExpr(when, developScope(inputs, ['index.html'], { previous_step: 'developer_screenshots' })), true);
});

test('#80 a site with its pages at the root gets no step definition folder (it has none)', (t) => {
  assert.deepEqual(defaultsOf(project(t, ROOT_SITE)).steps_folders, []);
});

// ---- pages in folders ---------------------------------------------------------------------------

test('#80 pages in folders: the UI folders are those folders', (t) => {
  const dir = project(t, { 'web/index.html': '<html></html>', 'src/App.jsx': 'export default () => null;', 'lib/util.js': '' });
  assert.deepEqual(defaultsOf(dir).ui_folders, ['src/', 'web/']);
});

test('#80 pages in folders: a change to a page is a UI change, a change elsewhere is not', (t) => {
  const dir = project(t, { 'web/index.html': '<html></html>', 'lib/util.js': '' });
  const { ui_folders: folders } = defaultsOf(dir);
  assert.equal(isUiChange(['web/index.html'], folders), true);
  assert.equal(isUiChange(['lib/util.js'], folders), false);
});

test('#80 a project with its own features/steps keeps it as its step definition folder', (t) => {
  const dir = project(t, { 'web/index.html': '<html></html>', 'features/steps/app.steps.js': '' });
  assert.deepEqual(defaultsOf(dir).steps_folders, ['features/steps']);
});

// ---- an empty project ---------------------------------------------------------------------------

test('#80 an empty project gets empty UI and step definition folders', (t) => {
  const d = defaultsOf(project(t));
  assert.deepEqual({ ui_folders: d.ui_folders, steps_folders: d.steps_folders }, { ui_folders: [], steps_folders: [] });
});

for (const name of ['feature.yaml', 'fix.yaml']) {
  test(`#80 ${name}: an empty project's run gets no src/renderer/ nor features/steps`, (t) => {
    const { values } = resolveRunInputs({ project: defaultsOf(project(t)), workflow: workflow(name) });
    assert.deepEqual([].concat(values.ui_folders ?? []), []);
    assert.deepEqual([].concat(values.steps_folders ?? []), []);
  });

  test(`#80 ${name}: the UI and step definition folders have no Craftorio-specific default`, () => {
    const inputs = workflow(name).inputs || {};
    const defaults = [].concat(inputs.ui_folders?.default ?? [], inputs.steps_folders?.default ?? []).map(String);
    assert.deepEqual(defaults.filter((f) => /src\/renderer|features\/steps/.test(f)), []);
  });
}

test('#80 feature.yaml: no prompt falls back to src/renderer/ when the run has no UI folders', () => {
  const text = fs.readFileSync(path.join(WORKFLOWS, 'feature.yaml'), 'utf8');
  assert.equal(/or \[\s*['"]src\/renderer\/?['"]\s*\]/.test(text), false, "feature.yaml still has `or ['src/renderer/']`");
});

test('#80 without a UI folder list, a change under src/renderer/ is not a UI change (no Craftorio default)', () => {
  assert.equal(Boolean(evalExpr('files | ui_files(inputs.ui_folders) | length', { files: ['src/renderer/app.js'], inputs: {} })), false);
});

test('#80 an empty project: the first run that adds pages is a UI change (screenshots)', (t) => {
  const d = defaultsOf(project(t));
  const inputs = { ...RUN, ui_folders: d.ui_folders, steps_folders: d.steps_folders };
  const whens = whensTo(stepOf(workflow('feature.yaml'), 'develop'), 'developer_screenshots');
  assert.equal(whens.some((w) => evalExpr(w, developScope(inputs, ['index.html', 'style.css']))), true);
});

test('#80 an empty project: the first run that adds pages gets the UI review', (t) => {
  const d = defaultsOf(project(t));
  const inputs = { ...RUN, ui_folders: d.ui_folders, steps_folders: d.steps_folders };
  const when = stepOf(workflow('feature.yaml'), 'code_review').agent_when.ui_reviewer;
  assert.equal(evalExpr(when, developScope(inputs, ['index.html'], { previous_step: 'developer_screenshots' })), true);
});

// ---- said in the run ----------------------------------------------------------------------------

function resultOf(t, uiFolders) {
  const dir = project(t);
  const develop = { output: { committed: true, files_changed: ['src/lib.js'], issues: [] } };
  return renderResultSummary(dir, {
    workflow: 'feature', status: 'success', run_id: 'r-80', duration_ms: 1000,
    inputs: { ...RUN, ui_folders: uiFolders, steps_folders: [] },
    steps: { develop },
  });
}

test('#80 result.md of a run without UI folders says the screenshots and the UI review were skipped for that reason', (t) => {
  const line = resultOf(t, []).split('\n').find((l) => /no UI folders?/i.test(l)) || '';
  assert.match(line, /screenshots/i, 'no line of result.md says the run has no UI folders and skipped the screenshots');
  assert.match(line, /UI review/i);
  assert.match(line, /skipped/i);
});

test('#80 result.md of a run with UI folders does not say they are missing', (t) => {
  assert.doesNotMatch(resultOf(t, ['web/']), /no UI folders?/i);
});

// ---- this repository keeps its folders ----------------------------------------------------------

test('#80 this repository keeps its UI folders and its step definitions', () => {
  const d = defaultsOf(REPO);
  assert.deepEqual(['apps/desktop/', 'fronts/', 'packages/ui-kit/'].filter((f) => !d.ui_folders.includes(f)), []);
  assert.deepEqual(d.steps_folders, ['features/steps']);
});

test('#80 this repository: an engine change is not a UI change', () => {
  assert.equal(isUiChange(['packages/engine/engine/workflow.js'], defaultsOf(REPO).ui_folders), false);
});
