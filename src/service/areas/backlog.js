// Service area: a project's Backlog (src/backlog.js). The synced issues with their runs, queue,
// roadmap stage and local status; Assign (queue issues for a workflow, alone or as one group run,
// with an optional chain, #134); the queue's dispatch into free run slots; and the issue tracker's
// epic placement after a run filed issues (#138); the Backlog Refresh banner and the sync after a
// refresh run (#161, src/backlog-refresh.js). "Create and queue" is a chain (src/service/areas/chain.js).

const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const simulation = require('../../engine/simulation');
const workspace = require('../../workspace');
const projects = require('../../projects');
const backlog = require('../../backlog');
const refreshes = require('../../backlog-refresh');
const { gitOut } = require('../common');
const epics = require('../../epics');
const roadmaps = require('../../roadmap');
const { normalizeThen } = require('../../renderer/chain-model');
const runs = require('../../runs');

module.exports = (ctx) => {
  const { host } = ctx;

  // A synced backlog with each issue's runs and place in the queue (computed on every read: runs
  // come and go), plus the queue itself.
  function withIssueRuns(data) {
    if (!data) return null;
    const { ws } = ctx;
    const project = projects.listProjects(ws.projects).find((p) => p.id === data.projectId);
    const list = project ? runs.runsForProject(runs.listRuns(ws.runs), project) : [];
    const live = list.map((r) => {
      const run = ctx.active.get(r.runId);
      const pr = ctx.withPrState(run?.pr || r.pr, r.mock); // the card's PR icon (#84)
      return run ? { ...r, status: 'running', waiting: run.approvals.size > 0, pr } : { ...r, pr };
    });
    const queue = backlog.readQueue(ws.backlog, data.projectId);
    const local = backlog.readLocal(ws.backlog, data.projectId);
    // the roadmap, each item with its run's live state, and each issue's stage ("Roadmap: stage 2")
    const roadmap = ctx.roadmapView(data.projectId, live);
    const stages = roadmaps.issueStages(roadmap);
    const refresh = refreshBanner(project, live, local);
    const refreshed = new Set(refresh.refreshed);
    // the issues a release shipped (#260) are marked Released (`released`: its version, shown on the card)
    const issues = ctx.markReleasedIssues(data.projectId, backlog.linkRuns(data.issues, live, queue, local))
      .map((i) => (stages.has(i.number) ? { ...i, roadmap: stages.get(i.number) } : i))
      .map((i) => (refreshed.has(i.number) && i.state === 'open' ? { ...i, refreshed: true } : i));
    return { ...data, queue, local, roadmap, refresh, autoPush: !!project?.autoPush, autoEpic: !!project?.autoEpic, issues };
  }

  // The Backlog Refresh banner (#161, src/backlog-refresh.js): the merges on the base since the
  // last refresh are counted (first-parent commits: merges and squashes) only when it is stale;
  // `refreshed`: the issues that refresh updated, for a day.
  function refreshBanner(project, list, local) {
    const { ws } = ctx;
    const hours = workspace.readSettings(ws).backlogRefreshHours;
    const { last } = refreshes.refreshRuns(list);
    const stale = last && Number(hours) > 0 && Date.now() - Date.parse(last.startedAt) >= Number(hours) * 3600e3;
    const count = stale && project?.folder
      ? gitOut(project.folder, ['rev-list', '--count', '--first-parent', `--since=${last.startedAt}`, local?.base || 'HEAD', '--'])
      : null;
    const state = refreshes.refreshState({
      runs: list, intervalHours: hours, merges: count == null ? null : Number(count), dismissedOn: project ? refreshes.readDismissed(ws.backlog, project.id) : null,
    });
    const refreshed = last ? refreshes.refreshedIssues(path.join(ws.runs, last.runId), last.finishedAt) : [];
    return { ...state, base: local?.base || null, refreshed };
  }

  // A Backlog Refresh run ended (#161): the Backlog syncs the project, so the edited and closed
  // issues show at once. A simulated run changed nothing on the platform: no sync.
  async function afterBacklogRefresh(run) {
    if (!refreshes.isRefreshRun({ file: run.file }) || !run.projectId || run.mock) return;
    const { ws } = ctx;
    const project = projects.readProject(ws.projects, run.projectId);
    const platform = backlog.readBacklog(ws.backlog, project.id)?.platform || (run.inputs?.git_platform === 'gl' ? 'gitlab' : 'github');
    await backlog.syncBacklog({ dir: ws.backlog, project, platform });
  }

  // Queues issues of a project's synced backlog for a workflow and starts the first ones if there
  // are free run slots. Only open issues; the workflow needs a `task` input (the issue goes there).
  // group: the issues go as one run (one branch, one PR/MR), up to the backlogMaxGroup setting; a
  // backlog is one project's, so a group never mixes projects.
  // allowKeptWork: the owner answered the kept-work question with Start from scratch (#170).
  // then: what happens with each run's result when it finishes (#134, chain-model normalizeThen).
  // pipeline: a saved pipeline's file (#135): its first workflow (with its fixed inputs under the
  // owner's) receives the issues and the rest of the pipeline is each run's then.
  async function assignWorkflow({ projectId, numbers, workflow, inputs, mock, group = false, allowKeptWork = false, then = null, pipeline = null }) {
    if (pipeline) {
      const first = ctx.pipelineAssign(pipeline);
      ({ workflow, then } = first);
      inputs = { ...first.inputs, ...(inputs || {}) };
    }
    const { ws } = ctx;
    const project = projects.readProject(ws.projects, path.basename(String(projectId)));
    const data = backlog.readBacklog(ws.backlog, project.id);
    if (!data) throw new Error('Sync the backlog first.');
    // in the order they were selected
    const issues = [...new Set((numbers || []).map(Number))].map((n) => data.issues.find((i) => i.number === n)).filter((i) => i?.state === 'open');
    if (!issues.length) throw new Error('Select at least one open issue.');
    const maxGroup = workspace.readSettings(ws).backlogMaxGroup || workspace.DEFAULT_SETTINGS.backlogMaxGroup;
    if (group && issues.length > maxGroup) throw new Error(`One run takes at most ${maxGroup} issues (Settings › General › Backlog); ${issues.length} were selected.`);
    const file = path.basename(String(workflow || ''));
    const wf = loadWorkflow(ctx.workflowPath(file).file);
    const chained = normalizeThen(then);
    if (!wf.inputs?.task) throw new Error(`Workflow ${wf.metadata?.name || file} has no task input to receive the issue.`);
    if (!mock) {
      simulation.refuseReal('real runs from the Backlog');
      await host.assertCanRun?.({ mock: false });
    }
    backlog.enqueue(ws.backlog, project.id, { issues, workflow: file, workflowName: wf.metadata?.name || file, inputs: inputs || {}, mock: !!mock, group: !!group, then: chained });
    if (allowKeptWork) allowQueuedKeptWork(project.id, issues);
    // an issue belongs to one plan: assigned here (the screen asked first), it leaves the roadmap's items not started
    roadmaps.dropIssues(ws.backlog, project.id, issues.map((i) => i.number), { alive: ctx.runAlive });
    await dispatchQueue();
    return withIssueRuns(backlog.readBacklog(ws.backlog, project.id));
  }

  // Issue tracker (#81) and epics (#138): the created issues join the existing epic the analyzer
  // matched clearly, only when the project's autoEpic option ("Auto-place new issues") is on and the
  // epic is in the synced backlog. Never creates an epic; a simulated run places nothing.
  async function placeFiledInEpic(run, ev) {
    const { ws } = ctx;
    const plan = epics.filedToEpic({ workflow: run.wf.metadata?.name, status: ev.status, steps: run.ctx.steps });
    if (!plan || !run.projectId || run.mock) return;
    const project = projects.readProject(ws.projects, run.projectId);
    if (!project?.autoEpic) return;
    const platform = run.inputs.git_platform === 'gl' ? 'gitlab' : 'github';
    const synced = await backlog.syncBacklog({ dir: ws.backlog, project, platform });
    const list = synced?.epics || backlog.readBacklog(ws.backlog, project.id)?.epics || [];
    if (!list.some((e) => e.id === plan.epic)) return;
    await epics.applyEpic({ platform, repo: project.repo, epic: { id: plan.epic }, issues: plan.numbers, epics: list });
    await backlog.syncBacklog({ dir: ws.backlog, project, platform });
  }

  // Queued issues the owner chose to start from scratch although an ended run kept work for them
  // (#170: Start on the issue, Resume on the queue); in memory, used by their next start.
  const keptWorkAllowed = new Set();
  function allowQueuedKeptWork(projectId, issues) {
    for (const i of issues || []) keptWorkAllowed.add(`${projectId}:${Number(i?.number ?? i)}`);
  }

  // Starts queued issues while there are free run slots: the oldest first across projects, a
  // project at its own limit waiting. A start that fails (budget, missing CLI, bad input) pauses
  // that project's queue with the reason.
  let dispatching = false;
  async function dispatchQueue() {
    if (dispatching || !ctx.ws) return;
    dispatching = true;
    try {
      for (;;) {
        const { ws } = ctx;
        // claimed atomically (with the index): another dispatcher on this workspace never takes it too
        const next = backlog.claimQueued(ws.backlog, (projectId, item) => !ctx.slotProblem({ mock: !!item.mock, projectId }));
        if (!next) return;
        const { projectId, item } = next;
        try {
          const project = projects.readProject(ws.projects, projectId);
          const wf = loadWorkflow(ctx.workflowPath(item.workflow).file);
          const cache = backlog.readBacklog(ws.backlog, projectId);
          const platform = cache?.platform || workspace.readSettings(ws).backlogPlatform || backlog.DEFAULT_PLATFORM;
          const real = !item.mock && !!project.repo;
          // a PR/MR may have been opened for an issue since it was queued: skip it, don't redo the work
          // (an issue of a group leaves the group, which starts with the others)
          if (real) {
            const prs = await backlog.newPullRequests({ item, platform, repo: project.repo });
            if (prs.length) {
              for (const n of new Set(prs.map((p) => p.issue ?? item.number))) {
                const mine = prs.filter((p) => (p.issue ?? item.number) === n);
                backlog.skipQueued(ws.backlog, projectId, n, `open ${mine.map((p) => `${platform === 'gitlab' ? 'MR !' : 'PR #'}${p.number}`).join(', ')} since it was queued`);
              }
              continue;
            }
          }
          // the platform is the source of truth (#168): the issues are read again now, the task is
          // built from what was read and the queued copy updated; an issue closed meanwhile is skipped
          const { issues: read, warnings } = await backlog.freshIssues({ item, platform, repo: project.repo, cache, fromPlatform: real });
          backlog.refreshQueuedCopies(ws.backlog, projectId, read, { includeClaimed: true });
          const closed = read.filter((i) => i.state === 'closed');
          if (closed.length) {
            for (const i of closed) backlog.skipQueued(ws.backlog, projectId, i.number, 'closed on the platform');
            backlog.releaseQueued(ws.backlog, projectId, item.number);
            continue;
          }
          const run = { ...item, ...read[0], issues: read.length > 1 ? read : undefined };
          const keys = backlog.itemIssues(item).map((i) => `${projectId}:${i.number}`);
          await ctx.startWorkflowRun({
            file: item.workflow, inputs: backlog.runInputs(run, wf, project.folder), mock: item.mock,
            projectId, issues: backlog.recordedIssues(read), notices: warnings.map((message) => ({ level: 'warn', message })),
            allowKeptWork: keys.some((k) => keptWorkAllowed.has(k)),
            then: item.then || null,
          });
          for (const k of keys) keptWorkAllowed.delete(k);
          backlog.unqueue(ws.backlog, projectId, item.number, { cancelGroup: true });
        } catch (e) {
          backlog.setPaused(ws.backlog, projectId, true, `Could not start ${backlog.itemIssues(item).map((i) => `#${i.number}`).join(', ')}: ${e.message}`);
          backlog.releaseQueued(ws.backlog, projectId, item.number);
        }
      }
    } finally {
      dispatching = false;
    }
  }

  return {
    afterBacklogRefresh,
    allowQueuedKeptWork,
    assignWorkflow,
    dispatchQueue,
    placeFiledInEpic,
    withIssueRuns,
  };
};
