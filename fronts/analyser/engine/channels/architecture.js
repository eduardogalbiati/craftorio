// A project's Architecture tab (#356): the git facts of its repository (packages/engine/domains/project/architecture-facts.js,
// numbers from the pure core packages/shared/architecture-model.js), the Oracle's analysis on demand
// (packages/engine/domains/oracle/oracle-architecture.js: one turn in the Oracle's daily budget, simulated under mock or
// MULTIAGENT_SIMULATION_ONLY; one analysis at a time, a second call is refused), the saved reports
// (<workspace>/architecture/<project id>/, the latest with its findings marked new or gone, the
// project's real finished runs since), the cost estimate from the last real analyses, the
// project's exclude list, and "Create issue" (#730, architecture:createIssue): a finding becomes a
// `refactor` issue (fronts/analyser/engine/channels/refactor.js ctx.fileFinding), with `prioritize` also
// planned in the roadmap's disabled stage waiting for the owner's OK (#435); the report says where each
// filed finding went (`filed`: its issue and stage) and the Refactor proposal it became before #730
// (`proposal`, packages/engine/domains/refactor/refactor-proposals.js, read only).
// The project city (#371): architecture:city is the facts grouped by the saved city plan (folder
// districts without one) with its edges and validation (packages/engine/domains/project/architecture-facts.js readCity, core
// packages/shared/city-model.js); architecture:savePlan checks a plan against CITY_PLAN_SCHEMA and saves
// it, keeping the one it replaces. Neither starts a model call.
// #782: it also says when the project was last analyzed, `analysed`: { date, commit, commitsSince, commitGone } | null,
// from the last saved report (commit: short, commitsSince: the commits on HEAD after it; both null when not known;
// commitGone: git says that commit no longer exists, never a guess from a null commitsSince).
// The project map (#372): architecture:city also says whether to advise "Refresh the map"
// (CityModel.refreshSignal: never without a saved plan) and names the project map run in progress;
// the tab starts that workflow itself (run:start, workflows/analyze-project.yaml), only on a click.
// The agents on the city (#374): architecture:agents reads the project's runs in progress (any app
// process): each agent session's last file, the run's trail of changed files and its uncommitted
// files (git, in the run's worktree), and the files two runs change (packages/shared/city-agents.js); with
// a runId, also every file touch of that run of the project ("Replay on the map"). It never starts
// a run, answers a gate or calls a model.
// An issue's impact preview (#375): architecture:impact gives the City view's impact overlay the
// saved city plan (where a new file is expected) and the hit rates kept per issue
// (<workspace>/architecture/<project id>/impact-history.json, CityImpact.recordHitRate); with
// `record`, it first keeps an issue's hit rate for a run, stamped now, and whether the issue had an
// `## Expected files` section (withSection, #429). No model call.
// A release on the city (#376): architecture:release gives the City view's release overlay the city at
// `from` (the previous tag by default), what changed up to `to` (the newest tag by default) and the
// release's commits (packages/engine/domains/releases/release-city.js), the tags for the two-tag picker (the latest commits when
// the project has no tag) and the saved plan (where an added file is drawn). Read-only git, no model call.

const fs = require('fs');
const path = require('path');
const agents = require('@multiagent/engine/domains/agents/agents');
const arch = require('@multiagent/engine/domains/oracle/oracle-architecture');
const facts = require('@multiagent/engine/domains/project/architecture-facts');
const projects = require('@multiagent/engine/domains/project/projects');
const proposals = require('@multiagent/engine/domains/refactor/refactor-proposals');
const roadmaps = require('@multiagent/engine/domains/roadmap/roadmap');
const runs = require('@multiagent/engine/domains/run/runs');
const releaseCity = require('@multiagent/engine/domains/releases/release-city');
const { isWaitingStage } = require('@multiagent/engine/domains/refactor/refactor-cadence');
const seedRuns = require('@multiagent/engine/service/seed-runs');
const simulation = require('@multiagent/engine/engine/simulation');
const { localChanges } = require('@multiagent/engine/engine/test-paths');
const { readEvents } = require('@multiagent/engine/domains/supervisor/supervisor');
const cityAgents = require('@multiagent/shared/city-agents');
const { recordHitRate } = require('@multiagent/shared/city-impact');
const { validateSchema } = require('@multiagent/engine/domains/workspace/json-schema');
const {
  CITY_PLAN_SCHEMA,
  refreshSignal,
} = require('@multiagent/shared/city-model');
const { clientError, requireId } = require('@multiagent/engine/service/common');
const {
  ANY,
  args,
  FLAG,
  INT,
  listOf,
  nullable,
  OBJECT,
  PROJECT_ID,
  RUN_ID,
  shape,
  STRING,
} = require('@multiagent/engine/service/schemas');

