// packages/engine/service/areas/run-lists.js (#200): the paged, server-filtered run lists behind runs:list and
// projects:runs — newest first, running (or gate-waiting) runs and their children pinned to the
// first page, filter/search/"Show simulated" applied over every run (not just the loaded pages),
// upTo (a deep link to an older run) and ids (one row's live refresh). packages/engine/domains/run/run-artifacts.js's own
// cache is covered by test/run-artifacts.test.js; this file checks the service actually benefits
// from it (no events.jsonl re-read on an unchanged listing) and that rows never carry a file list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('./helpers');

// A finished run folder, one saved file (so artifactCount is never a coincidental 0) and a
// deterministic startedAt (the listing's "newest first" order has to be exact in these tests).
function addFinishedRun(ws, id, { startedAt, status = 'success', mock = true, projectId = null, parentRunId = null } = {}) {
  const dir = path.join(ws.runs, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const started = { type: 'workflow.started', ts: startedAt, workflow: 'software-development', file: 'software-development.yaml', project_id: projectId, inputs: {}, mock };
  const saved = { type: 'file.saved', path: path.join(dir, 'notes.txt'), step_id: 'work' };
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify(started)}\n${JSON.stringify(saved)}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: id, workflow: 'software-development', file: 'software-development.yaml', project_id: projectId,
    status, mock, started_at: startedAt, finished_at: startedAt, inputs: {}, sessions: [],
    ...(parentRunId ? { parent_run: { run_id: parentRunId, workflow: 'software-development', step_id: 'child', index: 0 } } : {}),
  }));
}

// All comfortably after "today" in these tests' fixtures, so a real run started just now (its
// startedAt is the actual current time) is always older than every one of them, for the pinning test.
const future = (n) => new Date(Date.UTC(2026, 11, 1) + n * 3600 * 1000).toISOString();

test('runs:list pages 30 runs at a time, newest first; the next page has the rest', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  for (let i = 0; i < 35; i++) addFinishedRun(ws, `r${String(i).padStart(2, '0')}`, { startedAt: future(i) });

  const first = await api['runs:list']({ limit: 30 });
  assert.equal(first.runs.length, 30);
  assert.deepEqual(first.runs.map((r) => r.runId).slice(0, 3), ['r34', 'r33', 'r32'], 'newest first');
  assert.equal(first.total, 35);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 30);

  const second = await api['runs:list']({ limit: 30, offset: first.nextOffset });
  assert.deepEqual(second.runs.map((r) => r.runId), ['r04', 'r03', 'r02', 'r01', 'r00']);
  assert.equal(second.hasMore, false);
});

test('runs:list: a running run is always in the first page, even when its own date would put it on a later one', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  // 35 finished runs dated well into the future: without pinning, a run started "now" (older than
  // all of them) would fall on page 2.
  for (let i = 0; i < 35; i++) addFinishedRun(ws, `r${String(i).padStart(2, '0')}`, { startedAt: future(i) });

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  const gate = await gateP;
  t.after(async () => { api['approval:resolve']({ runId, id: gate.approval_id, answer: true }); });

  const res = await api['runs:list']({ limit: 30 });
  assert.equal(res.total, 36);
  assert.equal(res.runs[0].runId, runId, 'pinned ahead of every chronologically newer finished run');
  assert.equal(res.runs[0].status, 'running');
});

test('runs:list: a child run rides along with its parent, in the same page, without its own slot in total', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  for (let i = 0; i < 32; i++) addFinishedRun(ws, `filler${String(i).padStart(2, '0')}`, { startedAt: future(i) });
  addFinishedRun(ws, 'parent1', { startedAt: future(100) }); // the newest: certainly on page 1
  addFinishedRun(ws, 'child1', { startedAt: future(-500), parentRunId: 'parent1' }); // far older alone

  const res = await api['runs:list']({ limit: 30 });
  assert.equal(res.total, 33, 'parent1 + 32 fillers: the child is not a separate top-level slot');
  const ids = res.runs.map((r) => r.runId);
  assert.ok(ids.includes('parent1') && ids.includes('child1'), 'the child is pulled onto its parent\'s page despite its own (much older) date');
});

