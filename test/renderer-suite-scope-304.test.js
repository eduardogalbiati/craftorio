// #304 and #301 in the renderer: the Run screen's suite card (views/run/run.js suiteCardsHtml), the
// Scope column of Analytics › Run's Suite rounds (views/analytics/analytics-run.js) and the run chat's
// step names for a run recorded without them (views/runchat/runchat.js). They run only inside the
// Electron renderer, so each is evaluated in a vm sandbox with the app.js globals it uses stubbed and
// the real displayName, the way test/renderer-run-summary.test.js and
// test/renderer-analytics-run-245.test.js do.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');
const { displayName } = require('@multiagent/shared/display-name.js');

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// what a person reads: tags (and their attributes) dropped
const visible = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// the suite outputs of the engine (src/engine/workflow.js, scope: affected and a red check's listed files)
const SELECTION = { mode: 'affected', files: ['test/roadmap.test.js'], reasons: { 'test/roadmap.test.js': 'imports src/roadmap.js' } };
const AFFECTED_THEN_FULL = {
  kind: 'suite', status: 'pass', round: 1, scope: 'full', log: 'logs/suite-1-full.log',
  selection: { ...SELECTION, why: 'the 1 affected test file(s) passed; the whole suite runs once before the merge' },
  affected: { log: 'logs/suite-1.log', files: SELECTION.files, passed: 3, failed: 0 },
};
const AFFECTED_FAILED = { kind: 'suite', status: 'fail', round: 2, scope: 'files', log: 'logs/suite-2.log', selection: { ...SELECTION, why: 'the 1 test file(s) the change reaches' } };
const WHOLE_SUITE = { kind: 'suite', status: 'pass', round: 1, scope: 'full', log: 'logs/suite-1.log', selection: { mode: 'all', files: [], reasons: {}, why: 'package.json changed: the whole suite' } };
const RED_CHECK = {
  kind: 'suite', status: 'fail', round: 1, scope: 'files', log: 'logs/red_check-1.log',
  selection: { mode: 'affected', files: ['test/x.test.js'], reasons: { 'test/x.test.js': 'listed by red_check' }, why: 'the 1 test file(s) the step lists' },
};

// ------------------------------------------------------------------ Run screen: the suite card

