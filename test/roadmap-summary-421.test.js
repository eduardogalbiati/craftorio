// #421 The Roadmap bar's summary: what is left (planned cost and time), what was spent, and the
// split by release cut line. Acceptance tests written before the code, on the pure function.
//
// Interface the developer implements (the names are this test's choice):
// NEW module src/shared/roadmap-summary.js, UMD like src/shared/roadmap-model.js (Node:
// module.exports; browser: window.RoadmapSummary), pure (no DOM, no files, never changes its input):
//
//   summarize({ stages, releases }) -> { planned, spent, releases }
//
// Input (what the Roadmap already has: the roadmap's stages and items as the service sends them,
// x.estimate / x.actualUsd / x.actualMinutes as backlog-roadmap.js's cost and time meters read them):
//   stages:   [{ id, disabled?, items: [item] }]                       in roadmap order
//   item:     { id, title?, status ('planned' | 'running' | 'done' | 'skipped' | 'failed' | 'paused' | 'parked'),
//               estimate: { usd, minutes } | null,                     null: no estimate
//               actualUsd?: number | null,                              what its run cost so far (done: its real cost)
//               actualMinutes?: number | null,                          its run's working time so far (running: elapsed)
//               origin?: ISO string }                                   when it joined the roadmap
//   releases: [{ version, at, estimate?: { usd, minutes } | null }]   the cut lines (#260): `at` is the index of the
//             stage the line follows ("cut after stage at", RoadmapModel.roadmapReleases' `at`), in any order;
//             `estimate`: the release run's own, when its workflow has history
//
// Output:
//   planned: { usd, minutes, items, stages, withoutEstimate: [{ id, title }] }
//     what is left: the enabled stages' items not finished (RoadmapModel.isFinished: done, skipped,
//     parked are not counted; a disabled stage counts nothing). A planned item counts its estimate; a
//     running one its estimate minus its actualUsd / actualMinutes, never below zero. An item without
//     an estimate is listed in withoutEstimate and never counted as zero. Time: the stages run in
//     sequence, a stage's items in parallel: minutes = the sum over the stages left of their longest
//     item's remaining minutes (gates not counted). items: the items left (with or without an
//     estimate); stages: the enabled stages with an item left.
//   spent: { usd, since }
//     usd: the actualUsd of the finished and running items; since: the oldest item `origin` on the
//     roadmap (null without any).
//   releases: [] without cut lines; else one entry per cut line in stage order
//     { version, usd, minutes, ... } (the planned part of the stages after the previous line up to
//     and including stage `at`, plus the release run's estimate), then { after: true, usd, minutes, ... }
//     for the stages after the last line.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MODULE = path.join(__dirname, '..', 'src', 'shared', 'roadmap-summary.js');
// required inside each test: the file loads (and each test fails on its own) before the module exists
const summarize = (input) => require(MODULE).summarize(input);

const est = (usd, minutes) => ({ usd, minutes });
const item = (id, status, estimate, extra = {}) => ({ id, title: `Issue ${id}`, status, estimate, ...extra });
const stage = (id, items, extra = {}) => ({ id, items, ...extra });

test('#421 planned: the planned items\' estimates summed, the counts of items and stages left', () => {
  const out = summarize({
    stages: [
      stage('s1', [item('a', 'planned', est(1.5, 20)), item('b', 'planned', est(1, 40))]),
      stage('s2', [item('c', 'planned', est(3, 60))]),
    ],
    releases: [],
  });
  assert.deepEqual([out.planned.usd, out.planned.items, out.planned.stages], [5.5, 3, 2]);
});

test('#421 planned time: stages in sequence, items in parallel (the longest item of each stage, summed)', () => {
  const out = summarize({
    stages: [
      stage('s1', [item('a', 'planned', est(1, 20)), item('b', 'planned', est(1, 40))]),
      stage('s2', [item('c', 'planned', est(1, 60)), item('d', 'planned', est(1, 15))]),
    ],
    releases: [],
  });
  assert.equal(out.planned.minutes, 100);
});

test('#421 a running item counts what is left of its estimate (estimate minus what its run spent and elapsed)', () => {
  const out = summarize({
    stages: [stage('s1', [item('a', 'running', est(2, 60), { actualUsd: 0.75, actualMinutes: 25 })])],
    releases: [],
  });
  assert.deepEqual([out.planned.usd, out.planned.minutes, out.planned.items], [1.25, 35, 1]);
});