const DATE = nullable({ type: 'string', maxLength: 40, description: 'An ISO date, or null for no bound.' });
const PATTERN = { type: 'string', maxLength: 200, description: 'A gitignore-style path pattern.' };
const WINDOW = { since: DATE, until: DATE, includeMass: FLAG, refresh: FLAG };
const FACTS = shape({ state: { type: 'string', enum: ['ok', 'not-git', 'no-commits'] }, model: nullable(OBJECT), gate: listOf(OBJECT), exclude: listOf(STRING) }, ['state', 'model']);
const ESTIMATE = shape({ estimate: nullable(shape({ usd: { type: 'number' }, basis: INT }, ['usd', 'basis'])) }, ['estimate']);
const REPORT_VIEW = shape({ report: nullable(OBJECT), findings: listOf(OBJECT), gone: listOf(OBJECT), runsSince: nullable(INT), previousId: nullable(STRING), running: nullable(OBJECT) }, ['report', 'findings', 'gone']);
const REFRESH = shape({ suggested: { type: 'boolean' }, unmatchedShare: { type: 'number' }, newFolders: listOf(STRING) }, ['suggested', 'unmatchedShare', 'newFolders']);
const ANALYSED = shape({ date: STRING, commit: nullable(STRING), commitsSince: nullable(INT), commitGone: FLAG }, ['date']);
const CITY = shape({ state: { type: 'string', enum: ['ok', 'not-git', 'no-commits'] }, model: nullable(OBJECT), validation: nullable(OBJECT), refresh: REFRESH, mapRun: nullable(STRING), analysed: nullable(ANALYSED) }, ['state', 'model', 'validation', 'refresh']);
const TOUCH = shape({ session_id: STRING, agent: nullable(STRING), step: nullable(STRING), provider: nullable(STRING), model: nullable(STRING), tool: STRING, kind: { type: 'string', enum: ['change', 'read'] }, path: STRING, ts: nullable(STRING) }, ['session_id', 'kind', 'path']);
const AGENTS = shape({
  projectId: STRING,
  runs: listOf(shape({ id: STRING, workflow: nullable(STRING), colour: STRING, agents: listOf(TOUCH), trail: listOf(STRING), dirty: listOf(STRING) }, ['id', 'colour', 'agents', 'trail', 'dirty'])),
  collisions: listOf(shape({ path: STRING, runs: listOf(STRING) }, ['path', 'runs'])),
  replay: shape({ runId: STRING, touches: listOf(TOUCH) }, ['runId', 'touches']),
}, ['projectId', 'runs', 'collisions']);
// #375: an issue's hit rate for one run, and what the impact overlay reads
const HIT_RATE = { type: 'number', minimum: 0, maximum: 1 };
const HIT = shape({ hitRate: HIT_RATE, ts: STRING, run: STRING, withSection: FLAG }, ['hitRate', 'ts', 'run']);
const IMPACT = shape({ plan: nullable(OBJECT), history: { type: 'object', additionalProperties: listOf(HIT) }, error: nullable(STRING) }, ['plan', 'history']);
const IMPACT_HISTORY = 'impact-history.json';
// #376: a release on the city
const RELEASE = shape({
  state: STRING, from: nullable(STRING), to: nullable(STRING), base: nullable(OBJECT), changes: listOf(OBJECT), commits: listOf(OBJECT),
  tags: listOf(STRING), tagless: { type: 'boolean' }, plan: nullable(OBJECT), error: nullable(STRING),
}, ['state', 'from', 'to', 'changes', 'commits', 'tags']);
// the project map workflow (#372; #631: analyze-project, the old project-map): its run writes the project's city plan
const PROJECT_MAP_WORKFLOW = 'analyze-project.yaml';
const PROGRESS_TEXT = 160;
// #374: each run in progress's trail colour on the city, in the order the runs started
const RUN_COLOURS = ['#e4572e', '#4c9be8', '#3fb68b', '#f2a541', '#9b6ef3', '#e05297'];
const DIRTY_TIMEOUT_MS = 10e3;

