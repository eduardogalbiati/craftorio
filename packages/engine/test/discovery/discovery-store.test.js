// #256 Discovery store: <workspace>/discovery/<project id>/ holds one folder per card (card.json,
// document.md, acceptance.md, versions/, attachments/, conversation.jsonl), a board.json (columns,
// WIP limits, card order per column) and archive/<card id>/ for discarded, merged or released cards.
// Atomic writes (temp + rename), and no path outside the card's folder is ever read or written.
//
// The contract these tests assume (packages/engine/domains/discovery/discovery.js, required inside each test so this file loads
// before it exists). `dir` is the discovery folder, layout(root).discovery (like packages/engine/domains/backlog/backlog.js
// takes ws.backlog):
//   createCard(dir, projectId, { title, text, author, type = 'idea', column = 'inbox', tags }) → card
//   readCard(dir, projectId, id) → { ...card.json, document, acceptance, attachments: [names] }
//   listCards(dir, projectId, { column } = {}) → cards newest first (same shape, archive excluded)
//   updateCard(dir, projectId, id, fields) → card (fields of card.json, plus `document` / `acceptance`)
//   moveCard(dir, projectId, id, column, { by }) → card (history [{ ts, from, to, by }] + a version)
//   addAttachment(dir, projectId, id, { path } | { name, data }) → the stored name (data: Buffer or base64)
//   removeAttachment(dir, projectId, id, name)
//   appendConversation(dir, projectId, id, entry) / readConversation(dir, projectId, id) → [entries]
//   archiveCard(dir, projectId, id, { reason, by }) → moves the folder to archive/<id>, card.archived = { reason, by, ... }
//   restoreCard(dir, projectId, id) → back to cards/<id>, in its column
//   mergeCard(dir, projectId, fromId, intoId, { by }) → the target: documents and attachments joined,
//     the source archived with a link to the target (card.archived mentions intoId)
//   listArchived(dir, projectId) → archived cards
//   COLUMNS includes 'inbox' and 'triage'; MAX_ATTACHMENT_BYTES = 50 MB
// Never public: discovery/.gitignore ignores everything, so a workspace inside a git repository
// never commits a card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout } = require('../../domains/workspace/workspace');

const load = () => require('../../domains/discovery/discovery');
const ID = /^\d{8}-[0-9a-f]{4}$/;
const P = 'p1';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dir: layout(root).discovery };
}
const cardDir = (dir, id) => path.join(dir, P, 'cards', id);
const archiveDir = (dir, id) => path.join(dir, P, 'archive', id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// every file under a folder, relative paths
function walk(base, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...walk(base, r)); else out.push(r);
  }
  return out;
}

test('layout().discovery is <workspace>/discovery', () => {
  const root = path.join(os.tmpdir(), 'ws-x');
  assert.equal(layout(root).discovery, path.join(root, 'discovery'));
});

test('createCard writes an idea card in the Inbox: card.json, document.md, acceptance.md and conversation.jsonl in cards/<yyyymmdd-4hex>/', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const card = d.createCard(dir, P, { title: 'Dark mode', text: 'Users ask for a dark theme.', author: 'eduardo' });
  assert.match(card.id, ID);
  // the date part is the creation day (local or UTC: either is accepted)
  const c = new Date(card.created);
  const pad = (n) => String(n).padStart(2, '0');
  const local = `${c.getFullYear()}${pad(c.getMonth() + 1)}${pad(c.getDate())}`;
  const utc = c.toISOString().slice(0, 10).replace(/-/g, '');
  assert.ok([local, utc].includes(card.id.slice(0, 8)), `${card.id} does not start with the creation day`);
  const folder = cardDir(dir, card.id);
  for (const f of ['card.json', 'document.md', 'acceptance.md', 'conversation.jsonl']) {
    assert.ok(fs.existsSync(path.join(folder, f)), `${f} is missing`);
  }
  const json = JSON.parse(fs.readFileSync(path.join(folder, 'card.json'), 'utf8'));
  assert.equal(json.id, card.id);
  assert.equal(json.title, 'Dark mode');
  assert.equal(json.type, 'idea');
  assert.equal(json.column, 'inbox');
  assert.equal(json.author, 'eduardo');
  assert.ok(json.created && json.updated);
  assert.ok(Array.isArray(json.tags));
  assert.ok(Array.isArray(json.history));
  assert.ok(json.clarity && Array.isArray(json.clarity.gaps), 'clarity { score, gaps[] }');
  assert.ok(json.estimate && 'usd' in json.estimate && 'minutes' in json.estimate, 'estimate { usd, minutes }');
  assert.deepEqual(json.links, { issues: [], release: null });
  assert.match(fs.readFileSync(path.join(folder, 'document.md'), 'utf8'), /Users ask for a dark theme\./);
});

