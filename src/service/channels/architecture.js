// A project's Architecture tab (#356): the git facts of its repository (src/architecture-facts.js,
// numbers from the pure core src/shared/architecture-model.js), the Oracle's analysis on demand
// (src/oracle-architecture.js: one turn in the Oracle's daily budget, simulated under mock or
// MULTIAGENT_SIMULATION_ONLY; one analysis at a time, a second call is refused), the saved reports
// (<workspace>/architecture/<project id>/, the latest with its findings marked new or gone, the
// project's real finished runs since), the cost estimate from the last real analyses, the
// project's exclude list, and "Send to Refactor": a finding becomes a proposal of the Refactor tab
// (src/refactor-proposals.js, refactor:proposals).
// The project city (#371): architecture:city is the facts grouped by the saved city plan (folder
// districts without one) with its edges and validation (src/architecture-facts.js readCity, core
// src/shared/city-model.js); architecture:savePlan checks a plan against CITY_PLAN_SCHEMA and saves
// it, keeping the one it replaces. Neither starts a model call.
// The project map (#372): architecture:city also says whether to advise "Refresh the map"
// (CityModel.refreshSignal: never without a saved plan) and names the project map run in progress;
// the tab starts that workflow itself (run:start, workflows/project-map.yaml), only on a click.
// The agents on the city (#374): architecture:agents reads the project's runs in progress (any app
// process): each agent session's last file, the run's trail of changed files and its uncommitted
// files (git, in the run's worktree), and the files two runs change (src/shared/city-agents.js); with
// a runId, also every file touch of that run of the project ("Replay on the map"). It never starts
// a run, answers a gate or calls a model.
// An issue's impact preview (#375): architecture:impact gives the City view's impact overlay the
// saved city plan (where a new file is expected) and the hit rates kept per issue
// (<workspace>/architecture/<project id>/impact-history.json, CityImpact.recordHitRate); with
// `record`, it first keeps an issue's hit rate for a run, stamped now. No model call.

const fs = require('fs');
const path = require('path');
const agents = require('../../agents');
const arch = require('../../oracle-architecture');
const facts = require('../../architecture-facts');
const projects = require('../../projects');
const proposals = require('../../refactor-proposals');
const runs = require('../../runs');
const simulation = require('../../engine/simulation');
const { localChanges } = require('../../engine/test-paths');
const { readEvents } = require('../../supervisor');
const cityAgents = require('../../shared/city-agents');
const { recordHitRate } = require('../../shared/city-impact');
const { validateSchema } = require('../../json-schema');
const {
  CITY_PLAN_SCHEMA,
  refreshSignal,
} = require('../../shared/city-model');
const { clientError, requireId } = require('../common');
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
} = require('../schemas');

const DATE = nullable({ type: 'string', maxLength: 40, description: 'An ISO date, or null for no bound.' });
const PATTERN = { type: 'string', maxLength: 200, description: 'A gitignore-style path pattern.' };
const WINDOW = { since: DATE, until: DATE, includeMass: FLAG, refresh: FLAG };
const FACTS = shape({ state: { type: 'string', enum: ['ok', 'not-git', 'no-commits'] }, model: nullable(OBJECT), gate: listOf(OBJECT), exclude: listOf(STRING) }, ['state', 'model']);
const ESTIMATE = shape({ estimate: nullable(shape({ usd: { type: 'number' }, basis: INT }, ['usd', 'basis'])) }, ['estimate']);
const REPORT_VIEW = shape({ report: nullable(OBJECT), findings: listOf(OBJECT), gone: listOf(OBJECT), runsSince: nullable(INT), previousId: nullable(STRING), running: nullable(OBJECT) }, ['report', 'findings', 'gone']);
const REFRESH = shape({ suggested: { type: 'boolean' }, unmatchedShare: { type: 'number' }, newFolders: listOf(STRING) }, ['suggested', 'unmatchedShare', 'newFolders']);
const CITY = shape({ state: { type: 'string', enum: ['ok', 'not-git', 'no-commits'] }, model: nullable(OBJECT), validation: nullable(OBJECT), refresh: REFRESH, mapRun: nullable(STRING) }, ['state', 'model', 'validation', 'refresh']);
const TOUCH = shape({ session_id: STRING, agent: nullable(STRING), step: nullable(STRING), provider: nullable(STRING), model: nullable(STRING), tool: STRING, kind: { type: 'string', enum: ['change', 'read'] }, path: STRING, ts: nullable(STRING) }, ['session_id', 'kind', 'path']);
const AGENTS = shape({
  projectId: STRING,
  runs: listOf(shape({ id: STRING, workflow: nullable(STRING), colour: STRING, agents: listOf(TOUCH), trail: listOf(STRING), dirty: listOf(STRING) }, ['id', 'colour', 'agents', 'trail', 'dirty'])),
  collisions: listOf(shape({ path: STRING, runs: listOf(STRING) }, ['path', 'runs'])),
  replay: shape({ runId: STRING, touches: listOf(TOUCH) }, ['runId', 'touches']),
}, ['projectId', 'runs', 'collisions']);
// #375: an issue's hit rate for one run, and what the impact overlay reads
const HIT_RATE = { type: 'number', minimum: 0, maximum: 1 };
const HIT = shape({ hitRate: HIT_RATE, ts: STRING, run: STRING }, ['hitRate', 'ts', 'run']);
const IMPACT = shape({ plan: nullable(OBJECT), history: { type: 'object', additionalProperties: listOf(HIT) }, error: nullable(STRING) }, ['plan', 'history']);
const IMPACT_HISTORY = 'impact-history.json';
// the project map workflow (#372): its run writes the project's city plan
const PROJECT_MAP_WORKFLOW = 'project-map.yaml';
const PROGRESS_TEXT = 160;
// #374: each run in progress's trail colour on the city, in the order the runs started
const RUN_COLOURS = ['#e4572e', '#4c9be8', '#3fb68b', '#f2a541', '#9b6ef3', '#e05297'];
const DIRTY_TIMEOUT_MS = 10e3;

