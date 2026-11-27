// #124 acceptance tests (written before the code): a gate the supervisor on call crossed by itself during
// the night is in the morning summary (who, which answer, why), in the interface language; the Night
// watch itself still never answers a gate.
// Seams: packages/engine/domains/night/night-watch.js nightMetrics (over a run's events) and morningSummary
// (the notification and the Night watch screen's lines), and the catalogs packages/shared/i18n/en.json and
// pt-BR.json.
// Assumptions (the developer implements these names):
//   - i18n key `nightwatch.supervisor_answered_gate` (en and pt-BR, different texts), with the params
//     {step}, {answer} and {reason} (and optionally {run}): the morning summary's line for one gate the
//     supervisor answered alone;
//   - a gate crossed by the supervisor is read from the run's events: `supervisor.decision` { kind:
//     'escalation', action: 'route', route, explanation } and the gate's `step.finished` with
//     output.by === 'supervisor' (both are in the fixture; either is enough);
//   - the summary carries the line(s) under any field: asserted on the strings anywhere in morningSummary's
//     result (the step, the answer and the reason in one string).
// Guards (already green): the Night watch never answers a gate (NEVER_ALLOWED answer-gate, no permission
// for it, gateDecision only escalates, waits or parks).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');

const KEY = 'nightwatch.supervisor_answered_gate';
const W0 = Date.parse('2026-11-26T22:00:00.000Z');
const iso = (m) => new Date(W0 + m * 60e3).toISOString();
const night = { startedAt: iso(0), until: iso(540) };
const NOW = W0 + 540 * 60e3;
const REASON = 'The engine confirmed both failures on the base (abc1234).';

test.afterEach(() => I18n.setLanguage('en'));

const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'shared', 'i18n', `${lang}.json`), 'utf8'));

// a run in which the supervisor on call answered test_failed with continue, nobody asked
const crossedRun = () => ({
  runId: 'r124',
  events: [
    { type: 'workflow.started', run_id: 'r124', ts: iso(10), project_id: 'p1', issues: [{ number: 124, title: 'x' }] },
    { type: 'step.started', run_id: 'r124', ts: iso(60), step_id: 'test_failed' },
    { type: 'supervisor.started', run_id: 'r124', ts: iso(60), step_id: 'test_failed', kind: 'escalation', error: 'escalation gate: the run would ask you about a problem' },
    { type: 'supervisor.decision', run_id: 'r124', ts: iso(61), step_id: 'test_failed', kind: 'escalation', action: 'route', route: 'continue', goto: null, cause_class: null, explanation: REASON, instruction: null },
    { type: 'step.finished', run_id: 'r124', ts: iso(61), step_id: 'test_failed', visit: 1, output: { choice: 'continue', feedback: '', by: 'supervisor' } },
    { type: 'workflow.finished', run_id: 'r124', ts: iso(120), status: 'success', summary: { cost_usd: 1 } },
  ],
});

// every string in a value, depth-first
const strings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);

function summaryLine(lang) {
  const night_ = require('../../domains/night/night-watch');
  I18n.setLanguage(lang);
  const m = night_.nightMetrics({ night, log: [], runs: [crossedRun()], now: NOW });
  const s = night_.morningSummary(m);
  return strings(s).find((x) => x.includes(REASON)) || null;
}

test('#124 i18n: nightwatch.supervisor_answered_gate is in en and pt-BR, translated, with {step}, {answer} and {reason}', () => {
  const en = catalog('en')[KEY];
  const pt = catalog('pt-BR')[KEY];
  assert.equal(typeof en, 'string', `${KEY} is in en.json`);
  assert.equal(typeof pt, 'string', `${KEY} is in pt-BR.json`);
  assert.notEqual(pt, en, 'the pt-BR text is a translation');
  for (const p of ['{step}', '{answer}', '{reason}']) {
    assert.equal(en.includes(p), true, `en has ${p}`);
    assert.equal(pt.includes(p), true, `pt-BR has ${p}`);
  }
});

test('#124 morningSummary: a gate the supervisor answered alone is a line with the step, the answer and the reason', () => {
  const line = summaryLine('en');
  assert.ok(line, 'the morning summary has a line with the supervisor\'s reason');
  assert.match(line, /test_failed|Test failed/i);
  assert.match(line, /continue/i);
});

test('#124 morningSummary: the supervisor\'s gate line reads in the interface language (pt-BR differs from en)', () => {
  const en = summaryLine('en');
  const pt = summaryLine('pt-BR');
  assert.ok(en && pt, 'both languages have the line');
  assert.notEqual(pt, en);
  // the catalog's own words lead the line, not the English fallback
  const ptTemplate = catalog('pt-BR')[KEY] || '';
  const firstWords = ptTemplate.split('{')[0].trim();
  assert.ok(firstWords.length > 0, 'the pt-BR template starts with its own words');
  assert.equal(pt.includes(firstWords), true, `the pt-BR line uses ${KEY}: ${pt}`);
});

test('#124 morningSummary: a night with no supervisor answer has no such line', () => {
  const night_ = require('../../domains/night/night-watch');
  const run = crossedRun();
  run.events = run.events.filter((e) => !e.type.startsWith('supervisor.') && e.step_id !== 'test_failed');
  const s = night_.morningSummary(night_.nightMetrics({ night, log: [], runs: [run], now: NOW }));
  assert.equal(strings(s).some((x) => x.includes(REASON)), false);
});

// ---- guards: the Night watch never answers a gate ------------------------------------------------

test('#124 guard: answering a gate stays never allowed to the Night watch, with no permission that grants it', () => {
  const { NEVER_ALLOWED, PERMISSIONS, permissionOf } = require('../../domains/night/night-watch');
  assert.equal(NEVER_ALLOWED.some((x) => x.id === 'answer-gate'), true);
  assert.equal(PERMISSIONS.some((p) => p.id === 'answer-gate'), false);
  for (const kind of ['gate.answer', 'approval.resolve', 'gate']) assert.equal(permissionOf(kind, {}), null, kind);
});

test('#124 guard: gateDecision only escalates, waits or parks a waiting gate, whatever is allowed', () => {
  const { gateDecision, PERMISSIONS } = require('../../domains/night/night-watch');
  const all = PERMISSIONS.map((p) => p.id);
  const seen = new Set();
  for (const allowed of [[], ['skip'], all]) {
    for (const waitingSince of [iso(0), iso(530), null]) {
      for (const othersRunning of [false, true]) seen.add(gateDecision({ waitingSince, now: NOW, allowed, othersRunning }));
    }
  }
  for (const d of seen) assert.equal(['escalate', 'wait', 'park'].includes(d), true, d);
});
