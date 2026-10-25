// packages/engine/domains/run/occupancy.js (#188): the 24/7 meter. Occupancy = time with at least one real run active /
// wall-clock time over a window, the idle time split by cause (the causes add up to the idle total),
// the Night watch split, the plain hint and the cost figures. Pure, computed locally from the runs'
// events (the same `[{ runId, events }]` shape as packages/engine/domains/night/night-watch.js, whose interval logic it reuses).
// Seams: occupancyOf, idleHint, costFigures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { nightMetrics } = require('../../domains/night/night-watch');

// Loaded inside each test: before the module exists, each test fails on its own instead of the file.
const load = () => require('../../domains/run/occupancy');
const occupancyOf = (...args) => load().occupancyOf(...args);
const idleHint = (...args) => load().idleHint(...args);
const costFigures = (...args) => load().costFigures(...args);

const W0 = Date.parse('2026-10-01T00:00:00.000Z');
const minute = (m) => W0 + m * 60e3;
const iso = (m) => new Date(minute(m)).toISOString();
const H = 60;
const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-6, `${msg}: expected ${expected}, got ${actual}`);

function run(runId, start, end, { mock = false, gate = null, cost = 0 } = {}) {
  const events = [{ ts: iso(start), type: 'workflow.started', project_id: 'p1', issues: [], mock }];
  if (gate) {
    events.push({ ts: iso(gate[0]), type: 'approval.requested', approval_id: 'g1', step_id: 'review' });
    events.push({ ts: iso(gate[1]), type: 'approval.resolved', approval_id: 'g1', step_id: 'review', approved: true, by: 'user', wait_ms: (gate[1] - gate[0]) * 60e3 });
  }
  events.push({ ts: iso(end), type: 'workflow.finished', status: 'success', summary: { cost_usd: cost } });
  return { runId, events };
}

// A 10-hour window (00:00 → 10:00 UTC):
// - rA 01:00-04:00 and rB 03:00-05:00 overlap: 4 h active, counted once, 2 runs at once at the peak;
// - rC 06:00-08:00 waits 06:30-07:30 at a human gate: 1 h active, 1 h "waiting for you";
// - rMock 08:00-10:00 is simulated: it does not count;
// - the app ran 00:00-09:00 only: 09:00-10:00 is "app closed".
// Active 5 h of 10 → 50 %; idle 5 h = 1 h gate + 1 h app closed + 3 h of the other causes.
const RUNS = [
  run('rA', 1 * H, 4 * H, { cost: 6 }),
  run('rB', 3 * H, 5 * H, { cost: 2 }),
  run('rC', 6 * H, 8 * H, { gate: [6.5 * H, 7.5 * H], cost: 2 }),
  run('rMock', 8 * H, 10 * H, { mock: true, cost: 100 }),
];
const APP = [{ start: iso(0), end: iso(9 * H) }];
const base = { runs: RUNS, from: iso(0), to: iso(10 * H), now: minute(10 * H), appSessions: APP };

test('occupancyOf: overlapping runs count once, a gate wait is not active, simulated runs are ignored', () => {
  const o = occupancyOf(base);
  near(o.activeHours, 5, 'active hours');
  near(o.occupancy, 0.5, 'occupancy');
  assert.equal(o.empty, false);
});

test('occupancyOf: the idle time is split by cause and the causes add up to the idle total', () => {
  const { idleHours } = occupancyOf(base);
  near(idleHours.total, 5, 'idle total');
  near(idleHours.gate, 1, 'waiting for you (human gate)');
  near(idleHours.appClosed, 1, 'app closed / machine asleep');
  const sum = idleHours.noWork + idleHours.blocked + idleHours.gate + idleHours.appClosed + idleHours.other;
  near(sum, idleHours.total, 'sum of the causes');
});

test('occupancyOf: the peak of concurrent real runs (a simulated run never raises it)', () => {
  assert.equal(occupancyOf(base).peakConcurrent, 2);
});

test('occupancyOf: lists the idle gaps longer than 15 minutes with their cause', () => {
  const { gaps } = occupancyOf(base);
  assert.ok(gaps.every((g) => g.minutes > 15), 'only gaps over 15 min');
  const gate = gaps.find((g) => g.cause === 'gate');
  assert.ok(gate, 'the gate wait is a gap');
  near(gate.minutes, 60, 'gate gap length');
  const closed = gaps.find((g) => g.cause === 'appClosed');
  assert.ok(closed, 'the app-closed hour is a gap');
  near(closed.minutes, 60, 'app-closed gap length');
});

test('occupancyOf: a window with no real runs is empty ("No runs yet")', () => {
  const o = occupancyOf({ runs: [run('m', 60, 120, { mock: true })], from: iso(0), to: iso(10 * H), now: minute(10 * H) });
  assert.equal(o.empty, true);
  near(o.activeHours, 0, 'active hours');
});

