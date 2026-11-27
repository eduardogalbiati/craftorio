// #124 in the morning summary's UI (fronts/ai/views/nightwatch/nightwatch.js): Home's morning card
// (window.NightWatchView.renderMorning) gives one `morning-supervisor-gate` line per gate the supervisor on
// call answered alone during the night (summary.supervisorGates, already in the interface language), with
// the step and the run it belongs to (summary.supervisorGateRuns, by index). The view runs in a vm sandbox,
// as in renderer-nightwatch-regression-335.test.js; only strings are compared.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');
const night = require('@craftorio/engine/domains/night/night-watch');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nightSrc = fs.readFileSync(pageFileOf('views/nightwatch/nightwatch.js'), 'utf8');

const MIN = 60000;
const W0 = Date.parse('2026-10-01T22:00:00.000Z');

const element = () => ({ onclick: null, dataset: {}, textContent: '', title: '', value: '', classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, insertAdjacentHTML() {} });
function body() {
  const b = { html: '', ids: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false } };
  Object.defineProperty(b, 'innerHTML', {
    get: () => b.html,
    set: (html) => { b.html = String(html); b.ids = {}; for (const m of b.html.matchAll(/\sid="([^"]+)"/g)) b.ids[m[1]] = element(); },
  });
  b.querySelectorAll = () => [];
  return b;
}

function sandboxFor({ box, morning }) {
  const sandbox = {
    esc, errMsg: (e) => String(e?.message || e), fmtDur: (ms) => `${ms} ms`, dateOf: (iso) => String(iso),
    confirmDialog: async () => true, showView: () => {}, state: { view: 'home' }, registerView: () => {},
    setInterval: () => 0, console, showRun: () => {},
    $: (sel) => (sel === '#nw-body' ? box : sel.startsWith('#') ? box.ids[sel.slice(1)] || element() : null),
    document: { querySelectorAll: () => [] },
    api: {
      nightWatchMorning: async () => morning,
      nightWatchState: async () => ({ oracle: true, watch: { on: false, active: false }, permissions: { catalog: night.PERMISSIONS, never: night.NEVER_ALLOWED, allowed: [], updatedAt: null, defaults: true }, runs: { active: 0, waiting: 0 }, loopCap: night.LOOP_CAP, simulation: false }),
      nightWatchReport: async () => ({ nights: [], baseline: night.BASELINE }),
      saveNightWatchPermissions: async () => ({}),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(nightSrc, sandbox);
  return sandbox;
}

const summary = (supervisorGates, supervisorGateRuns) => ({
  ran: '2 run(s), 1 issue(s) delivered, 3.0 h active of 9.0 h.', did: '1 incident(s), 0 action(s) without asking, 0 resolved (0%), 0 escalated.',
  waits: '0 gate(s) open, 0 proposed action(s) waiting for your click.', safety: 'Safety: no gate crossed.', alarm: false,
  regressions: [], regressionRuns: [],
  ...(supervisorGates ? { supervisorGates } : {}), ...(supervisorGateRuns ? { supervisorGateRuns } : {}),
});
const morningOf = (s) => ({ window: { from: new Date(W0).toISOString(), to: new Date(W0 + 540 * MIN).toISOString(), selfHealing: false }, summary: s });

// a fresh sandbox per card: renderMorning keeps its result for a minute
async function card(s) {
  const box = body();
  const sandbox = sandboxFor({ box, morning: morningOf(s) });
  await sandbox.NightWatchView.renderMorning(box);
  return box.html;
}
const count = (html, re) => (html.match(re) || []).length;

test('#124 morning card: a night without supervisor answers (or a summary from before #124) has no such line', async () => {
  assert.equal(count(await card(summary([], [])), /data-testid="morning-supervisor-gate"/g), 0);
  assert.equal(count(await card(summary()), /data-testid="morning-supervisor-gate"/g), 0);
});

test('#124 morning card: one line per gate the supervisor answered, with its text, step and run', async () => {
  const lines = ['The supervisor answered the test_failed gate of run Export alone with Stop the run: same failure twice', 'The supervisor answered the check gate of run Login alone with Try again: flaky install'];
  const html = await card(summary(lines, [{ step: 'test_failed', runId: '20261002-010000-aaaa' }, { step: 'check', runId: '20261002-020000-bbbb' }]));
  assert.equal(count(html, /data-testid="morning-supervisor-gate"/g), 2);
  assert.equal(html.includes('same failure twice'), true);
  assert.equal(html.includes('flaky install'), true);
  assert.match(html, /data-step="test_failed"/);
  assert.match(html, /data-run="20261002-010000-aaaa"/);
  assert.match(html, /data-run="20261002-020000-bbbb"/);
});

test('#124 morning card: a line shows as given in pt-BR (the engine already translated it)', async () => {
  const html = await card(summary(['O supervisor respondeu sozinho o gate test_failed com Parar a run: falhou igual duas vezes'], [{ step: 'test_failed', runId: 'r1' }]));
  assert.equal(html.includes('falhou igual duas vezes'), true);
});

test('#124 morning card: a line without its run entry still shows, with empty data attributes', async () => {
  const html = await card(summary(['The supervisor answered a gate alone'], []));
  assert.equal(count(html, /data-testid="morning-supervisor-gate"/g), 1);
  assert.match(html, /data-run=""/);
  assert.equal(html.includes('undefined'), false);
});

test("#124 morning card: the supervisor's reason is escaped", async () => {
  const html = await card(summary(['answered alone: <img src=x onerror=1>'], [{ step: 's"x', runId: 'r1' }]));
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('s"x'), false);
});
