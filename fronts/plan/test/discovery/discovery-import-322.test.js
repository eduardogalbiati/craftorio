// #322 Import a backlog document (.md/.txt or pasted text) into the Discovery Inbox: the document is
// split into items deterministically (no model), the owner previews them (rename, drop, merge, nest;
// duplicates marked), then one `idea` card is written per item, all or none.
//
// The contract these tests assume, fronts/plan/engine/domains/discovery-import.js (required inside each test, so a missing
// module fails its tests, not the file):
//   splitDocument(text, { name } = {}) → { items, structured, note }
//     Each top-level heading (the highest heading level present) is an item; without headings, each
//     top-level list item (`-`, `*`, `1.`) is one. Title = heading/list text without markers; its
//     sub-items and paragraphs are its `text` (trimmed string); checkbox lines `- [ ] x` / `- [x] x`
//     under an item are its `acceptance` (strings without the marker) and are not in `text`. CRLF
//     gives the same result as LF. Plain prose → one item, structured: false, a non-empty note.
//     Structured → structured: true. Empty / whitespace-only → items: [] and a non-empty note.
//   renameItem(items, index, title), dropItem(items, index), mergeItems(items, index, intoIndex),
//   nestItem(items, index, parentIndex): pure, return a new array, never mutate the input.
//     merge: the item disappears, its text is appended to the target's text, its acceptance appended
//     to the target's acceptance. nest: the item disappears from the top level, its title + text end
//     up in the parent's text, its criteria appended to the parent's acceptance.
//   previewImport(dir, projectId, items, { issues = [] } = {}) → [{ ...item, clarity: 0-100,
//     duplicate: null | { kind: 'card', id, title } | { kind: 'issue', number, title, url } }]
//     Same order. Duplicate = title equal to an open card of the project or an OPEN issue, ignoring
//     case, punctuation and extra spaces; closed issues never match. Writes nothing. `clarity` equals
//     the clarity.score the created card gets for the same item.
//   MAX_IMPORT_ITEMS === 200
//   importItems(dir, projectId, items, { source, author = 'owner', confirmLarge = false } = {})
//     → { created: [cards], merged: [card ids], skipped: number }
//     source: { name, data } (a file) or { pasted: true }. item.action: 'keep' (default), 'skip', or
//     'merge' with `into: <card id>` (the existing card's document then contains the item's text).
//     Created cards: type 'idea', column 'inbox', document.md = item text, acceptance.md has every
//     criterion, a numeric clarity.score, a history entry { by: 'import', source: name | 'pasted',
//     ts: ISO }; with a file source the file name is in `attachments`. The document order is the
//     Inbox order of readBoard. Over MAX_IMPORT_ITEMS without confirmLarge → throws (message has the
//     count), writes nothing. One invalid item (e.g. an empty title) → throws, no card of the import
//     exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const discovery = require('@craftorio/engine/domains/discovery/discovery');

const load = () => require('../../engine/domains/discovery-import');
const P = 'p1';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-import-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'discovery');
}

const titles = (items) => items.map((i) => i.title);
const texts = (items) => items.map((i) => i.text);
const item = (title, text = '', acceptance = []) => ({ title, text, acceptance });
const isoTs = (ts) => typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ts) && !Number.isNaN(Date.parse(ts));
const importEntry = (card) => (card.history || []).find((h) => h && h.by === 'import');

const MIXED = [
  '## Export runs',
  'The runs table cannot be exported.',
  '- as CSV',
  '- as JSON',
  '- [ ] A button exports the table',
  '',
  '## Dark mode',
  '1. Follow the system theme',
  '2. Remember the choice',
  '',
].join('\n');

// ---- splitDocument ---------------------------------------------------------------------------------

test('splitDocument makes one item per top-level heading with its paragraph as text', () => {
  const { splitDocument } = load();
  const doc = '# Export runs as CSV\nThe runs table cannot be exported.\n\n# Dark mode\nFollow the system theme.\n';
  const { items, structured } = splitDocument(doc);
  assert.deepEqual(titles(items), ['Export runs as CSV', 'Dark mode']);
  assert.deepEqual(texts(items), ['The runs table cannot be exported.', 'Follow the system theme.']);
  assert.equal(structured, true);
});

test('splitDocument keeps lower headings inside the item of the highest heading level present', () => {
  const { splitDocument } = load();
  const doc = '## Search runs\nFind a run quickly.\n### Filters\nBy status and date.\n## Dark mode\nFollow the system theme.\n';
  const { items } = splitDocument(doc);
  assert.deepEqual(titles(items), ['Search runs', 'Dark mode']);
  assert.ok(items[0].text.includes('Filters'));
  assert.ok(items[0].text.includes('By status and date.'));
});

