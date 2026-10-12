// #310: the workflow filter of Workflows › Runs, in the service (src/service/areas/run-lists.js,
// runs:list). The new `workflow` option (the run's recorded workflow file name, e.g.
// 'software-development.yaml'; empty or unset: every workflow) narrows the list over every run,
// before the paging, and combines with the status chip (`filter`), "Show simulated" (`showSim`) and
// the search (`q`); the status chip counts follow it. The answer also carries `workflows`: the
// workflows that have runs, each { workflow, count }, for the filter's options.
// Runs are written as run folders (events.jsonl + summary.json), the way test/service/run-lists.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./helpers');

// A finished run of `file` (its workflow name is the file's stem), with a task text of its own.
function addRun(ws, id, { startedAt, file = 'software-development.yaml', status = 'success', mock = false, task = 'Do the work' } = {}) {
  const workflow = file.replace(/\.ya?ml$/i, '');
  const dir = path.join(ws.runs, id);
  fs.mkdirSync(dir, { recursive: true });
  const started = { type: 'workflow.started', ts: startedAt, workflow, file, project_id: null, inputs: { task }, mock };
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify(started)}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: id, workflow, file, project_id: null, status, mock,
    started_at: startedAt, finished_at: startedAt, inputs: { task }, sessions: [],
  }));
}

const future = (n) => new Date(Date.UTC(2026, 11, 1) + n * 3600 * 1000).toISOString();
const ids = (res) => (res.runs || []).map((r) => r.runId).sort();
const SD = 'software-development.yaml';
const BF = 'bug-fix.yaml';

test('runs:list { workflow }: only the runs of that workflow, matched by the recorded file name, not by text', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  addRun(ws, 'sd1', { startedAt: future(1), file: SD });
  addRun(ws, 'sd2', { startedAt: future(2), file: SD });
  // a bug-fix run whose task names the other workflow's file: a text match would let it in
  addRun(ws, 'bf1', { startedAt: future(3), file: BF, task: `Port the steps of ${SD} into this one` });

  const res = await api['runs:list']({ limit: 30, workflow: SD });
  assert.deepEqual(ids(res), ['sd1', 'sd2']);
  assert.equal(res.total, 2);

  const other = await api['runs:list']({ limit: 30, workflow: BF });
  assert.deepEqual(ids(other), ['bf1']);

  const all = await api['runs:list']({ limit: 30, workflow: '' });
  assert.deepEqual(ids(all), ['bf1', 'sd1', 'sd2'], 'an empty workflow is "All workflows"');
});

test('runs:list { workflow, filter: "failed" }: the workflow and the status chip combine', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  addRun(ws, 'sd-ok', { startedAt: future(1), file: SD, status: 'success' });
  addRun(ws, 'sd-bad', { startedAt: future(2), file: SD, status: 'failed' });
  addRun(ws, 'sd-cancel', { startedAt: future(3), file: SD, status: 'cancelled' });
  addRun(ws, 'bf-bad', { startedAt: future(4), file: BF, status: 'failed' });

  const res = await api['runs:list']({ limit: 30, workflow: SD, filter: 'failed' });
  assert.deepEqual(ids(res), ['sd-bad', 'sd-cancel']);
  assert.equal(res.total, 2);
});

test('runs:list { workflow, showSim }: the workflow\'s simulated runs are hidden with showSim false and shown with showSim true', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  addRun(ws, 'sd-real', { startedAt: future(1), file: SD, mock: false });
  addRun(ws, 'sd-sim', { startedAt: future(2), file: SD, mock: true });
  addRun(ws, 'bf-real', { startedAt: future(3), file: BF, mock: false });
  addRun(ws, 'bf-sim', { startedAt: future(4), file: BF, mock: true });

  const real = await api['runs:list']({ limit: 30, workflow: SD, showSim: false });
  assert.deepEqual(ids(real), ['sd-real']);
  assert.equal(real.hiddenSim, 1, 'the hidden simulated runs are the workflow\'s own');

  const withSim = await api['runs:list']({ limit: 30, workflow: SD, showSim: true });
  assert.deepEqual(ids(withSim), ['sd-real', 'sd-sim']);
});

test('runs:list { workflow, q }: the search narrows the workflow\'s runs', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  addRun(ws, 'sd-login', { startedAt: future(1), file: SD, task: 'Fix the login page' });
  addRun(ws, 'sd-other', { startedAt: future(2), file: SD, task: 'Add a settings page' });
  addRun(ws, 'bf-login', { startedAt: future(3), file: BF, task: 'Fix the login page' });

  const res = await api['runs:list']({ limit: 30, workflow: SD, q: 'login' });
  assert.deepEqual(ids(res), ['sd-login']);
});

test('runs:list { workflow }: the status chip counts are of that workflow\'s runs only', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  addRun(ws, 'sd-ok', { startedAt: future(1), file: SD, status: 'success' });
  addRun(ws, 'sd-bad', { startedAt: future(2), file: SD, status: 'failed' });
  addRun(ws, 'bf-ok1', { startedAt: future(3), file: BF, status: 'success' });
  addRun(ws, 'bf-ok2', { startedAt: future(4), file: BF, status: 'success' });
  addRun(ws, 'bf-bad', { startedAt: future(5), file: BF, status: 'interrupted' });

  const res = await api['runs:list']({ limit: 30, workflow: SD, filter: 'success' });
  assert.deepEqual({ ...res.counts }, { all: 2, running: 0, success: 1, failed: 1 });
});

