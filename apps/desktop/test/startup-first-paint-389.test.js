// #389 acceptance: first paint first. The window draws Home from the index before the slow reads;
// the top bar's usage and Home's 24/7 occupancy load after the first paint and show a loading state
// meanwhile. Through the page (test/renderer-app-harness.js): a fake window.api whose usage and
// occupancy answers the test holds back, the markup Home writes into #home-body, the page's api calls.
//
// The contract these tests assume:
//   - app.js's init asks for the workspace (api.getWorkspace) and the first data before it asks for
//     the usage (api.getUsage): the usage is asked after the first paint, never ahead of it;
//   - Home's overview (data-testid="home-flow-strip", "home-needs-you", "home-today") is drawn while
//     api.getUsage and api.getOccupancy have not answered;
//   - Home's "24/7 occupancy" stat carries data-testid="home-occupancy" and aria-busy="true" while
//     api.getOccupancy has not answered; once it answers, aria-busy="true" is gone and the value shows;
//   - the top bar's usage widget (#usage-widget) has the attribute aria-busy="true" while api.getUsage
//     has not answered, and not once it answered.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');

const PROJECTS = [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/work/one' }];
const BASE_API = {
  listProjects: async () => PROJECTS,
  getSettings: async () => ({ lastProject: 'p1' }),
  listWorkflows: async () => [{ file: 'software-development.yaml', name: 'software-development', category: 'build' }],
  getBacklog: async () => ({ issues: [], epics: [], roadmap: { stages: [] } }),
};
const USAGE = { scope: 'orchestrator', totals: { month: { tokens: { total: 1234 }, costUsd: 1.5 } }, providers: [], spending: null };
const OCCUPANCY = { empty: false, occupancy: 0.42 };

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

async function home(api = {}) {
  const app = loadApp({ storage: { 'multiagent.currentProject': 'p1' }, api: { ...BASE_API, ...api } });
  await app.boot();
  app.run("showView('dashboard')");
  await app.settle(30);
  return app;
}
const body = (app) => String(app.el('#home-body').innerHTML || '');
const order = (app, name) => app.apiCalls.findIndex(([n]) => n === name);

test('init asks for the workspace and the first data before the usage (#389)', async () => {
  const usage = deferred();
  const app = await home({ getUsage: () => usage.promise });
  const ws = order(app, 'getWorkspace');
  const workflows = order(app, 'listWorkflows');
  const first = order(app, 'getUsage');
  assert.ok(ws >= 0, 'init asked for the workspace');
  assert.ok(first >= 0, 'the usage is still asked, after the first paint');
  assert.ok(first > ws, `api.getUsage (call #${first}) comes after api.getWorkspace (call #${ws})`);
  assert.ok(first > workflows, `api.getUsage (call #${first}) comes after api.listWorkflows (call #${workflows})`);
});

test('Home draws its overview while the usage and the occupancy have not answered (#389)', async () => {
  const usage = deferred();
  const occupancy = deferred();
  const app = await home({ getUsage: () => usage.promise, getOccupancy: () => occupancy.promise });
  const html = body(app);
  assert.match(html, /data-testid="home-flow-strip"/, 'the flow strip is drawn');
  assert.match(html, /data-testid="home-needs-you"/, '"What needs you" is drawn');
  assert.match(html, /data-testid="home-today"/, '"Today" is drawn');
});

test('Home\'s 24/7 occupancy shows a loading state until the occupancy answers (#389)', async () => {
  const occupancy = deferred();
  const app = await home({ getUsage: async () => USAGE, getOccupancy: () => occupancy.promise });
  const stat = () => (/<[^>]*data-testid="home-occupancy"[^>]*>/.exec(body(app)) || [])[0] || '';
  assert.ok(stat(), 'Home draws the occupancy stat (data-testid="home-occupancy") before it answers');
  assert.match(stat(), /aria-busy="true"/, 'the occupancy stat is busy while it loads');

  occupancy.resolve(OCCUPANCY);
  await app.settle(30);
  assert.ok(stat(), 'the occupancy stat is still there');
  assert.doesNotMatch(stat(), /aria-busy="true"/, 'no longer busy once the occupancy answered');
  assert.match(body(app), /42%/, 'the occupancy shows');
});

test('the top bar\'s usage widget is busy until the usage answers (#389)', async () => {
  const usage = deferred();
  const app = await home({ getUsage: () => usage.promise });
  const widget = app.el('#usage-widget');
  assert.equal(widget.getAttribute('aria-busy'), 'true', 'the usage widget is busy while the usage loads');

  usage.resolve(USAGE);
  await app.settle(30);
  assert.notEqual(widget.getAttribute('aria-busy'), 'true', 'no longer busy once the usage answered');
  assert.match(String(app.el('#usage-widget-text').textContent), /tok/, 'the month\'s usage shows');
});
