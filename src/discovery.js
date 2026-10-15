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
//     imports/<batch>/            an import's cards while it is written (#322, importCards)
// The Discovery board (#257): the columns Inbox, Triage, Shape, Define, Ready, a WIP limit on Shape
// and Define (setWip; a move past it is never refused here: the screen asks), a card's place within
// its column (moveCard's `index`), and the document's history: versions/ also gets the document a
// restored version or a run's result replaced (before-restore, before-result) and the result itself
// (result-<source>: Write & Review, AI Arena), which the thread notes too ({ kind: 'result' }).
// The clarity score (#166, src/clarity.js): card.json's `clarity` { score, gaps, ts, by, override? }
// is the rubric's score of the card's text, computed when the card is created and again whenever its
// document, its acceptance criteria or its type change (the text itself is never touched; a card
// from before the score gets it when it is read); a caller may record another scorer's (updateCard's
// `clarity`). board.json's `clarity` { bar, byKind, night }
// is the project's bar (85 by default, optionally one per kind) and the owner's night. A card enters
// Ready only at or above its bar, or with the owner's override and a reason, kept on the card as
// clarity.override { score, bar, reason, by, ts }; a card already in Ready is never moved back.
// Grill me (grillCard, answerGrill) asks the card's open points one at a time in its thread and
// writes each answer into the card.
// The commitment point (#258, src/discovery-commit.js): a Ready card committed to the backlog leaves
// the board (markCommitted): its column becomes 'committed' (no board column), links.issues holds the
// numbers of the issues filed from it and filed/ keeps the text of each one. A committed card never
// moves again (moveCard refuses it) and is kept as it was committed (its text, files and score no
// longer change; only links.release, the release that shipped its issues, is still written): new
// learning is a new card whose links.from names it (createCard's `from`). COMMIT_BAR (85) is the
// clarity a commit needs: Grill me interviews a Ready card up to it, also past a lower bar of its own.
// Column automations (#259): a board column may declare `on_enter`, what a card's move into it may
// start: a saved pipeline or a workflow (`pipeline` / `workflow`: the file, `inputs` rendered from
// the card with {{ card.title }}, {{ card.document }}, {{ card.acceptance }}, {{ card.attachments }},
// {{ card.type }}, {{ card.document_skill }}: renderAutomationInputs) or the clarity check (`check:
// 'clarity'`, no run). `mode` is 'ask' (the screen proposes it; the default), 'on' (it starts) or
// 'off' (setColumnAutomation). Shape offers AI Arena → Write & Review on the card's document, Ready
// the clarity check; a column stored without on_enter takes the default's. The service starts the
// run and records it on the card: card.json's `automation` { state: 'running' | 'done' | 'failed',
// runId, name, column, costUsd?, startedAt, endedAt? } (markAutomation), and the result comes back
// like a run's (recordAutomation: the document as a version automation-<column>, a thread entry
// { kind: 'automation', runId, costUsd }). An automation never moves or commits a card.
// Every file is written whole (temp file + rename, src/state-file.js); the thread is appended one
// line at a time. Project ids, card ids and attachment names are checked before any path is built:
// nothing outside a card's folder is read or written. Used by the discovery: channels
// (src/service/channels/discovery.js), the only way the screens, the Oracle and agents reach a card.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const clarity = require('./clarity');
const { sniffImage } = require('./engine/providers');
const { renameWithRetry, writeFileAtomic } = require('./state-file');

const TYPES = ['idea', 'prd', 'rfc', 'bug', 'hotfix'];
// the board's columns, in order: the Inbox screen shows the first, the Discovery board the others
// (#257); `wip` is the column's WIP limit (null: none), changed with setWip
const BOARD_COLUMNS = [
  { id: 'inbox', title: 'Inbox', wip: null },
  { id: 'triage', title: 'Triage', wip: null },
  { id: 'shape', title: 'Shape', wip: 5 },
  { id: 'define', title: 'Define', wip: 5 },
  { id: 'ready', title: 'Ready', wip: null },
];
const COLUMNS = BOARD_COLUMNS.map((c) => c.id);
// a column automation's modes (#259): proposed to the owner, started at once, or nothing
const AUTOMATION_MODES = ['ask', 'on', 'off'];
// the prompt the Shape automation gives the first stage (AI Arena's task), rendered from the card
const SHAPE_TASK = [
  'Shape this discovery card into a clear document. Keep its intent and every fact it states; ground what you add in the project\'s files and mark assumptions and open questions as such.',
  'Card: {{ card.title }}',
  '<document>\n{{ card.document }}\n</document>',
  '<acceptance_criteria>\n{{ card.acceptance }}\n</acceptance_criteria>',
].join('\n\n');
// the default `on_enter` of the columns (#259): what a move into them may start
const ON_ENTER = {
  shape: {
    pipeline: 'ai-arena-write-review.yaml', name: 'AI Arena → Write & Review', mode: 'ask',
    inputs: { task: SHAPE_TASK, attachments: '{{ card.attachments }}', document_skill: '{{ card.document_skill }}' },
  },
  ready: { check: 'clarity', name: 'Clarity check', mode: 'ask' },
};
// the document type Write & Review and the AI Arena shape a card into ({{ card.document_skill }})
const DOC_SKILL = { rfc: 'rfc-writing' };
const DEFAULT_DOC_SKILL = 'prd-writing';
// text attachments rendered into {{ card.attachments }}, at most this many bytes in all
const MAX_ATTACHMENTS_TEXT = 200 * 1024;
// where a committed card is (#258): off the board, in the Committed list, for good
const COMMITTED = 'committed';
// the clarity a Ready card needs to be committed (the owner's decision, 2026-10-04): not the
// project's bar into Ready, which a type's own bar or an override can pass lower
const COMMIT_BAR = 85;
const KEPT = 'A committed card is kept as it was committed: new learning is a new card linked to it.';
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
// an image attachment larger than this is not sent to the screen as a thumbnail
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;

