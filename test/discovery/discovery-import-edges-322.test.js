// #322 Backlog import, edges the review pointed at: very long documents (prose, list and heading
// forms, past the engine's argument-count limit), a batch a closed app left whose merge target was
// committed or archived meanwhile (the Inbox still lists), a merge into a committed card (all or
// none), and the attached source keeping the file's bytes (BOM, CRLF).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const discovery = require('../../src/domains/discovery/discovery');
const imports = require('../../src/domains/discovery/discovery-import');

const P = 'p1';
const LINES = 300000;

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-import-edges-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'discovery');
}

// A Ready card committed to the backlog (#258): forced into Ready, then committed.
function committedCard(dir, title) {
  const card = discovery.createCard(dir, P, { title, text: 'Committed text.' });
  discovery.moveCard(dir, P, card.id, 'ready', { force: true, reason: 'test' });
  discovery.markCommitted(dir, P, card.id, { issues: [7] });
  return card.id;
}

// A complete batch as importCards leaves it when the app closes before finishing: no new card,
// one merge into `into`.
function stageMergeBatch(dir, into) {
  const batch = path.join(dir, P, 'imports', '1-abcd-999999999');
  fs.mkdirSync(path.join(batch, 'cards'), { recursive: true });
  fs.writeFileSync(path.join(batch, 'commit.json'), JSON.stringify({
    ids: [], merges: [{ id: into, document: 'Merged text.\n', acceptance: '', note: 'Imported "X" from b.md into this card.' }], column: 'inbox', by: 'import',
  }));
  return batch;
}

test('splitDocument of very long prose gives one item without throwing', () => {
  const { items, structured } = imports.splitDocument('Some prose line.\n'.repeat(LINES));
  assert.equal(items.length, 1);
  assert.equal(structured, false);
});

test('splitDocument of a very long top-level list gives one item per list item', () => {
  const text = Array.from({ length: LINES }, (_, i) => `- Item ${i + 1}`).join('\n');
  const { items } = imports.splitDocument(text);
  assert.equal(items.length, LINES);
  assert.equal(items[LINES - 1].title, `Item ${LINES}`);
});

test('splitDocument of very many headings gives one item per heading', () => {
  const text = Array.from({ length: LINES }, (_, i) => `## Item ${i + 1}`).join('\n');
  const { items } = imports.splitDocument(text);
  assert.equal(items.length, LINES);
  assert.equal(items[0].title, 'Item 1');
});

test('finishImports of a leftover batch whose merge target was committed leaves the card as committed and the Inbox listing', (t) => {
  const dir = tmp(t);
  const id = committedCard(dir, 'Export runs');
  discovery.createCard(dir, P, { title: 'Other idea' });
  const batch = stageMergeBatch(dir, id);
  assert.doesNotThrow(() => discovery.finishImports(dir, P));
  assert.equal(fs.existsSync(batch), false);
  assert.equal(discovery.readCard(dir, P, id).document, 'Committed text.');
  assert.deepEqual(discovery.listCards(dir, P, { column: 'inbox' }).map((c) => c.title), ['Other idea']);
});

test('finishImports of a leftover batch whose merge target was archived removes the batch', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export runs' });
  discovery.archiveCard(dir, P, card.id, { reason: 'gone' });
  const batch = stageMergeBatch(dir, card.id);
  assert.doesNotThrow(() => discovery.finishImports(dir, P));
  assert.equal(fs.existsSync(batch), false);
  assert.deepEqual(discovery.listCards(dir, P).map((c) => c.title), []);
});

test('importItems merging into a committed card throws and creates none of the import cards', (t) => {
  const dir = tmp(t);
  const id = committedCard(dir, 'Export runs');
  const items = [
    { title: 'Dark mode', text: 'Night colours.', acceptance: [] },
    { title: 'Export runs', text: 'As CSV.', acceptance: [], action: 'merge', into: id },
  ];
  assert.throws(() => imports.importItems(dir, P, items, { source: { pasted: true } }));
  assert.deepEqual(discovery.listCards(dir, P, { column: 'inbox' }).map((c) => c.title), []);
  assert.equal(discovery.readCard(dir, P, id).document, 'Committed text.');
});

test('importItems attaches the source file with its exact bytes, BOM and CRLF included', (t) => {
  const dir = tmp(t);
  const data = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Export runs\r\nAs CSV.\r\n# Dark mode\r\n', 'utf8')]);
  const out = imports.importItems(dir, P, [{ title: 'Export runs', text: 'As CSV.', acceptance: [] }, { title: 'Dark mode', text: '', acceptance: [] }], { source: { name: 'BACKLOG.md', data } });
  for (const card of out.created) {
    const stored = fs.readFileSync(path.join(dir, P, 'cards', card.id, 'attachments', 'BACKLOG.md'));
    assert.equal(stored.toString('hex'), data.toString('hex'));
  }
});
