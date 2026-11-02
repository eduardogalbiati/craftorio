// Service area: a project's Backlog (packages/engine/domains/backlog/backlog.js). The synced issues with their runs, queue,
// roadmap stage and local status; Assign (queue issues for a workflow, alone or as one group run,
// with an optional chain, #134); the queue's dispatch into free run slots; and the issue tracker's
// epic placement after a run filed issues (#138); the Backlog Refresh banner and the sync after a
// refresh run (#161, packages/engine/domains/backlog/backlog-refresh.js). "Create and queue" is a chain (packages/engine/service/areas/chain.js).

const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const simulation = require('../../engine/simulation');
const workspace = require('../../domains/workspace/workspace');
const projects = require('../../domains/project/projects');
const backlog = require('../../domains/backlog/backlog');
const baseHealth = require('../../domains/project/base-health');
const refreshes = require('../../domains/backlog/backlog-refresh');
const { git } = require('../../engine/worktree');
const epics = require('../../domains/backlog/epics');
const roadmaps = require('../../domains/roadmap/roadmap');
const { normalizeThen } = require('@multiagent/shared/chain-model');
const { platformOrDefault, requestRef } = require('@multiagent/shared/platforms');
const runs = require('../../domains/run/runs');
const seedRuns = require('../seed-runs');