test('splitDocument without headings makes one item per top-level list item, sub-items in its text', () => {
  const { splitDocument } = load();
  const doc = '- Export runs\n  - as CSV\n  - as JSON\n- Dark mode\n* Search runs\n';
  const { items, structured } = splitDocument(doc);
  assert.deepEqual(titles(items), ['Export runs', 'Dark mode', 'Search runs']);
  assert.ok(items[0].text.includes('as CSV'));
  assert.ok(items[0].text.includes('as JSON'));
  assert.equal(items[1].text, '');
  assert.equal(structured, true);
});

test('splitDocument splits a numbered list into items without the numbers', () => {
  const { splitDocument } = load();
  const { items } = splitDocument('1. Export runs\n2. Dark mode\n3. Search runs\n');
  assert.deepEqual(titles(items), ['Export runs', 'Dark mode', 'Search runs']);
});

test('splitDocument turns checkbox lines into acceptance criteria and leaves them out of the text', () => {
  const { splitDocument } = load();
  const doc = '# Export runs as CSV\nThe runs table cannot be exported.\n- [ ] A button exports the table\n- [x] The file opens in Excel\n';
  const { items } = splitDocument(doc);
  assert.deepEqual(items[0].acceptance, ['A button exports the table', 'The file opens in Excel']);
  assert.equal(items[0].text, 'The runs table cannot be exported.');
});

test('splitDocument of plain prose gives one unstructured item and a note', () => {
  const { splitDocument } = load();
  const prose = 'We need a way to export runs. It should be fast and work offline.';
  const { items, structured, note } = splitDocument(prose, { name: 'notes.txt' });
  assert.equal(items.length, 1);
  assert.ok(items[0].text.includes('We need a way to export runs.') || items[0].title.includes('We need a way to export runs'));
  assert.equal(structured, false);
  assert.equal(typeof note, 'string');
  assert.ok(note.trim().length > 0);
});

test('splitDocument of a mixed document gives heading items with lists, paragraphs and criteria', () => {
  const { splitDocument } = load();
  const { items, structured } = splitDocument(MIXED);
  assert.deepEqual(titles(items), ['Export runs', 'Dark mode']);
  assert.ok(items[0].text.includes('The runs table cannot be exported.'));
  assert.ok(items[0].text.includes('as CSV'));
  assert.ok(!items[0].text.includes('A button exports the table'));
  assert.deepEqual(items[0].acceptance, ['A button exports the table']);
  assert.ok(items[1].text.includes('Remember the choice'));
  assert.deepEqual(items[1].acceptance, []);
  assert.equal(structured, true);
});

test('splitDocument gives the same items for CRLF and LF line endings, without carriage returns', () => {
  const { splitDocument } = load();
  const lf = splitDocument(MIXED).items;
  const crlf = splitDocument(MIXED.replace(/\n/g, '\r\n')).items;
  assert.deepEqual(titles(crlf), titles(lf));
  assert.deepEqual(texts(crlf), texts(lf));
  assert.deepEqual(crlf.map((i) => i.acceptance), lf.map((i) => i.acceptance));
  assert.ok(crlf.every((i) => !i.title.includes('\r') && !i.text.includes('\r')));
});

test('splitDocument of whitespace-only text gives no items and a note', () => {
  const { splitDocument } = load();
  const { items, note } = splitDocument('   \n\n\t  \n');
  assert.deepEqual(items, []);
  assert.equal(typeof note, 'string');
  assert.ok(note.trim().length > 0);
});

// ---- preview edits ---------------------------------------------------------------------------------

const three = () => [
  item('Export runs', 'export text', ['export criterion']),
  item('Dark mode', 'dark text', ['dark criterion']),
  item('Search runs', 'search text', []),
];

test('renameItem changes only the title of the item at the index', () => {
  const { renameItem } = load();
  const out = renameItem(three(), 1, 'Theme switch');
  assert.deepEqual(titles(out), ['Export runs', 'Theme switch', 'Search runs']);
  assert.equal(out[1].text, 'dark text');
});

test('dropItem removes the item at the index', () => {
  const { dropItem } = load();
  assert.deepEqual(titles(dropItem(three(), 0)), ['Dark mode', 'Search runs']);
});

test('mergeItems appends the merged item text and criteria to the target and removes it', () => {
  const { mergeItems } = load();
  const out = mergeItems(three(), 1, 0);
  assert.deepEqual(titles(out), ['Export runs', 'Search runs']);
  assert.ok(out[0].text.startsWith('export text'));
  assert.ok(out[0].text.includes('dark text'));
  assert.deepEqual(out[0].acceptance, ['export criterion', 'dark criterion']);
});

