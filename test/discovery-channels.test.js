// #256 Discovery channels (src/service/channels/discovery.js, found by src/service/manifest.js like
// every channel file): the Inbox screen reaches the store (src/discovery.js) through these, each
// on the workspace's discovery folder (layout().discovery). The contract assumed here, channel →
// window.api method (params):
//   discovery:list                → listDiscoveryCards (projectId, column)
//   discovery:get                 → getDiscoveryCard (projectId, cardId)
//   discovery:create              → createDiscoveryCard (projectId, title, text, type)
//   discovery:update              → updateDiscoveryCard (projectId, cardId, fields)
//   discovery:move                → moveDiscoveryCard (projectId, cardId, column)
//   discovery:add-attachment      → addDiscoveryAttachment (projectId, cardId, path, name, data)
//   discovery:remove-attachment   → removeDiscoveryAttachment (projectId, cardId, name)
//   discovery:conversation        → discoveryConversation (projectId, cardId)
//   discovery:append-conversation → appendDiscoveryConversation (projectId, cardId, entry)
//   discovery:archive             → archiveDiscoveryCard (projectId, cardId, reason)
//   discovery:restore             → restoreDiscoveryCard (projectId, cardId)
//   discovery:merge               → mergeDiscoveryCard (projectId, cardId, intoId)
// The channel file is new, so nothing here requires it directly: the service lists it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupWorkspace } = require('../src/workspace');
const { createService } = require('../src/service');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-channels-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeService(t) {
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, userDataDir: tmp(t) } });
  t.after(() => service.shutdown());
  const root = tmp(t);
  const ws = setupWorkspace(root, { persist: false });
  service.setWorkspace(ws);
  return { service, root, discovery: path.join(root, 'discovery') };
}

const EXPECTED = {
  'discovery:list': 'listDiscoveryCards',
  'discovery:get': 'getDiscoveryCard',
  'discovery:create': 'createDiscoveryCard',
  'discovery:update': 'updateDiscoveryCard',
  'discovery:move': 'moveDiscoveryCard',
  'discovery:add-attachment': 'addDiscoveryAttachment',
  'discovery:remove-attachment': 'removeDiscoveryAttachment',
  'discovery:conversation': 'discoveryConversation',
  'discovery:append-conversation': 'appendDiscoveryConversation',
  'discovery:archive': 'archiveDiscoveryCard',
  'discovery:restore': 'restoreDiscoveryCard',
  'discovery:merge': 'mergeDiscoveryCard',
};

test('the manifest declares the discovery: channels with their window.api methods', (t) => {
  const { service } = makeService(t);
  const byChannel = Object.fromEntries(service.manifest.filter((e) => e.channel).map((e) => [e.channel, e.method]));
  for (const [channel, method] of Object.entries(EXPECTED)) {
    assert.equal(byChannel[channel], method, `${channel} → ${method}`);
  }
});

test('quick capture through the channels: create an idea in the Inbox, attach a pasted file, list it with its attachment', async (t) => {
  const { service, discovery } = makeService(t);
  const card = await service.api['discovery:create']({ projectId: 'p1', title: 'Dark mode', text: 'Please.' });
  assert.equal(card.type, 'idea');
  assert.equal(card.column, 'inbox');
  assert.ok(fs.existsSync(path.join(discovery, 'p1', 'cards', card.id, 'card.json')), 'written under <workspace>/discovery');
  const name = await service.api['discovery:add-attachment']({ projectId: 'p1', cardId: card.id, name: 'shot.png', data: Buffer.from('png').toString('base64') });
  assert.equal(fs.readFileSync(path.join(discovery, 'p1', 'cards', card.id, 'attachments', name), 'utf8'), 'png');
  const list = await service.api['discovery:list']({ projectId: 'p1', column: 'inbox' });
  assert.deepEqual(list.map((c) => c.id), [card.id]);
  assert.equal(list[0].attachments.length, 1);
  const got = await service.api['discovery:get']({ projectId: 'p1', cardId: card.id });
  assert.equal(got.document, 'Please.');
});

test('triage through the channels: Accept moves to triage, Discard archives with the reason, Merge archives the source into the target', async (t) => {
  const { service } = makeService(t);
  const api = service.api;
  const a = await api['discovery:create']({ projectId: 'p1', title: 'A', text: 'A text' });
  const b = await api['discovery:create']({ projectId: 'p1', title: 'B', text: 'B text' });
  const c = await api['discovery:create']({ projectId: 'p1', title: 'C', text: 'C text' });

  const accepted = await api['discovery:move']({ projectId: 'p1', cardId: a.id, column: 'triage' });
  assert.equal(accepted.column, 'triage');

  await api['discovery:archive']({ projectId: 'p1', cardId: b.id, reason: 'out of scope' });
  await api['discovery:merge']({ projectId: 'p1', cardId: c.id, intoId: a.id });

  const left = await api['discovery:list']({ projectId: 'p1' });
  assert.deepEqual(left.map((x) => x.id), [a.id]);
  const merged = await api['discovery:get']({ projectId: 'p1', cardId: a.id });
  assert.match(merged.document, /C text/);

  await api['discovery:restore']({ projectId: 'p1', cardId: b.id });
  assert.deepEqual((await api['discovery:list']({ projectId: 'p1', column: 'inbox' })).map((x) => x.id), [b.id]);
});

test('a channel refuses a project or card id that is a path', async (t) => {
  const { service } = makeService(t);
  assert.equal(typeof service.api['discovery:create'], 'function', 'discovery:create is not a channel');
  assert.equal(typeof service.api['discovery:get'], 'function', 'discovery:get is not a channel');
  await assert.rejects(async () => service.api['discovery:create']({ projectId: '../x', title: 'x', text: '' }));
  await assert.rejects(async () => service.api['discovery:get']({ projectId: 'p1', cardId: '..\\..\\settings' }));
});
