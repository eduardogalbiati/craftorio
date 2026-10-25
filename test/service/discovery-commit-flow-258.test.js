// #258 Commit a discovery card through the service, simulated (MULTIAGENT_SIMULATION_ONLY, as the
// E2E scenarios run it): discovery:commit-proposal answers with the split by the rules (no model),
// discovery:commit files it into the workspace's synced backlog (no gh), the board lists the card as
// committed and backlog:get shows the new issues with the card; discovery:create links new learning.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const discovery = require('../../src/domains/discovery/discovery');
const { makeService } = require('./helpers');

const REPO = 'https://github.com/o/r';

async function project(t, api, ws, { synced = true } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-commit-flow-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  if (synced) {
    fs.mkdirSync(ws.backlog, { recursive: true });
    const issue = { number: 7, title: 'Issue 7', state: 'open', url: `${REPO}/issues/7`, body: '', labels: [], assignees: [], tasks: { done: 0, total: 0 } };
    fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: REPO, issues: [issue] }));
  }
  return p.id;
}

function readyCard(dir, projectId, { score = 90 } = {}) {
  const card = discovery.createCard(dir, projectId, { title: 'Export runs as CSV', text: 'The runs table cannot be exported.' });
  discovery.updateCard(dir, projectId, card.id, { acceptance: '- [ ] Add the CSV writer\n- [ ] Add the Export button', clarity: { score, gaps: score < 85 ? ['Who reads the file'] : [] } });
  discovery.moveCard(dir, projectId, card.id, 'ready', score >= 85 ? { by: 'tester' } : { by: 'tester', force: true, reason: 'Needed for the test' });
  return card.id;
}

test('simulated: the proposal is the split by the rules, and committing it files the issues into the synced backlog', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const projectId = await project(t, api, ws);
  const cardId = readyCard(ws.discovery, projectId);

  const proposal = await api['discovery:commit-proposal']({ projectId, cardId });
  assert.equal(proposal.model, 'simulated');
  assert.equal(proposal.costUsd, 0);
  assert.deepEqual(proposal.split.issues.map((i) => ({ title: i.title, tasks: i.tasks })), [{ title: 'Export runs as CSV', tasks: ['Add the CSV writer', 'Add the Export button'] }]);
  assert.ok(proposal.split.issues[0].workflow, 'the proposal names a workflow');

  const out = await api['discovery:commit']({ projectId, cardId, split: proposal.split });
  assert.equal(out.simulated, true);
  assert.deepEqual(out.issues.map((i) => i.number), [8]);
  assert.equal(out.card.column, 'committed');

  const board = await api['discovery:board']({ projectId });
  assert.deepEqual(board.order.ready, []);
  assert.deepEqual(board.committed.map((c) => [c.id, c.delivery.stage, { ...c.delivery.counts }]), [[cardId, 'in_delivery', { todo: 1, running: 0, local: 0, done: 0 }]]);
  assert.equal(board.committed[0].delivery.issues[0].title, 'Export runs as CSV');

  const data = await api['backlog:get']({ projectId });
  const filed = data.issues.find((i) => i.number === 8);
  assert.deepEqual({ ...filed.discoveryCard }, { id: cardId, title: 'Export runs as CSV' });
  assert.equal(filed.column, 'todo');
  assert.equal(data.issues.find((i) => i.number === 7).discoveryCard ?? null, null);

  // the committed card never moves again, through the channels either
  assert.throws(() => api['discovery:move']({ projectId, cardId, column: 'ready' }), /committed/i);
  assert.throws(() => api['discovery:move-anyway']({ projectId, cardId, reason: 'Changed my mind' }), /committed/i);
  await assert.rejects(async () => api['discovery:commit']({ projectId, cardId, split: proposal.split }), /already committed/);
});

test('a card whose issues are being filed is not committed a second time', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const projectId = await project(t, api, ws);
  const cardId = readyCard(ws.discovery, projectId);
  const split = { issues: [{ title: 'One', tasks: ['A'] }] };
  const first = api['discovery:commit']({ projectId, cardId, split });
  await assert.rejects(async () => api['discovery:commit']({ projectId, cardId, split }), /being committed/);
  assert.deepEqual((await first).issues.map((i) => i.number), [8]);
  const data = await api['backlog:get']({ projectId });
  assert.deepEqual(data.issues.map((i) => i.number).sort((a, b) => a - b), [7, 8], 'one issue was filed, not two');
});

test('discovery:commit-proposal refuses like the commit: under 85%, and without a synced backlog', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const projectId = await project(t, api, ws, { synced: false });
  const low = readyCard(ws.discovery, projectId, { score: 70 });
  await assert.rejects(async () => api['discovery:commit-proposal']({ projectId, cardId: low }), /85%.*Who reads the file/);
  const clear = readyCard(ws.discovery, projectId);
  await assert.rejects(async () => api['discovery:commit-proposal']({ projectId, cardId: clear }), /Sync the backlog first/);
  await assert.rejects(async () => api['discovery:commit']({ projectId, cardId: clear, split: { issues: [{ title: 'One', tasks: ['A'] }] } }), /Sync the backlog first/);
  assert.equal(discovery.readCard(ws.discovery, projectId, clear).column, 'ready');
});

test('discovery:create links a new card to the committed card it was learned from', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const projectId = await project(t, api, ws);
  const cardId = readyCard(ws.discovery, projectId);
  await api['discovery:commit']({ projectId, cardId, split: { issues: [{ title: 'One', tasks: ['A'] }] } });
  const learned = await api['discovery:create']({ projectId, title: 'Export the costs too', text: '', type: 'idea', from: cardId });
  assert.equal(learned.column, 'inbox');
  assert.equal(learned.links.from, cardId);
  assert.equal((await api['discovery:create']({ projectId, title: 'Unrelated' })).links.from, undefined);
});
