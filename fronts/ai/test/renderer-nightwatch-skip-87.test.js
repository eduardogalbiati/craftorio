// #87 the Night watch screen's checklist for a workspace that never saved its permissions: Skip an item
// unticked, Retry ticked. The state comes from the service (nightwatch:state on a fresh workspace); the
// view (fronts/ai/views/nightwatch/nightwatch.js) is loaded into a vm sandbox with the fake DOM of
// renderer-nightwatch.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');
const { makeService } = require('@craftorio/engine/test/service/helpers');
const night = require('@craftorio/engine/domains/night/night-watch');

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const src = fs.readFileSync(pageFileOf('views/nightwatch/nightwatch.js'), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function element(extra = {}) {
  return {
    onclick: null, onchange: null, onsubmit: null, onkeydown: null, checked: false, disabled: false, dataset: {}, textContent: '', title: '', value: '',
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    insertAdjacentHTML() {},
    ...extra,
  };
}

function body() {
  const b = { html: '', ids: {}, checks: [] };
  Object.defineProperty(b, 'innerHTML', {
    get: () => b.html,
    set: (html) => {
      b.html = String(html);
      b.ids = {};
      for (const m of b.html.matchAll(/\sid="([^"]+)"/g)) b.ids[m[1]] = element();
      b.checks = [...b.html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /\bnw-perm-check\b/.test(tag)).map((tag) => element({
        dataset: { perm: /data-perm="([^"]+)"/.exec(tag)?.[1] },
        checked: /\schecked\b/.test(tag),
      }));
    },
  });
  return b;
}

async function shownChecklist(nightWatchState) {
  const box = body();
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
    $: (sel) => (sel === '#nw-body' ? box : sel === '#btn-nw-replay' ? element() : sel.startsWith('#') ? box.ids[sel.slice(1)] || null : null),
    document: { querySelectorAll: (sel) => (sel === '.nw-perm-check' ? box.checks : []) },
    api: {
      nightWatchState: async () => nightWatchState,
      nightWatchReport: async () => ({ nights: [], baseline: night.BASELINE }),
      saveNightWatchPermissions: async () => nightWatchState,
    },
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(src, sandbox);
  assert.ok(view, 'nightwatch.js did not call registerView');
  view.mount();
  await view.show();
  return Object.fromEntries(box.checks.map((c) => [String(c.dataset.perm), !!c.checked]));
}

test('#87 Night watch screen: a workspace that never saved permissions shows Skip an item off and Retry on', async (t) => {
  const { api } = makeService(t);
  const state = await api['nightwatch:state']();
  const checks = await shownChecklist(state);
  assert.deepEqual({ skip: checks.skip, retry: checks.retry }, { skip: false, retry: true });
});
