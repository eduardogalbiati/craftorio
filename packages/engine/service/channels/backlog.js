// Backlog screen: a project's issues (the last sync, instant, and a new sync with gh/glab, each
// issue with the runs working on it), the assignment queue and the local merges not pushed, and
// saving a Write & Review document back to its issue, archiving and restoring issues (#238).

const path = require('path');
const backlog = require('../../domains/backlog/backlog');
const refreshes = require('../../domains/backlog/backlog-refresh');
const simulation = require('../../engine/simulation');
const projects = require('../../domains/project/projects');
const runs = require('../../domains/run/runs');
const workspace = require('../../domains/workspace/workspace');
const { clientError, requireId } = require('../common');
const {
  ANY,
  args,
  BACKLOG,
  BOOL,
  described,
  FLAG,
  ISSUE_NUMBER,
  listOf,
  nullable,
  OBJECT,
  orNone,
  PIPELINE_FILE,
  PROJECT_ID,
  RUN_ID,
  shape,
  STARTED,
  STRING,
  WORKFLOW_FILE,
} = require('../schemas');

const ON_PROJECT = args({ projectId: PROJECT_ID }, ['projectId']);
// a local push's answer: { pushed?, rejected?, conflict?, files?, error?, commits?, issues?, local, backlog }
const PUSHED = shape({ local: nullable(OBJECT), backlog: BACKLOG });
const NUMBERS = listOf(ISSUE_NUMBER);
// archive and restore: one result per issue, and the Backlog after them
const PER_ISSUE = shape({ results: listOf(shape({ number: ISSUE_NUMBER, ok: BOOL, error: ANY }, ['ok'])), backlog: BACKLOG }, ['results']);

