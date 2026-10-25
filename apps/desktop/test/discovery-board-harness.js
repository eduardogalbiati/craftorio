// Test helper (not a test) for the Discovery board screen's tests (#257,
// apps/desktop/renderer/views/discovery/discovery.js): the whole page loaded with test/agent-chat-page-harness.js
// (index.html parsed into test/mini-dom.js, every page script in one vm sandbox), the board's
// window.api methods backed by a small in-memory store, the header's project set to 'p1', then
// showView('discovery'). The view's script is run by hand when index.html does not list it yet, so a
// missing view fails the test that opens the board, never the file.
// Used by test/discovery-board-view-257.test.js.
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const { loadPage, settle } = require('@multiagent/ui-kit/test/agent-chat-page-harness');

const VIEW = 'views/discovery/discovery.js';
const P = 'p1';

const COLUMNS = [
  { id: 'inbox', title: 'Inbox', wip: null },
  { id: 'triage', title: 'Triage', wip: null },
  { id: 'shape', title: 'Shape', wip: 5 },
  { id: 'define', title: 'Define', wip: 5 },
  { id: 'ready', title: 'Ready', wip: null },
];

let seq = 0;
/** A card as the store lists it (listCards / readCard). */
function card({ title, type = 'idea', column = 'triage', clarity = null, estimate = null, attachments = [], tags = [], author = 'owner', document = '', acceptance = '' } = {}) {
  seq += 1;
  return {
    id: `20261004-${(0xa000 + seq).toString(16)}`,
    title: title || `Card ${seq}`,
    type,
    column,
    author,
    created: '2026-10-01T10:00:00.000Z',
    updated: '2026-10-02T10:00:00.000Z',
    tags,
    clarity: { score: clarity, gaps: [] },
    estimate: estimate || { usd: null, minutes: null },
    links: { issues: [], release: null },
    history: [{ ts: '2026-10-02T10:00:00.000Z', from: 'inbox', to: column, by: 'owner' }],
    document,
    acceptance,
    attachments,
  };
}

/** The fake store behind the board's api methods; `api` overrides any of them. */
function boardApi({ cards = [], wip = {}, threads = {}, versions = {}, versionText = {}, api = {} } = {}) {
  const store = {
    columns: COLUMNS.map((c) => ({ ...c, wip: c.id in wip ? wip[c.id] : c.wip })),
    cards: new Map(cards.map((c) => [c.id, structuredClone(c)])),
    order: {},
  };
  for (const c of COLUMNS) store.order[c.id] = cards.filter((x) => x.column === c.id).map((x) => x.id);
  const board = () => structuredClone({ columns: store.columns, order: store.order });
  const get = (id) => structuredClone(store.cards.get(id));
  const methods = {
    discoveryBoard: async () => board(),
    listDiscoveryCards: async (_p, column) => [...store.cards.values()].filter((c) => !column || c.column === column).map((c) => structuredClone(c)),
    getDiscoveryCard: async (_p, id) => get(id),
    discoveryConversation: async (_p, id) => structuredClone(threads[id] || []),
    moveDiscoveryCard: async (_p, id, column, index) => {
      const c = store.cards.get(id);
      for (const k of Object.keys(store.order)) store.order[k] = store.order[k].filter((x) => x !== id);
      const list = store.order[column];
      if (Number.isInteger(index) && index >= 0 && index <= list.length) list.splice(index, 0, id); else list.push(id);
      if (c.column !== column) c.history.push({ ts: new Date().toISOString(), from: c.column, to: column, by: 'owner' });
      c.column = column;
      return get(id);
    },
    setDiscoveryWip: async (_p, column, limit) => {
      store.columns.find((c) => c.id === column).wip = Number(limit);
      return board();
    },
    discoveryVersions: async (_p, id) => structuredClone(versions[id] || []),
    discoveryVersion: async (_p, id, name) => versionText[`${id}/${name}`] ?? '',
    restoreDiscoveryVersion: async (_p, id, name) => {
      store.cards.get(id).document = versionText[`${id}/${name}`] ?? '';
      return get(id);
    },
    recordDiscoveryResult: async (_p, id, _source, text) => {
      store.cards.get(id).document = String(text);
      return get(id);
    },
    updateDiscoveryCard: async (_p, id, fields = {}) => {
      Object.assign(store.cards.get(id), fields);
      return get(id);
    },
    ...api,
  };
  return { store, methods };
}

/**
 * Opens the board: the page with the fake api, the project 'p1', the view loaded (by hand when
 * index.html does not list it) and shown. Returns the harness page plus `store` and helpers.
 */
