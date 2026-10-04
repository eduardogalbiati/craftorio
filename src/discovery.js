// Discovery store (#256): the cards of the discovery side (ideas that may become a PRD or an RFC
// before any code), private to the workspace and never on the git platform. `dir` is the workspace's
// discovery folder (layout().discovery), which carries a .gitignore that ignores everything:
//   <dir>/<project id>/
//     board.json                  columns ({ id, title, wip }), the card order per column
//     cards/<card id>/            card id = <yyyymmdd>-<4 hex>
//       card.json                 id, title, type, column, author, created, updated, tags, clarity,
//                                 estimate, links, history [{ ts, from, to, by }]
//       document.md               the working document (idea → PRD or RFC)
//       acceptance.md             the acceptance criteria
//       versions/<ts>-<reason>.md a snapshot of document.md on each column move (and each merge)
//       attachments/              any file, original names, deduplicated
//       conversation.jsonl        the card's thread, one JSON entry per line
//     archive/<card id>/          discarded or merged cards (same layout, card.archived says why)
// Every file is written whole (temp file + rename, src/state-file.js); the thread is appended one
// line at a time. Project ids, card ids and attachment names are checked before any path is built:
// nothing outside a card's folder is read or written. Used by the discovery: channels
// (src/service/channels/discovery.js), the only way the screens, the Oracle and agents reach a card.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sniffImage } = require('./engine/providers');
const { renameWithRetry, writeFileAtomic } = require('./state-file');

const TYPES = ['idea', 'prd', 'rfc', 'bug', 'hotfix'];
// the columns this store knows; the Discovery board adds its own (#261)
const BOARD_COLUMNS = [
  { id: 'inbox', title: 'Inbox', wip: null },
  { id: 'triage', title: 'Triage', wip: null },
];
const COLUMNS = BOARD_COLUMNS.map((c) => c.id);
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
// an image attachment larger than this is not sent to the screen as a thumbnail
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;

const CARD_ID = /^\d{8}-[0-9a-f]{4}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// card.json's fields a caller may change (the column changes with moveCard, the rest never)
const EDITABLE = ['title', 'type', 'tags', 'clarity', 'estimate', 'links'];

// a file being written (writeFileAtomic, addAttachment): <name>.<pid>.tmp, never listed as an attachment
const TEMP_FILE = /\.\d+\.tmp$/;

