// Service area: the run lists (Projects › Project and Workflows › Runs). Each run as the lists
// show it: live state, sessions (and whether each opens in its CLI), PR, its artifact count (the
// list itself loads when the row opens: artifacts:list { runId }, #200), and the roadmap run it
// retries (#112: the lists tell the duplicates apart).
//
// The lists come in pages (#200): newest first, the runs in progress (live, or waiting at a gate)
// always in the first page, a run's child runs (#174) in the same page as their parent. The filter
// chips, "Show simulated", the search and the workflow filter (#310: the recorded workflow file)
// apply here, over every run, and the counts are of every run of the picked workflow; `upTo` extends the page to a run (a deep link to an older run); `ids` answers just those rows
// (a run event updates its row). Listing is asynchronous (runs.listRunsAsync, the artifact index).

const runs = require('../../runs');
const projects = require('../../projects');
const backlog = require('../../domains/backlog/backlog');
const roadmaps = require('../../roadmap');
const { artifactIndex } = require('../../run-artifacts');
const { cliReason, sessionView } = require('../common');

const RUN_PAGE = 30;
// The filter chips of the run lists (the renderer's RUN_FILTERS show these counts).
const RUN_FILTERS = {
  all: () => true,
  running: (status) => status === 'running',
  success: (status) => status === 'success',
  failed: (status) => ['failed', 'cancelled', 'interrupted'].includes(status),
};

