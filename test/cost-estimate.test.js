// src/cost-estimate.js (#206, #215): the roadmap's estimates from the history of real runs. #215 adds
// the time next to the cost: `minutes` on each estimate (median duration of past successful runs of
// the workflow, scaled by complexity and the item's test/screenshot inputs), a stage's duration (the
// longest of its items: they run in parallel) and the real duration of an item's run (`actualMinutes`).
// Runs are listRuns rows (src/runs.js): `durationMs`, `progress` (the step trail: { step, durationMs }),
// `sessions` (cost per step).
const test = require('node:test');
const assert = require('node:assert/strict');
const costEstimate = require('../src/cost-estimate');

const MIN = 60000;
const WF = 'software-development-local-hero.yaml';

// A past run: `develop` and `screenshots` steps, each with its duration (minutes) and cost.
function run(runId, startedAt, { develop, screenshots, status = 'success', mock = false, file = WF, issues = [] }) {
  return {
    runId,
    file,
    status,
    mock,
    startedAt,
    finishedAt: startedAt.replace('T10', 'T23'),
    inputs: {},
    issues,
    durationMs: (develop + screenshots) * MIN,
    gateWaitMs: 0,
    progress: [
      { step: 'develop', type: 'agent', durationMs: develop * MIN, cost: 3 },
      { step: 'screenshots', type: 'agent', durationMs: screenshots * MIN, cost: 1 },
    ],
    sessions: [{ step_id: 'develop', cost_usd: 3 }, { step_id: 'screenshots', cost_usd: 1 }],
    costUsd: 4,
    childrenCostUsd: 0,
  };
}

// three successful runs of complexity 3 (no issues): 60, 90 and 120 minutes → 30 min per point
const history = () => [
  run('r1', '2026-09-01T10:00:00Z', { develop: 40, screenshots: 20 }),
  run('r2', '2026-09-02T10:00:00Z', { develop: 60, screenshots: 30 }),
  run('r3', '2026-09-03T10:00:00Z', { develop: 80, screenshots: 40 }),
];

test('estimateItem (#215): minutes is the median duration of the past successful runs of the workflow', () => {
  const e = costEstimate.estimateItem({ workflow: WF, inputs: {}, issues: [] }, history());
  assert.equal(e.minutes, 90);
  assert.equal(e.runs, 3);
});

test('estimateItem (#215): the time estimate scales with the item\'s complexity', () => {
  const e = costEstimate.estimateItem({ workflow: WF, inputs: {}, issues: [] }, history(), { complexity: 6 });
  assert.equal(e.minutes, 180);
});

test('estimateItem (#215): failed, simulated and other workflows\' runs do not count in the time estimate', () => {
  const runs = [
    ...history(),
    run('bad', '2026-09-04T10:00:00Z', { develop: 400, screenshots: 100, status: 'failed' }),
    run('sim', '2026-09-05T10:00:00Z', { develop: 400, screenshots: 100, mock: true }),
    run('other', '2026-09-06T10:00:00Z', { develop: 400, screenshots: 100, file: 'ai-arena.yaml' }),
  ];
  assert.equal(costEstimate.estimateItem({ workflow: WF, inputs: {}, issues: [] }, runs).minutes, 90);
});

test('estimateItem (#215): turning the screenshots off shortens the time estimate', () => {
  const all = costEstimate.estimateItem({ workflow: WF, inputs: { screenshots: 'all' }, issues: [] }, history());
  const off = costEstimate.estimateItem({ workflow: WF, inputs: { screenshots: 'off' }, issues: [] }, history());
  assert.ok(off.minutes < all.minutes, `screenshots off (${off.minutes} min) should be shorter than all (${all.minutes} min)`);
  assert.ok(off.minutes > 0);
});

test('estimateItem (#215): no successful run of the workflow yet gives no estimate at all', () => {
  assert.equal(costEstimate.estimateItem({ workflow: 'writer-reviewer.yaml', inputs: {}, issues: [] }, history()), null);
});

test('estimateItem (#215): estimates learn: a new finished run joins the history and moves the time estimate', () => {
  const runs = [...history(), run('r4', '2026-09-10T10:00:00Z', { develop: 140, screenshots: 60 })];
  const e = costEstimate.estimateItem({ workflow: WF, inputs: {}, issues: [] }, runs);
  assert.equal(e.runs, 4);
  assert.equal(e.minutes, 105);
});

test('withEstimates (#215): a stage\'s estimated duration is its longest item (they run in parallel), not the sum', () => {
  const roadmap = { state: 'planned', stages: [{ id: 's1', name: '', items: [
    { id: 'a', status: 'planned', workflow: WF, inputs: {}, issues: [{ number: 1, labels: [{ name: 'complexity:3' }] }] },
    { id: 'b', status: 'planned', workflow: WF, inputs: {}, issues: [{ number: 2, labels: [{ name: 'complexity:6' }] }] },
  ] }] };
  const out = costEstimate.withEstimates(roadmap, history());
  assert.equal(out.stages[0].items[0].estimate.minutes, 90);
  assert.equal(out.stages[0].items[1].estimate.minutes, 180);
  assert.equal(out.stages[0].estimate.minutes, 180);
});

test('withEstimates (#215): an item with a finished run carries its real duration (actualMinutes) next to its real cost', () => {
  const done = { ...run('live1', '2026-10-02T10:00:00Z', { develop: 102, screenshots: 119 }), costUsd: 22.21 };
  const roadmap = { state: 'running', stages: [{ id: 's1', name: '', items: [
    { id: 'a', status: 'done', workflow: WF, inputs: {}, issues: [], runId: 'live1', runs: ['live1'] },
  ] }] };
  const item = costEstimate.withEstimates(roadmap, [...history(), done]).stages[0].items[0];
  assert.equal(item.actualUsd, 22.21);
  assert.equal(item.actualMinutes, 221);
});

test('withEstimates (#215): a stage carries the real total cost of its items\' runs, to compare with its estimate', () => {
  const a = { ...run('x1', '2026-10-02T10:00:00Z', { develop: 50, screenshots: 10 }), costUsd: 10 };
  const b = { ...run('x2', '2026-10-02T11:00:00Z', { develop: 50, screenshots: 10 }), costUsd: 12.21 };
  const roadmap = { state: 'done', stages: [{ id: 's1', name: '', items: [
    { id: 'a', status: 'done', workflow: WF, inputs: {}, issues: [], runId: 'x1', runs: ['x1'] },
    { id: 'b', status: 'done', workflow: WF, inputs: {}, issues: [], runId: 'x2', runs: ['x2'] },
  ] }] };
  const stage = costEstimate.withEstimates(roadmap, [...history(), a, b]).stages[0];
  assert.equal(stage.actualUsd, 22.21);
});
