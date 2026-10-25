// Releases (#260), back to discovery: shipping marks the discovery cards linked to one of the
// release's issues Released in the card store (`releaseCards`, src/domains/releases/releases.js). The store here is
// an in-memory one with the card API of src/domains/discovery/discovery.js (#256): `listCards(dir, projectId)` and
// `updateCard(dir, projectId, id, fields)`, which merges `links` into the card's.
const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseCards } = require('../src/domains/releases/releases');

const DIR = 'discovery';

function cardStore(cards) {
  const calls = [];
  return {
    calls,
    cards,
    listCards: (dir, projectId) => {
      calls.push(['listCards', dir, projectId]);
      return cards.map((c) => ({ ...c, links: c.links && { ...c.links } }));
    },
    updateCard: (dir, projectId, id, fields) => {
      calls.push(['updateCard', dir, projectId, id, fields]);
      const card = cards.find((c) => c.id === id);
      if (!card) throw new Error(`Card not found: ${id}`);
      card.links = { ...card.links, ...fields.links };
      return card;
    },
  };
}

test('releaseCards: the cards linked to one of the release\'s issues get its version; the others stay (#260)', () => {
  const store = cardStore([
    { id: '20261001-00a1', title: 'Health checks', links: { issues: [12, 20], release: null } },
    { id: '20261001-00b2', title: 'Refunds', links: { issues: [13], release: null } },
    { id: '20261001-00c3', title: 'Queue', links: { issues: ['14'], release: null } },
    { id: '20261001-00d4', title: 'Idea', links: { issues: [], release: null } },
    { id: '20261001-00e5', title: 'An older card without links' },
  ]);

  const marked = releaseCards(store, DIR, 'shop', { version: 'v1.2.0', issues: [12, 14] });

  assert.deepEqual(marked, ['20261001-00a1', '20261001-00c3']);
  assert.deepEqual(store.cards.map((c) => c.links?.release ?? null), ['v1.2.0', null, 'v1.2.0', null, null]);
  assert.deepEqual(store.cards[0].links.issues, [12, 20], 'the card\'s issues are kept');
  assert.deepEqual(store.calls[0], ['listCards', DIR, 'shop']);
  assert.deepEqual(store.calls.filter((c) => c[0] === 'updateCard').map((c) => c.slice(1)), [
    [DIR, 'shop', '20261001-00a1', { links: { release: 'v1.2.0' } }],
    [DIR, 'shop', '20261001-00c3', { links: { release: 'v1.2.0' } }],
  ]);
});

test('releaseCards: a card already released keeps its first release; marking again writes nothing (#260)', () => {
  const store = cardStore([
    { id: '20261001-00a1', title: 'Health checks', links: { issues: [12], release: 'v1.1.0' } },
    { id: '20261001-00b2', title: 'Refunds', links: { issues: [12, 13], release: null } },
  ]);

  assert.deepEqual(releaseCards(store, DIR, 'shop', { version: 'v1.2.0', issues: [12] }), ['20261001-00b2']);
  assert.deepEqual(store.cards.map((c) => c.links.release), ['v1.1.0', 'v1.2.0']);
  assert.deepEqual(releaseCards(store, DIR, 'shop', { version: 'v1.2.0', issues: [12] }), [], 'settled again: nothing left to mark');
  assert.equal(store.calls.filter((c) => c[0] === 'updateCard').length, 1);
});

test('releaseCards: a release without issues or without a version marks no card (#260)', () => {
  const store = cardStore([{ id: '20261001-00a1', title: 'Health checks', links: { issues: [12], release: null } }]);
  assert.deepEqual(releaseCards(store, DIR, 'shop', { version: 'v1.2.0', issues: [] }), []);
  assert.deepEqual(releaseCards(store, DIR, 'shop', { version: '', issues: [12] }), []);
  assert.equal(store.cards[0].links.release, null);
});
