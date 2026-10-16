// The Refactor proposals workflow's work (#378, workflows/refactor-proposals.yaml), the Refactor tab's
// rules (#357) run without the tab: each function is one machine step of src/engine/run/
// refactor-proposals-steps.js, on the project's folder and the workspace's stores.
// - facts: the Architecture facts (#356) at the default branch, the files changed since `since` (a tag
//   or a commit) and the analyst's prompt (#356's analysisPrompt, focused on the Danger Zone and on
//   the changed files);
// - propose: the report's findings added to the Refactor tab's proposals (<workspace>/refactor), as
//   "Send to Refactor" adds them; a finding that matches a proposal (open or dismissed) or an open
//   `refactor` issue of the synced backlog is dropped, with the reason;
// - rank: #357's Product Owner ranking of the open proposals (saved as the tab saves it), the run's
//   new proposals in rank order, the top `limit` kept;
// - file: the kept proposals filed as `refactor` issues naming the Refactor workflow
//   (src/refactor-issues.js); a proposal dismissed since the ranking (the owner's "drop" at the
//   gate) is skipped. A simulation previews: no gh/glab, simulated numbers so a pipeline's next
//   stage reads them.

'use strict';

const path = require('path');
const arch = require('./oracle-architecture');
const backlog = require('./backlog');
const conflictMaps = require('./conflict-map');
const facts = require('./architecture-facts');
const priority = require('./refactor-priority');
const projects = require('./projects');
const proposals = require('./refactor-proposals');
const refactorIssues = require('./refactor-issues');
const roadmaps = require('./roadmap');
const { filesOf } = require('./refactor-cadence');
const { unfinishedItems } = require('./shared/roadmap-model');

const DANGER_ROWS = 10;

/** The workspace's folders of the run: { refactor, architecture, backlog, projects }. */
const storesOf = (wsRoot) => ({
  architecture: path.join(wsRoot, 'architecture'),
  backlog: path.join(wsRoot, 'backlog'),
  projects: path.join(wsRoot, 'projects'),
  refactor: path.join(wsRoot, 'refactor'),
});

function projectOf(stores, projectId, folder) {
  try { return projects.readProject(stores.projects, projectId); } catch { return { id: projectId, name: projectId, folder }; }
}

const notGit = (folder, state) => new Error(`${folder} has no architecture facts (${state}): the folder must be a git repository with commits.`);

async function modelOf(folder, stores, projectId) {
  const { state, model } = await facts.readFacts(folder, { exclude: arch.readSettings(stores.architecture, projectId).exclude });
  if (state !== 'ok') throw notGit(folder, state);
  return model;
}

/**
 * The facts step: { branch, head, since, changed: [path], danger_zone: ['<file>: <score>'], prompt }.
 * An unknown `since` is said (`since_unknown`), the analysis then covers the Danger Zone only.
 */
async function readRunFacts({ folder, wsRoot, projectId, since }) {
  const stores = storesOf(wsRoot);
  const model = await modelOf(folder, stores, projectId);
  const diff = await facts.changedSince(folder, since);
  const changed = diff?.files || [];
  const danger = (model.danger_zone || []).slice(0, DANGER_ROWS).map((r) => `${r.file}: ${r.score}`);
  const focus = [
    '',
    '## Focus of this run (the Refactor proposals workflow)',
    'Read the files with your own read-only tools in the current folder (the project\'s checkout).',
    `Danger Zone (complex code that changes often, score = churn x complexity): ${danger.join(', ') || 'none measured'}.`,
    since ? (diff?.files ? `Files changed since ${since}: ${changed.join(', ') || 'none'}.` : `"${since}" is not a tag or a commit of the repository: focus on the Danger Zone.`) : 'No release to compare with: focus on the Danger Zone.',
    'Report the findings on these files first: at most 5 findings, each one refactor sized as one issue.',
  ];
  return {
    branch: model.branch,
    head: model.head?.commit || diff?.head || null,
    since: since || null,
    ...(since && !diff?.files ? { since_unknown: true } : {}),
    changed,
    danger_zone: danger,
    prompt: `${arch.analysisPrompt({ project: projectOf(stores, projectId, folder), model })}\n${focus.join('\n')}`,
  };
}

const labelName = (l) => String(typeof l === 'string' ? l : l?.name || '').toLowerCase();
// the synced backlog's open `refactor` issues
function openRefactorIssues(stores, projectId) {
  const issues = backlog.readBacklog(stores.backlog, projectId)?.issues || [];
  return issues.filter((i) => String(i.state || 'open').toLowerCase() === 'open' && (i.labels || []).some((l) => labelName(l) === refactorIssues.LABEL));
}

/**
 * The propose step: the report's findings added to the Refactor tab's proposals.
 * → { added: [{ id, title }], dropped: [{ id, title, status, reason }] }
 */
function proposeFindings({ wsRoot, projectId, report, runId }) {
  const stores = storesOf(wsRoot);
  const checked = arch.validateReport(report);
  if (checked.error) throw new Error(checked.error);
  const issues = openRefactorIssues(stores, projectId);
  const added = [];
  const dropped = [];
  for (const finding of checked.report.findings) {
    const { kind, title, files, evidence, severity, refactor } = finding;
    const key = arch.findingKey(finding);
    const known = proposals.listProposals(stores.refactor, projectId).find((p) => p.source === 'architecture' && p.key === key);
    if (known) {
      dropped.push({ id: known.id, title: known.title, status: known.status, reason: known.status === 'dismissed' ? `dismissed: ${known.dismissReason || 'no reason'}` : 'an open proposal already' });
      continue;
    }
    const paths = (files || []).map((f) => f.path);
    const issue = issues.find((i) => paths.some((p) => `${i.title || ''}\n${i.body || ''}`.includes(p)));
    if (issue) {
      dropped.push({ id: null, title, status: 'issue', issue: issue.number, reason: `the open refactor issue #${issue.number} names its files` });
      continue;
    }
    const stored = proposals.addProposal(stores.refactor, projectId, { source: 'architecture', key, reportId: runId ? `run:${runId}` : null, kind, title, files, evidence, severity, refactor });
    added.push({ id: stored.id, title: stored.title });
  }
  return { added, dropped };
}

