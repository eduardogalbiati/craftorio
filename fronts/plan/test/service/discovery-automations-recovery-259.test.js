// #259 Column automations through the service, beyond the acceptance flow: a card left 'running' by a
// previous session of the app is settled when the board is read (its pipeline's result recovered from
// the run folders, a run that is gone or a chain that stopped ends it as failed), a second start while
// one runs is refused, and Ready's clarity check (no run) answers a move-anyway too. Simulated only
// (MULTIAGENT_SIMULATION_ONLY); the run folders of the restart cases are written by hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('@craftorio/engine/test/service/helpers');
const discovery = require('@craftorio/engine/domains/discovery/discovery');

async function project(t, api) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-auto-recovery-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return (await api['projects:create']({ name: 'demo', folder })).id;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
async function idle(service, ms = 60000) {
  const end = Date.now() + ms;
  while (service.api['runs:active']().length && Date.now() < end) await settle(50);
  assert.deepEqual(service.api['runs:active']().map((r) => r.runId), [], 'the automation run ended');
}

// a finished run folder: summary.json (status, cost, outputs, then) and, with `chain`, chain.json
function finishedRun(service, runId, { status = 'success', costUsd = 0, outputs = null, then = null, chain = null } = {}) {
  const dir = path.join(service.workspace().runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  const at = '2026-10-12T00:00:00.000Z';
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    workflow: 'stage', status, started_at: at, finished_at: at, duration_ms: 1, sessions: [{ cost_usd: costUsd }], outputs, then,
  }));
  if (chain) fs.writeFileSync(path.join(dir, 'chain.json'), JSON.stringify(chain));
}

// a Shape card the previous session left running on `runId`
function runningCard(service, projectId, runId) {
  const dir = service.workspace().discovery;
  const card = discovery.createCard(dir, projectId, { title: 'Export runs as CSV', text: 'The original text.', column: 'shape' });
  discovery.markAutomation(dir, projectId, card.id, { runId, name: 'AI Arena → Write & Review', column: 'shape' });
  return card.id;
}

const NEXT = { action: 'workflow', workflow: 'write-review.yaml' };

test('after a restart, a pipeline that ended meanwhile brings its document and cost back to the card', async (t) => {
  const { service, api } = makeService(t);
  const projectId = await project(t, api);
  finishedRun(service, '20261012-000001-aaaaaaa1', { costUsd: 0.1, outputs: { document: 'First stage.' }, then: NEXT, chain: { state: 'started', nextRunId: '20261012-000002-aaaaaaa2' } });
  finishedRun(service, '20261012-000002-aaaaaaa2', { costUsd: 0.25, outputs: { document: '# Recovered\n\nThe shaped document.' } });
  const cardId = runningCard(service, projectId, '20261012-000001-aaaaaaa1');

  await api['discovery:board']({ projectId });
  const card = await api['discovery:get']({ projectId, cardId });
  assert.equal(card.automation.state, 'done');
  assert.match(card.document, /The shaped document\./);
  const entry = (await api['discovery:conversation']({ projectId, cardId })).find((e) => e.kind === 'automation');
  assert.equal(entry.runId, '20261012-000001-aaaaaaa1');
  assert.ok(Math.abs(entry.costUsd - 0.35) < 1e-9, `the cost of both stages (${entry.costUsd})`);
});

test('after a restart, a run that is gone ends the automation as failed and leaves the document', async (t) => {
  const { service, api } = makeService(t);
  const projectId = await project(t, api);
  const cardId = runningCard(service, projectId, '20261012-000009-gone0000');

  await api['discovery:board']({ projectId });
  const card = await api['discovery:get']({ projectId, cardId });
  assert.equal(card.automation.state, 'failed');
  assert.match(card.document, /The original text\./);
  const entry = (await api['discovery:conversation']({ projectId, cardId })).find((e) => e.kind === 'automation');
  assert.equal(entry.status, 'interrupted');
});

test('after a restart, a failed stage or a paused chain ends the automation as failed, the document unchanged', async (t) => {
  const { service, api } = makeService(t);
  const projectId = await project(t, api);
  finishedRun(service, '20261012-000003-bbbbbbb1', { status: 'failed' });
  finishedRun(service, '20261012-000004-bbbbbbb2', { outputs: { document: 'Half done.' }, then: NEXT, chain: { state: 'paused', reason: 'budget' } });
  const failed = runningCard(service, projectId, '20261012-000003-bbbbbbb1');
  const paused = runningCard(service, projectId, '20261012-000004-bbbbbbb2');

  await api['discovery:board']({ projectId });
  for (const cardId of [failed, paused]) {
    const card = await api['discovery:get']({ projectId, cardId });
    assert.equal(card.automation.state, 'failed');
    assert.match(card.document, /The original text\./);
  }
  const entry = (await api['discovery:conversation']({ projectId, cardId: paused })).find((e) => e.kind === 'automation');
  assert.equal(entry.status, 'paused');
});

test('a second start while the card\'s automation runs is refused', async (t) => {
  const { service, api } = makeService(t);
  const projectId = await project(t, api);
  const card = discovery.createCard(service.workspace().discovery, projectId, { title: 'Export runs as CSV', text: 'x', column: 'triage' });
  await api['discovery:move']({ projectId, cardId: card.id, column: 'shape' });
  const [first, second] = await Promise.allSettled([
    api['discovery:run-automation']({ projectId, cardId: card.id, column: 'shape' }),
    api['discovery:run-automation']({ projectId, cardId: card.id, column: 'shape' }),
  ]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(second.status, 'rejected');
  await assert.rejects(async () => api['discovery:run-automation']({ projectId, cardId: card.id, column: 'shape' }), /already running/);
  await idle(service);
});

test('a move-anyway into Ready proposes the clarity check, which calls no model', async (t) => {
  const { service, api } = makeService(t);
  const projectId = await project(t, api);
  const card = discovery.createCard(service.workspace().discovery, projectId, { title: 'Vague idea', text: 'Something.', column: 'define' });
  const out = await api['discovery:move-anyway']({ projectId, cardId: card.id, reason: 'the owner knows it well' });
  assert.equal(out.column, 'ready');
  assert.equal(out.automation?.status, 'proposed');
  assert.equal(out.automation.kind, 'check');
  assert.equal(out.automation.estimate.costUsd, 0);
});

test('Ready\'s clarity check on: the move asks the next open point in the thread and starts no run', async (t) => {
  const { service, api } = makeService(t);
  const projectId = await project(t, api);
  await api['discovery:set-automation']({ projectId, column: 'ready', mode: 'on' });
  const card = discovery.createCard(service.workspace().discovery, projectId, { title: 'Vague idea', text: 'Something.', column: 'define' });
  const seen = new Set();
  service.events.on('run:event', (ev) => { if (ev.run_id) seen.add(ev.run_id); });
  const out = await api['discovery:move-anyway']({ projectId, cardId: card.id, reason: 'the owner knows it well' });
  assert.equal(out.automation?.status, 'done');
  assert.equal(out.automation.runId, null);
  assert.equal(out.automation.question?.kind, 'question', 'the open point asked in the thread');
  const thread = await api['discovery:conversation']({ projectId, cardId: card.id });
  assert.equal(thread.filter((e) => e.kind === 'question').length, 1, 'the question waits for the person, unanswered');
  await settle(200);
  assert.equal(seen.size, 0, 'no run started');
  assert.equal((await api['discovery:get']({ projectId, cardId: card.id })).column, 'ready', 'the card waits in Ready for the person');
});
