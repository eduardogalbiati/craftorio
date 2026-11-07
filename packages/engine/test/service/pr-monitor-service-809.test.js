// #809 a live run waiting in the PR monitor (the engine's `prMonitor`, run/transitions.js pollPrMonitor): the
// service (packages/engine/service/areas/runs.js slotProblem, areas/roadmap.js) leaves it out of the concurrent
// run limit (it may wait days for a person's merge), and its roadmap item waits for that merge (#797).
// Acceptance tests, written before the code.
//
// Seams (as roadmap-stack-hold-807.test.js): the areas built on one small ctx, as the service merges them
// (runs.js gives `active` and slotProblem, roadmap.js gateRun and parkedRun); the live run is a fake entry of
// ctx.active carrying `prMonitor: 'pr_monitor'` while it waits in the monitor (null otherwise), no pending gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const roadmaps = require('../../domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject } = require('./helpers');

const RUN = '20261107-094500-prmonitor809';
const PR_URL = 'https://github.com/o/r/pull/9';
const ISSUES = [roadmapIssue(1), roadmapIssue(2)];

function writeLiveRun(ws, projectId) {
  const dir = path.join(ws.runs, RUN);
  fs.mkdirSync(dir, { recursive: true });
  const ts = '2026-11-07T09:45:00.000Z';
  const lines = [
    { ts, run_id: RUN, type: 'workflow.started', workflow: 'fixture-issue', file: 'fixture-issue.yaml', project_id: projectId, inputs: { mode: 'remote' }, mock: false, run_dir: dir },
    { ts, run_id: RUN, type: 'step.finished', step_id: 'develop', output: { branch: 'feat/1-x' } },
    { ts, run_id: RUN, type: 'step.finished', step_id: 'ci', output: { pr_url: PR_URL, pr_number: 9, ci_status: 'success' } },
    { ts, run_id: RUN, type: 'step.started', step_id: 'pr_monitor' },
  ];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${lines.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

// a roadmap whose first item has the live run RUN; the areas on one ctx; `live(prMonitor)` puts the run in ctx.active
async function setup(t, max = 1) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  api['settings:set']({ concurrentRuns: { enabled: true, max, perProject: null, countSimulations: true } });
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'pr-monitor-809');
  roadmaps.saveStages(ws.backlog, p.id, [
    { items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: false, inputs: { mode: 'remote' } }] },
    { items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: false, inputs: { mode: 'remote' } }] },
  ], { issues: ISSUES });
  const itemId = roadmaps.readRoadmap(ws.backlog, p.id).stages[0].items[0].id;
  roadmaps.markStarted(ws.backlog, p.id, itemId, { runId: RUN });
  writeLiveRun(ws, p.id);
  const ctx = {
    ws,
    events: new EventEmitter(),
    withPrState: (pr) => ({ ...pr, state: 'open', checkedAt: '2026-11-07T09:50:00.000Z' }),
    refreshPr: async (pr) => ({ ...pr, state: 'open' }),
  };
  Object.assign(ctx, require('../../service/areas/runs')(ctx));
  Object.assign(ctx, require('../../service/areas/roadmap')(ctx));
  const live = (prMonitor) => ctx.active.set(RUN, {
    runId: RUN, projectId: p.id, mock: false, status: 'running', approvals: new Map(), prMonitor, stackHold: null,
    pendingGates: () => [], displayNames: () => ({ steps: {} }), stop: () => {},
  });
  const first = () => roadmaps.withStatus(roadmaps.readRoadmap(ws.backlog, p.id), (runId) => ctx.gateRun(runId)).stages[0].items[0];
  return { ctx, projectId: p.id, live, first };
}

test('#809 run limit: a run waiting in the PR monitor does not count, another run can start', async (t) => {
  const s = await setup(t, 1);
  s.live('pr_monitor');
  assert.equal(s.ctx.slotProblem({ mock: false, projectId: s.projectId }), '');
});

test('#809 run limit: the same run outside the monitor (at work) still holds its slot', async (t) => {
  const s = await setup(t, 1);
  s.live(null);
  assert.match(s.ctx.slotProblem({ mock: false, projectId: s.projectId }), /1 of 1 runs in progress/);
});

test('#809 roadmap: the item of a run waiting in the PR monitor waits for its merge, with its PR', async (t) => {
  const s = await setup(t, 2);
  s.live('pr_monitor');
  const item = s.first();
  assert.deepEqual([item.status, item.pr?.number, item.pr?.url], ['waiting_merge', 9, PR_URL]);
});
