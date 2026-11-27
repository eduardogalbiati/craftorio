// Service area: a project's Backlog (packages/engine/domains/backlog/backlog.js). The synced issues with their runs,
// roadmap stage and local status; Assign (plans issues for a workflow in the roadmap as a new last
// stage, alone or as one group item, with an optional chain #134 and "Run now" #446); the issue
// tracker's epic placement after a run filed issues (#138); the Backlog Refresh banner and the sync
// after a refresh run (#161, packages/engine/domains/backlog/backlog-refresh.js). "Create and plan" is a chain
// (packages/engine/service/areas/chain.js). A run's end files its drafts into the local backlog (#35, fileRunLocally)
// and closes the local issues it merged (#73, closeMergedIssues).

const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const simulation = require('../../engine/simulation');
const workspace = require('../../domains/workspace/workspace');
const projects = require('../../domains/project/projects');
const backlog = require('../../domains/backlog/backlog');
const localIssues = require('../../domains/backlog/local-backlog');
const { render } = require('../../engine/run/templates');
const { namesOf } = require('@craftorio/shared/default-workflow');
const baseHealth = require('../../domains/project/base-health');
const refreshes = require('../../domains/backlog/backlog-refresh');
const { git } = require('../../engine/worktree');
const epics = require('../../domains/backlog/epics');
const { awaitsOwner } = require('../../domains/backlog/issue-author');
const roadmaps = require('../../domains/roadmap/roadmap');
const { normalizeThen } = require('@craftorio/shared/chain-model');
const { platformOrDefault } = require('@craftorio/shared/platforms');
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
    // #35: a local issue the sync renumbered (local-backlog.js renumberedFrom) keeps the runs started for its
    // earlier number (a link with no url) and its Discovery card; the platform's issue with that number gets neither
    const moved = localIssues.renumberedFrom(data.issues);
    const follow = (a) => (a && !a.url && moved.has(Number(a.number)) ? { ...a, number: moved.get(Number(a.number)) } : a);
    const live = list.map((r) => {
      const run = ctx.active.get(r.runId);
      const pr = ctx.withPrState(run?.pr || r.pr, r.mock); // the card's PR icon (#84)
      const linked = moved.size ? { ...r, ...(Array.isArray(r.issues) ? { issues: r.issues.map(follow) } : {}), ...(r.issue ? { issue: follow(r.issue) } : {}) } : r;
      return run ? { ...linked, status: 'running', waiting: run.approvals.size > 0, pr } : { ...linked, pr };
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
    // badge); the card store is the discovery channels' (packages/engine/fronts/plan/channels/discovery.js)
    const cards = new Map();
    for (const [number, card] of ctx.discoveryIssueCards?.(data.projectId) || new Map()) {
      if (moved.has(number)) cards.set(moved.get(number), card);
      else if (!cards.has(number)) cards.set(number, card);
    }
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
    // #105: without a local push status, a local backlog (no repository) keeps its `local: true`
    return { ...synced, local: local || (synced.local === true ? true : null), roadmap, refresh, autoEpic: !!project?.autoEpic, issues, releases, conflictMap, baseFailures, baseCheck };
  }

  // The Backlog Refresh banner (#161, packages/engine/domains/backlog/backlog-refresh.js): the merges on the base since the
  // last refresh (with none, since the project was added, #784) are counted (first-parent commits:
  // merges and squashes) only when it is stale; `refreshed`: the issues that refresh updated, for a day.
  function refreshBanner(project, list, local) {
    const { ws } = ctx;
    const hours = workspace.readSettings(ws).backlogRefreshHours;
    const { last } = refreshes.refreshRuns(list);
    const baseline = refreshes.refreshBaseline(list, project?.createdAt);
    const stale = baseline && Number(hours) > 0 && Date.now() - Date.parse(baseline) >= Number(hours) * 3600e3;
    const count = stale && project?.folder ? mergeCount(project, baseline, local?.base || 'HEAD') : null;
    const state = refreshes.refreshState({
      runs: list, intervalHours: hours, merges: count == null ? null : Number(count), addedAt: project?.createdAt || null, dismissedOn: project ? refreshes.readDismissed(ws.backlog, project.id) : null,
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
  // pipeline is each run's then. runNow: the new stage starts on its own (#141's "Run this stage"); #805 `ask`: a
  // person is there (backlog:assign), so a local base behind origin is asked about, as roadmap:start does.
  // `batches` (a chain's produced issues, chain-model queueBatches): [{ numbers, group }], one item each.
  async function assignWorkflow({ projectId, numbers, workflow, inputs, mock, group = false, allowKeptWork = false, then = null, pipeline = null, agentOverrides = null, runNow = false, batches = null, ask = false }) {
    if (pipeline) {
      const first = ctx.pipelineAssign(pipeline, projectId);
      ({ workflow, then } = first);
      inputs = { ...first.inputs, ...(inputs || {}) };
    }
    const { ws } = ctx;
    const project = projects.readProject(ws.projects, path.basename(String(projectId)));
    // #35: a project with no repository plans from its local backlog
    const data = backlog.projectBacklog(ws.backlog, project);
    if (!data) throw new Error('Sync the backlog first.');
    // in the order they were selected; only open issues
    const open = (list) => [...new Set((list || []).map(Number))].map((n) => data.issues.find((i) => i.number === n)).filter((i) => i?.state === 'open');
    const maxGroup = workspace.readSettings(ws).backlogMaxGroup || workspace.DEFAULT_SETTINGS.backlogMaxGroup;
    const groups = (batches || [{ numbers, group }]).flatMap((b) => {
      const issues = open(b.numbers);
      return b.group ? [issues] : issues.map((i) => [i]);
    }).filter((g) => g.length);
    if (!groups.length) throw new Error('Select at least one open issue.');
    // #90: propose leaves an outside issue the owner has not approved out: refuse it here, so none goes missing
    const waiting = groups.flat().filter(awaitsOwner).map((i) => `#${i.number}`);
    if (waiting.length) throw clientError(`${waiting.join(', ')} came from outside the project: approve ${waiting.length > 1 ? 'them' : 'it'} in the Backlog first. Nothing was assigned.`);
    const largest = Math.max(...groups.map((g) => g.length));
    if (largest > maxGroup) throw new Error(`One run takes at most ${maxGroup} issues (Settings › General › Backlog); ${largest} were selected.`);
    const file = path.basename(String(workflow || ''));
    const wf = loadWorkflow(ctx.projectWorkflowFile(project.id, file));
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
    const answer = runNow ? await ctx.startRoadmap({ projectId: project.id, simulated: false, stage: added.id, ask }) : null;
    // #805: the stage is planned; its Start waits for the person's answer on the Roadmap (`stage`: the one to start)
    if (answer?.confirm) return { ...withIssueRuns(backlog.projectBacklog(ws.backlog, project)), ...answer, stage: added.id };
    return runNow ? answer : withIssueRuns(backlog.projectBacklog(ws.backlog, project));
  }

  // Issue tracker (#81) and epics (#138): the created issues join the existing epic the analyzer
  // matched clearly, only when the project's autoEpic option ("Auto-place new issues") is on and the
  // epic is in the synced backlog. Never creates an epic; a simulated run places nothing.
  async function placeFiledInEpic(run, ev) {
    const { ws } = ctx;
    const plan = epics.filedToEpic({ workflow: run.wf.metadata?.name, status: ev.status, steps: run.ctx.steps });
    if (!plan || !run.projectId || run.mock) return;
    const project = projects.readProject(ws.projects, run.projectId);
    // #35: a local backlog has no epics on a platform
    if (!project?.autoEpic || !project.repo) return;
    const platform = platformOrDefault(run.inputs.git_platform).id;
    const synced = await backlog.syncBacklog({ dir: ws.backlog, project, platform });
    const list = synced?.epics || backlog.readBacklog(ws.backlog, project.id)?.epics || [];
    if (!list.some((e) => e.id === plan.epic)) return;
    await epics.applyEpic({ platform, repo: project.repo, epic: { id: plan.epic }, issues: plan.numbers, epics: list });
    await backlog.syncBacklog({ dir: ws.backlog, project, platform });
  }

  // #35: the issue workflow's run on a project with no remote (its filer ran nothing, workflows/issue.yaml):
  // the approved drafts go into the local backlog, and the run's `issues` output names them, so "Create and
  // plan" plans them as it does a platform's. A simulated run files nothing, as for a repository.
  function fileRunLocally(run, ev) {
    if (!run.projectId || run.mock || ev.status !== 'success' || !namesOf('issue.yaml').includes(run.wf.metadata?.name)) return;
    const { ws } = ctx;
    const project = projects.readProject(ws.projects, run.projectId);
    if (!project || project.repo) return;
    const filed = localIssues.fileRunDrafts(ws.backlog, project.id, run.ctx.steps);
    if (!filed.length) return;
    const issues = JSON.parse(render('{{ filed | filed_issues(analysis) | to_json }}', { filed, analysis: run.ctx.steps.analyze?.output }));
    ev.outputs = { ...(ev.outputs || {}), issues };
    ctx.events?.emit('backlog:changed', { projectId: project.id, file: 'local-issues', watching: !!ctx.backlogWatching?.() });
  }

  // #73: a run that merged locally and ended well closes the local issues it was started for (no push ever does).
  // Only at its end: a run that merged and then failed or was stopped closes none, a simulated run merges nothing,
  // and an issue a person reopened since stays open until a new run on it merges.
  function closeMergedIssues(run, ev) {
    const commit = run.ctx.local_merge?.commit;
    if (!run.projectId || run.mock || ev.status !== 'success' || !commit) return;
    const closed = localIssues.closeMergedLocalIssues(ctx.ws.backlog, run.projectId, backlog.runIssues(run), { runId: run.runId, commit });
    if (closed.length) ctx.events?.emit('backlog:changed', { projectId: run.projectId, file: 'local-issues', watching: !!ctx.backlogWatching?.() });
  }

  return {
    afterBacklogRefresh,
    assignWorkflow,
    closeMergedIssues,
    fileRunLocally,
    placeFiledInEpic,
    withIssueRuns,
  };
};
