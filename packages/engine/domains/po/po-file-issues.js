'use strict';
// The Product Owner's proposals that become new issues on the owner's click, recorded in the
// conversation: a conflict map's hot spot (#150, decongestIssue, fileDecongest) and the issues a spec
// proposed (#670, fileSpec, refused while a mockup in scope has no issue). Moved out of
// product-owner.js (file size ratchet, #334): `conv` is its conversation ({ appendMessage, applyDir,
// planAnswer, readConversation }).
const fs = require('fs');
const path = require('path');
const backlog = require('../backlog/backlog');
const I18n = require('@craftorio/shared/i18n'); // #41: a preview reads in the interface language

/** #150: the issue a hot spot of an answer's `decongest` becomes: { title, body }. */
function decongestIssue(d) {
  const where = d.line ? `${d.file}:${d.line}` : d.file;
  return {
    title: `Decongest ${where}: ${d.line ? 'a line' : 'a file'} most runs edit`,
    body: [
      `The conflict map shows that ${d.runs && d.of ? `${d.runs} of the last ${d.of} runs` : 'most runs'} changed \`${where}\`: parallel runs collide there when they merge.`,
      '',
      '## Suggested fix',
      '',
      d.fix || 'Split it so each feature edits its own file or line.',
      '',
      '_Proposed by the Product Owner from the conflict map (#150)._',
    ].join('\n'),
  };
}

/**
 * Files one hot spot of an answer's `decongest` (its `index`) as an issue, on the owner's click, and
 * records it in the conversation (`decongestFiled`). `preview`: the command only, nothing filed.
 */
async function fileDecongest(conv, { backlogDir, projectId, runsDir, at, index, preview, platform, repo, exec = backlog.execCli }) {
  const messages = conv.readConversation(backlogDir, projectId);
  const answer = conv.planAnswer(messages, at);
  const d = (answer.answer.decongest || [])[Number(index)];
  if (!d) throw new Error('That answer proposes no such fix.');
  if (messages.some((m) => m.decongestFiled && m.decongestFiled.at === at && m.decongestFiled.index === Number(index) && !m.decongestFiled.preview)) throw new Error('This fix was already filed as an issue.');
  const issue = decongestIssue(d);
  const dir = conv.applyDir({ backlogDir, projectId, runsDir }, 'decongest');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'issue.md');
  fs.writeFileSync(file, issue.body);
  const cmd = backlog.issueCreateCommand({ platform, repo, title: issue.title, labels: [], file, text: issue.body });
  const url = preview ? null : String(await exec(cmd.cli, cmd.args) || '').trim();
  const text = preview
    ? `${I18n.t('po.filed_preview_list')}\n- \`${cmd.display}\``
    : `Filed ${url ? `[${issue.title}](${url})` : issue.title}.`;
  const message = conv.appendMessage(backlogDir, projectId, {
    role: 'po', text, decongestFiled: { at, index: Number(index), title: issue.title, ...(url ? { url } : {}), ...(preview ? { preview: true } : {}) },
  });
  return { message, messages: conv.readConversation(backlogDir, projectId), ...(preview ? { preview: true } : {}) };
}

/**
 * #670: files the issues an answer proposed from a spec (its `spec`), on the owner's click, and records
 * them in the conversation (`specFiled`: { at, issues: [{ title, number?, url? }] }). Refused while a
 * mockup in scope has no issue. `preview`: the commands only, nothing filed.
 */
async function fileSpec(conv, { backlogDir, projectId, runsDir, at, preview, platform, repo, exec = backlog.execCli }) {
  const messages = conv.readConversation(backlogDir, projectId);
  const spec = conv.planAnswer(messages, at).answer.spec;
  if (!spec?.issues?.length) throw new Error('That answer proposes no issue from a spec.');
  if (spec.coverage && !spec.coverage.ok) throw new Error(`Every mockup in scope needs an issue first: ${spec.coverage.errors.join('; ')}.`);
  if (messages.some((m) => m.specFiled && m.specFiled.at === at && !m.specFiled.preview)) throw new Error('These issues were already filed.');
  const dir = conv.applyDir({ backlogDir, projectId, runsDir }, 'spec');
  fs.mkdirSync(dir, { recursive: true });
  const filed = [];
  const commands = [];
  for (const [n, issue] of spec.issues.entries()) {
    const file = path.join(dir, `issue-${n + 1}.md`);
    fs.writeFileSync(file, issue.body);
    const cmd = backlog.issueCreateCommand({ platform, repo, title: issue.title, labels: [], file, text: issue.body });
    commands.push(cmd.display);
    if (preview) continue;
    const url = String(await exec(cmd.cli, cmd.args) || '').trim();
    const number = Number((url.match(/\/(?:issues|work_items)\/(\d+)/) || [])[1]) || null;
    filed.push({ title: issue.title, ...(number ? { number } : {}), ...(url ? { url } : {}) });
  }
  const text = preview
    ? `${I18n.t('po.filed_preview_list')}\n${commands.map((c) => `- \`${c}\``).join('\n')}`
    : `Filed ${filed.map((i) => (i.url ? `[${i.title}](${i.url})` : i.title)).join(', ')}.`;
  const message = conv.appendMessage(backlogDir, projectId, {
    role: 'po', text, specFiled: { at, item: spec.item, issues: filed, ...(preview ? { preview: true } : {}) },
  });
  return { message, messages: conv.readConversation(backlogDir, projectId), issues: filed, ...(preview ? { preview: true } : {}) };
}

module.exports = {
  decongestIssue,
  fileDecongest,
  fileSpec,
};
