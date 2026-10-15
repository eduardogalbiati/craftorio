// Backlog import (#322): a document (.md/.txt, picked, dropped or pasted on the Inbox screen) becomes
// the project's Inbox cards, one per item, after the owner previews them. No model is called: the
// document is cut deterministically (splitDocument):
//   - each heading of the highest level present is an item (a lone top heading over deeper ones is
//     the document's title, not an item); lower headings, paragraphs and lists are its text;
//   - without headings, each top-level list item (`-`, `*`, `+`, `1.`) is one, its sub-items its text;
//   - checkbox lines (`- [ ] x`, `- [x] x`) under an item are its acceptance criteria, not its text;
//   - plain prose is one item, with a note saying so; an empty document gives none, and a note.
// Lines inside code fences are text, never headings, items or criteria. CRLF reads as LF.
// The preview's edits are pure (renameItem, dropItem, mergeItems, nestItem; applyEdit for the
// channel), previewImport adds each item's clarity (the score the card will get, src/clarity.js) and
// marks a duplicate (a title equal to an open card's or an open synced issue's, case, punctuation and
// spaces ignored) and writes nothing. importItems writes the confirmed items all or none
// (discovery.importCards): `idea` cards at the top of the Inbox in the document's order, the source
// file attached to each, a history entry { by: 'import', source, ts }; an item may be skipped or
// merged into an existing card instead. Used by the discovery:import-* channels
// (src/service/channels/discovery.js); cards stay private: an import never files an issue (#261).

const clarity = require('./clarity');
const discovery = require('./discovery');

// over this many cards an import asks first (importItems' confirmLarge)
const MAX_IMPORT_ITEMS = 200;
const ACTIONS = ['keep', 'skip', 'merge'];

// on lines without trailing spaces (splitDocument trims them): no pattern backtracks over a long line
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const CLOSING_HASHES = /\s#+$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const CHECKBOX = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\][ \t]+(.*)$/;
const BOX = /^\[[ xX]\][ \t]+/;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const join = (...parts) => parts.map((s) => String(s ?? '').trim()).filter(Boolean).join('\n\n');
const indent = (line) => /^[ \t]*/.exec(line)[0].replace(/\t/g, '    ').length;

// An item's title from a heading or a list line: no checkbox, no closing #s, no wrapping emphasis,
// no final colon.
function cleanTitle(text) {
  return String(text ?? '').replace(BOX, '').replace(CLOSING_HASHES, '').trim().replace(/^(\*\*|__)(.+)\1$/, '$2').replace(/:$/, '').trim();
}

// The smallest number of a list (Infinity when empty); a loop, as Math.min(...list) overflows the
// stack on a very long document.
function least(numbers) {
  let min = Infinity;
  for (const n of numbers) if (n < min) min = n;
  return min;
}

