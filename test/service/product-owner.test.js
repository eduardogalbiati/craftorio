// src/service/channels/product-owner.js: po:ask (#149) notifies the bell for a real answer, never
// for a simulated one (the drawer's avatar dot is enough for that). The test workspace always runs
// with MULTIAGENT_SIMULATION_ONLY=1 (see docs/agents/testing.md), so a "real" answer is exercised by
// stubbing src/product-owner.js's own ask() and forcing simulation.simulationOnly() false just for
// that call: no model or CLI is ever started here.
const test = require('node:test');
const assert = require('node:assert/strict');
const productOwner = require('../../src/product-owner');
const simulation = require('../../src/engine/simulation');
const { makeService, roadmapProject } = require('./helpers');

test('po:ask: a simulated (mock) answer raises no notification; a real answer raises a `po` notice through the bell', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1, 2], 'po-notify');
  const shown = [];
  service.events.on('notify', (n) => shown.push(n));

  const mocked = await api['po:ask']({ projectId: p.id, question: 'Analyze the backlog', mock: true, mode: 'plan', attachments: [], issues: [] });
  assert.ok(mocked.message);
  assert.deepEqual(shown, []);

  const realAsk = productOwner.ask;
  const realSimOnly = simulation.simulationOnly;
  t.after(() => { productOwner.ask = realAsk; simulation.simulationOnly = realSimOnly; });
  productOwner.ask = async () => ({ message: { role: 'po', text: 'A real answer.', answer: { summary: 'ok', groups: [] } }, messages: [] });
  simulation.simulationOnly = () => false;

  const real = await api['po:ask']({ projectId: p.id, question: 'Analyze the backlog', mock: false, mode: 'plan', attachments: [], issues: [] });
  assert.equal(real.message.text, 'A real answer.');
  assert.equal(shown.length, 1);
  assert.equal(shown[0].kind, 'po');
  assert.match(shown[0].title, /The Product Owner answered/);
  // the notification center (ctx.notify) stamps its own row id onto the target; the rest is productOwnerNotice's
  assert.equal(shown[0].target.view, 'backlog');
  assert.equal(shown[0].target.projectId, p.id);
  assert.equal(shown[0].target.openPO, true);
});

test('po:ask: MULTIAGENT_SIMULATION_ONLY forces the simulated path (no notice) even when the caller did not ask for a mock', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1], 'po-notify-forced');
  const shown = [];
  service.events.on('notify', (n) => shown.push(n));

  // mock: false, but this process always runs with MULTIAGENT_SIMULATION_ONLY=1 (see helpers.makeService)
  const out = await api['po:ask']({ projectId: p.id, question: 'Analyze the backlog', mock: false, mode: 'plan', attachments: [], issues: [] });
  assert.ok(out.message);
  assert.deepEqual(shown, []);
});