test('card ids are unique and well formed, and the type is one of idea, prd, rfc, bug, hotfix', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const ids = new Set();
  for (let i = 0; i < 20; i++) ids.add(d.createCard(dir, P, { title: `c${i}`, text: '', author: 'a' }).id);
  assert.equal(ids.size, 20);
  for (const id of ids) assert.match(id, ID);
  assert.equal(d.createCard(dir, P, { title: 'b', text: '', author: 'a', type: 'bug' }).type, 'bug');
  assert.throws(() => d.createCard(dir, P, { title: 'x', text: '', author: 'a', type: 'novel' }));
});

test('board.json holds the columns (inbox, triage, with WIP limits) and the card order per column', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const a = d.createCard(dir, P, { title: 'A', text: '', author: 'a' });
  const board = JSON.parse(fs.readFileSync(path.join(dir, P, 'board.json'), 'utf8'));
  const ids = board.columns.map((c) => c.id);
  assert.ok(ids.includes('inbox') && ids.includes('triage'), `columns: ${ids.join(', ')}`);
  assert.ok(board.columns.every((c) => 'wip' in c), 'every column has a WIP limit (a number or null)');
  assert.deepEqual(board.order.inbox, [a.id]);
  assert.ok(d.COLUMNS.includes('inbox') && d.COLUMNS.includes('triage'));
});

test('writes are atomic: no temporary file is left in the project folder after create, update, move, attach and append', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const c = d.createCard(dir, P, { title: 'A', text: 'doc', author: 'a' });
  d.updateCard(dir, P, c.id, { title: 'B', document: 'doc 2' });
  d.moveCard(dir, P, c.id, 'triage', { by: 'a' });
  d.addAttachment(dir, P, c.id, { name: 'note.txt', data: Buffer.from('hi') });
  d.appendConversation(dir, P, c.id, { author: 'a', text: 'hello' });
  const leftovers = walk(path.join(dir, P)).filter((f) => /\.tmp$|~$|\.tmp-|\.partial$/i.test(f) && !f.includes(`attachments${path.sep}`));
  assert.deepEqual(leftovers, []);
});

test('listCards: the project\'s cards newest first, filtered by column', async (t) => {
  const d = load();
  const { dir } = tmp(t);
  const a = d.createCard(dir, P, { title: 'Old', text: '', author: 'a' });
  await sleep(15);
  const b = d.createCard(dir, P, { title: 'Mid', text: '', author: 'a' });
  await sleep(15);
  const c = d.createCard(dir, P, { title: 'New', text: '', author: 'a' });
  d.createCard(dir, 'other', { title: 'Elsewhere', text: '', author: 'a' });
  assert.deepEqual(d.listCards(dir, P).map((x) => x.id), [c.id, b.id, a.id]);
  d.moveCard(dir, P, b.id, 'triage', { by: 'a' });
  assert.deepEqual(d.listCards(dir, P, { column: 'inbox' }).map((x) => x.id), [c.id, a.id]);
  assert.deepEqual(d.listCards(dir, P, { column: 'triage' }).map((x) => x.id), [b.id]);
  assert.deepEqual(d.listCards(dir, 'none'), []);
});

