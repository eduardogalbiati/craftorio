// #335: the night watch reports a step whose cost or time regresses against its own history.
// Acceptance tests, written before the code. Runs are listRuns rows (src/runs.js).
//
// The contract (src/night-watch.js):
// - INCIDENT_KINDS.regression: a label (keys stay sorted, test/night-watch*.test.js).
// - regressionFindings(runs, { issues, prices, thresholds, flagged = [] } = {}) → one finding
//   { kind: 'regression', key, evidence: { workflow, step, class, baseline, recent, regressed } } per
//   stepRegressions entry (src/step-regressions.js) with status 'regressed' whose key is not in
//   `flagged` (once per step and class until it recovers). Report only: no action, no proposal.
// - morningSummary(m, { proposed, regressions }) → also `regressions`: one string per finding, led by
//   the step and the rise, e.g. 'test: +50% cost over 3 runs'; [] when none.
const test = require('node:test');
const assert = require('node:assert/strict');
const night = require('../src/night-watch');

const MIN = 60000;
const WF = 'software-development.yaml';
const OPUS = 'claude-opus-5-5';

const dayIso = (day) => new Date(Date.parse('2026-09-01T10:00:00Z') + (day - 1) * 86400000).toISOString();

function run(runId, day, { cost = 3, minutes = 10, model = OPUS, mock = false, status = 'success', step = 'test' } = {}) {
  const startedAt = dayIso(day);
  return {
    runId,
    file: WF,
    status,
    mock,
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + minutes * MIN).toISOString(),
    inputs: {},
    issues: [],
    durationMs: minutes * MIN,
    gateWaitMs: 0,
    progress: [{ step, type: 'agent', durationMs: minutes * MIN }],
    sessions: [{ step_id: step, cost_usd: cost, provider: 'claude', model, effort: 'high' }],
    costUsd: cost,
    childrenCostUsd: 0,
  };
}
const series = (prefix, n, fromDay, opts) => Array.from({ length: n }, (_, i) => run(`${prefix}${i + 1}`, fromDay + i, opts));
// 6 baseline runs (cost 3, 10 min), then 3 recent runs with `recent` options
const history = (recent = {}) => [...series('b', 6, 1), ...series('n', 3, 7, recent)];

const findingsOf = (runs, opts) => night.regressionFindings(runs, opts);

// the night's metrics as the existing morningSummary tests build them (an empty night)
const W0 = Date.parse('2026-10-01T22:00:00.000Z');
const metrics = () => night.nightMetrics({
  night: { startedAt: new Date(W0).toISOString(), until: new Date(W0 + 540 * MIN).toISOString() },
  log: [], runs: [], now: W0 + 540 * MIN,
});

test('#335 INCIDENT_KINDS has a regression label', () => {
  assert.equal(typeof night.INCIDENT_KINDS.regression, 'string');
  assert.ok(night.INCIDENT_KINDS.regression.length > 0);
});

test('#335 regressionFindings: a regressed step gives one regression finding with its evidence', () => {
  const found = findingsOf(history({ cost: 4.5 }));
  assert.equal(found.length, 1);
  const [f] = found;
  assert.equal(f.kind, 'regression');
  assert.equal(typeof f.key, 'string');
  assert.equal(f.evidence.workflow, WF);
  assert.equal(f.evidence.step, 'test');
  assert.equal(f.evidence.class.model, OPUS);
  assert.deepEqual(f.evidence.regressed, ['cost']);
  assert.equal(f.evidence.baseline.costPerPoint, 1);
  assert.equal(f.evidence.recent.costPerPoint, 1.5);
  assert.deepEqual([...f.evidence.recent.runIds].sort(), ['n1', 'n2', 'n3']);
  assert.equal(f.evidence.baseline.runIds.includes('b6'), true);
});

test('#335 regressionFindings: a step within threshold gives no finding', () => {
  assert.equal(findingsOf(history()).length, 0);
});

test('#335 regressionFindings: a class without enough history gives no finding', () => {
  assert.equal(findingsOf(series('r', 4, 1, { cost: 9 })).length, 0);
});

test('#335 regressionFindings: a key already flagged is not reported again', () => {
  const [f] = findingsOf(history({ cost: 4.5 }));
  assert.equal(findingsOf(history({ cost: 4.5 }), { flagged: [f.key] }).length, 0);
});

