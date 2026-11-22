// #625 (D1): the project Overview's Mockups button (data-testid="project-mockups", fronts/analyser/views/project/
// project.js) makes the page's project the header's project and opens Plan & Design › Mockups. On the real page
// (packages/ui-kit/test/renderer-app-harness.js), set up as project-tabs-730.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const PROJECTS = [
  { id: 'p1', name: 'Project One', repo: 'https://github.com/o/one', folder: 'C:/work/one', exists: true, isGit: true },
  { id: 'p2', name: 'Project Two', repo: 'https://github.com/o/two', folder: 'C:/work/two', exists: true, isGit: true },
];

async function overviewOf(id, { current }) {
  const app = loadApp({
    storage: { 'craftorio.currentProject': current },
    api: {
      listProjects: async () => PROJECTS,
      getSettings: async () => ({ lastProject: current }),
      listProjectRuns: async (pid) => ({ runs: [], project: PROJECTS.find((p) => p.id === pid) || PROJECTS[0], local: { ahead: 0, base: 'main', issues: [] } }),
      getBacklog: async () => ({ platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [], epics: [] }),
      getRepositoryPerformance: () => new Promise(() => {}),
      envDetails: async () => [],
      architectureFacts: async () => ({ state: 'not-git', model: null, exclude: [], gate: [] }),
      architectureReport: async () => ({ report: null, findings: [], gone: [], runsSince: null, previousId: null }),
      architectureCity: async () => ({ state: 'not-git', model: null, validation: null, refresh: null, mapRun: null }),
      architectureEstimate: async () => ({ estimate: null }),
      listMockups: async () => [],
    },
  });
  await app.boot();
  app.run(`openProjectView('${id}')`);
  await app.settle(10);
  return app;
}

test('#625 the project Overview has a Mockups button', async () => {
  const app = await overviewOf('p1', { current: 'p1' });
  assert.equal([...app.elements.values()].some((e) => String(e.innerHTML || '').includes('data-testid="project-mockups"')), true);
});

test('#625 the Overview\'s Mockups button opens Plan & Design › Mockups for that page\'s project', async () => {
  const app = await overviewOf('p2', { current: 'p1' });
  // the header moved to another project while this page stayed open
  app.run("CurrentProject.set('p1', { redraw: false })");
  await app.settle(5);
  assert.equal(app.run('CurrentProject.get()'), 'p1');
  await app.click('#pv-mockups');
  await app.settle(10);
  assert.deepEqual([app.state().view, app.run('CurrentProject.get()')], ['mockups', 'p2']);
});

test('#625 the Overview\'s Mockups button keeps the header\'s project when it already is the page\'s', async () => {
  const app = await overviewOf('p1', { current: 'p1' });
  await app.click('#pv-mockups');
  await app.settle(10);
  assert.deepEqual([app.state().view, app.run('CurrentProject.get()')], ['mockups', 'p1']);
});
