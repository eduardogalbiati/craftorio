// Service area: roadmaps (packages/engine/domains/roadmap/roadmap.js). Settles each started roadmap from its runs and starts
// the current stage's items while there are free run slots; called after every run and when a
// workspace opens. Also the roadmap as the Backlog shows it (item statuses from their runs, #112)
// and Start (the whole roadmap, or one stage, #141). A live roadmap's refill (#164): areas/live-roadmap.js.
// Cost (#206): the view gives each item and stage its estimate (packages/engine/domains/usage/cost-estimate.js, from the
// project's past runs) and each item with a run its real cost; a real start that would pass the
// budget cap (areas/budget.js) pauses the roadmap instead (budgetStop) and notifies the owner.
// Cut lines (#260): a roadmap that reached one starts its release run (areas/releases.js roadmapRelease).
// Move on (#395): parkItem / parkStage park the items whose runs wait at a human gate (`gateRun`: the
// gate's step name, also for a run interrupted there) and dispatch; nothing answers the gate.

const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const simulation = require('../../engine/simulation');
const workspace = require('../../domains/workspace/workspace');
const projects = require('../../domains/project/projects');
const backlog = require('../../domains/backlog/backlog');
const budget = require('../../domains/usage/budget');
const costEstimate = require('../../domains/usage/cost-estimate');
const roadmaps = require('../../domains/roadmap/roadmap');
const runs = require('../../domains/run/runs');
const { prOfEvents } = require('../../domains/run/run-pr');
const seedRuns = require('../seed-runs');
const RoadmapModel = require('@multiagent/shared/roadmap-model');
const RunProgress = require('@multiagent/shared/run-progress-model');
const { clientError } = require('../common');

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
  // `issues`: the backlog's issues when the caller has read them already (the Backlog, #389)
  function roadmapView(projectId, list = [], issues = null) {
    // #384: each run read once per draw (an item's run, its resume chain, its earlier runs)
    const found = new Map();
    const find = (runId) => (found.has(runId) ? found.get(runId) : found.set(runId, findRun(runId)).get(runId));
    const runOfItem = (runId) => roadmapRun(runId, find);
    const read = roadmaps.readRoadmap(ctx.ws.backlog, path.basename(String(projectId)));
    const stored = { ...read, stages: read.stages.map((s) => ({ ...s, items: s.items.map((x) => resumedItem(x, find)) })) };
    const roadmap = stored.state === 'paused' ? roadmaps.advance(stored, { runOf: runOfItem, canStart: () => false }).roadmap : roadmaps.withStatus(stored, runOfItem);
    const byId = new Map(list.map((r) => [r.runId, r]));
    // a run the caller did not list (roadmap:get lists none): its index row
    const runOf = (runId) => byId.get(runId) || find(runId);
    // #384: the item's earlier runs, oldest first, with their status
    const runHistory = (x) => RoadmapModel.earlierRuns(x).map((id) => ({ runId: id, status: runOf(id)?.status || null }));
    // past runs of the same workflow file, simulated with simulated and real with real
    const history = new Map();
    const typical = (file, mock) => {
      const key = `${file}|${!!mock}`;
      if (!history.has(key)) history.set(key, RunProgress.typicalStepTimes(list.filter((r) => r.file === file && !!r.mock === !!mock)));
      return history.get(key);
    };
    const runView = (x) => {
      const r = runOf(x.runId);
      if (!r) return null;
      const live = ctx.active.get(x.runId);
      const progress = live?.trail?.steps || r.progress || [];
      // a run read from disk that waits at a gate (its trail's last step), when no live process says so
      const waiting = !!r.waiting || (r.status === 'running' && progress.at(-1)?.status === 'waiting');
      const { times, runs: count } = typical(r.file, r.mock);
      // gate: the "What happened" line of the gate a live run waits at (#213), for the waiting badge
      const gate = live?.pendingGates?.()[0]?.brief?.headline || null;
      // #395: the gate the run waits at (live, or interrupted there by a closed app), by its step's name
      const atGate = gateOf(x.runId, find);
      return {
        status: r.status, mock: !!r.mock, startedAt: r.startedAt || null, finishedAt: r.finishedAt || null, waiting, gate, atGate,
        progress, groups: r.groups || [], agentNames: r.agentNames || null, stepNames: r.stepNames || null, workflow: r.workflow || null, error: r.error || null,
        stepTimes: times, history: count,
        // #614: the commit the run merged (the card's Merge station is done with it)
        mergedCommit: r.localMerge?.commit || r.outputs?.merged_commit || null,
      };
    };
    const prices = workspace.readSettings(ctx.ws).prices || {};
    // the backlog's issues: their complexity:n labels scale each item's estimate (#215)
    const known = issues || backlog.readBacklog(ctx.ws.backlog, path.basename(String(projectId)))?.issues || [];
    return costEstimate.withEstimates({
      ...roadmap,
      stages: roadmap.stages.map((s) => ({
        ...s,
        // #368: the stage's pause line ({ state: 'pausing' | 'paused', ... }), on the stage it paused at
        pause: stagePause(roadmap, s),
        items: s.items.map((x) => {
          const run = x.runId ? runView(x) : null;
          const waiting = x.status === 'running' && (byId.get(x.runId)?.waiting || run?.waiting);
          const earlier = runHistory(x);
          return { ...x, ...(waiting ? { waiting: true } : {}), ...(run ? { run } : {}), ...(earlier.length ? { runHistory: earlier } : {}) };
        }),
      })),
    }, list, { issues: known, prices });
  }

  // #384: an item whose run was resumed (#250) shows the run that resumed it (the latest of the chain),
  // the earlier ones in its `runs`, also when its file still names the earlier run (adoptResumed, #100,
  // records it when the resume starts); a done or skipped item keeps its run, a parked one (#395) follows it
  const findRun = (runId) => runs.findRun(ctx.ws.runs, runId);
  function resumedItem(x, find = findRun) {
    if (!x.runId || (RoadmapModel.isFinished(x) && x.status !== 'parked')) return x;
    const chain = [];
    while (chain.length < 20) {
      const next = find(chain.at(-1) || x.runId)?.resumedBy?.runId;
      if (!next || next === x.runId || chain.includes(next)) break;
      chain.push(next);
    }
    return chain.length ? { ...x, runId: chain.at(-1), runs: [...new Set([...(x.runs || []), x.runId, ...chain])], error: null } : x;
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
  function roadmapRun(runId, find = findRun) {
    const live = runId && ctx.active.get(runId);
    if (live) return { status: 'running', waiting: live.approvals.size > 0 };
    // its index row when current (#389: no events.jsonl parsed per item and per read)
    const r = runId ? find(runId) : null;
    if (!r) return null;
    return { status: r.status, error: r.error, merged: r.status === 'success' && (r.mock || !!r.localMerge || roadmaps.mergedPullRequest(r.runDir) || neverMerges(r.file, r.projectId)) };
  }

  // #395: roadmapRun, with `waiting` and `gate` (the step's name) when the run waits at a human gate:
  // live, or interrupted there (a closed app; its trail's last step waits), so Move on can park it
  function gateRun(runId, find = findRun) {
    const base = roadmapRun(runId, find);
    const gate = base && gateOf(runId, find);
    return gate ? { ...base, waiting: true, gate } : base;
  }
  // the name of the human gate a run waits at, or null (cheap: no events.jsonl read, #389)
  function gateOf(runId, find = findRun) {
    const live = runId && ctx.active.get(runId);
    if (live) {
      const open = live.pendingGates?.()[0];
      return open ? live.displayNames?.().steps?.[open.step_id] || open.step_id : null;
    }
    const r = runId ? find(runId) : null;
    const last = r?.status === 'interrupted' ? r.progress?.at(-1) : null;
    if (last?.status !== 'waiting') return null;
    const step = last.step || '';
    return r.stepNames?.[step] || step || 'its gate';
  }

  // #395 Move on: the item parked, or the stage's items at a gate parked and its planned ones skipped
  // (refused while a turn of the stage runs); the runs keep waiting at their gates, then the next stage starts
  async function parkItem({ projectId, itemId }) {
    const id = path.basename(String(projectId));
    try {
      roadmaps.itemAction(ctx.ws.backlog, id, String(itemId), 'park', { alive: ctx.runAlive, runOf: (runId) => gateRun(runId) });
    } catch (e) { throw clientError(e.message); }
    await dispatchRoadmaps();
  }
  async function parkStage({ projectId, stageId }) {
    const id = path.basename(String(projectId));
    try {
      roadmaps.parkStage(ctx.ws.backlog, id, String(stageId), { runOf: (runId) => gateRun(runId) });
    } catch (e) { throw clientError(e.message); }
    await dispatchRoadmaps();
  }

  // #395: whether a run is a parked item's (the roadmap moved on past it): while it waits at its gate
  // it holds no run slot (areas/runs.js slotProblem), so the next stage can start
  function parkedRun(runId, projectId) {
    if (!ctx.ws || !runId || !projectId) return false;
    try {
      const r = roadmaps.readRoadmap(ctx.ws.backlog, path.basename(String(projectId)));
      return r.stages.some((s) => s.items.some((x) => x.runId === runId && x.status === 'parked'));
    } catch { return false; }
  }

  // #738: a parent item's run for dependencyBase → { branch (develop's output), merged, prNumber, prUrl } or null
  function parentRun(runId) {
    const r = runId ? findRun(runId) : null;
    if (!r?.runDir) return null;
    let events = [];
    try { events = runs.runEvents(r.runDir); } catch { /* no events: no branch */ }
    const branch = events.filter((e) => e.type === 'step.finished' && typeof e.output?.branch === 'string' && e.output.branch.trim()).at(-1)?.output.branch.trim() || null;
    const pr = prOfEvents(events);
    return { branch, merged: !!roadmapRun(runId)?.merged, prNumber: pr?.number || null, prUrl: pr?.url || null };
  }

  // #738 split implementations in a Fork + PR run: a dependent item starts from its parent's branch on
  // the fork while the parent is not merged (inputs.parent_branch), from the synced base once it is; with
  // the project's dependentPr 'depends-on' its PR says "Depends on #<parent's PR>" (inputs.depends_on),
  // else (wait and rebase) its ci step waits for the parent's PR to merge (inputs.parent_pr, wait.parent)
  function dependencyInputs(roadmap, item, inputs, wf, project) {
    if (!item.dependsOn || inputs.mode !== 'fork' || !wf.inputs?.parent_branch) return {};
    const dep = roadmaps.dependencyBase(roadmap, item.id, { runOf: parentRun, policy: project.fork?.dependentPr });
    if (!dep) return {};
    return {
      ...(dep.branch && !dep.parentMerged ? { parent_branch: dep.branch } : {}),
      ...(dep.prNote && !dep.parentMerged && wf.inputs?.depends_on ? { depends_on: dep.prNote.replace(/^Depends on /, '') } : {}),
      ...(dep.parentPr && wf.inputs?.parent_pr ? { parent_pr: dep.parentPr } : {}),
    };
  }

  function neverMerges(file, projectId) {
    if (!file) return false;
    try { return loadWorkflow(ctx.projectWorkflowFile(projectId, file)).metadata?.merges === false; } catch { return false; }
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
    notifyAdvance(projectId, before, roadmap);
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
        const wf = loadWorkflow(ctx.projectWorkflowFile(projectId, item.workflow));
        // the platform is the source of truth (#168): the issues are read again now, the task is built
        // from what was read and the item's copy updated (a simulation reads the synced cache only)
        const platform = backlog.platformOf(project, cache?.platform || workspace.readSettings(ws).backlogPlatform);
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
        const inputs = backlog.runInputs(run, wf, project.folder, seedRuns.runDefaultsNow(ctx, project));
        const started = await ctx.startWorkflowRun({
          file: item.workflow, inputs: { ...inputs, ...dependencyInputs(roadmap, item, inputs, wf, project) }, mock: mockOf(item),
          projectId, issues: backlog.recordedIssues(open), notices: warnings.map((message) => ({ level: 'warn', message })),
          allowKeptWork: keptWorkAllowed.has(`${projectId}:${item.id}`),
          then: item.then || null,
          agentOverrides: item.agentOverrides || null,
        });
        keptWorkAllowed.delete(`${projectId}:${item.id}`);
        roadmaps.markStarted(ws.backlog, projectId, item.id, { runId: started.runId });
      } catch (e) {
        // #527: a base-health fix item whose issue a live run works on is skipped, the roadmap goes on
        if (item.source === 'base-health' && e.runId) {
          roadmaps.skipItem(ws.backlog, projectId, item.id, e.message);
          console.log(`roadmap: base-health item ${item.id} skipped: ${e.message}`);
          roadmapAgain = true;
          continue;
        }
        roadmaps.markStarted(ws.backlog, projectId, item.id, { error: e.message });
        ctx.notify({ kind: 'run', event: 'failed', title: 'Roadmap paused', body: `Could not start an item: ${e.message}`.slice(0, 180) });
        break;
      }
    }
  }

  // The owner's notice of a roadmap step that paused or finished the roadmap
  function notifyAdvance(projectId, before, roadmap) {
    if (before.state !== 'running') return;
    // a stage run on its own (#141) that finished pauses the roadmap without a failure
    if (roadmap.state === 'paused' && before.scope && !roadmap.scope && !roadmap.pausedBy) {
      ctx.notify({ kind: 'run', event: 'succeeded', title: 'Roadmap stage done', body: String(roadmap.error || '').slice(0, 180) });
    } else if (roadmap.state === 'paused') {
      ctx.notify({ kind: 'run', event: 'failed', title: 'Roadmap paused', body: String(roadmap.error || '').slice(0, 180) });
    }
    if (roadmap.state === 'done') {
      // #284: a disabled stage with work left was skipped, not done: the notice says so
      const off = roadmap.stages.filter((s) => s.disabled && RoadmapModel.hasUnfinished(s)).length;
      ctx.notify({ kind: 'run', event: 'succeeded', title: 'Roadmap finished', body: off ? `Every enabled stage of ${projectId} is done; ${off} disabled stage${off === 1 ? ' was' : 's were'} left out.` : `Every stage of ${projectId} is done.` });
    }
  }

  // The stage that ended in this step (with a real item), as the event of the app update's trigger
  // (the only one since #285); true when its cycle started.
  function appUpdateStarted(before, roadmap, mockOf) {
    const at = RoadmapModel.currentStage(before);
    const stage = at >= 0 ? roadmap.stages.find((s) => s.id === before.stages[at].id) : null;
    return !!stage && stage.items.some((x) => !mockOf(x)) && !RoadmapModel.hasUnfinished(stage) && ctx.appUpdateEvent({ type: 'stage-done' });
  }

  // Start: a roadmap with real items is refused in simulation-only mode (automated checks), like assignments.
  // `stage` (a stage id): run only that stage (#141); only its items count as real then.
  async function startRoadmap({ projectId, simulated = false, stage = null }) {
    const { ws } = ctx;
    const id = path.basename(String(projectId));
    const r = roadmaps.readRoadmap(ws.backlog, id);
    const stages = stage ? r.stages.filter((s) => s.id === stage) : r.stages;
    // a disabled stage (#284) starts nothing: its real items do not make this start a real one
    if (!simulated && RoadmapModel.unfinishedItems({ stages }).some((x) => !x.mock)) {
      simulation.refuseReal('real runs from a roadmap');
    }
    // #368: the paused runs first, where they paused (each takes its item's place, adoptResumed), then the new items
    await resumePausedItems(id, stages, !!simulated);
    roadmaps.setState(ws.backlog, id, 'running', { simulated: !!simulated, stage: stage ? String(stage) : null });
    await dispatchRoadmaps();
    return ctx.withIssueRuns(backlog.readBacklog(ws.backlog, id));
  }

  // The owner's Resume or Start continues every item of the enabled `stages` whose run ended paused
  // (#368), as a simulation when the roadmap runs as one; a run that cannot resume (no free slot, a
  // refused real run) keeps its item paused and the owner is told why.
  async function resumePausedItems(projectId, stages, simulated) {
    const enabled = stages.filter((s) => !s.disabled);
    const paused = roadmaps.withStatus({ stages: enabled }, roadmapRun).stages.flatMap((s) => s.items).filter((x) => x.status === 'paused');
    for (const item of paused) {
      try {
        await ctx.resumeRun({ runId: item.runId, mock: simulated || !!item.mock });
      } catch (e) {
        ctx.notify({ kind: 'run', event: 'failed', title: 'Paused run not resumed', body: `Run ${item.runId}: ${e.message}`.slice(0, 180), target: { view: 'roadmap', projectId } }, { projectId });
      }
    }
  }

  // #368: a stage's "Pause after current turn": the roadmap pauses at the stage (no new item starts)
  // and each run of the stage in progress in this app pauses after its current turn (a run at a gate
  // at once, the gate unanswered). A run another app window owns goes on: it is paused there.
  function pauseStage({ projectId, stageId }) {
    const id = path.basename(String(projectId));
    const r = roadmaps.withStatus(roadmaps.readRoadmap(ctx.ws.backlog, id), roadmapRun);
    const stage = r.stages.find((s) => s.id === stageId);
    if (!stage) throw clientError('This stage is no longer in the roadmap.');
    const may = RoadmapModel.allowedActions(r, stage).pauseStage;
    if (!may.allowed) throw clientError(may.reason);
    roadmaps.pauseStage(ctx.ws.backlog, id, stage.id);
    for (const x of stage.items) {
      const run = x.runId && ctx.active.get(x.runId);
      // a run stopping meanwhile refuses the pause: the others still pause
      try { if (run && ['pending', 'running'].includes(run.status)) run.pause(); } catch (e) { console.error('roadmap stage pause:', x.runId, e.message); }
    }
    return ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, id));
  }

  // A stage the roadmap paused at (#368), as the screen shows it: pausing while one of its runs still
  // finishes its turn (that run's pauseState), else paused since `at`; null for any other stage.
  function stagePause(r, stage) {
    const line = roadmaps.stagePauseLine(r, stage);
    if (!line) return null;
    const live = stage.items.map((x) => x.runId && ctx.active.get(x.runId)).find((run) => run?.pausing);
    return live ? live.pauseState() : line;
  }

  return {
    allowKeptWork,
    dispatchRoadmaps,
    parkItem,
    parkStage,
    parkedRun,
    pauseStage,
    roadmapView,
    startRoadmap,
  };
};
