// #27 acceptance, written before the code: a project's page (fronts/analyser/views/project/project.js) has
// Start workflow (#pv-start); it opens the Start drawer (packages/ui-kit/start-drawer.js) on that project's
// default workflow, for a created project and an imported one, whatever settings.lastWorkflow remembers. On the
// real page (packages/ui-kit/test/renderer-app-harness.js), as project-tabs-730.test.js opens it: the page and the
// drawer are loaded together, so the test reads what the drawer selected (#wf-select).
//
// The contract assumed here: a project record (api.listProjects, and the `project` of api.listProjectRuns)
// carries its default as `defaultWorkflow`, a workflow name without .yaml (#790); the drawer selects `<name>.yaml`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const wf = (name, label) => ({ file: `${name}.yaml`, name: label, steps: [], inputs: { task: { type: 'string', required: true } } });
// listed in alphabetical order, as api.listWorkflows answers: analyze-project comes first
const WORKFLOWS = [wf('analyze-project', 'Analyze project'), wf('feature', 'Feature'), wf('fix', 'Fix'), wf('issue', 'Issue')];
const CREATED = { id: 'p1', name: 'Shop', folder: 'C:/work/shop', exists: true, isGit: true, workflows: [{ name: 'feature', category: 'feature' }], defaultWorkflow: 'feature' };
const IMPORTED = { id: 'p2', name: 'Imported', folder: 'C:/work/imported', exists: true, isGit: true, repo: 'https://github.com/o/imported', workflows: [{ name: 'fix', category: 'fix' }, { name: 'feature', category: 'feature' }], defaultWorkflow: 'fix' };
const PROJECTS = [CREATED, IMPORTED];

function page(lastWorkflow) {
  return loadApp({
    api: {
      listProjects: async () => PROJECTS,
      listWorkflows: async () => WORKFLOWS,
      getSettings: async () => ({ setupDone: true, lastWorkflow }),
      setSettings: async (s) => ({ setupDone: true, lastWorkflow, ...s }),
      listProjectRuns: async (id) => ({ runs: [], project: PROJECTS.find((p) => p.id === id), local: { ahead: 0, base: 'main', issues: [] } }),
      getBacklog: async () => ({ platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [], epics: [] }),
      getRepositoryPerformance: () => new Promise(() => {}),
      envDetails: async () => [],
      architectureFacts: async () => ({ state: 'not-git', model: null, exclude: [], gate: [] }),
      architectureReport: async () => ({ report: null, findings: [], gone: [], runsSince: null, previousId: null }),
      architectureCity: async () => ({ state: 'not-git', model: null, validation: null, refresh: null, mapRun: null }),
      architectureEstimate: async () => ({ estimate: null }),
    },
  });
}

// the project's page opened, its Start workflow clicked: the workflow the drawer selected
async function startFromProjectPage(id, { lastWorkflow = '' } = {}) {
  const app = page(lastWorkflow);
  await app.boot();
  app.run(`openProjectView(${JSON.stringify(id)})`);
  await app.settle(10);
  await app.click('#pv-start');
  await app.settle(10);
  assert.equal(app.el('#drawer').classList.contains('open'), true, 'Start workflow opened the drawer');
  return String(app.el('#wf-select').value);
}

test('#27 a created project\'s Start workflow opens the drawer on its default workflow', async () => {
  assert.equal(await startFromProjectPage('p1'), 'feature.yaml');
});

test('#27 an imported project\'s Start workflow opens the drawer on its default workflow', async () => {
  assert.equal(await startFromProjectPage('p2'), 'fix.yaml');
});

test('#27 a project\'s Start workflow opens on its default even when another workflow was the last one started', async () => {
  assert.equal(await startFromProjectPage('p1', { lastWorkflow: 'issue.yaml' }), 'feature.yaml');
});
