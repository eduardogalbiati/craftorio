const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const { createService } = require('../../service');
const roadmapModel = require('../../domains/roadmap/roadmap');
const backlog = require('../../domains/backlog/backlog');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject, until, watchRuns } = require('./helpers');
const path = require('path');

// A real-capable fixture (no agent steps, so `mock: false` never calls a model): used to prove the
// roadmap reads the platform right before a real start (#168) without any cost or CLI dependency.
const REAL_ROADMAP_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-real-roadmap
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, required: true }
  issue: { type: string, default: "" }
agents: {}
steps:
  - id: review
    type: human_approval
    message: "Accept?"
`;

// A project with a repository and a non-empty folder (preflight needs one for a real run), and a
// synced backlog cache of `issues` (full shape, so a stale/closed cache can differ from the fresh read).
function realRoadmapProject(api, ws, t, issues, name) {
  return (async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), `service-${name}-`));
    fs.writeFileSync(path.join(folder, 'README.md'), 'x');
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const p = await api['projects:create']({ name: 'demo', folder });
    api['projects:update']({ id: p.id, patch: { repo: 'https://github.com/o/r' } });
    fs.mkdirSync(ws.backlog, { recursive: true });
    fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues }));
    return p;
  })();
}
const cachedIssue = (number, state, title, body) => ({ number, title, state, url: `https://github.com/o/r/issues/${number}`, body, labels: [], assignees: [], tasks: { done: 0, total: 0 }, updatedAt: '2026-09-01T00:00:00Z' });

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
  assert.deepEqual((await api['runs:list']()).runs, []);
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

// ---- #194: roadmapView attaches each running item's progress (the card's ring); never stored -----

test('roadmap: backlog:get attaches a running item\'s run (its trail, groups and typical step times), but the roadmap file on disk never keeps it', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'roadmap-ring');
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().length === 1);
  const runId = api['runs:active']()[0].runId;
  await until(() => !!api['backlog:get']({ projectId: p.id }).roadmap.stages[0].items[0].run);

  const item = api['backlog:get']({ projectId: p.id }).roadmap.stages[0].items[0];
  assert.equal(item.runId, runId);
  assert.ok(item.run, 'a running item carries its run\'s progress for the card\'s ring');
  assert.equal(item.run.status, 'running');
  assert.ok(Array.isArray(item.run.progress));
  assert.ok(Array.isArray(item.run.groups));
  assert.equal(typeof item.run.stepTimes, 'object');
  assert.equal(item.run.history, 0); // no past successful run of this workflow yet

  // the view attaches `run`; the file on disk (what saveStages/markStarted write) never keeps it
  const onDisk = roadmapModel.readRoadmap(ws.backlog, p.id);
  assert.equal('run' in onDisk.stages[0].items[0], false);

  api['run:stop']({ runId });
});

test('roadmap: backlog:get attaches no run for a planned item with no runId yet', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'roadmap-no-run');
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });

  const item = api['backlog:get']({ projectId: p.id }).roadmap.stages[0].items[0];
  assert.equal(item.runId, null);
  assert.equal('run' in item, false);
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

// ---- #168: the platform is the source of truth, read again right before a real start -----------

test('roadmap: #168 a real item reads the platform right before it starts; the cache said its issue was closed, but the fresh read is what decides and what the run and the item\'s copy get', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-real-roadmap.yaml'), REAL_ROADMAP_WORKFLOW);
  const p = await realRoadmapProject(api, ws, t, [cachedIssue(1, 'closed', 'Cached title', 'Cached body')], 'fresh-roadmap');
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-real-roadmap.yaml', number: 1, mock: false }] }] });
  t.mock.method(backlog, 'freshIssues', async ({ item }) => ({
    issues: [{ number: item.number, url: item.url, title: 'Fresh title', body: 'Fresh body', labels: [], state: 'open', updatedAt: '2026-10-01T12:00:00Z' }],
    warnings: [],
  }));

  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { process.env.MULTIAGENT_SIMULATION_ONLY = '1'; });
  await api['roadmap:start']({ projectId: p.id, simulated: false });

  const run = api['runs:active']()[0];
  assert.ok(run, 'the cache said closed, but the fresh read said open: it started');
  assert.match(run.inputs.task, /^Fresh title\n\nIssue: https:\/\/github\.com\/o\/r\/issues\/1\n\nFresh body$/);
  assert.deepEqual(run.issues, [{ number: 1, url: 'https://github.com/o/r/issues/1', title: 'Fresh title', updatedAt: '2026-10-01T12:00:00Z' }]);
  const item = api['roadmap:get']({ projectId: p.id }).stages[0].items[0];
  assert.equal(item.title, 'Fresh title'); // the item's read-only copy was brought up to date too
  assert.equal(item.body, 'Fresh body');
});