const CARD_ID = /^\d{8}-[0-9a-f]{4}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// card.json's fields a caller may change (the column changes with moveCard, the rest never)
const EDITABLE = ['title', 'type', 'tags', 'clarity', 'estimate', 'links'];

// a file being written (writeFileAtomic, addAttachment): <name>.<pid>.tmp, never listed as an attachment
const TEMP_FILE = /\.\d+\.tmp$/;
// a version of the document: <iso time with - for : and .>-<reason>.md (snapshotVersion)
const VERSION_FILE = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)-([\w-]+)\.md$/;
// the runs whose result comes back to a card (recordResult), by the `source` they are recorded under
const RESULT_SOURCES = { 'ai-arena': 'AI Arena', 'write-review': 'Write & Review' };
// who scores a card's text when it changes (clarity.by), and who asks in a Grill me interview
const RUBRIC = 'Clarity rubric';
const GRILL = 'Grill me';

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

// The folder of a card that may still change: a committed card (#258) is kept as it was committed.
function editableCard(dir, projectId, id) {
  const folder = existingCard(dir, projectId, id);
  let column = null;
  try { column = JSON.parse(fs.readFileSync(path.join(folder, 'card.json'), 'utf8')).column; } catch { /* unreadable: the caller's read says why */ }
  if (column === COMMITTED) throw new Error(KEPT);
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

// The file of a version of the card's document: `name` is a plain file name of versions/, nothing else.
function versionFile(folder, name) {
  if (!VERSION_FILE.test(String(name ?? ''))) throw new Error(`Not a version of this card: ${name}`);
  return path.join(folder, 'versions', String(name));
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
  // a column's automation (#259): the default's, under what board.json stores of it (the owner's
  // mode, or a whole automation of their own on a column without a default)
  const withAutomation = (c) => {
    const stored = c.on_enter && typeof c.on_enter === 'object' ? c.on_enter : null;
    const auto = ON_ENTER[c.id] || stored ? { ...(ON_ENTER[c.id] || {}), ...(stored || {}) } : null;
    return auto ? { ...c, on_enter: { ...auto, mode: AUTOMATION_MODES.includes(auto.mode) ? auto.mode : 'ask' } } : c;
  };
  return { columns: columns.map((c) => withAutomation({ ...c, wip: c.wip ?? null })), order, clarity: clarity.claritySettings(board?.clarity) };
}

// Writes board.json: of a column's automation only what differs from the default stays (the owner's
// mode), so a later default (another pipeline, another prompt) reaches every board.
function writeBoard(dir, projectId, board) {
  const columns = board.columns.map((c) => {
    const def = ON_ENTER[c.id];
    if (!def || !c.on_enter) return c;
    const own = Object.fromEntries(Object.entries(c.on_enter).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(def[k])));
    const rest = { ...c };
    delete rest.on_enter;
    return Object.keys(own).length ? { ...rest, on_enter: own } : rest;
  });
  writeJson(path.join(ensureProject(dir, projectId), 'board.json'), { ...board, columns });
}

// Takes the card off every column, then puts it in `column`: first (a new card), at `index` among
// the column's other cards (a card dropped at a place), else last (a moved one).
function placeOnBoard(dir, projectId, id, column, { first = false, index } = {}) {
  const board = readBoard(dir, projectId);
  for (const c of Object.keys(board.order)) board.order[c] = board.order[c].filter((x) => x !== id);
  if (column) {
    const list = board.order[column] || [];
    board.order[column] = list;
    if (first) list.unshift(id);
    else if (Number.isInteger(index) && index >= 0 && index < list.length) list.splice(index, 0, id);
    else list.push(id);
  }
  writeBoard(dir, projectId, board);
}

/**
 * Sets a column's WIP limit (a positive integer) and returns the board. The limit warns, it never
 * blocks: moveCard does not look at it (the Discovery board asks before a move past it).
 */
function setWip(dir, projectId, column, limit) {
  const board = readBoard(dir, projectId);
  const col = board.columns.find((c) => c.id === column);
  if (!col) throw new Error(`Unknown column: ${column}`);
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`A WIP limit is a whole number from 1: ${limit}`);
  col.wip = limit;
  writeBoard(dir, projectId, board);
  return board;
}

/**
 * Sets a column automation's mode (#259): 'ask' (proposed on each move into the column), 'on'
 * (started at once) or 'off'. The pipeline and its inputs stay as they are. Returns the board.
 * Refuses a mode outside those, an unknown column and a column without an automation.
 */
function setColumnAutomation(dir, projectId, column, { mode } = {}) {
  const board = readBoard(dir, projectId);
  const col = board.columns.find((c) => c.id === column);
  if (!col) throw new Error(`Unknown column: ${column}`);
  if (!col.on_enter) throw new Error(`${col.title} has no automation to set.`);
  if (!AUTOMATION_MODES.includes(mode)) throw new Error(`An automation is ask, on or off: ${mode}`);
  col.on_enter = { ...col.on_enter, mode };
  writeBoard(dir, projectId, board);
  return board;
}