test('readCard returns card.json with the document, acceptance and attachment names; updateCard persists fields and bumps updated', async (t) => {
  const d = load();
  const { dir } = tmp(t);
  const c = d.createCard(dir, P, { title: 'A', text: 'first', author: 'a' });
  await sleep(15);
  d.updateCard(dir, P, c.id, { title: 'Renamed', tags: ['ux'], document: 'second', acceptance: '- works' });
  const r = d.readCard(dir, P, c.id);
  assert.equal(r.title, 'Renamed');
  assert.deepEqual(r.tags, ['ux']);
  assert.equal(r.document, 'second');
  assert.equal(r.acceptance, '- works');
  assert.deepEqual(r.attachments, []);
  assert.ok(Date.parse(r.updated) > Date.parse(c.updated), 'updated was bumped');
  assert.equal(r.id, c.id, 'the id cannot be changed');
  assert.equal(fs.readFileSync(path.join(cardDir(dir, c.id), 'document.md'), 'utf8'), 'second');
});

test('moveCard records a history entry { ts, from, to, by }, updates the board order and snapshots document.md in versions/', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const c = d.createCard(dir, P, { title: 'A', text: 'the document', author: 'a' });
  const moved = d.moveCard(dir, P, c.id, 'triage', { by: 'eduardo' });
  assert.equal(moved.column, 'triage');
  const h = d.readCard(dir, P, c.id).history.at(-1);
  assert.equal(h.from, 'inbox');
  assert.equal(h.to, 'triage');
  assert.equal(h.by, 'eduardo');
  assert.ok(h.ts);
  const board = JSON.parse(fs.readFileSync(path.join(dir, P, 'board.json'), 'utf8'));
  assert.ok(!board.order.inbox.includes(c.id));
  assert.deepEqual(board.order.triage, [c.id]);
  const versions = fs.readdirSync(path.join(cardDir(dir, c.id), 'versions'));
  assert.equal(versions.length, 1);
  assert.match(versions[0], /^\d{4}-\d{2}-\d{2}T.*\.md$/);
  assert.ok(!versions[0].includes(':'), 'a Windows-safe file name');
  const snapshot = fs.readFileSync(path.join(cardDir(dir, c.id), 'versions', versions[0]), 'utf8');
  assert.equal(snapshot, fs.readFileSync(path.join(cardDir(dir, c.id), 'document.md'), 'utf8'));
  assert.match(snapshot, /the document/);
  assert.throws(() => d.moveCard(dir, P, c.id, 'nowhere', { by: 'a' }), 'an unknown column is refused');
});

test('addAttachment copies any file into attachments/ with its original name; the same name twice is deduplicated', (t) => {
  const d = load();
  const { root, dir } = tmp(t);
  const src = path.join(root, 'spec.pdf');
  fs.writeFileSync(src, Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 1, 2]));
  const c = d.createCard(dir, P, { title: 'A', text: '', author: 'a' });
  const first = d.addAttachment(dir, P, c.id, { path: src });
  assert.equal(first, 'spec.pdf');
  const other = path.join(root, 'sub');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'spec.pdf'), 'second');
  const second = d.addAttachment(dir, P, c.id, { path: path.join(other, 'spec.pdf') });
  assert.notEqual(second, first);
  const att = path.join(cardDir(dir, c.id), 'attachments');
  assert.deepEqual(fs.readFileSync(path.join(att, first)), fs.readFileSync(src));
  assert.equal(fs.readFileSync(path.join(att, second), 'utf8'), 'second');
  assert.ok(fs.existsSync(src), 'the source file is copied, not moved');
  const pasted = d.addAttachment(dir, P, c.id, { name: 'shot.png', data: Buffer.from('png').toString('base64') });
  assert.equal(fs.readFileSync(path.join(att, pasted), 'utf8'), 'png');
  assert.deepEqual(d.readCard(dir, P, c.id).attachments.sort(), [first, second, pasted].sort());
  assert.equal(d.listCards(dir, P)[0].attachments.length, 3, 'the list knows the attachment count');
});

