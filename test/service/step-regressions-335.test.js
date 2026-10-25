// #335 step regressions through the service (src/service/channels/nightwatch.js): a little after a run
// finishes (a `workflow.finished` run:event, then REGRESSION_DELAY_MS), while a watch is on (here
// Self-healing), each newly regressed step is logged once as an `oracle.detected` entry of kind
// 'regression' with its evidence; the keys regressed now are kept in <oracle>/regressions.json, so a
// restart does not log them again, and a step that recovers leaves the list, so its next rise is
// logged again. The delay runs on mocked timers; the Oracle's wake-ups are off (wakeScope 'off'), no
// model is asked and the service runs with MULTIAGENT_SIMULATION_ONLY=1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const night = require('../../src/domains/night/night-watch');
const runs = require('../../src/runs');
const { makeService } = require('./helpers');

const MIN = 60000;
const WF = 'software-development.yaml';
const settle = () => new Promise((r) => setTimeout(r, 50));

function setup(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const dir = ws.oracle || path.join(ws.root, 'oracle');
  const prev = api['settings:get']().oracle;
  const setOracle = (o) => api['settings:set']({ oracle: { ...prev, wakeScope: 'off', ...o } });
  const regressions = () => night.readNightLog(dir).filter((e) => e.type === 'oracle.detected' && e.kind === 'regression');
  const flaggedFile = path.join(dir, 'regressions.json');
  return { service, ws, dir, setOracle, regressions, flaggedFile };
}

const tokens = { input: 1000, output: 100, cache_read: 0, cache_write: 0, reasoning: 0 };
// a real successful run of WF on `day` (September 2026): one `test` step of `minutes`, costing `cost`
function writeRun(runsDir, id, day, { cost = 3, minutes = 10 } = {}) {
  const t0 = Date.parse('2026-09-01T10:00:00.000Z') + (day - 1) * 86400000;
  const iso = (m) => new Date(t0 + m * MIN).toISOString();
  const dir = path.join(runsDir, id);
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  const events = [
    { seq: 1, run_id: id, ts: iso(0), type: 'workflow.started', workflow: 'Software Development', file: WF, mock: false, cost_accounting: 'per_turn' },
    { seq: 2, run_id: id, ts: iso(minutes), type: 'workflow.finished', status: 'success' },
  ];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: id, workflow: 'Software Development', status: 'success', mock: false, cost_accounting: 'per_turn', turn_cost: 'max_result',
    started_at: iso(0), finished_at: iso(minutes), duration_ms: minutes * MIN, cost_usd: cost, tokens,
    progress: [{ step: 'test', type: 'agent', durationMs: minutes * MIN }],
    sessions: [{ id: `s-${id}`, agent: 'test_writer', provider: 'claude', model: 'claude-opus-5-5', effort: 'high', step_id: 'test', turns: 1, cost_usd: cost, tokens }],
  }, null, 2));
}
// `n` runs from `fromDay` on
const writeSeries = (runsDir, prefix, n, fromDay, opts) => { for (let i = 0; i < n; i++) writeRun(runsDir, `${prefix}-${i + 1}`, fromDay + i, opts); };

// a run finished: the service checks after its delay (mocked timers, restored at once)
function finish(service, runId) {
  test.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    service.events.emit('run:event', { type: 'workflow.finished', run_id: runId, status: 'success', ts: new Date().toISOString() });
    test.mock.timers.tick(10e3 + 1);
  } finally {
    test.mock.timers.reset();
  }
}

test('#335 service: a step regressed over its last 3 runs is logged once as a regression with its evidence', async (t) => {
  const { service, ws, setOracle, regressions, flaggedFile } = setup(t);
  setOracle({ selfHealing: true });
  await settle();
  writeSeries(ws.runs, 'base', 6, 1);
  writeSeries(ws.runs, 'rise', 3, 7, { cost: 4.5 });
  finish(service, 'rise-3');
  await settle();
  const found = regressions();
  assert.equal(found.length, 1);
  assert.equal(found[0].evidence.step, 'test');
  assert.equal(found[0].evidence.workflow, WF);
  assert.deepEqual(found[0].evidence.regressed, ['cost']);
  assert.equal(JSON.parse(fs.readFileSync(flaggedFile, 'utf8')).flagged.length, 1);
  // still regressed after the next run: not logged again
  finish(service, 'rise-3');
  await settle();
  assert.equal(regressions().length, 1);
});

test('#335 service: no watch on, no regression is logged', async (t) => {
  const { service, ws, regressions } = setup(t);
  writeSeries(ws.runs, 'base', 6, 1);
  writeSeries(ws.runs, 'rise', 3, 7, { cost: 4.5 });
  finish(service, 'rise-3');
  await settle();
  assert.equal(regressions().length, 0);
});

test('#335 service: a step flagged before a restart (regressions.json) is not logged again', async (t) => {
  const { service, ws, dir, setOracle, regressions, flaggedFile } = setup(t);
  writeSeries(ws.runs, 'base', 6, 1);
  writeSeries(ws.runs, 'rise', 3, 7, { cost: 4.5 });
  const keys = night.regressionFindings(runs.listRuns(ws.runs)).map((f) => f.key);
  assert.equal(keys.length, 1);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(flaggedFile, `${JSON.stringify({ flagged: keys, updatedAt: new Date().toISOString() })}\n`);
  setOracle({ selfHealing: true });
  await settle();
  finish(service, 'rise-3');
  await settle();
  assert.equal(regressions().length, 0);
});

test('#335 service: a step that recovers leaves the flagged list, and its next rise in the same watch is logged again', async (t) => {
  const { service, ws, setOracle, regressions, flaggedFile } = setup(t);
  setOracle({ selfHealing: true });
  await settle();
  writeSeries(ws.runs, 'base', 6, 1);
  writeSeries(ws.runs, 'rise', 3, 7, { cost: 4.5 });
  finish(service, 'rise-3');
  await settle();
  assert.equal(regressions().length, 1);
  // back to 3 (the baseline median stays 3): recovered
  writeSeries(ws.runs, 'back', 3, 10);
  finish(service, 'back-3');
  await settle();
  assert.deepEqual(JSON.parse(fs.readFileSync(flaggedFile, 'utf8')).flagged, []);
  // a new rise: reported again
  writeSeries(ws.runs, 'again', 3, 13, { cost: 4.5 });
  finish(service, 'again-3');
  await settle();
  assert.equal(regressions().length, 2);
});