test('nestItem puts the item title and text inside the parent text and its criteria in the parent', () => {
  const { nestItem } = load();
  const out = nestItem(three(), 1, 2);
  assert.deepEqual(titles(out), ['Export runs', 'Search runs']);
  assert.ok(out[1].text.includes('search text'));
  assert.ok(out[1].text.includes('Dark mode'));
  assert.ok(out[1].text.includes('dark text'));
  assert.deepEqual(out[1].acceptance, ['dark criterion']);
});

test('preview edits never mutate the input items', () => {
  const { renameItem, dropItem, mergeItems, nestItem } = load();
  const input = three();
  const before = JSON.stringify(input);
  renameItem(input, 0, 'Renamed');
  dropItem(input, 1);
  mergeItems(input, 1, 0);
  nestItem(input, 2, 0);
  assert.equal(JSON.stringify(input), before);
});

// ---- previewImport ---------------------------------------------------------------------------------

test('previewImport marks an item whose title matches an open card, ignoring case and punctuation', (t) => {
  const { previewImport } = load();
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export runs as CSV' });
  const out = previewImport(dir, P, [item('export runs, as  CSV!'), item('Dark mode')]);
  assert.deepEqual(titles(out), ['export runs, as  CSV!', 'Dark mode']);
  assert.equal(out[0].duplicate.kind, 'card');
  assert.equal(out[0].duplicate.id, card.id);
  assert.equal(out[0].duplicate.title, 'Export runs as CSV');
  assert.equal(out[1].duplicate, null);
});

test('previewImport marks an item whose title matches an open issue, ignoring case and punctuation', (t) => {
  const { previewImport } = load();
  const dir = tmp(t);
  const issues = [{ number: 12, title: 'Dark mode', state: 'open', url: 'https://github.com/o/r/issues/12' }];
  const [out] = previewImport(dir, P, [item('DARK   mode.')], { issues });
  assert.equal(out.duplicate.kind, 'issue');
  assert.equal(out.duplicate.number, 12);
  assert.equal(out.duplicate.title, 'Dark mode');
  assert.equal(out.duplicate.url, 'https://github.com/o/r/issues/12');
});

test('previewImport never matches a closed issue', (t) => {
  const { previewImport } = load();
  const dir = tmp(t);
  const issues = [{ number: 7, title: 'Dark mode', state: 'closed', url: 'https://github.com/o/r/issues/7' }];
  const [out] = previewImport(dir, P, [item('Dark mode')], { issues });
  assert.equal(out.duplicate, null);
});

test('previewImport writes nothing to the discovery folder', (t) => {
  const { previewImport } = load();
  const dir = tmp(t);
  previewImport(dir, P, [item('Export runs', 'export text', ['A button exports the table'])]);
  assert.equal(fs.existsSync(path.join(dir, P)), false);
});

test('previewImport gives each item a clarity from 0 to 100', (t) => {
  const { previewImport } = load();
  const dir = tmp(t);
  const out = previewImport(dir, P, [item('Export runs', 'export text', ['A button exports the table'])]);
  assert.equal(typeof out[0].clarity, 'number');
  assert.ok(out[0].clarity >= 0 && out[0].clarity <= 100);
});

test('previewImport clarity equals the clarity score of the card the import creates', (t) => {
  const { previewImport, importItems } = load();
  const dir = tmp(t);
  const items = [
    item('Export runs as CSV', 'The runs table cannot be exported. Owners need a CSV for reports.', ['A button exports the table', 'The file opens in Excel']),
    item('Dark mode', '', []),
  ];
  const preview = previewImport(dir, P, items);
  const { created } = importItems(dir, P, items, { source: { pasted: true } });
  assert.deepEqual(created.map((c) => c.clarity.score), preview.map((p) => p.clarity));
});

// ---- importItems -----------------------------------------------------------------------------------

test('importItems creates an idea card in the Inbox per item with its document', (t) => {
  const { importItems } = load();
  const dir = tmp(t);
  const { created } = importItems(dir, P, [item('Export runs', 'The runs table cannot be exported.')], { source: { name: 'backlog.md', data: Buffer.from('# Export runs\n') } });
  assert.equal(created.length, 1);
  const card = discovery.readCard(dir, P, created[0].id);
  assert.equal(card.type, 'idea');
  assert.equal(card.column, 'inbox');
  assert.equal(card.title, 'Export runs');
  assert.equal(card.document, 'The runs table cannot be exported.');
});

test('importItems writes every acceptance criterion to the card', (t) => {
  const { importItems } = load();
  const dir = tmp(t);
  const { created } = importItems(dir, P, [item('Export runs', 'text', ['A button exports the table', 'The file opens in Excel'])], { source: { pasted: true } });
  const card = discovery.readCard(dir, P, created[0].id);
  assert.ok(card.acceptance.includes('A button exports the table'));
  assert.ok(card.acceptance.includes('The file opens in Excel'));
});