test('removeAttachment deletes the file; a name outside attachments/ is refused and nothing outside is touched', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const c = d.createCard(dir, P, { title: 'A', text: 'keep me', author: 'a' });
  const name = d.addAttachment(dir, P, c.id, { name: 'a.txt', data: Buffer.from('x') });
  d.removeAttachment(dir, P, c.id, name);
  assert.deepEqual(d.readCard(dir, P, c.id).attachments, []);
  for (const bad of ['../document.md', '..\\card.json', '../../board.json', path.join(cardDir(dir, c.id), 'document.md')]) {
    assert.throws(() => d.removeAttachment(dir, P, c.id, bad), `${bad} was not refused`);
  }
  assert.equal(fs.readFileSync(path.join(cardDir(dir, c.id), 'document.md'), 'utf8'), 'keep me');
  assert.ok(fs.existsSync(path.join(cardDir(dir, c.id), 'card.json')));
  assert.ok(fs.existsSync(path.join(dir, P, 'board.json')));
});

test('an attachment name with a path cannot escape attachments/, and a project or card id with a path is refused', (t) => {
  const d = load();
  const { root, dir } = tmp(t);
  const c = d.createCard(dir, P, { title: 'A', text: '', author: 'a' });
  for (const name of ['../evil.txt', '..\\..\\evil.txt', '../../../evil.txt']) {
    let stored;
    try { stored = d.addAttachment(dir, P, c.id, { name, data: Buffer.from('evil') }); } catch { /* refusing is fine */ }
    if (stored !== undefined) {
      assert.ok(!/[\\/]/.test(stored) && stored !== '..', `stored as ${stored}`);
      assert.ok(fs.existsSync(path.join(cardDir(dir, c.id), 'attachments', stored)));
    }
  }
  const outside = walk(root).filter((f) => path.basename(f) === 'evil.txt' && !f.includes(`attachments${path.sep}`));
  assert.deepEqual(outside, [], 'a file was written outside attachments/');
  assert.throws(() => d.createCard(dir, '..', { title: 'x', text: '', author: 'a' }));
  assert.throws(() => d.createCard(dir, '../escape', { title: 'x', text: '', author: 'a' }));
  assert.throws(() => d.readCard(dir, P, '..\\x'));
  assert.throws(() => d.readCard(dir, P, '../cards'));
  assert.throws(() => d.updateCard(dir, P, '../../p2', { title: 'x' }));
  assert.ok(!fs.existsSync(path.join(root, 'escape')));
});

test('an attachment over MAX_ATTACHMENT_BYTES (50 MB) is refused and nothing is copied', (t) => {
  const d = load();
  const { root, dir } = tmp(t);
  assert.equal(d.MAX_ATTACHMENT_BYTES, 50 * 1024 * 1024);
  const big = path.join(root, 'big.bin');
  fs.writeFileSync(big, '');
  fs.truncateSync(big, d.MAX_ATTACHMENT_BYTES + 1);
  const c = d.createCard(dir, P, { title: 'A', text: '', author: 'a' });
  assert.throws(() => d.addAttachment(dir, P, c.id, { path: big }), /large|size|limit|MB/i);
  assert.deepEqual(d.readCard(dir, P, c.id).attachments, []);
});

test('appendConversation adds one JSON line per entry (with a ts); readConversation returns them in order', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const c = d.createCard(dir, P, { title: 'A', text: '', author: 'a' });
  d.appendConversation(dir, P, c.id, { author: 'eduardo', text: 'first' });
  d.appendConversation(dir, P, c.id, { author: 'agent', text: 'second' });
  const lines = fs.readFileSync(path.join(cardDir(dir, c.id), 'conversation.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  const conv = d.readConversation(dir, P, c.id);
  assert.deepEqual(conv.map((e) => e.text), ['first', 'second']);
  assert.ok(conv.every((e) => e.ts));
});

test('archiveCard (Discard) moves the folder to archive/<id> with its reason; the list leaves it out; restoreCard brings it back', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const c = d.createCard(dir, P, { title: 'A', text: 'doc', author: 'a' });
  d.archiveCard(dir, P, c.id, { reason: 'duplicate of an old idea', by: 'eduardo' });
  assert.ok(!fs.existsSync(cardDir(dir, c.id)));
  assert.ok(fs.existsSync(path.join(archiveDir(dir, c.id), 'card.json')));
  assert.ok(fs.existsSync(path.join(archiveDir(dir, c.id), 'document.md')));
  assert.deepEqual(d.listCards(dir, P), []);
  const archived = d.listArchived(dir, P);
  assert.deepEqual(archived.map((x) => x.id), [c.id]);
  assert.equal(archived[0].archived.reason, 'duplicate of an old idea');
  assert.equal(archived[0].archived.by, 'eduardo');
  const board = JSON.parse(fs.readFileSync(path.join(dir, P, 'board.json'), 'utf8'));
  assert.ok(!Object.values(board.order).flat().includes(c.id), 'an archived card leaves the board');

  d.restoreCard(dir, P, c.id);
  assert.ok(fs.existsSync(path.join(cardDir(dir, c.id), 'card.json')));
  assert.ok(!fs.existsSync(archiveDir(dir, c.id)));
  assert.deepEqual(d.listCards(dir, P, { column: 'inbox' }).map((x) => x.id), [c.id]);
  assert.deepEqual(d.listArchived(dir, P), []);
});

