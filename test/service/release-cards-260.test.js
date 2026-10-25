// Releases (#260): settling a cut line's release run marks the discovery cards linked to its issues
// Released in the card store (src/service/areas/releases.js, markCards). The store (src/domains/discovery/discovery.js)
// comes with #256 and is not on this branch: the area's require of it is answered here by an
// in-memory store with the same card API (listCards, updateCard). A real shipped run marks the linked
// cards, a simulated one marks none, and a store that cannot write never keeps the release from being
// recorded or the line from opening.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const roadmaps = require('../../src/domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapProject, until } = require('./helpers');

// The card store the releases area loads: `store.impl` is the current test's store.
const STUB = path.join(__dirname, 'discovery-store-stub-260.js');
const store = { impl: null };
const stub = new Module(STUB);
stub.filename = STUB;
stub.loaded = true;
stub.exports = {
  listCards: (...a) => store.impl.listCards(...a),
  updateCard: (...a) => store.impl.updateCard(...a),
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === '../../domains/discovery/discovery' && parent?.filename?.endsWith(path.join('areas', 'releases.js'))) return STUB;
  return resolve.call(this, request, parent, ...rest);
};
require.cache[STUB] = stub;
test.after(() => { Module._resolveFilename = resolve; delete require.cache[STUB]; });

// In-memory cards of one project; `fail` makes every write throw.
function memoryStore(projectId, cards, { fail = false } = {}) {
  const writes = [];
  return {
    writes,
    cards,
    listCards: (dir, id) => (id === projectId ? cards.map((c) => ({ ...c, links: { ...c.links } })) : []),
    updateCard: (dir, id, cardId, patch) => {
      if (fail) throw new Error('disk full');
      const card = cards.find((c) => c.id === cardId);
      card.links = { ...card.links, ...patch.links };
      writes.push(cardId);
      return card;
    },
  };
}

// A roadmap whose first stage is done and carries the cut line v1.0, started for release run `runId`
// (ended with `summary`); the second stage waits behind the line.
async function roadmapAtLine(t, name, runId, summary) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], name);
  await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { name: 'One', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }], release: { name: 'v1.0' } },
      { name: 'Two', items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
    ],
  });
  const stage = roadmaps.readRoadmap(ws.backlog, p.id).stages[0];
  roadmaps.updateRoadmap(ws.backlog, p.id, (r) => ({ ...r, stages: r.stages.map((s) => (s.id === stage.id ? { ...s, items: s.items.map((x) => ({ ...x, status: 'done' })) } : s)) }));
  roadmaps.setRelease(ws.backlog, p.id, stage.id, { status: 'running', runId });
  fs.mkdirSync(path.join(ws.runs, runId), { recursive: true });
  fs.writeFileSync(path.join(ws.runs, runId, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'Release', project_id: p.id, mock: false, inputs: { version: 'v1.0' }, sessions: [],
    started_at: '2026-03-01T10:00:00.000Z', finished_at: '2026-03-01T10:30:00.000Z', cost_usd: 2,
    status: 'success',
    release: { tag: 'v1.0', base: 'main', commit: '0123456789abcdef0123456789abcdef01234567', pushed: true, issues: [1] },
    ...summary,
  }));
  return { api, p };
}
const hasIssue = (r, n) => (r.issues || []).some((i) => i.number === n);
const cardsOf = () => [
  { id: 'c-linked', links: { issues: [1], release: null } },
  { id: 'c-other', links: { issues: [2], release: null } },
  { id: 'c-unlinked', links: { issues: [], release: null } },
  { id: 'c-old', links: { issues: [1], release: 'v0.9' } },
];

test('a shipped real release run marks the discovery cards linked to its issues Released with its version (#260)', async (t) => {
  const { api, p } = await roadmapAtLine(t, 'release-cards-shipped', '20260301-100000-relcard1', {});
  store.impl = memoryStore(p.id, cardsOf());
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().some((r) => hasIssue(r, 2)));
  const release = Object.fromEntries(store.impl.cards.map((c) => [c.id, c.links.release]));
  assert.deepEqual(release, { 'c-linked': 'v1.0', 'c-other': null, 'c-unlinked': null, 'c-old': 'v0.9' });
  assert.deepEqual(store.impl.cards.find((c) => c.id === 'c-linked').links.issues, [1], 'the card keeps its issues');
  // settled again by a later dispatch: nothing is written again
  await api['roadmap:save']({ projectId: p.id, stages: api['roadmap:get']({ projectId: p.id }).stages });
  assert.deepEqual(store.impl.writes, ['c-linked']);
});

test('a simulated release run marks no discovery card (#260)', async (t) => {
  const { api, p } = await roadmapAtLine(t, 'release-cards-mock', '20260301-100000-relcard2', { mock: true });
  store.impl = memoryStore(p.id, cardsOf());
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['roadmap:get']({ projectId: p.id }).stages[0].release.status !== 'running');
  assert.deepEqual(store.impl.writes, []);
  assert.equal(store.impl.cards.find((c) => c.id === 'c-linked').links.release, null);
});

test('a card store that cannot write never keeps the shipped release from being recorded or its cut line from opening (#260)', async (t) => {
  const { api, p } = await roadmapAtLine(t, 'release-cards-fail', '20260301-100000-relcard3', {});
  store.impl = memoryStore(p.id, cardsOf(), { fail: true });
  t.mock.method(console, 'error', () => {});
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().some((r) => hasIssue(r, 2)));
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[0].release.status, 'shipped');
  const { releases } = api['releases:list']({ projectId: p.id });
  assert.deepEqual(releases.map((r) => [r.version, r.status]), [['v1.0', 'shipped']]);
  assert.equal(store.impl.cards.find((c) => c.id === 'c-linked').links.release, null);
});