test('#421 a running item over its estimate counts zero, never below', () => {
  const out = summarize({
    stages: [stage('s1', [
      item('a', 'running', est(2, 60), { actualUsd: 3, actualMinutes: 90 }),
      item('b', 'planned', est(1, 10)),
    ])],
    releases: [],
  });
  assert.deepEqual([out.planned.usd, out.planned.minutes], [1, 10]);
});

test('#421 a disabled stage, a skipped item and a done item are not counted in the planned part', () => {
  const out = summarize({
    stages: [
      stage('s1', [item('a', 'done', est(4, 40), { actualUsd: 4 }), item('b', 'skipped', est(8, 80)), item('c', 'planned', est(0.5, 5))]),
      stage('s2', [item('d', 'planned', est(16, 160))], { disabled: true }),
      stage('s3', [item('e', 'done', est(2, 20), { actualUsd: 2 })]),
    ],
    releases: [],
  });
  assert.deepEqual([out.planned.usd, out.planned.minutes, out.planned.items, out.planned.stages], [0.5, 5, 1, 1]);
});

test('#421 an item without an estimate is listed in withoutEstimate and never counted as zero', () => {
  const out = summarize({
    stages: [stage('s1', [item('a', 'planned', est(1.5, 20)), item('b', 'planned', null), item('c', 'running', null, { actualUsd: 0.25, actualMinutes: 5 })])],
    releases: [],
  });
  assert.deepEqual(out.planned.withoutEstimate.map((x) => x.id), ['b', 'c']);
  assert.deepEqual([out.planned.usd, out.planned.minutes], [1.5, 20]);
});

test('#421 spent: the real cost of the finished and running items; since: the oldest item still on the roadmap', () => {
  const out = summarize({
    stages: [
      stage('s1', [
        item('a', 'done', est(2, 20), { actualUsd: 2.5, origin: '2026-10-01T10:00:00.000Z' }),
        item('b', 'running', est(2, 20), { actualUsd: 0.75, actualMinutes: 10, origin: '2026-09-28T08:00:00.000Z' }),
      ]),
      stage('s2', [item('c', 'planned', est(5, 50), { origin: '2026-10-02T09:00:00.000Z' })]),
    ],
    releases: [],
  });
  assert.equal(out.spent.usd, 3.25);
  assert.equal(out.spent.since, '2026-09-28T08:00:00.000Z');
});

test('#421 by release: each cut line (in stage order) gets the stages since the previous line up to it, then the part after the last line', () => {
  const out = summarize({
    stages: [
      stage('s0', [item('a', 'planned', est(1, 10))]),
      stage('s1', [item('b', 'planned', est(2, 20)), item('c', 'planned', est(0.5, 30))]),
      stage('s2', [item('d', 'planned', est(4, 40))]),
      stage('s3', [item('e', 'planned', est(8, 80))], { disabled: true }),
      stage('s4', [item('f', 'planned', est(0.25, 5))]),
    ],
    releases: [{ version: '1.1.0', at: 2 }, { version: '1.0.0', at: 0 }],
  });
  assert.deepEqual(out.releases.map((x) => [x.version ?? null, !!x.after, x.usd, x.minutes]), [
    ['1.0.0', false, 1, 10],
    ['1.1.0', false, 6.5, 70],
    [null, true, 0.25, 5],
  ]);
});

test('#421 by release: a release run whose workflow has history adds its own estimate to its line', () => {
  const out = summarize({
    stages: [
      stage('s0', [item('a', 'planned', est(1, 10))]),
      stage('s1', [item('b', 'planned', est(2, 20))]),
    ],
    releases: [{ version: '1.0.0', at: 0, estimate: est(0.5, 15) }],
  });
  assert.deepEqual(out.releases.map((x) => [x.version ?? null, !!x.after, x.usd, x.minutes]), [
    ['1.0.0', false, 1.5, 25],
    [null, true, 2, 20],
  ]);
});

test('#421 no cut lines: no split by release', () => {
  const out = summarize({ stages: [stage('s0', [item('a', 'planned', est(1, 10))])], releases: [] });
  assert.equal((out.releases || []).length, 0);
});