test('mergeCard joins the documents and attachments into the target and archives the source with a link to it', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const into = d.createCard(dir, P, { title: 'Target', text: 'Target text.', author: 'a' });
  const from = d.createCard(dir, P, { title: 'Source', text: 'Source text.', author: 'b' });
  d.addAttachment(dir, P, into.id, { name: 'same.txt', data: Buffer.from('target') });
  d.addAttachment(dir, P, from.id, { name: 'same.txt', data: Buffer.from('source') });
  d.addAttachment(dir, P, from.id, { name: 'only-source.png', data: Buffer.from('img') });
  d.mergeCard(dir, P, from.id, into.id, { by: 'eduardo' });

  const merged = d.readCard(dir, P, into.id);
  assert.match(merged.document, /Target text\./);
  assert.match(merged.document, /Source text\./);
  assert.equal(merged.attachments.length, 3, `attachments: ${merged.attachments.join(', ')}`);
  const att = path.join(cardDir(dir, into.id), 'attachments');
  const contents = merged.attachments.map((n) => fs.readFileSync(path.join(att, n), 'utf8')).sort();
  assert.deepEqual(contents, ['img', 'source', 'target']);

  assert.deepEqual(d.listCards(dir, P).map((x) => x.id), [into.id]);
  const archived = d.listArchived(dir, P).find((x) => x.id === from.id);
  assert.ok(archived, 'the source is archived');
  assert.match(JSON.stringify(archived.archived), new RegExp(into.id), 'the archived source links to the target');
  assert.throws(() => d.mergeCard(dir, P, into.id, into.id, { by: 'a' }), 'a card cannot merge into itself');
});

test('addAttachment stores the same content under the same name once, and drops trailing dots and spaces from a name', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const c = d.createCard(dir, P, { title: 'A', text: '', author: 'a' });
  const first = d.addAttachment(dir, P, c.id, { name: 'shot.png', data: Buffer.from('same') });
  const again = d.addAttachment(dir, P, c.id, { name: 'shot.png', data: Buffer.from('same') });
  assert.equal(again, first);
  assert.equal(d.addAttachment(dir, P, c.id, { name: 'shot.png', data: Buffer.from('other') }), 'shot-2.png');
  assert.equal(d.addAttachment(dir, P, c.id, { name: 'notes.txt. . ', data: Buffer.from('n') }), 'notes.txt');
  assert.deepEqual(d.readCard(dir, P, c.id).attachments.sort(), ['notes.txt', 'shot-2.png', 'shot.png']);
});

