// A project's Refactor tab (#357): its refactor proposals (src/refactor-proposals.js: sent from the
// Architecture tab or written by the owner, refactor:add), each with its issue's open state and its
// roadmap item's status (planned, running, failed, done, skipped); the Product Owner's ranking
// (src/refactor-priority.js: one read-only turn, simulated under `mock` or MULTIAGENT_SIMULATION_ONLY,
// one at a time per project) saved on the proposals; Dismiss with a reason; "File as issue"
// (src/refactor-issues.js: the `refactor` label, a preview in simulation, never gh/glab); "Add to roadmap now" on the
// Refactor workflow, placed by the Product Owner's rules (src/refactor-cadence.js placeRefactor) and
// written through src/roadmap.js, the target's Danger Zone score kept on the proposal (`before`).
// The cadence ("Add a refactor to the roadmap every X runs", <workspace>/refactor/<project id>/
// cadence.json { on, every, since }) listens to run:event: after every X real finished runs of the
// project since it was turned on (or since its last item) the top ranked proposal with an issue and
// no unfinished item joins the roadmap the same way. A finished refactor run records the proposal's
// `outcome` (src/refactor-outcome.js). It never answers a gate: an item counts in the budget cap
// like any other. No model call outside refactor:prioritize.

const fs = require('fs');
const path = require('path');
const agentsMod = require('../../agents');
const arch = require('../../oracle-architecture');
const backlog = require('../../backlog');
const cadenceRules = require('../../refactor-cadence');
const conflictMaps = require('../../conflict-map');
const facts = require('../../architecture-facts');
const outcomes = require('../../refactor-outcome');
const priority = require('../../refactor-priority');
const projects = require('../../projects');
const proposals = require('../../refactor-proposals');
const refactorIssues = require('../../refactor-issues');
const roadmaps = require('../../roadmap');
const runs = require('../../runs');
const simulation = require('../../engine/simulation');
const { clientError, requireId } = require('../common');
const {
  args,
  BOOL,
  FLAG,
  INT,
  ISSUE_NUMBER,
  listOf,
  nullable,
  NUMBER,
  OBJECT,
  PROJECT_ID,
  shape,
  STRING,
  text: textOf,
} = require('../schemas');

const { WORKFLOW } = refactorIssues;
const WORKFLOW_NAME = 'refactor';
// a run's summary.json (what listRuns reads) is written right after its workflow.finished event
const AFTER_RUN_MS = 1500;

const ON_PROJECT = args({ projectId: PROJECT_ID }, ['projectId']);
const ON_PROPOSAL = (more = {}, required = []) => args({ projectId: PROJECT_ID, id: STRING, ...more }, ['projectId', 'id', ...required]);
const PROPOSAL = shape({ id: STRING, status: STRING, source: STRING, issue: ISSUE_NUMBER }, ['id', 'status']);
const CADENCE = shape({
  on: BOOL, every: INT, since: nullable(STRING), nextIn: INT, ready: BOOL, rankedAt: nullable(STRING), rankCostUsd: nullable(NUMBER),
  left30: INT, left90: INT,
}, ['on', 'every', 'nextIn']);
const RANKING = shape({ at: STRING, costUsd: NUMBER, ranking: listOf(OBJECT) }, ['at', 'costUsd', 'ranking']);

const text = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const numbersOf = (issues) => (issues || []).map((i) => Number(typeof i === 'object' ? i?.number : i)).filter(Boolean);

