// #486: the "Workflows" block of Create Project (and of the project's page, Projects › Overview).
// Acceptance tests, written before the code, on the real page (test/renderer-app-harness.js), read
// through test/project-page-helpers.js.
//
// The contract assumed here:
// - the block carries data-testid="project-workflows-block" (in the New project dialog, and inside the
//   project page's data-testid="project-overview");
// - each workflow is a checkbox (<input type="checkbox">) carrying the workflow's name in
//   data-workflow="<name>" (or value="<name>"; a `.yaml` suffix is tolerated), checked through the
//   `checked` attribute of its markup;
// - the dialog reads the manifest with api.projectManifest({ url } | { folder }) (channel
//   projects:manifest) when the repository URL or the folder is typed: { workflows: [...] } or null;
// - without a manifest it lists the bundled and workspace workflows (api.listWorkflows) by category,
//   none checked, a one-line hint (class "hint") per category, and a "Create one for this project"
//   button that opens the Builder (Workflows › Builder: state.view 'workflows').
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');
const { loadApp } = require('./renderer-app-harness');
const { clickRendered, region } = require('./project-page-helpers');

const WORKFLOWS = [
  { file: 'software-development-local-hero.yaml', name: 'software-development-local-hero', category: 'build', origin: 'bundled', inputs: { task: {} } },
  { file: 'backlog-refresh.yaml', name: 'backlog-refresh', category: 'plan', origin: 'bundled', inputs: {} },
  { file: 'my-flow.yaml', name: 'my-flow', category: 'build', origin: 'custom', inputs: { task: {} } },
];
const MANIFEST = {
  workflows: [
    { name: 'backlog-refresh', category: 'intake', description: 'Refresh the issues' },
    { name: 'software-development', category: 'team', description: 'Pull requests' },
  ],
};
const PROJECTS = [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/one', folder: 'C:/work/one', exists: true, isGit: true }];

function page({ manifest = null, projects = PROJECTS } = {}) {
  return loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => projects,
      listWorkflows: async () => WORKFLOWS,
      projectManifest: async () => manifest,
      getSettings: async () => ({ lastProject: 'p1' }),
      listProjectRuns: async (id) => ({ runs: [], project: projects.find((p) => p.id === id), local: null }),
      getBacklog: async () => ({ platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [], epics: [] }),
      getRepositoryPerformance: () => new Promise(() => {}),
      envDetails: async () => [],
      speechStatus: async () => ({ path: null, command: 'whisper', installHint: '', models: [], model: 'base', languages: ['en'], language: 'en' }),
    },
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Types a value into a field: its value, then its input / change / blur handlers.
async function typeInto(app, sel, value) {
  const el = app.el(sel);
  el.value = value;
  for (const type of ['input', 'change', 'blur']) {
    const ev = { type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} };
    await el[`on${type}`]?.(ev);
    for (const fn of el.listeners[type] || []) await fn(ev);
  }
}

// The New project dialog, a repository URL and a folder typed, the manifest read
async function newProjectDialog(app) {
  await app.boot();
  app.run('openProjectModal(null)');
  await app.settle(10);
  await typeInto(app, '#pj-repo', 'https://github.com/o/new.git');
  await typeInto(app, '#pj-folder', 'C:/work/new');
  await wait(700); // past the dialog's debounce of the folder field
  await app.settle(20);
}

const key = (e) => String(e.attrs['data-workflow'] ?? e.attrs.value ?? '').replace(/\.ya?ml$/i, '');
const checkboxes = (markup) => {
  const seen = new Map();
  for (const e of H.findAll(markup, (x) => x.name === 'input' && x.attrs.type === 'checkbox' && key(x))) if (!seen.has(key(e))) seen.set(key(e), 'checked' in e.attrs);
  return seen;
};
const checkedKeys = (boxes) => [...boxes].filter(([, on]) => on).map(([k]) => k).sort();

test('#486 Create Project: the manifest\'s workflows are listed in the Workflows block, already checked', async () => {
  const app = page({ manifest: MANIFEST });
  await newProjectDialog(app);
  assert.ok(app.callsTo('projectManifest').length >= 1, 'the dialog asked for the manifest (api.projectManifest)');
  const arg = app.callsTo('projectManifest').at(-1)[0];
  assert.equal(typeof arg, 'object', 'one object argument: { url } or { folder }');
  const boxes = checkboxes(region(app, 'project-workflows-block'));
  for (const w of MANIFEST.workflows) assert.equal(boxes.get(w.name), true, `${w.name} is listed and checked`);
});

test('#486 Create Project without a manifest: the bundled and workspace workflows, by category, none checked, a hint per category', async () => {
  const app = page({ manifest: null });
  await newProjectDialog(app);
  const markup = region(app, 'project-workflows-block');
  const boxes = checkboxes(markup);
  for (const w of WORKFLOWS) assert.ok(boxes.has(w.name), `${w.name} is offered`);
  assert.deepEqual(checkedKeys(boxes), [], 'none checked');
  const categories = new Set(WORKFLOWS.map((w) => w.category));
  const hints = H.findAll(markup, (e) => /\bhint\b/.test(String(e.attrs.class || '')) && H.visibleText(e.inner));
  assert.ok(hints.length >= categories.size, `a one-line hint per category (${hints.length} for ${categories.size})`);
});

test('#486 Create Project without a manifest: "Create one for this project" opens the Builder', async () => {
  const app = page({ manifest: null });
  await newProjectDialog(app);
  const btn = H.findEl(region(app, 'project-workflows-block'), (e) => e.name === 'button' && /create one for this project/i.test(H.visibleText(e.inner)));
  assert.ok(btn, 'the block has a "Create one for this project" button');
  await clickRendered(app, btn, ['#project-modal', '#project-form']);
  assert.equal(app.state().view, 'workflows', 'the Builder (Workflows › Builder) is open');
});

test('#486 the project\'s page (Overview) shows its workflow set, checked, for editing', async () => {
  const projects = [{ ...PROJECTS[0], workflows: [{ name: 'software-development-local-hero', origin: 'bundled' }], defaultWorkflow: 'software-development-local-hero' }];
  const app = page({ projects });
  await app.boot();
  app.run('openProjectView("p1")');
  await app.settle(20);
  const overview = region(app, 'project-overview');
  assert.ok(H.findEl(overview, (e) => e.attrs['data-testid'] === 'project-workflows-block'), 'the Overview has the Workflows block');
  const boxes = checkboxes(overview);
  assert.equal(boxes.get('software-development-local-hero'), true, 'the project\'s workflow is checked');
  assert.equal(boxes.get('my-flow'), false, 'a workflow outside the set is offered unchecked');
});
