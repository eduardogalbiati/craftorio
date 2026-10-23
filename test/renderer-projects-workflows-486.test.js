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

// manifest: the answer of api.projectManifest, or a function of its target
function page({ manifest = null, projects = PROJECTS } = {}) {
  return loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => projects,
      listWorkflows: async () => WORKFLOWS,
      projectManifest: async (target) => (typeof manifest === 'function' ? manifest(target) : manifest),
      // the service's projects:update: the record with the patch applied
      updateProject: async (id, patch) => ({ ...projects.find((p) => p.id === id), ...patch }),
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

// ---- the manifest's errors and a private repository ----------------------------------------------

const BAD_MANIFEST = { workflows: [], errors: ['.multiagent/project.yaml: not valid YAML (unexpected end of the stream).'] };
const PENDING = { workflows: [], pending: true, message: 'The repository could not be read without credentials: its workflows manifest will be read after cloning.' };

const errorsBox = (markup) => H.findEl(markup, (e) => e.attrs['data-testid'] === 'project-workflows-manifest-errors');

test('#486 Create Project: a manifest with errors shows them in the Workflows block', async () => {
  const app = page({ manifest: BAD_MANIFEST });
  await newProjectDialog(app);
  const box = errorsBox(region(app, 'project-workflows-block'));
  assert.ok(box, 'the block has data-testid="project-workflows-manifest-errors"');
  assert.match(H.visibleText(box.inner), /not valid YAML/);
});

test('#486 the project\'s page (Overview): a manifest with errors shows them in the Workflows block', async () => {
  const app = page({ manifest: (target) => (target?.folder ? BAD_MANIFEST : null) });
  await app.boot();
  app.run('openProjectView("p1")');
  await app.settle(20);
  const box = errorsBox(region(app, 'project-overview'));
  assert.ok(box, 'the Overview has data-testid="project-workflows-manifest-errors"');
  assert.match(H.visibleText(box.inner), /not valid YAML/);
});

test('#486 Create Project on a private repository: says the manifest will be read after cloning, and lists the workflows unchecked', async () => {
  const app = page({ manifest: (target) => (target?.url ? PENDING : null) });
  await newProjectDialog(app);
  assert.ok(app.callsTo('projectManifest').some(([arg]) => arg?.url), 'the repository URL was read');
  const markup = region(app, 'project-workflows-block');
  assert.match(H.visibleText(markup), /after cloning/i);
  const boxes = checkboxes(markup);
  for (const w of WORKFLOWS) assert.equal(boxes.get(w.name), false, `${w.name} is offered unchecked`);
});

// ---- the Overview saves the set and the default (api.updateProject is the boundary) ---------------

const HERO = { name: 'software-development-local-hero', origin: 'bundled', category: 'build' };
const MINE = { name: 'my-flow', origin: 'custom', category: 'build' };

async function overviewOf(project) {
  const projects = [{ ...PROJECTS[0], ...project }];
  const app = page({ projects });
  await app.boot();
  app.run('openProjectView("p1")');
  await app.settle(20);
  return app;
}

// Checks or clears one box of the Overview's block: the fake DOM has no querySelectorAll, so the
// block's boxes are built from its rendered markup, and the page's delegated change listener runs
async function toggleBox(app, name, on) {
  const box = app.el('#project-workflows');
  const inputs = H.findAll(String(box.innerHTML), (e) => e.name === 'input' && e.attrs.type === 'checkbox' && e.attrs['data-workflow'])
    .map((e) => ({ checked: 'checked' in e.attrs, dataset: { workflow: e.attrs['data-workflow'], origin: e.attrs['data-origin'] || '', category: e.attrs['data-category'] || '' } }));
  const target = inputs.find((i) => i.dataset.workflow === name);
  assert.ok(target, `the block has a ${name} box`);
  target.checked = on;
  target.closest = (sel) => (/input\[data-workflow\]/.test(String(sel)) ? target : null);
  box.querySelectorAll = () => inputs;
  const view = app.el('#view-project');
  const listeners = view.listeners.change || [];
  assert.ok(listeners.length, 'the project page listens to change');
  const ev = { type: 'change', target, currentTarget: view, preventDefault() {}, stopPropagation() {} };
  for (const fn of listeners) await fn(ev);
  await app.settle(20);
}

const lastPatch = (app) => {
  const calls = app.callsTo('updateProject');
  assert.equal(calls.length, 1, 'one api.updateProject call');
  assert.equal(calls[0][0], 'p1');
  return calls[0][1];
};
// Array.from: the page's arrays come from its own realm (deepEqual compares prototypes)
const wfKeys = (list) => Array.from(list || [], (w) => `${w.name}:${w.origin}:${w.category || ''}`);
const headerRecord = (app) => (app.state().projects || []).find((p) => p.id === 'p1');

test('#486 Overview: checking a box saves the set and the kept default through api.updateProject, and updates state.projects', async () => {
  const app = await overviewOf({ workflows: [HERO], defaultWorkflow: HERO.name });
  await toggleBox(app, 'my-flow', true);
  const patch = lastPatch(app);
  assert.deepEqual(Object.keys(patch).sort(), ['defaultWorkflow', 'workflows']);
  assert.deepEqual(wfKeys(patch.workflows), ['software-development-local-hero:bundled:build', 'my-flow:custom:build']);
  assert.equal(patch.defaultWorkflow, HERO.name);
  assert.deepEqual(wfKeys(headerRecord(app)?.workflows), ['software-development-local-hero:bundled:build', 'my-flow:custom:build'], 'state.projects has the new set');
});

test('#486 Overview: clearing the default\'s box saves the set and the first remaining development workflow as the default', async () => {
  const app = await overviewOf({ workflows: [HERO, MINE], defaultWorkflow: MINE.name });
  await toggleBox(app, 'my-flow', false);
  const patch = lastPatch(app);
  assert.deepEqual(wfKeys(patch.workflows), ['software-development-local-hero:bundled:build']);
  assert.equal(patch.defaultWorkflow, HERO.name);
  assert.equal(headerRecord(app)?.defaultWorkflow, HERO.name, 'state.projects has the new default');
});

test('#486 Overview: "Make default" saves only the defaultWorkflow', async () => {
  const app = await overviewOf({ workflows: [HERO, MINE], defaultWorkflow: HERO.name });
  const btn = H.findEl(String(app.el('#project-workflows').innerHTML), (e) => e.name === 'button' && e.attrs['data-pwf-default'] === 'my-flow');
  assert.ok(btn, 'my-flow (checked, not the default) has a Make default button');
  assert.match(H.visibleText(btn.inner), /make default/i);
  await clickRendered(app, btn, ['#project-workflows']);
  const patch = lastPatch(app);
  assert.deepEqual(Object.keys(patch), ['defaultWorkflow']);
  assert.equal(patch.defaultWorkflow, 'my-flow');
  assert.equal(headerRecord(app)?.defaultWorkflow, 'my-flow', 'state.projects has the new default');
});

// ---- the backlog's Assign dialog: the header project's set first, on its default ------------------

const TASK_WORKFLOWS = [
  { file: 'software-development-local-hero.yaml', name: 'Local hero', category: 'build', origin: 'bundled', inputs: { task: {} } },
  { file: 'software-development.yaml', name: 'Software development', category: 'build', origin: 'bundled', inputs: { task: {} } },
  { file: 'my-flow.yaml', name: 'My flow', category: 'build', origin: 'custom', inputs: { task: {} } },
];
const BACKLOG = {
  platform: 'github',
  syncedAt: '2026-10-01T00:00:00Z',
  epics: [],
  issues: [{ number: 1, title: 'Issue 1', state: 'open', column: 'todo', labels: [], assignees: [], author: 'eduardo', body: '', url: 'https://github.com/o/r/issues/1', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z', tasks: { total: 0, done: 0 }, runs: [], pullRequests: [] }],
};

// The Backlog of the header project p1, issue #1 selected, the Assign dialog opened
async function assignDialog(project) {
  const app = loadApp({
    storage: { 'multiagent.backlogProject': 'p1', 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', ...project }],
      listWorkflows: async () => TASK_WORKFLOWS,
      getSettings: async () => ({ lastProject: 'p1', defaultWorkflow: 'software-development.yaml' }),
      getBacklog: async () => BACKLOG,
      syncBacklog: async () => BACKLOG,
    },
  });
  await app.boot();
  app.run("showView('backlog')");
  await app.settle(10);
  assert.equal(app.run('window.CurrentProject.get()'), 'p1', 'p1 is the header project');
  await app.click('#bl-list', { dataset: { sel: '1' }, checked: true });
  await app.click('#btn-bl-assign');
  await app.settle(10);
  const sel = app.el('#assign-workflow');
  return { options: [...String(sel.innerHTML).matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]), value: String(sel.value) };
}

test('#486 Assign dialog: the header project\'s workflows come first and its default is preselected', async () => {
  const { options, value } = await assignDialog({ workflows: [{ name: 'my-flow', origin: 'custom' }], defaultWorkflow: 'my-flow' });
  assert.deepEqual(options, ['my-flow.yaml', 'software-development-local-hero.yaml', 'software-development.yaml']);
  assert.equal(value, 'my-flow.yaml');
});

test('#486 Assign dialog: a header project without a workflow set keeps the listed order and Settings\' default', async () => {
  const { options, value } = await assignDialog({});
  assert.deepEqual(options, ['software-development-local-hero.yaml', 'software-development.yaml', 'my-flow.yaml']);
  assert.equal(value, 'software-development.yaml');
});
