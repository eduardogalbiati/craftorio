// #283 A malformed night log (a watch whose off entry is older than its on entry: the inverted span
// the #278 tests logged in the first minute of a UTC day, or a clock moved back) does not break the
// Night watch: nightwatch:report and nightwatch:morning (src/service/channels/nightwatch.js) and
// night.nightMetrics / selfHealingDays (src/night-watch.js) answer without throwing.
// The service runs with MULTIAGENT_SIMULATION_ONLY=1; no model is asked.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const night = require('../../src/night-watch');
const { makeService } = require('./helpers');
const { dayStart, iso } = require('./day-span');

function setup(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  return { api, dir: ws.oracle || path.join(ws.root, 'oracle') };
}
const logAt = (dir, ms, type, data) => night.logNight(dir, type, data, iso(ms));
const healing = (on, startedAt) => ({ on, until: null, startedAt: iso(startedAt), by: 'Self-healing', selfHealing: true });
const nightWatch = (on, startedAt, until) => ({ on, until: iso(until), startedAt: iso(startedAt), by: 'Night watch screen' });

// a Self-healing day switched on at `on` and off 20 seconds before it, with a finding between
function logInvertedHealing(dir, on) {
  logAt(dir, on, 'oracle.watch', healing(true, on));
  logAt(dir, on - 10e3, 'oracle.detected', { id: 'd1', kind: 'memory', target: 'r1', runId: 'r1', projectId: null, since: iso(on - 10e3), evidence: { command: 'node --test' } });
  logAt(dir, on - 20e3, 'oracle.watch', healing(false, on));
}

async function answers(api) {
  const r = await api['nightwatch:report']();
  assert.ok(Array.isArray(r.nights), JSON.stringify(r));
  const m = await api['nightwatch:morning']();
  assert.ok(m === null || typeof m.summary === 'object', JSON.stringify(m));
  return { r, m };
}

test('#283 service: a Self-healing day that ends 20 s before it starts (same UTC day) leaves the report and the morning card answering', async (t) => {
  const { api, dir } = setup(t);
  logInvertedHealing(dir, Date.now() - 30 * 60e3);
  const { r } = await answers(api);
  const day = r.nights.find((m) => m.window.selfHealing);
  assert.ok(day, `no Self-healing window: ${JSON.stringify(r.nights.map((m) => m.window))}`);
  assert.equal(typeof day.summary.selfHealing, 'string');
});

test('#283 service: a Self-healing day switched on just after midnight UTC and off just before it leaves the report and the morning card answering', async (t) => {
  const { api, dir } = setup(t);
  const midnight = dayStart(Date.now() - 2 * 60e3); // a midnight at least two minutes ago
  logInvertedHealing(dir, midnight + 10e3);
  await answers(api);
});

test('#283 service: a night whose off entry is older than its start leaves the report and the morning card answering', async (t) => {
  const { api, dir } = setup(t);
  const start = Date.now() - 30 * 60e3;
  logAt(dir, start, 'oracle.watch', nightWatch(true, start, start + 3600e3));
  logAt(dir, start - 20e3, 'oracle.watch', nightWatch(false, start, start + 3600e3));
  await answers(api);
});

test('#283 nightMetrics and selfHealingDays read an inverted window without throwing', () => {
  const on = Date.parse('2026-10-05T00:01:00Z');
  const log = [
    { ts: iso(on), type: 'oracle.watch', ...healing(true, on) },
    { ts: iso(on - 10e3), type: 'oracle.detected', id: 'd1', kind: 'memory', target: 'r1', runId: 'r1', projectId: null, since: iso(on - 10e3) },
    { ts: iso(on - 20e3), type: 'oracle.watch', ...healing(false, on) },
  ];
  const now = on + 3600e3;
  const days = night.selfHealingDays(log, now);
  assert.equal(days.length, 1);
  const m = night.nightMetrics({ night: days[0], log, runs: [], usage: [], now });
  assert.ok(m.window.hours >= 0, JSON.stringify(m.window));
  assert.equal(typeof night.morningSummary(m).ran, 'string');
  const counts = night.selfHealingMetrics({ log, usage: [], day: days[0].day });
  assert.equal(counts.detected, 1);
});
