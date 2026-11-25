// #69 (internal details): with developer mode on, unchecking Simulation in the Start drawer makes the run real, so the
// note about the CLI subscriptions (#start-real-note) shows; checking it again hides the note.
// Simulation only (the automated checks) hides it like developer mode; reopening the drawer draws it again.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');

async function opened({ developerMode = true, simulationOnly = false } = {}) {
  const settings = { setupDone: true, developerMode };
  const app = loadApp({
    api: {
      appInfo: async () => ({ simulationOnly }),
      getSettings: async () => ({ ...settings }),
      setSettings: async () => ({ ...settings }),
      listWorkflows: async () => [{ file: 'analyze-project.yaml', name: 'analyze-project', category: 'analysis', inputs: {} }],
      listProjects: async () => [{ id: 'p1', name: 'Shop', folder: 'C:/p/shop', exists: true }],
      listPipelines: async () => [],
      envDetails: async () => [],
    },
  });
  await app.boot();
  await app.run("openDrawer({ workflow: 'analyze-project.yaml', project: 'p1' })");
  await app.settle(20);
  return app;
}

test('#69 the note about real runs follows the Simulation box', async () => {
  const app = await opened();
  const box = app.el('#mock-toggle');
  const note = app.el('#start-real-note');
  assert.equal(note.classList.contains('hidden'), true, 'simulated: no note');
  box.checked = false;
  box.onchange();
  assert.equal(note.classList.contains('hidden'), false, 'a real run: the note');
  assert.match(String(note.textContent), /subscription/i);
  box.checked = true;
  box.onchange();
  assert.equal(note.classList.contains('hidden'), true, 'simulated again: no note');
});

test('#69 simulation only: the Start drawer hides the note, with developer mode off', async () => {
  const app = await opened({ developerMode: false, simulationOnly: true });
  assert.equal(app.el('#start-real-note').classList.contains('hidden'), true);
});

test('#69 with developer mode on, the drawer reopened after Simulation was unchecked is simulated again, without the note', async () => {
  const app = await opened();
  const box = app.el('#mock-toggle');
  box.checked = false;
  box.onchange();
  await app.run("openDrawer({ workflow: 'analyze-project.yaml', project: 'p1' })");
  await app.settle(20);
  assert.equal(box.checked, true);
  assert.equal(app.el('#start-real-note').classList.contains('hidden'), true);
});
