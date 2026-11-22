// #634 (spec R12, mockup mock-8) Monitor › Errors: the screen lists the project's error groups with
// their state, the sources and the automation line. Acceptance tests, written before the code.
//
// Seams assumed (the view, fronts/ai/views/errors/errors.js, found with scripts/source-tree pageFile):
// - registerView({ id: 'errors', nav: { label: 'Errors', group: 'monitor', ... }, markup, mount?, show }).
//   markup() holds the page head (h1 "Errors", a "Sources…" button) and an empty <div id="errors-body">;
//   show() reads api.monitorState({ projectId }) (the project from window.CurrentProject) and renders the
//   groups and the automation line into #errors-body.
// - Each row's action is a <button> with data-action="propose-fix" | "diagnose" and
//   data-fingerprint="<the group's fingerprint>"; a click on it (its own onclick, or a click listener
//   delegated on #errors-body) calls api.monitorProposeFix / api.monitorDiagnose({ projectId, fingerprint }).
// Loaded whole in a vm sandbox (as test/renderer-nightwatch.test.js) with app.js's globals stubbed and a
// tiny fake DOM: #errors-body keeps the HTML it is given; its <button>s become fake elements. window.api
// is a stub; the assertions are on the rendered markup and text (strings).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');

const ROOT = path.join(__dirname, '..', '..', '..');
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(ROOT, rel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATE = {
  groups: [
    { fingerprint: 'fp-checkout', title: 'POST /api/checkout', status: 500, message: "TypeError: cannot read 'total' of undefined", where: 'checkout.js:412', count: 212, state: 'intent', cardId: 'c-1' },
    { fingerprint: 'fp-orders', title: 'GET /api/orders/:id', status: 500, message: 'timeout after 30s', where: null, count: 31, state: 'fix-run', runId: 'r-9' },
    { fingerprint: 'fp-refund', title: 'worker: refund-sync', status: 'ERR', message: 'KeyError currency', where: 'refund.py:88', count: 6, state: 'new' },
  ],
  sources: [{ id: 's1', type: 'sentry', label: 'Sentry', hasToken: true }, { id: 's2', type: 'log-url', label: 'api logs', hasToken: false }],
  automation: { diagnose: 'ask', fix: 'off', dailyCap: 5 },
};

const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const dataOf = (attrs) => Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-'))
  .map(([k, v]) => [k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()), v]));

function element(extra = {}) {
  const el = {
    onclick: null, onchange: null, listeners: {}, dataset: {}, attrs: {}, textContent: '', value: '', disabled: false, checked: false,
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    insertAdjacentHTML() {},
    addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return el.attrs[k] ?? null; },
    closest() { return el; },
    querySelector: () => null,
    querySelectorAll: () => [],
    ...extra,
  };
  return el;
}

// a simple selector against a parsed tag: tag name, .class, [attr] or [attr="v"], comma lists
function matches(sel, { name, attrs }) {
  return sel.split(',').some((part) => {
    const s = part.trim();
    const tag = /^[a-z]+/i.exec(s)?.[0];
    if (tag && tag.toLowerCase() !== name) return false;
    for (const [, cls] of s.matchAll(/\.([\w-]+)/g)) if (!(attrs.class || '').split(/\s+/).includes(cls)) return false;
    for (const [, k, v] of s.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)) {
      if (!(k in attrs) || (v !== undefined && attrs[k] !== v)) return false;
    }
    return true;
  });
}

// #errors-body: its innerHTML kept as text; its buttons become fake elements (the same ones until the HTML changes)
function body() {
  const b = element({ html: '', buttons: [] });
  Object.defineProperty(b, 'innerHTML', {
    get: () => b.html,
    set: (html) => {
      b.html = String(html);
      b.buttons = [...b.html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => {
        const attrs = attrsOf(m[1]);
        const el = element({ name: 'button', attrs, dataset: dataOf(attrs), textContent: m[2].replace(/<[^>]+>/g, '').trim() });
        el.closest = (sel) => (matches(sel, el) ? el : null);
        return el;
      });
    },
  });
  b.querySelectorAll = (sel) => b.buttons.filter((el) => matches(sel, el));
  b.querySelector = (sel) => b.querySelectorAll(sel)[0] || null;
  return b;
}

