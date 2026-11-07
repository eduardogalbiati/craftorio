// Service area: the PRs / MRs screen (#812, channels/pulls.js). The open pull/merge requests of the header's
// project (or of every project), read with gh / glab through run-pr.js listPulls (no LLM), each with the run that
// opened it, and Merge / Close from the list. host.readPrJson stands in for the reads and host.runPrCommand for the
// merge and the close (tests, UI checks); without them the CLIs run. A PR whose live run waits in its PR monitor
// merges and closes through that run (areas/runs.js mergeRunPr / closeRunPr: the run records it); any other one
// through run-pr.js mergePr / closePr, which read it again first and refuse what the card should not have offered.
// The list itself refuses a merge it does not offer (a stack's PR above the bottom one).

const projects = require('../../domains/project/projects');
const runs = require('../../domains/run/runs');
const runPr = require('../../domains/run/run-pr');
const machineActions = require('../../engine/machine-actions');
const { clientError } = require('../common');

module.exports = (ctx) => {
  const { host } = ctx;
  const reader = () => host?.readPrJson || undefined;
  // with the host's reader the CLI is not needed (the E2E machine may have no gh)
  const hasCli = () => (host?.readPrJson ? () => true : undefined);
  const runner = (cli, args) => (host?.runPrCommand ? host.runPrCommand(cli, args) : machineActions.real().prCommand({ cli, args }));

  const projectList = (projectId) => projects.listProjects(ctx.ws.projects).filter((p) => !projectId || p.id === projectId);

  async function listPullRequests({ projectId } = {}) {
    const list = projectList(projectId);
    const answer = await runPr.listPulls(list, { reader: reader(), runs: runs.listRuns(ctx.ws.runs), hasCli: hasCli() });
    return { projects: answer.map((p, i) => ({ ...p, name: list[i]?.name || p.projectId })) };
  }

  // the listed PR `url` of a project (read again: the screen's list may be old) → its entry
  async function listed(projectId, url) {
    if (!projectList(projectId).length) throw clientError(`Project ${projectId} does not exist.`);
    const [project] = (await listPullRequests({ projectId })).projects;
    if (project.error) throw clientError(`The pull requests of ${project.name} cannot be read: ${project.error}`);
    const entry = Object.values(project.groups).flat().find((p) => p.url === url);
    if (!entry) throw clientError(`${url} is not an open pull request of ${project.name}.`);
    return entry;
  }

  // the live run waiting in this PR's monitor, if any
  const waitingRun = (entry) => {
    const run = entry.runId ? ctx.liveRun?.(entry.runId) : null;
    return run?.prMonitorTarget?.() ? run : null;
  };

  async function mergePullRequest({ projectId, url, admin = false } = {}) {
    const entry = await listed(projectId, url);
    if (waitingRun(entry)) return ctx.mergeRunPr({ runId: entry.runId, admin: !!admin });
    const o = entry.mergeOptions || {};
    if (!(admin ? o.bypass : o.merge)) {
      const above = Number(entry.stack?.position) > 1;
      return { merged: false, blockers: o.blockers || [], error: above ? 'stacked: merge the pull requests below it first' : `blocked: ${(o.blockers || []).join(', ') || 'not mergeable'}` };
    }
    const rights = await runPr.readMergeRights({ url }, { reader: reader() });
    const r = await runPr.mergePr({ url }, { admin: !!admin, ...rights, reader: reader(), run: runner });
    return { merged: !!r.merged, ...(r.commit ? { commit: r.commit } : {}), ...(r.error ? { error: r.error } : {}), ...(r.blockers ? { blockers: r.blockers } : {}) };
  }

  async function closePullRequest({ projectId, url } = {}) {
    const entry = await listed(projectId, url);
    if (waitingRun(entry)) return ctx.closeRunPr({ runId: entry.runId });
    if (!entry.mergeOptions?.close) return { closed: false, error: 'the pull request cannot be closed from the app' };
    const r = await runPr.closePr({ url }, { run: runner });
    return { closed: !!r.closed, ...(r.error ? { error: r.error } : {}) };
  }

  return { closePullRequest, listPullRequests, mergePullRequest };
};
