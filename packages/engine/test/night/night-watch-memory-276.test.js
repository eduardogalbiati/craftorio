// #276 memory guard in the Night watch (packages/engine/domains/night/night-watch.js, packages/engine/service/channels/nightwatch.js): a new
// incident kind `memory` for a run's process stopped over the memory limit and for a low-memory hold
// longer than 5 minutes. It is counted in the night's metrics and named in the morning summary; the
// watch takes no action for it (no oracle.action, no escalation: it only records it).
// Assumptions (acceptance tests written before the code):
//   - the stop is the engine's run event `process.killed` (fixture: { pid, command_line,
//     bytes, limit_bytes, step_id, session }, as in memory-guard-suite-276.test.js); incidentOf maps every process.killed to `memory`;
//   - the hold is a run event `memory.hold` { waited_ms, free_bytes, floor_bytes }, written when
//     the hold ends (or is still going); incidentOf gives `memory` when waited_ms > 5 min, else null;
//   - the morning summary's lines (morningSummary) name it with the word "memory" when the night
//     had memory incidents.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeService } = require('../service/helpers');

const GIB = 1024 ** 3;
const W0 = Date.parse('2026-10-01T22:00:00.000Z');
const iso = (m) => new Date(W0 + m * 60e3).toISOString();
const night = { startedAt: iso(0), until: iso(540) };
const NOW = W0 + 540 * 60e3;

const killed = (extra = {}) => ({ type: 'process.killed', run_id: 'r1', ts: iso(100), pid: 4242, command_line: 'node --test test/x.test.js', bytes: 9 * GIB, limit_bytes: 8 * GIB, step_id: 'test', session: 's1', ...extra });
const hold = (waitedMs, extra = {}) => ({ type: 'memory.hold', run_id: 'r1', ts: iso(100), waited_ms: waitedMs, free_bytes: 2 * GIB, floor_bytes: 3.2 * GIB, ...extra });

test('INCIDENT_KINDS includes memory, with a label', () => {
  const { INCIDENT_KINDS } = require('../../domains/night/night-watch');
  assert.equal(Object.keys(INCIDENT_KINDS).includes('memory'), true);
  assert.equal(typeof INCIDENT_KINDS.memory, 'string');
  assert.match(INCIDENT_KINDS.memory, /memory/i);
});

test('incidentOf: a process.killed event (stopped over the memory limit) is a memory incident', () => {
  const { incidentOf } = require('../../domains/night/night-watch');
  assert.equal(incidentOf(killed()), 'memory');
});

test('incidentOf: a memory hold longer than 5 minutes is a memory incident', () => {
  const { incidentOf } = require('../../domains/night/night-watch');
  assert.equal(incidentOf(hold(5 * 60e3 + 1000)), 'memory');
  assert.equal(incidentOf(hold(42 * 60e3)), 'memory');
});

test('incidentOf: a memory hold shorter than 5 minutes is not an incident', () => {
  const { incidentOf } = require('../../domains/night/night-watch');
  assert.equal(incidentOf(hold(4 * 60e3 + 59e3)), null);
  assert.equal(incidentOf(hold(0)), null);
});

test('incidentOf: the kinds it already knew are unchanged', () => {
  const { incidentOf } = require('../../domains/night/night-watch');
  assert.equal(incidentOf({ type: 'workflow.finished', status: 'failed' }), 'failed');
  assert.equal(incidentOf({ type: 'log', kind: 'stall' }), 'stalled');
  assert.equal(incidentOf({ type: 'step.started' }), null);
});

test('nightMetrics: memory incidents are counted in incidents.byKind.memory', () => {
  const { nightMetrics } = require('../../domains/night/night-watch');
  const log = [
    { ts: iso(100), type: 'oracle.detected', id: 'm1', kind: 'memory', target: 'r1', runId: 'r1', projectId: 'p1', since: iso(100) },
    { ts: iso(200), type: 'oracle.detected', id: 'm2', kind: 'memory', target: 'r2', runId: 'r2', projectId: 'p1', since: iso(190) },
    { ts: iso(300), type: 'oracle.detected', id: 'f1', kind: 'failed', target: 'r3', runId: 'r3', projectId: 'p1', since: iso(299) },
  ];
  const m = nightMetrics({ night, log, runs: [], now: NOW });
  assert.equal(m.incidents.count, 3);
  assert.equal(m.incidents.byKind.memory, 2);
  assert.equal(m.incidents.byKind.failed, 1);
});

test('nightMetrics: a night without memory incidents counts 0 of them', () => {
  const { nightMetrics } = require('../../domains/night/night-watch');
  const m = nightMetrics({ night, log: [], runs: [], now: NOW });
  assert.equal(m.incidents.byKind.memory, 0);
});

test('morningSummary: names the memory incidents of the night', () => {
  const { nightMetrics, morningSummary } = require('../../domains/night/night-watch');
  const log = [
    { ts: iso(100), type: 'oracle.detected', id: 'm1', kind: 'memory', target: 'r1', runId: 'r1', projectId: 'p1', since: iso(100) },
  ];
  const s = morningSummary(nightMetrics({ night, log, runs: [], now: NOW }));
  const text = Object.values(s).filter((v) => typeof v === 'string').join('\n');
  assert.match(text, /memory/i);
});

// The service side: with the watch on, the stop is recorded as an incident and nothing else (no
// action, no escalation). The Oracle's wake-ups are turned off so no model is involved.
async function watchedService(t) {
  const { service, api } = makeService(t);
  const actions = require('../../domains/oracle/oracle-actions');
  const night = require('../../domains/night/night-watch');
  const ws = service.workspace();
  const dir = ws.oracle || path.join(ws.root, 'oracle');
  const settings = api['settings:get']();
  api['settings:set']({ oracle: { ...settings.oracle, wakeScope: 'off' } });
  actions.setNightWatch(dir, { on: true, until: new Date(Date.now() + 2 * 3600e3).toISOString(), by: 'test' });
  const entries = () => night.readNightLog(dir).filter((e) => e.type !== 'oracle.watch');
  return { service, entries };
}

test('Night watch on: a process.killed run event logs one memory incident and no action or escalation', async (t) => {
  const { service, entries } = await watchedService(t);
  service.events.emit('run:event', killed({ ts: new Date().toISOString() }));
  await new Promise((r) => setImmediate(r));
  const log = entries();
  assert.deepEqual(log.map((e) => `${e.type} ${e.kind || ''}`.trim()), ['oracle.detected memory']);
  assert.equal(log[0].runId, 'r1');
});

test('Night watch on: a memory hold over 5 minutes logs a memory incident; a shorter one logs nothing', async (t) => {
  const { service, entries } = await watchedService(t);
  service.events.emit('run:event', hold(2 * 60e3, { run_id: 'short', ts: new Date().toISOString() }));
  service.events.emit('run:event', hold(6 * 60e3, { run_id: 'long', ts: new Date().toISOString() }));
  await new Promise((r) => setImmediate(r));
  const log = entries();
  assert.deepEqual(log.map((e) => `${e.type} ${e.kind || ''} ${e.runId || ''}`.trim()), ['oracle.detected memory long']);
});
