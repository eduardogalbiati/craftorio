// A refactor proposal filed as an issue (#357 "File as issue", shared with the Refactor proposals
// workflow, #378): the issue's text as the issue-writing skill lays it out (context, target, tasks,
// acceptance criteria, the Refactor workflow named), the `refactor` label (created first when the
// platform reads labels, as src/domains/backlog/epics.js does for `epic`; GitLab creates it on filing) and the
// gh/glab command of the synced repository. issueDraft builds it without running anything (the
// preview, and every simulation); createIssue runs it, records the issue on the proposal and syncs
// the backlog. Used by src/service/channels/refactor.js and src/domains/refactor/refactor-proposals-run.js.

'use strict';

const fs = require('fs');
const path = require('path');
const backlog = require('../backlog/backlog');
const proposals = require('./refactor-proposals');
const { adapterOf, cliTarget } = require('../backlog/issues');
const { filesOf } = require('./refactor-cadence');

const LABEL = 'refactor';
const LABEL_COLOR = '0E8A16';
const WORKFLOW = 'refactor.yaml';

/** The issue's body of proposal `x`. */
function issueText(x) {
  const files = filesOf(x);
  const evidence = typeof x.evidence === 'string' ? x.evidence : (x.evidence || []).map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n- ');
  return [
    '## Context', evidence ? `- ${evidence}` : 'Proposed on the Refactor tab.',
    '## Target', files.map((f) => `- \`${f}\``).join('\n') || '- (none named)',
    '## Expected improvement', x.refactor || x.improvement || x.title,
    '## Tasks', '- [ ] Pin the current behaviour with tests before moving code\n- [ ] Make the change in small steps, the tests green after each',
    '## Acceptance criteria', '- [ ] The behaviour is unchanged: the pinned tests pass\n- [ ] The target leaves the Danger Zone, or its score drops (Architecture tab)',
    `Run it with the Refactor workflow (\`workflows/${WORKFLOW}\`).`,
  ].join('\n\n');
}

/** The issue's title of proposal `x`. */
const issueTitle = (x) => `Refactor: ${x.title || x.improvement || x.target}`.slice(0, 200);

/**
 * What filing proposal `proposal` runs, without running it: { platform, repo, title, body, file,
 * command }. `data`: the project's synced backlog (src/domains/backlog/backlog.js readBacklog). Throws when the
 * platform refuses the command (a client's mistake).
 */
function issueDraft({ root, project, proposal, data, now = new Date() }) {
  const platform = data.platform || backlog.DEFAULT_PLATFORM;
  const repo = data.repo || project.repo;
  const title = issueTitle(proposal);
  const body = issueText(proposal);
  const file = path.join(root, path.basename(project.id), 'filed', `${now.toISOString().replace(/[:.]/g, '-')}-${proposal.id}.md`);
  const command = backlog.issueCreateCommand({ platform, repo, title, labels: [LABEL], file, text: body });
  return { platform, repo, title, body, file, command };
}

async function ensureLabel({ platform, repo, run }) {
  const a = adapterOf(platform);
  if (!a?.readsLabels) return; // GitLab creates a missing label on filing
  const known = await backlog.repoLabels({ platform, repo });
  if ((known || []).some((n) => n.toLowerCase() === LABEL)) return;
  const c = a.labelCreateCommand({ target: cliTarget(platform, repo), name: LABEL, color: LABEL_COLOR, description: 'A refactor with the behaviour pinned (the Refactor workflow)', force: true });
  if (c) await run(c);
}

/**
 * Files `draft` (issueDraft's) with gh/glab: the stored proposal with its `issue` and `issueUrl`.
 * Never in a simulation (the caller previews instead). Throws when the issue's number cannot be read.
 */
async function createIssue({ root, backlogDir, project, proposal, draft }) {
  const run = (c) => backlog.execCli(c.cli, c.args);
  await ensureLabel({ platform: draft.platform, repo: draft.repo, run });
  fs.mkdirSync(path.dirname(draft.file), { recursive: true });
  fs.writeFileSync(draft.file, draft.body);
  const url = String(await run(draft.command) || '').match(/https?:\/\/\S+/)?.[0] || null;
  const number = Number(url?.match(/\/(\d+)\/?$/)?.[1]) || null;
  if (!number) throw new Error(`The issue was filed but its number could not be read${url ? ` from ${url}` : ''}: sync the backlog and link it.`);
  const stored = proposals.updateProposal(root, project.id, proposal.id, { issue: number, issueUrl: url });
  try { await backlog.syncBacklog({ dir: backlogDir, project, platform: draft.platform }); } catch (e) { console.error('Refactor issue sync:', e.message); }
  return stored;
}

module.exports = {
  createIssue,
  issueDraft,
  issueText,
  issueTitle,
  LABEL,
  WORKFLOW,
};