module.exports = (ctx) => {
  const root = () => path.join(ctx.ws.root, 'refactor');
  const archRoot = () => path.join(ctx.ws.root, 'architecture');
  const cadenceFile = (id) => path.join(root(), path.basename(id), 'cadence.json');
  const prioritizing = new Set(); // the projects whose ranking is in progress

  function projectOf(projectId) {
    const id = requireId(projectId, 'project id');
    let p = null;
    try { p = projects.readProject(ctx.ws.projects, id); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!p || !p.folder) throw clientError(`Unknown project: ${id}`);
    return p;
  }
  const proposalOf = (p, id) => {
    const found = proposals.listProposals(root(), p.id).find((x) => x.id === id);
    if (!found) throw clientError(`Unknown refactor proposal: ${id}`);
    return found;
  };
  // a refusal of the pure rules is the client's
  const asClient = (fn) => { try { return fn(); } catch (e) { throw e.status ? e : clientError(e.message); } };

  // ---- the cadence ----------------------------------------------------------------------------
  function readCadence(id) {
    try {
      const saved = JSON.parse(fs.readFileSync(cadenceFile(id), 'utf8'));
      return { ...cadenceRules.cleanCadence(saved), since: saved.since || null };
    } catch {
      return { ...cadenceRules.DEFAULT_CADENCE, since: null };
    }
  }
  function saveCadence(id, cadence) {
    fs.mkdirSync(path.dirname(cadenceFile(id)), { recursive: true });
    fs.writeFileSync(cadenceFile(id), `${JSON.stringify(cadence, null, 2)}\n`);
  }
  const projectRuns = (p) => runs.runsForProject(runs.listRuns(ctx.ws.runs), p);
  const roadmapOf = (id) => roadmaps.readRoadmap(ctx.ws.backlog, id);

  function cadenceView(p) {
    const c = readCadence(p.id);
    const list = proposals.listProposals(root(), p.id);
    const ranked = proposals.readRanking(root(), p.id);
    const now = new Date();
    return {
      ...c, nextIn: cadenceRules.runsUntilNext({ runs: projectRuns(p), project: p, every: c.every, since: c.since }),
      ready: !!cadenceRules.pickNext(list, roadmapOf(p.id)), rankedAt: ranked?.at || null, rankCostUsd: ranked?.costUsd ?? null,
      left30: outcomes.leftDangerZoneCount(list, now, 30), left90: outcomes.leftDangerZoneCount(list, now, 90),
    };
  }

  // ---- what the rules read ---------------------------------------------------------------------
  // the architecture facts' model (null for a folder that is not a git repository, or when git fails)
  async function modelOf(p, opts = {}) {
    try {
      const out = await facts.readFacts(p.folder, { ...opts, exclude: arch.readSettings(archRoot(), p.id).exclude });
      return out.state === 'ok' ? out.model : null;
    } catch { return null; }
  }
  // the files each planned issue will change (src/refactor-priority.js plannedFiles)
  const plannedFiles = (id) => priority.plannedFiles({ refactorRoot: root(), backlogDir: ctx.ws.backlog, projectId: id });
  const { filesOf } = cadenceRules;
  const { withFiles } = priority;
  const syncedIssues = (id) => backlog.readBacklog(ctx.ws.backlog, id)?.issues || [];

  // ---- the roadmap item --------------------------------------------------------------------------
  /** Adds `proposal` (with an issue) to the roadmap on the Refactor workflow, placed by placeRefactor; records its `before`. */
  async function addToRoadmap(p, proposal) {
    if (!proposal.issue) throw clientError('File the proposal as an issue first: a roadmap item runs an issue.');
    const roadmap = roadmapOf(p.id);
    // unfinished as pickNext reads it: a failed and parked item is finished, so the cadence can add it again
    if (cadenceRules.unfinishedNumbers(roadmap).has(Number(proposal.issue))) {
      const status = roadmaps.issueStages(roadmap).get(Number(proposal.issue))?.status;
      throw clientError(`Issue #${proposal.issue} is in the roadmap already (${status || 'unfinished'}).`);
    }
    const planned = plannedFiles(p.id);
    const enriched = { ...roadmap, stages: roadmap.stages.map((s) => ({ ...s, items: s.items.map((x) => withFiles(x, planned)) })) };
    const { stage } = cadenceRules.placeRefactor({ roadmap: enriched, files: filesOf(proposal), conflictMap: conflictMaps.readConflictMap(ctx.ws.backlog, p.id) });
    const item = { workflow: WORKFLOW, workflowName: 'Refactor', issues: [{ number: Number(proposal.issue) }], reason: proposal.rankReason || `Refactor: ${proposal.title || proposal.improvement || proposal.target}` };
    const issues = syncedIssues(p.id);
    asClient(() => {
      if (stage >= roadmap.stages.length) {
        roadmaps.propose(ctx.ws.backlog, p.id, { stages: [{ name: 'Refactor', items: [item] }] }, { issues, alive: ctx.runAlive, keepRunning: roadmap.state === 'running' });
      } else {
        const stages = roadmap.stages.map((s, n) => (n === stage ? { ...s, items: [...s.items, item] } : s));
        roadmaps.saveStages(ctx.ws.backlog, p.id, stages, { issues, alive: ctx.runAlive });
      }
    });
    const target = filesOf(proposal)[0];
    const before = outcomes.fileScore(await modelOf(p), target);
    const stored = proposals.updateProposal(root(), p.id, proposal.id, { roadmapAt: new Date().toISOString(), outcome: undefined, ...(before ? { before: { ...before, file: target, at: new Date().toISOString() } } : {}) });
    try { await ctx.dispatchRoadmaps?.(); } catch (e) { console.error('Refactor roadmap:', e.message); }
    return { proposal: stored, stage: stage + 1 };
  }

  // ---- the issue (src/refactor-issues.js) ------------------------------------------------------
  async function fileIssue({ projectId, id, preview }) {
    const p = projectOf(projectId);
    const proposal = proposalOf(p, id);
    if (proposal.issue) throw clientError(`Already filed as #${proposal.issue}.`);
    const data = backlog.readBacklog(ctx.ws.backlog, p.id);
    if (!data) throw clientError('Sync the backlog first: the issue is filed in the synced repository.');
    const draft = asClient(() => refactorIssues.issueDraft({ root: root(), project: p, proposal, data }));
    if (preview || simulation.simulationOnly()) return { preview: true, command: draft.command.display, body: draft.body, proposal };
    const stored = await refactorIssues.createIssue({ root: root(), backlogDir: ctx.ws.backlog, project: p, proposal, draft });
    return { preview: false, command: draft.command.display, body: draft.body, proposal: stored };
  }

  // ---- the ranking -------------------------------------------------------------------------------
  async function prioritize({ projectId, mock }) {
    const p = projectOf(projectId);
    if (prioritizing.has(p.id)) throw clientError('The Product Owner is already prioritizing the proposals of this project.');
    prioritizing.add(p.id);
    try {
      const simulated = !!mock || simulation.simulationOnly();
      const { saved } = await priority.rankProject({ refactorRoot: root(), backlogDir: ctx.ws.backlog, projectId: p.id, model: await modelOf(p), mock: simulated, options: () => realOptions(p) });
      return saved;
    } finally {
      prioritizing.delete(p.id);
    }
  }
  // what a real turn reads: the Product Owner's agent, folder, skills and budget (channels/product-owner.js),
  // without the synced backlog: the ranking reads no issue
  function realOptions(p) {
    const o = asClient(() => ctx.productOwnerAgentOptions(p.id, false));
    return { mock: false, backlogDir: o.backlogDir, projectId: p.id, folder: o.folder, agent: o.agent || agentsMod.readAgent(ctx.ws.agents, agentsMod.PRODUCT_OWNER_ID), skillsDirs: o.skillsDirs, resolveCommand: o.resolveCommand, budget: o.budget, language: o.language };
  }
  // #378: the Refactor proposals workflow's prioritize step ranks with the same Product Owner (runs.js)
  ctx.refactorPriorityOptions = (projectId) => realOptions(projectOf(projectId));

  // ---- after a run -------------------------------------------------------------------------------
  // a finished refactor run: the proposal of its issue gets the target's score after it
  async function recordOutcome(p, summary) {
    if (summary.workflow !== WORKFLOW_NAME || summary.status !== 'success') return;
    const numbers = new Set(numbersOf(summary.issues));
    const open = proposals.listProposals(root(), p.id).filter((x) => x.before && !x.outcome && numbers.has(Number(x.issue)));
    if (!open.length) return;
    const model = await modelOf(p, { refresh: true });
    for (const x of open) {
      const after = outcomes.fileScore(model, x.before.file || filesOf(x)[0]);
      if (after) proposals.updateProposal(root(), p.id, x.id, { outcome: { ...outcomes.refactorOutcome(x.before, after), after, runId: summary.run_id || null, at: new Date().toISOString() } });
    }
  }

  // the project's runs, with the finished one counted even when the run index does not list it yet
  function runsWith(p, summary) {
    const list = projectRuns(p);
    if (!summary.run_id || list.some((r) => r.runId === summary.run_id)) return list;
    return [...list, { runId: summary.run_id, projectId: p.id, mock: false, status: summary.status || 'success', finishedAt: summary.finished_at || new Date().toISOString() }];
  }

  async function afterRun(summary) {
    if (!ctx.ws) return; // the workspace closed meanwhile
    let p;
    try { p = projectOf(summary.project_id); } catch { return; }
    await recordOutcome(p, summary);
    if (!ctx.ws) return;
    const c = readCadence(p.id);
    if (!c.on || cadenceRules.runsUntilNext({ runs: runsWith(p, summary), project: p, every: c.every, since: c.since }) > 0) return;
    const next = cadenceRules.pickNext(proposals.listProposals(root(), p.id), roadmapOf(p.id));
    if (!next) return; // nothing ready: the tab says so, the next run tries again
    await addToRoadmap(p, next);
    saveCadence(p.id, { on: c.on, every: c.every, since: new Date().toISOString() });
  }

  function onRunFinished(ev) {
    const summary = ev?.type === 'workflow.finished' ? ev.summary : null;
    if (!summary || summary.mock || !summary.project_id || !ctx.ws) return;
    const t = setTimeout(() => afterRun(summary).catch((e) => console.error('Refactor cadence:', e.message)), AFTER_RUN_MS);
    t.unref?.();
  }
  ctx.events?.on?.('run:event', onRunFinished);

  return [
    {
      channel: 'refactor:proposals',
      method: 'refactorProposals',
      params: ['projectId'],
      schema: { params: ON_PROJECT, result: listOf(OBJECT) },
      fn: ({ projectId }) => {
        const p = projectOf(projectId);
        const roadmap = roadmapOf(p.id);
        return cadenceRules.withIssueStatus(proposals.listProposals(root(), p.id), roadmaps.issueStages(roadmap), syncedIssues(p.id), cadenceRules.unfinishedNumbers(roadmap));
      },
    },
    {
      channel: 'refactor:add',
      method: 'addRefactorProposal',
      params: ['projectId', '...opts'],
      schema: { params: args({ projectId: PROJECT_ID, target: STRING, improvement: STRING, evidence: STRING }, ['projectId', 'target', 'improvement']), result: PROPOSAL },
      fn: ({ projectId, target, improvement, evidence }) => {
        const p = projectOf(projectId);
        const t = text(target, 500);
        const what = text(improvement, 500);
        if (!t || !what) throw clientError('A proposal needs its target (a file or a folder) and the improvement expected.');
        const key = `owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        return proposals.addProposal(root(), p.id, { source: 'owner', key, title: what, target: t, improvement: what, evidence: text(evidence), files: [t] });
      },
    },
    {
      channel: 'refactor:dismiss',
      method: 'dismissRefactorProposal',
      params: ['projectId', 'id', 'reason'],
      schema: { params: ON_PROPOSAL({ reason: textOf(2000,'Why the proposal is dismissed (kept on the proposal).') }, ['reason']), result: PROPOSAL },
      fn: ({ projectId, id, reason }) => {
        const p = projectOf(projectId);
        proposalOf(p, id);
        return asClient(() => proposals.dismissProposal(root(), p.id, id, reason));
      },
    },
    {
      channel: 'refactor:prioritize',
      method: 'prioritizeRefactors',
      params: ['projectId', '...opts'],
      schema: { params: args({ projectId: PROJECT_ID, mock: FLAG }, ['projectId']), result: RANKING },
      fn: prioritize,
    },
    {
      channel: 'refactor:file',
      method: 'fileRefactorIssue',
      params: ['projectId', 'id', '...opts'],
      schema: { params: ON_PROPOSAL({ preview: FLAG }), result: shape({ preview: BOOL, command: STRING, body: STRING, proposal: PROPOSAL }, ['preview', 'proposal']) },
      fn: fileIssue,
    },
    {
      channel: 'refactor:addToRoadmap',
      method: 'addRefactorToRoadmap',
      params: ['projectId', 'id'],
      schema: { params: ON_PROPOSAL(), result: shape({ proposal: PROPOSAL, stage: INT }, ['proposal', 'stage']) },
      fn: ({ projectId, id }) => {
        const p = projectOf(projectId);
        return addToRoadmap(p, proposalOf(p, id));
      },
    },
    {
      channel: 'refactor:cadence',
      method: 'refactorCadence',
      params: ['projectId'],
      schema: { params: ON_PROJECT, result: CADENCE },
      fn: ({ projectId }) => cadenceView(projectOf(projectId)),
    },
    {
      channel: 'refactor:setCadence',
      method: 'setRefactorCadence',
      params: ['projectId', 'on', 'every'],
      schema: { params: args({ projectId: PROJECT_ID, on: BOOL, every: INT }, ['projectId', 'on', 'every']), result: CADENCE },
      fn: ({ projectId, on, every }) => {
        const p = projectOf(projectId);
        const next = asClient(() => cadenceRules.cleanCadence({ on, every }));
        const was = readCadence(p.id);
        // the count starts when the cadence is turned on
        saveCadence(p.id, { ...next, since: next.on && !was.on ? new Date().toISOString() : was.since });
        return cadenceView(p);
      },
    },
  ];
};
