// Service area: roadmaps (src/roadmap.js). Settles each started roadmap from its runs and starts
// the current stage's items while there are free run slots; called after every run and when a
// workspace opens. Also the roadmap as the Backlog shows it (item statuses from their runs, #112)
// and Start (the whole roadmap, or one stage, #141). A live roadmap's refill (#164): areas/live-roadmap.js.
// Cost (#206): the view gives each item and stage its estimate (src/cost-estimate.js, from the
// project's past runs) and each item with a run its real cost; a real start that would pass the
// budget cap (areas/budget.js) pauses the roadmap instead (budgetStop) and notifies the owner.
// Cut lines (#260): a roadmap that reached one starts its release run (areas/releases.js roadmapRelease).

const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const simulation = require('../../engine/simulation');
const workspace = require('../../workspace');
const projects = require('../../projects');
const backlog = require('../../backlog');
const budget = require('../../budget');
const costEstimate = require('../../cost-estimate');
const roadmaps = require('../../roadmap');
const runs = require('../../runs');
const RunProgress = require('../../renderer/run-progress-model');

module.exports = (ctx) => {
  // a call while one is going runs again right after it (a run that ends meanwhile is never missed)
  let roadmapBusy = false;
  let roadmapAgain = false;
  // "<projectId>:<itemId>" of the items whose Retry the owner confirmed over a kept worktree's work
  // (#112): their next start goes ahead; kept in memory, so after a restart the start asks again
  const keptWorkAllowed = new Set();
  const allowKeptWork = (projectId, itemId) => keptWorkAllowed.add(`${projectId}:${itemId}`);

  // A project's roadmap for the screen: item statuses derived from their runs (#112), each running
  // item with `waiting` (at a human gate), and each item with a run its progress (#194, `run`: the
  // trail, groups, state and the typical step times of its workflow's past runs, for the card's ring).
  // A paused roadmap shows what the scheduler will settle (#237: a stage run on its own that finished
  // while paused, e.g. after an edit of the file the scheduler has not seen, shows "Stage N done").
  function roadmapView(projectId, list = []) {
    const stored = roadmaps.readRoadmap(ctx.ws.backlog, path.basename(String(projectId)));
    const roadmap = stored.state === 'paused' ? roadmaps.advance(stored, { runOf: roadmapRun, canStart: () => false }).roadmap : roadmaps.withStatus(stored, roadmapRun);
    const byId = new Map(list.map((r) => [r.runId, r]));
    // past runs of the same workflow file, simulated with simulated and real with real
    const history = new Map();
    const typical = (file, mock) => {
      const key = `${file}|${!!mock}`;
      if (!history.has(key)) history.set(key, RunProgress.typicalStepTimes(list.filter((r) => r.file === file && !!r.mock === !!mock)));
      return history.get(key);
    };
    const runView = (x) => {
      const r = byId.get(x.runId);
      if (!r) return null;
      const live = ctx.active.get(x.runId);
      const progress = live?.trail?.steps || r.progress || [];
      // a run read from disk that waits at a gate (its trail's last step), when no live process says so
      const waiting = !!r.waiting || (r.status === 'running' && progress.at(-1)?.status === 'waiting');
      const { times, runs: count } = typical(r.file, r.mock);
      // gate: the "What happened" line of the gate a live run waits at (#213), for the waiting badge
      const gate = live?.pendingGates?.()[0]?.brief?.headline || null;
      return {
        status: r.status, mock: !!r.mock, startedAt: r.startedAt || null, finishedAt: r.finishedAt || null, waiting, gate,
        progress, groups: r.groups || [], agentNames: r.agentNames || null, stepNames: r.stepNames || null, workflow: r.workflow || null, error: r.error || null,
        stepTimes: times, history: count,
      };
    };
    const prices = workspace.readSettings(ctx.ws).prices || {};
    // the backlog's issues: their complexity:n labels scale each item's estimate (#215)
    const issues = backlog.readBacklog(ctx.ws.backlog, path.basename(String(projectId)))?.issues || [];
    return costEstimate.withEstimates({
      ...roadmap,
      stages: roadmap.stages.map((s) => ({
        ...s,
        items: s.items.map((x) => {
          const run = x.runId ? runView(x) : null;
          const waiting = x.status === 'running' && (byId.get(x.runId)?.waiting || run?.waiting);
          return { ...x, ...(waiting ? { waiting: true } : {}), ...(run ? { run } : {}) };
        }),
      })),
    }, list, { issues, prices });
  }

  // #206: whether the budget cap stops this start: the roadmap pauses with the stage's estimate
  // (its items not started yet) and the owner is notified (Raise for today / Resume anyway on the roadmap).
  function budgetStop(projectId, item, roadmap) {
    const settings = workspace.readSettings(ctx.ws);
    const caps = budget.budgetSettings(settings);
    if (!caps.dailyUsd && !caps.nightlyUsd) return false;
    const list = runs.listRuns(ctx.ws.runs);
    const issues = backlog.readBacklog(ctx.ws.backlog, path.basename(String(projectId)))?.issues || [];
    const estimate = (x) => costEstimate.estimateItem(x, list, { issues, prices: settings.prices || {} });
    const next = estimate(item);
    const block = ctx.budgetBlock(roadmap, next?.usd || 0);
    if (!block) return false;
    const stage = roadmap.stages.find((s) => s.items.some((x) => x.id === item.id));
    const known = (stage?.items || []).filter((x) => x.status === 'planned' && !x.runId).map((x) => estimate(x)?.usd).filter((v) => v != null);
    const stageUsd = known.length ? Math.round(known.reduce((a, v) => a + v, 0) * 100) / 100 : null;
    const message = budget.pauseMessage(block, stageUsd);
    roadmaps.budgetPause(ctx.ws.backlog, projectId, { period: block.period, spentUsd: block.spentUsd, limitUsd: block.limitUsd, nextUsd: block.nextUsd, stageUsd, at: new Date().toISOString() }, message);
    ctx.notify({ kind: 'run', event: 'failed', title: 'Budget reached', body: message.slice(0, 180), target: { view: 'roadmap', projectId } }, { projectId });
    return true;
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
  // a local merge, a PR/MR merge action, or a simulation that succeeded (simulations never merge);
  // a run of a workflow that never merges (`metadata.merges: false`, e.g. backlog-refresh, #161)
  // counts as merged when it succeeds.
  function roadmapRun(runId) {
    const live = runId && ctx.active.get(runId);
    if (live) return { status: 'running', waiting: live.approvals.size > 0 };
    const r = runId ? runs.readRun(ctx.ws.runs, runId) : null;
    if (!r) return null;
    return { status: r.status, error: r.error, merged: r.status === 'success' && (r.mock || !!r.localMerge || roadmaps.mergedPullRequest(r.runDir) || neverMerges(r.file)) };
  }

  function neverMerges(file) {
    if (!file) return false;
    try { return loadWorkflow(ctx.workflowPath(file).file).metadata?.merges === false; } catch { return false; }
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
    const { roadmap, start, refill, release } = roadmaps.advance(before, {
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
    if (roadmap.state === 'done' && before.state === 'running') {
      // #284: a disabled stage with work left was skipped, not done: the notice says so
      const off = roadmap.stages.filter((s) => s.disabled && s.items.some((x) => !['done', 'skipped'].includes(x.status))).length;
      ctx.notify({ kind: 'run', event: 'succeeded', title: 'Roadmap finished', body: off ? `Every enabled stage of ${projectId} is done; ${off} disabled stage${off === 1 ? ' was' : 's were'} left out.` : `Every stage of ${projectId} is done.` });
    }
    // #279: a stage that ended may update the app (areas/app-update.js): its cycle paused every
    // roadmap, nothing more starts here
    if (!before.simulated && appUpdateStarted(before, roadmap, mockOf)) return;
    // a live roadmap's last stage ended (#164): the Product Owner adds the next stages (not awaited:
    // its answer takes minutes; the refill dispatches the roadmap again)
    if (refill) ctx.refillRoadmap(projectId);
    // a cut line (#260): the release run starts and everything after the line waits for it; a line
    // whose release shipped meanwhile lets the next stage start in the same dispatch
    if (release && await ctx.roadmapRelease(projectId, roadmap, release)) roadmapAgain = true;
    for (const item of start) {
      // a slot may have been taken by the previous start
      if (ctx.slotProblem({ mock: mockOf(item), projectId })) break;
      // #206: the budget cap stops a real start whose estimate would pass it (never a run in progress
      // nor a gate): the roadmap pauses with the next stage's estimate, the owner raises or resumes
      if (!mockOf(item) && budgetStop(projectId, item, roadmap)) break;
      // #276: low memory holds a real start (not an error of the item): a timer dispatches again once it recovers
      if (!mockOf(item) && await ctx.memoryHold()) break;
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
          then: item.then || null,
          agentOverrides: item.agentOverrides || null,
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

  // The stage that ended in this step (with a real item), as the event of the app update's trigger
  // (the only one since #285); true when its cycle started.
  function appUpdateStarted(before, roadmap, mockOf) {
    const finished = (x) => ['done', 'skipped'].includes(x.status);
    const at = roadmaps.currentStage(before);
    const stage = at >= 0 ? roadmap.stages.find((s) => s.id === before.stages[at].id) : null;
    return !!stage && stage.items.some((x) => !mockOf(x)) && stage.items.every(finished) && ctx.appUpdateEvent({ type: 'stage-done' });
  }

  // Start: a roadmap with real items is refused in simulation-only mode (automated checks), like assignments.
  // `stage` (a stage id): run only that stage (#141); only its items count as real then.
  async function startRoadmap({ projectId, simulated = false, stage = null }) {
    const { ws } = ctx;
    const id = path.basename(String(projectId));
    const r = roadmaps.readRoadmap(ws.backlog, id);
    const stages = stage ? r.stages.filter((s) => s.id === stage) : r.stages;
    // a disabled stage (#284) starts nothing: its real items do not make this start a real one
    if (!simulated && stages.some((s) => !s.disabled && s.items.some((x) => !x.mock && !['done', 'skipped'].includes(x.status)))) {
      simulation.refuseReal('real runs from a roadmap');
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