function loadSuiteCards() {
  const src = fs.readFileSync(path.join(RENDERER, 'views', 'run', 'run.js'), 'utf8');
  const shown = /const SUITE_REASONS_SHOWN = [^\n]+/.exec(src);
  const fn = /function suiteCardsHtml\(runId, stepNames\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(shown && fn, 'suiteCardsHtml not found in views/run/run.js: the source moved');
  const sandbox = { esc, displayName, agentLabel: (slug, names) => displayName(slug, names), state: { runs: new Map() } };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(`${shown[0]}\n${fn[0]}\nthis.suiteCardsHtml = suiteCardsHtml;`, sandbox);
  // cardsOf([[stepId, output], ...]): the cards of a run whose steps finished with these outputs
  return (finishedSteps, stepNames = {}) => {
    const events = finishedSteps.map(([stepId, output], i) => ({ type: 'step.finished', step_id: stepId, visit: i + 1, output }));
    sandbox.state.runs.set('r1', { events });
    return String(sandbox.suiteCardsHtml('r1', stepNames));
  };
}
const cardsOf = loadSuiteCards();
const testIdText = (html, id) => [...html.matchAll(new RegExp(`data-testid="${id}"[^>]*>([\\s\\S]*?)</(?:span|div|button)>`, 'g'))].map((m) => visible(m[1]));

test('#304 Run screen: the suite card of an affected round followed by the whole suite says so, why each file ran, and links both logs', () => {
  const html = cardsOf([['suite', AFFECTED_THEN_FULL]], { suite: 'Suite' });
  assert.equal((html.match(/data-testid="run-suite-card"/g) || []).length, 1);
  assert.match(testIdText(html, 'run-suite-scope')[0], /affected/i);
  assert.match(testIdText(html, 'run-suite-scope')[0], /whole suite/i);
  assert.match(visible(html), /test\/roadmap\.test\.js\s*:\s*imports src\/roadmap\.js/);
  assert.match(html, /data-testid="run-suite-affected-log"[^>]*data-suite-log="logs\/suite-1\.log"/);
  assert.match(html, /data-testid="run-suite-full-log"[^>]*data-suite-log="logs\/suite-1-full\.log"/);
});

test('#304 Run screen: a failed affected round shows "Affected tests only" and its log, with no whole-suite log', () => {
  const html = cardsOf([['suite', AFFECTED_FAILED]]);
  assert.equal(testIdText(html, 'run-suite-scope')[0], 'Affected tests only');
  assert.match(html, /data-testid="run-suite-affected-log"[^>]*data-suite-log="logs\/suite-2\.log"/);
  assert.equal(html.includes('run-suite-full-log'), false);
});

test('#304 Run screen: a round that ran the whole suite (a shared root changed) says "Whole suite"', () => {
  const html = cardsOf([['suite', WHOLE_SUITE]]);
  assert.equal(testIdText(html, 'run-suite-scope')[0], 'Whole suite');
  assert.match(visible(html), /package\.json changed/);
  assert.equal(html.includes('run-suite-full-log'), false);
});

test('#304 Run screen: the card shows the latest round of the step only', () => {
  const html = cardsOf([['suite', AFFECTED_THEN_FULL], ['suite', AFFECTED_FAILED]]);
  assert.equal((html.match(/data-testid="run-suite-card"/g) || []).length, 1);
  assert.equal(testIdText(html, 'run-suite-scope')[0], 'Affected tests only');
});

test('#304 Run screen: a run whose suite step selected no files (a whole-suite step) shows no suite card', () => {
  assert.equal(cardsOf([['suite', { kind: 'suite', status: 'pass', round: 1, scope: 'full', log: 'logs/suite-1.log' }]]), '');
  assert.equal(cardsOf([]), '');
});

test('#304 Run screen: many selected files show the first ones and "and N more"', () => {
  const reasons = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`test/f${i}.test.js`, `imports src/f${i}.js`]));
  const html = cardsOf([['suite', { ...AFFECTED_FAILED, selection: { mode: 'affected', files: Object.keys(reasons), reasons, why: '' } }]]);
  assert.match(visible(html), /test\/f0\.test\.js/);
  assert.doesNotMatch(visible(html), /test\/f8\.test\.js/);
  assert.match(visible(html), /and \d+ more/);
});

test('#304 Run screen: the red check\'s listed acceptance tests are not presented as the affected tests', () => {
  const html = cardsOf([['red_check', RED_CHECK]], { red_check: 'Red check' });
  assert.doesNotMatch(visible(html), /affected/i, `the red check ran the files it lists, not the change's affected set: ${visible(html)}`);
});

// ------------------------------------------------------------------ Analytics › Run: the Scope column

const T = (min) => new Date(Date.UTC(2026, 9, 6, 10, min)).toISOString();
const round = (step, n, output) => ({
  step, round: n, status: output.status, durationMs: 60000, failures: 0, preexisting: 0,
  scope: output.scope || null, affected: !!output.affected,
  selection: output.selection ? { mode: output.selection.mode, why: output.selection.why || '', reasons: output.selection.reasons || {} } : null,
});
const figuresWith = (suiteRounds) => ({
  runId: 'run-304', title: 'Affected suite', workflow: 'AI development (local hero)', file: 'ai-development-local-hero.yaml',
  status: 'success', mock: true, startedAt: T(0), finishedAt: T(40), issues: [304],
  costUsd: 1, costPerIssue: 1, durationMs: 2400000, activeMs: 2000000, gateWaitMs: 0, gates: [], suiteRounds, slowestTools: [],
  timeline: [{ row: 'orchestrator', step: 'suite', visit: 1, from: T(0), to: T(10), durationMs: 600000 }],
  agents: [], steps: [{ step: 'suite', agent: null, visits: 1, durationMs: 600000 }],
});

