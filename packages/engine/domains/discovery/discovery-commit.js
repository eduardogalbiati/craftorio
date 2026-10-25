// The commitment point of the discovery side (#258): a Ready card with a clarity score of at least
// 85% (COMMIT_BAR: the owner's decision, not the project's bar into Ready, which an override can
// pass) becomes delivery work, one or several issues in the Backlog, and follows them to the release.
//   checkCommit(card)        whether the card may be committed: { ok, score, bar, gaps, reason }
//   proposeSplit(card)       the deterministic proposal: the tasks of acceptance.md (its `- [ ]`
//                            lines, else its list items) in one issue, or in two to four when they
//                            are too many for one run (the Product Owner's split rules, packages/engine/domains/po/po-split.js);
//                            the simulated answer, and the fallback for a model's unusable one
//   normalizeSplit(raw, …)   a model's proposal kept to the card: only tasks the card has, each once
//   checkSplit(split)        the proposal the owner confirmed (titles, tasks, complexity and workflow
//                            may all have been edited), cleaned; throws when it files nothing
//   commitCard(…)            (`preview`: checks everything and answers with the commands it would
//                            run, files and commits nothing: the screen's developer mode)
//                            files each issue (gh/glab issue create, the issue-writing layout: where it
//                            comes from, its tasks, the card's document as evidence; the first line
//                            is "From discovery card <id>"), then commits the card in the store
//                            (packages/engine/domains/discovery/discovery.js markCommitted: links.issues, off the board). Nothing is
//                            filed for a card that is refused. The text of each issue is kept in the
//                            card's filed/ folder.
//   simulatedExec(…)         the CLI of a simulated commit: no gh/glab, each issue joins the project's
//                            synced backlog with the next free number
//   cardDelivery(card, issues, releases)
//                            a committed card's progress from the Backlog's issues (their `column`):
//                            counts { todo, running (in progress or waiting), local, done } and the
//                            stage: in_delivery, delivered (every issue done), released (every issue in
//                            a shipped release, packages/engine/domains/releases/releases.js)
// Service: packages/engine/service/channels/discovery.js (discovery:commit-proposal, discovery:commit, the board's
// `committed` list); screen: apps/desktop/renderer/views/discovery/discovery-commit.js.

const fs = require('fs');
const path = require('path');
const backlog = require('../backlog/backlog');
const discovery = require('./discovery');
const Language = require('@multiagent/shared/language');
const poSplit = require('../po/po-split');
const { platformOrDefault } = require('@multiagent/shared/platforms');

const { COMMIT_BAR } = discovery;
const MAX_ISSUES = 8;
// the labels a commit gives an issue: its kind and its complexity (issueLabels)
const KINDS = ['bug', 'enhancement'];
const MAX_TITLE = 200;
// the card's document, as an issue's evidence: its first characters (the card itself stays private)
const EVIDENCE_CLIP = 4000;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/;
const DELIVERY_STAGES = ['in_delivery', 'delivered', 'released'];

const refs = (numbers) => numbers.map((n) => `#${n}`).join(', ');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/**
 * Whether a card may be committed: in Ready, scored, at or above the commit bar.
 * @returns {{ ok: boolean, score: number|null, bar: number, gaps: string[], reason: string|null }} reason: why not
 */
function checkCommit(card) {
  const score = typeof card?.clarity?.score === 'number' ? card.clarity.score : null;
  const gaps = (Array.isArray(card?.clarity?.gaps) ? card.clarity.gaps : []).map((g) => String(g?.text ?? g).trim()).filter(Boolean);
  let reason = null;
  if (card?.column === discovery.COMMITTED) reason = `This card is already committed${card.links?.issues?.length ? ` (${refs(card.links.issues)})` : ''}: new learning is a new card linked to it.`;
  else if (card?.column !== 'ready') reason = 'Only a Ready card is committed to the backlog.';
  else if (score === null) reason = `This card has no clarity score yet: a card is committed from ${COMMIT_BAR}%.`;
  else if (score < COMMIT_BAR) reason = `Its clarity is ${score}%: a card is committed from ${COMMIT_BAR}%.${gaps.length ? ` Still open: ${gaps.join('; ')}.` : ''} Close the gaps (Grill me) first.`;
  return { ok: !reason, score, bar: COMMIT_BAR, gaps, reason };
}