test('runs:list { workflow }: pages with offset/limit over every run of the workflow', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  for (let i = 0; i < 35; i++) addRun(ws, `sd${String(i).padStart(2, '0')}`, { startedAt: future(i), file: SD });
  // newer than every software-development run: without the filter they would take page 1's first slots
  for (let i = 0; i < 5; i++) addRun(ws, `bf${i}`, { startedAt: future(100 + i), file: BF });

  const first = await api['runs:list']({ limit: 30, workflow: SD });
  assert.equal(first.runs.length, 30);
  assert.equal(first.total, 35);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 30);
  assert.deepEqual(first.runs.map((r) => r.runId).slice(0, 2), ['sd34', 'sd33'], 'newest first, the other workflow\'s newer runs left out');

  const second = await api['runs:list']({ limit: 30, offset: first.nextOffset, workflow: SD });
  assert.deepEqual(second.runs.map((r) => r.runId), ['sd04', 'sd03', 'sd02', 'sd01', 'sd00']);
  assert.equal(second.hasMore, false);
});

test('runs:list { workflow }: a workflow with no runs answers an empty page, not an error', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  addRun(ws, 'sd1', { startedAt: future(1), file: SD });

  const res = await api['runs:list']({ limit: 30, workflow: 'never-ran.yaml' });
  assert.deepEqual(ids(res), []);
  assert.equal(res.total, 0);
  assert.equal(res.hasMore, false);
  assert.equal(res.counts.all, 0);
});

test('runs:list { workflow }: the runs of a workflow whose file is gone (renamed or deleted) still match by their recorded name', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  const gone = 'retired-flow.yaml';
  assert.equal(fs.existsSync(path.join(ws.workflows, gone)), false, 'the fixture: no such workflow file');
  addRun(ws, 'old1', { startedAt: future(1), file: gone });
  addRun(ws, 'sd1', { startedAt: future(2), file: SD });

  const res = await api['runs:list']({ limit: 30, workflow: gone });
  assert.deepEqual(ids(res), ['old1']);
  const listed = (res.workflows || []).map((w) => w.workflow);
  assert.ok(listed.includes(gone), 'the filter still offers it, under its recorded name');
});

test('runs:list: `workflows` lists each workflow that has runs with its run count, whichever workflow is picked', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  addRun(ws, 'sd1', { startedAt: future(1), file: SD });
  addRun(ws, 'sd2', { startedAt: future(2), file: SD });
  addRun(ws, 'sd3', { startedAt: future(3), file: SD });
  addRun(ws, 'bf1', { startedAt: future(4), file: BF });

  const countsOf = (res) => Object.fromEntries((res.workflows || []).map((w) => [w.workflow, w.count]));
  const all = await api['runs:list']({ limit: 30 });
  assert.ok(Array.isArray(all.workflows), 'the answer carries `workflows`');
  assert.deepEqual(countsOf(all), { [SD]: 3, [BF]: 1 });

  const picked = await api['runs:list']({ limit: 30, workflow: BF });
  assert.deepEqual(countsOf(picked), { [SD]: 3, [BF]: 1 }, 'picking one keeps the others in the filter\'s options');
});

test('runs:list: `workflows` counts only the runs "Show simulated" keeps', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  addRun(ws, 'sd-real', { startedAt: future(1), file: SD });
  addRun(ws, 'sd-sim', { startedAt: future(2), file: SD, mock: true });
  addRun(ws, 'bf-sim', { startedAt: future(3), file: BF, mock: true });

  const countsOf = (res) => Object.fromEntries((res.workflows || []).map((w) => [w.workflow, w.count]));
  assert.deepEqual(countsOf(await api['runs:list']({ limit: 30, showSim: false })), { [SD]: 1 },
    'a workflow with only simulated runs leaves the options');
  assert.deepEqual(countsOf(await api['runs:list']({ limit: 30, showSim: true })), { [SD]: 2, [BF]: 1 });
});

test('runs:list { workflow }: a run recorded without a workflow file is listed under its workflow name', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  // an older run: its workflow.started event and summary carry the workflow name but no `file`
  const dir = path.join(ws.runs, 'legacy1');
  fs.mkdirSync(dir, { recursive: true });
  const started = { type: 'workflow.started', ts: future(1), workflow: 'software-development', project_id: null, inputs: { task: 'Old work' }, mock: false };
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify(started)}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: 'legacy1', workflow: 'software-development', project_id: null, status: 'success', mock: false,
    started_at: future(1), finished_at: future(1), inputs: { task: 'Old work' }, sessions: [],
  }));
  addRun(ws, 'sd1', { startedAt: future(2), file: SD });

  const all = await api['runs:list']({ limit: 30 });
  const countsOf = Object.fromEntries((all.workflows || []).map((w) => [w.workflow, w.count]));
  assert.deepEqual(countsOf, { 'software-development': 1, [SD]: 1 }, 'apart from the same workflow\'s runs with a file');

  assert.deepEqual(ids(await api['runs:list']({ limit: 30, workflow: 'software-development' })), ['legacy1']);
  assert.deepEqual(ids(await api['runs:list']({ limit: 30, workflow: SD })), ['sd1']);
});
