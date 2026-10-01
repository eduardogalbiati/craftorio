// Service area: the run lists (Projects › Project and Workflows › Runs). Each run as the lists
// show it: live state, sessions (and whether each opens in its CLI), PR, artifacts, and the
// roadmap run it retries (#112: the lists tell the duplicates apart).

const runs = require('../../runs');
const projects = require('../../projects');
const backlog = require('../../backlog');
const roadmaps = require('../../roadmap');
const { cliReason, sessionView } = require('../common');

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

  function runListItem(r) {
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
    return {
      ...info,
      // { number, url, state, detail, checkedAt }: the state from the cache (null until read, runs:prState)
      pr: ctx.withPrState(run?.pr || r.pr, r.mock),
      artifacts: runs.runArtifacts(r.runDir),
      status: current ? 'running' : r.status,
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

  function projectRuns({ id }) {
    const project = projects.listProjects(ctx.ws.projects).find((p) => p.id === id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return { project, local: backlog.readLocal(ctx.ws.backlog, project.id), runs: runs.runsForProject(runs.listRuns(ctx.ws.runs), project).map(runListItem) };
  }

  // Every run, with the project it belongs to.
  function listAllRuns() {
    const projectList = projects.listProjects(ctx.ws.projects);
    return {
      runs: runs.listRuns(ctx.ws.runs).map((r) => {
        const owner = runs.projectOf(r, projectList);
        return { ...runListItem(r), project: owner ? { id: owner.id, name: owner.name } : null };
      }),
    };
  }

  return {
    listAllRuns,
    projectRuns,
  };
};
