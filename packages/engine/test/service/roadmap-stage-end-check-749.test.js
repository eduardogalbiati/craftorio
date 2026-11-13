// #749 the roadmap's dispatch asks for the base check once per stage that ends (ctx.afterStageEnded),
// also when the stage's last item was skipped between two dispatches (skipItem / skipClosed), and
// never for a simulated roadmap.
// Seam: the roadmap service area (packages/engine/service/areas/roadmap.js) built from a small ctx, its
// dispatchRoadmaps; ctx.afterStageEnded is the boundary to the base-health area, recorded here. The live
// run of the first stage is a fake entry of ctx.active (as roadmap-stack-hold-807.test.js); nothing of the
// next stage starts (ctx.slotProblem says the slots are busy).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapProject } = require('./helpers');

const loadArea = () => require('../../service/areas/roadmap');
const RUN = '20261113-090000-stage749';

const item = (id, extra) => ({ id, workflow: 'fixture-issue.yaml', inputs: { task: `task ${id}`, mode: 'local' }, status: 'planned', mock: false, ...extra });

async function setup(t, { simulated = false } = {}) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'stage-end-749');
  roadmaps.writeRoadmap(ws.backlog, p.id, {
    state: 'running', simulated, error: null, pausedBy: null, scope: null,
    stages: [
      { id: 's1', name: 'Stage one', note: '', items: [item('i1', { status: 'running', runId: RUN, mock: simulated })] },
      { id: 's2', name: 'Stage two', note: '', items: [item('i2', { mock: simulated })] },
    ],
  });
  const ended = [];
  const ctx = {
    ws,
    active: new Map(),
    slotProblem: () => 'every slot is busy',
    memoryHold: async () => false,
    refillRoadmap: () => {},
    roadmapRelease: async () => false,
    appUpdateEvent: () => false,
    budgetBlock: () => null,
    notify: () => {},
    events: { emit: () => {} },
    withPrState: (pr) => ({ ...pr, state: 'open' }),
    refreshPr: async (pr) => ({ ...pr, state: 'open' }),
    afterStageEnded: (projectId, opts) => { ended.push({ projectId, opts: opts ?? null }); return null; },
  };
  ctx.active.set(RUN, { runId: RUN, projectId: p.id, status: 'running', approvals: new Map(), pendingGates: () => [], displayNames: () => ({ steps: {} }) });
  const area = loadArea()(ctx);
  // the stage's last item is skipped and its run is gone, between two dispatches
  const skipFirst = () => {
    roadmaps.skipItem(ws.backlog, p.id, 'i1', 'skipped by the owner');
    ctx.active.delete(RUN);
  };
  return { projectId: p.id, area, ended, skipFirst };
}

test('#749 a stage whose last item is skipped between two dispatches asks for one base check', async (t) => {
  const s = await setup(t);
  await s.area.dispatchRoadmaps({ readPrs: false });
  assert.equal(s.ended.length, 0, 'the stage still runs: no check');
  s.skipFirst();
  await s.area.dispatchRoadmaps({ readPrs: false });
  assert.deepEqual(s.ended.map((x) => x.projectId), [s.projectId], 'the stage ended: one check for its project');
  await s.area.dispatchRoadmaps({ readPrs: false });
  assert.equal(s.ended.length, 1, 'a later dispatch asks for no second check of the same stage');
});

test('#749 a simulated roadmap\'s stage end asks for no base check', async (t) => {
  const s = await setup(t, { simulated: true });
  await s.area.dispatchRoadmaps({ readPrs: false });
  s.skipFirst();
  await s.area.dispatchRoadmaps({ readPrs: false });
  assert.equal(s.ended.length, 0);
});
