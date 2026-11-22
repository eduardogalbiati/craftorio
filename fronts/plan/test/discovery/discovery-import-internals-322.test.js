// #322 Backlog import, internals beyond the acceptance tests (test/discovery-import-322.test.js):
// the store's batch recovery (discovery.finishImports: a complete batch left by a closed app is
// finished, an incomplete one is dropped unless a live process is writing it), the splitter's
// document title, code fences and top-level checkbox lists, merges of several items into one card,
// and the discovery:import-* channels.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const discovery = require('@craftorio/engine/domains/discovery/discovery');
const imports = require('@craftorio/engine/fronts/plan/domains/discovery-import');
const { setupWorkspace } = require('@craftorio/engine/domains/workspace/workspace');
const { createService } = require('@craftorio/engine/service');

const P = 'p1';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-import-internals-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// A batch as importCards leaves it when the app closes: one card staged under imports/<name>/cards/.
function stageBatch(t, dir, name, { complete }) {
  const other = path.join(tmp(t), 'discovery');
  const card = discovery.createCard(other, P, { title: 'Staged card', text: 'staged' });
  const batch = path.join(dir, P, 'imports', name);
  fs.mkdirSync(path.join(batch, 'cards'), { recursive: true });
  fs.cpSync(path.join(other, P, 'cards', card.id), path.join(batch, 'cards', card.id), { recursive: true });
  if (complete) fs.writeFileSync(path.join(batch, 'commit.json'), JSON.stringify({ ids: [card.id], merges: [], column: 'inbox', by: 'import' }));
  return { id: card.id, batch };
}

test('finishImports finishes a complete batch a closed app left: the card is in cards/ and first in the Inbox', (t) => {
  const dir = path.join(tmp(t), 'discovery');
  const existing = discovery.createCard(dir, P, { title: 'Existing' });
  const { id, batch } = stageBatch(t, dir, '1-abcd-999999999', { complete: true });
  assert.equal(discovery.finishImports(dir, P), 1);
  assert.equal(discovery.readCard(dir, P, id).title, 'Staged card');
  assert.deepEqual(discovery.readBoard(dir, P).order.inbox, [id, existing.id]);
  assert.equal(fs.existsSync(batch), false);
});

test('finishImports drops an incomplete batch of a process that is gone, and keeps one this process is writing', (t) => {
  const dir = path.join(tmp(t), 'discovery');
  discovery.createCard(dir, P, { title: 'Existing' });
  const dead = stageBatch(t, dir, '1-abcd-999999999', { complete: false });
  const live = stageBatch(t, dir, `2-abcd-${process.pid}`, { complete: false });
  assert.equal(discovery.finishImports(dir, P), 0);
  assert.equal(fs.existsSync(dead.batch), false);
  assert.equal(fs.existsSync(live.batch), true);
  assert.deepEqual(discovery.listCards(dir, P).map((c) => c.title), ['Existing']);
});

test('importItems leaves no imports/ batch behind', (t) => {
  const dir = path.join(tmp(t), 'discovery');
  imports.importItems(dir, P, [{ title: 'A', text: '', acceptance: [] }], { source: { name: 'b.md', data: '- A\n' } });
  assert.deepEqual(fs.readdirSync(path.join(dir, P, 'imports')), []);
});

test('splitDocument takes a lone top heading over deeper ones as the document title', () => {
  const { items, note } = imports.splitDocument('# Backlog\nOur ideas.\n\n## Export runs\nAs CSV.\n## Dark mode\n', { name: 'BACKLOG.md' });
  assert.deepEqual(items.map((i) => i.title), ['Export runs', 'Dark mode']);
  assert.match(note, /Backlog/);
  assert.match(note, /before the first item/);
});

test('splitDocument reads code fences as text: no heading, no criterion inside them', () => {
  const { items } = imports.splitDocument('# Export runs\n```\n# not a heading\n- [ ] not a criterion\n```\n- [ ] A real one\n');
  assert.deepEqual(items.map((i) => i.title), ['Export runs']);
  assert.deepEqual(items[0].acceptance, ['A real one']);
  assert.ok(items[0].text.includes('# not a heading'));
  assert.ok(items[0].text.includes('- [ ] not a criterion'));
});