const now = () => new Date().toISOString();
const mb = (n) => `${Math.ceil(n / 1024 / 1024)} MB`;
const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const writeJson = (file, data) => writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`);

// ---- paths: every one is built from checked ids ---------------------------------------------------

function projectDir(dir, projectId) {
  const id = String(projectId ?? '');
  if (!PROJECT_ID.test(id)) throw new Error(`Invalid project id: ${id || '(empty)'}`);
  return path.join(dir, id);
}

function cardDir(dir, projectId, id, box = 'cards') {
  if (!CARD_ID.test(String(id ?? ''))) throw new Error(`Invalid card id: ${String(id ?? '') || '(empty)'}`);
  return path.join(projectDir(dir, projectId), box, String(id));
}

// The folder of a card that exists, in cards/ (or archive/).
function existingCard(dir, projectId, id, box = 'cards') {
  const folder = cardDir(dir, projectId, id, box);
  if (!fs.existsSync(path.join(folder, 'card.json'))) throw new Error(`${box === 'archive' ? 'Archived card' : 'Card'} not found: ${id}`);
  return folder;
}

// A file name without any path (what a paste, a drop or a source path calls the file), or ''.
function fileName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').trim().slice(-120);
  return /^\.*$/.test(base) ? '' : base;
}

// The file of an attachment of the card: `name` is a plain file name of attachments/, nothing else.
function attachmentFile(folder, name) {
  const base = fileName(name);
  if (!base || base !== String(name)) throw new Error(`Not an attachment of this card: ${name}`);
  return path.join(folder, 'attachments', base);
}

// The project's folder with its cards/, and the .gitignore that keeps discovery/ out of any repository.
function ensureProject(dir, projectId) {
  const folder = projectDir(dir, projectId);
  fs.mkdirSync(path.join(folder, 'cards'), { recursive: true });
  const ignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(ignore)) writeFileAtomic(ignore, '# discovery cards are private to the workspace: never committed (#256)\n*\n');
  return folder;
}

// ---- board.json -----------------------------------------------------------------------------------

function readBoard(dir, projectId) {
  let board = null;
  try { board = JSON.parse(fs.readFileSync(path.join(projectDir(dir, projectId), 'board.json'), 'utf8')); } catch { /* first card, or a broken file: rebuilt */ }
  const columns = Array.isArray(board?.columns) ? board.columns.filter((c) => c && typeof c.id === 'string') : [];
  for (const c of BOARD_COLUMNS) if (!columns.some((x) => x.id === c.id)) columns.push({ ...c });
  const order = {};
  for (const c of columns) order[c.id] = Array.isArray(board?.order?.[c.id]) ? board.order[c.id].filter((id) => CARD_ID.test(id)) : [];
  return { columns: columns.map((c) => ({ ...c, wip: c.wip ?? null })), order };
}

// Takes the card off every column, then puts it in `column` (first: a new card; last: a moved one).
function placeOnBoard(dir, projectId, id, column, { first = false } = {}) {
  const board = readBoard(dir, projectId);
  for (const c of Object.keys(board.order)) board.order[c] = board.order[c].filter((x) => x !== id);
  if (column) {
    board.order[column] = board.order[column] || [];
    if (first) board.order[column].unshift(id); else board.order[column].push(id);
  }
  writeJson(path.join(ensureProject(dir, projectId), 'board.json'), board);
}

// ---- cards ----------------------------------------------------------------------------------------

function checkType(type) {
  if (!TYPES.includes(type)) throw new Error(`Unknown card type: ${type} (one of ${TYPES.join(', ')})`);
  return type;
}
function checkColumn(dir, projectId, column) {
  if (!readBoard(dir, projectId).columns.some((c) => c.id === column)) throw new Error(`Unknown column: ${column}`);
  return column;
}
function checkTitle(title) {
  const t = String(title ?? '').trim();
  if (!t) throw new Error('A card needs a title.');
  return t.slice(0, 200);
}
const tagList = (tags) => [...new Set((Array.isArray(tags) ? tags : []).map((t) => String(t).trim()).filter(Boolean))];

function attachmentNames(folder) {
  try {
    return fs.readdirSync(path.join(folder, 'attachments'), { withFileTypes: true })
      .filter((e) => e.isFile() && !TEMP_FILE.test(e.name)).map((e) => e.name).sort();
  } catch { return []; }
}

// card.json with the document, the acceptance criteria and the attachment names.
function load(folder) {
  const card = JSON.parse(fs.readFileSync(path.join(folder, 'card.json'), 'utf8'));
  return {
    ...card,
    document: readText(path.join(folder, 'document.md')),
    acceptance: readText(path.join(folder, 'acceptance.md')),
    attachments: attachmentNames(folder),
  };
}

// Writes card.json from a loaded card (its files' content is not part of it).
function saveCard(folder, card) {
  const { document, acceptance, attachments, ...json } = card;
  writeJson(path.join(folder, 'card.json'), json);
}

// The cards of cards/ (or archive/); a folder that is not a readable card is left out.
function loadAll(dir, projectId, box) {
  const base = path.join(projectDir(dir, projectId), box);
  let names = [];
  try { names = fs.readdirSync(base).filter((n) => CARD_ID.test(n)); } catch { return []; }
  const cards = [];
  for (const n of names) {
    try { cards.push(load(path.join(base, n))); } catch { /* a folder without a readable card.json */ }
  }
  return cards;
}
const newestFirst = (key) => (a, b) => String(key(b)).localeCompare(String(key(a))) || String(b.id).localeCompare(String(a.id));

/**
 * Creates a card (an `idea` in the Inbox by default) with its document (`text`) and returns it.
 * Throws on an unknown type or column, a missing title, or a project id that is not a plain name.
 */
function createCard(dir, projectId, { title, text = '', author = 'owner', type = 'idea', column = 'inbox', tags } = {}) {
  const base = path.join(ensureProject(dir, projectId), 'cards');
  const card = {
    id: null,
    title: checkTitle(title),
    type: checkType(type),
    column: checkColumn(dir, projectId, column),
    author: String(author || 'owner'),
    created: now(),
    updated: null,
    tags: tagList(tags),
    clarity: { score: null, gaps: [] },
    estimate: { usd: null, minutes: null },
    links: { issues: [], release: null },
    history: [],
  };
  card.updated = card.created;
  const d = new Date(card.created);
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  let folder = null;
  for (let i = 0; !folder; i++) {
    const id = `${day}-${crypto.randomBytes(2).toString('hex')}`;
    if (fs.existsSync(cardDir(dir, projectId, id, 'archive'))) continue; // an archived card keeps its id
    try {
      fs.mkdirSync(path.join(base, id)); // not recursive: an id already taken throws EEXIST
      card.id = id;
      folder = path.join(base, id);
    } catch (e) {
      if (e.code !== 'EEXIST' || i > 200) throw e;
    }
  }
  writeFileAtomic(path.join(folder, 'document.md'), String(text ?? ''));
  writeFileAtomic(path.join(folder, 'acceptance.md'), '');
  writeFileAtomic(path.join(folder, 'conversation.jsonl'), '');
  writeJson(path.join(folder, 'card.json'), card);
  placeOnBoard(dir, projectId, card.id, card.column, { first: true });
  return load(folder);
}

/** A card of cards/: card.json plus `document`, `acceptance` and `attachments` (names). */
function readCard(dir, projectId, id) {
  return load(existingCard(dir, projectId, id));
}

/** The project's cards, newest first, optionally of one column. Archived cards are not listed. */
function listCards(dir, projectId, { column } = {}) {
  return loadAll(dir, projectId, 'cards')
    .filter((c) => !column || c.column === column)
    .sort(newestFirst((c) => c.created));
}

/** The project's archived cards (discarded or merged), the last archived first. */
function listArchived(dir, projectId) {
  return loadAll(dir, projectId, 'archive').sort(newestFirst((c) => c.archived?.ts || c.updated));
}

/**
 * Changes a card: `title`, `type`, `tags`, `clarity`, `estimate`, `links` (objects, merged into
 * the card's), and the `document` and `acceptance` files. The id, column, author and history
 * never change here.
 */
function updateCard(dir, projectId, id, fields = {}) {
  const folder = existingCard(dir, projectId, id);
  const card = load(folder);
  for (const k of EDITABLE) {
    if (fields[k] === undefined) continue;
    if (k === 'title') card.title = checkTitle(fields.title);
    else if (k === 'type') card.type = checkType(fields.type);
    else if (k === 'tags') card.tags = tagList(fields.tags);
    else if (fields[k] && typeof fields[k] === 'object' && !Array.isArray(fields[k])) card[k] = { ...card[k], ...fields[k] };
    else throw new Error(`${k} must be an object.`);
  }
  if (fields.document !== undefined) writeFileAtomic(path.join(folder, 'document.md'), String(fields.document ?? ''));
  if (fields.acceptance !== undefined) writeFileAtomic(path.join(folder, 'acceptance.md'), String(fields.acceptance ?? ''));
  card.updated = now();
  saveCard(folder, card);
  return load(folder);
}

/** Snapshots document.md as versions/<iso ts>-<reason>.md (a column move, a merge, an agent output). Returns the file name. */
function snapshotVersion(dir, projectId, id, reason) {
  const folder = existingCard(dir, projectId, id);
  const label = String(reason || 'snapshot').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'snapshot';
  const name = `${now().replace(/[:.]/g, '-')}-${label}.md`;
  writeFileAtomic(path.join(folder, 'versions', name), readText(path.join(folder, 'document.md')));
  return name;
}

/** Moves a card to another column: a history entry { ts, from, to, by }, a version of its document, the board's order. */
function moveCard(dir, projectId, id, column, { by = 'owner' } = {}) {
  const folder = existingCard(dir, projectId, id);
  checkColumn(dir, projectId, column);
  const card = load(folder);
  if (card.column === column) return card;
  snapshotVersion(dir, projectId, id, `move-${column}`);
  const ts = now();
  card.history = [...(card.history || []), { ts, from: card.column, to: column, by: String(by || 'owner') }];
  card.column = column;
  card.updated = ts;
  saveCard(folder, card);
  placeOnBoard(dir, projectId, id, column);
  return load(folder);
}

// ---- attachments ------------------------------------------------------------------------------------

const sameContent = (file, src) => {
  try { return fs.statSync(file).size === src.size && fs.readFileSync(file).equals(src.read()); } catch { return false; }
};

/**
 * Copies a file into the card's attachments/: `{ path }` (a file on disk, kept where it is) or
 * `{ name, data }` (a Buffer or base64, e.g. a paste or a drop). Any type, up to
 * MAX_ATTACHMENT_BYTES. A name already taken by other content gets a suffix (spec-2.pdf); the
 * same content under the same name is stored once. Returns the stored name.
 */
function addAttachment(dir, projectId, id, { path: from, name, data } = {}) {
  const folder = existingCard(dir, projectId, id);
  let src;
  if (from) {
    const stat = fs.statSync(String(from));
    if (!stat.isFile()) throw new Error(`Not a file: ${from}`);
    src = { size: stat.size, read: () => fs.readFileSync(String(from)), copy: (to) => fs.copyFileSync(String(from), to) };
  } else if (data !== undefined && data !== null) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'base64');
    src = { size: buf.length, read: () => buf, copy: (to) => fs.writeFileSync(to, buf) };
  } else {
    throw new Error('An attachment needs a file path or its data.');
  }
  if (src.size > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment too large: ${mb(src.size)}, the limit is ${mb(MAX_ATTACHMENT_BYTES)}`);
  const wanted = fileName(name || from) || 'attachment';
  const box = path.join(folder, 'attachments');
  fs.mkdirSync(box, { recursive: true });
  const ext = path.extname(wanted);
  const stem = wanted.slice(0, wanted.length - ext.length);
  let stored = wanted;
  for (let n = 2; fs.existsSync(path.join(box, stored)); n++) {
    if (sameContent(path.join(box, stored), src)) return stored;
    stored = `${stem}-${n}${ext}`;
  }
  const tmp = path.join(box, `${stored}.${process.pid}.tmp`);
  try { src.copy(tmp); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  renameWithRetry(tmp, path.join(box, stored));
  touch(folder);
  return stored;
}

