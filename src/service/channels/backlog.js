// Backlog screen: a project's issues (the last sync, instant, and a new sync with gh/glab, each
// issue with the runs working on it), the assignment queue and the local merges not pushed, and
// saving a Write & Review document back to its issue, archiving and restoring issues (#238).

const path = require('path');
const backlog = require('../../backlog');
const refreshes = require('../../backlog-refresh');
const simulation = require('../../engine/simulation');
const projects = require('../../projects');
const runs = require('../../runs');
const workspace = require('../../workspace');

module.exports = (ctx) => {
  const project = (projectId) => path.basename(String(projectId));
  const current = (projectId) => ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, projectId));
  // where a platform write goes: the synced backlog's platform and repository (else the project's);
  // simulation-only, or `simulate` (scripts/screenshot.js), answers every CLI call with nothing
  const platformTarget = (projectId, simulate) => {
    const data = backlog.readBacklog(ctx.ws.backlog, projectId);
    const proj = projects.listProjects(ctx.ws.projects).find((p) => p.id === projectId);
    return {
      platform: data?.platform || workspace.readSettings(ctx.ws).backlogPlatform || backlog.DEFAULT_PLATFORM,
      repo: data?.repo || proj?.repo,
      ...(simulate || simulation.simulationOnly() ? { exec: async () => '' } : {}),
    };
  };
  return [
    { channel: 'backlog:get', method: 'getBacklog', params: ['projectId'], fn: ({ projectId }) => current(projectId) },
    // the Backlog Refresh banner's "Dismiss for today" (#161, src/backlog-refresh.js)
    {
      channel: 'backlog:dismiss-refresh',
      method: 'dismissBacklogRefresh',
      params: ['projectId'],
      fn: ({ projectId }) => {
        refreshes.dismiss(ctx.ws.backlog, project(projectId));
        return current(project(projectId));
      },
    },
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
    // #138: a new issue the Product Owner registers joins the epic it clearly matches (no extra click)
    {
      channel: 'backlog:auto-epic',
      method: 'setAutoEpic',
      params: ['projectId', 'on'],
      fn: ({ projectId, on }) => projects.updateProject(ctx.ws.projects, project(projectId), { autoEpic: !!on }),
    },
    { channel: 'backlog:unpushed', method: 'listUnpushed', fn: () => ctx.unpushedProjects() },
    // #204: a backlog/ file changed ({ projectId, file, watching }, areas/backlog-watch.js); watching:
    // false = the watcher failed, the screen polls while visible
    { event: 'backlog:changed', method: 'onBacklogChanged' },
    { channel: 'backlog:watching', method: 'backlogWatching', fn: () => ctx.backlogWatching() },
    // Assign a workflow to issues: they are queued and start while there are free run slots (see dispatchQueue).
    // When an ended run kept work for them, the answer is the kept-work question { confirm, kept, runId }
    // (nothing queued) until `confirmed` (#170: Start from scratch).
    {
      channel: 'backlog:assign',
      method: 'assignWorkflow',
      // then: what happens with each run's result when it finishes (#134); pipeline: a saved
      // pipeline's file (#135), whose first workflow and chain replace `workflow` and `then`;
      // agentOverrides: each run's provider / model / effort per agent (#262, run:start's)
      params: ['projectId', 'numbers', 'workflow', 'inputs', 'mock', 'group', 'confirmed', 'then', 'pipeline', 'agentOverrides'],
      fn: ({ confirmed, ...opts }) => {
        const kept = confirmed ? null : ctx.keptWorkForIssues(opts.numbers);
        if (kept) return { confirm: kept.text, kept, runId: kept.runId };
        return ctx.assignWorkflow({ ...opts, allowKeptWork: !!confirmed });
      },
    },
    // Save to issue (#103): a Write & Review run started from an issue saves its accepted document
    // back to it (mode: replace | comment). The owner confirms in the screen; agents never call this.
    // `preview`, a simulated run or simulation-only never call gh/glab. Returns saveRunToIssue's result
    // plus the backlog after a save (the issue read again).
    {
      channel: 'backlog:save-doc',
      method: 'saveDocToIssue',
      params: ['runId', 'mode', 'preview'],
      fn: async ({ runId, mode, preview }) => {
        const run = runs.readRun(ctx.ws.runs, path.basename(String(runId)));
        if (!run) throw new Error(`Run not found: ${runId}`);
        if (ctx.active.has(run.runId)) throw new Error('The run is still in progress: save its document once it is accepted.');
        if (!preview && !run.mock) simulation.refuseReal('a save to GitHub/GitLab');
        const data = run.projectId ? backlog.readBacklog(ctx.ws.backlog, run.projectId) : null;
        const proj = run.projectId ? projects.listProjects(ctx.ws.projects).find((p) => p.id === run.projectId) : null;
        const number = backlog.runIssues(run)[0]?.number;
        const res = await backlog.saveRunToIssue({
          run, mode, preview: !!preview,
          platform: data?.platform || workspace.readSettings(ctx.ws).backlogPlatform || backlog.DEFAULT_PLATFORM,
          repo: data?.repo || proj?.repo,
          cached: (data?.issues || []).find((i) => i.number === number) || null,
          dir: ctx.ws.backlog, projectId: run.projectId,
        });
        return { ...res, backlog: res.saved && data ? current(run.projectId) : null };
      },
    },
    // Archive (#238): close issues as not planned with the `archived` label (refused for an issue
    // planned in the roadmap or with a run in progress), or restore them. The owner confirms in the
    // screen; agents never call this. Simulation-only never calls gh/glab: the change is only recorded
    // in the synced backlog. Both answer { results: [{ number, ok, error? }], backlog }.
    {
      channel: 'backlog:archive',
      method: 'archiveIssues',
      params: ['projectId', 'numbers'],
      fn: async ({ projectId, numbers, simulate }) => {
        const id = project(projectId);
        const { results } = await backlog.archiveIssues({ ...platformTarget(id, simulate), numbers, issues: current(id)?.issues || [], dir: ctx.ws.backlog, projectId: id });
        return { results, backlog: current(id) };
      },
    },
    {
      channel: 'backlog:restore',
      method: 'restoreIssues',
      params: ['projectId', 'numbers'],
      fn: async ({ projectId, numbers, simulate }) => {
        const id = project(projectId);
        const { results } = await backlog.restoreIssues({ ...platformTarget(id, simulate), numbers, dir: ctx.ws.backlog, projectId: id });
        return { results, backlog: current(id) };
      },
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
    // Resuming a queue whose next item would redo an ended run's kept work answers the kept-work
    // question { confirm, kept, runId } (the queue stays paused) until `confirmed` (#170).
    {
      channel: 'backlog:pause',
      method: 'pauseQueue',
      params: ['projectId', 'paused', 'confirmed'],
      fn: async ({ projectId, paused, confirmed }) => {
        const head = paused ? null : backlog.readQueue(ctx.ws.backlog, project(projectId)).items[0];
        if (head) {
          const issues = backlog.itemIssues(head);
          const kept = confirmed ? null : ctx.keptWorkForIssues(issues);
          if (kept) return { ...current(projectId), confirm: kept.text, kept, runId: kept.runId };
          if (confirmed) ctx.allowQueuedKeptWork(project(projectId), issues);
        }
        backlog.setPaused(ctx.ws.backlog, project(projectId), !!paused);
        if (!paused) await ctx.dispatchQueue();
        return current(projectId);
      },
    },
  ];
};
