// #337 (acceptance tests, written before the code): the "Limits tonight" group of the Night watch
// screen (src/renderer/views/nightwatch/nightwatch.js). The view is loaded whole into a vm sandbox
// with app.js's globals stubbed and a tiny fake DOM (as test/renderer-nightwatch.test.js does): #nw-body
// keeps the HTML it is given and turns every element with an id or a data-testid into an object
// that holds the handlers the view wires (found by `#id` or `[data-testid="..."]`).
// What these tests pin down (data-testids shared with the E2E scenarios, kept exactly):
//   nw-limits (the group, in the turn-on form), nw-limits-expand (switch "Expand all limits", off by
//   default), nw-limits-multiplier (select: options 1.5, 2, 3; 2 selected), nw-limits-customize (link),
//   nw-limits-row-context / -cost / -duration / -turns / -budget (one row each, with the day value),
//   nw-limits-summary (off: "Runs keep each workflow's limits"; on: "×2 tonight: context 80M, cost
//   US$ 240, duration 16h, turns ×2; nightly budget US$ 150"), nw-limits-warning ("No nightly budget:
//   nothing caps tonight's spending"), nw-active-limits (the limits in force while the watch is on,
//   with nw-limits-multiplier to change them).
// Data: nightwatch:state `limits` { day: { context, cost, duration, budget }, tonight } (see
// test/service/nightwatch-limits-337.test.js). Turning on with "Expand all limits" calls
// api.setOracleNightWatch({ on: true, ... }) then api.setNightWatchLimits({ multiplier }).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('./i18n-sandbox.js');
const night = require('../src/night-watch');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'nightwatch', 'nightwatch.js'), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const decode = (s) => s.replace(/&times;/g, '×').replace(/&#215;/g, '×').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

const DAY = { context: 40000000, cost: 120, duration: 28800000, budget: 75 };

function element(extra = {}) {
  const listeners = {};
  return {
    onclick: null, onchange: null, onsubmit: null, oninput: null, onkeydown: null, checked: false, disabled: false, dataset: {}, textContent: '', title: '', value: '',
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    insertAdjacentHTML() {},
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    listeners,
    ...extra,
  };
}

// #nw-body: innerHTML kept as text; every tag with an id or a data-testid becomes one fake element
function body() {
  const b = { html: '', ids: {}, testids: {} };
  Object.defineProperty(b, 'innerHTML', {
    get: () => b.html,
    set: (html) => {
      b.html = String(html);
      b.ids = {};
      b.testids = {};
      for (const m of b.html.matchAll(/<(\w+)\b([^>]*)>/g)) {
        const attrs = m[2];
        const id = /\sid="([^"]+)"/.exec(attrs)?.[1];
        const testid = /\sdata-testid="([^"]+)"/.exec(attrs)?.[1];
        if (!id && !testid) continue;
        let value = /\svalue="([^"]*)"/.exec(attrs)?.[1] ?? '';
        if (m[1] === 'select') value = /<option\b[^>]*\bvalue="([^"]*)"[^>]*\sselected\b/.exec(outerHtml(b.html, m.index))?.[1] ?? value;
        const el = element({ id, value, checked: /\schecked\b/.test(attrs), dataset: { testid } });
        if (id) b.ids[id] = el;
        if (testid) b.testids[testid] = el;
      }
    },
  });
  return b;
}

