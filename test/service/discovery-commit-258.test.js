// #258 Commit a discovery card to the backlog, through the service: the discovery:commit channel
// (window.api commitDiscoveryCard) refuses a card under the 85% bar; discovery:board lists the
// committed cards with their delivery (src/discovery-commit.js cardDelivery); backlog:get marks the
// issues filed from a discovery card with `discoveryCard: { id, title }` (the Backlog's badge).
// The simulation is on: a successful filing is tested at the store level
// (test/discovery-commit-258.test.js); here the card is committed with a stubbed gh before the
// service reads it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const discovery = require('../../src/discovery');
const { makeService } = require('./helpers');

const load = () => require('../../src/discovery-commit');
const REPO = 'https://github.com/o/r';

const backlogIssue = (number, state) => ({ number, title: `Issue ${number}`, state, url: `${REPO}/issues/${number}`, body: '', labels: [], assignees: [], tasks: { done: 0, total: 0 } });

// A project with a synced backlog (#101 closed, #102 open), and its discovery folder.
async function project(t, api, ws) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-commit-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: REPO, issues: [backlogIssue(101, 'closed'), backlogIssue(102, 'open'), backlogIssue(103, 'open')] }));
  return p.id;
}

function readyCard(dir, projectId, { title = 'Export runs as CSV', score = 90, gaps = [] } = {}) {
  const card = discovery.createCard(dir, projectId, { title, text: 'The runs table cannot be exported.' });
  discovery.updateCard(dir, projectId, card.id, { clarity: { score, gaps } });
  discovery.moveCard(dir, projectId, card.id, 'ready', score >= 85 ? { by: 'tester' } : { by: 'tester', force: true, reason: 'Needed for the test' });
  return card.id;
}

// Commits the card at the store level with a gh stub filing #101 and #102.
async function commitWithStub(dir, projectId, cardId) {
  let next = 100;
  const exec = async (_cli, args) => {
    if (args[0] === 'issue' && args[1] === 'create') { next += 1; return `${REPO}/issues/${next}\n`; }
    return args[0] === 'label' ? '[]' : '';
  };
  const split = { issues: [{ title: 'Export the runs table', tasks: ['Add the CSV writer'], complexity: 2, workflow: 'software-development.yaml' }, { title: 'Document the export', tasks: ['Describe the columns'], complexity: 1, workflow: 'software-development.yaml' }] };
  return load().commitCard({ dir, projectId, cardId, split, platform: 'github', repo: REPO, exec, by: 'tester' });
}

test('C. the manifest declares discovery:commit', (t) => {
  const { service } = makeService(t);
  assert.ok(service.manifest.some((e) => e.channel === 'discovery:commit'), 'no discovery:commit channel');
});

test('C. discovery:commit refuses a Ready card under 85% and names its gaps', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const projectId = await project(t, api, ws);
  const cardId = readyCard(ws.discovery, projectId, { score: 70, gaps: ['Who reads the exported file'] });
  assert.equal(typeof api['discovery:commit'], 'function', 'discovery:commit is not a channel');
  const split = { issues: [{ title: 'Export the runs table', tasks: ['Add the CSV writer'], complexity: 2, workflow: 'software-development.yaml' }] };
  await assert.rejects(async () => api['discovery:commit']({ projectId, cardId, split }), (e) => {
    assert.ok(e.message.includes('85%'), e.message);
    assert.ok(e.message.includes('Who reads the exported file'), e.message);
    return true;
  });
  const card = discovery.readCard(ws.discovery, projectId, cardId);
  assert.equal(card.column, 'ready');
  assert.deepEqual([...card.links.issues], []);
});

test('C. discovery:board lists the committed card with its delivery from the backlog (#101 done, #102 to do)', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const projectId = await project(t, api, ws);
  const cardId = readyCard(ws.discovery, projectId);
  await commitWithStub(ws.discovery, projectId, cardId);
  const board = await api['discovery:board']({ projectId });
  assert.ok(Array.isArray(board.committed), 'the board has no committed list');
  assert.deepEqual(board.committed.map((c) => c.id), [cardId]);
  const { delivery } = board.committed[0];
  assert.equal(board.committed[0].title, 'Export runs as CSV');
  assert.equal(delivery.stage, 'in_delivery');
  assert.deepEqual({ ...delivery.counts }, { todo: 1, running: 0, local: 0, done: 1 });
  assert.deepEqual(delivery.issues.map((i) => ({ number: i.number, column: i.column })), [{ number: 101, column: 'done' }, { number: 102, column: 'todo' }]);
});

test('C. backlog:get marks the issues filed from a discovery card with the card (id, title), and only those', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const projectId = await project(t, api, ws);
  const cardId = readyCard(ws.discovery, projectId);
  await commitWithStub(ws.discovery, projectId, cardId);
  const data = await api['backlog:get']({ projectId });
  const by = Object.fromEntries(data.issues.map((i) => [i.number, i]));
  assert.deepEqual({ ...by[101].discoveryCard }, { id: cardId, title: 'Export runs as CSV' });
  assert.deepEqual({ ...by[102].discoveryCard }, { id: cardId, title: 'Export runs as CSV' });
  assert.equal(by[103].discoveryCard ?? null, null);
});