test('runs:list: the filter chips, "Show simulated" and the search apply over every run, with counts of every run', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  addFinishedRun(ws, 'ok1', { startedAt: future(1), status: 'success', mock: false });
  addFinishedRun(ws, 'ok2', { startedAt: future(2), status: 'success', mock: true });
  addFinishedRun(ws, 'bad1', { startedAt: future(3), status: 'failed', mock: false });
  addFinishedRun(ws, 'bad2', { startedAt: future(4), status: 'cancelled', mock: false });

  const all = await api['runs:list']({ limit: 30 });
  assert.deepEqual(all.counts, { all: 4, running: 0, success: 2, failed: 2 });
  assert.equal(all.hiddenSim, 0, 'showSim unset: simulated runs are not hidden (the supervisor\'s list_runs reads every run)');

  const real = await api['runs:list']({ limit: 30, showSim: false });
  assert.deepEqual(real.runs.map((r) => r.runId).sort(), ['bad1', 'bad2', 'ok1']);
  assert.equal(real.hiddenSim, 1);
  assert.deepEqual(real.counts, { all: 3, running: 0, success: 1, failed: 2 }, 'counts are of the real runs only, still every one of them (not just the page)');

  const failedOnly = await api['runs:list']({ limit: 30, filter: 'failed' });
  assert.deepEqual(failedOnly.runs.map((r) => r.runId).sort(), ['bad1', 'bad2'], 'failed groups failed, cancelled and interrupted');

  const searched = await api['runs:list']({ limit: 30, q: 'bad1' });
  assert.deepEqual(searched.runs.map((r) => r.runId), ['bad1']);
  assert.equal(searched.total, 1, 'the search narrows the total too, not only the page');
});

test('runs:list: upTo extends the first page to include an older run (a deep link)', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  for (let i = 0; i < 35; i++) addFinishedRun(ws, `r${String(i).padStart(2, '0')}`, { startedAt: future(i) });
  // newest first: r34..r05 is the normal page 1; r02 (33rd newest) would be on page 2 without upTo
  const res = await api['runs:list']({ limit: 30, upTo: 'r02' });
  assert.equal(res.nextOffset, 33);
  assert.ok(res.runs.some((r) => r.runId === 'r02'), 'the page grew to include it');
});

test('runs:list: { ids } answers just those rows, bypassing paging entirely (a single row\'s live refresh)', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  for (let i = 0; i < 5; i++) addFinishedRun(ws, `r${i}`, { startedAt: future(i) });

  const res = await api['runs:list']({ ids: ['r2'] });
  assert.equal(res.runs.length, 1);
  assert.equal(res.runs[0].runId, 'r2');
  assert.equal(res.total, undefined, 'not a page: no paging fields at all');
});

test('runs:list: rows carry artifactCount/imageCount, never an inline file list; an unchanged second listing reads no run\'s events.jsonl again', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  for (let i = 0; i < 35; i++) addFinishedRun(ws, `r${String(i).padStart(2, '0')}`, { startedAt: future(i) });

  const first = await api['runs:list']({ limit: 30 }); // warms the run-info cache and the artifact index
  for (const r of first.runs) {
    assert.equal(r.artifactCount, 1);
    assert.equal(typeof r.imageCount, 'number');
    assert.equal(r.artifacts, undefined, 'the file list itself is never sent: only artifacts:list { runId } loads it');
  }

  const openMock = t.mock.method(fs.promises, 'open');
  const second = await api['runs:list']({ limit: 30 });
  const eventsOpens = openMock.mock.calls.filter((c) => String(c.arguments[0]).endsWith('events.jsonl'));
  assert.deepEqual(eventsOpens, [], 'no run\'s events.jsonl was read again: both caches (run info, artifact index) hit');
  assert.deepEqual(second.runs.map((r) => r.runId), first.runs.map((r) => r.runId));
});

test('projects:runs pages a project\'s own runs the same way, newest first, excluding runs of other projects', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'run-lists-proj-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  for (let i = 0; i < 32; i++) addFinishedRun(ws, `p${String(i).padStart(2, '0')}`, { startedAt: future(i), projectId: p.id });
  addFinishedRun(ws, 'other', { startedAt: future(100) }); // a different project: never shown nor counted here

  const res = await api['projects:runs']({ id: p.id, limit: 30 });
  assert.equal(res.runs.length, 30);
  assert.equal(res.total, 32);
  assert.equal(res.hasMore, true);
  assert.equal(res.project.id, p.id);
});
