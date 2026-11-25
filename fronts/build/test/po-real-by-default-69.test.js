// #69 (acceptance tests, written before the code): on a fresh workspace, once the first-run Setup is finished, the
// Product Owner's drawer (fronts/build/views/backlog/backlog-po.js) is real: it shows its model, no simulation
// scenarios, and says that a question uses the subscription. Developer mode, turned on in Settings, still simulates it.
//
// The contract assumed here: window.BacklogPO.open() and the project page's "Open the PO" (the action openPoIssue)
// open the drawer; #po-sub is its subtitle, #po-sim its simulation scenarios (class hidden), #po-note its cost note.
// appInfo answers simulationOnly: false, as in the owner's app (simulation only counts as developer mode).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const clone = (x) => JSON.parse(JSON.stringify(x));
const PROJECT = { id: 'p1', name: 'Shop', folder: 'C:/p/shop', repo: 'https://github.com/o/shop', exists: true };

async function page(settings) {
  let saved = clone(settings);
  const app = loadApp({
    api: {
      appInfo: async () => ({ simulationOnly: false }),
      getSettings: async () => clone(saved),
      setSettings: async (patch) => { saved = { ...saved, ...clone(patch || {}) }; return clone(saved); },
      listWorkflows: async () => [],
      listProjects: async () => [clone(PROJECT)],
      listPipelines: async () => [],
      envDetails: async () => [],
      machineProfile: async () => ({ line: '8 cores' }),
    },
  });
  await app.boot();
  return app;
}

const setupOpen = (app) => !!app.run('!!(window.Setup && window.Setup.isOpen())');

async function finishSetup(app) {
  assert.equal(setupOpen(app), true, 'a fresh workspace opens the Setup');
  for (let i = 0; i < 6 && setupOpen(app); i++) {
    await app.click('#setup-modal #btn-setup-next');
    await app.settle(10);
  }
  assert.equal(setupOpen(app), false, 'the Setup finished');
  await app.settle(20);
}

// The PO's drawer, opened by `how`, as primitives
async function poDrawer(app, how) {
  await app.run(how);
  await app.settle(20);
  return {
    sub: String(app.el('#po-sub').textContent),
    scenariosHidden: app.el('#po-sim').classList.contains('hidden'),
    scenarios: String(app.el('#po-scenario').innerHTML),
    note: String(app.el('#po-note').textContent),
  };
}
const OPEN = 'window.BacklogPO.open()';
const OPEN_ISSUE = "window.Actions.call('openPoIssue', 'p1')";

for (const [name, how] of [['the PO drawer', OPEN], ['the project page\'s Open the PO', OPEN_ISSUE]]) {
  test(`#69 fresh workspace, Setup finished: ${name} is not simulated`, async () => {
    const app = await page({ setupDone: false });
    await finishSetup(app);
    const po = await poDrawer(app, how);
    assert.match(po.sub, /claude-/, 'the drawer names its model');
    assert.doesNotMatch(po.sub, /simulated/i);
    assert.equal(po.scenariosHidden, true, 'no simulation scenarios');
    assert.equal(po.scenarios, '');
  });

  test(`#69 fresh workspace, Setup finished: ${name} says a question uses the subscription, and filing is no preview`, async () => {
    const app = await page({ setupDone: false });
    await finishSetup(app);
    const po = await poDrawer(app, how);
    assert.match(po.note, /subscription/i);
    assert.doesNotMatch(po.note, /simulated|preview/i);
  });
}

test('#69 guard: with developer mode on, the PO drawer is simulated and offers its scenarios', async () => {
  const app = await page({ setupDone: true, developerMode: true });
  const po = await poDrawer(app, OPEN);
  assert.match(po.sub, /simulated/i);
  assert.equal(po.scenariosHidden, false);
  assert.equal(/data-po-scenario=/.test(po.scenarios), true);
});
