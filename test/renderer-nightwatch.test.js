// src/renderer/views/nightwatch/nightwatch.js: the Night watch screen's checklist (#239, Save cleared
// every permission). The view runs only inside the renderer, so it is loaded whole into a vm sandbox
// with app.js's globals stubbed and a tiny fake DOM: #nw-body keeps the HTML it is given and turns its
// ids and checklist boxes into objects with the handlers the view wires (no layout, no real parser).
// window.api is a mock: these tests check what the screen sends and what it shows back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');
const night = require('../src/domains/night/night-watch');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'nightwatch', 'nightwatch.js'), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function element(extra = {}) {
  return {
    onclick: null, onchange: null, onsubmit: null, onkeydown: null, checked: false, disabled: false, dataset: {}, textContent: '', title: '', value: '',
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    insertAdjacentHTML() {},
    ...extra,
  };
}

// #nw-body: innerHTML kept as text; its ids and its .nw-perm-check boxes become fake elements
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

function stateWith(allowed) {
  return {
    oracle: true,
    watch: { on: false, active: false },
    permissions: { catalog: night.PERMISSIONS, never: night.NEVER_ALLOWED, allowed, updatedAt: null, defaults: false },
    runs: { active: 0, waiting: 0 },
    loopCap: night.LOOP_CAP,
    simulation: false,
  };
}

function loadView({ save }) {
  const box = body();
  const replay = element();
  let view = null;
  const calls = [];
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
    $: (sel) => (sel === '#nw-body' ? box : sel === '#btn-nw-replay' ? replay : sel.startsWith('#') ? box.ids[sel.slice(1)] || null : null),
    document: { querySelectorAll: (sel) => (sel === '.nw-perm-check' ? box.checks : []) },
    api: {
      nightWatchState: async () => stateWith(['retry', 'refresh']),
      nightWatchReport: async () => ({ nights: [], baseline: night.BASELINE }),
      saveNightWatchPermissions: async (...args) => { calls.push(args); return save(...args); },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(src, sandbox);
  assert.ok(view, 'nightwatch.js did not call registerView');
  return { view, box, calls };
}

const check = (box, id) => box.checks.find((c) => c.dataset.perm === id);
function tick(box, id) {
  const c = check(box, id);
  assert.ok(c, `no checkbox for ${id}`);
  c.checked = true;
  c.onchange();
}

test('Night watch Save: sends the ticked permissions as a list (not an object) and shows them ticked again', async () => {
  // the service as it behaves: a list is saved; anything else ends up as "nothing allowed"
  const save = (allowed) => stateWith(Array.isArray(allowed) ? night.PERMISSIONS.map((p) => p.id).filter((id) => allowed.includes(id)) : []);
  const { view, box, calls } = loadView({ save });
  view.mount();
  await view.show();
  assert.equal(check(box, 'skip').checked, false);
  tick(box, 'skip');
  tick(box, 'regroup');
  await box.ids['nw-perm-save'].onclick();

  assert.equal(calls.length, 1);
  const [first] = calls[0];
  assert.ok(Array.isArray(first), `saveNightWatchPermissions got ${JSON.stringify(first)}, not a list`);
  assert.deepEqual([...first].sort(), ['refresh', 'regroup', 'retry', 'skip']);
  for (const id of ['retry', 'refresh', 'skip', 'regroup']) assert.equal(check(box, id).checked, true, `${id} is not ticked after Save`);
  assert.equal(check(box, 'commit').checked, false);
});

test('Night watch Save: a refused save shows its error under the checklist and keeps the boxes as ticked', async () => {
  const { view, box } = loadView({ save: async () => { throw new Error('The permissions could not be saved.'); } });
  view.mount();
  await view.show();
  tick(box, 'skip');
  await box.ids['nw-perm-save'].onclick();

  const at = box.html.indexOf('The permissions could not be saved.');
  assert.ok(at >= 0, 'no error message shown');
  assert.match(box.html, /class="[^"]*\berror\b[^"]*"[^>]*>The permissions could not be saved\./);
  assert.ok(at > box.html.indexOf('nw-perm-check'), 'the error is not under the checklist');
  assert.equal(check(box, 'skip').checked, true);
});
