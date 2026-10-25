// Home's cards (#579, decision 5 of 2026-10-24): packages/ui-kit/home-cards.js is the registry the
// fronts fill as they load (plan-home.js, build-home.js, ai-home.js), and Home (views/dashboard/)
// draws what the registered cards give it. The registry is tested as a module; Home with a front
// left out is tested on the real page (renderer-app-harness.js), the front's scripts filtered out of
// the load, the way a composition without that front would build the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, text } = require('./renderer-app-harness');

const registry = () => {
  const file = path.join(__dirname, '..', 'home-cards.js');
  delete require.cache[require.resolve(file)];
  return require(file);
};

test('HomeCards.register keeps the cards by order, replaces a card registered twice, and refuses one without an id', () => {
  const hc = registry();
  hc.register({ id: 'build', order: 20 });
  hc.register({ id: 'plan', order: 10 });
  hc.register({ id: 'ai', order: 30 });
  assert.deepEqual(hc.list().map((c) => c.id), ['plan', 'build', 'ai']);
  hc.register({ id: 'plan', order: 10, marker: true });
  assert.deepEqual(hc.list().map((c) => [c.id, !!c.marker]), [['plan', true], ['build', false], ['ai', false]]);
  assert.throws(() => hc.register({ order: 1 }), /needs an id/);
  hc.reset();
  assert.deepEqual(hc.list(), []);
});

test('HomeCards.stages lists every card\'s stages by the stage\'s order, each with its card', () => {
  const hc = registry();
  hc.register({ id: 'build', order: 20, stages: [{ id: 'todo', order: 40, view: 'backlog' }, { id: 'released', order: 70, view: 'releases' }] });
  hc.register({ id: 'plan', order: 10, stages: [{ id: 'inbox', order: 10, view: 'inbox' }] });
  hc.register({ id: 'ai', order: 30 });
  assert.deepEqual(hc.stages().map((s) => [s.id, s.card.id]), [['inbox', 'plan'], ['todo', 'build'], ['released', 'build']]);
});

// the scripts of a front, by their page-relative names (renderer-app-harness.js drops the layer's prefix)
const PLAN = (name) => name === 'plan-home.js' || /^views\/(inbox|discovery|arena|duo)\//.test(name);
const ANALYSER = (name) => /^views\/(project|analytics)\//.test(name);

const api = {
  listDiscoveryCards: async () => [{ id: 'c1', column: 'inbox' }],
  listDiscoveryWaiting: async () => [{ id: 'c1', column: 'inbox', title: 'Idea', question: { author: 'oracle', text: 'Which?', ts: new Date().toISOString() } }],
  getBacklog: async () => ({ issues: [{ number: 1, column: 'todo', state: 'open' }], roadmap: { stages: [] } }),
  listReleases: async () => ({ releases: [] }),
  listActiveRuns: async () => [],
  listRuns: async () => ({ runs: [{ runId: 'r1', status: 'success', finishedAt: new Date().toISOString() }] }),
  getOccupancy: async () => ({ occupancy: 0.5 }),
  listProjects: async () => [{ id: 'p1', name: 'Demo', repo: 'o/r' }],
};

test('without the plan front, Home\'s strip starts at Backlog To do and "What needs you" has no question row', async () => {
  const app = loadApp({ api, only: (name) => !PLAN(name) });
  await app.boot();
  app.run("showView('dashboard')");
  await app.settle();
  const body = app.el('#home-body').innerHTML;
  const stages = [...body.matchAll(/data-testid="home-flow-stage" data-stage="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(stages, ['todo', 'running', 'merged', 'released'], 'the plan front\'s Inbox, Discovery and Ready stages are left out');
  assert.doesNotMatch(body, /data-kind="card"/, 'no discovery question without the plan front');
  assert.doesNotMatch(body, /data-home-card=/);
  assert.ok(!app.defs.has('inbox'), 'the Inbox screen is not registered');
});

test('with every front, Home\'s strip runs from Inbox to Released and the question row has its Answer button', async () => {
  const app = loadApp({ api });
  await app.boot();
  app.run("showView('dashboard')");
  await app.settle();
  const body = app.el('#home-body').innerHTML;
  const stages = [...body.matchAll(/data-testid="home-flow-stage" data-stage="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(stages, ['inbox', 'discovery', 'ready', 'todo', 'running', 'merged', 'released']);
  assert.match(body, /data-kind="card"/);
  assert.match(body, /data-home-card="c1"[^>]*>Answer</);
  // "Today": the shell's stats, the AI front's night cost, the build front's next stage, in that order
  const labels = [...body.matchAll(/<label>([^<]+)<\/label>/g)].map((m) => text(m[1]));
  assert.deepEqual(labels, ['Cost today', 'Cost last night', 'Runs finished', 'Runs failed', '24/7 occupancy', 'Next roadmap stage']);
});

test('without the analyser front, Home hides its Analytics tab', async () => {
  const app = loadApp({ api, only: (name) => !ANALYSER(name) });
  await app.boot();
  app.run("showView('dashboard')");
  await app.settle();
  assert.ok(!app.defs.has('analytics'));
  const tab = app.el('#view-dashboard [data-home-tab="analytics"]');
  assert.ok(tab, 'the tab button is in the markup');
  assert.equal(tab.classList.contains('hidden'), true, 'the tab is hidden without the Analytics screen');
});