// A run's worktree (its root) and the folder its agents work in (the project's folder inside it);
// without a worktree (mock run, worktrees off, not git) they work in the run's repo_path input or
// the project's folder, as the engine's gates do (packages/engine/engine/run/gates.js).
function worktreeOf(events, folder) {
  const ready = events.find((e) => e.type === 'worktree.ready');
  if (ready && ready.dir) return { dir: ready.dir, workDir: ready.work_dir || ready.dir };
  const inputs = (events.find((e) => e.type === 'workflow.started') || {}).inputs || {};
  return { dir: null, workDir: inputs.repo_path || inputs.project_path || folder || null };
}

// The files a run's worktree changes and has not committed (tracked and new), relative to its
// working folder; none without a git worktree (the project's own changes are not the run's) or when git fails.
async function uncommitted(dir, workDir) {
  if (!dir || !fs.existsSync(path.join(dir, '.git'))) return [];
  return localChanges(workDir, { relative: true, timeout: DIRTY_TIMEOUT_MS }).catch(() => []);
}

// A run in progress on the city: its working agents' last files, its trail and its uncommitted files.
async function runOnCity(run, colour, folder) {
  const events = readEvents(run.runDir);
  const { dir, workDir } = worktreeOf(events, folder);
  const touches = cityAgents.extractTouches(events, { worktree: workDir });
  const closed = cityAgents.closedSessions(events);
  const dirty = await uncommitted(dir, workDir);
  return {
    id: run.runId, workflow: run.workflow, colour, agents: cityAgents.lastTouches(touches).filter((t) => !closed.has(t.session_id)), trail: cityAgents.trailOf(touches), dirty,
    // what the collision rule compares: every file the run changed, committed or not
    changed: [...new Set([...touches.filter((t) => t.kind === 'change').map((t) => t.path), ...dirty])],
  };
}