// ---- the proposed split ------------------------------------------------------------------------------

// The card's tasks with the heading each sits under: the task lines of acceptance.md, else its list items.
function taskList(card) {
  const text = String(card?.acceptance || '');
  const boxes = poSplit.parentTasks(text).filter((t) => t.text).map((t) => ({ text: t.text, part: t.part }));
  if (boxes.length) return boxes;
  return text.replace(/\r\n/g, '\n').split('\n').map((l) => l.match(LIST_ITEM)?.[1]).filter(Boolean).map((t) => ({ text: t, part: null }));
}

/** The card's tasks, in order: the task lines of acceptance.md, else its list items, as texts. */
const cardTasks = (card) => taskList(card).map((t) => t.text);

// The size of an issue from its number of tasks, when nobody gave one (1 to 5).
const sizeOf = (count) => Math.max(1, Math.min(5, Math.ceil(count / 2)));
const complexityOf = (n, count) => (Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= 5 ? Number(n) : sizeOf(count));
const workflowOf = (w) => (typeof w === 'string' && w.trim() ? path.basename(w.trim()) : null);

/**
 * The deterministic proposal for a card: { issues: [{ title, tasks, complexity, workflow, reason }] }.
 * One issue with every task; two to four when the Product Owner's rules find it too big for one run.
 */
