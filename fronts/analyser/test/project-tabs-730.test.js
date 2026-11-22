// #730 acceptance: a project's page (fronts/analyser/views/project/project.js) has the tabs Overview · City ·
// Health · Conflict map, in this order (pt-BR Visão geral · Cidade · Saúde · Mapa de conflitos); no
// Architecture tab with its Facts / City switch, no Refactor tab. Written before the code, on the real page
// (packages/ui-kit/test/renderer-app-harness.js) read through ./project-page-helpers.js, as
// renderer-project-conflict-map-354.test.js and fronts/build/test/renderer-projects-354.test.js read it.
// The contract assumed here (new seams of #730):
// - the tabs are role="tab" buttons with data-pv-tab="overview" | "city" | "health" | "conflicts";
// - the City tab reads the city (api.architectureCity(projectId)), the Health tab the facts and the report
//   (api.architectureFacts(projectId, …), api.architectureReport(projectId, …));
// - neither carries the old switch (data-testid="architecture-mode-facts" / "architecture-mode-city");
// - a tab remembered from before (multiagent.projectTabs: 'refactor' or 'architecture') opens the Overview;
// - the labels are i18n texts of packages/shared/i18n/en.json and pt-BR.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, pageMarkup, region, tabsOf } = require('./project-page-helpers');

const ROOT = path.join(__dirname, '..', '..', '..');
const PROJECTS = [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/one', folder: 'C:/work/one', exists: true, isGit: true }];

function page({ storage = {} } = {}) {
  return loadApp({
    storage: { 'craftorio.currentProject': 'p1', ...storage },
    api: {
      listProjects: async () => PROJECTS,
      getSettings: async () => ({ lastProject: 'p1' }),
      listProjectRuns: async () => ({ runs: [], project: PROJECTS[0], local: { ahead: 0, base: 'main', issues: [] } }),
      getBacklog: async () => ({ platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [], epics: [] }),
      getRepositoryPerformance: () => new Promise(() => {}),
      envDetails: async () => [],
      speechStatus: async () => ({ path: null, command: 'whisper', installHint: '', models: [], model: 'base', languages: ['en'], language: 'en' }),
      architectureFacts: async () => ({ state: 'not-git', model: null, exclude: [], gate: [] }),
      architectureReport: async () => ({ report: null, findings: [], gone: [], runsSince: null, previousId: null }),
      architectureCity: async () => ({ state: 'not-git', model: null, validation: null, refresh: null, mapRun: null }),
      architectureEstimate: async () => ({ estimate: null }),
    },
  });
}

async function openProject(t, opts) {
  const app = page(opts);
  await app.boot();
  app.run("openProjectView('p1')");
  await app.settle(10);
  return app;
}
const tabs = (app) => tabsOf(region(app, 'project-page'));
const labels = (app) => [...new Set(tabs(app).map((x) => x.label))];
const selected = (app) => [...new Set(tabs(app).filter((x) => x.selected).map((x) => x.label))];
async function selectTab(app, label) {
  const tab = tabs(app).find((x) => x.label === label);
  assert.equal(tab !== undefined, true, `the project page has a "${label}" tab; tabs: ${labels(app).join(', ')}`);
  await clickRendered(app, tab.el);
  await app.settle(10);
}
const switchShown = (app) => /data-testid="architecture-mode-(facts|city)"|data-arch-mode=/.test(pageMarkup(app, { defs: true }));
const projectIdsOf = (app, method) => app.callsTo(method).map((args) => String(args[0]));

test('#730 a project\'s page has the tabs Overview, City, Health, Conflict map, in this order', async (t) => {
  const app = await openProject(t);
  assert.deepEqual(labels(app), ['Overview', 'City', 'Health', 'Conflict map']);
});

test('#730 the tabs\' ids are overview, city, health, conflicts, in this order', async (t) => {
  const app = await openProject(t);
  const ids = [...new Set(tabs(app).map((x) => x.el.attrs['data-pv-tab']))];
  assert.deepEqual(ids, ['overview', 'city', 'health', 'conflicts']);
});

test('#730 no Architecture tab and no Refactor tab any more', async (t) => {
  const app = await openProject(t);
  const all = labels(app);
  assert.equal(all.includes('Architecture'), false, `tabs: ${all.join(', ')}`);
  assert.equal(all.includes('Refactor'), false, `tabs: ${all.join(', ')}`);
});

test('#730 the City tab shows the city (architecture:city) with no Facts / City switch', async (t) => {
  const app = await openProject(t);
  await selectTab(app, 'City');
  assert.deepEqual(selected(app), ['City']);
  assert.equal(projectIdsOf(app, 'architectureCity').includes('p1'), true, 'the city of p1 is read');
  assert.equal(switchShown(app), false, 'no Facts / City switch');
});

test('#730 the Health tab reads the facts and the Oracle\'s report, with no Facts / City switch', async (t) => {
  const app = await openProject(t);
  await selectTab(app, 'Health');
  assert.deepEqual(selected(app), ['Health']);
  assert.equal(projectIdsOf(app, 'architectureFacts').includes('p1'), true, 'the facts of p1 are read');
  assert.equal(projectIdsOf(app, 'architectureReport').includes('p1'), true, 'the report of p1 is read');
  assert.equal(switchShown(app), false, 'no Facts / City switch');
});

test('#730 a project last shown on the old Refactor tab opens on the Overview', async (t) => {
  const app = await openProject(t, { storage: { 'craftorio.projectTabs': JSON.stringify({ p1: 'refactor' }) } });
  assert.deepEqual(selected(app), ['Overview']);
});

test('#730 the selected Health tab is remembered for the project in the next window', async (t) => {
  const app = await openProject(t);
  await selectTab(app, 'Health');
  const next = await openProject(t, { storage: Object.fromEntries(app.sandbox.localStorage.store) });
  assert.deepEqual(selected(next), ['Health']);
});

test('#730 the tabs\' labels are in en.json and pt-BR.json (City / Cidade, Health / Saúde)', () => {
  const read = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
  const projectTexts = (cat) => Object.entries(cat).filter(([k]) => k.startsWith('project.')).map(([, v]) => v);
  const en = projectTexts(read('en'));
  const pt = projectTexts(read('pt-BR'));
  assert.deepEqual(['City', 'Health'].map((s) => en.includes(s)), [true, true], 'en.json project.* has "City" and "Health"');
  assert.deepEqual(['Cidade', 'Saúde'].map((s) => pt.includes(s)), [true, true], 'pt-BR.json project.* has "Cidade" and "Saúde"');
});
