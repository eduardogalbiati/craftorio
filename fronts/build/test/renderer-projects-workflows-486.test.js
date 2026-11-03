// #486: the "Workflows" block of the project's page (Projects › Overview), and the backlog's Assign dialog.
// Acceptance tests, written before the code, on the real page (test/renderer-app-harness.js), read
// through test/project-page-helpers.js.
//
// #741: the New project dialog and its Workflows block are gone (creating a project is the wizard only, whose
// step 3 suggests the workflows: project-wizard tests); the tests of that block went with it.
//
// The contract assumed here:
// - the block carries data-testid="project-workflows-block" inside the project page's data-testid="project-overview";
// - a manifest with errors shows them in data-testid="project-workflows-manifest-errors".
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { region } = require('@multiagent/front-analyser/test/project-page-helpers');

const WORKFLOWS = [
  { file: 'software-development-local-hero.yaml', name: 'software-development-local-hero', category: 'build', origin: 'bundled', inputs: { task: {} } },
  { file: 'backlog-refresh.yaml', name: 'backlog-refresh', category: 'plan', origin: 'bundled', inputs: {} },
  { file: 'my-flow.yaml', name: 'my-flow', category: 'build', origin: 'custom', inputs: { task: {} } },
];
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

// #729: the Overview's block shows the project's workflows as cards (no checkbox); its rendering,
// Make default, Remove and "+ Add a workflow" are in project-workflows-cards-729.test.js.

// ---- the manifest's errors ------------------------------------------------------------------------

const BAD_MANIFEST = { workflows: [], errors: ['.multiagent/project.yaml: not valid YAML (unexpected end of the stream).'] };

const errorsBox = (markup) => H.findEl(markup, (e) => e.attrs['data-testid'] === 'project-workflows-manifest-errors');

test('#486 the project\'s page (Overview): a manifest with errors shows them in the Workflows block', async () => {
  const app = page({ manifest: (target) => (target?.folder ? BAD_MANIFEST : null) });
  await app.boot();
  app.run('openProjectView("p1")');
  await app.settle(20);
  const box = errorsBox(region(app, 'project-overview'));
  assert.ok(box, 'the Overview has data-testid="project-workflows-manifest-errors"');
  assert.match(H.visibleText(box.inner), /not valid YAML/);
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