test('occupancyOf: inside a Night watch window it agrees with the Night watch occupancy (one implementation)', () => {
  const real = RUNS.filter((r) => r.runId !== 'rMock');
  const night = { startedAt: iso(0), until: iso(5 * H) };
  const o = occupancyOf({ runs: real, from: night.startedAt, to: night.until, now: minute(5 * H) });
  const m = nightMetrics({ night, runs: real, now: minute(5 * H) });
  near(o.occupancy, m.yield.occupancy, 'occupancy vs nightMetrics');
  near(o.occupancy, 0.8, 'occupancy 00:00-05:00'); // 01:00-05:00 active of 5 h
});

test('occupancyOf: splits the window into time under the Night watch and the rest', () => {
  const o = occupancyOf({ ...base, nights: [{ startedAt: iso(0), until: iso(5 * H) }] });
  near(o.nightWatch.inside.occupancy, 0.8, 'inside the watch: 4 h of 5'); // rA + rB
  near(o.nightWatch.outside.occupancy, 0.2, 'outside the watch: 1 h of 5'); // rC minus its gate wait
});

test('idleHint: the dominant idle cause points to its fix; no hint when idle time is spread or zero', () => {
  assert.equal(idleHint({ total: 5, noWork: 4, blocked: 0, gate: 0.5, appClosed: 0.5, other: 0 }).cause, 'noWork');
  assert.equal(idleHint({ total: 5, noWork: 0.5, blocked: 0, gate: 0.5, appClosed: 4, other: 0 }).cause, 'appClosed');
  assert.equal(idleHint({ total: 5, noWork: 0.5, blocked: 0, gate: 4, appClosed: 0.5, other: 0 }).cause, 'gate');
  assert.equal(idleHint({ total: 5, noWork: 2, blocked: 0, gate: 2, appClosed: 1, other: 0 }), null);
  assert.equal(idleHint({ total: 0, noWork: 0, blocked: 0, gate: 0, appClosed: 0, other: 0 }), null);
});

// #273: the days are the owner's local days, also across a daylight-saving change (America/New_York)
const isoRun = (runId, start, end) => ({ runId, events: [
  { ts: start, type: 'workflow.started', project_id: 'p1', issues: [], mock: false },
  { ts: end, type: 'workflow.finished', status: 'success', summary: { cost_usd: 0 } },
] });

test('#273 occupancyOf: across the spring change (New York, 2026-03-08) the local days are a 23-hour and a 24-hour day, and the last local hour is counted', () => {
  // 23:00-24:00 EDT on Mar 8 = 03:00-04:00Z Mar 9
  const o = occupancyOf({ runs: [isoRun('rS', '2026-03-09T03:00:00.000Z', '2026-03-09T04:00:00.000Z')], from: '2026-03-08T05:00:00.000Z', to: '2026-03-10T04:00:00.000Z', now: Date.parse('2026-03-11T00:00:00Z'), timeZone: 'America/New_York' });
  assert.deepEqual(o.days.map((d) => d.day), ['2026-03-08', '2026-03-09']);
  assert.deepEqual(o.days.map((d) => Math.round(d.hours)), [23, 24]);
  assert.deepEqual(o.days.map((d) => d.partial), [false, false]);
  near(o.days[0].activeHours, 1, 'the run is on Mar 8');
  assert.equal(Math.max(...o.days[0].hourly.filter((v) => v != null)), 1);
});

test('#273 occupancyOf: across the autumn change (New York, 2026-11-01) the 25-hour day is one day and its last local hour is not dropped from the hourly strip', () => {
  // 23:00-24:00 EST on Nov 1 = 04:00-05:00Z Nov 2
  const o = occupancyOf({ runs: [isoRun('rF', '2026-11-02T04:00:00.000Z', '2026-11-02T05:00:00.000Z')], from: '2026-10-31T04:00:00.000Z', to: '2026-11-02T05:00:00.000Z', now: Date.parse('2026-11-03T00:00:00Z'), timeZone: 'America/New_York' });
  assert.deepEqual(o.days.map((d) => d.day), ['2026-10-31', '2026-11-01']);
  assert.deepEqual(o.days.map((d) => Math.round(d.hours)), [24, 25]);
  near(o.days[1].activeHours, 1, 'the run is on Nov 1');
  assert.equal(Math.max(...o.days[1].hourly.filter((v) => v != null)), 1, 'the hourly strip shows the last hour\'s run');
});

test('costFigures: cost per active hour, per delivered issue and per 100 lines; none without a denominator', () => {
  assert.deepEqual(costFigures({ costUsd: 30, activeHours: 12, issues: 3, lines: 600 }), { perActiveHour: 2.5, perIssue: 10, per100Lines: 5 });
  assert.deepEqual(costFigures({ costUsd: 30, activeHours: 0, issues: 0, lines: 0 }), { perActiveHour: null, perIssue: null, per100Lines: null });
});