/**
 * Sets the project's clarity bar (#166) and returns the board: `bar` (0 to 100), `byKind` (a bar of
 * its own per kind, e.g. { hotfix: 60 }; null takes a kind's away) and `night` ({ start, end } as
 * HH:MM, the window the ready forecast counts in). What is not given keeps its value.
 */
function setClarityBar(dir, projectId, { bar, byKind, night } = {}) {
  const board = readBoard(dir, projectId);
  const percent = (n, what) => {
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error(`${what} is a whole number from 0 to 100: ${n}`);
    return n;
  };
  if (bar !== undefined) board.clarity.bar = percent(bar, 'A clarity bar');
  for (const [kind, own] of Object.entries(byKind || {})) {
    if (!clarity.KINDS.includes(kind)) throw new Error(`Unknown kind: ${kind} (one of ${clarity.KINDS.join(', ')})`);
    if (own === null) delete board.clarity.byKind[kind];
    else board.clarity.byKind[kind] = percent(own, `The clarity bar of ${kind}`);
  }
  if (night !== undefined) {
    const checked = clarity.claritySettings({ night }).night;
    if (checked.start !== night?.start || checked.end !== night?.end) throw new Error('A night is { start, end } as HH:MM, e.g. 23:00 to 08:00.');
    board.clarity.night = checked;
  }
  writeBoard(dir, projectId, board);
  return board;
}