test('#335 after recovery a flagged key gives no finding and its entry is recovered', () => {
  const [f] = findingsOf(history({ cost: 4.5 }));
  assert.equal(findingsOf(history(), { flagged: [f.key] }).length, 0);
  const { stepRegressions } = require('../src/step-regressions');
  const [entry] = stepRegressions(history(), { flagged: [f.key] });
  assert.equal(entry.status, 'recovered');
});

test('#335 a regression finding is report only: no action and no proposal', () => {
  const [f] = findingsOf(history({ cost: 4.5 }));
  assert.equal(f.action, undefined);
  assert.equal(f.proposal, undefined);
});

test('#335 morningSummary: no regressions gives an empty list', () => {
  const s = night.morningSummary(metrics(), { proposed: 0, regressions: [] });
  assert.deepEqual(s.regressions, []);
});

test('#335 morningSummary: a cost regression of 50% is one line led by the step', () => {
  const regressions = findingsOf(history({ cost: 4.5 }));
  const s = night.morningSummary(metrics(), { proposed: 0, regressions });
  assert.deepEqual(s.regressions, ['test: +50% cost over 3 runs']);
});

test('#335 morningSummary: a minutes regression of 50% says minutes', () => {
  const regressions = findingsOf(history({ minutes: 15 }));
  const s = night.morningSummary(metrics(), { proposed: 0, regressions });
  assert.deepEqual(s.regressions, ['test: +50% minutes over 3 runs']);
});

test('#335 morningSummary: two regressed steps give two lines', () => {
  const runs = [
    ...history({ cost: 4.5 }),
    ...series('rb', 6, 1, { step: 'review' }), ...series('rn', 3, 7, { step: 'review', minutes: 15 }),
  ];
  const regressions = findingsOf(runs);
  assert.equal(regressions.length, 2);
  const s = night.morningSummary(metrics(), { proposed: 0, regressions });
  assert.equal(s.regressions.length, 2);
  assert.equal(s.regressions.some((l) => l.startsWith('test:')), true);
  assert.equal(s.regressions.some((l) => l.startsWith('review:')), true);
});

// ---- after the change: what the acceptance tests left open ----------------------------------------

test('#335 morningSummary: a step regressed on both measures is one line, cost first', () => {
  const regressions = findingsOf(history({ cost: 4.5, minutes: 15 }));
  const s = night.morningSummary(metrics(), { proposed: 0, regressions });
  assert.deepEqual(s.regressions, ['test: +50% cost, +50% minutes over 3 runs']);
});

test('#335 morningSummary: each line comes with the runs behind it (the controls of the card)', () => {
  const regressions = findingsOf(history({ cost: 4.5 }));
  const s = night.morningSummary(metrics(), { proposed: 0, regressions });
  assert.equal(s.regressionRuns.length, 1);
  assert.deepEqual([...s.regressionRuns[0]].sort(), ['n1', 'n2', 'n3']);
  assert.deepEqual(night.morningSummary(metrics(), { proposed: 0, regressions: [] }).regressionRuns, []);
});

// a regression logged by the watch (oracle.detected), on a run that already finished
const regressionLog = () => [{
  ts: new Date(W0 + 60 * MIN).toISOString(), type: 'oracle.detected', id: 'g1', kind: 'regression', target: 'n3', runId: 'n3', projectId: 'p1',
  since: new Date(W0 + 50 * MIN).toISOString(), evidence: { step: 'test', regressed: ['cost'] },
}];
const nightOf = () => ({ startedAt: new Date(W0).toISOString(), until: new Date(W0 + 540 * MIN).toISOString() });

test('#335 nightMetrics: a logged regression is counted under its kind', () => {
  const m = night.nightMetrics({ night: nightOf(), log: regressionLog(), runs: [], now: W0 + 540 * MIN });
  assert.equal(m.incidents.byKind.regression, 1);
});

test('#335 nightMetrics: a regression is report only, so it adds no blocked idle time', () => {
  const m = night.nightMetrics({ night: nightOf(), log: regressionLog(), runs: [], now: W0 + 540 * MIN });
  assert.equal(m.idleHours.blocked, 0);
});