// The lines without their common indentation, joined; runs of blank lines become one.
function tidy(lines) {
  const used = lines.filter((l) => l.trim());
  const cut = used.length ? least(used.map(indent)) : 0;
  const out = lines.map((l) => {
    let i = 0;
    let width = 0;
    while (i < l.length && width < cut && (l[i] === ' ' || l[i] === '\t')) { width += l[i] === '\t' ? 4 : 1; i++; }
    return l.slice(i).trimEnd();
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// An item's body: its checkbox lines are the acceptance criteria, the rest its text.
function body(lines) {
  const acceptance = [];
  const rest = [];
  let fence = false;
  for (const line of lines) {
    if (FENCE.test(line)) fence = !fence;
    const box = !fence && CHECKBOX.exec(line);
    if (box && box[1]) acceptance.push(box[1]);
    else rest.push(line);
  }
  return { text: tidy(rest), acceptance };
}

// Which lines are inside a code fence (the fence lines included).
function fencedLines(lines) {
  let open = false;
  return lines.map((l) => {
    if (FENCE.test(l)) { open = !open; return true; }
    return open;
  });
}

// The first sentence of the first line, as a title for a document without structure.
function proseTitle(lines) {
  const first = cleanTitle(String(lines.find((l) => l.trim()) || '').replace(/^\s*(#{1,6}|[-*+]|\d{1,9}[.)])\s+/, ''));
  const sentence = first.split(/(?<=[.!?])\s/)[0];
  return sentence.length <= 80 ? sentence : `${sentence.slice(0, 80).replace(/\s+\S*$/, '')}…`;
}

/**
 * Cuts a document into import items. → { items: [{ title, text, acceptance }], structured, note }
 * `name`: the file's name, for the note (else "The text").
 */
function splitDocument(text, { name } = {}) {
  const label = name ? String(name) : 'The text';
  const lines = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd());
  if (!lines.some((l) => l.trim())) return { items: [], structured: false, note: `${label} is empty: there is nothing to import.` };
  const fenced = fencedLines(lines);
  const cut = (starts, titleOf) => starts.map((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    return { title: titleOf(start), ...body(lines.slice(start + 1, end)) };
  });
  const preambleNote = (before) => (before.some((l) => l.trim()) ? ' The text before the first item is not part of any item.' : '');

  const heads = [];
  lines.forEach((l, i) => {
    const m = !fenced[i] && HEADING.exec(l);
    if (m && cleanTitle(m[2])) heads.push({ i, level: m[1].length, title: cleanTitle(m[2]) });
  });
  if (heads.length) {
    let level = least(heads.map((h) => h.level));
    let docTitle = null;
    // a lone heading over deeper ones is the document's title ("# Backlog", then "## item"s)
    while (heads.filter((h) => h.level === level).length === 1 && heads.some((h) => h.level > level)) {
      docTitle = docTitle || heads.find((h) => h.level === level).title;
      level = least(heads.filter((h) => h.level > level).map((h) => h.level));
    }
    // an item ends at the next heading of its level or above
    const starts = heads.filter((h) => h.level <= level);
    const titles = new Map(starts.map((h) => [h.i, h.title]));
    const items = cut(starts.map((h) => h.i), (i) => titles.get(i))
      .filter((_, k) => starts[k].level === level);
    // the text before the first item, without the document's title
    const first = heads.find((h) => h.level === level).i;
    const above = new Set(heads.filter((h) => h.i < first && h.level < level).map((h) => h.i));
    const before = lines.slice(0, first).filter((_, i) => !above.has(i));
    const titleNote = docTitle ? ` "${docTitle}" is the document's title, not an item.` : '';
    return { items, structured: true, note: `${plural(items.length, 'item')} in ${label}, one per "${'#'.repeat(level)}" heading.${titleNote}${preambleNote(before)}` };
  }

  const listed = lines.map((l, i) => (!fenced[i] && LIST.exec(l)) || null);
  const top = least(listed.filter((m) => m && cleanTitle(m[2])).map((m) => indent(m[1])));
  const starts = listed.map((m, i) => (m && indent(m[1]) === top && cleanTitle(m[2]) ? i : -1)).filter((i) => i >= 0);
  if (starts.length) {
    const items = cut(starts, (i) => cleanTitle(listed[i][2]));
    return { items, structured: true, note: `${plural(items.length, 'item')} in ${label}, one per top-level list item.${preambleNote(lines.slice(0, starts[0]))}` };
  }

  return {
    items: [{ title: proseTitle(lines), ...body(lines) }],
    structured: false,
    note: `${label} has no headings and no top-level list: it is one item. Rename it here, or give the document headings or a list and import it again.`,
  };
}

// ---- the preview's edits: pure, a new array each time -------------------------------------------

function checkIndex(items, index) {
  if (!Array.isArray(items) || !Number.isInteger(index) || index < 0 || index >= items.length) throw new Error(`No item ${index} in this import.`);
}
const criteria = (item) => (Array.isArray(item?.acceptance) ? item.acceptance : []).map((c) => String(c ?? '').trim()).filter(Boolean);

/** The items with the title of the item at `index` changed. */
function renameItem(items, index, title) {
  checkIndex(items, index);
  const t = String(title ?? '').trim();
  if (!t) throw new Error('An item needs a title.');
  return items.map((it, i) => (i === index ? { ...it, title: t } : it));
}

/** The items without the one at `index`. */
function dropItem(items, index) {
  checkIndex(items, index);
  return items.filter((_, i) => i !== index);
}

// The item at `index` folded into the one at `into` (its text made by `text`), and removed.
function fold(items, index, into, text) {
  checkIndex(items, index);
  checkIndex(items, into);
  if (index === into) throw new Error('An item cannot be joined with itself.');
  const from = items[index];
  return items
    .map((it, i) => (i === into ? { ...it, text: text(it, from), acceptance: [...criteria(it), ...criteria(from)] } : it))
    .filter((_, i) => i !== index);
}

/** The item at `index` merged into the one at `into`: its text and criteria appended there (same idea, the target's title). */
function mergeItems(items, index, into) {
  return fold(items, index, into, (to, from) => join(to.text, from.text));
}

/** The item at `index` moved under the one at `parent`: its title (a sub-heading) and text end the parent's text, its criteria join the parent's. */
function nestItem(items, index, parent) {
  return fold(items, index, parent, (to, from) => join(to.text, `### ${from.title}`, from.text));
}

/** One preview edit by name (the channel's): { op: 'rename' | 'drop' | 'merge' | 'nest', index, to, title }. */
function applyEdit(items, { op, index, to, title } = {}) {
  if (op === 'rename') return renameItem(items, index, title);
  if (op === 'drop') return dropItem(items, index);
  if (op === 'merge') return mergeItems(items, index, to);
  if (op === 'nest') return nestItem(items, index, to);
  throw new Error(`Unknown import edit: ${op}`);
}

// ---- preview and import ---------------------------------------------------------------------------

// A card's acceptance.md from the criteria: one checklist line each.
const acceptanceText = (list) => (list.length ? `${list.map((c) => `- [ ] ${c}`).join('\n')}\n` : '');
// What a created card holds of the item (the preview scores the same text).
const cardText = (item) => ({ type: 'idea', document: String(item?.text ?? ''), acceptance: acceptanceText(criteria(item)) });
// a title as compared for duplicates: case, accents, punctuation and spaces ignored
const titleKey = (t) => String(t ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The items as the preview shows them, in the same order: each with `clarity` (0-100, the score its
 * card will get) and `duplicate` (null, { kind: 'card', id, title } for an open card of the project,
 * or { kind: 'issue', number, title, url } for an open issue of `issues`, the synced backlog). Writes nothing.
 */
function previewImport(dir, projectId, items, { issues = [] } = {}) {
  const known = new Map();
  for (const c of discovery.listCards(dir, projectId)) {
    if (c.column !== discovery.COMMITTED && !known.has(titleKey(c.title))) known.set(titleKey(c.title), { kind: 'card', id: c.id, title: c.title });
  }
  for (const i of Array.isArray(issues) ? issues : []) {
    if (!/^open/i.test(String(i?.state || '')) || known.has(titleKey(i.title))) continue;
    known.set(titleKey(i.title), { kind: 'issue', number: i.number, title: i.title, url: i.url || null });
  }
  return (items || []).map((it) => ({ ...it, clarity: clarity.scoreClarity(cardText(it)).score, duplicate: known.get(titleKey(it.title)) || null }));
}

/**
 * Writes the confirmed items, all or none. `item.action`: 'keep' (a new card, the default), 'skip',
 * or 'merge' with `into` (an existing card's id: its document and criteria gain the item's).
 * `source`: { name, data } (the file, attached to every new card; data a Buffer or the text) or
 * { pasted: true }. More than MAX_IMPORT_ITEMS new cards need `confirmLarge`.
 * → { created: [cards], merged: [card ids], skipped }
 */
function importItems(dir, projectId, items, { source, author = 'owner', confirmLarge = false } = {}) {
  if (!Array.isArray(items)) throw new Error('An import needs a list of items.');
  const plan = items.map((item, i) => {
    const action = item?.action || 'keep';
    if (!ACTIONS.includes(action)) throw new Error(`Item ${i + 1}: unknown action ${action} (keep, skip or merge).`);
    if (action !== 'skip' && !String(item.title ?? '').trim()) throw new Error(`Item ${i + 1} has no title.`);
    if (action === 'merge' && !item.into) throw new Error(`Item ${i + 1}: a merge needs the card to merge into.`);
    return { ...item, action, title: String(item.title ?? '').trim() };
  });
  const keep = plan.filter((p) => p.action === 'keep');
  if (keep.length > MAX_IMPORT_ITEMS && !confirmLarge) {
    throw new Error(`This import creates ${keep.length} cards, more than ${MAX_IMPORT_ITEMS}: confirm to create them all.`);
  }
  const name = source?.name ? String(source.name).split(/[\\/]/).pop() : '';
  const label = name || 'pasted';
  const from = name || 'pasted text';
  const merges = new Map();
  for (const p of plan.filter((x) => x.action === 'merge')) {
    if (!merges.has(p.into)) {
      const card = discovery.readCard(dir, projectId, p.into);
      merges.set(p.into, { id: card.id, document: card.document, acceptance: card.acceptance, titles: [] });
    }
    const m = merges.get(p.into);
    m.document = `${join(m.document, `## From the import of ${from}: ${p.title}`, p.text)}\n`;
    const added = acceptanceText(criteria(p));
    if (added) m.acceptance = m.acceptance.trim() ? `${m.acceptance.trimEnd()}\n${added}` : added;
    m.titles.push(p.title);
  }
  const file = name && source.data !== undefined && source.data !== null
    ? { name, data: Buffer.isBuffer(source.data) ? source.data : Buffer.from(String(source.data), 'utf8') }
    : null;
  const { created, merged } = discovery.importCards(dir, projectId, {
    cards: keep.map((p) => ({ title: p.title, text: cardText(p).document, acceptance: cardText(p).acceptance })),
    merges: [...merges.values()].map(({ titles, ...m }) => ({ ...m, note: `Imported ${titles.map((t) => `"${t}"`).join(', ')} from ${from} into this card.` })),
    file,
    author,
    history: { by: 'import', source: label },
    note: `Imported from ${from}.`,
  });
  return { created, merged, skipped: plan.length - keep.length - plan.filter((p) => p.action === 'merge').length };
}

module.exports = {
  applyEdit,
  dropItem,
  importItems,
  MAX_IMPORT_ITEMS,
  mergeItems,
  nestItem,
  previewImport,
  renameItem,
  splitDocument,
};
