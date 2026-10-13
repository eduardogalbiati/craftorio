// A project's Architecture tab (#356): the git facts of its repository (src/architecture-facts.js,
// numbers from the pure core src/shared/architecture-model.js), the Oracle's analysis on demand
// (src/oracle-architecture.js: one turn in the Oracle's daily budget, simulated under mock or
// MULTIAGENT_SIMULATION_ONLY; one analysis at a time, a second call is refused), the saved reports
// (<workspace>/architecture/<project id>/, the latest with its findings marked new or gone, the
// project's real finished runs since), the cost estimate from the last real analyses, the
// project's exclude list, and "Send to Refactor": a finding becomes a proposal of the Refactor tab
// (src/refactor-proposals.js, refactor:proposals).

const path = require('path');
const agents = require('../../agents');
const arch = require('../../oracle-architecture');
const facts = require('../../architecture-facts');
const projects = require('../../projects');
const proposals = require('../../refactor-proposals');
const runs = require('../../runs');
const simulation = require('../../engine/simulation');
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
  shape,
  STRING,
} = require('../schemas');

const DATE = nullable({ type: 'string', maxLength: 40, description: 'An ISO date, or null for no bound.' });
const PATTERN = { type: 'string', maxLength: 200, description: 'A gitignore-style path pattern.' };
const WINDOW = { since: DATE, until: DATE, includeMass: FLAG, refresh: FLAG };
const FACTS = shape({ state: { type: 'string', enum: ['ok', 'not-git', 'no-commits'] }, model: nullable(OBJECT), gate: listOf(OBJECT), exclude: listOf(STRING) }, ['state', 'model']);
const ESTIMATE = shape({ estimate: nullable(shape({ usd: { type: 'number' }, basis: INT }, ['usd', 'basis'])) }, ['estimate']);
const REPORT_VIEW = shape({ report: nullable(OBJECT), findings: listOf(OBJECT), gone: listOf(OBJECT), runsSince: nullable(INT), previousId: nullable(STRING), running: nullable(OBJECT) }, ['report', 'findings', 'gone']);
const PROGRESS_TEXT = 160;

module.exports = (ctx) => {
  const root = () => path.join(ctx.ws.root, 'architecture');
  const refactorRoot = () => path.join(ctx.ws.root, 'refactor');
  let running = null; // the analysis in progress: { projectId, since, items, last }

  const projectOf = (projectId) => {
    const id = requireId(projectId, 'project id');
    const p = projects.readProject(ctx.ws.projects, id);
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