module.exports = (ctx) => {
  // Each roadmap run started by a retry of its item → the item's run before it; a resume of that
  // run is not a retry. Read once per listing.
  let retryCache = { at: 0, map: new Map() };
  function retryLinks() {
    if (Date.now() - retryCache.at < 2000) return retryCache.map;
    const map = new Map();
    for (const projectId of roadmaps.roadmapProjects(ctx.ws.backlog)) {
      for (const s of roadmaps.readRoadmap(ctx.ws.backlog, projectId).stages || []) {
        for (const x of s.items || []) (x.runs || []).forEach((id, n) => { if (n > 0) map.set(id, x.runs[n - 1]); });
      }
    }
    retryCache = { at: Date.now(), map };
    return map;
  }

  const liveIds = () => new Set([...ctx.active.entries()].filter(([, run]) => run.status === 'running').map(([id]) => id));
  const statusOf = (r) => (ctx.active.get(r.runId)?.status === 'running' ? 'running' : r.status);

  // project: { id, name } of the run's project in Workflows › Runs (undefined in a project's list)
  async function runListItem(r, project) {
    const prev = retryLinks().get(r.runId);
    const retryOf = prev && prev !== r.resumedFrom ? prev : null;
    const run = ctx.active.get(r.runId);
    const current = !!run && run.status === 'running';
    const live = current ? [...run.sessions.values()].map((x) => sessionView(run.snapshot(x), false)) : null;
    // the orchestrator first: its live log is the run's timeline
    const sessions = (live || r.sessions.map((x) => sessionView(x, false))).sort((a, b) => (b.agent === 'orchestrator') - (a.agent === 'orchestrator'));
    const wf = ctx.runWorkflow(current ? r.runId : 'disk', r.file);
    const providers = wf.providers || {};
    const { inputs, ...info } = r;
    let arts = { count: 0, images: 0 };
    try { arts = await artifactIndex(r.runDir); } catch (e) { console.error(`artifacts of ${r.runId}:`, e.message); }
    return {
      ...info,
      ...(project !== undefined ? { project } : {}),
      // { number, url, state, detail, checkedAt }: the state from the cache (null until read, runs:prState)
      pr: ctx.withPrState(run?.pr || r.pr, r.mock),
      // how many files it produced and how many are images; the list: artifacts:list { runId }
      artifactCount: arts.count,
      imageCount: arts.images,
      status: current ? 'running' : r.status,
      // #384: the run that resumed this one, its status as this process sees it
      resumedBy: r.resumedBy ? { ...r.resumedBy, status: statusOf(r.resumedBy) } : null,
      current,
      retryOf,
      passedGates: current ? ctx.passedGates(run) : [],
      // runs recorded before `groups:` take the workflow's current ones
      groups: r.groups || wf.groups || [],
      // a run in progress: the engine's own trail, not events.jsonl
      progress: current ? run.trail.steps : r.progress,
      costUsd: current ? sessions.reduce((a, x) => a + (x.costUsd || 0), 0) : r.costUsd,
      sessions: sessions.map((x) => {
        const why = cliReason(x, providers, current);
        return { ...x, cliAvailable: !why, cliReason: why };
      }),
    };
  }

  function searchText(r, project) {
    const issues = (r.issues || []).map((i) => (i && typeof i === 'object' ? `#${i.number} ${i.title || ''}` : `#${i}`));
    return [r.title, r.task, r.workflow, r.runId, project?.name, ...issues].filter(Boolean).join('\n').toLowerCase();
  }

  // The workflow a run belongs to (#310): the file it ran, as recorded, even when renamed or deleted since.
  const workflowOf = (r) => r.file || r.workflow || '';

  // One page of `all` (newest first): { page: [{ r, project }], total, nextOffset, hasMore, counts, hiddenSim, workflows }.
  // opts: { offset, limit (none: every run), filter, showSim (false: no simulated run), q, workflow
  // (a recorded workflow file; empty: every workflow), upTo }. `workflows`: [{ workflow, count }] of
  // the runs "Show simulated" keeps, whichever workflow is picked (the filter's options, #310).
  function pageOf(all, opts = {}, projectFor = () => undefined) {
    const q = String(opts.q || '').trim().toLowerCase();
    const workflow = String(opts.workflow || '');
    const every = all.map((r) => ({ r, status: statusOf(r), project: projectFor(r) }));
    const items = workflow ? every.filter((x) => workflowOf(x.r) === workflow) : every;
    // the lists' "Show simulated" off: showSim false; unset (the supervisor's list_runs): every run
    const real = opts.showSim === false ? items.filter((x) => !x.r.mock) : items;
    const perWorkflow = new Map();
    for (const x of every) {
      if (opts.showSim === false && x.r.mock) continue;
      const key = workflowOf(x.r);
      if (key) perWorkflow.set(key, (perWorkflow.get(key) || 0) + 1);
    }
    const workflows = [...perWorkflow].map(([file, count]) => ({ workflow: file, count })).sort((a, b) => a.workflow.localeCompare(b.workflow));
    const found = q ? real.filter((x) => searchText(x.r, x.project).includes(q)) : real;
    const counts = Object.fromEntries(Object.entries(RUN_FILTERS).map(([id, fn]) => [id, found.filter((x) => fn(x.status)).length]));
    const fn = RUN_FILTERS[opts.filter] || RUN_FILTERS.all;
    const shown = found.filter((x) => fn(x.status));

    // a child run goes with its parent (when the parent is listed), so nesting survives the paging
    const byId = new Map(shown.map((x) => [x.r.runId, x]));
    const topOf = (x) => {
      let cur = x;
      for (let d = 0; d < 10; d++) {
        const p = cur.r.parentRun?.run_id;
        if (!p || p === cur.r.runId || !byId.has(p)) break;
        cur = byId.get(p);
      }
      return cur;
    };
    const members = new Map();
    for (const x of shown) {
      const top = topOf(x).r.runId;
      (members.get(top) || members.set(top, []).get(top)).push(x);
    }
    const tops = shown.filter((x) => members.has(x.r.runId));
    const pinned = tops.filter((x) => members.get(x.r.runId).some((m) => m.status === 'running'));
    const pinnedIds = new Set(pinned.map((x) => x.r.runId));
    const ordered = [...pinned, ...tops.filter((x) => !pinnedIds.has(x.r.runId))];

    const offset = Math.max(0, Math.floor(+opts.offset) || 0);
    const limit = opts.limit == null ? ordered.length : Math.max(1, Math.floor(+opts.limit) || RUN_PAGE);
    let end = offset + limit;
    if (offset === 0) end = Math.max(end, pinned.length);
    if (opts.upTo && byId.has(opts.upTo)) end = Math.max(end, ordered.indexOf(topOf(byId.get(opts.upTo))) + 1);
    end = Math.min(end, ordered.length);
    return {
      page: ordered.slice(offset, end).flatMap((t) => members.get(t.r.runId)),
      total: ordered.length,
      nextOffset: end,
      hasMore: end < ordered.length,
      counts,
      hiddenSim: items.length - real.length,
      workflows,
    };
  }

  async function projectRuns({ id, ...opts } = {}) {
    const project = projects.listProjects(ctx.ws.projects).find((p) => p.id === id);
    if (!project) throw new Error(`Project not found: ${id}`);
    const all = runs.runsForProject(await runs.listRunsAsync(ctx.ws.runs, { live: liveIds() }), project);
    const { page, ...rest } = pageOf(all, opts);
    return { project, local: backlog.readLocal(ctx.ws.backlog, project.id), ...rest, runs: await Promise.all(page.map((x) => runListItem(x.r))) };
  }

  // The runs of every project, each with the project it belongs to: one page (opts above), every run
  // without `limit`, or just the rows of `ids`.
  async function listAllRuns(opts = {}) {
    const projectList = projects.listProjects(ctx.ws.projects);
    const projectFor = (r) => {
      const owner = runs.projectOf(r, projectList);
      return owner ? { id: owner.id, name: owner.name } : null;
    };
    if (Array.isArray(opts.ids)) {
      const list = opts.ids.map((id) => runs.findRun(ctx.ws.runs, id, { live: liveIds() })).filter(Boolean);
      return { runs: await Promise.all(list.map((r) => runListItem(r, projectFor(r)))) };
    }
    const all = await runs.listRunsAsync(ctx.ws.runs, { live: liveIds() });
    const { page, ...rest } = pageOf(all, opts, projectFor);
    return { ...rest, runs: await Promise.all(page.map((x) => runListItem(x.r, x.project))) };
  }

  return {
    listAllRuns,
    projectRuns,
  };
};
