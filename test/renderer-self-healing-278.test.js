// #278 Self-healing in the UI: Settings › Execution › Oracle (src/renderer/views/settings/settings.js) and
// the Night watch screen (src/renderer/views/nightwatch/nightwatch.js). Renderer code runs only in
// Electron, so functions are pulled out of the source and run in a vm sandbox (as in
// test/renderer-settings-oracle.test.js and test/renderer-nightwatch.test.js). Only strings and
// primitives are compared. Acceptance tests written before the code; the seams they pin down:
//   - settings.js: renderOracleSettings() sets `$('#set-oracle-self-healing').checked` from
//     state.settings.oracle.selfHealing (false when missing); saveOracleSettings() saves
//     oracle.selfHealing = that checkbox's `checked`, keeping the other fields.
//   - settings.js: a top-level `function selfHealingHtml(o, nw)` → the row's HTML. `o`: settings.oracle;
//     `nw`: the nightwatch:state result ({ oracle, permissions: { catalog, never, allowed } }). The row
//     has <input type="checkbox" id="set-oracle-self-healing"> (checked when o.selfHealing), the label
//     "Self-healing", the link "What it may do alone (N of M)" (N allowed of M in the catalog), and,
//     when nw.oracle is false (the Oracle cannot start here), the checkbox `disabled` and the reason.
//   - nightwatch.js: with state.watch { active: true, until: null, selfHealing: true } the screen says
//     "Self-healing is on" where the end time was ("On until ..." is not shown).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');
const night = require('../src/domains/night/night-watch');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// #329: the markup lives in settings-markup.js, its texts in the catalog
const { settingsSource, t } = require('./settings-source-329');
const settingsSrc = settingsSource();
const nightSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'nightwatch', 'nightwatch.js'), 'utf8');

// ---- Settings › Oracle -------------------------------------------------------------------------

function input(initial = '') {
  let v = String(initial);
  return { get value() { return v; }, set value(x) { v = String(x); } };
}

function loadOracleSettings(oracle) {
  const render = /function renderOracleSettings\(\) \{[\s\S]*?\n\}/.exec(settingsSrc)?.[0];
  const save = /async function saveOracleSettings\(\) \{[\s\S]*?\n\}/.exec(settingsSrc)?.[0];
  assert.ok(render && save, 'renderOracleSettings/saveOracleSettings not found in settings.js');
  const calls = [];
  const box = { checked: false, disabled: false };
  const els = { '#set-oracle-budget': input('20'), '#set-oracle-compact': input('150000'), '#set-oracle-self-healing': box };
  const sandbox = {
    $: (sel) => els[sel] || null,
    esc,
    t,
    state: { settings: { oracle } },
    api: {
      setSettings: async (patch) => { calls.push(JSON.parse(JSON.stringify(patch))); sandbox.state.settings = { ...sandbox.state.settings, ...patch }; return sandbox.state.settings; },
      nightWatchState: async () => ({ oracle: true, permissions: { catalog: night.PERMISSIONS, never: night.NEVER_ALLOWED, allowed: ['retry', 'refresh'] } }),
    },
  };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(`${render}\n${save}\nthis.renderOracleSettings = renderOracleSettings;\nthis.saveOracleSettings = saveOracleSettings;`, sandbox);
  return { sandbox, box, calls };
}

function selfHealingHtml(o, nw) {
  const m = /function selfHealingHtml\([^)]*\) \{[\s\S]*?\n\}/.exec(settingsSrc);
  assert.ok(m, 'function selfHealingHtml(o, nw) not found in settings.js');
  const sandbox = { esc, t };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(`${m[0]}\nthis.out = selfHealingHtml(${JSON.stringify(o)}, ${JSON.stringify(nw)});`, sandbox);
  return String(sandbox.out);
}
const nwState = (oracle, allowed) => ({ oracle, permissions: { catalog: night.PERMISSIONS, never: night.NEVER_ALLOWED, allowed } });
const inputTag = (html) => /<input\b[^>]*\bid="set-oracle-self-healing"[^>]*>/.exec(html)?.[0] || '';

test('#278 settings: the Oracle section has a Self-healing switch', () => {
  assert.ok(settingsSrc.includes('Self-healing'), 'no "Self-healing" label in settings.js');
  assert.ok(/set-oracle-self-healing/.test(settingsSrc), 'no #set-oracle-self-healing in settings.js');
});

test('#278 settings: renderOracleSettings ticks the switch from settings.oracle.selfHealing; missing reads as off', () => {
  const on = loadOracleSettings({ dailyBudgetUsd: 20, compactAtTokens: 150000, selfHealing: true });
  on.sandbox.renderOracleSettings();
  assert.equal(on.box.checked, true);
  const off = loadOracleSettings({ dailyBudgetUsd: 20, compactAtTokens: 150000 });
  off.box.checked = true;
  off.sandbox.renderOracleSettings();
  assert.equal(off.box.checked, false);
});