module.exports = (ctx) => {
  const root = () => path.join(ctx.ws.root, 'architecture');
  const refactorRoot = () => path.join(ctx.ws.root, 'refactor');
  let running = null; // the analysis in progress: { projectId, since, items, last }

  // #782: the last saved report as the City's notes say it, null with none (see the header)
  async function lastAnalysis(p) {
    const report = arch.listReports(root(), p.id)[0];
    if (!report) return null;
    const commit = report.head?.commit || null;
    const commitsSince = await seedRuns.commitsSince(p, commit);
    return { date: report.date, commit: commit ? commit.slice(0, 7) : null, commitsSince, commitGone: commitsSince == null && await seedRuns.commitGone(p, commit) };
  }

  const projectOf = (projectId) => {
    const id = requireId(projectId, 'project id');
    let p = null;
    try {
      p = projects.readProject(ctx.ws.projects, id);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (!p || !p.folder) throw clientError(`Unknown project: ${id}`);
    return p;
  };
  const readFacts = (p, opts = {}) => {
    // a bound that is not a date would be ignored silently by the window
    for (const bound of ['since', 'until']) if (opts[bound] && !Number.isFinite(Date.parse(opts[bound]))) throw clientError(`Invalid ${bound}: ${opts[bound]} is not a date.`);
    return facts.readFacts(p.folder, { ...opts, exclude: arch.readSettings(root(), p.id).exclude });
  };

  // the project's real (not simulated) runs that finished after `date`
  const runsSince = (p, date) => runs.runsForProject(runs.listRuns(ctx.ws.runs), p)
    .filter((r) => !r.mock && r.finishedAt && Date.parse(r.finishedAt) > Date.parse(date)).length;

  // #435/#730: where a filed finding went: its issue and its roadmap stage (1-based, `waiting` for the owner's OK), null before its issue
  const stagesOf = (p) => roadmaps.issueStages(roadmaps.readRoadmap(ctx.ws.backlog, p.id));
  const filedAt = (x, stages) => {
    if (!x?.issue) return null;
    const placed = stages.get(Number(x.issue));
    return { issue: Number(x.issue), issueUrl: x.issueUrl || null, stage: placed?.stage || null, waiting: isWaitingStage(placed) };
  };
  // #730: a Refactor proposal made from a finding before #730, readable under it
  const proposalView = (x, stages) => (x ? { id: x.id, title: x.title || null, status: x.status || null, issue: x.issue ?? null, issueUrl: x.issueUrl || null, where: filedAt(x, stages) } : null);

  function reportView({ projectId, reportId = null }) {
    const p = projectOf(projectId);
    const list = arch.listReports(root(), p.id);
    const at = reportId ? list.findIndex((r) => r.id === reportId) : 0;
    if (reportId && at < 0) throw clientError(`Unknown architecture report: ${reportId}`);
    const saved = list[at] || null;
    const previous = list[at + 1] || null;
    const marked = saved ? arch.compareReports(previous && previous.report, saved.report) : { findings: [], gone: [] };
    // `filed` (#730): the finding's issue and its roadmap stage; `proposal`: the proposal it became before #730
    const filed = arch.readFiled(root(), p.id);
    const old = new Map(proposals.listProposals(refactorRoot(), p.id).filter((x) => x.source === 'architecture').map((x) => [x.key, x]));
    const stages = Object.keys(filed).length || old.size ? stagesOf(p) : new Map();
    return {
      report: saved, previousId: previous ? previous.id : null, gone: marked.gone,
      findings: marked.findings.map((f) => {
        const key = arch.findingKey(f);
        return { ...f, filed: filedAt(filed[key], stages), proposal: proposalView(old.get(key), stages) };
      }),
      runsSince: saved ? runsSince(p, saved.date) : null,
      running: running && running.projectId === p.id ? { ...running } : null,
    };
  }

  async function analyze({ projectId, mock, ...opts }) {
    const p = projectOf(projectId);
    if (running) return { refused: { reason: 'busy', text: `An architecture analysis is already running (${running.projectId}, since ${running.since}).` }, report: null };
    running = { projectId: p.id, since: new Date().toISOString(), items: 0, last: null };
    try {
      const { state, model } = await readFacts(p, opts);
      if (state !== 'ok') throw clientError(state === 'not-git' ? 'The project folder is not a git repository: there is nothing to analyse.' : 'No commit in the range: there is nothing to analyse.');
      const onItem = (it) => {
        running.items++;
        running.last = String((it && (it.text || it.name || it.kind)) || '').slice(0, PROGRESS_TEXT) || null;
      };
      const simulated = !!mock || simulation.simulationOnly();
      const out = await arch.analyze({
        project: p, model, mock: simulated, onItem,
        oracle: simulated ? null : ctx.oracleService(), agent: agents.readAgent(ctx.ws.agents, agents.ORACLE_ID),
      });
      if (out.refused) return { refused: out.refused, report: null };
      const saved = arch.saveReport(root(), p.id, {
        date: new Date().toISOString(), head: model.head, branch: model.branch,
        costUsd: out.costUsd, tokens: out.tokens, simulated: out.simulated, report: out.report,
      });
      return { report: saved };
    } finally {
      running = null;
    }
  }

  // #730: a finding becomes a `refactor` issue (ctx.fileFinding, channels/refactor.js), recorded by its
  // findingKey; a finding filed already is not filed again. `prioritize`: the issue is also planned in the
  // roadmap's waiting stage (ctx.planFinding, #435: nothing starts before the owner's OK)
  async function createIssue({ projectId, reportId, findingIndex, prioritize = false }) {
    const p = projectOf(projectId);
    const saved = arch.listReports(root(), p.id).find((r) => r.id === reportId);
    const finding = saved && saved.report.findings[findingIndex];
    if (!finding) throw clientError(`No finding ${findingIndex} in the architecture report ${reportId}.`);
    if (!ctx.fileFinding) throw new Error('Filing a finding as an issue needs the Refactor channels.');
    const key = arch.findingKey(finding);
    let record = arch.readFiled(root(), p.id)[key];
    if (!record?.issue) {
      const out = await ctx.fileFinding(p.id, finding);
      record = arch.recordFiled(root(), p.id, key, { issue: out.issue, issueUrl: out.issueUrl, reportId, files: (finding.files || []).slice(), at: new Date().toISOString() });
    }
    if (prioritize && !stagesOf(p).has(Number(record.issue))) await ctx.planFinding(p.id, finding, record.issue);
    return { filed: filedAt(record, stagesOf(p)) };
  }

  // #730 the files each filed finding's issue will change (Map number → files): the roadmap's planner
  // (channels/refactor.js plannedFiles) joins a later item on the same file to it (#435)
  ctx.filedFiles = (projectId) => new Map(Object.values(arch.readFiled(root(), projectId))
    .filter((r) => r && r.issue && Array.isArray(r.files) && r.files.length)
    .map((r) => [Number(r.issue), r.files]));

  return [
    {
      channel: 'architecture:facts',
      method: 'architectureFacts',
      params: ['projectId', '...opts'],
      schema: { params: args({ projectId: PROJECT_ID, ...WINDOW }, ['projectId']), result: FACTS },
      fn: async ({ projectId, ...opts }) => {
        const p = projectOf(projectId);
        return { ...(await readFacts(p, opts)), exclude: arch.readSettings(root(), p.id).exclude };
      },
    },
    {
      channel: 'architecture:city',
      method: 'architectureCity',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: CITY },
      fn: async ({ projectId }) => {
        const p = projectOf(projectId);
        const { plan, error } = arch.readPlan(root(), p.id);
        const city = await facts.readCity(p.folder, { exclude: arch.readSettings(root(), p.id).exclude, plan, planError: error });
        // #372: whether to advise "Refresh the map" (never starts a run), and the project map run in progress
        const mapRun = [...ctx.active.values()].find((r) => r.projectId === p.id && path.basename(String(r.file || '')) === PROJECT_MAP_WORKFLOW);
        return { ...city, refresh: refreshSignal(city), mapRun: mapRun ? mapRun.runId : null, analysed: await lastAnalysis(p) };
      },
    },
    {
      channel: 'architecture:agents',
      method: 'architectureAgents',
      params: ['...opts'],
      schema: { params: args({ projectId: PROJECT_ID, runId: nullable(RUN_ID) }, ['projectId']), result: AGENTS },
      fn: async ({ projectId, runId = null }) => {
        const p = projectOf(projectId);
        const mine = runs.runsForProject(runs.listRuns(ctx.ws.runs), p);
        // the project's runs in progress, in this app or another one; other projects' runs are not shown
        const live = mine.filter((r) => r.status === 'running').sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
        const onCity = await Promise.all(live.map((r, i) => runOnCity(r, RUN_COLOURS[i % RUN_COLOURS.length], p.folder)));
        const out = {
          projectId: p.id,
          runs: onCity.map(({ changed, ...r }) => r),
          collisions: cityAgents.collisions(onCity.map((r) => ({ id: r.id, changed: r.changed }))),
        };
        if (!runId) return out;
        // "Replay on the map": every file touch of one run of the project, finished or not
        const run = mine.find((r) => r.runId === runId);
        if (!run) throw clientError(`Unknown run of this project: ${runId}`);
        const events = readEvents(run.runDir);
        return { ...out, replay: { runId, touches: cityAgents.extractTouches(events, { worktree: worktreeOf(events, p.folder).workDir }) } };
      },
    },
    {
      channel: 'architecture:impact',
      method: 'architectureImpact',
      params: ['...opts'],
      schema: {
        params: args({ projectId: PROJECT_ID, record: shape({ issue: INT, hitRate: HIT_RATE, run: STRING, withSection: FLAG }, ['issue', 'hitRate', 'run']) }, ['projectId']),
        result: IMPACT,
      },
      fn: ({ projectId, record = null }) => {
        const p = projectOf(projectId);
        const file = path.join(root(), p.id, IMPACT_HISTORY);
        let history = {};
        let error = null;
        try {
          history = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
        } catch (e) {
          // an unreadable history (a truncated write, a hand edit) degrades like readPlan: the preview still shows
          if (e.code !== 'ENOENT') {
            error = `Could not read ${IMPACT_HISTORY}: ${e.message}`;
            console.error(`architecture:impact: ${file}: ${e.message}`);
          }
        }
        const plan = arch.readPlan(root(), p.id).plan || null;
        // never overwrite a history that could not be read
        if (error) return { plan, history: {}, error };
        if (record) {
          history = recordHitRate(history, record.issue, { hitRate: record.hitRate, ts: new Date().toISOString(), run: record.run, withSection: record.withSection });
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, JSON.stringify(history, null, 2) + '\n');
        }
        return { plan, history, error: null };
      },
    },
    {
      channel: 'architecture:release',
      method: 'architectureRelease',
      params: ['...opts'],
      schema: { params: args({ projectId: PROJECT_ID, from: nullable(STRING), to: nullable(STRING) }, ['projectId']), result: RELEASE },
      fn: async ({ projectId, from = null, to = null }) => {
        const p = projectOf(projectId);
        const plan = arch.readPlan(root(), p.id).plan || null;
        const tags = await releaseCity.listTags(p.folder);
        // a project without tags picks two commits (#376): the latest ones stand in for the tags
        const picks = tags.length ? tags : await releaseCity.recentCommits(p.folder);
        const target = to || picks[0] || null;
        const base = from || (tags.length ? await releaseCity.previousTag(p.folder, target) : picks[picks.indexOf(target) + 1]) || null;
        if (!target || !base) return { state: tags.length ? 'first-release' : 'no-history', from: base, to: target, base: null, changes: [], commits: [], tags: picks, tagless: !tags.length, plan, error: null };
        const out = await releaseCity.readReleaseCity(p.folder, { from: base, to: target, plan, exclude: arch.readSettings(root(), p.id).exclude });
        return { ...out, tags: picks, tagless: !tags.length, plan, error: out.error || null };
      },
    },
    {
      channel: 'architecture:savePlan',
      method: 'saveCityPlan',
      params: ['projectId', 'plan'],
      schema: { params: args({ projectId: PROJECT_ID, plan: CITY_PLAN_SCHEMA }, ['projectId', 'plan']), result: shape({ history: nullable(STRING) }, ['history']) },
      fn: async ({ projectId, plan }) => {
        const p = projectOf(projectId);
        const errors = validateSchema(plan, CITY_PLAN_SCHEMA, 'plan');
        if (errors.length) throw clientError(`Invalid city plan: ${errors.slice(0, 5).join('; ')}`);
        return arch.writePlan(root(), p.id, plan, new Date().toISOString());
      },
    },
    {
      channel: 'architecture:setExclude',
      method: 'setArchitectureExclude',
      params: ['projectId', 'patterns'],
      schema: { params: args({ projectId: PROJECT_ID, patterns: listOf(PATTERN) }, ['projectId', 'patterns']), result: shape({ exclude: listOf(STRING) }, ['exclude']) },
      fn: ({ projectId, patterns }) => {
        const p = projectOf(projectId);
        const exclude = [...new Set((patterns || []).map((s) => String(s).trim()).filter(Boolean))];
        return arch.writeSettings(root(), p.id, { ...arch.readSettings(root(), p.id), exclude });
      },
    },
    {
      channel: 'architecture:analyze',
      method: 'analyzeArchitecture',
      params: ['projectId', '...opts'],
      schema: { params: args({ projectId: PROJECT_ID, mock: FLAG, ...WINDOW }, ['projectId']), result: shape({ report: nullable(OBJECT), refused: OBJECT }, ['report']) },
      fn: analyze,
    },
    {
      channel: 'architecture:reports',
      method: 'listArchitectureReports',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: listOf(shape({ id: STRING, date: STRING, costUsd: ANY, simulated: ANY, findings: INT }, ['id', 'date'])) },
      fn: ({ projectId }) => arch.listReports(root(), projectOf(projectId).id)
        .map((r) => ({ id: r.id, date: r.date, costUsd: r.costUsd ?? null, tokens: r.tokens || null, simulated: !!r.simulated, head: r.head || null, findings: r.report.findings.length })),
    },
    {
      channel: 'architecture:report',
      method: 'architectureReport',
      params: ['projectId', '...opts'],
      schema: { params: args({ projectId: PROJECT_ID, reportId: nullable(STRING) }, ['projectId']), result: REPORT_VIEW },
      fn: reportView,
    },
    {
      channel: 'architecture:estimate',
      method: 'architectureEstimate',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: ESTIMATE },
      fn: ({ projectId }) => ({ estimate: arch.estimateCost(arch.listReports(root(), projectOf(projectId).id)) }),
    },
    {
      channel: 'architecture:createIssue',
      method: 'createFindingIssue',
      params: ['projectId', 'reportId', 'findingIndex', '...opts'],
      schema: { params: args({ projectId: PROJECT_ID, reportId: STRING, findingIndex: INT, prioritize: FLAG }, ['projectId', 'reportId', 'findingIndex']), result: shape({ filed: OBJECT }, ['filed']) },
      fn: createIssue,
    },
  ];
};