/** Deletes an attachment of the card. `name` is one of its attachment names: anything else throws. */
function removeAttachment(dir, projectId, id, name) {
  const folder = existingCard(dir, projectId, id);
  fs.rmSync(attachmentFile(folder, name), { force: true });
  touch(folder);
  return true;
}

/** An attachment for the screen: { name, size, folder, dataUrl } (folder: the card's attachments/; dataUrl: an image up to MAX_PREVIEW_BYTES, else null). */
function readAttachment(dir, projectId, id, name) {
  const file = attachmentFile(existingCard(dir, projectId, id), name);
  const size = fs.statSync(file).size;
  let dataUrl = null;
  if (size <= MAX_PREVIEW_BYTES) {
    const buf = fs.readFileSync(file);
    const type = sniffImage(buf);
    if (type) dataUrl = `data:image/${type};base64,${buf.toString('base64')}`;
  }
  return { name: path.basename(file), size, folder: path.dirname(file), dataUrl };
}

function touch(folder) {
  const card = load(folder);
  card.updated = now();
  saveCard(folder, card);
}

// ---- conversation ---------------------------------------------------------------------------------

/** Appends an entry (a note, a question, an answer, an agent output) to the card's thread, stamped with `ts`. */
function appendConversation(dir, projectId, id, entry = {}) {
  const folder = existingCard(dir, projectId, id);
  const line = { ts: now(), ...(entry && typeof entry === 'object' ? entry : { text: String(entry) }) };
  fs.appendFileSync(path.join(folder, 'conversation.jsonl'), `${JSON.stringify(line)}\n`);
  return line;
}

