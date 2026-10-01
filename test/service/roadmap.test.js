const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { createService } = require('../../src/service');
const roadmapModel = require('../../src/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject, until, watchRuns } = require('./helpers');
const path = require('path');

test('roadmap: stage 2 starts only after every stage-1 item succeeds and merges', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2, 3], 'roadmap-order');
  api['settings:set']({ concurrentRuns: { enabled: true, max: 2, perProject: null, countSimulations: true } });
  const { gates, finished } = watchRuns(service);

  await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { name: 'Stage one', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }, { workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
      { name: 'Stage two', items: [{ workflow: 'fixture-issue.yaml', number: 3, mock: true }] },
    ],
  });
  await api['roadmap:start']({ projectId: p.id, simulated: true });

  await until(() => api['runs:active']().length === 2);
  assert.deepEqual(api['runs:active']().flatMap((r) => r.issues.map((i) => i.number)).sort(), [1, 2]);
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[1].items[0].status, 'planned'); // stage 2 has not started

  await until(() => gates.size === 2);
  for (const [runId, id] of gates) api['approval:resolve']({ runId, id, answer: true });
  await until(() => finished.size === 2);

  await until(() => api['runs:active']().some((r) => r.issues.some((i) => i.number === 3)));
  let roadmap = api['roadmap:get']({ projectId: p.id });
  assert.ok(roadmap.stages[0].items.every((x) => x.status === 'done'));
  assert.equal(roadmap.stages[1].items[0].status, 'running');

  const runId3 = api['runs:active']()[0].runId;
  await until(() => gates.has(runId3));
  api['approval:resolve']({ runId: runId3, id: gates.get(runId3), answer: true });
  await until(() => api['roadmap:get']({ projectId: p.id }).state === 'done');
});

test('roadmap: starting for real (not simulated) is refused in simulation-only mode', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'roadmap-real');

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1 }] }] });
  await assert.rejects(api['roadmap:start']({ projectId: p.id, simulated: false }), /Simulation only/);
  assert.equal(api['roadmap:get']({ projectId: p.id }).state, 'planned');
  assert.equal(service.isRunning(), false);
});

test('roadmap: a stopped run pauses the roadmap; roadmap:item retry restarts it', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'roadmap-fail');
  const { gates } = watchRuns(service);

  await api['roadmap:save']({
    projectId: p.id,
    stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }, { items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] }],
  });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().length === 1);
  api['run:stop']({ runId: api['runs:active']()[0].runId });
  await until(() => api['roadmap:get']({ projectId: p.id }).state === 'paused');

  let roadmap = api['roadmap:get']({ projectId: p.id });
  assert.match(roadmap.error, /#1/);
  const failedId = roadmap.pausedBy;
  assert.ok(failedId);
  assert.equal(roadmap.stages[0].items[0].status, 'failed');

  await api['roadmap:item']({ projectId: p.id, itemId: failedId, action: 'retry' });
  await until(() => api['runs:active']().length === 1);
  roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.state, 'running');
  assert.equal(roadmap.stages[0].items[0].status, 'running');

  const active = api['runs:active']()[0];
  await until(() => gates.has(active.runId));
  api['approval:resolve']({ runId: active.runId, id: gates.get(active.runId), answer: true });
});

test('roadmap: Retry on an item whose run is still alive is refused, naming the run; Skip is refused too', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'roadmap-live-retry');

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });
  const itemId = api['roadmap:get']({ projectId: p.id }).stages[0].items[0].id;
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().length === 1);
  const runId = api['runs:active']()[0].runId;
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[0].items[0].status, 'running');

  await assert.rejects(api['roadmap:item']({ projectId: p.id, itemId, action: 'retry' }), new RegExp(`Run ${runId} is still running\\.`));
  await assert.rejects(api['roadmap:item']({ projectId: p.id, itemId, action: 'skip' }), /in progress/);
  // refusing it changed nothing: still the same run, still running
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[0].items[0].runId, runId);
  assert.equal(api['runs:active']().length, 1);

  api['run:stop']({ runId });
});

test('roadmap: Run this stage (scope) starts only that stage\'s items; once it is done the roadmap pauses as "Stage N done" leaving the others planned, and Start afterwards resumes from stage 1', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2, 3], 'roadmap-scope');
  const { gates, finished } = watchRuns(service);
  const notified = [];
  service.events.on('notify', (n) => notified.push(n));

  await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { name: 'Stage one', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] },
      { name: 'Stage two', items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
      { name: 'Stage three', items: [{ workflow: 'fixture-issue.yaml', number: 3, mock: true }] },
    ],
  });
  const stage2 = api['roadmap:get']({ projectId: p.id }).stages[1].id;
  await api['roadmap:start']({ projectId: p.id, simulated: true, stage: stage2 });

  await until(() => api['runs:active']().length === 1);
  assert.deepEqual(api['runs:active']()[0].issues.map((i) => i.number), [2]); // only stage 2 started
  let roadmap = api['roadmap:get']({ projectId: p.id });
  assert.deepEqual(roadmap.scope, { stage: stage2 });
  assert.equal(roadmap.stages[0].items[0].status, 'planned');
  assert.equal(roadmap.stages[2].items[0].status, 'planned');

  const runId2 = api['runs:active']()[0].runId;
  await until(() => gates.has(runId2));
  api['approval:resolve']({ runId: runId2, id: gates.get(runId2), answer: true });
  await until(() => finished.has(runId2));

  await until(() => api['roadmap:get']({ projectId: p.id }).state === 'paused');
  roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.scope, null);
  assert.equal(roadmap.pausedBy, null);
  assert.match(roadmap.error, /Stage two done/);
  assert.equal(roadmap.stages[0].items[0].status, 'planned'); // stage 1: still planned
  assert.equal(roadmap.stages[1].items[0].status, 'done');
  assert.equal(roadmap.stages[2].items[0].status, 'planned'); // stage 3: still planned
  assert.ok(notified.some((n) => n.title === 'Roadmap stage done'), 'notified the stage-only pause, not a failure');
  assert.ok(!notified.some((n) => n.title === 'Roadmap paused'));

  // Start (no stage) afterwards runs the whole roadmap, from its first unfinished stage
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().length === 1);
  assert.deepEqual(api['runs:active']()[0].issues.map((i) => i.number), [1]);
  const runId1 = api['runs:active']()[0].runId;
  await until(() => gates.has(runId1));
  api['approval:resolve']({ runId: runId1, id: gates.get(runId1), answer: true });
});