async function openBoard(opts = {}) {
  const { store, methods } = boardApi(opts);
  const page = await loadPage({ api: methods });
  if (!page.sandbox.CurrentProject) page.sandbox.CurrentProject = {};
  page.sandbox.CurrentProject.get = () => P;
  const listed = require('@multiagent/ui-kit/test/renderer-app-harness').pageScripts().includes(VIEW);
  if (!listed) {
    const file = pageFileOf(VIEW);
    if (!fs.existsSync(file)) throw new Error(`${VIEW} does not exist yet`);
    page.run(fs.readFileSync(file, 'utf8'));
  }
  page.run("showView('discovery')");
  await settle(20);
  const board = page.$('[data-testid="discovery-board"]');
  if (!board) throw new Error('showView(\'discovery\') shows no [data-testid="discovery-board"]');
  return Object.assign(page, { store, ...helpers(page) });
}

function helpers(page) {
  const doc = page.document;
  const all = (sel, root = doc) => root.querySelectorAll(sel);
  const inLane = (el) => !!el.closest('[data-testid="discovery-fast-lane"]');
  const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // hidden: removed, or itself / an ancestor carries .hidden, [hidden] or display:none
  const visible = (el) => {
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentNode) {
      if (cur.classList?.contains('hidden') || cur.hasAttribute?.('hidden')) return false;
      if (/display:\s*none/.test(cur.getAttribute?.('style') || '')) return false;
    }
    return !!el;
  };
  // the board's columns (the fast lane's own cells left out)
  const columns = () => all('[data-testid="discovery-column"]').filter((el) => !inLane(el));
  const column = (id) => columns().find((el) => el.getAttribute('data-column') === id) || null;
  const cardEl = (id) => all(`[data-testid="discovery-card"][data-card="${id}"]`)[0] || null;
  const visibleCardIds = () => all('[data-testid="discovery-card"]').filter(visible).map((el) => el.getAttribute('data-card'));
  const cardColumn = (id) => {
    const el = cardEl(id);
    const col = el && el.closest('[data-testid="discovery-column"]');
    return col ? col.getAttribute('data-column') : null;
  };
  const confirmOpen = () => {
    const m = page.$('#confirm-modal');
    return !!m && !m.classList.contains('hidden');
  };
  // "Move to…" on a card, then the menu item named after the column's title
  async function moveTo(id, title) {
    const btn = cardEl(id)?.querySelector('[data-testid="card-move"]');
    if (!btn) throw new Error(`card ${id} has no [data-testid="card-move"]`);
    btn.click();
    await settle();
    const items = all('[role="menuitem"]').filter((el) => text(el) === title && visible(el));
    if (!items.length) throw new Error(`no visible menuitem "${title}" after Move to…`);
    items.at(-1).click();
    await settle(20);
  }
  // drag a card and drop it on a column (one shared dataTransfer, like the browser)
  async function dragTo(id, columnId) {
    const { Event } = page.dom.classes;
    const data = {};
    const dataTransfer = {
      data, types: [], effectAllowed: 'all', dropEffect: 'move', files: [], items: [],
      setData(type, v) { data[type] = String(v); if (!this.types.includes(type)) this.types.push(type); },
      getData(type) { return data[type] ?? ''; },
      clearData() { for (const k of Object.keys(data)) delete data[k]; },
      setDragImage() {},
    };
    const source = cardEl(id);
    const target = column(columnId);
    if (!source || !target) throw new Error(`drag ${id} → ${columnId}: card or column missing`);
    source.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new Event('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true, dataTransfer }));
    source.dispatchEvent(new Event('dragend', { bubbles: true, cancelable: true, dataTransfer }));
    await settle(20);
  }
  async function openCard(id) {
    const el = cardEl(id);
    if (!el) throw new Error(`no card ${id} on the board`);
    (el.querySelector('[data-testid="discovery-card-title"]') || el).click();
    await settle(20);
    const detail = page.$('[data-testid="discovery-card-detail"]');
    if (!detail) throw new Error('a click on a card opens no [data-testid="discovery-card-detail"]');
    return detail;
  }
  // types into an input / select and fires input + change
  async function setField(el, value) {
    const { Event } = page.dom.classes;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350)); // a debounced filter
    await settle(20);
  }
  return { all, text, visible, columns, column, cardEl, cardColumn, visibleCardIds, confirmOpen, moveTo, dragTo, openCard, setField };
}

module.exports = { card, boardApi, helpers, openBoard, settle, P };