test('readAttachment gives an image as a data: URL for a preview, another file without one, and refuses a name with a path', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const c = d.createCard(dir, P, { title: 'A', text: '', author: 'a' });
  // the 8-byte PNG signature followed by a few bytes: sniffed as an image by its content
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
  const img = d.addAttachment(dir, P, c.id, { name: 'screen.png', data: png });
  const doc = d.addAttachment(dir, P, c.id, { name: 'spec.txt', data: Buffer.from('plain text') });
  const a = d.readAttachment(dir, P, c.id, img);
  assert.equal(a.name, 'screen.png');
  assert.equal(a.size, png.length);
  assert.equal(a.folder, path.join(cardDir(dir, c.id), 'attachments'));
  assert.equal(a.dataUrl, `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(d.readAttachment(dir, P, c.id, doc).dataUrl, null);
  assert.throws(() => d.readAttachment(dir, P, c.id, '../card.json'));
  assert.throws(() => d.readAttachment(dir, P, c.id, '..\\document.md'));
});

test('updateCard merges clarity, estimate and links into the card\'s, and refuses one that is not an object', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const c = d.createCard(dir, P, { title: 'A', text: '', author: 'a' });
  d.updateCard(dir, P, c.id, { estimate: { usd: 4.5 } });
  d.updateCard(dir, P, c.id, { estimate: { minutes: 30 }, links: { issues: [12] } });
  const r = d.readCard(dir, P, c.id);
  assert.equal(r.estimate.usd, 4.5);
  assert.equal(r.estimate.minutes, 30);
  assert.deepEqual(r.links, { issues: [12], release: null });
  for (const bad of [{ clarity: 3 }, { estimate: 'cheap' }, { links: ['x'] }]) {
    assert.throws(() => d.updateCard(dir, P, c.id, bad), `${JSON.stringify(bad)} was accepted`);
  }
  assert.equal(d.readCard(dir, P, c.id).estimate.usd, 4.5, 'a refused update changes nothing');
  assert.throws(() => d.updateCard(dir, P, c.id, { title: '   ' }), 'an empty title is refused');
});

test('archive and restore add history entries to and from the archive; a card whose column is gone comes back to the inbox', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const c = d.createCard(dir, P, { title: 'A', text: '', author: 'a' });
  d.moveCard(dir, P, c.id, 'triage', { by: 'a' });
  d.archiveCard(dir, P, c.id, { reason: 'later', by: 'eve' });
  // the card's column no longer exists on the board when it is restored
  const card = JSON.parse(fs.readFileSync(path.join(archiveDir(dir, c.id), 'card.json'), 'utf8'));
  fs.writeFileSync(path.join(archiveDir(dir, c.id), 'card.json'), JSON.stringify({ ...card, column: 'gone' }));
  const back = d.restoreCard(dir, P, c.id, { by: 'eve' });
  assert.equal(back.column, 'inbox');
  assert.equal(back.archived, undefined, 'a restored card is no longer marked archived');
  const steps = d.readCard(dir, P, c.id).history.map((h) => `${h.from}>${h.to}`);
  assert.deepEqual(steps.slice(-2), ['triage>archive', 'archive>inbox']);
  const board = JSON.parse(fs.readFileSync(path.join(dir, P, 'board.json'), 'utf8'));
  assert.ok(board.order.inbox.includes(c.id));
  assert.throws(() => d.restoreCard(dir, P, c.id), 'a card that is not archived cannot be restored');
});

test('mergeCard tried again after a failed archive does not join the source document twice', (t) => {
  const d = load();
  const { dir } = tmp(t);
  const into = d.createCard(dir, P, { title: 'Target', text: 'Target text.', author: 'a' });
  const from = d.createCard(dir, P, { title: 'Source', text: 'Source text.', author: 'b' });
  // the first merge joins the documents, then the archive of the source fails: archive/ is a file
  fs.writeFileSync(path.join(dir, P, 'archive'), 'blocks the archive');
  assert.throws(() => d.mergeCard(dir, P, from.id, into.id, { by: 'a' }));
  assert.ok(fs.existsSync(path.join(cardDir(dir, from.id), 'card.json')), 'the source is still a card');
  fs.rmSync(path.join(dir, P, 'archive'));
  d.mergeCard(dir, P, from.id, into.id, { by: 'a' });
  const doc = d.readCard(dir, P, into.id).document;
  assert.equal(doc.split('Source text.').length - 1, 1, doc);
  assert.deepEqual(d.listCards(dir, P).map((x) => x.id), [into.id]);
});

test('never public: discovery/ carries a .gitignore that ignores everything', (t) => {
  const d = load();
  const { dir } = tmp(t);
  d.createCard(dir, P, { title: 'A', text: '', author: 'a' });
  const ignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(ignore, /^\*$/m);
});