async function suiteRows(suiteRounds) {
  const file = path.join(RENDERER, 'views', 'analytics', 'analytics-run.js');
  const figures = figuresWith(suiteRounds);
  const window = {};
  const sandbox = {
    window, console, displayName,
    StatusPill: require('../src/renderer/status-pill.js'),
    sessionStorage: { getItem: () => null, setItem: () => {} },
    api: { getRunAnalysis: async () => ({ runs: [{ runId: figures.runId, title: figures.title, status: 'success', workflow: figures.workflow }], figures, comparison: null }) },
    esc, errMsg: (e) => String(e?.message || e),
    fmtDur: (ms) => `${Math.round((ms || 0) / 1000)}s`, fmtUsd: (v) => `$${Number(v || 0).toFixed(2)}`,
    fmtNum: (v) => String(v ?? 0), fmtTok: (v) => String(v ?? 0), dateOf: (s) => String(s).slice(0, 10),
    costMarks: () => '',
  };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  const tab = window.AnalyticsTabs.run;
  await tab.load();
  const body = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  tab.render(body);
  return [...String(body.innerHTML).matchAll(/<tr data-testid="an-suite-round">([\s\S]*?)<\/tr>/g)].map((m) => visible(m[1]));
}

test('#304 Analytics Run tab: an affected round followed by the whole suite shows its scope and why each file ran', async () => {
  const [row] = await suiteRows([round('suite', 1, AFFECTED_THEN_FULL)]);
  assert.ok(row, 'one suite round row');
  assert.match(row, /Affected, then whole suite/);
  assert.match(row, /test\/roadmap\.test\.js: imports src\/roadmap\.js/);
});

test('#304 Analytics Run tab: a failed affected round reads "Affected"; a whole-suite round (mode all, or no selection) reads "Whole suite"', async () => {
  const rows = await suiteRows([
    round('suite', 1, AFFECTED_FAILED),
    round('suite', 2, WHOLE_SUITE),
    round('suite', 3, { kind: 'suite', status: 'pass', scope: 'full' }),
  ]);
  assert.equal(rows.length, 3);
  assert.match(rows[0], /\bAffected\b/);
  assert.doesNotMatch(rows[0], /whole suite/i);
  assert.match(rows[1], /Whole suite/);
  assert.doesNotMatch(rows[1], /Affected/);
  assert.match(rows[2], /Whole suite/);
});

test('#304 Analytics Run tab: the red check\'s round (the files it lists) is not labelled as the affected tests', async () => {
  const [row] = await suiteRows([round('red_check', 1, RED_CHECK)]);
  assert.ok(row, 'one suite round row');
  assert.doesNotMatch(row, /Affected/, `the red check ran the files it lists, not the change's affected set: ${row}`);
});

// ------------------------------------------------------------------ run chat: step names

function loadStepName() {
  const src = fs.readFileSync(path.join(RENDERER, 'views', 'runchat', 'runchat.js'), 'utf8');
  const names = /const workflowStepNames = \(\) => \{[\s\S]*?\n  \};/.exec(src);
  const stepName = /const stepName = [^\n]+/.exec(src);
  assert.ok(names && stepName, 'workflowStepNames / stepName not found in runchat.js: the source moved');
  const sandbox = {
    displayName,
    state: { workflows: [{ file: 'ai-development-local-hero.yaml', name: 'AI development (local hero)', steps: [{ id: 'warm_up', display: 'Warm Up' }, { id: 'develop', display: 'Develop' }] }] },
    chat: { model: { run: null, stepName: (id) => `recorded:${id}` } },
  };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(`${names[0]}\n${stepName[0]}\nthis.stepName = stepName;`, sandbox);
  return sandbox;
}

test('#301 run chat: a run recorded without step names shows its workflow\'s display names ("Warm Up")', () => {
  const sb = loadStepName();
  sb.chat.model.run = { workflow: 'ai-development-local-hero.yaml' };
  assert.equal(sb.stepName('warm_up'), 'Warm Up');
  assert.equal(sb.stepName('develop'), 'Develop');
  assert.equal(sb.stepName(''), '');
});

test('#301 run chat: a run that recorded its step names keeps them', () => {
  const sb = loadStepName();
  sb.chat.model.run = { workflow: 'ai-development-local-hero.yaml', stepNames: { warm_up: 'Warm Up' } };
  assert.equal(sb.stepName('warm_up'), 'recorded:warm_up');
});

test('#301 run chat: a run of a workflow no longer in the library falls back to the readable id', () => {
  const sb = loadStepName();
  sb.chat.model.run = { workflow: 'gone.yaml' };
  assert.equal(sb.stepName('warm_up'), displayName('warm_up', null));
});