test('splitDocument of a task list makes each top-level checkbox an item and the nested ones its criteria', () => {
  const { items } = imports.splitDocument('- [ ] Export runs\n  - [ ] One row per run\n- [x] Dark mode\n');
  assert.deepEqual(items.map((i) => i.title), ['Export runs', 'Dark mode']);
  assert.deepEqual(items.map((i) => i.acceptance), [['One row per run'], []]);
});

test('splitDocument reads a long line of spaces in linear time and drops closing #s of a heading', () => {
  const started = Date.now();
  const { items } = imports.splitDocument(`# Export runs ##\n- a${' '.repeat(200000)}x\n#${' '.repeat(200000)}y\n`);
  assert.ok(Date.now() - started < 2000, 'split in under 2 s');
  assert.deepEqual(items.map((i) => i.title), ['Export runs', 'y']);
});

test('importItems merges two items into the same card, both texts and criteria kept', (t) => {
  const dir = path.join(tmp(t), 'discovery');
  const card = discovery.createCard(dir, P, { title: 'Export runs', text: 'Original.' });
  const items = [
    { title: 'Export runs', text: 'First text.', acceptance: ['First criterion'], action: 'merge', into: card.id },
    { title: 'Export runs too', text: 'Second text.', acceptance: ['Second criterion'], action: 'merge', into: card.id },
  ];
  const out = imports.importItems(dir, P, items, { source: { pasted: true } });
  assert.deepEqual(out.merged, [card.id]);
  const merged = discovery.readCard(dir, P, card.id);
  for (const s of ['Original.', 'First text.', 'Second text.']) assert.ok(merged.document.includes(s), s);
  assert.ok(merged.acceptance.includes('First criterion') && merged.acceptance.includes('Second criterion'));
  assert.ok(discovery.readConversation(dir, P, card.id).some((e) => e.kind === 'import'));
});

test('applyEdit refuses an unknown edit and an item joined with itself', () => {
  const items = [{ title: 'A', text: '', acceptance: [] }, { title: 'B', text: '', acceptance: [] }];
  assert.throws(() => imports.applyEdit(items, { op: 'split', index: 0 }), /Unknown/);
  assert.throws(() => imports.applyEdit(items, { op: 'merge', index: 0, to: 0 }), /itself/);
  assert.throws(() => imports.applyEdit(items, { op: 'drop', index: 5 }), /No item/);
});

test('the discovery:import-* channels split, edit and import a document into cards with the file attached', async (t) => {
  process.env.CRAFTORIO_SIMULATION_ONLY = '1'; // tests never call real models
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, userDataDir: tmp(t) } });
  t.after(() => service.shutdown());
  service.setWorkspace(setupWorkspace(tmp(t), { persist: false }));
  const byChannel = Object.fromEntries(service.manifest.filter((e) => e.channel).map((e) => [e.channel, e.method]));
  assert.equal(byChannel['discovery:import-split'], 'splitDiscoveryImport');
  assert.equal(byChannel['discovery:import-edit'], 'editDiscoveryImport');
  assert.equal(byChannel['discovery:import'], 'importDiscoveryItems');
  const { api } = service;
  const text = '# Export runs\nAs CSV.\n- [ ] One row per run\n# Dark mode\n';
  const split = await api['discovery:import-split']({ projectId: P, text, name: 'BACKLOG.md' });
  assert.deepEqual(split.items.map((i) => i.title), ['Export runs', 'Dark mode']);
  assert.equal(typeof split.items[0].clarity, 'number');
  const edited = await api['discovery:import-edit']({ projectId: P, items: split.items, edit: { op: 'rename', index: 1, title: 'Dark mode for the log' } });
  assert.deepEqual(edited.map((i) => i.title), ['Export runs', 'Dark mode for the log']);
  const done = await api['discovery:import']({ projectId: P, items: edited, source: { name: 'BACKLOG.md', text } });
  assert.equal(done.created.length, 2);
  const listed = await api['discovery:list']({ projectId: P, column: 'inbox' });
  assert.deepEqual(listed.map((c) => c.title), ['Export runs', 'Dark mode for the log']);
  assert.ok(listed.every((c) => c.attachments.includes('BACKLOG.md')));
});
