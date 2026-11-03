// Service area: a project's Backlog (packages/engine/domains/backlog/backlog.js). The synced issues with their runs,
// roadmap stage and local status; Assign (plans issues for a workflow in the roadmap as a new last
// stage, alone or as one group item, with an optional chain #134 and "Run now" #446); the issue
// tracker's epic placement after a run filed issues (#138); the Backlog Refresh banner and the sync
// after a refresh run (#161, packages/engine/domains/backlog/backlog-refresh.js). "Create and plan" is a chain
// (packages/engine/service/areas/chain.js).

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
const { platformOrDefault } = require('@multiagent/shared/platforms');
const runs = require('../../domains/run/runs');
const { clientError } = require('../common');

module.exports = (ctx) => {
  // A synced backlog with each issue's runs and roadmap stage (computed on every read: runs come and
  // go). The plain queue is retired (#446): an older answer's `queue` is dropped.
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
    const issues = ctx.markReleasedIssues(data.projectId, backlog.linkRuns(data.issues, live, local))
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
    const { queue: _retired, ...synced } = data;
    return { ...synced, local, roadmap, refresh, autoEpic: !!project?.autoEpic, issues, releases, conflictMap, baseFailures, baseCheck };
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

  // Assign (#446): plans issues of a project's synced backlog for a workflow in the roadmap, as one
  // new stage at the end; nothing waits in a queue. Only open issues; the workflow needs a `task`
  // input (the issue goes there). group: the issues go as one item (one run, one branch, one PR/MR),
  // up to the backlogMaxGroup setting, else one item per issue. allowKeptWork: the owner answered the
  // kept-work question with Start from scratch (#170). then: what happens with each run's result when
  // it finishes (#134, chain-model normalizeThen). pipeline: a saved pipeline's file (#135): its first
  // workflow (with its fixed inputs under the owner's) receives the issues and the rest of the
  // pipeline is each run's then. runNow: the new stage starts on its own (#141's "Run this stage").
  // `batches` (a chain's produced issues, chain-model queueBatches): [{ numbers, group }], one item each.
  async function assignWorkflow({ projectId, numbers, workflow, inputs, mock, group = false, allowKeptWork = false, then = null, pipeline = null, agentOverrides = null, runNow = false, batches = null }) {
    if (pipeline) {
      const first = ctx.pipelineAssign(pipeline);
      ({ workflow, then } = first);
      inputs = { ...first.inputs, ...(inputs || {}) };
    }
    const { ws } = ctx;
    const project = projects.readProject(ws.projects, path.basename(String(projectId)));
    const data = backlog.readBacklog(ws.backlog, project.id);
    if (!data) throw new Error('Sync the backlog first.');
    // in the order they were selected; only open issues
    const open = (list) => [...new Set((list || []).map(Number))].map((n) => data.issues.find((i) => i.number === n)).filter((i) => i?.state === 'open');
    const maxGroup = workspace.readSettings(ws).backlogMaxGroup || workspace.DEFAULT_SETTINGS.backlogMaxGroup;
    const groups = (batches || [{ numbers, group }]).flatMap((b) => {
      const issues = open(b.numbers);
      return b.group ? [issues] : issues.map((i) => [i]);
    }).filter((g) => g.length);
    if (!groups.length) throw new Error('Select at least one open issue.');
    const largest = Math.max(...groups.map((g) => g.length));
    if (largest > maxGroup) throw new Error(`One run takes at most ${maxGroup} issues (Settings › General › Backlog); ${largest} were selected.`);
    const file = path.basename(String(workflow || ''));
    const wf = loadWorkflow(ctx.workflowPath(file).file);
    const chained = normalizeThen(then);
    if (!wf.inputs?.task) throw new Error(`Workflow ${wf.metadata?.name || file} has no task input to receive the issue.`);
    if (runNow && !mock) simulation.refuseReal('real runs from the Backlog');
    // #141's rule: a running roadmap runs a stage in its turn, never on its own; refused before anything is planned
    const current = roadmaps.readRoadmap(ws.backlog, project.id);
    if (runNow && current.state === 'running') throw clientError('The roadmap is running: pause or stop it first, or assign without Run now.');
    const numbersOf = groups.flat().map((i) => i.number);
    // an issue belongs to one plan: assigned here (the screen asked first), it leaves the roadmap's items not started
    roadmaps.dropIssues(ws.backlog, project.id, numbersOf, { alive: ctx.runAlive });
    const before = new Set(current.stages.map((s) => s.id));
    // a pipeline's first stage keeps its workflow's agents (#262: the overrides were chosen for `workflow`)
    const items = groups.map((list) => ({
      workflow: file, workflowName: wf.metadata?.name || file, inputs: inputs || {}, mock: !!mock, then: chained,
      agentOverrides: pipeline ? null : agentOverrides, issues: list.map((i) => i.number),
    }));
    const { roadmap, dropped } = roadmaps.propose(ws.backlog, project.id, [{ name: '', note: '', items }], { issues: data.issues, alive: ctx.runAlive });
    const added = roadmap.stages.find((s) => !before.has(s.id));
    // every issue is in an item already running or finished (propose keeps those): say so, as the PO's add does
    if (!added) throw clientError(`${dropped.map((n) => `#${n}`).join(', ')} ${dropped.length > 1 ? 'are' : 'is'} already planned in the roadmap: nothing was added.`);
    if (allowKeptWork) for (const x of added.items) ctx.allowKeptWork(project.id, x.id);
    if (runNow) return ctx.startRoadmap({ projectId: project.id, simulated: false, stage: added.id });
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

  return {
    afterBacklogRefresh,
    assignWorkflow,
    placeFiledInEpic,
    withIssueRuns,
  };
};