// A run's worktree (its root) and the folder its agents work in (the project's folder inside it);
// without a worktree (mock run, worktrees off, not git) they work in the run's repo_path input or
// the project's folder, as the engine's gates do (src/engine/run/gates.js).
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

  function reportView({ projectId, reportId = null }) {
    const p = projectOf(projectId);
    const list = arch.listReports(root(), p.id);
    const at = reportId ? list.findIndex((r) => r.id === reportId) : 0;
    if (reportId && at < 0) throw clientError(`Unknown architecture report: ${reportId}`);
    const saved = list[at] || null;
    const previous = list[at + 1] || null;
    const marked = saved ? arch.compareReports(previous && previous.report, saved.report) : { findings: [], gone: [] };
    // `sent`: the finding is a proposal of the Refactor tab already
    const sent = new Set(proposals.listProposals(refactorRoot(), p.id).filter((x) => x.source === 'architecture').map((x) => x.key));
    return {
      report: saved, previousId: previous ? previous.id : null, gone: marked.gone,
      findings: marked.findings.map((f) => ({ ...f, sent: sent.has(arch.findingKey(f)) })),
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

  function sendToRefactor({ projectId, reportId, findingIndex }) {
    const p = projectOf(projectId);
    const saved = arch.listReports(root(), p.id).find((r) => r.id === reportId);
    const finding = saved && saved.report.findings[findingIndex];
    if (!finding) throw clientError(`No finding ${findingIndex} in the architecture report ${reportId}.`);
    const { kind, title, files, evidence, severity, refactor } = finding;
    const proposal = proposals.addProposal(refactorRoot(), p.id, { source: 'architecture', key: arch.findingKey(finding), reportId, kind, title, files, evidence, severity, refactor });
    return { proposal };
  }

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
        return { ...city, refresh: refreshSignal(city), mapRun: mapRun ? mapRun.runId : null };
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
        params: args({ projectId: PROJECT_ID, record: shape({ issue: INT, hitRate: HIT_RATE, run: STRING }, ['issue', 'hitRate', 'run']) }, ['projectId']),
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
          history = recordHitRate(history, record.issue, { hitRate: record.hitRate, ts: new Date().toISOString(), run: record.run });
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, JSON.stringify(history, null, 2) + '\n');
        }
        return { plan, history, error: null };
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
      channel: 'architecture:sendToRefactor',
      method: 'sendFindingToRefactor',
      params: ['projectId', 'reportId', 'findingIndex'],
      schema: { params: args({ projectId: PROJECT_ID, reportId: STRING, findingIndex: INT }, ['projectId', 'reportId', 'findingIndex']), result: shape({ proposal: OBJECT }, ['proposal']) },
      fn: sendToRefactor,
    },
    {
      channel: 'refactor:proposals',
      method: 'refactorProposals',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: listOf(OBJECT) },
      fn: ({ projectId }) => proposals.listProposals(refactorRoot(), projectOf(projectId).id),
    },
  ];
};
