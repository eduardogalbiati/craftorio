// #384 "A failed run that was resumed still shows only Failed": the data side. Acceptance tests
// written before the code.
//
// A run resumed from a step (#250) records `resumed_from: { run_id, step }` on its workflow.started
// event. The failed run it resumes must know, from that link, which run resumed it and how that run
// is doing, so its card can say "Resumed → succeeded" with a link (test/renderer-resumed-run-384.test.js).
//
// Seams:
// - runs.listRuns(runsDir) (src/runs.js): the RunInfo rows the lists are built from (no index open).
// - The service's `runs:list` channel (src/service/areas/run-lists.js), index open: one page, and
//   `{ ids }` (what a run event uses to refresh one row, refreshRunRow in src/renderer/run-list.js).
// - The service's `roadmap:get` channel (src/service/areas/roadmap.js roadmapView).
// The run folders are written by hand, the way a resume leaves them on disk (summary.json,
// events.jsonl with workflow.started's resumed_from, owner.json while a run is alive): the link
// comes from the resumed run's recorded resumed_from (through the run record, #350), never from
// anything the resume writes into the old run's folder.
//
// Assumptions (the names the developer implements):
// - A run that was resumed carries `resumedBy: { runId, status }` in its RunInfo / runs:list row:
//   runId = the run whose workflow.started has resumed_from.run_id = this run, status = that run's
//   status as the lists show it ('success', 'running', 'failed', ...). A run nobody resumed has no
//   resumedBy (undefined or null).
// - The forward link is derived once per listing (or kept in the index next to resumed_from), not by
//   scanning every run per row: `runs:list { ids: [failed] }` must give it with the index open, also
//   when the failed run was indexed before its resume was written (its own files never change).
// - A roadmap item whose run was resumed shows the resumed run as its run (`runId`, `run`, the status
//   derived from it), the earlier run kept in its `runs` (the history), even when the stored item
//   still points at the failed run.
// Modules that change are required inside each test, so this file loads before the code exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FAILED = '20261014-100000-failed01';
const RESUMED = '20261014-110000-resumed1';
const T0 = Date.parse('2026-10-14T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

const loadRuns = () => require('../src/runs');
const loadHelpers = () => require('./service/helpers');
const loadRoadmaps = () => require('../src/roadmap');

/**
 * Writes a run folder as the engine leaves it. status 'running': no summary.json, an owner.json of
 * this process with a fresh heartbeat (src/run-owner.js), so the lists read it as running.
 */
function writeRun(runsDir, runId, { status, resumedFrom = null, startMs = T0, projectId = null }) {
  const dir = path.join(runsDir, runId);
  fs.mkdirSync(dir, { recursive: true });
  const inputs = { task: 'Fix the login page so a wrong password shows an error' };
  const started = {
    ts: iso(startMs), type: 'workflow.started', run_id: runId, workflow: 'fixture-service', file: 'fixture-service.yaml', mock: true, inputs,
    cost_accounting: 'per_turn', turn_cost: 'max_result',
    ...(projectId ? { project_id: projectId } : {}),
    ...(resumedFrom ? { resumed_from: { run_id: resumedFrom, step: 'work' } } : {}),
  };
  const events = [started, { ts: iso(startMs + 1000), type: 'step.started', step_id: 'work', visit: 1, step_type: 'agent', agent: 'a' }];
  if (status === 'running') {
    fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), started_at: iso(Date.now()), heartbeat_at: iso(Date.now()) }));
  } else {
    const error = status === 'failed' ? 'Step work failed: the agent gave up' : null;
    const summary = {
      run_id: runId, workflow: 'fixture-service', status, mock: true, started_at: iso(startMs), finished_at: iso(startMs + 60000), duration_ms: 60000,
      cost_usd: 0, sessions: [], cost_accounting: 'per_turn', turn_cost: 'max_result', inputs, ...(projectId ? { project_id: projectId } : {}),
    };
    events.push({ ts: iso(startMs + 60000), type: 'workflow.finished', status, ...(error ? { error } : {}), summary });
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary));
  }
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  return dir;
}

/** The resumed run ends: its summary.json written, its owner gone. */
function finishRun(runsDir, runId, status, startMs) {
  fs.rmSync(path.join(runsDir, runId, 'owner.json'), { force: true });
  writeRun(runsDir, runId, { status, resumedFrom: FAILED, startMs });
}