module.exports = (ctx) => {
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
    // (#491 `shape`: what the light backlog:state compares to tell an edit of the stages)
    const view = ctx.roadmapView(data.projectId, live, data.issues);
    const roadmap = view && { ...view, shape: backlog.stagesShape(view.stages) };
    const stages = roadmaps.issueStages(roadmap);
    const refresh = refreshBanner(project, live, local);
    const refreshed = new Set(refresh.refreshed);
    // the issues a release shipped (#260) are marked Released (`released`: its version, shown on the card)
    // the issues filed from a discovery card (#258) name it (`discoveryCard`: { id, title }, the card's
    // badge); the card store is the discovery channels' (fronts/plan/engine/channels/discovery.js)
    const cards = ctx.discoveryIssueCards?.(data.projectId) || new Map();
    const issues = ctx.markReleasedIssues(data.projectId, backlog.linkRuns(data.issues, live, queue, local))
      .map((i) => (cards.has(i.number) ? { ...i, discoveryCard: cards.get(i.number) } : i))
      .map((i) => (stages.has(i.number) ? { ...i, roadmap: stages.get(i.number) } : i))
      .map((i) => (refreshed.has(i.number) && i.state === 'open' ? { ...i, refreshed: true } : i));
    // #291: the releases the Roadmap draws (its release blocks and Releases filter)
    const releases = ctx.roadmapReleases(project, live, roadmap);
    // #150: the saved conflict map, shown beside the Roadmap (null until a plan or a merge builds it)
    const conflictMap = ctx.savedConflictMap(data.projectId);
    // #405: the tests known to fail on the base (the Roadmap's "N known failures on the base" line)
    const baseFailures = baseHealth.knownFailures(ws.root, data.projectId);
    // #465: the base check's last state (running, green, red), the Roadmap's "Base check" card
    const baseCheck = ctx.baseCheckState?.(data.projectId) || null;
    return { ...data, queue, local, roadmap, refresh, autoEpic: !!project?.autoEpic, issues, releases, conflictMap, baseFailures, baseCheck };
  }

  // The Backlog Refresh banner (#161, packages/engine/domains/backlog/backlog-refresh.js): the merges on the base since the
  // last refresh are counted (first-parent commits: merges and squashes) only when it is stale;
  // `refreshed`: the issues that refresh updated, for a day.
  function refreshBanner(project, list, local) {
    const { ws } = ctx;
    const hours = workspace.readSettings(ws).backlogRefreshHours;
    const { last } = refreshes.refreshRuns(list);
    const stale = last && Number(hours) > 0 && Date.now() - Date.parse(last.startedAt) >= Number(hours) * 3600e3;
    const count = stale && project?.folder ? mergeCount(project, last.startedAt, local?.base || 'HEAD') : null;
    const state = refreshes.refreshState({
      runs: list, intervalHours: hours, merges: count == null ? null : Number(count), dismissedOn: project ? refreshes.readDismissed(ws.backlog, project.id) : null,
    });
    const refreshed = last ? refreshes.refreshedIssues(path.join(ws.runs, last.runId), last.finishedAt) : [];
    return { ...state, base: local?.base || null, refreshed };
  }

  // The merges on `base` since `since` (#389): counted by an async git call and kept for
  // MERGE_COUNT_MS, so a Backlog read never waits for git; null until the first count is known.
  // A count that changed pushes backlog:changed (file 'refresh'), so the screen reads the banner again.
  const MERGE_COUNT_MS = 5 * 60e3;
  const mergeCounts = new Map(); // "<folder>|<since>|<base>" → { count, at, pending }
  function mergeCount(project, since, base) {
    const folder = project.folder;
    const key = `${folder}|${since}|${base}`;
    const hit = mergeCounts.get(key);
    if (!hit?.pending && (!hit || Date.now() - hit.at >= MERGE_COUNT_MS)) {
      const entry = { count: hit?.count ?? null, at: hit?.at || 0, pending: true };
      mergeCounts.set(key, entry);
      git(['rev-list', '--count', '--first-parent', `--since=${since}`, base, '--'], folder, { timeout: 10000 }).catch(() => null).then((out) => {
        const before = entry.count;
        Object.assign(entry, { count: out, at: Date.now(), pending: false });
        if (out !== before) ctx.events?.emit('backlog:changed', { projectId: project.id, file: 'refresh', watching: !!ctx.backlogWatching?.() });
      });
    }
    return mergeCounts.get(key).count;
  }

  // A Backlog Refresh run ended (#161): the Backlog syncs the project, so the edited and closed
  // issues show at once. A simulated run changed nothing on the platform: no sync.
  async function afterBacklogRefresh(run) {
    if (!refreshes.isRefreshRun({ file: run.file }) || !run.projectId || run.mock) return;
    const { ws } = ctx;
    const project = projects.readProject(ws.projects, run.projectId);
    const platform = backlog.readBacklog(ws.backlog, project.id)?.platform || platformOrDefault(run.inputs?.git_platform).id;
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
  async function assignWorkflow({ projectId, numbers, workflow, inputs, mock, group = false, allowKeptWork = false, then = null, pipeline = null, agentOverrides = null }) {
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
    }
    // a pipeline's first stage keeps its workflow's agents (#262: the overrides were chosen for `workflow`)
    backlog.enqueue(ws.backlog, project.id, { issues, workflow: file, workflowName: wf.metadata?.name || file, inputs: inputs || {}, mock: !!mock, group: !!group, then: chained, agentOverrides: pipeline ? null : agentOverrides });
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
    const platform = platformOrDefault(run.inputs.git_platform).id;
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
        // #276: low memory holds a real start: the item goes back to the queue and a timer dispatches again
        if (!item.mock && await ctx.memoryHold()) {
          backlog.releaseQueued(ws.backlog, projectId, item.number);
          return;
        }
        try {
          const project = projects.readProject(ws.projects, projectId);
          const wf = loadWorkflow(ctx.workflowPath(item.workflow).file);
          const cache = backlog.readBacklog(ws.backlog, projectId);
          const platform = backlog.platformOf(project, cache?.platform || workspace.readSettings(ws).backlogPlatform);
          const real = !item.mock && !!project.repo;
          // a PR/MR may have been opened for an issue since it was queued: skip it, don't redo the work
          // (an issue of a group leaves the group, which starts with the others)
          if (real) {
            const prs = await backlog.newPullRequests({ item, platform, repo: project.repo });
            if (prs.length) {
              for (const n of new Set(prs.map((p) => p.issue ?? item.number))) {
                const mine = prs.filter((p) => (p.issue ?? item.number) === n);
                backlog.skipQueued(ws.backlog, projectId, n, `open ${mine.map((p) => requestRef(platform, p.number)).join(', ')} since it was queued`);
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
            file: item.workflow, inputs: backlog.runInputs(run, wf, project.folder, await seedRuns.runDefaultsOf(ctx, project)), mock: item.mock,
            projectId, issues: backlog.recordedIssues(read), notices: warnings.map((message) => ({ level: 'warn', message })),
            allowKeptWork: keys.some((k) => keptWorkAllowed.has(k)),
            then: item.then || null,
            agentOverrides: item.agentOverrides || null,
            fromQueue: true, // #445: its failure pauses this queue
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