// the HTML of the element whose start tag is at `at`, up to its matching end tag
function outerHtml(html, at) {
  const name = /^<(\w+)/.exec(html.slice(at))[1];
  if (/^(input|img|br|hr|meta|link)$/i.test(name)) return html.slice(at, html.indexOf('>', at) + 1);
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
  re.lastIndex = at;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(at, m.index + m[0].length);
  }
  return html.slice(at);
}
function outerOf(html, testid) {
  const m = new RegExp(`<\\w+\\b[^>]*\\sdata-testid="${testid}"[^>]*>`).exec(html);
  return m ? outerHtml(html, m.index) : null;
}
const textOf = (html, testid) => {
  const o = outerOf(html, testid);
  return o == null ? null : decode(o.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
};

function stateWith({ watch = { on: false, active: false }, day = DAY, tonight = null } = {}) {
  return {
    oracle: true,
    watch,
    permissions: { catalog: night.PERMISSIONS, never: night.NEVER_ALLOWED, allowed: ['retry', 'refresh'], updatedAt: null, defaults: false },
    runs: { active: 1, waiting: 0 },
    loopCap: night.LOOP_CAP,
    simulation: false,
    limits: { day, tonight },
  };
}

function loadView(state, apiOverrides = {}) {
  const box = body();
  const replay = element();
  let view = null;
  const calls = { watch: [], limits: [] };
  const lookup = (sel) => {
    if (sel === '#nw-body') return box;
    if (sel === '#btn-nw-replay') return replay;
    if (sel.startsWith('#')) return box.ids[sel.slice(1)] || null;
    const t = /^\[data-testid="([^"]+)"\]$/.exec(sel);
    return t ? box.testids[t[1]] || null : null;
  };
  const sandbox = {
    esc,
    errMsg: (e) => String(e?.message || e),
    fmtDur: (ms) => `${ms} ms`,
    dateOf: (iso) => String(iso),
    confirmDialog: async () => true,
    showView: () => {},
    state: { view: 'nightwatch' },
    registerView: (v) => { view = v; },
    setInterval: () => 0,
    console,
    TimeZone: {
      current: () => 'UTC',
      inputValue: (d) => new Date(d).toISOString().slice(0, 16),
      nextAt: () => new Date(Date.now() + 8 * 3600e3),
      parseInput: (v) => Date.parse(`${v}:00.000Z`),
    },
    $: lookup,
    document: { querySelectorAll: (sel) => { const e = lookup(sel); return e ? [e] : []; }, querySelector: lookup },
    api: {
      nightWatchState: async () => state.current,
      nightWatchReport: async () => ({ nights: [], baseline: night.BASELINE }),
      setOracleNightWatch: async (...args) => { calls.watch.push(args); return {}; },
      setNightWatchLimits: async (...args) => { calls.limits.push(args); return state.current; },
      ...apiOverrides,
    },
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(src, sandbox);
  assert.ok(view, 'nightwatch.js did not call registerView');
  return { view, box, calls };
}

async function fire(el, type = 'change') {
  assert.ok(el, 'no such control');
  const handler = el[`on${type}`] || (type === 'change' ? el.onclick : null);
  if (handler) await handler({ target: el, preventDefault() {}, stopPropagation() {} });
  for (const fn of el.listeners[type] || el.listeners.click || []) await fn({ target: el, preventDefault() {}, stopPropagation() {} });
}
const byTestid = (box, id) => box.testids[id];

// the screen with the turn-on form open (the switch ticked while the watch is off)
async function openForm(state) {
  const loaded = loadView(state);
  loaded.view.mount();
  await loaded.view.show();
  const sw = loaded.box.ids['nw-switch'];
  sw.checked = true;
  await fire(sw);
  return loaded;
}
async function expand(box) {
  const sw = byTestid(box, 'nw-limits-expand');
  assert.ok(sw, 'no nw-limits-expand switch');
  sw.checked = true;
  await fire(sw);
}

test('#337 the turn-on form has a "Limits tonight" group; off by default it says runs keep each workflow\'s limits', async () => {
  const { box } = await openForm({ current: stateWith() });
  assert.ok(outerOf(box.html, 'nw-limits'), 'no nw-limits group in the form');
  assert.match(textOf(box.html, 'nw-limits'), /Limits tonight/);
  assert.match(outerOf(box.html, 'nw-limits-expand'), /^<input\b/);
  assert.equal(byTestid(box, 'nw-limits-expand').checked, false);
  assert.equal(textOf(box.html, 'nw-limits-summary'), 'Runs keep each workflow\'s limits');
});

test('#337 "Expand all limits" offers ×1.5, ×2 and ×3, with ×2 selected', async () => {
  const { box } = await openForm({ current: stateWith() });
  await expand(box);
  const select = outerOf(box.html, 'nw-limits-multiplier');
  assert.ok(select, 'no nw-limits-multiplier');
  assert.deepEqual([...select.matchAll(/<option\b[^>]*\bvalue="([^"]*)"/g)].map((m) => m[1]), ['1.5', '2', '3']);
  assert.equal(byTestid(box, 'nw-limits-multiplier').value, '2');
});

test('#337 expanded, the summary is one line with tonight\'s values and the nightly budget', async () => {
  const { box } = await openForm({ current: stateWith() });
  await expand(box);
  assert.equal(textOf(box.html, 'nw-limits-summary'), '×2 tonight: context 80M, cost US$ 240, duration 16h, turns ×2; nightly budget US$ 150');
  assert.equal(outerOf(box.html, 'nw-limits-warning'), null, 'a nightly budget is set: no warning');
});

test('#337 picking ×3 updates the summary', async () => {
  const { box } = await openForm({ current: stateWith() });
  await expand(box);
  const sel = byTestid(box, 'nw-limits-multiplier');
  sel.value = '3';
  await fire(sel);
  assert.match(textOf(box.html, 'nw-limits-summary'), /^×3 tonight: context 120M, cost US\$ 360, duration 24h, turns ×3/);
});

test('#337 without a nightly budget the group warns that nothing caps tonight\'s spending', async () => {
  const { box } = await openForm({ current: stateWith({ day: { ...DAY, budget: null } }) });
  await expand(box);
  assert.match(textOf(box.html, 'nw-limits-warning') || '', /^No nightly budget: nothing caps tonight's spending\.?$/);
});

test('#337 Customize opens one row per limit, each with its day value', async () => {
  const { box } = await openForm({ current: stateWith() });
  await expand(box);
  await fire(byTestid(box, 'nw-limits-customize'), 'click');
  for (const row of ['context', 'cost', 'duration', 'turns', 'budget']) assert.ok(outerOf(box.html, `nw-limits-row-${row}`), `no nw-limits-row-${row}`);
  assert.match(textOf(box.html, 'nw-limits-row-context'), /40M/);
  assert.match(textOf(box.html, 'nw-limits-row-cost'), /US\$ 120/);
  assert.match(textOf(box.html, 'nw-limits-row-duration'), /8h/);
  assert.match(textOf(box.html, 'nw-limits-row-budget'), /US\$ 75/);
});

test('#337 turning on with ×3 expanded turns the watch on, then sends the limits', async () => {
  const state = { current: stateWith() };
  const { box, calls } = await openForm(state);
  await expand(box);
  const sel = byTestid(box, 'nw-limits-multiplier');
  sel.value = '3';
  await fire(sel);
  await box.ids['nw-form'].onsubmit({ preventDefault() {} });
  assert.equal(calls.watch.length, 1);
  assert.equal(calls.watch[0][0].on, true);
  assert.equal(calls.limits.length, 1);
  assert.equal(calls.limits[0][0].multiplier, 3);
});

test('#337 turning on without expanding sends no limits', async () => {
  const state = { current: stateWith() };
  const { box, calls } = await openForm(state);
  await box.ids['nw-form'].onsubmit({ preventDefault() {} });
  assert.equal(calls.watch.length, 1);
  assert.equal(calls.limits.length, 0);
});

test('#337 while the watch is on the screen shows the limits in force, changeable', async () => {
  const until = new Date(Date.now() + 6 * 3600e3).toISOString();
  const state = { current: stateWith({ watch: { on: true, active: true, until, startedAt: new Date().toISOString(), by: 'the owner', selfHealing: false }, tonight: { multiplier: 2 } }) };
  const { view, box } = loadView(state);
  view.mount();
  await view.show();
  assert.match(textOf(box.html, 'nw-active-limits') || '', /×2 tonight: context 80M, cost US\$ 240, duration 16h, turns ×2; nightly budget US\$ 150/);
  assert.ok(outerOf(outerOf(box.html, 'nw-active-limits'), 'nw-limits-multiplier'), 'the active limits can be changed (nw-limits-multiplier)');
});

const watchOn = () => ({ on: true, active: true, until: new Date(Date.now() + 6 * 3600e3).toISOString(), startedAt: new Date().toISOString(), by: 'the owner', selfHealing: false });

test('#337 a multiplier refused on the active view shows the reason and the select can be used again', async () => {
  const state = { current: stateWith({ watch: watchOn(), tonight: { multiplier: 2 } }) };
  const { view, box } = loadView(state, { setNightWatchLimits: async () => { throw new Error('Limits refused: the Night watch has ended'); } });
  view.mount();
  await view.show();
  const sel = byTestid(box, 'nw-limits-multiplier');
  sel.value = '3';
  await fire(sel);
  await new Promise((resolve) => setImmediate(resolve)); // the change handler does not return the save's promise
  assert.match(box.html, /Limits refused: the Night watch has ended/);
  const select = outerOf(outerOf(box.html, 'nw-active-limits') || '', 'nw-limits-multiplier') || '';
  assert.ok(select, 'the active limits still offer the multiplier');
  assert.doesNotMatch(select.slice(0, select.indexOf('>') + 1), /\sdisabled\b/);
});

test('#337 a custom nightly budget with no nightly budget set is not shown as a cap: the warning stays', async () => {
  const state = { current: stateWith({ watch: watchOn(), day: { ...DAY, budget: null }, tonight: { values: { context: 60000000, budget: 200 } } }) };
  const { view, box } = loadView(state);
  view.mount();
  await view.show();
  const text = textOf(box.html, 'nw-active-limits') || '';
  assert.match(text, /No nightly budget: nothing caps tonight's spending/);
  assert.doesNotMatch(text, /nightly budget US\$/);
});