module.exports = (ctx) => {
  const project = (projectId) => path.basename(String(projectId));
  const current = (projectId) => ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, projectId));
  // where a platform write goes: the synced backlog's platform and repository (else the project's);
  // simulation-only, or `simulate` (scripts/screenshot.js), answers every CLI call with nothing
  const platformTarget = (projectId, simulate) => {
    const data = backlog.readBacklog(ctx.ws.backlog, projectId);
    const proj = projects.listProjects(ctx.ws.projects).find((p) => p.id === projectId);
    return {
      platform: backlog.platformOf(proj, data?.platform || workspace.readSettings(ctx.ws).backlogPlatform),
      repo: data?.repo || proj?.repo,
      ...(simulate || simulation.simulationOnly() ? { exec: async () => '' } : {}),
    };
  };
  return [
    { channel: 'backlog:get', method: 'getBacklog', params: ['projectId'], schema: { params: ON_PROJECT, result: BACKLOG }, fn: ({ projectId }) => current(projectId) },
    // #491: the Roadmap's live reloads read only what changes while runs go (packages/engine/domains/backlog/backlog.js backlogState)
    {
      channel: 'backlog:state',
      method: 'getBacklogState',
      params: ['projectId'],
      schema: {
        params: ON_PROJECT,
        result: described(nullable(OBJECT), 'The light state: { projectId, roadmap: { state, updatedAt, scope, pausedBy, error, stages: [{ id, pause, items: [{ id, status, runId, runs, waiting, startedAt, elapsed, run? }] }] }, queue, refresh, baseCheck }; no issue bodies.'),
      },
      fn: ({ projectId }) => backlog.backlogState(current(projectId)),
    },
    // the Backlog Refresh banner's "Dismiss for today" (#161, packages/engine/domains/backlog/backlog-refresh.js)
    {
      channel: 'backlog:dismiss-refresh',
      method: 'dismissBacklogRefresh',
      params: ['projectId'],
      schema: { params: ON_PROJECT, result: BACKLOG },
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
      schema: { params: args({ projectId: PROJECT_ID, platform: nullable(STRING) }, ['projectId']), result: BACKLOG },
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
      schema: { params: ON_PROJECT, result: PUSHED },
      fn: async ({ projectId }) => ({ local: await ctx.refreshLocal(projectId), backlog: current(projectId) }),
    },
    { channel: 'backlog:push', method: 'pushLocal', params: ['projectId'], schema: { params: ON_PROJECT, result: PUSHED }, fn: ({ projectId }) => ctx.pushProject({ projectId }) },
    { channel: 'backlog:update-push', method: 'updateAndPushLocal', params: ['projectId'], schema: { params: ON_PROJECT, result: PUSHED }, fn: ({ projectId }) => ctx.pushProject({ projectId, update: true }) },
    // A conflict of Update and push handed to a run of the local workflow (returns { runId, runDir }).
    {
      channel: 'backlog:resolve-push',
      method: 'resolvePushConflict',
      params: ['projectId', 'files', 'mock'],
      schema: { params: args({ projectId: PROJECT_ID, files: nullable(listOf(STRING)), mock: FLAG }, ['projectId']), result: STARTED },
      fn: ({ projectId, files, mock }) => ctx.resolvePushConflict({ projectId, files, mock }),
    },
    // #138: a new issue the Product Owner registers joins the epic it clearly matches (no extra click)
    {
      channel: 'backlog:auto-epic',
      method: 'setAutoEpic',
      params: ['projectId', 'on'],
      schema: { params: args({ projectId: PROJECT_ID, on: FLAG }, ['projectId']), result: OBJECT },
      fn: ({ projectId, on }) => projects.updateProject(ctx.ws.projects, project(projectId), { autoEpic: !!on }),
    },
    { channel: 'backlog:unpushed', method: 'listUnpushed', schema: { result: listOf(OBJECT) }, fn: () => ctx.unpushedProjects() },
    // #204: a backlog/ file changed ({ projectId, file, watching }, areas/backlog-watch.js); watching:
    // false = the watcher failed, the screen polls while visible
    { event: 'backlog:changed', method: 'onBacklogChanged' },
    // #465: the base check (#405) started or ended ({ projectId, status: waiting | running | green | red | error,
    // commit, log, startedAt, endedAt, failures, error, message, holder }, areas/base-health.js; #527:
    // waiting = for the machine's suite slot); its log opens in a 'base-check' terminal
    { event: 'baseCheck:changed', method: 'onBaseCheckChanged' },
    {
      channel: 'baseCheck:state',
      method: 'getBaseCheckState',
      params: ['projectId'],
      schema: { params: ON_PROJECT, result: described(nullable(OBJECT), 'The project\'s base check as last announced, null when none ran since the engine started.') },
      fn: ({ projectId }) => ctx.baseCheckState(project(projectId)),
    },
    { channel: 'backlog:watching', method: 'backlogWatching', schema: { result: BOOL }, fn: () => ctx.backlogWatching() },
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
      schema: {
        params: args({
          projectId: PROJECT_ID,
          numbers: NUMBERS,
          workflow: orNone(WORKFLOW_FILE),
          inputs: nullable(OBJECT),
          mock: FLAG,
          group: ANY,
          confirmed: FLAG,
          then: ANY,
          pipeline: orNone(PIPELINE_FILE),
          agentOverrides: nullable(OBJECT),
        }, ['projectId']),
        result: described(BACKLOG, 'The Backlog with the issues queued, or the kept-work question { confirm, kept, runId } (nothing queued).'),
      },
      fn: ({ confirmed, ...opts }) => {
        if (opts.numbers != null && !Array.isArray(opts.numbers)) throw clientError('Invalid issue numbers: expected a list.');
        if (opts.pipeline != null && opts.pipeline !== '') requireId(opts.pipeline, 'pipeline file');
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
      schema: { params: args({ runId: RUN_ID, mode: { enum: ['replace', 'comment'] }, preview: FLAG }, ['runId']), result: shape({ backlog: BACKLOG }) },
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
          platform: backlog.platformOf(proj, data?.platform || workspace.readSettings(ctx.ws).backlogPlatform),
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
      schema: { params: args({ projectId: PROJECT_ID, numbers: NUMBERS, simulate: FLAG }, ['projectId']), result: PER_ISSUE },
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
      schema: { params: args({ projectId: PROJECT_ID, numbers: NUMBERS, simulate: FLAG }, ['projectId']), result: PER_ISSUE },
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
      schema: { params: args({ projectId: PROJECT_ID, number: ISSUE_NUMBER, cancelGroup: FLAG }, ['projectId']), result: BACKLOG },
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
      schema: { params: args({ projectId: PROJECT_ID, paused: FLAG, confirmed: FLAG }, ['projectId']), result: BACKLOG },
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
