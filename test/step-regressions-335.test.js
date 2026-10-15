// #335: a workflow step whose cost or time regresses against its own history. Acceptance tests,
// written before the code. Runs are listRuns rows (src/runs.js), as in test/cost-estimate.test.js.
//
// The contract (src/step-regressions.js):
// - REGRESSION_DEFAULTS = { minRuns: 5, recentRuns: 3, cost: 0.3, minutes: 0.3, baselineRuns, ... }
// - stepRegressions(runs, { issues = [], prices = {}, thresholds = {}, flagged = [] } = {}) → one entry
//   per workflow file (basename) + step + class (the step's sessions' provider, model, effort) seen in
//   real successful runs (run.mock true, or a session with provider 'mock', never counts):
//   { key (opaque, stable), workflow, step, class: { provider, model, effort },
//     status: 'regressed' | 'within' | 'recovered' | 'not-measurable',
//     regressed: [] | ['cost'] | ['minutes'] | ['cost', 'minutes'],
//     baseline: { costPerPoint, minutes, runIds } | null (not measurable),
//     recent: { costPerPoint, minutes, runIds } }
//   recent = the recentRuns newest runs of the class; baseline = medians over the runs before them
//   (at most baselineRuns); cost per complexity point as src/cost-estimate.js (3 points per run without
//   issues, else the issues' complexity:n labels). Regressed: recent median > baseline × (1 + threshold).
//   `flagged`: keys flagged earlier; one now within threshold is 'recovered'.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../src/step-regressions');

const MIN = 60000;
const WF = 'software-development.yaml';
const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';

const dayIso = (day) => new Date(Date.parse('2026-09-01T10:00:00Z') + (day - 1) * 86400000).toISOString();

// A past run with one step `test` of `minutes` minutes and `cost` dollars.
function run(runId, day, { cost = 3, minutes = 10, model = OPUS, provider = 'claude', effort = 'high', mock = false, status = 'success', issues = [] } = {}) {
  const startedAt = dayIso(day);
  return {
    runId,
    file: `C:/ws/workflows/${WF}`,
    status,
    mock,
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + minutes * MIN).toISOString(),
    inputs: {},
    issues,
    durationMs: minutes * MIN,
    gateWaitMs: 0,
    progress: [{ step: 'test', type: 'agent', durationMs: minutes * MIN }],
    sessions: [{ step_id: 'test', cost_usd: cost, provider, model, effort }],
    costUsd: cost,
    childrenCostUsd: 0,
  };
}

// `n` runs from `fromDay` on, ids `${prefix}1..n`
const series = (prefix, n, fromDay, opts) => Array.from({ length: n }, (_, i) => run(`${prefix}${i + 1}`, fromDay + i, opts));

// 6 baseline runs (cost 3, 10 min) on days 1-6, then 3 recent runs on days 7-9 with `recent` options
const history = (recent = {}) => [...series('b', 6, 1), ...series('n', 3, 7, recent)];
const only = (entries) => {
  assert.equal(entries.length, 1, `one entry (got ${JSON.stringify(entries)})`);
  return entries[0];
};

test('#335 REGRESSION_DEFAULTS: 5 runs to measure, 3 recent runs, 30% on cost and on minutes', () => {
  const { REGRESSION_DEFAULTS } = load();
  assert.equal(REGRESSION_DEFAULTS.minRuns, 5);
  assert.equal(REGRESSION_DEFAULTS.recentRuns, 3);
  assert.equal(REGRESSION_DEFAULTS.cost, 0.3);
  assert.equal(REGRESSION_DEFAULTS.minutes, 0.3);
});

test('#335 a steady step is within, with its baseline per point and minutes, its class and its workflow basename', () => {
  const e = only(load().stepRegressions(history()));
  assert.equal(e.status, 'within');
  assert.deepEqual(e.regressed, []);
  assert.equal(e.workflow, WF);
  assert.equal(e.step, 'test');
  assert.equal(e.class.provider, 'claude');
  assert.equal(e.class.model, OPUS);
  assert.equal(e.class.effort, 'high');
  assert.equal(e.baseline.costPerPoint, 1);
  assert.equal(e.baseline.minutes, 10);
  assert.equal(e.recent.costPerPoint, 1);
  assert.equal(e.recent.minutes, 10);
  assert.equal(typeof e.key, 'string');
});