test('importItems scores the clarity of each created card', (t) => {
  const { importItems } = load();
  const dir = tmp(t);
  const { created } = importItems(dir, P, [item('Export runs', 'text', ['A button exports the table'])], { source: { pasted: true } });
  assert.equal(typeof discovery.readCard(dir, P, created[0].id).clarity.score, 'number');
});

test('importItems records an import history entry with the file name and an ISO date', (t) => {
  const { importItems } = load();
  const dir = tmp(t);
  const { created } = importItems(dir, P, [item('Export runs', 'text')], { source: { name: 'backlog.md', data: '# Export runs\n' } });
  const entry = importEntry(discovery.readCard(dir, P, created[0].id));
  assert.ok(entry, 'an entry by import');
  assert.equal(entry.source, 'backlog.md');
  assert.ok(isoTs(entry.ts));
});

test('importItems attaches the source file to every created card', (t) => {
  const { importItems } = load();
  const dir = tmp(t);
  const { created } = importItems(dir, P, [item('Export runs'), item('Dark mode')], { source: { name: 'backlog.md', data: Buffer.from('- Export runs\n- Dark mode\n') } });
  for (const c of created) assert.ok(discovery.readCard(dir, P, c.id).attachments.includes('backlog.md'));
});

test('importItems keeps the document order in the Inbox column of the board', (t) => {
  const { importItems } = load();
  const dir = tmp(t);
  importItems(dir, P, [item('First'), item('Second'), item('Third')], { source: { pasted: true } });
  const inbox = discovery.readBoard(dir, P).order.inbox;
  assert.deepEqual(inbox.map((id) => discovery.readCard(dir, P, id).title), ['First', 'Second', 'Third']);
});

test('importItems from pasted text records the source as pasted and attaches no file', (t) => {
  const { importItems } = load();
  const dir = tmp(t);
  const { created } = importItems(dir, P, [item('Export runs', 'text')], { source: { pasted: true } });
  const card = discovery.readCard(dir, P, created[0].id);
  assert.equal(importEntry(card).source, 'pasted');
  assert.deepEqual(card.attachments, []);
});

test('importItems creates no card for a skipped item and counts it', (t) => {
  const { importItems } = load();
  const dir = tmp(t);
  const items = [item('Export runs'), { ...item('Dark mode'), action: 'skip' }, item('Search runs')];
  const { created, skipped } = importItems(dir, P, items, { source: { pasted: true } });
  assert.deepEqual(titles(created), ['Export runs', 'Search runs']);
  assert.equal(skipped, 1);
  assert.deepEqual(discovery.listCards(dir, P).map((c) => c.title).sort(), ['Export runs', 'Search runs']);
});

test('importItems merges an item into an existing card instead of creating one', (t) => {
  const { importItems } = load();
  const dir = tmp(t);
  const existing = discovery.createCard(dir, P, { title: 'Export runs as CSV', text: 'Original text.' });
  const items = [{ ...item('Export runs', 'Owners need a CSV for reports.'), action: 'merge', into: existing.id }];
  const { created, merged } = importItems(dir, P, items, { source: { pasted: true } });
  assert.deepEqual(created, []);
  assert.deepEqual(merged, [existing.id]);
  assert.equal(discovery.listCards(dir, P).length, 1);
  assert.ok(discovery.readCard(dir, P, existing.id).document.includes('Owners need a CSV for reports.'));
});

test('MAX_IMPORT_ITEMS is 200', () => {
  assert.equal(load().MAX_IMPORT_ITEMS, 200);
});

test('importItems refuses more than MAX_IMPORT_ITEMS items without confirmLarge and writes nothing', (t) => {
  const { importItems } = load();
  const dir = tmp(t);
  const items = Array.from({ length: 201 }, (_, i) => item(`Item ${i + 1}`));
  assert.throws(() => importItems(dir, P, items, { source: { pasted: true } }), /201/);
  assert.equal(fs.existsSync(path.join(dir, P)) ? discovery.listCards(dir, P).length : 0, 0);
});

test('importItems creates more than MAX_IMPORT_ITEMS items with confirmLarge', (t) => {
  const { importItems } = load();
  const dir = tmp(t);
  const items = Array.from({ length: 201 }, (_, i) => item(`Item ${i + 1}`));
  const { created } = importItems(dir, P, items, { source: { pasted: true }, confirmLarge: true });
  assert.equal(created.length, 201);
  assert.equal(discovery.listCards(dir, P).length, 201);
});

test('importItems with one invalid item throws and leaves no card of the import', (t) => {
  const { importItems } = load();
  const dir = tmp(t);
  const items = [item('Export runs'), item('   '), item('Search runs')];
  assert.throws(() => importItems(dir, P, items, { source: { name: 'backlog.md', data: 'x' } }));
  assert.equal(fs.existsSync(path.join(dir, P)) ? discovery.listCards(dir, P).length : 0, 0);
});