/** The card's thread, oldest first (a line cut by a crash is skipped). */
function readConversation(dir, projectId, id) {
  const folder = existingCard(dir, projectId, id);
  const out = [];
  for (const line of readText(path.join(folder, 'conversation.jsonl')).split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a broken line */ }
  }
  return out;
}

/**
 * The cards waiting for the owner (#255): the last entry of the card's thread is a question (`kind:
 * 'question'`, e.g. one an agent asks while shaping the card); any later entry (the owner's note, an
 * answer) ends the wait. { id, title, column, question: { ts, author, text } }, the longest waiting first.
 */
function listWaiting(dir, projectId) {
  return listCards(dir, projectId)
    .map((c) => ({ id: c.id, title: c.title, column: c.column, question: readConversation(dir, projectId, c.id).at(-1) }))
    .filter((c) => c.question?.kind === 'question')
    .map((c) => ({ ...c, question: { ts: c.question.ts, author: c.question.author || '', text: String(c.question.text || '') } }))
    .sort((a, b) => String(a.question.ts).localeCompare(String(b.question.ts)));
}

// ---- archive --------------------------------------------------------------------------------------

/**
 * Archives a card (Discard, or the source of a merge): its folder moves to archive/<id>, the card
 * leaves the board and keeps `archived: { ts, reason, by, mergedInto? }`.
 */
