// Backlog screen: a project's issues (the last sync, instant, and a new sync with gh/glab, each
// issue with the runs working on it), the assignment queue and the local merges not pushed.

const path = require('path');
const backlog = require('../../backlog');
const projects = require('../../projects');
const workspace = require('../../workspace');

module.exports = (ctx) => {
  const project = (projectId) => path.basename(String(projectId));
  const current = (projectId) => ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, projectId));
  return [
    { channel: 'backlog:get', method: 'getBacklog', params: ['projectId'], fn: ({ projectId }) => current(projectId) },
    // a sync also checks the local commits not pushed (fetching origin/<base>)
    {
      channel: 'backlog:sync',
      method: 'syncBacklog',
      params: ['projectId', 'platform'],
      fn: async ({ projectId, platform }) => {
        const [data] = await Promise.all([
          backlog.syncBacklog({
            dir: ctx.ws.backlog,
            project: projects.readProject(ctx.ws.projects, project(projectId)),
            platform: platform || workspace.readSettings(ctx.ws).backlogPlatform,
          }),
          ctx.refreshLocal(projectId).catch((e) => console.error('local status:', e.message)),
        ]);
        return ctx.withIssueRuns(data);
      },
    },
    // Local merges not pushed: check again (fetch), push the base, or rebase it onto origin and push.
    // Each returns { pushed?, rejected?, conflict?, files?, error?, commits?, issues?, local, backlog }.
    {
      channel: 'backlog:local',
      method: 'checkLocal',
      params: ['projectId'],
      fn: async ({ projectId }) => ({ local: await ctx.refreshLocal(projectId), backlog: current(projectId) }),
    },
    { channel: 'backlog:push', method: 'pushLocal', params: ['projectId'], fn: ({ projectId }) => ctx.pushProject({ projectId }) },
    { channel: 'backlog:update-push', method: 'updateAndPushLocal', params: ['projectId'], fn: ({ projectId }) => ctx.pushProject({ projectId, update: true }) },
    // A conflict of Update and push handed to a run of the local workflow (returns { runId, runDir }).
    {
      channel: 'backlog:resolve-push',
      method: 'resolvePushConflict',
      params: ['projectId', 'files', 'mock'],
      fn: ({ projectId, files, mock }) => ctx.resolvePushConflict({ projectId, files, mock }),
    },
    {
      channel: 'backlog:auto-push',
      method: 'setAutoPush',
      params: ['projectId', 'on'],
      fn: ({ projectId, on }) => projects.updateProject(ctx.ws.projects, project(projectId), { autoPush: !!on }),
    },
    { channel: 'backlog:unpushed', method: 'listUnpushed', fn: () => ctx.unpushedProjects() },
    // Assign a workflow to issues: they are queued and start while there are free run slots (see dispatchQueue).
    {
      channel: 'backlog:assign',
      method: 'assignWorkflow',
      params: ['projectId', 'numbers', 'workflow', 'inputs', 'mock', 'group'],
      fn: (opts) => ctx.assignWorkflow(opts),
    },
    // cancelGroup: an issue of a group takes the whole group out (else it only leaves the group)
    {
      channel: 'backlog:unqueue',
      method: 'unqueueIssue',
      params: ['projectId', 'number', 'cancelGroup'],
      fn: async ({ projectId, number, cancelGroup }) => {
        backlog.unqueue(ctx.ws.backlog, project(projectId), Number(number), { cancelGroup: !!cancelGroup });
        return current(projectId);
      },
    },
    {
      channel: 'backlog:pause',
      method: 'pauseQueue',
      params: ['projectId', 'paused'],
      fn: async ({ projectId, paused }) => {
        backlog.setPaused(ctx.ws.backlog, project(projectId), !!paused);
        if (!paused) await ctx.dispatchQueue();
        return current(projectId);
      },
    },
  ];
};
