// Acceptance tests for #605 / #446 (written before the code): the Backlog's plain queue is retired.
// - backlog:assign plans its issues in the roadmap: a NEW stage at the end holding the assignment
//   (same workflow, inputs, then, agent overrides; a group stays one item), and nothing is queued
//   (no backlog/<project>.queue.json). Without "Run now" nothing starts; with it (`runNow: true`, the
//   flag name refactor:addToRoadmap already uses) that new stage starts on its own, as #141's "Run this
//   stage" does (roadmap:start with `stage`: the roadmap's scope is { stage: <its id> }).
// - The queue channels backlog:unqueue, backlog:pause and roadmap:from-queue are gone from the service
//   and are not in the control channel's allowlist (packages/engine/control/allowlist.js).
// Seams: the service harness (./helpers makeService, roadmapProject), roadmap:get, runs:active.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ISSUE_WORKFLOW, makeService, roadmapProject, until } = require('./helpers');

const queueFile = (ws, projectId) => path.join(ws.backlog, `${projectId}.queue.json`);
const issueNumbers = (item) => (item.issues || [item]).map((i) => i.number);

test('#446 backlog:assign plans the issues as one item in a new stage at the end (workflow, inputs, then, agent overrides, group kept); nothing is queued and nothing starts', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2, 3], 'assign-plans-446');
  await api['roadmap:save']({ projectId: p.id, stages: [{ name: 'Already planned', items: [{ workflow: 'fixture-issue.yaml', number: 3, mock: true }] }] });

  await api['backlog:assign']({
    projectId: p.id, numbers: [2, 1], workflow: 'fixture-issue.yaml', inputs: { language: 'go' }, mock: true, group: true,
    then: { action: 'workflow', workflow: 'fixture-issue.yaml' },
    agentOverrides: { a: { model: 'm2' } },
  });

  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages.length, 2, 'a new stage was added');
  assert.deepEqual(issueNumbers(roadmap.stages[0].items[0]), [3], 'the stage already planned stays first');
  const added = roadmap.stages[1];
  assert.equal(added.items.length, 1, 'the group is one item');
  const item = added.items[0];
  assert.deepEqual(issueNumbers(item), [2, 1], 'in the order selected');
  assert.equal(item.workflow, 'fixture-issue.yaml');
  assert.deepEqual(item.inputs, { language: 'go' });
  assert.equal(item.mock, true);
  assert.equal(item.then?.action, 'workflow');
  assert.equal(item.then?.workflow, 'fixture-issue.yaml');
  assert.deepEqual(item.agentOverrides, { a: { model: 'm2' } });
  assert.equal(item.status, 'planned');
  assert.equal(roadmap.state, 'planned', 'without Run now nothing starts');
  assert.equal(api['runs:active']().length, 0);
  assert.equal(fs.existsSync(queueFile(ws, p.id)), false, 'no queue file is written');
});

test('#446 backlog:assign of single issues adds every issue to one new stage at the end, never to the queue', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'assign-single-446');

  await api['backlog:assign']({ projectId: p.id, numbers: [1, 2], workflow: 'fixture-issue.yaml', mock: true });

  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages.length, 1);
  assert.deepEqual(roadmap.stages[0].items.flatMap(issueNumbers).sort(), [1, 2]);
  assert.equal(api['runs:active']().length, 0, 'planned only: nothing started');
  assert.equal(fs.existsSync(queueFile(ws, p.id)), false);
});

test('#446 backlog:assign with Run now starts only the new stage, on its own (#141 Run this stage)', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 3], 'assign-run-now-446');
  await api['roadmap:save']({ projectId: p.id, stages: [{ name: 'Already planned', items: [{ workflow: 'fixture-issue.yaml', number: 3, mock: true }] }] });

  await api['backlog:assign']({ projectId: p.id, numbers: [1], workflow: 'fixture-issue.yaml', mock: true, runNow: true });

  await until(() => api['runs:active']().length === 1);
  assert.deepEqual(api['runs:active']()[0].issues.map((i) => i.number), [1]);
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages.length, 2);
  assert.deepEqual(roadmap.scope, { stage: roadmap.stages[1].id }, 'the new stage runs on its own');
  assert.equal(roadmap.stages[0].items[0].status, 'planned', 'the stage before it does not start');
  assert.equal(fs.existsSync(queueFile(ws, p.id)), false);
});

test('#446 the queue channels (backlog:unqueue, backlog:pause, roadmap:from-queue) are gone from the service and the control allowlist', (t) => {
  const { service, api } = makeService(t);
  const gone = ['backlog:unqueue', 'backlog:pause', 'roadmap:from-queue'];
  const manifest = new Set(service.manifest.map((e) => e.channel).filter(Boolean));
  assert.deepEqual(gone.filter((c) => manifest.has(c)), [], 'not in the service manifest');
  assert.deepEqual(gone.filter((c) => typeof api[c] === 'function'), [], 'not callable on the api');
  const { CHANNELS } = require('../../control/allowlist');
  assert.deepEqual(gone.filter((c) => CHANNELS.has(c)), [], 'not in the control channel allowlist');
});