function archiveCard(dir, projectId, id, { reason = '', by = 'owner', mergedInto = null } = {}) {
  const folder = existingCard(dir, projectId, id);
  const target = cardDir(dir, projectId, id, 'archive');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  renameWithRetry(folder, target);
  const card = load(target);
  const ts = now();
  card.archived = { ts, reason: String(reason || ''), by: String(by || 'owner'), ...(mergedInto ? { mergedInto } : {}) };
  card.history = [...(card.history || []), { ts, from: card.column, to: 'archive', by: card.archived.by }];
  card.updated = ts;
  saveCard(target, card);
  placeOnBoard(dir, projectId, id, null);
  return load(target);
}

/** Brings an archived card back to cards/<id>, in the column it was archived from. */
function restoreCard(dir, projectId, id, { by = 'owner' } = {}) {
  const folder = existingCard(dir, projectId, id, 'archive');
  const target = cardDir(dir, projectId, id);
  if (fs.existsSync(target)) throw new Error(`A card ${id} already exists.`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  renameWithRetry(folder, target);
  const { archived, ...card } = load(target);
  const ts = now();
  if (!readBoard(dir, projectId).columns.some((c) => c.id === card.column)) card.column = 'inbox';
  card.history = [...(card.history || []), { ts, from: 'archive', to: card.column, by: String(by || 'owner') }];
  card.updated = ts;
  saveCard(target, card);
  placeOnBoard(dir, projectId, id, card.column);
  return load(target);
}

/**
 * Merges the card `fromId` into `intoId`: the target's document (snapshotted first) and acceptance
 * criteria gain the source's, its attachments and tags join, its thread notes the merge, and the
 * source is archived with a link to the target (archived.mergedInto). Returns the target.
 */
function mergeCard(dir, projectId, fromId, intoId, { by = 'owner' } = {}) {
  if (String(fromId) === String(intoId)) throw new Error('A card cannot be merged into itself.');
  const fromFolder = existingCard(dir, projectId, fromId);
  const from = load(fromFolder);
  const into = readCard(dir, projectId, intoId);
  const heading = `## Merged from: ${from.title} (${from.id})`;
  // a merge tried again after a failed archive joins nothing twice
  const join = (a, b) => (b.trim() && !a.includes(heading) ? `${a.trimEnd()}${a.trim() ? '\n\n---\n\n' : ''}${heading}\n\n${b.trim()}\n` : undefined);
  snapshotVersion(dir, projectId, intoId, 'merge');
  for (const name of from.attachments) addAttachment(dir, projectId, intoId, { path: path.join(fromFolder, 'attachments', name) });
  updateCard(dir, projectId, intoId, {
    document: join(into.document, from.document),
    acceptance: join(into.acceptance, from.acceptance),
    tags: [...(into.tags || []), ...(from.tags || [])],
  });
  appendConversation(dir, projectId, intoId, { kind: 'merge', author: String(by || 'owner'), text: `Merged "${from.title}" (${from.id}) into this card.` });
  archiveCard(dir, projectId, fromId, { reason: `Merged into ${intoId}`, by, mergedInto: intoId });
  return readCard(dir, projectId, intoId);
}

module.exports = {
  addAttachment,
  appendConversation,
  archiveCard,
  COLUMNS,
  createCard,
  listArchived,
  listCards,
  listWaiting,
  MAX_ATTACHMENT_BYTES,
  mergeCard,
  moveCard,
  readAttachment,
  readBoard,
  readCard,
  readConversation,
  removeAttachment,
  restoreCard,
  snapshotVersion,
  TYPES,
  updateCard,
};
