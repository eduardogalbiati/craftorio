// #259 Column automations through the service, simulated (MULTIAGENT_SIMULATION_ONLY: the run uses
// the mock provider). The contract these tests assume:
//   discovery:set-automation (projectId, column, mode) → the board shows columns[].on_enter.mode
//   discovery:move → the result gains `automation`: an 'ask' column → { status: 'proposed', column,
//     estimate } and no run starts; an 'off' column → none; an 'on' column → { status: 'running', runId }
//   discovery:run-automation (projectId, cardId, column) → { runId }; while it runs the card has
//     automation { state: 'running', runId }; when it ends its output is a new version of the
//     document and a thread entry with the runId and its costUsd. An automation never commits a card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('./helpers');

const discovery = () => require('../../src/domains/discovery/discovery');

async function project(t, api) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-automations-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  return p.id;
}

function triageCard(service, projectId) {
  const card = discovery().createCard(service.workspace().discovery, projectId, { title: 'Export runs as CSV', text: 'The runs table cannot be exported.', column: 'triage' });
  return card.id;
}

// every run id the service pushes an event for
function runIds(service) {
  const ids = new Set();
  service.events.on('run:event', (ev) => { if (ev.run_id) ids.add(ev.run_id); });
  return ids;
}

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// waits for the active runs to end, with a deadline so a run that never ends fails the test
async function idle(service, ms = 60000) {
  const end = Date.now() + ms;
  while (service.api['runs:active']().length && Date.now() < end) await settle(50);
  assert.deepEqual(service.api['runs:active']().map((r) => r.runId), [], 'the automation run ended');
}

const call = (api, channel, args) => {
  assert.equal(typeof api[channel], 'function', `the ${channel} channel exists`);
  return api[channel](args);
};

test('discovery:set-automation changes a column\'s mode, shown by discovery:board', async (t) => {
  const { api } = makeService(t);
  const projectId = await project(t, api);
  await call(api, 'discovery:set-automation', { projectId, column: 'shape', mode: 'off' });
  const board = await api['discovery:board']({ projectId });
  assert.equal(board.columns.find((c) => c.id === 'shape').on_enter.mode, 'off');
  await assert.rejects(async () => api['discovery:set-automation']({ projectId, column: 'shape', mode: 'sometimes' }));
});

test('moving a card into an ask column proposes the pipeline with an estimate, and starts no run', async (t) => {
  const { service, api } = makeService(t);
  const projectId = await project(t, api);
  const cardId = triageCard(service, projectId);
  const seen = runIds(service);
  const out = await api['discovery:move']({ projectId, cardId, column: 'shape' });
  assert.equal(out.automation?.status, 'proposed');
  assert.equal(out.automation.column, 'shape');
  assert.ok('estimate' in out.automation, 'the proposal carries an estimate (null without past runs)');
  await settle();
  assert.deepEqual(api['runs:active'](), []);
  assert.equal(seen.size, 0, 'no run started');
  assert.equal(discovery().readCard(service.workspace().discovery, projectId, cardId).column, 'shape');
});

test('moving a card into an off column only moves it', async (t) => {
  const { service, api } = makeService(t);
  const projectId = await project(t, api);
  const cardId = triageCard(service, projectId);
  discovery().setColumnAutomation(service.workspace().discovery, projectId, 'shape', { mode: 'off' });
  const seen = runIds(service);
  const out = await api['discovery:move']({ projectId, cardId, column: 'shape' });
  assert.equal(out.automation ?? null, null);
  await settle();
  assert.equal(seen.size, 0, 'no run started');
  assert.equal(discovery().readCard(service.workspace().discovery, projectId, cardId).column, 'shape');
});

test('a proposed automation, run: the card shows it running, then gets a new version and a thread entry with the run and its cost', async (t) => {
  const { service, api } = makeService(t);
  const projectId = await project(t, api);
  const cardId = triageCard(service, projectId);
  await api['discovery:move']({ projectId, cardId, column: 'shape' });
  const versionsBefore = (await api['discovery:versions']({ projectId, cardId })).length;

  const { runId } = await call(api, 'discovery:run-automation', { projectId, cardId, column: 'shape' });
  assert.equal(typeof runId, 'string');
  const running = await api['discovery:get']({ projectId, cardId });
  assert.equal(running.automation?.state, 'running');
  assert.equal(running.automation.runId, runId);

  await idle(service);
  const card = await api['discovery:get']({ projectId, cardId });
  assert.notEqual(card.automation?.state, 'running');
  const versionsAfter = (await api['discovery:versions']({ projectId, cardId })).length;
  assert.ok(versionsAfter > versionsBefore, `a new version of the document (${versionsBefore} → ${versionsAfter})`);
  const entry = (await api['discovery:conversation']({ projectId, cardId })).find((e) => e.runId === runId);
  assert.ok(entry, 'the thread links the run');
  assert.equal(typeof entry.costUsd, 'number');
  assert.equal(card.column, 'shape', 'the automation never moves or commits the card');
  assert.deepEqual([...(card.links?.issues || [])], []);
});

test('moving a card into an on column starts the run directly', async (t) => {
  const { service, api } = makeService(t);
  const projectId = await project(t, api);
  const cardId = triageCard(service, projectId);
  discovery().setColumnAutomation(service.workspace().discovery, projectId, 'shape', { mode: 'on' });
  const out = await api['discovery:move']({ projectId, cardId, column: 'shape' });
  assert.equal(out.automation?.status, 'running');
  assert.equal(typeof out.automation.runId, 'string');
  await idle(service);
  const entry = (await api['discovery:conversation']({ projectId, cardId })).find((e) => e.runId === out.automation.runId);
  assert.ok(entry, 'the thread links the run');
});
