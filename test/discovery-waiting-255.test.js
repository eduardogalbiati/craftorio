// #255 (developer's tests): the discovery cards waiting for the owner, read by Home's "What needs you".
//   src/discovery.js listWaiting: a card waits while the last entry of its thread is a question
//   (`kind: 'question'`); a later entry (the owner's note) ends the wait; an archived card never waits.
//   discovery:waiting → listDiscoveryWaiting (projectId): the same list through the service.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const discovery = require('../src/discovery');
const { setupWorkspace } = require('../src/workspace');
const { createService } = require('../src/service');

const P = 'p1';

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-waiting-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a card waits for the owner while its thread ends with a question (#255)', (t) => {
  const dir = tmp(t);
  const asked = discovery.createCard(dir, P, { title: 'Dark mode', text: 'Please.' });
  const noted = discovery.createCard(dir, P, { title: 'CSV export' });
  discovery.createCard(dir, P, { title: 'No thread' });
  discovery.appendConversation(dir, P, asked.id, { kind: 'note', author: 'eduardo', text: 'Asked twice.' });
  discovery.appendConversation(dir, P, asked.id, { kind: 'question', author: 'grill-me', text: 'Its own switch?' });
  discovery.appendConversation(dir, P, noted.id, { kind: 'note', author: 'eduardo', text: 'Later.' });

  const waiting = discovery.listWaiting(dir, P);
  assert.deepEqual(waiting.map((c) => c.id), [asked.id]);
  assert.equal(waiting[0].title, 'Dark mode');
  assert.equal(waiting[0].column, 'inbox');
  assert.equal(waiting[0].question.author, 'grill-me');
  assert.equal(waiting[0].question.text, 'Its own switch?');
  assert.ok(Date.parse(waiting[0].question.ts), 'the question\'s time, for its age');
  assert.equal(waiting[0].document, undefined, 'no document: only what the list shows');
});

test('an answer in the thread ends the wait; an archived card never waits (#255)', (t) => {
  const dir = tmp(t);
  const answered = discovery.createCard(dir, P, { title: 'Answered' });
  const discarded = discovery.createCard(dir, P, { title: 'Discarded' });
  for (const c of [answered, discarded]) discovery.appendConversation(dir, P, c.id, { kind: 'question', author: 'grill-me', text: 'Why?' });
  assert.equal(discovery.listWaiting(dir, P).length, 2);

  discovery.appendConversation(dir, P, answered.id, { kind: 'note', author: 'eduardo', text: 'Because.' });
  discovery.archiveCard(dir, P, discarded.id, { reason: 'duplicate' });
  assert.deepEqual(discovery.listWaiting(dir, P), []);
});

test('the longest waiting question comes first (#255)', (t) => {
  const dir = tmp(t);
  const a = discovery.createCard(dir, P, { title: 'A' });
  const b = discovery.createCard(dir, P, { title: 'B' });
  discovery.appendConversation(dir, P, a.id, { kind: 'question', text: 'Newer?', ts: '2026-10-04T10:00:00.000Z' });
  discovery.appendConversation(dir, P, b.id, { kind: 'question', text: 'Older?', ts: '2026-10-03T10:00:00.000Z' });
  assert.deepEqual(discovery.listWaiting(dir, P).map((c) => c.title), ['B', 'A']);
});

test('discovery:waiting lists the waiting cards through the service; the owner\'s note takes the card off (#255)', async (t) => {
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, userDataDir: tmp(t) } });
  t.after(() => service.shutdown());
  service.setWorkspace(setupWorkspace(tmp(t), { persist: false }));
  assert.equal(service.manifest.find((e) => e.channel === 'discovery:waiting')?.method, 'listDiscoveryWaiting');

  const card = await service.api['discovery:create']({ projectId: P, title: 'Dark mode' });
  await service.api['discovery:append-conversation']({ projectId: P, cardId: card.id, entry: { kind: 'question', author: 'grill-me', text: 'Its own switch?' } });
  const waiting = await service.api['discovery:waiting']({ projectId: P });
  assert.deepEqual(waiting.map((c) => [c.id, c.question.text]), [[card.id, 'Its own switch?']]);

  await service.api['discovery:append-conversation']({ projectId: P, cardId: card.id, entry: { text: 'Follow the theme.' } });
  assert.deepEqual(await service.api['discovery:waiting']({ projectId: P }), []);
});
