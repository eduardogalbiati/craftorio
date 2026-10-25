// src/service/channels/product-owner.js: po:ask (#149) notifies the bell for a real answer, never
// for a simulated one (the drawer's avatar dot is enough for that). The test workspace always runs
// with MULTIAGENT_SIMULATION_ONLY=1 (see docs/agents/testing.md), so a "real" answer is exercised by
// stubbing src/domains/po/product-owner.js's own ask() and forcing simulation.simulationOnly() false just for
// that call: no model or CLI is ever started here.
// Live progress (#180): po:ask's turn is pushed on chat:progress and chat:cancel stops it; mockSteps'
// delays are scaled down (like the mock provider) so these tests stay fast.
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const productOwner = require('../../src/domains/po/product-owner');
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

// ---- #189: the drawer's per-question calibration override reaches productOwner.ask -----------------

test('po:ask passes `calibration` through to productOwner.ask (null when the caller sends none)', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1], 'po-calibration');
  const realAsk = productOwner.ask;
  const calls = [];
  t.after(() => { productOwner.ask = realAsk; });
  productOwner.ask = async (opts) => { calls.push(opts.calibration); return { message: { role: 'po', text: 'ok', answer: { summary: 'ok', groups: [] } }, messages: [] }; };

  await api['po:ask']({ projectId: p.id, question: 'Plan this one for quality', mock: true, mode: 'plan', attachments: [], issues: [], calibration: 5 });
  assert.equal(calls[0], 5);

  await api['po:ask']({ projectId: p.id, question: 'Analyze the backlog', mock: true, mode: 'plan', attachments: [], issues: [] });
  assert.equal(calls[1], null);
});

// ---- #180: live progress (chat:progress, chat:cancel) --------------------------------------------

test('po:ask (mock): the turn streams chat:progress start/items/end for chat "po" keyed by the project id', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1], 'po-progress');
  const events = [];
  service.events.on('chat:progress', (ev) => events.push(ev));

  await api['po:ask']({ projectId: p.id, question: 'Analyze the backlog', mock: true, mode: 'plan', attachments: [], issues: [] });

  assert.equal(events[0].phase, 'start');
  assert.equal(events[0].chat, 'po');
  assert.equal(events[0].key, p.id);
  assert.equal(events.at(-1).phase, 'end');
  assert.equal(events.at(-1).status, 'done');
  assert.ok(events.some((e) => e.phase === 'items' && e.items.some((it) => it.kind === 'tool_call')));
});

test('chat:cancel(\'po\', projectId) stops a po:ask turn in flight: the answer is kept, marked stopped, raises no notice, and chat:progress ends "stopped"', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1, 2], 'po-cancel');
  const shown = [];
  service.events.on('notify', (n) => shown.push(n));
  const events = [];
  service.events.on('chat:progress', (ev) => events.push(ev));

  // the turn's AbortController is wired synchronously, before productOwner.ask's first real wait
  // (src/domains/chat/chat-progress.js's mockSteps): cancelling right after the call races it early, not at the end
  const asking = api['po:ask']({ projectId: p.id, question: 'Analyze the backlog', mock: true, mode: 'plan', attachments: [], issues: [] });
  assert.equal(await api['chat:cancel']({ chat: 'po', key: p.id }), true);

  const out = await asking;
  assert.equal(out.message.stopped, true);
  assert.deepEqual(shown, []); // a stopped answer raises no `po` notice
  assert.equal(events.at(-1).phase, 'end');
  assert.equal(events.at(-1).status, 'stopped');
});