test('#278 settings: Save writes settings.oracle.selfHealing from the switch and keeps the other fields', async () => {
  const { sandbox, box, calls } = loadOracleSettings({ dailyBudgetUsd: 7, compactAtTokens: 200000, wakeScope: 'watched' });
  sandbox.$('#set-oracle-budget').value = '7';
  sandbox.$('#set-oracle-compact').value = '200000';
  box.checked = true;
  await sandbox.saveOracleSettings();
  assert.equal(calls.at(-1).oracle.selfHealing, true);
  assert.equal(calls.at(-1).oracle.dailyBudgetUsd, 7);
  assert.equal(calls.at(-1).oracle.wakeScope, 'watched');
  box.checked = false;
  await sandbox.saveOracleSettings();
  assert.equal(calls.at(-1).oracle.selfHealing, false);
});

test('#278 settings: the row links to the permissions with "What it may do alone (N of M)"', () => {
  const html = selfHealingHtml({ selfHealing: false }, nwState(true, ['retry', 'refresh']));
  assert.match(html, /Self-healing/);
  assert.ok(html.includes(`What it may do alone (2 of ${night.PERMISSIONS.length})`), html);
  assert.ok(inputTag(html), 'no checkbox #set-oracle-self-healing');
  assert.equal(/\schecked\b/.test(inputTag(html)), false);
  assert.equal(/\schecked\b/.test(inputTag(selfHealingHtml({ selfHealing: true }, nwState(true, [])))), true);
});

test('#278 settings: while the Oracle cannot start here, the switch is disabled and the reason is shown', () => {
  const html = selfHealingHtml({ selfHealing: false }, nwState(false, ['retry']));
  assert.equal(/\sdisabled\b/.test(inputTag(html)), true, inputTag(html));
  assert.match(html.replace(/<[^>]+>/g, ' '), /Oracle[^.]*(cannot|not available|can't|unavailable)/i);
  const ok = selfHealingHtml({ selfHealing: false }, nwState(true, ['retry']));
  assert.equal(/\sdisabled\b/.test(inputTag(ok)), false);
});

// ---- the Night watch screen ---------------------------------------------------------------------

function element(extra = {}) {
  return {
    onclick: null, onchange: null, onsubmit: null, checked: false, disabled: false, dataset: {}, textContent: '', title: '', value: '',
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, insertAdjacentHTML() {}, ...extra,
  };
}
function body() {
  const b = { html: '', ids: {} };
  Object.defineProperty(b, 'innerHTML', {
    get: () => b.html,
    set: (html) => { b.html = String(html); b.ids = {}; for (const m of b.html.matchAll(/\sid="([^"]+)"/g)) b.ids[m[1]] = element(); },
  });
  return b;
}
async function nightScreen(watch) {
  const box = body();
  const replay = element();
  let view = null;
  const sandbox = {
    esc, errMsg: (e) => String(e?.message || e), fmtDur: (ms) => `${ms} ms`, dateOf: (iso) => String(iso),
    confirmDialog: async () => true, showView: () => {}, state: { view: 'nightwatch' }, registerView: (v) => { view = v; },
    setInterval: () => 0, console,
    $: (sel) => (sel === '#nw-body' ? box : sel === '#btn-nw-replay' ? replay : sel.startsWith('#') ? box.ids[sel.slice(1)] || null : null),
    document: { querySelectorAll: () => [] },
    api: {
      nightWatchState: async () => ({ oracle: true, watch, permissions: { catalog: night.PERMISSIONS, never: night.NEVER_ALLOWED, allowed: ['retry'], updatedAt: null, defaults: false }, runs: { active: 1, waiting: 0 }, loopCap: night.LOOP_CAP, simulation: false }),
      nightWatchReport: async () => ({ nights: [], baseline: night.BASELINE }),
      saveNightWatchPermissions: async () => ({}),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(nightSrc, sandbox);
  assert.ok(view, 'nightwatch.js did not call registerView');
  view.mount();
  await view.show();
  return box.html;
}

test('#278 Night watch screen: under Self-healing it says "Self-healing is on" instead of an end time', async () => {
  const html = await nightScreen({ on: true, active: true, until: null, selfHealing: true, startedAt: '2026-10-04T08:00:00.000Z', by: 'Self-healing' });
  assert.match(html, /Self-healing is on/);
  assert.doesNotMatch(html, /On until/);
});

test('#278 Night watch screen: a Night watch without Self-healing still shows its end time (as today)', async () => {
  const until = new Date(Date.now() + 3 * 3600e3).toISOString();
  const html = await nightScreen({ on: true, active: true, until, selfHealing: false, startedAt: new Date().toISOString(), by: 'the owner' });
  assert.match(html, /On until/);
  assert.doesNotMatch(html, /Self-healing is on/);
});
