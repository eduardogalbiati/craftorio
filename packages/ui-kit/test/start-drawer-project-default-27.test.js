// #27 acceptance, written before the code: the Start drawer (packages/ui-kit/start-drawer.js openDrawer) opens on
// the project's default workflow when a project is given (or is the header's, window.CurrentProject) and no
// workflow is asked for; the project's default wins over settings.lastWorkflow. On the real page
// (renderer-app-harness.js: the page's scripts in a vm with a fake DOM and a fake window.api).
//
// The contract assumed here:
// - a project record of api.listProjects() carries its default as `defaultWorkflow`, a workflow name without
//   .yaml (#790, packages/engine/domains/project/projects.js); the drawer selects `<name>.yaml` in #wf-select;
// - no project at all (none given, none in the header) keeps settings.lastWorkflow;
// - an explicit `workflow` (the Backlog's New issue → issue.yaml) wins over the project's default.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');

const wf = (name, label) => ({ file: `${name}.yaml`, name: label, steps: [], inputs: { task: { type: 'string', required: true } } });
// listed in alphabetical order, as api.listWorkflows answers: analyze-project comes first
const WORKFLOWS = [wf('analyze-project', 'Analyze project'), wf('feature', 'Feature'), wf('fix', 'Fix'), wf('issue', 'Issue')];
const CREATED = { id: 'p1', name: 'Shop', folder: 'C:/p/shop', exists: true, workflows: [{ name: 'feature', category: 'feature' }], defaultWorkflow: 'feature' };
const IMPORTED = { id: 'p2', name: 'Imported', folder: 'C:/p/imported', exists: true, repo: 'https://github.com/o/imported', workflows: [{ name: 'fix', category: 'fix' }, { name: 'feature', category: 'feature' }], defaultWorkflow: 'fix' };
const BARE = { id: 'p3', name: 'Bare', folder: 'C:/p/bare', exists: true };

async function page({ projects = [CREATED, IMPORTED, BARE], lastWorkflow = '', currentProject = null } = {}) {
  const app = loadApp({
    storage: currentProject ? { 'craftorio.currentProject': currentProject } : {},
    api: {
      getSettings: async () => ({ setupDone: true, lastWorkflow }),
      setSettings: async (s) => ({ setupDone: true, lastWorkflow, ...s }),
      listWorkflows: async () => WORKFLOWS,
      listProjects: async () => projects,
    },
  });
  await app.boot();
  return app;
}

async function selectedWorkflow(app, args) {
  await app.run(`openDrawer(${JSON.stringify(args)})`);
  await app.settle(10);
  return String(app.el('#wf-select').value);
}

test('#27 openDrawer with a created project and no workflow selects the project\'s default, not the first workflow', async () => {
  const app = await page();
  assert.equal(await selectedWorkflow(app, { project: 'p1' }), 'feature.yaml');
});

test('#27 openDrawer with an imported project and no workflow selects the project\'s default', async () => {
  const app = await page();
  assert.equal(await selectedWorkflow(app, { project: 'p2' }), 'fix.yaml');
});

test('#27 openDrawer with a project and no workflow: the project\'s default wins over settings.lastWorkflow', async () => {
  const app = await page({ lastWorkflow: 'issue.yaml' });
  assert.equal(await selectedWorkflow(app, { project: 'p1' }), 'feature.yaml');
});

test('#27 openDrawer with no project given uses the header project\'s default over settings.lastWorkflow', async () => {
  const app = await page({ lastWorkflow: 'issue.yaml', currentProject: 'p2' });
  assert.equal(await selectedWorkflow(app, {}), 'fix.yaml');
});

test('#27 guard: an explicit workflow wins over the project\'s default (the Backlog\'s New issue)', async () => {
  const app = await page();
  assert.equal(await selectedWorkflow(app, { workflow: 'issue.yaml', project: 'p1' }), 'issue.yaml');
});

test('#27 guard: with no project at all, settings.lastWorkflow is selected', async () => {
  const app = await page({ projects: [], lastWorkflow: 'issue.yaml' });
  assert.equal(await selectedWorkflow(app, {}), 'issue.yaml');
});