function proposeSplit(card, { workflow = null } = {}) {
  const title = String(card?.title || '').trim();
  const list = taskList(card);
  const tasks = list.map((t) => t.text);
  const wf = workflowOf(workflow);
  // the task list as the split rules read an issue's: a checklist under the criteria's own headings
  const asIssue = { number: null, title, body: list.map((t, i) => `${t.part && t.part !== list[i - 1]?.part ? `## ${t.part}\n` : ''}- [ ] ${t.text}`).join('\n') };
  const split = poSplit.proposeSplit(asIssue, { complexity: sizeOf(tasks.length) });
  if (!split) return { issues: [{ title, tasks: tasks.length ? tasks : [`Deliver "${title}" as the card describes it`], complexity: sizeOf(tasks.length), workflow: wf, reason: '' }] };
  return {
    issues: split.children.map((c) => ({ title: c.title, tasks: c.tasks.map((k) => tasks[k - 1]), complexity: c.complexity, workflow: wf, reason: c.reason })),
  };
}

/**
 * A model's proposal kept to the card: issues with a title, only tasks the card's acceptance
 * criteria hold (a task given twice stays in its first issue, one no issue took joins the last),
 * a complexity from 1 to 5 and a workflow of `workflows` (else `workflow`). Falls back to
 * proposeSplit when nothing usable is left.
 */
function normalizeSplit(raw, card, { workflow = null, workflows = [] } = {}) {
  const tasks = cardTasks(card);
  const key = (t) => String(t || '').replace(/^\s*[-*+]\s*(\[[ xX]\]\s*)?/, '').trim().toLowerCase();
  const known = new Map(tasks.map((t) => [key(t), t]));
  const taken = new Set();
  const issues = (Array.isArray(raw?.issues) ? raw.issues : []).slice(0, MAX_ISSUES).map((i) => {
    const mine = [];
    for (const t of Array.isArray(i?.tasks) ? i.tasks : []) {
      const k = key(t);
      // without acceptance criteria the model's own tasks are the only ones
      const text = tasks.length ? known.get(k) : String(t || '').trim();
      if (!text || taken.has(k)) continue;
      taken.add(k);
      mine.push(text);
    }
    const file = workflowOf(i?.workflow);
    return {
      title: String(i?.title || '').trim().slice(0, MAX_TITLE),
      tasks: mine,
      complexity: complexityOf(i?.complexity, mine.length),
      workflow: file && workflows.includes(file) ? file : workflowOf(workflow),
      reason: String(i?.reason || '').trim(),
    };
  }).filter((i) => i.title && i.tasks.length);
  if (!issues.length) return proposeSplit(card, { workflow });
  // (a task of an issue dropped for its missing title is not kept: it is left too)
  const kept = new Set(issues.flatMap((i) => i.tasks.map(key)));
  const left = tasks.filter((t) => !kept.has(key(t)));
  if (left.length) issues[issues.length - 1].tasks.push(...left);
  return { issues };
}

/**
 * The split the owner confirmed, cleaned: [{ title, tasks, complexity, workflow }]. Throws when it
 * has no issue, an issue has no title or no task, or it has more than MAX_ISSUES issues.
 */
function checkSplit(split) {
  const issues = (Array.isArray(split?.issues) ? split.issues : []).map((i) => {
    const tasks = (Array.isArray(i?.tasks) ? i.tasks : []).map((t) => String(t ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return { title: String(i?.title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE), tasks, complexity: complexityOf(i?.complexity, tasks.length), workflow: workflowOf(i?.workflow) };
  });
  if (!issues.length) throw new Error('Nothing to file: a card is committed as at least one issue.');
  if (issues.length > MAX_ISSUES) throw new Error(`A card is committed as at most ${MAX_ISSUES} issues (this split has ${issues.length}).`);
  if (issues.some((i) => !i.title)) throw new Error('Every issue needs a title.');
  const empty = issues.find((i) => !i.tasks.length);
  if (empty) throw new Error(`Every issue needs at least one task: "${empty.title}" has none.`);
  return issues;
}

// ---- filing ------------------------------------------------------------------------------------------

/** An issue's description: where it comes from, its tasks, the card's document as evidence, its siblings (headings in issuesLanguage, #328). */
function issueBody({ card, issue, index, total, siblings = [], issuesLanguage = null }) {
  const h = Language.issueHeadings(issuesLanguage);
  const document = String(card.document || '').replace(/\r\n/g, '\n').trim();
  const clipped = document.length > EVIDENCE_CLIP ? `${document.slice(0, EVIDENCE_CLIP).trimEnd()}\n\n(cut: the card holds the rest)` : document;
  // the card's headings one level down, under "## From the card"
  const evidence = clipped.replace(/^(#{1,5})(?=\s)/gm, '$1#');
  const score = typeof card.clarity?.score === 'number' ? ` Clarity when committed: ${card.clarity.score}%.` : '';
  return [
    `From discovery card ${card.id}`,
    '',
    `"${card.title}"${total > 1 ? `, part ${index + 1} of ${total}` : ''}.${score}`,
    '',
    h.tasks,
    '',
    ...issue.tasks.map((t) => `- [ ] ${t}`),
    ...(evidence ? ['', h.fromCard, '', evidence] : []),
    // the issues filed before this one: the platform shows them the mention, so both sides link
    ...(siblings.length ? ['', `${h.related} ${refs(siblings)} ${h.sameCard}`] : []),
    '',
  ].join('\n');
}

// An issue's labels: its kind from the card's type, and its complexity.
const issueLabels = (card, issue) => [KINDS[['bug', 'hotfix'].includes(card.type) ? 0 : 1], `complexity:${issue.complexity}`];

/**
 * Commits a card on the owner's click: checks the bar and the split, files each issue, then
 * records them on the card, which leaves the board (the card's thread notes it).
 * A refusal (not Ready, under the bar, already committed, an empty split) files nothing. A filing
 * that fails after an issue was filed still commits the card with the issues filed (filing them
 * again would duplicate them): `failed` names the ones left.
 * `preview`: the same checks, then the commands it would run; nothing is filed or committed.
 * @param {{ dir: string, projectId: string, cardId: string, split: { issues: object[] }, platform: string, repo: string, exec?: Function, by?: string, preview?: boolean }} o
 *   dir: the workspace's discovery folder; issuesLanguage (#328): the issues' headings
 * @returns {Promise<{ issues: { number, url, title, tasks, complexity, workflow }[], card: object, skippedLabels?: string[], failed?: { title, error }[], preview?: true, commands?: string[] }>}
 */
async function commitCard({ dir, projectId, cardId, split, platform, repo, exec = backlog.execCli, by = 'owner', preview = false, issuesLanguage = null }) {
  const card = discovery.readCard(dir, projectId, cardId);
  const check = checkCommit(card);
  if (!check.ok) throw new Error(check.reason);
  const wanted = checkSplit(split);
  const folder = discovery.filedDir(dir, projectId, cardId);
  const at = stamp();
  if (preview) {
    const commands = wanted.map((issue, index) => backlog.issueCreateCommand({
      platform, repo, title: issue.title, labels: issueLabels(card, issue), file: path.join(folder, `${at}-issue-${index + 1}.md`), text: issueBody({ card, issue, index, total: wanted.length, issuesLanguage }),
    }).display);
    return { preview: true, commands, issues: [], card };
  }
  const known = await backlog.repoLabels({ platform, repo, exec });
  const skipped = new Set();
  const issues = [];
  const failed = [];
  for (const [index, issue] of wanted.entries()) {
    if (failed.length) { failed.push({ title: issue.title, error: 'Not filed: an issue before it failed.' }); continue; }
    const body = issueBody({ card, issue, index, total: wanted.length, siblings: issues.map((i) => i.number), issuesLanguage });
    let labels = issueLabels(card, issue);
    if (known) { labels.filter((l) => !known.includes(l)).forEach((l) => skipped.add(l)); labels = labels.filter((l) => known.includes(l)); }
    const file = path.join(folder, `${at}-issue-${index + 1}.md`);
    try {
      const command = backlog.issueCreateCommand({ platform, repo, title: issue.title, labels, file, text: body });
      // gh reads the body from it; for glab it is the record of what was sent
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(file, body);
      const url = String(await exec(command.cli, command.args) || '').match(/https?:\/\/\S+/)?.[0] || null;
      const number = Number(url?.match(/\/(\d+)\/?$/)?.[1]) || null;
      // filed, but its number is unknown: it cannot be linked, and trying again could file it twice
      if (!number) throw new Error(`${command.cli} did not answer with the URL of "${issue.title}": look for it in the repository before committing again.`);
      issues.push({ number, url, ...issue });
    } catch (e) {
      // nothing filed yet: the card stays in Ready and the commit can be tried again
      if (!issues.length) throw e;
      failed.push({ title: issue.title, error: e.message });
    }
  }
  let committed;
  try {
    committed = discovery.markCommitted(dir, projectId, cardId, { issues: issues.map((i) => i.number), by });
  } catch (e) {
    // the card changed while its issues were being filed: say which ones exist now
    throw new Error(`${refs(issues.map((i) => i.number))} ${issues.length > 1 ? 'were' : 'was'} filed, but the card was not committed: ${e.message}`);
  }
  discovery.appendConversation(dir, projectId, cardId, {
    kind: 'commit', author: String(by || 'owner'), issues: issues.map((i) => i.number),
    text: `Committed to the backlog: ${issues.map((i) => `#${i.number} ${i.title}`).join('; ')}.${failed.length ? ` Not filed: ${failed.map((f) => f.title).join('; ')}.` : ''}`,
  });
  return { issues, card: committed, ...(skipped.size ? { skippedLabels: [...skipped] } : {}), ...(failed.length ? { failed } : {}) };
}

/**
 * The CLI of a simulated commit (simulation-only, the screenshots): nothing reaches gh/glab; an
 * `issue create` adds the issue to the project's synced backlog (the cache in `backlogDir`) with the
 * next free number and answers with its URL, as the CLI does. The simulated repository has the
 * labels a commit uses.
 */
function simulatedExec({ backlogDir, projectId, platform, repo }) {
  const flag = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const flags = (args, name) => args.filter((_, i) => args[i - 1] === name);
  return async (_cli, args) => {
    if (args[0] === 'label') return JSON.stringify([...KINDS, ...[1, 2, 3, 4, 5].map((n) => `complexity:${n}`)].map((name) => ({ name })));
    if (args[0] !== 'issue' || args[1] !== 'create') return '';
    const data = backlog.readBacklog(backlogDir, projectId);
    if (!data) throw new Error('Sync the backlog first: a commit files into the synced backlog.');
    const number = Math.max(0, ...(data.issues || []).map((i) => Number(i.number) || 0)) + 1;
    const file = flag(args, '--body-file');
    const body = file ? fs.readFileSync(file, 'utf8') : String(flag(args, '--description') ?? '');
    const base = String(data.repo || repo || '').replace(/\.git$/i, '').replace(/\/+$/, '');
    const url = platformOrDefault(platform).issueUrl(base, number);
    const now = new Date().toISOString();
    data.issues = [
      { number, title: flag(args, '--title'), state: 'open', labels: flags(args, '--label').flatMap((l) => l.split(',')).map((name) => ({ name, color: null })), url, author: null, assignees: [], body, tasks: backlog.taskProgress(body), createdAt: now, updatedAt: now, pullRequests: [] },
      ...(data.issues || []),
    ];
    fs.writeFileSync(path.join(backlogDir, `${path.basename(String(projectId))}.json`), JSON.stringify(data, null, 2));
    return `${url}\n`;
  };
}

// ---- delivery ----------------------------------------------------------------------------------------

/**
 * A committed card's delivery, from the Backlog.
 * @param {{ links?: { issues?: number[] } }} card
 * @param {{ number, column?, state?, title?, url? }[]} issues the Backlog's issues (the service's withIssueRuns);
 *   a linked issue the backlog does not have (not synced yet) counts as to do
 * @param {{ version, status, issues?: { number }[] }[]} releases the project's release history (packages/engine/domains/releases/releases.js)
 * @returns {{ stage: 'in_delivery'|'delivered'|'released', counts: { todo, running, local, done }, issues: { number, column, title, url, release }[], release: string|null }}
 *   release: the version that shipped the card's last issue, once released
 */
function cardDelivery(card, issues = [], releases = []) {
  const byNumber = new Map((issues || []).map((i) => [Number(i.number), i]));
  // each issue's first shipped release, and the releases in the history's order (the oldest first)
  const shippedIn = new Map();
  const shipped = (releases || []).filter((r) => r?.status === 'shipped');
  for (const r of shipped) {
    for (const i of r.issues || []) if (!shippedIn.has(Number(i.number))) shippedIn.set(Number(i.number), r.version);
  }
  const counts = { todo: 0, running: 0, local: 0, done: 0 };
  const list = (card?.links?.issues || []).map(Number).map((number) => {
    const issue = byNumber.get(number);
    const column = issue?.column || (issue?.state === 'closed' ? 'done' : 'todo');
    counts[column === 'in_progress' || column === 'waiting' ? 'running' : column in counts ? column : 'todo'] += 1;
    return { number, column, title: issue?.title || null, url: issue?.url || null, release: shippedIn.get(number) || null };
  });
  const released = list.length > 0 && list.every((i) => i.release);
  const delivered = list.length > 0 && counts.done === list.length;
  // released with the release that shipped its last issue
  const last = released ? shipped.findLast((r) => list.some((i) => i.release === r.version)) : null;
  return { stage: DELIVERY_STAGES[released ? 2 : delivered ? 1 : 0], counts, issues: list, release: last?.version || null };
}

module.exports = {
  cardDelivery,
  cardTasks,
  checkCommit,
  checkSplit,
  COMMIT_BAR,
  commitCard,
  issueBody,
  normalizeSplit,
  proposeSplit,
  simulatedExec,
};
