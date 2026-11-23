// The command that files a Product Owner draft (split from packages/engine/domains/po/product-owner.js fileDraft):
// 'create' a new issue, or 'append' / 'comment' on an existing one. With a repository it is the platform CLI's
// command (gh / glab, packages/engine/domains/backlog/issues.js); with none (#35) it adds to the local backlog
// (packages/engine/domains/backlog/local-backlog.js: a { local, display, run } command, nothing leaves the machine).
// A preview reads nothing from the platform.

const path = require('path');
const backlog = require('../backlog/backlog');
const Language = require('@craftorio/shared/language');

// The body filed for a new issue: the draft, with its Related line (in any language, #328) when the body has none.
const createBody = (draft, issuesLanguage) => (draft.related.length && !Language.relatedPattern().test(draft.body)
  ? `${draft.body}\n\n${Language.issueHeadings(issuesLanguage).related} ${draft.related.map((n) => `#${n}`).join(', ')}\n` : `${draft.body}\n`);

// A new issue: gh refuses a label the repository does not have, so it is filed without it (skippedLabels).
async function createCommand({ issue, preview, platform, repo, backlogDir, projectId, dir, stamp, issuesLanguage, exec }) {
  if (!issue.draft) throw new Error('There is no draft to file yet.');
  const body = createBody(issue.draft, issuesLanguage);
  let labels = issue.draft.labels;
  let skippedLabels = [];
  const names = preview || !repo ? null : await backlog.repoLabels({ platform, repo, exec });
  if (names) { skippedLabels = labels.filter((l) => !names.includes(l)); labels = labels.filter((l) => names.includes(l)); }
  const file = path.join(dir, `${stamp}-new.md`);
  const command = (repo ? backlog.issueCreateCommand : backlog.localCreateCommand)({ dir: backlogDir, projectId, platform, repo, title: issue.draft.title, labels, file, text: body });
  return { command, body, file, target: null, skippedLabels };
}

// An addition to issue `number` (default: the draft's existing issue): a dated section at the end of its body, or a comment.
async function addCommand({ action, issue, number, preview, platform, repo, cached, backlogDir, projectId, dir, stamp, timeZone, exec }) {
  const target = Number(number) || issue.existingIssue;
  if (!target) throw new Error('Pick the issue to add to.');
  const addition = issue.existingIssue === target && issue.addition ? issue.addition : issue.draft ? `### ${issue.draft.title}\n\n${issue.draft.body}` : '';
  if (!addition) throw new Error('There is nothing to add yet.');
  const original = action === 'comment' ? null : preview || !repo ? cached?.body : (await backlog.fetchIssue({ platform, repo, number: target, exec })).body;
  const body = action === 'comment' ? `${addition}\n` : backlog.issueAppendBody({ original, addition, timeZone });
  const file = path.join(dir, `${stamp}-${target}.md`);
  const command = (repo ? backlog.issueSaveCommand : backlog.localSaveCommand)({ dir: backlogDir, projectId, platform, repo, number: target, mode: action === 'comment' ? 'comment' : 'replace', file, text: body });
  return { command, body, file, target, skippedLabels: [] };
}

/** { command, body, file, target, skippedLabels } for a draft's `action`. */
const draftCommand = (args) => (args.action === 'create' ? createCommand(args) : addCommand(args));

module.exports = {
  createBody,
  draftCommand,
};
