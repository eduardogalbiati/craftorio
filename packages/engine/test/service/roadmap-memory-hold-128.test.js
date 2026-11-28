// #128 a roadmap start held for low memory is visible. advanceRoadmap (packages/engine/service/areas/roadmap.js)
// broke out on ctx.memoryHold() silently: the item stayed "planned" with no word, and the timer of
// runs.js retried every 30 s. Now the roadmap (or its item) shows why it waits: "Waiting for memory",
// the GB free, the floor and where to change it (Settings › Execution › Memory guard), with ONE
// notification however many retries; once memory recovers the item starts.
//
// Seams: the area built from a small ctx, as roadmap-stack-hold-807.test.js and
// roadmap-stage-end-check-749.test.js; ctx.memoryHold is the boundary to the machine's memory (the runs
// area): it gives '' or the reason, and the reason is the engine's own text, memoryProblem() of
// packages/engine/engine/memory-guard.js, for 0.8 GB free under a 1.6 GB floor; ctx.startWorkflowRun is a
// stub at the run boundary. What the screen shows is read through area.roadmapView (anywhere in it: the
// roadmap's or the item's field is the developer's choice), as plain text.
// Assumption: ctx.memoryHold() keeps returning '' or that reason string.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject } = require('./helpers');

const loadArea = () => require('../../service/areas/roadmap');
const loadGuard = () => require('../../engine/memory-guard');
const GIB = 1024 ** 3;
const LOW = { freeBytes: 0.8 * GIB, floorBytes: 1.6 * GIB };

test('#128 memoryProblem names the wait, the GB free, the floor and where to change it', () => {
  const why = loadGuard().memoryProblem(LOW);
  for (const part of ['Waiting for memory', '0.8 GB free', 'floor of 1.6 GB', 'Settings › Execution › Memory guard']) {
    assert.equal(why.includes(part), true, `"${part}" is not in: ${why}`);
  }
});

// a running real roadmap whose one planned item waits for memory while `low.on`
async function setup(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'memory-hold-128');
  roadmaps.saveStages(ws.backlog, p.id, [
    { items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: false, inputs: { mode: 'local' } }] },
  ], { issues: [roadmapIssue(1)] });
  roadmaps.setState(ws.backlog, p.id, 'running', { simulated: false, stage: null });
  const itemId = roadmaps.readRoadmap(ws.backlog, p.id).stages[0].items[0].id;
  const low = { on: true };
  const notices = [];
  const starts = [];
  const area = loadArea()({
    ws,
    active: new Map(),
    slotProblem: () => '',
    memoryHold: async () => (low.on ? loadGuard().memoryProblem(LOW) : ''),
    budgetBlock: () => null,
    refillRoadmap: () => {},
    roadmapRelease: async () => false,
    appUpdateEvent: () => false,
    localRunTarget: () => null,
    runAlive: () => false,
    projectWorkflowFile: (id, file) => path.join(ws.workflows, file),
    notify: (n) => { notices.push(JSON.stringify(n)); },
    events: { emit: () => {} },
    withPrState: (pr) => ({ ...pr, state: 'open' }),
    refreshPr: async (pr) => ({ ...pr, state: 'open' }),
    startWorkflowRun: async (o) => { starts.push(o.file); return { runId: '20261128-150000-memhold128' }; },
  });
  const dispatch = () => area.dispatchRoadmaps({ readPrs: false });
  const shown = () => JSON.stringify(area.roadmapView(p.id));
  const item = () => roadmaps.findItem(roadmaps.readRoadmap(ws.backlog, p.id), itemId);
  const memoryNotices = () => notices.filter((n) => /memory/i.test(n));
  return { low, starts, dispatch, shown, item, memoryNotices };
}

test('#128 a roadmap start held for memory shows "Waiting for memory" with the GB free, the floor and the Settings hint', async (t) => {
  const s = await setup(t);
  await s.dispatch();
  const view = s.shown();
  for (const part of ['Waiting for memory', '0.8 GB free', 'floor of 1.6 GB', 'Settings › Execution › Memory guard']) {
    assert.equal(view.includes(part), true, `the roadmap view does not show "${part}"`);
  }
  assert.deepEqual([s.starts.length, s.item().runId ?? null], [0, null], 'nothing started');
});

test('#128 a held roadmap start notifies once, not again on each retry', async (t) => {
  const s = await setup(t);
  await s.dispatch();
  await s.dispatch();
  await s.dispatch();
  assert.equal(s.memoryNotices().length, 1, `memory notifications: ${s.memoryNotices().join(' | ')}`);
});

test('#128 once memory recovers the held item starts and the wait is no longer shown', async (t) => {
  const s = await setup(t);
  await s.dispatch();
  s.low.on = false;
  await s.dispatch();
  assert.deepEqual([s.starts, s.item().runId ?? null, s.item().error ?? null], [['fixture-issue.yaml'], '20261128-150000-memhold128', null]);
  assert.equal(s.shown().includes('Waiting for memory'), false, 'the wait is still shown');
});