function tmpRuns(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-384-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const rowOf = (list, id) => {
  const r = (list || []).find((x) => x.runId === id);
  assert.ok(r, `run ${id} is listed`);
  return r;
};
const link = (r) => (r.resumedBy ? [r.resumedBy.runId ?? null, r.resumedBy.status ?? null] : null);

// ---- criteria 1-2: the failed run knows its resume and how it is doing (listRuns) ------------------

test('#384 listRuns: a failed run resumed by a run that succeeded carries resumedBy { runId, status: success }', (t) => {
  const runsDir = tmpRuns(t);
  writeRun(runsDir, FAILED, { status: 'failed' });
  writeRun(runsDir, RESUMED, { status: 'success', resumedFrom: FAILED, startMs: T0 + 3600e3 });
  const list = loadRuns().listRuns(runsDir);
  assert.deepEqual(link(rowOf(list, FAILED)), [RESUMED, 'success']);
  assert.equal(rowOf(list, RESUMED).resumedBy ?? null, null, 'the resumed run itself was not resumed');
  assert.equal(rowOf(list, RESUMED).resumedFrom, FAILED, 'the backward link stays as it was');
});

test('#384 listRuns: a failed run whose resume is still running carries resumedBy { runId, status: running }', (t) => {
  const runsDir = tmpRuns(t);
  writeRun(runsDir, FAILED, { status: 'failed' });
  writeRun(runsDir, RESUMED, { status: 'running', resumedFrom: FAILED, startMs: T0 + 3600e3 });
  assert.deepEqual(link(rowOf(loadRuns().listRuns(runsDir), FAILED)), [RESUMED, 'running']);
});

test('#384 listRuns: a failed run whose resume failed too carries resumedBy { runId, status: failed }', (t) => {
  const runsDir = tmpRuns(t);
  writeRun(runsDir, FAILED, { status: 'failed' });
  writeRun(runsDir, RESUMED, { status: 'failed', resumedFrom: FAILED, startMs: T0 + 3600e3 });
  assert.deepEqual(link(rowOf(loadRuns().listRuns(runsDir), FAILED)), [RESUMED, 'failed']);
});

// ---- criterion 3: derived from the resumed run's resumed_from, with the index, as it changes -------

test('#384 runs:list (index open): the failed run indexed before its resume gets the link once the resumed run is written, and its status as it ends', async (t) => {
  const { makeService } = loadHelpers();
  const { service, api } = makeService(t);
  const runsDir = service.workspace().runs;
  writeRun(runsDir, FAILED, { status: 'failed' });
  // the failed run is listed (and indexed) before anything resumed it
  const before = await api['runs:list']({ offset: 0, limit: 30 });
  assert.equal(rowOf(before.runs, FAILED).resumedBy ?? null, null, 'not resumed yet');

  writeRun(runsDir, RESUMED, { status: 'running', resumedFrom: FAILED, startMs: T0 + 3600e3 });
  const page = await api['runs:list']({ offset: 0, limit: 30 });
  assert.deepEqual(link(rowOf(page.runs, FAILED)), [RESUMED, 'running'], 'a page of the list');
  const one = await api['runs:list']({ ids: [FAILED] });
  assert.deepEqual(link(rowOf(one.runs, FAILED)), [RESUMED, 'running'], 'the row refreshed alone (runs:list { ids })');

  finishRun(runsDir, RESUMED, 'success', T0 + 3600e3);
  const after = await api['runs:list']({ ids: [FAILED] });
  assert.deepEqual(link(rowOf(after.runs, FAILED)), [RESUMED, 'success'], 'the resumed run ended: the failed run\'s row says so');
});

// ---- criterion 4: the roadmap item follows the resume ----------------------------------------------

test('#384 roadmap:get: an item whose failed run was resumed shows the resumed run and its status, the failed run in its history', async (t) => {
  const { makeService, roadmapProject, roadmapIssue } = loadHelpers();
  const roadmaps = loadRoadmaps();
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1], 'resumed-384');
  roadmaps.saveStages(ws.backlog, p.id, [{ items: [{ workflow: 'fixture-service.yaml', number: 1, mock: true }] }], { issues: [roadmapIssue(1)] });
  const stored = roadmaps.readRoadmap(ws.backlog, p.id).stages[0].items[0];
  // the item's file still points at the failed run (the resume was not adopted into it)
  roadmaps.markStarted(ws.backlog, p.id, stored.id, { runId: FAILED });
  writeRun(ws.runs, FAILED, { status: 'failed', projectId: p.id });
  writeRun(ws.runs, RESUMED, { status: 'success', resumedFrom: FAILED, startMs: T0 + 3600e3, projectId: p.id });

  const item = api['roadmap:get']({ projectId: p.id }).stages[0].items[0];
  assert.equal(item.runId, RESUMED, 'the card shows the run that holds its status');
  assert.equal(item.run?.status ?? null, 'success', 'the card\'s run is the resumed one');
  assert.notEqual(item.status, 'failed', 'the item is not failed: its resumed run succeeded (a simulation counts as merged)');
  assert.ok(Array.from(item.runs || []).includes(FAILED), `the failed run stays in the item's history: ${JSON.stringify(item.runs)}`);
});
