// Live roadmap (#164): end-to-end through the service, from a live roadmap's last stage ending to
// the refill it asks the Product Owner for (packages/engine/service/areas/live-roadmap.js), dispatched from
// packages/engine/service/areas/roadmap.js advanceRoadmap. The refill itself (candidates, grouping, budget) is
// unit-tested in test/live-roadmap.test.js and test/roadmap.test.js; this file only checks the wiring:
// a live roadmap really keeps going, really stops when there is nothing left or the budget is
// reached, and notifies each outcome.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const roadmapModel = require('../../domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject, until, watchRuns } = require('./helpers');

// roadmapIssue's body ("Do it") is under 120 chars, which the simulated Product Owner (mockAnswer)
// would flag to enrich first: candidates meant to be picked need a longer description instead.
const pickable = (number, complexity) => ({ ...roadmapIssue(number), body: 'x'.repeat(130), labels: [{ name: `complexity:${complexity}` }] });

test('live roadmap: the Product Owner refills it when its only stage ends, adding the next candidate as a new planned stage, notified as "refilled"', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'live-added');
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({
    projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [roadmapIssue(1), pickable(2, 1)],
  }));
  const { gates } = watchRuns(service);
  const notified = [];
  service.events.on('notify', (n) => notified.push(n));

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await api['roadmap:live']({ projectId: p.id, on: true });
  assert.equal(api['roadmap:get']({ projectId: p.id }).live, true);

  await until(() => api['runs:active']().length === 1);
  const runId1 = api['runs:active']()[0].runId;
  await until(() => gates.has(runId1));
  api['approval:resolve']({ runId: runId1, id: gates.get(runId1), answer: true });

  await until(() => api['roadmap:get']({ projectId: p.id }).stages.length === 2);
  let roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.live, true);
  assert.equal(roadmap.stages[0].items[0].status, 'done');
  assert.deepEqual(roadmap.stages[1].items[0].issues.map((i) => i.number), [2]); // only #2 was a candidate
  assert.match(roadmap.stages[1].note, /^Added by the live roadmap at \d\d:\d\d, Product Owner answer US\$ 0\.00\./);
  assert.equal(roadmap.liveRefill.status, 'added');
  assert.equal(roadmap.liveRefill.added, 1);

  assert.ok(notified.some((n) => n.kind === 'run' && n.event === 'refilled' && n.title === 'Live roadmap: +1 stage: demo'), 'notified the refill');
  // the new stage's item is free to start right away (same dispatch); the suite's teardown stops
  // any run still active, so it is not awaited here.
});

test('live roadmap: nothing left to pick ends it "done" with live still on, instead of asking the Product Owner anything', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'live-empty'); // issue #1 only: no other candidate
  const { gates } = watchRuns(service);
  const notified = [];
  service.events.on('notify', (n) => notified.push(n));

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await api['roadmap:live']({ projectId: p.id, on: true });

  await until(() => api['runs:active']().length === 1);
  const runId = api['runs:active']()[0].runId;
  await until(() => gates.has(runId));
  api['approval:resolve']({ runId: runId, id: gates.get(runId), answer: true });

  await until(() => api['roadmap:get']({ projectId: p.id }).state === 'done');
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.live, true); // live stays on: the next sync (or Start) tries again
  assert.equal(roadmap.stages.length, 1); // no stage was added
  assert.equal(roadmap.liveRefill.status, 'empty');
  assert.match(roadmap.liveRefill.message, /nothing left under complexity 2/);
  assert.ok(notified.some((n) => n.event === 'empty' && n.title === 'Live roadmap: nothing left to pick: demo'));
});

test('live roadmap: the daily budget already reached stops the refill (status "budget"), ending the roadmap done without asking the Product Owner', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'live-budget');
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({
    projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [roadmapIssue(1), pickable(2, 1)],
  }));
  const { gates } = watchRuns(service);
  const notified = [];
  service.events.on('notify', (n) => notified.push(n));

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await api['roadmap:live']({ projectId: p.id, on: true });
  api['settings:set']({ liveRoadmap: { complexityCap: 2, maxStages: 3, dailyBudgetUsd: 10, refreshFirst: false } });
  // already spent more than the cap in the last 24h (a previous refill's cost): the next refill is blocked
  roadmapModel.updateRoadmap(ws.backlog, p.id, (r) => ({ ...r, liveRefills: [{ at: new Date().toISOString(), costUsd: 20 }] }));

  await until(() => api['runs:active']().length === 1);
  const runId = api['runs:active']()[0].runId;
  await until(() => gates.has(runId));
  api['approval:resolve']({ runId: runId, id: gates.get(runId), answer: true });

  await until(() => api['roadmap:get']({ projectId: p.id }).state === 'done');
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.live, true);
  assert.equal(roadmap.stages.length, 1); // #2 was a real candidate, but the budget was checked first: nothing was added
  assert.equal(roadmap.liveRefill.status, 'budget');
  assert.match(roadmap.liveRefill.message, /the daily budget of US\$ 10\.00 is reached/);
  assert.ok(notified.some((n) => n.event === 'budget' && n.title === 'Live roadmap stopped: daily budget reached: demo'));
});

test('live roadmap: turning it off is persisted and survives a restart; a non-live roadmap\'s last stage still just ends "done"', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'live-off');
  const { gates } = watchRuns(service);

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await api['roadmap:live']({ projectId: p.id, on: true });
  await api['roadmap:live']({ projectId: p.id, on: false });
  assert.equal(api['roadmap:get']({ projectId: p.id }).live, false);
  assert.equal(roadmapModel.readRoadmap(ws.backlog, p.id).live, false); // on disk, not only derived

  await until(() => api['runs:active']().length === 1);
  const runId = api['runs:active']()[0].runId;
  await until(() => gates.has(runId));
  api['approval:resolve']({ runId: runId, id: gates.get(runId), answer: true });

  await until(() => api['roadmap:get']({ projectId: p.id }).state === 'done');
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages.length, 1); // no refill was asked for
  assert.equal(roadmap.liveRefill, null);
});

test('live roadmap (#235): the refill plans on the workflow and options last chosen in the Product Owner\'s drawer for the project', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  fs.writeFileSync(path.join(ws.workflows, 'fixture-chosen.yaml'), ISSUE_WORKFLOW.replace('name: fixture-issue', 'name: fixture-chosen'));
  const p = await roadmapProject(api, ws, t, [1], 'live-chosen');
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({
    projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [roadmapIssue(1), pickable(2, 1)],
  }));
  // the owner planned once in the drawer with fixture-chosen.yaml and language "go"
  await api['po:ask']({ projectId: p.id, question: 'Analyze the backlog and propose runs', mock: true, mode: 'plan', attachments: [], issues: [], workflow: 'fixture-chosen.yaml', inputs: { language: 'go' } });
  const { gates } = watchRuns(service);

  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await api['roadmap:live']({ projectId: p.id, on: true });

  await until(() => api['runs:active']().length === 1);
  const runId = api['runs:active']()[0].runId;
  await until(() => gates.has(runId));
  api['approval:resolve']({ runId, id: gates.get(runId), answer: true });

  await until(() => api['roadmap:get']({ projectId: p.id }).stages.length === 2);
  const item = api['roadmap:get']({ projectId: p.id }).stages[1].items[0];
  assert.equal(item.workflow, 'fixture-chosen.yaml');
  assert.equal(item.inputs?.language, 'go');
});
