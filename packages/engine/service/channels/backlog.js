// Backlog screen: a project's issues (the last sync, instant, and a new sync with gh/glab, each
// issue with the runs working on it), Assign into the roadmap (#446) and the local merges not pushed, and
// saving a Write & Review document back to its issue, archiving and restoring issues (#238).
// E2E hook (simulation only): CRAFTORIO_E2E_ISSUES_FAIL=disabled|network (#845, e2eIssuesFail).

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
  INT,
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
// #781: the sync in progress, what the wizard's Backlog card says
const PROGRESS = nullable(shape({ source: STRING, what: STRING, read: nullable(INT), total: nullable(INT) }, ['source', 'what']));

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
  const progress = new Map(); // #781: project id → the sync in progress: { source, what, read, total }
  // #845 E2E hook, simulation only: CRAFTORIO_E2E_ISSUES_FAIL=disabled|network makes any project the GitHub repository
  // e2e-owner/<its folder's name> whose issue reads fail as gh does (Issues turned off, or no network); null otherwise
  const e2eIssuesFail = (proj) => {
    const mode = process.env.CRAFTORIO_E2E_ISSUES_FAIL;
    if (!simulation.simulationOnly() || !['disabled', 'network'].includes(mode) || !proj) return null;
    const github = require('@craftorio/shared/platforms/github');
    const { E2E_LOGIN } = require('../areas/project-onboarding'); // (lazy: only this hook needs it)
    const repo = `${E2E_LOGIN}/${path.basename(String(proj.folder || proj.id))}`;
    const reason = mode === 'disabled' ? `the '${repo}' repository has disabled issues` : `error connecting to api.${github.host}`;
    const exec = async (cli, a) => {
      if (a[0] === 'issue') throw new Error(`${cli} ${a.slice(0, 2).join(' ')} failed: ${reason}`);
      return '[]';
    };
    return { project: { ...proj, repo: `https://${github.host}/${repo}` }, exec };
  };
  return [
    // #797: never in `current`, which backlog:state polls: only an open reads the PRs the roadmap's items wait for
    {
      channel: 'backlog:get',
      method: 'getBacklog',
      params: ['projectId'],
      schema: { params: ON_PROJECT, result: BACKLOG },
      fn: ({ projectId }) => {
        ctx.checkWaitingPrs(project(projectId));
        return current(projectId);
      },
    },
    // #491: the Roadmap's live reloads read only what changes while runs go (packages/engine/domains/backlog/backlog.js backlogState)
    {
      channel: 'backlog:state',
      method: 'getBacklogState',
      params: ['projectId'],
      schema: {
        params: ON_PROJECT,
        result: described(nullable(OBJECT), 'The light state: { projectId, roadmap: { state, updatedAt, scope, pausedBy, error, stages: [{ id, pause, items: [{ id, status, runId, runs, waiting, startedAt, elapsed, run?, pr? }] }] }, queue, refresh, baseCheck }; no issue bodies.'),
      },
      fn: ({ projectId }) => backlog.backlogState(current(projectId)),
    },
    // #781: how far the sync in progress went, null with none
    { channel: 'backlog:progress', method: 'backlogProgress', params: ['projectId'], schema: { params: ON_PROJECT, result: PROGRESS }, fn: ({ projectId }) => progress.get(project(projectId)) || null },
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
    // a sync also checks the local commits not pushed (fetching origin/<base>); #781: `followed`, a screen shows the
    // count (backlog:progress), so the list is read in steps
    {
      channel: 'backlog:sync',
      method: 'syncBacklog',
      params: ['projectId', 'platform', 'followed'],
      schema: { params: args({ projectId: PROJECT_ID, platform: nullable(STRING), followed: FLAG }, ['projectId']), result: BACKLOG },
      fn: async ({ projectId, platform, followed }) => {
        const id = project(projectId);
        const proj = projects.readProject(ctx.ws.projects, id);
        const asked = platform || workspace.readSettings(ctx.ws).backlogPlatform;
        const source = backlog.platformOf(proj, asked);
        progress.set(id, { source, what: 'issues', read: 0, total: null });
        try {
          const [data] = await Promise.all([
            backlog.syncBacklog({ dir: ctx.ws.backlog, project: proj, platform: asked, followed: !!followed, onProgress: (p) => progress.set(id, { source, ...p }), ...e2eIssuesFail(proj) }),
            ctx.refreshLocal(projectId).catch((e) => console.error('local status:', e.message)),
          ]);
          await ctx.syncWaitingPrs(id); // #797
          return ctx.withIssueRuns(data);
        } finally {
          progress.delete(id);
        }
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
    // Assign a workflow to issues (#446): they are planned in the roadmap as a new last stage; with
    // `runNow` that stage starts on its own (#141). When an ended run kept work for them, the answer is
    // the kept-work question { confirm, kept, runId } (nothing planned) until `confirmed` (#170). #805: with
    // `runNow` and a local base behind origin, the Backlog with the question { confirm, baseCheck, stage }: the
    // stage is planned and roadmap:start with that stage and a baseChoice starts it.
    {
      channel: 'backlog:assign',
      method: 'assignWorkflow',
      // then: what happens with each run's result when it finishes (#134); pipeline: a saved
      // pipeline's file (#135), whose first workflow and chain replace `workflow` and `then`;
      // agentOverrides: each run's provider / model / effort per agent (#262, run:start's)
      params: ['projectId', 'numbers', 'workflow', 'inputs', 'mock', 'group', 'confirmed', 'then', 'pipeline', 'agentOverrides', 'runNow'],
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
          runNow: FLAG,
        }, ['projectId']),
        result: described(BACKLOG, 'The Backlog with the issues planned in a new last roadmap stage (with the base question { confirm, baseCheck, stage } when Run now waits for it), or the kept-work question { confirm, kept, runId } (nothing planned).'),
      },
      fn: ({ confirmed, batches: _internal, ...opts }) => {
        if (opts.numbers != null && !Array.isArray(opts.numbers)) throw clientError('Invalid issue numbers: expected a list.');
        if (opts.pipeline != null && opts.pipeline !== '') requireId(opts.pipeline, 'pipeline file');
        const kept = confirmed ? null : ctx.keptWorkForIssues(opts.numbers);
        if (kept) return { confirm: kept.text, kept, runId: kept.runId };
        return ctx.assignWorkflow({ ...opts, allowKeptWork: !!confirmed, ask: true });
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
  ];
};
