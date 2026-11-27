// #110 acceptance, written before the code: most of the Night watch screen (fronts/ai/views/nightwatch/nightwatch.js)
// reads in English in the pt-BR interface: its checklist shows the engine's English permission table
// (packages/engine/domains/night/night-watch.js PERMISSIONS: label, does, undo; NEVER_ALLOWED: label) as it came.
// Loaded as renderer-nightwatch.test.js loads it (a vm sandbox, a tiny fake DOM); window.api answers what
// nightwatch:state answers (the engine's own tables).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');
const night = require('@craftorio/engine/domains/night/night-watch');

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const src = fs.readFileSync(pageFileOf('views/nightwatch/nightwatch.js'), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const element = () => ({
  onclick: null, onchange: null, checked: false, disabled: false, dataset: {}, textContent: '', title: '', value: '',
  classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, insertAdjacentHTML() {},
});

async function screenIn(lang) {
  I18n.setLanguage(lang);
  const box = { html: '', ids: {} };
  Object.defineProperty(box, 'innerHTML', {
    get: () => box.html,
    set: (html) => { box.html = String(html); box.ids = {}; for (const m of box.html.matchAll(/\sid="([^"]+)"/g)) box.ids[m[1]] = element(); },
  });
  let view = null;
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
    $: (sel) => (sel === '#nw-body' ? box : sel.startsWith('#') ? box.ids[sel.slice(1)] || element() : null),
    document: { querySelectorAll: () => [] },
    api: {
      nightWatchState: async () => ({
        oracle: true,
        watch: { on: false, active: false },
        permissions: { catalog: night.PERMISSIONS, never: night.NEVER_ALLOWED, allowed: ['retry', 'refresh'], updatedAt: null, defaults: true },
        runs: { active: 0, waiting: 0 },
        loopCap: night.LOOP_CAP,
        simulation: false,
      }),
      nightWatchReport: async () => ({ nights: [], baseline: night.BASELINE }),
      saveNightWatchPermissions: async () => null,
    },
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(src, sandbox);
  assert.ok(view, 'nightwatch.js calls registerView');
  view.mount();
  await view.show();
  return box.html;
}

test.afterEach(() => I18n.setLanguage('en'));

test('#110 Night watch in pt-BR: no permission of the checklist reads in the engine\'s English (label, what it does, its undo)', async () => {
  const html = await screenIn('pt-BR');
  assert.equal(html.includes('nw-perm-check'), true, 'the checklist is drawn');
  const english = night.PERMISSIONS.flatMap((p) => [p.label, p.does, p.undo]).filter((s) => html.includes(esc(s)));
  assert.deepEqual(english, []);
});

test('#110 Night watch in pt-BR: what the watch is never allowed to do does not read in English', async () => {
  const html = await screenIn('pt-BR');
  const english = night.NEVER_ALLOWED.map((p) => p.label).filter((s) => html.includes(esc(s)));
  assert.deepEqual(english, []);
});

test('#110 guard: Night watch in English still shows the permissions\' labels', async () => {
  const html = await screenIn('en');
  assert.equal(html.includes(esc(night.PERMISSIONS[0].label)), true);
});
