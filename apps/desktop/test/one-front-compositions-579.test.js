// #579 (phase 3 review): a composition of one front builds and runs that front alone. The page is
// loaded through the harness with every front but one left out of the script list (loadApp's
// `fronts`, the way `scripts/docs.js` would generate the page of such a composition), and the paths
// that used to call another front's script global are exercised: they go through the kit's actions
// registry (packages/ui-kit/actions.js) and do nothing, or fall back, when the front that offers the
// action is not shipped. With every front, the same paths reach the action.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fronts, viewsOf } = require('../../../scripts/source-tree');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');

const ROOT = require('path').join(__dirname, '..', '..', '..');
const FRONTS = fronts(ROOT).map((f) => f.id);

const api = {
  listProjects: async () => [{ id: 'p1', name: 'Demo', repo: 'o/r', folder: '/x' }],
  listAgents: async () => [],
  listRuns: async () => ({ runs: [] }),
};

// a page of the kit and one front: its scripts load without an error, and its screens are the only ones
for (const id of FRONTS) {
  test(`a composition of the ${id} front alone loads without an error and registers only its screens`, async () => {
    const app = loadApp({ api, fronts: [id] });
    await app.boot();
    assert.deepEqual(app.errors.map((e) => `${e.script}: ${e.message}`), []);
    const own = viewsOf(ROOT, fronts(ROOT).find((f) => f.id === id).dir);
    const others = fronts(ROOT).filter((f) => f.id !== id).flatMap((f) => viewsOf(ROOT, f.dir));
    for (const v of own) assert.ok(app.defs.has(v), `${id}'s screen ${v} is registered`);
    for (const v of others) assert.ok(!app.defs.has(v), `another front's screen ${v} is not registered`);
  });
}

test('build alone: a project card click wants the project\'s page (analyser) and does nothing without it', async () => {
  const app = loadApp({ api, fronts: ['build'] });
  await app.boot();
  app.run("showView('projects')");
  await app.settle();
  assert.equal(app.run("Actions.has('openProject')"), false);
  assert.equal(app.run("Actions.has('showProjects')"), true, 'the Projects screen offers showProjects');
  assert.equal(app.run("Actions.has('openArtifactsAt')"), true);
  assert.equal(app.run("Actions.has('showWorkflowDefinition')"), true);
  assert.equal(app.run("Actions.has('agentCard')"), false, 'the agent cards are the ai front\'s');
  await app.click('[data-testid="project-card"]', { dataset: { id: 'p1', testid: 'project-card' }, within: ['#projects-list'] });
  assert.equal(app.state().view, 'projects', 'the click did not throw and the screen stays');
  assert.deepEqual(app.errors, []);
});

test('analyser alone: the project page\'s Back wants the Projects screen (build) and goes Home without it', async () => {
  const app = loadApp({ api, fronts: ['analyser'] });
  await app.boot();
  app.run("openProjectView('p1')");
  await app.settle();
  assert.equal(app.state().view, 'project');
  assert.equal(app.run("Actions.has('showProjects')"), false);
  await app.click('#btn-project-back');
  assert.equal(app.state().view, 'dashboard', 'Back falls back to Home');
  assert.deepEqual(app.errors, []);
});

test('ai alone: an agent card offers no "Open in workflow" without the Workflows screen (build)', async () => {
  const agent = { id: 'a1', name: 'Dev', workflow: { file: 'x.yaml', name: 'X' }, session: 'claude', skills: [] };
  const alone = loadApp({ api, fronts: ['ai'] });
  await alone.boot();
  assert.equal(alone.run("Actions.has('showWorkflowDefinition')"), false);
  assert.equal(alone.run("Actions.has('openArtifactsAt')"), false);
  assert.equal(alone.run("Actions.has('agentCard')"), true, 'the Agents screen offers the card');
  const card = alone.run(`AgentCards.card(${JSON.stringify(agent)}, { actions: true })`);
  assert.doesNotMatch(card, /data-act="open-workflow"/);
  assert.deepEqual(alone.errors, []);

  const every = loadApp({ api });
  await every.boot();
  assert.equal(every.run("Actions.has('showWorkflowDefinition')"), true);
  assert.match(every.run(`AgentCards.card(${JSON.stringify(agent)}, { actions: true })`), /data-act="open-workflow"/);
});

test('with every front, the Projects card opens the project\'s page through the registry', async () => {
  const app = loadApp({ api });
  await app.boot();
  app.run("showView('projects')");
  await app.settle();
  await app.click('[data-testid="project-card"]', { dataset: { id: 'p1', testid: 'project-card' }, within: ['#projects-list'] });
  assert.equal(app.state().view, 'project');
  assert.equal(app.state().pv?.id, 'p1');
  await app.click('#btn-project-back');
  assert.equal(app.state().view, 'projects', 'Back opens the Projects screen');
  assert.deepEqual(app.errors, []);
});