test('roadmap: #168 an issue found closed on the fresh read is skipped at start, although the cache (and the item) still show it open; the freed slot starts the next item right away', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-real-roadmap.yaml'), REAL_ROADMAP_WORKFLOW);
  const p = await realRoadmapProject(api, ws, t, [cachedIssue(1, 'open', 'Issue 1', 'Body 1'), cachedIssue(2, 'open', 'Issue 2', 'Body 2')], 'closed-roadmap');
  await api['roadmap:save']({
    projectId: p.id,
    stages: [{ items: [{ workflow: 'fixture-real-roadmap.yaml', number: 1, mock: false }, { workflow: 'fixture-real-roadmap.yaml', number: 2, mock: false }] }],
  });
  t.mock.method(backlog, 'freshIssues', async ({ item }) => (item.number === 1
    ? { issues: [{ number: 1, url: item.url, title: item.title, body: item.body, labels: [], state: 'closed', updatedAt: '2026-10-01T00:00:00Z' }], warnings: [] }
    : { issues: [{ number: item.number, url: item.url, title: 'Fresh 2', body: 'Fresh body 2', labels: [], state: 'open', updatedAt: '2026-10-01T00:00:00Z' }], warnings: [] }));

  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { process.env.MULTIAGENT_SIMULATION_ONLY = '1'; });
  await api['roadmap:start']({ projectId: p.id, simulated: false });

  const roadmap = api['roadmap:get']({ projectId: p.id });
  const [item1, item2] = roadmap.stages[0].items;
  assert.equal(item1.status, 'skipped');
  assert.equal(item1.error, 'Every issue is closed.');
  assert.equal(item2.status, 'running'); // the freed slot started it in the same dispatch
  const run = api['runs:active']()[0];
  assert.ok(run);
  assert.deepEqual(run.issues.map((i) => i.number), [2]);
  assert.match(run.inputs.task, /^Fresh 2/);
});

test('roadmap: #168 a simulated roadmap (or a project with no repository) skips a cached-closed issue from the cache alone; the platform is never read', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await realRoadmapProject(api, ws, t, [cachedIssue(1, 'closed', 'Cached title', 'Cached body')], 'simulated-roadmap');
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: false }] }] });
  t.mock.method(backlog, 'freshIssues', async () => { throw new Error('the platform must never be read for a simulated roadmap'); });

  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { process.env.MULTIAGENT_SIMULATION_ONLY = '1'; });
  await api['roadmap:start']({ projectId: p.id, simulated: true });

  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.state, 'done');
  assert.equal(roadmap.stages[0].items[0].status, 'skipped');
  assert.equal(roadmap.stages[0].items[0].error, 'Every issue is closed.');
  assert.deepEqual(api['runs:active'](), []);
});

// ---- #161: a workflow that never merges (metadata.merges: false, e.g. backlog-refresh) ----------

// No agent steps, so `mock: false` never calls a model (same trick as REAL_ROADMAP_WORKFLOW); the
// run succeeds on its own gate without ever merging anything.
const NEVER_MERGES_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-never-merges
  merges: false
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, required: true }
  issue: { type: string, default: "" }
agents: {}
steps:
  - id: review
    type: human_approval
    message: "Accept?"
`;

test('roadmap: #161 a real item of a workflow with metadata.merges: false ends done once its run succeeds, although it never merged', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-never-merges.yaml'), NEVER_MERGES_WORKFLOW);
  const p = await realRoadmapProject(api, ws, t, [cachedIssue(1, 'open', 'Issue 1', 'Body 1')], 'never-merges-roadmap');
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-never-merges.yaml', number: 1, mock: false }] }] });
  const { gates, finished } = watchRuns(service);

  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { process.env.MULTIAGENT_SIMULATION_ONLY = '1'; });
  await api['roadmap:start']({ projectId: p.id, simulated: false });

  const runId = api['runs:active']()[0].runId;
  await until(() => gates.has(runId));
  api['approval:resolve']({ runId, id: gates.get(runId), answer: true });
  await until(() => finished.has(runId));
  await until(() => api['roadmap:get']({ projectId: p.id }).state === 'done');
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages[0].items[0].status, 'done');
  assert.equal(roadmap.stages[0].items[0].error, null);
});

test('roadmap: #161 a real item of an ordinary workflow (no metadata.merges) still fails as "finished without merging"', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-real-roadmap.yaml'), REAL_ROADMAP_WORKFLOW);
  const p = await realRoadmapProject(api, ws, t, [cachedIssue(1, 'open', 'Issue 1', 'Body 1')], 'still-merges-roadmap');
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-real-roadmap.yaml', number: 1, mock: false }] }] });
  const { gates, finished } = watchRuns(service);

  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { process.env.MULTIAGENT_SIMULATION_ONLY = '1'; });
  await api['roadmap:start']({ projectId: p.id, simulated: false });

  const runId = api['runs:active']()[0].runId;
  await until(() => gates.has(runId));
  api['approval:resolve']({ runId, id: gates.get(runId), answer: true });
  await until(() => finished.has(runId));
  await until(() => api['roadmap:get']({ projectId: p.id }).state === 'paused');
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages[0].items[0].status, 'failed');
  assert.match(roadmap.stages[0].items[0].error, /finished without merging/);
});

test('roadmap: #168 a project with no repository skips a cached-closed issue from the cache alone; the platform is never read', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-no-repo-roadmap-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder }); // no repo set
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', issues: [cachedIssue(1, 'closed', 'Cached title', 'Cached body')] }));
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: false }] }] });
  t.mock.method(backlog, 'freshIssues', async () => { throw new Error('the platform must never be read without a project repository'); });

  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { process.env.MULTIAGENT_SIMULATION_ONLY = '1'; });
  await api['roadmap:start']({ projectId: p.id, simulated: false });

  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages[0].items[0].status, 'skipped');
  assert.deepEqual(api['runs:active'](), []);
});