/**
 * The prioritize step: the Product Owner's ranking of the open proposals, saved as the Refactor tab
 * saves it; the run's new proposals (`ids`) in rank order, the first `limit` kept.
 * `options`: the Product Owner's turn (the service's, refactor:prioritize's realOptions), unless `mock`.
 * → { ranked: [{ id, title, rank, reason, complexity, files }], kept: [id], limit, cost_usd, simulated }
 */
async function rankProposals({ folder, wsRoot, projectId, ids, limit, mock, options }) {
  const stores = storesOf(wsRoot);
  const wanted = new Set(ids || []);
  const empty = { ranked: [], kept: [], limit, cost_usd: 0, simulated: !!mock };
  if (!wanted.size) return empty;
  if (!mock && !options) throw new Error('The Product Owner is not available to this run: the ranking needs the app service.');
  const list = proposals.listProposals(stores.refactor, projectId);
  const model = await modelOf(folder, stores, projectId).catch(() => null);
  const dangerScores = Object.fromEntries((model?.danger_zone || []).map((r) => [r.file, r.score]));
  const unfinished = unfinishedItems(roadmaps.readRoadmap(stores.backlog, projectId)).map((x) => ({ issue: Number(x.issues?.[0]?.number ?? x.issues?.[0] ?? x.number) || null, files: [] }));
  const hotSpots = conflictMaps.hotSpots(conflictMaps.readConflictMap(stores.backlog, projectId));
  const answer = await priority.prioritize({ proposals: list, unfinished, dangerScores, hotSpots, ...(mock ? { mock: true } : options) });
  const errors = priority.validatePriority({ ranking: answer.ranking });
  if (errors.length) throw new Error(`The Product Owner's ranking is not valid: ${errors.join('; ')}`);
  proposals.saveRanking(stores.refactor, projectId, { ranking: answer.ranking }, { at: new Date().toISOString(), costUsd: answer.costUsd || 0 });
  const byId = new Map(list.map((p) => [p.id, p]));
  const ranked = answer.ranking.filter((r) => wanted.has(r.id)).sort((a, b) => a.rank - b.rank)
    .map((r) => ({ id: r.id, title: byId.get(r.id)?.title || r.id, rank: r.rank, reason: r.reason, complexity: r.complexity, files: filesOf(byId.get(r.id) || {}) }));
  return { ranked, kept: ranked.slice(0, Math.max(0, Number(limit) || 0)).map((r) => r.id), limit, cost_usd: answer.costUsd || 0, simulated: !!mock };
}

/**
 * The file step: the kept proposals filed as `refactor` issues (a simulation previews them).
 * → { issues: [{ number, url, title }], skipped: [{ id, title, reason }], label, workflow, preview, simulated, message }
 */
async function fileProposals({ wsRoot, projectId, folder, ids, simulated }) {
  const stores = storesOf(wsRoot);
  const project = projectOf(stores, projectId, folder);
  const data = backlog.readBacklog(stores.backlog, projectId);
  if (!simulated && (ids || []).length && !data) throw new Error('Sync the backlog first: the issues are filed in the synced repository.');
  const issues = [];
  const skipped = [];
  for (const id of ids || []) {
    const proposal = proposals.listProposals(stores.refactor, projectId).find((p) => p.id === id);
    if (!proposal || proposal.status === 'dismissed') {
      skipped.push({ id, title: proposal?.title || id, reason: proposal ? `dismissed: ${proposal.dismissReason || 'no reason'}` : 'no longer listed' });
      continue;
    }
    if (proposal.issue) {
      skipped.push({ id, title: proposal.title, reason: `filed already as #${proposal.issue}` });
      continue;
    }
    if (simulated) {
      let command = null;
      try { command = data ? refactorIssues.issueDraft({ root: stores.refactor, project, proposal, data }).command.display : null; } catch { /* a preview without the repository's command */ }
      issues.push({ number: issues.length + 1, url: '', title: refactorIssues.issueTitle(proposal), simulated: true, proposal: id, body: refactorIssues.issueText(proposal), ...(command ? { command } : {}) });
      continue;
    }
    const draft = refactorIssues.issueDraft({ root: stores.refactor, project, proposal, data });
    const stored = await refactorIssues.createIssue({ root: stores.refactor, backlogDir: stores.backlog, project, proposal, draft });
    issues.push({ number: stored.issue, url: stored.issueUrl || '', title: draft.title, proposal: id });
  }
  const what = `${issues.length} issue(s) with the \`${refactorIssues.LABEL}\` label, run with the Refactor workflow (${refactorIssues.WORKFLOW})`;
  return {
    issues,
    skipped,
    label: refactorIssues.LABEL,
    workflow: refactorIssues.WORKFLOW,
    preview: !!simulated,
    simulated: !!simulated,
    message: simulated ? `Simulated preview, nothing filed with gh/glab: ${what}.` : `Filed ${what}.`,
  };
}

module.exports = {
  fileProposals,
  proposeFindings,
  rankProposals,
  readRunFacts,
  storesOf,
};