function loadView(apiOver = {}) {
  const file = pageFileOf('views/errors/errors.js');
  assert.ok(file && fs.existsSync(file), 'views/errors/errors.js is missing (the Errors screen of #634)');
  const src = fs.readFileSync(file, 'utf8');
  const box = body();
  const others = new Map(); // any other element the view asks for
  const other = (sel) => { if (!others.has(sel)) others.set(sel, element()); return others.get(sel); };
  const calls = [];
  let view = null;
  const known = {
    monitorState: async (...a) => { calls.push(['monitorState', ...a]); return JSON.parse(JSON.stringify(STATE)); },
    monitorProposeFix: async (...a) => { calls.push(['monitorProposeFix', ...a]); return { ok: true, runId: 'r-10' }; },
    monitorDiagnose: async (...a) => { calls.push(['monitorDiagnose', ...a]); return { ok: true, cardId: 'c-2' }; },
    listProjects: async () => [{ id: 'p1', name: 'Shop' }],
    ...apiOver,
  };
  const api = new Proxy(known, { get: (o, k) => (k in o ? o[k] : (typeof k === 'string' && k.startsWith('on') ? () => {} : async () => ({ ok: true }))) });
  const query = (sel) => (sel === '#errors-body' ? box : other(sel));
  const sandbox = {
    esc,
    errMsg: (e) => String(e?.message || e),
    fmtDur: (ms) => `${ms} ms`,
    dateOf: (iso) => String(iso),
    fmtRelative: (iso) => String(iso),
    confirmDialog: async () => true,
    showView: () => {},
    toast: () => {},
    state: { view: 'errors', projects: [{ id: 'p1', name: 'Shop' }], settings: {} },
    registerView: (v) => { view = v; },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    console,
    CurrentProject: { get: () => 'p1', resolve: async () => 'p1', set() {}, refresh: () => 'p1' },
    $: query,
    $$: (sel) => box.querySelectorAll(sel),
    document: { querySelector: query, querySelectorAll: (sel) => box.querySelectorAll(sel), getElementById: (id) => query(`#${id}`), createElement: () => element(), addEventListener() {} },
    api,
    // the ui-kit's Select (loaded early in the app): the item select is built with Select.markup (#383)
    Select: require(path.join(ROOT, 'packages', 'ui-kit', 'select.js')),
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(src, sandbox);
  assert.ok(view, 'errors.js did not call registerView');
  return { view, box, calls };
}

async function shown(apiOver) {
  const v = loadView(apiOver);
  await v.view.mount?.();
  await v.view.show?.();
  await new Promise((r) => setImmediate(r));
  assert.ok(v.box.html.length > 0, 'show() rendered nothing into #errors-body');
  return v;
}

const textOf = (html) => String(html).replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

// a row's text: from its title to the next title, or to the automation line after the last row
function rowText(text, title) {
  const start = text.indexOf(title);
  assert.ok(start >= 0, `"${title}" is not shown`);
  const ends = [...STATE.groups.map((g) => text.indexOf(g.title)), text.search(/automation/i), text.indexOf('Ask me')].filter((i) => i > start);
  return text.slice(start, ends.length ? Math.min(...ends) : undefined);
}

const buttonsOf = (box, action) => box.buttons.filter((b) => b.dataset.action === action).map((b) => `${b.dataset.fingerprint} ${b.textContent}`);

test('#634 the view registers as errors, in the Monitor group, labelled Errors', () => {
  const { view } = loadView();
  assert.equal(view.id, 'errors');
  assert.equal(view.nav?.group, 'monitor');
  assert.equal(view.nav?.label, 'Errors');
});

test('#634 the page head says Errors and has a Sources… button', () => {
  const { view } = loadView();
  const markup = typeof view.markup === 'function' ? view.markup() : String(view.markup || '');
  assert.match(textOf(markup), /\bErrors\b/);
  assert.match(markup, /<button\b[^>]*>[^<]*Sources…/);
});

test('#634 each group shows its title, message and count', async () => {
  const { box } = await shown();
  const text = textOf(box.html);
  for (const g of STATE.groups) {
    const row = rowText(text, g.title);
    assert.ok(row.includes(g.message), `row ${g.title}: ${row}`);
    assert.match(row, new RegExp(`\\b${g.count}\\b`), `row ${g.title}: ${row}`);
  }
});

test('#634 each group shows its state badge: intent in Inbox, fix run · waiting for you, new', async () => {
  const { box } = await shown();
  const text = textOf(box.html);
  assert.ok(rowText(text, 'POST /api/checkout').includes('intent in Inbox'));
  assert.ok(rowText(text, 'GET /api/orders/:id').includes('fix run · waiting for you'));
  assert.match(rowText(text, 'worker: refund-sync'), /\bnew\b/);
});

test('#634 the intent row offers Propose fix and the new row Diagnose, each carrying its fingerprint', async () => {
  const { box } = await shown();
  assert.deepEqual(buttonsOf(box, 'propose-fix'), ['fp-checkout Propose fix']);
  assert.deepEqual(buttonsOf(box, 'diagnose'), ['fp-refund Diagnose']);
});

test('#634 the automation line says Ask me, Off and the daily cap 5', async () => {
  const { box } = await shown();
  const text = textOf(box.html);
  const at = text.search(/automation/i) >= 0 ? text.search(/automation/i) : text.indexOf('Ask me');
  const line = text.slice(at);
  assert.ok(line.includes('Ask me'), line);
  assert.ok(line.includes('Off'), line);
  assert.match(line, /\b5\b/);
});

test('#634 a click on Propose fix calls monitorProposeFix with the project and the row\'s fingerprint', async () => {
  const { box, calls } = await shown();
  const btn = box.buttons.find((b) => b.dataset.action === 'propose-fix');
  assert.ok(btn, 'no Propose fix button');
  const ev = { type: 'click', target: btn, currentTarget: box, preventDefault() {}, stopPropagation() {} };
  if (btn.onclick) await btn.onclick(ev);
  else {
    await box.onclick?.(ev);
    for (const fn of box.listeners.click || []) await fn(ev);
  }
  await new Promise((r) => setImmediate(r));
  const fix = calls.filter((c) => c[0] === 'monitorProposeFix').map((c) => `${c[1]?.projectId} ${c[1]?.fingerprint}`);
  assert.deepEqual(fix, ['p1 fp-checkout']);
});

// ---- #650 (spec R16): a new group is tied to a work item before Diagnose ----------------------------

const DOC_ITEMS = [{ item: 'checkout', title: 'Checkout' }, { item: 'search', stage: 'intent' }];
const withItems = { listDocItems: async () => JSON.parse(JSON.stringify(DOC_ITEMS)) };

async function clickDiagnose(box) {
  const btn = box.buttons.find((b) => b.dataset.action === 'diagnose');
  assert.ok(btn, 'no Diagnose button');
  const ev = { type: 'click', target: btn, currentTarget: box, preventDefault() {}, stopPropagation() {} };
  if (btn.onclick) await btn.onclick(ev);
  else {
    await box.onclick?.(ev);
    for (const fn of box.listeners.click || []) await fn(ev);
  }
  await new Promise((r) => setImmediate(r));
}
// the user picks `value` in the item select of the row `fingerprint` (a change event on #errors-body)
async function choose(box, fingerprint, value) {
  const sel = { value, dataset: { fingerprint }, attrs: { 'data-testid': 'monitor-item-select', 'data-fingerprint': fingerprint } };
  sel.closest = (s) => (matches(s, { name: 'select', attrs: sel.attrs }) ? sel : null);
  const ev = { type: 'change', target: sel, currentTarget: box };
  await box.onchange?.(ev);
  for (const fn of box.listeners.change || []) await fn(ev);
}
const selectsOf = (html) => [...String(html).matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)]
  .map((m) => ({ attrs: attrsOf(m[1]), disabled: /\sdisabled\b/.test(m[1]), options: [...m[2].matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map((o) => [attrsOf(o[1]).value, o[2].trim()]) }))
  .filter((s) => s.attrs['data-testid'] === 'monitor-item-select');

test('#650 only the new group gets the item select, listing the Documents\' items by title, with "no item" first', async () => {
  const { box } = await shown(withItems);
  const selects = selectsOf(box.html);
  assert.deepEqual(selects.map((s) => s.attrs['data-fingerprint']), ['fp-refund']);
  assert.deepEqual(selects[0].options.map(([v]) => v), ['', 'checkout', 'search']);
  assert.deepEqual(selects[0].options.slice(1).map(([, label]) => label), ['Checkout', 'search']);
  assert.equal(selects[0].disabled, false);
});

test('#650 the item chosen in the select reaches monitorDiagnose as `item`', async () => {
  const { box, calls } = await shown(withItems);
  await choose(box, 'fp-refund', 'checkout');
  await clickDiagnose(box);
  const diag = calls.filter((c) => c[0] === 'monitorDiagnose').map((c) => [c[1]?.projectId, c[1]?.fingerprint, c[1]?.item]);
  assert.deepEqual(diag, [['p1', 'fp-refund', 'checkout']]);
});

test('#650 without a chosen item, Diagnose sends no item (as in #634)', async () => {
  const { box, calls } = await shown(withItems);
  await clickDiagnose(box);
  const diag = calls.filter((c) => c[0] === 'monitorDiagnose').map((c) => c[1]?.item ?? null);
  assert.deepEqual(diag, [null]);
});

test('#650 a project without Documents items (or without the plan front) shows the select disabled', async () => {
  const { box } = await shown({ listDocItems: async () => { throw new Error('No handler for docs:list'); } });
  const selects = selectsOf(box.html);
  assert.equal(selects.length, 1);
  assert.equal(selects[0].disabled, true);
  assert.deepEqual(selects[0].options.map(([v]) => v), ['']);
});