/** The ready work of the project (#166): its Ready cards at or above their bar, as agent hours and nights (clarity.readyForecast). */
function readyForecast(dir, projectId) {
  return clarity.readyForecast(listCards(dir, projectId, { column: 'ready' }), readBoard(dir, projectId).clarity);
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

// The number of thread entries, without parsing them (a line cut by a crash has no closing brace).
function countThread(folder) {
  return readText(path.join(folder, 'conversation.jsonl')).split('\n').filter((line) => /^\{.*\}\s*$/.test(line)).length;
}

// card.json with the document, the acceptance criteria, the attachment names and the number of
// thread entries (`threadCount`: a card's face shows it without reading the thread).
function load(folder) {
  const card = JSON.parse(fs.readFileSync(path.join(folder, 'card.json'), 'utf8'));
  const text = { document: readText(path.join(folder, 'document.md')), acceptance: readText(path.join(folder, 'acceptance.md')) };
  // a card from before the clarity score (#166) was never scored: it is as it is read, as of its
  // last change (saved with the card's next change)
  const unscored = !card.clarity?.ts && typeof card.clarity?.score !== 'number';
  return {
    ...card,
    ...(unscored ? { clarity: { ...card.clarity, ...clarity.scoreClarity({ type: card.type, ...text }), ts: card.updated || card.created, by: RUBRIC } } : {}),
    ...text,
    attachments: attachmentNames(folder),
    threadCount: countThread(folder),
  };
}

// Writes card.json from a loaded card (its files' content and counts are not part of it).
function saveCard(folder, card) {
  const { document, acceptance, attachments, threadCount, ...json } = card;
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

// The rubric's score of a card's text (#166), as card.json's `clarity` keeps it.
const scored = (card) => ({ ...clarity.scoreClarity(card), ts: now(), by: RUBRIC });

// The clarity a caller records (another scorer's): its score is a whole percentage, or null, dated
// when it is recorded unless the caller dates it (not with the date of the score it replaces). The
// override is the owner's, written by moveCard only.
function givenClarity({ override, ...given }) {
  const { score } = given;
  if (score !== undefined && score !== null && !(Number.isInteger(score) && score >= 0 && score <= 100)) throw new Error(`A clarity score is a whole number from 0 to 100: ${score}`);
  return score !== undefined && given.ts === undefined ? { ...given, ts: now() } : given;
}

// The card's document was replaced (a restored version, a run's result): its score follows.
function rescore(folder) {
  const card = load(folder);
  card.clarity = { ...card.clarity, ...scored(card) };
  card.updated = now();
  saveCard(folder, card);
}

/**
 * Creates a card (an `idea` in the Inbox by default) with its document (`text`) and returns it.
 * `from`: the card it was learned from (#258: a committed card never returns to the board), kept as
 * links.from.
 * Throws on an unknown type or column, a missing title, a `from` that is no card, or a project id
 * that is not a plain name.
 */
function createCard(dir, projectId, { title, text = '', author = 'owner', type = 'idea', column = 'inbox', tags, from } = {}) {
  const base = path.join(ensureProject(dir, projectId), 'cards');
  const source = from ? readCard(dir, projectId, from).id : null;
  const card = {
    id: null,
    title: checkTitle(title),
    type: checkType(type),
    column: checkColumn(dir, projectId, column),
    author: String(author || 'owner'),
    created: now(),
    updated: null,
    tags: tagList(tags),
    clarity: scored({ type, document: text, acceptance: '' }),
    estimate: { usd: null, minutes: null },
    links: { issues: [], release: null, ...(source ? { from: source } : {}) },
    history: [],
  };
  card.updated = card.created;
  if (card.column === 'ready') passClarityBar(dir, projectId, card, {});
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
 * never change here. A new document, acceptance criteria or type scores the card again (#166); a
 * `clarity` given with them is the one kept. A committed card (#258) only takes `links.release`.
 */
function updateCard(dir, projectId, id, fields = {}) {
  const folder = existingCard(dir, projectId, id);
  const card = load(folder);
  if (card.column === COMMITTED) {
    const given = Object.keys(fields).filter((k) => fields[k] !== undefined);
    const release = given.every((k) => k === 'links') && Object.keys(fields.links || {}).every((k) => k === 'release');
    if (!release) throw new Error(KEPT);
  }
  const type = card.type;
  for (const k of EDITABLE) {
    if (fields[k] === undefined) continue;
    if (k === 'title') card.title = checkTitle(fields.title);
    else if (k === 'type') card.type = checkType(fields.type);
    else if (k === 'tags') card.tags = tagList(fields.tags);
    else if (fields[k] && typeof fields[k] === 'object' && !Array.isArray(fields[k])) card[k] = { ...card[k], ...(k === 'clarity' ? givenClarity(fields[k]) : fields[k]) };
    else throw new Error(`${k} must be an object.`);
  }
  if (fields.document !== undefined) card.document = String(fields.document ?? '');
  if (fields.acceptance !== undefined) card.acceptance = String(fields.acceptance ?? '');
  if (fields.document !== undefined) writeFileAtomic(path.join(folder, 'document.md'), card.document);
  if (fields.acceptance !== undefined) writeFileAtomic(path.join(folder, 'acceptance.md'), card.acceptance);
  if (fields.document !== undefined || fields.acceptance !== undefined || card.type !== type) card.clarity = { ...card.clarity, ...scored(card), ...(fields.clarity ? givenClarity(fields.clarity) : {}) };
  card.updated = now();
  saveCard(folder, card);
  return load(folder);
}

// The gate into Ready (#166): a card below its bar (or never scored) is refused, unless the owner
// forces it with a reason, which is kept on the card with the score at that moment.
function passClarityBar(dir, projectId, card, { by, force, reason }) {
  const bar = clarity.clarityBar(readBoard(dir, projectId).clarity, card.type);
  const score = typeof card.clarity?.score === 'number' ? card.clarity.score : null;
  if (score !== null && score >= bar) return;
  if (!force) {
    const why = score === null ? `it has no clarity score yet (the bar is ${bar}%)` : `its clarity is ${score}%, the bar is ${bar}%`;
    throw new Error(`Below the clarity bar: ${why}. Close its gaps (Grill me), or move it anyway with a reason.`);
  }
  const why = String(reason ?? '').trim();
  if (!why) throw new Error('Moving a card below the clarity bar needs a reason.');
  card.clarity = { ...card.clarity, override: { score, bar, reason: why.slice(0, 500), by: String(by || 'owner'), ts: now() } };
}

// Writes `text` as versions/<iso ts>-<reason>.md of the card's folder and returns the file name.
function saveVersion(folder, reason, text) {
  const label = String(reason || 'snapshot').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'snapshot';
  const stamp = now().replace(/[:.]/g, '-');
  let name = `${stamp}-${label}.md`;
  // a second snapshot for the same reason in the same millisecond never replaces the first
  for (let n = 2; fs.existsSync(path.join(folder, 'versions', name)); n++) name = `${stamp}-${label}-${n}.md`;
  writeFileAtomic(path.join(folder, 'versions', name), text);
  return name;
}

/** Snapshots document.md as versions/<iso ts>-<reason>.md (a column move, a merge, an agent output). Returns the file name. */
function snapshotVersion(dir, projectId, id, reason) {
  const folder = existingCard(dir, projectId, id);
  return saveVersion(folder, reason, readText(path.join(folder, 'document.md')));
}

/**
 * Moves a card to another column: a history entry { ts, from, to, by }, a version of its document,
 * the board's order (last in the column, or at `index` among its other cards). A move within its
 * own column only changes its place (with an `index`): no history entry, no version.
 * Into Ready, the card passes the clarity bar (#166) or the move throws; `force` with a `reason` is
 * the owner's override. A committed card (#258) never moves: the move throws, forced or not.
 */
function moveCard(dir, projectId, id, column, { by = 'owner', index, force = false, reason } = {}) {
  const folder = existingCard(dir, projectId, id);
  checkColumn(dir, projectId, column);
  const card = load(folder);
  if (card.column === COMMITTED) throw new Error('A committed card stays committed: it follows its issues to the release. New learning is a new card linked to it.');
  if (card.column === column) {
    if (Number.isInteger(index)) placeOnBoard(dir, projectId, id, column, { index });
    return card;
  }
  if (column === 'ready') passClarityBar(dir, projectId, card, { by, force, reason });
  snapshotVersion(dir, projectId, id, `move-${column}`);
  const ts = now();
  card.history = [...(card.history || []), { ts, from: card.column, to: column, by: String(by || 'owner') }];
  card.column = column;
  card.updated = ts;
  saveCard(folder, card);
  placeOnBoard(dir, projectId, id, column, { index });
  return load(folder);
}

/** The folder that keeps the text of each issue filed from the card (#258): cards/<id>/filed. */
function filedDir(dir, projectId, id) {
  return path.join(existingCard(dir, projectId, id), 'filed');
}

/**
 * Commits a Ready card (#258): it leaves the board for good (column 'committed'), with the numbers
 * of the issues filed from it in links.issues, a history entry and a version of its document.
 * The caller checked the commit bar and filed the issues (src/discovery-commit.js).
 */
function markCommitted(dir, projectId, id, { issues = [], by = 'owner' } = {}) {
  const folder = existingCard(dir, projectId, id);
  const card = load(folder);
  if (card.column !== 'ready') throw new Error(card.column === COMMITTED ? 'This card is already committed.' : 'Only a Ready card is committed.');
  const numbers = [...new Set((Array.isArray(issues) ? issues : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!numbers.length) throw new Error('A card is committed with the issues filed from it.');
  snapshotVersion(dir, projectId, id, 'commit');
  const ts = now();
  card.history = [...(card.history || []), { ts, from: card.column, to: COMMITTED, by: String(by || 'owner') }];
  card.links = { ...card.links, issues: numbers };
  card.column = COMMITTED;
  card.updated = ts;
  saveCard(folder, card);
  placeOnBoard(dir, projectId, id, null);
  return load(folder);
}

/**
 * The issues filed from the project's cards (#258): issue number → { id, title } of its card.
 * Reads each card.json only (the Backlog asks on every read); a project without cards has none.
 */
function issueCards(dir, projectId) {
  const out = new Map();
  let base = null;
  let names = [];
  try {
    base = path.join(projectDir(dir, projectId), 'cards');
    names = fs.readdirSync(base).filter((n) => CARD_ID.test(n));
  } catch { return out; }
  for (const n of names) {
    try {
      const card = JSON.parse(fs.readFileSync(path.join(base, n, 'card.json'), 'utf8'));
      for (const number of card.links?.issues || []) if (!out.has(Number(number))) out.set(Number(number), { id: card.id, title: card.title });
    } catch { /* a folder without a readable card.json */ }
  }
  return out;
}

// ---- versions -------------------------------------------------------------------------------------

/** The versions of the card's document, newest first: { name (the file in versions/), ts, reason }. */
function listVersions(dir, projectId, id) {
  const folder = existingCard(dir, projectId, id);
  let names = [];
  try { names = fs.readdirSync(path.join(folder, 'versions')); } catch { /* no version yet */ }
  return names
    .map((name) => {
      const m = VERSION_FILE.exec(name);
      return m ? { name, ts: `${m[1]}:${m[2]}:${m[3]}.${m[4]}`, reason: m[5] } : null;
    })
    .filter(Boolean)
    // the name starts with the time; within one millisecond a result sorts as newer than the
    // document it replaced (result-… > before-…)
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

/** The text of a version. `name` is one of listVersions' names: anything else (a path) throws. */
function readVersion(dir, projectId, id, name) {
  const file = versionFile(existingCard(dir, projectId, id), name);
  if (!fs.existsSync(file)) throw new Error(`Version not found: ${name}`);
  return fs.readFileSync(file, 'utf8');
}

// Keeps the document about to be replaced as a version, unless the newest version already holds it.
function keepDocument(dir, projectId, id, reason) {
  const [newest] = listVersions(dir, projectId, id);
  const current = readCard(dir, projectId, id).document;
  if (!newest || readVersion(dir, projectId, id, newest.name) !== current) snapshotVersion(dir, projectId, id, reason);
}

/**
 * Makes a version the card's document again. The document it replaces is kept as a new version
 * (before-restore), so nothing is lost, and the thread notes who restored what.
 */
function restoreVersion(dir, projectId, id, name, { by = 'owner' } = {}) {
  const folder = editableCard(dir, projectId, id);
  const text = readVersion(dir, projectId, id, name);
  keepDocument(dir, projectId, id, 'before-restore');
  writeFileAtomic(path.join(folder, 'document.md'), text);
  rescore(folder);
  appendConversation(dir, projectId, id, { kind: 'restore', author: String(by || 'owner'), version: String(name), text: `Restored the version ${name} as the document.` });
  return load(folder);
}

/**
 * The result of a run started from the card comes back (`source`: 'write-review' or 'ai-arena'):
 * `text` becomes the document, kept as the version result-<source> (the document it replaces is
 * kept too), and the thread gets an entry { kind: 'result', source, runId }. Returns the card.
 */
function recordResult(dir, projectId, id, { source, text, runId = null, by = 'owner' } = {}) {
  const folder = editableCard(dir, projectId, id);
  if (!Object.hasOwn(RESULT_SOURCES, String(source))) throw new Error(`Unknown result source: ${source} (one of ${Object.keys(RESULT_SOURCES).join(', ')})`);
  if (!String(text ?? '').trim()) throw new Error('A result needs a text.');
  keepDocument(dir, projectId, id, 'before-result');
  writeFileAtomic(path.join(folder, 'document.md'), String(text));
  const version = snapshotVersion(dir, projectId, id, `result-${source}`);
  rescore(folder);
  appendConversation(dir, projectId, id, {
    kind: 'result', source, runId: runId ? String(runId) : null, author: String(by || 'owner'), version,
    text: `${RESULT_SOURCES[source]} finished: its result is the document now (version ${version}).`,
  });
  return load(folder);
}

// ---- column automations (#259) --------------------------------------------------------------------

// The text attachments of a card as the AI Arena's `attachments` input reads them, images and large
// files left out: "===== Attached file: <name> =====" then the text, MAX_ATTACHMENTS_TEXT in all.
function attachmentsText(folder, names) {
  const parts = [];
  let left = MAX_ATTACHMENTS_TEXT;
  for (const name of names) {
    const file = path.join(folder, 'attachments', name);
    let buf;
    try {
      if (fs.statSync(file).size > left) continue; // never read a large file to skip it
      buf = fs.readFileSync(file);
    } catch { continue; }
    if (sniffImage(buf) || buf.includes(0)) continue;
    parts.push(`===== Attached file: ${name} =====\n${buf.toString('utf8')}`);
    left -= buf.length;
  }
  return parts.join('\n\n');
}

/**
 * An automation's inputs rendered from the card: each `{{ card.<field> }}` in the given values becomes
 * the card's title, document, acceptance, type, document_skill (prd-writing, or rfc-writing for an
 * RFC) or attachments (the text ones); an unknown field renders empty.
 */
function renderAutomationInputs(dir, projectId, id, inputs = {}) {
  const folder = existingCard(dir, projectId, id);
  const card = load(folder);
  const fields = {
    acceptance: String(card.acceptance || ''),
    document: String(card.document || ''),
    document_skill: DOC_SKILL[card.type] || DEFAULT_DOC_SKILL,
    title: String(card.title || ''),
    type: String(card.type || ''),
  };
  const field = (name) => (name === 'attachments' ? attachmentsText(folder, card.attachments || []) : fields[name] ?? '');
  const out = {};
  for (const [k, v] of Object.entries(inputs || {})) {
    out[k] = typeof v === 'string' ? v.replace(/\{\{\s*card\.(\w+)\s*\}\}/g, (_, name) => field(name)) : v;
  }
  return out;
}

const documentHash = (text) => crypto.createHash('sha1').update(String(text ?? '')).digest('hex');

/**
 * Records the automation running on the card (#259), `{ runId, name, column }` → card.automation
 * { state: 'running', …, startedAt, document: a hash of the document it started from }; `null`
 * takes the record away. Returns the card.
 */
function markAutomation(dir, projectId, id, automation) {
  const folder = editableCard(dir, projectId, id);
  const card = load(folder);
  if (automation === null) delete card.automation;
  else {
    if (!automation || typeof automation !== 'object') throw new Error('An automation is an object or null.');
    card.automation = { state: 'running', startedAt: now(), document: documentHash(card.document), ...automation };
  }
  saveCard(folder, card);
  return load(folder);
}

/**
 * The automation's run ended (#259): a successful `text` becomes the document, kept as the version
 * automation-<column> (the document it replaces is kept too); a document edited since the
 * automation started is left alone, the result is only kept as that version. The thread gets
 * { kind: 'automation', name, column, runId, costUsd, status, version, applied } and
 * card.automation ends ('done' or 'failed'). Returns the card.
 */
function recordAutomation(dir, projectId, id, { runId = null, name, column, status = 'success', text = '', costUsd = 0 } = {}) {
  const folder = editableCard(dir, projectId, id);
  const label = String(name || 'Automation');
  const result = status === 'success' && !!String(text ?? '').trim();
  const before = load(folder);
  const edited = !!before.automation?.document && before.automation.document !== documentHash(before.document);
  let version = null;
  if (result && !edited) {
    keepDocument(dir, projectId, id, 'before-automation');
    writeFileAtomic(path.join(folder, 'document.md'), String(text));
    version = snapshotVersion(dir, projectId, id, `automation-${column || 'result'}`);
    rescore(folder);
  } else if (result) {
    version = saveVersion(folder, `automation-${column || 'result'}`, String(text));
  }
  const cost = Number.isFinite(Number(costUsd)) ? Number(costUsd) : 0;
  appendConversation(dir, projectId, id, {
    kind: 'automation', name: label, column: column || null, runId: runId ? String(runId) : null, costUsd: cost, status, author: 'automation', version, applied: result && !edited,
    text: result && !edited ? `${label} finished: its result is the document now (version ${version}).`
      : result ? `${label} finished: the document was edited meanwhile, so its result is kept as the version ${version} (restore it to use it).`
        : status === 'success' ? `${label} finished without a document: the card is unchanged.` : `${label} ended ${status}: the card is unchanged.`,
  });
  const card = load(folder);
  card.automation = { ...(card.automation || {}), state: status === 'success' ? 'done' : 'failed', runId: runId ? String(runId) : null, name: label, column: column || null, costUsd: cost, endedAt: now() };
  delete card.automation.document;
  saveCard(folder, card);
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
  const folder = editableCard(dir, projectId, id);
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
  const folder = editableCard(dir, projectId, id);
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

// ---- Grill me (#166) --------------------------------------------------------------------------------
// An interview in the card's thread, with the person who opened it: one question at a time, the
// open points of the card's kind in the rubric's order (clarity.nextQuestion), each a thread entry
// { kind: 'question', author: 'Grill me', grill: <point>, proposal? } that makes the card wait for
// its owner (listWaiting). It ends when the card reaches its bar, when nothing is left to ask, or
// when the person writes anything else in the thread.

// The question the interview waits on: the thread's last entry, when Grill me asked it.
function waitingGrill(dir, projectId, id) {
  const last = readConversation(dir, projectId, id).at(-1);
  return last?.kind === 'question' && last.grill ? last : null;
}

// The bar an interview takes the card to: its own, and in Ready the commit bar when that is
// higher (#258: a card there under 85% is grilled until it can be committed).
function grillBar(dir, projectId, card) {
  const bar = clarity.clarityBar(readBoard(dir, projectId).clarity, card.type);
  return card.column === 'ready' ? Math.max(bar, COMMIT_BAR) : bar;
}

// Asks the card's next open point, or closes the interview with a note. → { card, bar, question }
function askNext(dir, projectId, id, { reached = false } = {}) {
  const card = readCard(dir, projectId, id);
  const bar = grillBar(dir, projectId, card);
  const next = reached ? null : clarity.nextQuestion(card);
  if (!next) {
    const text = reached
      ? `Clarity ${card.clarity.score}%: at or above the bar of ${bar}%. The interview ends here; the card can ${card.column === 'ready' ? 'be committed' : 'move to Ready'}.`
      : `Nothing left to ask: the document covers every point of the rubric for ${card.type}.`;
    appendConversation(dir, projectId, id, { kind: 'note', author: GRILL, text });
    return { card: readCard(dir, projectId, id), bar, question: null };
  }
  const question = appendConversation(dir, projectId, id, {
    kind: 'question', author: GRILL, grill: next.criterion, text: `${next.label}: ${next.question}`, ...(next.proposal ? { proposal: next.proposal } : {}),
  });
  return { card: readCard(dir, projectId, id), bar, question };
}

/**
 * Starts (or goes on with) the card's Grill me interview: asks its next open point in the thread and
 * returns { card, bar, question } (question: the entry asked, the one already waiting, or null when
 * nothing is left to ask).
 */
function grillCard(dir, projectId, id) {
  editableCard(dir, projectId, id);
  const waiting = waitingGrill(dir, projectId, id);
  if (!waiting) return askNext(dir, projectId, id);
  const card = readCard(dir, projectId, id);
  return { card, bar: grillBar(dir, projectId, card), question: waiting };
}

/**
 * Whether Grill me has something to ask the card: under its bar, with an open point of the rubric
 * left (#259: a clarity check entering a column proposes nothing otherwise).
 */
function grillHasQuestion(dir, projectId, id) {
  const card = readCard(dir, projectId, id);
  return (card.clarity?.score ?? 0) < grillBar(dir, projectId, card) && !!clarity.nextQuestion(card);
}

/**
 * The person's answer to the waiting question: written into the card (its acceptance criteria, or
 * a section of its document, kept as a version first), noted in the thread, and the card is scored
 * again. Then the next question, or the end of the interview. → { card, bar, question }
 */
function answerGrill(dir, projectId, id, { text, by = 'owner' } = {}) {
  const waiting = waitingGrill(dir, projectId, id);
  if (!waiting) throw new Error('No Grill me question is waiting for an answer on this card.');
  const answer = String(text ?? '').trim();
  if (!clarity.said(answer)) throw new Error('An answer needs a text, more than a placeholder: end the interview to leave the point open.');
  const fields = clarity.recordAnswer(readCard(dir, projectId, id), waiting.grill, answer);
  if (fields.document !== undefined) keepDocument(dir, projectId, id, 'before-grill');
  const card = updateCard(dir, projectId, id, fields);
  appendConversation(dir, projectId, id, { kind: 'answer', author: String(by || 'owner'), grill: waiting.grill, text: answer });
  return askNext(dir, projectId, id, { reached: card.clarity.score >= grillBar(dir, projectId, card) });
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
  // a committed card comes back committed (#258: never to the board)
  const committed = card.column === COMMITTED;
  if (!committed && !readBoard(dir, projectId).columns.some((c) => c.id === card.column)) card.column = 'inbox';
  card.history = [...(card.history || []), { ts, from: 'archive', to: card.column, by: String(by || 'owner') }];
  card.updated = ts;
  saveCard(target, card);
  placeOnBoard(dir, projectId, id, committed ? null : card.column);
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
  // a committed card is delivery work (#258): it is neither merged away nor rewritten by a merge
  if (from.column === COMMITTED || into.column === COMMITTED) throw new Error('A committed card takes no merge: new learning is a new card linked to it.');
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

// ---- imports (#322) -------------------------------------------------------------------------------
// A document imported into the Inbox (src/discovery-import.js) becomes its cards all or none: they
// are written whole under imports/<batch>/ (never listed), then commit.json says the batch is
// complete, and only then they move into cards/ and onto the board. A batch without commit.json was
// cut before it was complete and is dropped; one with it is finished (finishImports, also after the
// app closed mid-way). The batch's name holds the writing process's pid: a batch another live
// process is still writing is left alone.

const importsDir = (dir, projectId) => path.join(projectDir(dir, projectId), 'imports');

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Moves a complete batch's cards into cards/ (in its order, first in their column), writes the merged
// cards' new text, then removes the batch. Each step can run again: a batch cut while being
// finished is finished by the next call.
function finishBatch(dir, projectId, batch) {
  const { ids = [], merges = [], column = 'inbox', by = 'import' } = JSON.parse(fs.readFileSync(path.join(batch, 'commit.json'), 'utf8'));
  for (const id of ids) {
    const staged = path.join(batch, 'cards', id);
    if (fs.existsSync(staged)) renameWithRetry(staged, cardDir(dir, projectId, id));
  }
  for (const m of merges) {
    if (!fs.existsSync(path.join(cardDir(dir, projectId, m.id), 'card.json'))) continue; // archived meanwhile
    if (readCard(dir, projectId, m.id).column === COMMITTED) continue; // committed meanwhile: kept as it was
    snapshotVersion(dir, projectId, m.id, 'import');
    updateCard(dir, projectId, m.id, { document: m.document, acceptance: m.acceptance });
    appendConversation(dir, projectId, m.id, { kind: 'import', author: by, text: m.note });
  }
  const board = readBoard(dir, projectId);
  const moved = ids.filter((id) => fs.existsSync(path.join(cardDir(dir, projectId, id), 'card.json')));
  for (const c of Object.keys(board.order)) board.order[c] = board.order[c].filter((x) => !moved.includes(x));
  board.order[column] = [...moved, ...(board.order[column] || [])];
  writeBoard(dir, projectId, board);
  fs.rmSync(batch, { recursive: true, force: true });
}

/**
 * Ends the imports a previous session left (#322): a complete batch is finished, an incomplete one
 * is dropped, a batch a live process is still writing is left. Returns the number of batches finished.
 */
function finishImports(dir, projectId) {
  let names = [];
  try { names = fs.readdirSync(importsDir(dir, projectId)); } catch { return 0; }
  let finished = 0;
  for (const name of names) {
    const batch = path.join(importsDir(dir, projectId), name);
    const complete = fs.existsSync(path.join(batch, 'commit.json'));
    if (complete) { finishBatch(dir, projectId, batch); finished++; }
    else if (!processAlive(Number(name.split('-').pop()))) fs.rmSync(batch, { recursive: true, force: true });
  }
  return finished;
}

/**
 * Creates several cards at once, all or none (#322): `cards` [{ title, text, acceptance }]
 * in the order they take at the top of `column` (the Inbox); `merges` [{ id, document, acceptance,
 * note }] the new text of existing cards (a version is kept first, `note` goes to their thread);
 * `file` { name, data: Buffer } attached to every new card (written once, hard-linked into each
 * card when the disk allows it); `history` { by, source } the entry each new card starts with;
 * `note` its first thread entry. Throws, writing nothing, when one card is invalid.
 * Returns { created: [cards], merged: [ids] }.
 */
function importCards(dir, projectId, { cards = [], merges = [], file = null, author = 'owner', type = 'idea', column = 'inbox', history = {}, note = '' } = {}) {
  checkType(type);
  for (const m of merges) editableCard(dir, projectId, m.id);
  if (file && file.data.length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment too large: ${mb(file.data.length)}, the limit is ${mb(MAX_ATTACHMENT_BYTES)}`);
  const titles = cards.map((c) => checkTitle(c.title));
  finishImports(dir, projectId);
  checkColumn(dir, projectId, column);
  const base = path.join(ensureProject(dir, projectId), 'imports');
  const batch = path.join(base, `${Date.now()}-${crypto.randomBytes(2).toString('hex')}-${process.pid}`);
  const ids = [];
  try {
    fs.mkdirSync(path.join(batch, 'cards'), { recursive: true });
    const stored = file ? fileName(file.name) || 'import.txt' : null;
    const source = file ? path.join(batch, stored) : null;
    if (file) writeFileAtomic(source, file.data);
    const ts = now();
    cards.forEach((c, i) => {
      // a millisecond older per card: the lists (newest first) show them in the given order too
      const created = new Date(Date.parse(ts) - i).toISOString();
      const d = new Date(created);
      const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      let id;
      do id = `${day}-${crypto.randomBytes(2).toString('hex')}`;
      while (ids.includes(id) || fs.existsSync(cardDir(dir, projectId, id)) || fs.existsSync(cardDir(dir, projectId, id, 'archive')));
      ids.push(id);
      const folder = path.join(batch, 'cards', id);
      fs.mkdirSync(folder);
      const text = String(c.text ?? '');
      const acceptance = String(c.acceptance ?? '');
      writeFileAtomic(path.join(folder, 'document.md'), text);
      writeFileAtomic(path.join(folder, 'acceptance.md'), acceptance);
      writeFileAtomic(path.join(folder, 'conversation.jsonl'), note ? `${JSON.stringify({ ts, kind: 'import', author: String(history.by || 'import'), text: note })}\n` : '');
      if (file) {
        fs.mkdirSync(path.join(folder, 'attachments'));
        const to = path.join(folder, 'attachments', stored);
        try { fs.linkSync(source, to); } catch { fs.copyFileSync(source, to); }
      }
      writeJson(path.join(folder, 'card.json'), {
        id,
        title: titles[i],
        type,
        column,
        author: String(author || 'owner'),
        created,
        updated: created,
        tags: [],
        clarity: scored({ type, document: text, acceptance }),
        estimate: { usd: null, minutes: null },
        links: { issues: [], release: null },
        history: [{ ts, from: null, to: column, by: String(history.by || 'import'), ...(history.source ? { source: String(history.source) } : {}) }],
      });
    });
    writeJson(path.join(batch, 'commit.json'), { ids, merges, column, by: String(history.by || 'import') });
  } catch (e) {
    fs.rmSync(batch, { recursive: true, force: true });
    throw e;
  }
  // complete: from here the import happens, now or (cut) on the next finishImports
  finishBatch(dir, projectId, batch);
  return { created: ids.map((id) => readCard(dir, projectId, id)), merged: merges.map((m) => m.id) };
}

module.exports = {
  addAttachment,
  answerGrill,
  appendConversation,
  archiveCard,
  AUTOMATION_MODES,
  COLUMNS,
  COMMIT_BAR,
  COMMITTED,
  createCard,
  filedDir,
  finishImports,
  grillCard,
  grillHasQuestion,
  importCards,
  issueCards,
  listArchived,
  listCards,
  listVersions,
  listWaiting,
  markAutomation,
  markCommitted,
  MAX_ATTACHMENT_BYTES,
  mergeCard,
  moveCard,
  readAttachment,
  readBoard,
  readCard,
  readConversation,
  readVersion,
  readyForecast,
  recordAutomation,
  recordResult,
  removeAttachment,
  renderAutomationInputs,
  restoreCard,
  restoreVersion,
  setClarityBar,
  setColumnAutomation,
  setWip,
  snapshotVersion,
  TYPES,
  updateCard,
};