test('#335 too few runs: 4 runs are not measurable yet, with no baseline', () => {
  const e = only(load().stepRegressions(series('r', 4, 1)));
  assert.equal(e.status, 'not-measurable');
  assert.equal(e.baseline, null);
  assert.deepEqual(e.regressed, []);
});

test('#335 a cost rise of 50% over the 3 recent runs is a cost regression, with the run ids behind both medians', () => {
  const e = only(load().stepRegressions(history({ cost: 4.5 })));
  assert.equal(e.status, 'regressed');
  assert.deepEqual(e.regressed, ['cost']);
  assert.equal(e.recent.costPerPoint, 1.5);
  assert.equal(e.baseline.costPerPoint, 1);
  assert.deepEqual([...e.recent.runIds].sort(), ['n1', 'n2', 'n3']);
  assert.equal(e.baseline.runIds.includes('b6'), true);
  assert.equal(e.baseline.runIds.some((id) => id.startsWith('n')), false);
});

test('#335 a cost rise of 20% stays within the 30% threshold', () => {
  const e = only(load().stepRegressions(history({ cost: 3.6 })));
  assert.equal(e.status, 'within');
  assert.deepEqual(e.regressed, []);
});

test('#335 15 minutes against 10 is a minutes regression only', () => {
  const e = only(load().stepRegressions(history({ minutes: 15 })));
  assert.equal(e.status, 'regressed');
  assert.deepEqual(e.regressed, ['minutes']);
  assert.equal(e.recent.minutes, 15);
  assert.equal(e.baseline.minutes, 10);
});

test('#335 a single expensive run among the 3 recent ones is not a sustained regression', () => {
  const runs = [...series('b', 6, 1), run('n1', 7), run('n2', 8, { cost: 4.5 }), run('n3', 9)];
  const e = only(load().stepRegressions(runs));
  assert.equal(e.status, 'within');
  assert.deepEqual(e.regressed, []);
});

test('#335 the cost is per complexity point: recent runs of complexity 6 costing 6 are within', () => {
  const issues = [{ number: 7, labels: [{ name: 'complexity:6' }] }];
  const runs = history({ cost: 6, issues: [{ number: 7 }] });
  const e = only(load().stepRegressions(runs, { issues }));
  assert.equal(e.recent.costPerPoint, 1);
  assert.equal(e.status, 'within');
});

test('#335 a flagged key back within threshold is recovered; the same key not flagged is within', () => {
  const { stepRegressions } = load();
  const { key } = only(stepRegressions(history({ cost: 4.5 })));
  assert.equal(only(stepRegressions(history(), { flagged: [key] })).status, 'recovered');
  assert.equal(only(stepRegressions(history())).status, 'within');
});

test('#335 a flagged key still above threshold stays regressed, and the key is stable across calls', () => {
  const { stepRegressions } = load();
  const first = only(stepRegressions(history({ cost: 4.5 })));
  const again = only(stepRegressions(history({ cost: 4.5 }), { flagged: [first.key] }));
  assert.equal(again.key, first.key);
  assert.equal(again.status, 'regressed');
});

test('#335 simulated runs never count: 3 newest mock runs at +50% leave the step within', () => {
  const runs = [...series('b', 9, 1), ...series('m', 3, 10, { cost: 4.5, mock: true })];
  const e = only(load().stepRegressions(runs));
  assert.equal(e.status, 'within');
  assert.equal(e.recent.runIds.some((id) => id.startsWith('m')), false);
  assert.equal(e.baseline.runIds.some((id) => id.startsWith('m')), false);
});

test('#335 a run whose session provider is mock does not count either', () => {
  const runs = [...series('b', 9, 1), ...series('m', 3, 10, { cost: 4.5, provider: 'mock' })];
  const entries = load().stepRegressions(runs);
  assert.equal(entries.some((e) => e.status === 'regressed'), false);
  assert.equal(entries.some((e) => e.class.provider === 'mock'), false);
  const e = only(entries);
  assert.equal(e.recent.runIds.some((id) => id.startsWith('m')), false);
});

