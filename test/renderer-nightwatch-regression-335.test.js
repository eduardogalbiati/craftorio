// #335 step regressions in the UI (src/renderer/views/nightwatch/nightwatch.js): Home's morning card
// (window.NightWatchView.renderMorning: one `nw-regression` line per regressed step, one
// `nw-regression-run` button per run behind it, opening the Run screen) in its three states, and the
// Night watch screen's incidents line naming the new kind. Renderer code runs only in Electron, so the
// view runs in a vm sandbox (as in test/renderer-self-healing-278.test.js); only strings and primitives
// are compared.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');
const night = require('../src/domains/night/night-watch');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nightSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'nightwatch', 'nightwatch.js'), 'utf8');

const MIN = 60000;
const W0 = Date.parse('2026-10-01T22:00:00.000Z');

function element(extra = {}) {
  return {
    onclick: null, onchange: null, onsubmit: null, checked: false, disabled: false, dataset: {}, textContent: '', title: '', value: '',
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, insertAdjacentHTML() {}, ...extra,
  };
}
// a box whose innerHTML gives back its ids and its run buttons (with their data-run)
function body() {
  const b = { html: '', ids: {}, runButtons: [], classList: { toggle() {}, add() {}, remove() {}, contains: () => false } };
  Object.defineProperty(b, 'innerHTML', {
    get: () => b.html,
    set: (html) => {
      b.html = String(html);
      b.ids = {};
      for (const m of b.html.matchAll(/\sid="([^"]+)"/g)) b.ids[m[1]] = element();
      b.runButtons = [...b.html.matchAll(/<button[^>]*data-testid="nw-regression-run"[^>]*>/g)].map((m) => element({ dataset: { run: (m[0].match(/data-run="([^"]*)"/) || [])[1] } }));
    },
  });
  b.querySelectorAll = (sel) => (sel.includes('nw-regression-run') ? b.runButtons : []);
  return b;
}

function sandboxFor({ box, morning, report, opened = [] }) {
  let view = null;
  const sandbox = {
    esc, errMsg: (e) => String(e?.message || e), fmtDur: (ms) => `${ms} ms`, dateOf: (iso) => String(iso),
    confirmDialog: async () => true, showView: () => {}, state: { view: 'nightwatch' }, registerView: (v) => { view = v; },
    setInterval: () => 0, console,
    showRun: (id) => opened.push(id),
    $: (sel) => (sel === '#nw-body' ? box : sel.startsWith('#') ? box.ids[sel.slice(1)] || element() : null),
    document: { querySelectorAll: () => [] },
    api: {
      nightWatchMorning: async () => morning,
      nightWatchState: async () => ({ oracle: true, watch: { on: false, active: false }, permissions: { catalog: night.PERMISSIONS, never: night.NEVER_ALLOWED, allowed: [], updatedAt: null, defaults: true }, runs: { active: 0, waiting: 0 }, loopCap: night.LOOP_CAP, simulation: false }),
      nightWatchReport: async () => report || { nights: [], baseline: night.BASELINE },
      saveNightWatchPermissions: async () => ({}),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(nightSrc, sandbox);
  return { sandbox, view: () => view };
}

const summary = (regressions = [], regressionRuns = []) => ({
  ran: '2 run(s), 1 issue(s) delivered, 3.0 h active of 9.0 h.', did: '1 incident(s), 0 action(s) without asking, 0 resolved (0%), 0 escalated.',
  waits: '0 gate(s) open, 0 proposed action(s) waiting for your click.', safety: 'Safety: no gate crossed.', alarm: false,
  regressions, regressionRuns,
});
const morningOf = (s) => ({ window: { from: new Date(W0).toISOString(), to: new Date(W0 + 540 * MIN).toISOString(), selfHealing: false }, summary: s });

async function card(s) {
  const box = body();
  const opened = [];
  const { sandbox } = sandboxFor({ box, morning: morningOf(s), opened });
  await sandbox.NightWatchView.renderMorning(box);
  return { html: box.html, box, opened };
}
const count = (html, re) => (html.match(re) || []).length;

test('#335 morning card: no regression shows no regression line', async () => {
  const { html } = await card(summary());
  assert.equal(count(html, /data-testid="nw-regression"/g), 0);
  assert.equal(count(html, /data-testid="nw-regression-run"/g), 0);
});

test('#335 morning card: one regression leads with the step and the rise, with a link per run', async () => {
  const { html } = await card(summary(['test: +42% cost over 3 runs'], [['20261012-010000-aaaa', '20261011-010000-bbbb', '20261010-010000-cccc']]));
  assert.equal(count(html, /data-testid="nw-regression"/g), 1);
  assert.match(html, /test: \+42% cost over 3 runs/);
  assert.equal(count(html, /data-testid="nw-regression-run"/g), 3);
  assert.match(html, /data-run="20261012-010000-aaaa"/);
});

test('#335 morning card: several regressions give one line each', async () => {
  const { html } = await card(summary(['test: +42% cost over 3 runs', 'review: +35% minutes over 3 runs'], [['r1', 'r2', 'r3'], ['r4', 'r5', 'r6']]));
  assert.equal(count(html, /data-testid="nw-regression"/g), 2);
  assert.equal(count(html, /data-testid="nw-regression-run"/g), 6);
  assert.match(html, /review: \+35% minutes over 3 runs/);
});

test('#335 morning card: a run link opens that run', async () => {
  const { box, opened } = await card(summary(['test: +42% cost over 3 runs'], [['r1', 'r2', 'r3']]));
  box.runButtons[1].onclick();
  assert.deepEqual(opened, ['r2']);
});

test('#335 morning card: the regression line escapes the step name', async () => {
  const { html } = await card(summary(['<b>x</b>: +50% cost over 3 runs'], [['r1']]));
  assert.equal(html.includes('<b>x</b>'), false);
});

test('#335 Night watch screen: the incidents line names a regression with a label, not the raw kind', async () => {
  const log = [{
    ts: new Date(W0 + 60 * MIN).toISOString(), type: 'oracle.detected', id: 'g1', kind: 'regression', target: 'r3', runId: 'r3', projectId: 'p1',
    since: new Date(W0 + 50 * MIN).toISOString(), evidence: { step: 'test', regressed: ['cost'] },
  }];
  const m = night.nightMetrics({ night: { startedAt: new Date(W0).toISOString(), until: new Date(W0 + 540 * MIN).toISOString() }, log, runs: [], now: W0 + 540 * MIN });
  const box = body();
  // nightwatch:report's nights are metrics + summary (src/service/channels/nightwatch.js report)
  const { view } = sandboxFor({ box, report: { nights: [{ ...m, summary: night.morningSummary(m) }], baseline: night.BASELINE } });
  view().mount();
  await view().show();
  // the other kinds have a capitalised label ('Memory guard', 'Cost gap'); the raw key is 'regression'
  assert.equal(box.html.includes('regression <b>1</b>'), false, 'the raw kind is shown');
  assert.match(box.html, /[A-Z][^<>]*\s<b>1<\/b>/);
});
