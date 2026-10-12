// Service area: the conflict map (#150, src/conflict-map.js). Rebuilt in the background after a real
// run of a git project merges (locally or through its PR), so the Product Owner's next plan reads it;
// a failure is logged and never touches the run. The Backlog reads the saved map as it is.

const path = require('path');
const conflictMap = require('../../conflict-map');
const projects = require('../../projects');
const runs = require('../../runs');
const { storeFor } = require('../../store');

module.exports = (ctx) => {
  // Rebuilds the project's map after `run` finished with a merge (`ev`: its workflow.finished event).
  async function afterRunConflictMap(run, ev) {
    if (run.mock || !run.projectId || ev?.status !== 'success') return null;
    const project = projects.readProject(ctx.ws.projects, path.basename(String(run.projectId)));
    if (!project?.isGit) return null;
    // the run's summary may not say it finished yet: its event does
    const list = runs.runsForProject(runs.listRuns(ctx.ws.runs), project)
      .map((r) => (r.runId === run.runId ? { ...r, status: ev.status, finishedAt: r.finishedAt || ev.ts || new Date().toISOString() } : r));
    const mine = list.find((r) => r.runId === run.runId);
    if (!mine?.localMerge?.commit && !mine?.pr?.number) return null;
    return conflictMap.updateConflictMap({ backlogDir: ctx.ws.backlog, projectId: project.id, runs: list, repo: project.folder, store: storeFor(ctx.ws.runs) });
  }

  // The saved map of a project for the Backlog (null when there is none yet).
  const savedConflictMap = (projectId) => conflictMap.readConflictMap(ctx.ws.backlog, path.basename(String(projectId)));

  return {
    afterRunConflictMap,
    savedConflictMap,
  };
};
