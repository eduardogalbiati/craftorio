// Service area: roadmaps (src/roadmap.js). Settles each started roadmap from its runs and starts
// the current stage's items while there are free run slots; called after every run and when a
// workspace opens. Also the roadmap as the Backlog shows it (item statuses from their runs, #112)
// and Start (the whole roadmap, or one stage, #141).

const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const simulation = require('../../engine/simulation');
const workspace = require('../../workspace');
const projects = require('../../projects');
const backlog = require('../../backlog');
const roadmaps = require('../../roadmap');
const runs = require('../../runs');

module.exports = (ctx) => {
  const { host } = ctx;
  // a call while one is going runs again right after it (a run that ends meanwhile is never missed)
  let roadmapBusy = false;
  let roadmapAgain = false;
  // "<projectId>:<itemId>" of the items whose Retry the owner confirmed over a kept worktree's work
  // (#112): their next start goes ahead; kept in memory, so after a restart the start asks again
  const keptWorkAllowed = new Set();
  const allowKeptWork = (projectId, itemId) => keptWorkAllowed.add(`${projectId}:${itemId}`);

  // A project's roadmap for the screen: item statuses derived from their runs (#112), each running
  // item with `waiting` (at a human gate).
  function roadmapView(projectId, list = []) {
    const roadmap = roadmaps.withStatus(roadmaps.readRoadmap(ctx.ws.backlog, path.basename(String(projectId))), roadmapRun);
    const byId = new Map(list.map((r) => [r.runId, r]));
    return {
      ...roadmap,
      stages: roadmap.stages.map((s) => ({
        ...s, items: s.items.map((x) => (x.status === 'running' && byId.get(x.runId)?.waiting ? { ...x, waiting: true } : x)),
      })),
    };
  }

  async function dispatchRoadmaps() {
    if (!ctx.ws) return;
    if (roadmapBusy) { roadmapAgain = true; return; }
    roadmapBusy = true;
    try {
      do {
        roadmapAgain = false;
        for (const projectId of roadmaps.roadmapProjects(ctx.ws.backlog)) {
          try { await advanceRoadmap(projectId); } catch (e) { console.error('roadmap:', projectId, e); }
        }
      } while (roadmapAgain);
    } finally {
      roadmapBusy = false;
    }
  }

  // The state of a roadmap item's run: live (a gate keeps it open), else what it recorded; merged =
  // a local merge, a PR/MR merge action, or a simulation that succeeded (simulations never merge).
  function roadmapRun(runId) {
    const live = runId && ctx.active.get(runId);
    if (live) return { status: 'running', waiting: live.approvals.size > 0 };
    const r = runId ? runs.readRun(ctx.ws.runs, runId) : null;
    if (!r) return null;
    return { status: r.status, error: r.error, merged: r.status === 'success' && (r.mock || !!r.localMerge || roadmaps.mergedPullRequest(r.runDir)) };
  }

  async function advanceRoadmap(projectId) {
    const { ws } = ctx;
    const before = roadmaps.readRoadmap(ws.backlog, projectId);
    // a planned roadmap has no run to follow; a paused one still refreshes its items from their runs (#112)
    if (before.state === 'planned') return;
    const cache = backlog.readBacklog(ws.backlog, projectId);
    const closed = new Set((cache?.issues || []).filter((i) => i.state === 'closed').map((i) => i.number));
    const mockOf = (item) => !!item.mock || !!before.simulated;
    // a missing project fails each start below (the item records the error), not the whole step
    let known = null;
    try { known = projects.readProject(ws.projects, projectId); } catch { /* reported at the start */ }
    // an item that reads its issues from the platform at its start (#168) is never skipped on the
    // cache's state (an issue reopened since the sync still runs): the fresh read decides below
    const fromPlatform = (item) => !mockOf(item) && !!known?.repo;
    const { roadmap, start } = roadmaps.advance(before, {
      runOf: roadmapRun, closed: (n, item) => !fromPlatform(item) && closed.has(n), canStart: (item) => !ctx.slotProblem({ mock: mockOf(item), projectId }),
    });
    // derived statuses are not stored (roadmaps.persisted): only a stored change is written
    const changed = JSON.stringify({ ...roadmaps.persisted(roadmap), updatedAt: null }) !== JSON.stringify({ ...before, updatedAt: null });
    if (changed) roadmaps.updateRoadmap(ws.backlog, projectId, (cur) => (cur.updatedAt === before.updatedAt ? roadmap : null));
    // a stage run on its own (#141) that finished pauses the roadmap without a failure
    if (roadmap.state === 'paused' && before.state === 'running' && before.scope && !roadmap.scope && !roadmap.pausedBy) {
      ctx.notify({ kind: 'run', event: 'succeeded', title: 'Roadmap stage done', body: String(roadmap.error || '').slice(0, 180) });
    } else if (roadmap.state === 'paused' && before.state === 'running') {
      ctx.notify({ kind: 'run', event: 'failed', title: 'Roadmap paused', body: String(roadmap.error || '').slice(0, 180) });
    }
    if (roadmap.state === 'done' && before.state === 'running') ctx.notify({ kind: 'run', event: 'succeeded', title: 'Roadmap finished', body: `Every stage of ${projectId} is done.` });
    for (const item of start) {
      // a slot may have been taken by the previous start
      if (ctx.slotProblem({ mock: mockOf(item), projectId })) break;
      try {
        const project = projects.readProject(ws.projects, projectId);
        const wf = loadWorkflow(ctx.workflowPath(item.workflow).file);
        // the platform is the source of truth (#168): the issues are read again now, the task is built
        // from what was read and the item's copy updated (a simulation reads the synced cache only)
        const platform = cache?.platform || workspace.readSettings(ws).backlogPlatform || backlog.DEFAULT_PLATFORM;
        const { issues: read, warnings } = await backlog.freshIssues({ item, platform, repo: project.repo, cache, fromPlatform: fromPlatform(item) });
        roadmaps.refreshCopies(ws.backlog, projectId, read);
        // a closed issue of a group is left out; the others start
        const open = read.filter((i) => i.state !== 'closed');
        if (!open.length) {
          roadmaps.skipClosed(ws.backlog, projectId, item.id);
          // its slot is free again: the next step starts the following item (or the next stage)
          roadmapAgain = true;
          continue;
        }
        const run = { ...item, ...open[0], ...(open.length > 1 ? { issues: open } : { issues: undefined }) };
        const started = await ctx.startWorkflowRun({
          file: item.workflow, inputs: backlog.runInputs(run, wf, project.folder), mock: mockOf(item),
          projectId, issues: backlog.recordedIssues(open), notices: warnings.map((message) => ({ level: 'warn', message })),
          allowKeptWork: keptWorkAllowed.has(`${projectId}:${item.id}`),
        });
        keptWorkAllowed.delete(`${projectId}:${item.id}`);
        roadmaps.markStarted(ws.backlog, projectId, item.id, { runId: started.runId });
      } catch (e) {
        roadmaps.markStarted(ws.backlog, projectId, item.id, { error: e.message });
        ctx.notify({ kind: 'run', event: 'failed', title: 'Roadmap paused', body: `Could not start an item: ${e.message}`.slice(0, 180) });
        break;
      }
    }
  }

  // Start: a roadmap with real items is refused in simulation-only mode (automated checks), like assignments.
  // `stage` (a stage id): run only that stage (#141); only its items count as real then.
  async function startRoadmap({ projectId, simulated = false, stage = null }) {
    const { ws } = ctx;
    const id = path.basename(String(projectId));
    const r = roadmaps.readRoadmap(ws.backlog, id);
    const stages = stage ? r.stages.filter((s) => s.id === stage) : r.stages;
    if (!simulated && stages.some((s) => s.items.some((x) => !x.mock && !['done', 'skipped'].includes(x.status)))) {
      simulation.refuseReal('real runs from a roadmap');
      await host.assertCanRun?.({ mock: false });
    }
    roadmaps.setState(ws.backlog, id, 'running', { simulated: !!simulated, stage: stage ? String(stage) : null });
    await dispatchRoadmaps();
    return ctx.withIssueRuns(backlog.readBacklog(ws.backlog, id));
  }

  return {
    allowKeptWork,
    dispatchRoadmaps,
    roadmapView,
    startRoadmap,
  };
};
