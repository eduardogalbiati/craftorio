// #702 Start Test on the Roadmap (packages/engine/service/areas/roadmap.js startTest): a built work item
// (docs/work/<item>/plan.md, Progress N of N) starts sdlc-test.yaml on its item, with the issues the Test
// run checks: the roadmap item's own, else the `#n` of the plan's Progress rows; a plan not built is
// refused and nothing starts.
//
// Seams: the area built from a small ctx (the service's workspace, a stub startWorkflowRun at the run
// boundary, runAlive), as roadmap-stack-hold-807.test.js; the project's folder is a temp dir (#695).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject } = require('./helpers');

const loadArea = () => require('../../service/areas/roadmap');

const plan = (statuses) => `---
item: demo
stage: plan
status: accepted
date: 2026-11-01
---
# Plan: demo

## Progress

| Step | Status | Run | Commit / PR |
|---|---|---|---|
${statuses.map((s, i) => `| ${i + 1}. Step ${i + 1} (#${41 + i}) | ${s} | ${s === 'done' ? `run-${i}` : '—'} | ${s === 'done' ? 'abc1234' : '—'} |`).join('\n')}
`;

// a roadmap whose one item names the work item `demo`; `own: false` drops the item's own issue
async function setup(t, statuses, { own = true } = {}) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'start-test-702');
  const folder = p.folder;
  fs.mkdirSync(path.join(folder, 'docs', 'work', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'docs', 'work', 'demo', 'plan.md'), plan(statuses));
  roadmaps.saveStages(ws.backlog, p.id, [
    { items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true, inputs: { item: 'demo' } }] },
  ], { issues: [roadmapIssue(1)] });
  const itemId = roadmaps.readRoadmap(ws.backlog, p.id).stages[0].items[0].id;
  if (!own) {
    roadmaps.updateRoadmap(ws.backlog, p.id, (r) => {
      const it = roadmaps.findItem(r, itemId);
      delete it.url; delete it.issues; delete it.number;
      return r;
    });
  }
  const calls = [];
  const area = loadArea()({
    ws,
    active: new Map(),
    runAlive: () => false,
    startWorkflowRun: async (o) => { calls.push(JSON.parse(JSON.stringify(o))); return { runId: 'run-test-1' }; },
  });
  const item = () => roadmaps.findItem(roadmaps.readRoadmap(ws.backlog, p.id), itemId);
  return { projectId: p.id, itemId, folder, area, calls, item };
}

test('#702 Start Test on a built item starts sdlc-test on its work item and keeps the run on the item', async (t) => {
  const s = await setup(t, ['done', 'done']);
  const out = await s.area.startTest(s.projectId, s.itemId);
  const call = s.calls[0] || {};
  assert.deepEqual([s.calls.length, call.file, call.inputs?.item, call.inputs?.project_path, out.runId, s.item().testRunId],
    [1, 'sdlc-test.yaml', 'demo', s.folder, 'run-test-1', 'run-test-1']);
});

test('#702 Start Test passes the roadmap item\'s own issues to the Test run', async (t) => {
  const s = await setup(t, ['done', 'done']);
  await s.area.startTest(s.projectId, s.itemId);
  const issues = (s.calls[0]?.inputs?.issues || []).map(String);
  assert.deepEqual([issues.length > 0, issues.some((i) => /issues\/1$|^1$/.test(i)), issues.some((i) => /41|42/.test(i))], [true, true, false]);
});

test('#702 Start Test on an item with no issue of its own passes the #n of the plan\'s Progress rows', async (t) => {
  const s = await setup(t, ['done', 'done'], { own: false });
  await s.area.startTest(s.projectId, s.itemId);
  assert.deepEqual((s.calls[0]?.inputs?.issues || []).map(String), ['#41', '#42']);
});

test('#702 Start Test on a plan not built (N-1 of N) is refused and starts nothing', async (t) => {
  const s = await setup(t, ['done', 'pending']);
  await assert.rejects(() => s.area.startTest(s.projectId, s.itemId), /built/);
  assert.deepEqual([s.calls.length, s.item().testRunId ?? null], [0, null]);
});