test('roadmap: a restart continues where it was, from a stage already finished on disk', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'roadmap-restart');

  roadmapModel.saveStages(ws.backlog, p.id, [
    { items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] },
    { items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
  ], { issues: [roadmapIssue(1), roadmapIssue(2)] });
  roadmapModel.setState(ws.backlog, p.id, 'running', { simulated: true });
  const item1 = roadmapModel.readRoadmap(ws.backlog, p.id).stages[0].items[0];
  roadmapModel.markStarted(ws.backlog, p.id, item1.id, { runId: 'run-old' });
  const runDir = path.join(ws.runs, 'run-old');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    run_id: 'run-old', workflow: 'fixture-issue', project_id: p.id, status: 'success', mock: true,
    started_at: '2026-09-30T00:00:00Z', finished_at: '2026-09-30T00:05:00Z',
    issues: [{ number: 1, url: roadmapIssue(1).url, title: roadmapIssue(1).title }], inputs: {}, sessions: [],
  }));

  const service2 = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  service2.setWorkspace(ws);
  // status is derived from the runs when read (withStatus, #112), not stored: read it the way the
  // UI does (roadmap:get), never raw off roadmapModel.readRoadmap
  await until(() => api['roadmap:get']({ projectId: p.id }).stages[1].items[0].status === 'running');
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages[0].items[0].status, 'done');
  assert.equal(roadmap.stages[1].items[0].status, 'running');

  // whichever of the two live services (the original, still open, or this fresh one) reacted first
  // to the roadmap now on disk owns the resulting live run: stop it on both to leave nothing behind,
  // then close service2 here (it shares the index with `service`'s workspace) before makeService's
  // own teardown (registered earlier) removes the workspace folder.
  for (const s of [service, service2]) for (const run of s.api['runs:active']()) { try { s.api['run:stop']({ runId: run.runId }); } catch { /* already ended */ } }
  await until(() => service.api['runs:active']().length === 0 && service2.api['runs:active']().length === 0);
  service2.shutdown();
});

test('roadmap: a Product Owner proposal is added as planned and does not start by itself', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1], 'roadmap-propose');

  const data = await api['roadmap:propose']({ projectId: p.id, proposal: { stages: [{ name: 'From the PO', items: [{ workflow: 'fixture-issue.yaml', number: 1 }] }] } });
  assert.deepEqual(data.dropped, []);
  assert.equal(data.roadmap.state, 'planned');
  assert.equal(data.roadmap.stages[0].items[0].status, 'planned');
  assert.equal(service.isRunning(), false);
  assert.deepEqual(api['runs:list']().runs, []);
});

test('roadmap: assigning a planned issue elsewhere removes it from the roadmap', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'roadmap-conflict');

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1 }, { workflow: 'fixture-issue.yaml', number: 2 }] }] });
  await api['backlog:assign']({ projectId: p.id, numbers: [1], workflow: 'fixture-issue.yaml', mock: true });
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.deepEqual(roadmap.stages[0].items.map((i) => i.number), [2]);
});

test('roadmap: backlog:get issues carry their roadmap stage and status', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1, 2], 'roadmap-badge');

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1 }] }, { items: [{ workflow: 'fixture-issue.yaml', number: 2 }] }] });
  const data = api['backlog:get']({ projectId: p.id });
  const by = Object.fromEntries(data.issues.map((i) => [i.number, i]));
  assert.deepEqual([by[1].roadmap.stage, by[1].roadmap.status], [1, 'planned']);
  assert.deepEqual([by[2].roadmap.stage, by[2].roadmap.status], [2, 'planned']);
});

test('roadmap: reordering stages on save persists the new order', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1, 2, 3], 'roadmap-reorder');

  const saved = await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { items: [{ workflow: 'fixture-issue.yaml', number: 1 }] },
      { items: [{ workflow: 'fixture-issue.yaml', number: 2 }] },
      { items: [{ workflow: 'fixture-issue.yaml', number: 3 }] },
    ],
  });
  const [s1, s2, s3] = saved.roadmap.stages;
  const reordered = await api['roadmap:save']({
    projectId: p.id,
    stages: [{ id: s3.id, items: s3.items }, { id: s1.id, items: s1.items }, { id: s2.id, items: s2.items }],
  });
  assert.deepEqual(reordered.roadmap.stages.map((s) => s.items[0].number), [3, 1, 2]);
  assert.deepEqual(api['roadmap:get']({ projectId: p.id }).stages.map((s) => s.items[0].number), [3, 1, 2]);
});
