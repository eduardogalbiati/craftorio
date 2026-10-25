// Keep awake (#162): service.pendingWork (packages/engine/service/areas/keep-awake.js) collects the runs,
// roadmaps and queued items src/host/keep-awake.js's workToDo turns into "work to keep the computer
// awake for". createService is used directly (not makeService) for the "no workspace" case, since
// makeService always opens one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createService } = require('@multiagent/engine/service');
const { ISSUE_WORKFLOW, makeService, roadmapProject, until, watchRuns } = require('@multiagent/engine/test/service/helpers');

test('pendingWork: no workspace open returns no runs, roadmaps or queued items', () => {
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  assert.deepEqual(service.pendingWork(), { runs: [], roadmaps: [], queued: 0 });
});

test('pendingWork: a run in progress is reported running, then waiting once it reaches a gate', async (t) => {
  const { service, api } = makeService(t);
  const { gates, finished } = watchRuns(service);
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  // right after it started, the "work" step is running and the gate has not been reached yet
  assert.deepEqual(service.pendingWork().runs, [{ runId, waiting: false }]);

  await until(() => gates.size === 1);
  assert.deepEqual(service.pendingWork().runs, [{ runId, waiting: true }]);

  api['approval:resolve']({ runId, id: gates.get(runId), answer: true });
  await until(() => finished.size === 1);
  assert.deepEqual(service.pendingWork().runs, []);
});

test('pendingWork: a roadmap file maps to its state, current stage (1-based) and stage count', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'roadmap-pending-work');

  await api['roadmap:save']({
    projectId: p.id,
    stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }, { items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] }],
  });
  assert.deepEqual(service.pendingWork().roadmaps, [{ projectId: p.id, state: 'planned', stage: 1, of: 2 }]);

  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => api['runs:active']().length === 1);
  assert.deepEqual(service.pendingWork().roadmaps, [{ projectId: p.id, state: 'running', stage: 1, of: 2 }]);
});

test('pendingWork: queued items are summed only across the queues that are not paused', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(require('os').tmpdir(), 'service-keep-awake-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  const issue = (number) => ({ number, title: `Issue ${number}`, state: 'open', url: `https://github.com/o/r/issues/${number}`, body: 'Do it', labels: [], assignees: [], tasks: { done: 0, total: 0 } });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [issue(1), issue(2), issue(3)] }));

  await api['backlog:assign']({ projectId: p.id, numbers: [1, 2, 3], workflow: 'fixture-issue.yaml', mock: true });
  const queuedBefore = api['backlog:get']({ projectId: p.id }).queue.items.length;
  assert.ok(queuedBefore > 0, 'two issues wait behind the one that started');
  assert.equal(service.pendingWork().queued, queuedBefore);

  await api['backlog:pause']({ projectId: p.id, paused: true });
  assert.equal(service.pendingWork().queued, 0, 'a paused queue is not counted');
});
