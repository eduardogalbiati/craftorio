// #731: the review's "Open the city" (data-testid="wizard-open-city", fronts/build/views/projects/project-wizard.js)
// finishes the wizard and lands on the project's City: the project page (state.view 'project', state.pv.id the
// project) on its Architecture tab (state.pv.tab 'architecture'), whose view is the City (ProjectArchitecture.openCity,
// remembered in sessionStorage 'multiagent.architecture.view' = 'city'). Acceptance test, written before the
// code, on the real page (packages/ui-kit/test/renderer-app-harness.js), driven as project-wizard-review-642.test.js
// drives the review. The city the review reads (api.architectureCity) has the plan the onboarding drew.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@multiagent/ui-kit/test/page-pieces');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@multiagent/front-analyser/test/project-page-helpers');

const PID = 'p-city';
const REPO = 'https://github.com/o/city.git';
const NAME = 'City one';
const PROJECT = { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/o-city', exists: true };
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const ANALYZING = { projectId: PID, status: 'analyzing', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done' }, projectMap: { status: 'running' } }), cli: CLI_OK };
const ANALYZED = { projectId: PID, status: 'analyzed', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done' }, projectMap: { status: 'done' }, ranking: { status: 'done' } }), cli: CLI_OK };
// the city after the onboarding drew its plan (#731): grouped by the plan's districts
const CITY = {
  state: 'ok',
  model: {
    grouping: 'plan', project: 'city', summary: '', commit: null,
    zones: [{ id: 'core', name: 'Core', kind: 'industrial', purpose: '' }],
    districts: [{ id: 'api', name: 'API', zone: 'core', files: 1, lines: 1 }, { id: 'core', name: 'Core', zone: 'core', files: 1, lines: 1 }],
    buildings: [
      { path: 'src/api/a.js', district: 'api', lines: 1, churn: 1, complexity: null, functions: null, worst: null, lastChange: null },
      { path: 'src/core/c.js', district: 'core', lines: 1, churn: 1, complexity: null, functions: null, worst: null, lastChange: null },
    ],
    edges: [], edgesNotRead: null, landmarks: [], ports: [],
    complexity: { status: 'not measured', reason: 'test', tool: null },
  },
  validation: { coverage: 1 },
  refresh: { suggested: false, unmatchedShare: 0, newFolders: [] },
  mapRun: null,
};

const clone = (x) => JSON.parse(JSON.stringify(x));

function page() {
  return loadApp({
    api: {
      listProjects: async () => [clone(PROJECT)],
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: async () => clone(ANALYZED),
      analyzeOnboarding: async (id) => ({ ...clone(ANALYZING), projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
      architectureEstimate: async () => ({ estimate: null }),
      architectureCity: async () => clone(CITY),
      architectureFacts: async () => ({ state: 'ok', exclude: [], model: { files: [], danger_zone: [] } }),
      refactorProposals: async () => [],
      getBacklog: async () => ({ issues: [] }),
      updateProject: async (id, patch) => ({ ...clone(PROJECT), ...patch }),
    },
  });
}

function markupOf(app, id) {
  const parts = [];
  const seen = new Set([id]);
  const follow = (el, depth) => {
    const html = String(el?.innerHTML || '');
    parts.push(html || String(el?.textContent || ''));
    if (depth > 3) return;
    for (const m of html.matchAll(/\bid="([\w-]+)"/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const inner = existing(app, m[1]);
      if (inner && (inner.innerHTML || inner.textContent)) follow(inner, depth + 1);
    }
  };
  follow(existing(app, id), 0);
  return parts.join('\n');
}
const wizardMarkup = (app) => markupOf(app, 'project-wizard');
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);

function currentStep(app) {
  const el = H.findEl(wizardMarkup(app), (e) => e.attrs['data-step'] && e.attrs['aria-current'] === 'step');
  return el ? el.attrs['data-step'] : null;
}

async function press(app, testid) {
  const el = byTestId(wizardMarkup(app), testid);
  assert.ok(el, `the wizard shows data-testid="${testid}"`);
  await clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}

async function typeInto(app, sel, value) {
  const el = app.el(sel);
  el.value = value;
  el.tagName = 'INPUT';
  el.dataset.testid = sel.slice(1);
  const root = app.el('#project-wizard');
  for (const type of ['input', 'change', 'blur']) {
    for (const node of [el, root]) {
      const ev = { type, target: el, currentTarget: node, preventDefault() {}, stopPropagation() {} };
      if (node === el) await el[`on${type}`]?.(ev);
      for (const fn of node.listeners[type] || []) await fn(ev);
    }
  }
  await app.settle(5);
}

async function emit(app, state) {
  for (const fn of app.apiHandlers.onOnboardingChanged || []) fn(clone(state));
  await app.settle(10);
}

async function reviewDone() {
  const app = page();
  await app.boot();
  app.sandbox.ProjectWizard.open();
  await app.settle(10);
  await press(app, 'wizard-source-import');
  await press(app, 'wizard-next');
  await typeInto(app, '#wizard-repo', REPO);
  await typeInto(app, '#wizard-name', NAME);
  await press(app, 'wizard-next');
  await emit(app, CLONING);
  await emit(app, READY);
  assert.equal(currentStep(app), 'analysis', 'the wizard is on the analysis step');
  await emit(app, ANALYZED);
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'review', 'the wizard is on the review');
  await app.settle(20);
  return app;
}

const wizardClosed = (app) => H.findEl(wizardMarkup(app), (e) => 'data-step' in e.attrs) === null;

// #730: the City is a tab of its own (no Facts / City switch)
test('#731 #730 "Open the city" finishes the wizard and lands on the project\'s City tab', { timeout: 20000 }, async () => {
  const app = await reviewDone();
  // the City's mode and panel controls do not attach on this fake DOM (their header is not there): the test is
  // about where "Open the city" lands, so the city is drawn without them
  app.sandbox.ProjectCityModes = undefined;
  app.sandbox.ProjectCityPanels = undefined;
  await Promise.race([press(app, 'wizard-open-city'), app.settle(60)]);
  await app.settle(30);
  assert.equal(wizardClosed(app), true, 'the wizard closed');
  assert.equal(String(app.state().view), 'project', 'the project page is open');
  assert.equal(String(app.state().pv?.id), PID, 'on the new project');
  assert.equal(String(app.state().pv?.tab), 'city', 'on its City tab');
});