test('#335 failed runs never count: 3 newest failed runs at +50% leave the step within', () => {
  const runs = [...series('b', 9, 1), ...series('f', 3, 10, { cost: 4.5, status: 'failed' })];
  const e = only(load().stepRegressions(runs));
  assert.equal(e.status, 'within');
  assert.equal(e.recent.runIds.some((id) => id.startsWith('f')), false);
});

test('#335 a model change is a new class: the dearer new model is not measurable yet, not a regression', () => {
  const runs = [...series('o', 8, 1), ...series('s', 3, 9, { cost: 9, model: SONNET })];
  const entries = load().stepRegressions(runs);
  assert.equal(entries.length, 2);
  assert.equal(entries.some((e) => e.status === 'regressed'), false);
  const opus = entries.find((e) => e.class.model === OPUS);
  const sonnet = entries.find((e) => e.class.model === SONNET);
  assert.equal(opus.status, 'within');
  assert.notEqual(opus.baseline, null);
  assert.equal(opus.recent.runIds.some((id) => id.startsWith('s')), false);
  assert.equal(sonnet.status, 'not-measurable');
  assert.notEqual(sonnet.key, opus.key);
});

test('#335 thresholds override the defaults: with cost 0.6, a 50% rise is within', () => {
  const e = only(load().stepRegressions(history({ cost: 4.5 }), { thresholds: { cost: 0.6 } }));
  assert.equal(e.status, 'within');
  assert.deepEqual(e.regressed, []);
});

// ---- after the change: what the acceptance tests left open ----------------------------------------

// a run whose `test` session reported no cost (Codex) and, without prices, cannot be priced
const unpriced = (r) => ({ ...r, sessions: r.sessions.map((s) => ({ ...s, cost_usd: undefined })), costUsd: 0 });

test('#335 a session cost neither reported nor priced is unknown, not zero, in the baseline median', () => {
  // 3 of the 6 baseline runs unpriced: as zeros they would halve the median and make 3 look like +100%
  const runs = [...series('b', 3, 1), ...series('u', 3, 4).map(unpriced), ...series('n', 3, 7)];
  const e = only(load().stepRegressions(runs, { prices: {} }));
  assert.equal(e.baseline.costPerPoint, 1);
  assert.equal(e.regressed.includes('cost'), false);
});

test('#335 a class whose costs are all unknown has no cost median and no cost regression', () => {
  const runs = [...series('b', 6, 1), ...series('n', 3, 7)].map(unpriced);
  const e = only(load().stepRegressions(runs, { prices: {} }));
  assert.equal(e.recent.costPerPoint, null);
  assert.equal(e.regressed.includes('cost'), false);
});

test('#335 a step with a cost but no progress trail has no minutes and no minutes regression', () => {
  const noTrail = (r) => ({ ...r, progress: [] });
  const runs = [...series('b', 6, 1).map(noTrail), ...series('n', 3, 7, { minutes: 30 }).map(noTrail)];
  const e = only(load().stepRegressions(runs));
  assert.equal(e.baseline.minutes, null);
  assert.equal(e.recent.minutes, null);
  assert.deepEqual(e.regressed, []);
  assert.equal(e.status, 'within');
});

test('#335 cost and minutes can both regress in one entry', () => {
  const e = only(load().stepRegressions(history({ cost: 4.5, minutes: 15 })));
  assert.equal(e.status, 'regressed');
  assert.deepEqual([...e.regressed].sort(), ['cost', 'minutes']);
});

test('#335 the effort is part of the class: the same model at another effort is a new class', () => {
  const runs = [...series('b', 6, 1), ...series('n', 3, 7, { cost: 9, effort: 'max' })];
  const entries = load().stepRegressions(runs);
  assert.equal(entries.length, 2);
  assert.equal(entries.some((e) => e.status === 'regressed'), false);
  assert.equal(entries.find((e) => e.class.effort === 'max').status, 'not-measurable');
});

test('#335 runs of another workflow file are another baseline', () => {
  const other = series('o', 3, 7, { cost: 9 }).map((r) => ({ ...r, file: 'C:/ws/workflows/ai-arena.yaml' }));
  const entries = load().stepRegressions([...history(), ...other]);
  const sd = entries.find((e) => e.workflow === WF);
  assert.equal(sd.status, 'within');
  assert.equal(entries.find((e) => e.workflow === 'ai-arena.yaml').status, 'not-measurable');
});
