// #807 a live stacked run that follows its parent's PR (the engine's `stackHold`, run/transitions.js
// holdForStackParent) waits for its own PR's merge: the service area (packages/engine/service/areas/roadmap.js)
// reads it as at the merge gate (gateRun → the item waiting_merge with its PR, the notice and Stack), and its
// run holds no slot (parkedRun). Without stackHold it is an ordinary running run again.
//
// Seams: the area built from a small ctx (the service's workspace, its active runs, the PR state reader),
// gateRun / parkedRun; the roadmap's statuses through roadmaps.withStatus and RoadmapModel.mergeWait.
// The live run is a fake entry of ctx.active (as base-health-wiring-405.test.js); its index row comes from a
// run folder on disk whose pr_open step gave PR #9 (no workflow.finished: it is still running).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');
const RoadmapModel = require('@craftorio/shared/roadmap-model');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject } = require('./helpers');

const loadArea = () => require('../../service/areas/roadmap');
const RUN = '20261107-090000-stack807hold';
const PR_URL = 'https://github.com/o/r/pull/9';
const ISSUES = [roadmapIssue(1), roadmapIssue(2)];

function writeLiveRun(ws, projectId) {
  const dir = path.join(ws.runs, RUN);
  fs.mkdirSync(dir, { recursive: true });
  const ts = '2026-11-07T09:00:00.000Z';
  const inputs = { mode: 'remote', parent_branch: 'feat/1-parent', parent_pr: 'https://github.com/o/r/pull/7' };
  const lines = [
    { ts, run_id: RUN, type: 'workflow.started', workflow: 'fixture-issue', file: 'fixture-issue.yaml', project_id: projectId, inputs, mock: false, run_dir: dir },
    { ts, run_id: RUN, type: 'step.finished', step_id: 'develop', output: { branch: 'feat/2-stacked' } },
    { ts, run_id: RUN, type: 'step.finished', step_id: 'pr_open', output: { pr_url: PR_URL, pr_number: 9 } },
    { ts, run_id: RUN, type: 'step.started', step_id: 'ci' },
  ];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${lines.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

// a roadmap whose first stage's item has the live run RUN, the second stage planned
async function setup(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'stack-hold-807');
  roadmaps.saveStages(ws.backlog, p.id, [
    { items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: false, inputs: { mode: 'remote' } }] },
    { items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: false, inputs: { mode: 'remote' } }] },
  ], { issues: ISSUES });
  const itemId = roadmaps.readRoadmap(ws.backlog, p.id).stages[0].items[0].id;
  roadmaps.markStarted(ws.backlog, p.id, itemId, { runId: RUN });
  writeLiveRun(ws, p.id);
  const ctx = {
    ws,
    active: new Map(),
    withPrState: (pr) => ({ ...pr, state: 'open', checkedAt: '2026-11-07T09:05:00.000Z' }),
    refreshPr: async (pr) => ({ ...pr, state: 'open' }),
  };
  const area = loadArea()(ctx);
  const live = (stackHold) => ctx.active.set(RUN, { runId: RUN, projectId: p.id, status: 'running', approvals: new Map(), stackHold, pendingGates: () => [], displayNames: () => ({ steps: {} }) });
  const first = () => roadmaps.withStatus(roadmaps.readRoadmap(ws.backlog, p.id), (runId) => area.gateRun(runId)).stages[0].items[0];
  const notice = () => RoadmapModel.mergeWait(roadmaps.withStatus(roadmaps.readRoadmap(ws.backlog, p.id), (runId) => area.gateRun(runId)), 0);
  return { ws, projectId: p.id, itemId, area, live, first, notice };
}

test('#807 a live stacked run holding for its parent (stackHold) waits for its own merge: the item is waiting_merge with its PR', async (t) => {
  const s = await setup(t);
  s.live('ci');
  const item = s.first();
  assert.deepEqual([item.status, item.pr?.number, item.pr?.url], ['waiting_merge', 9, PR_URL]);
});

test('#807 a live stacked run holding for its parent: its stage gets the merge-wait notice and Stack is offered', async (t) => {
  const s = await setup(t);
  s.live('ci');
  const w = s.notice();
  assert.equal(w === null, false, 'the stage has a notice');
  assert.deepEqual([w.itemId, w.pr.number, w.stack.allowed], [s.itemId, 9, true]);
});

test('#807 the same live run without stackHold (it works again) is running, not waiting for its merge', async (t) => {
  const s = await setup(t);
  s.live(null);
  assert.deepEqual([s.first().status, s.notice() === null], ['running', true]);
});

test('#807 parkedRun: a live run with stackHold holds no run slot; without it, it holds one', async (t) => {
  const s = await setup(t);
  s.live('ci');
  assert.equal(s.area.parkedRun(RUN, s.projectId), true);
  s.live(null);
  assert.equal(s.area.parkedRun(RUN, s.projectId), false);
});
