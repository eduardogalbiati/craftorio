// Splitting what is too big for one run (#124): the Product Owner (packages/engine/domains/po/product-owner.js) flags an
// issue as too big (`splitSignals`: complexity 4-5, more than 8 tasks, tasks in unrelated areas of
// the code, parts that could ship on their own, past runs of a similar size that hit the context
// limit or the test time budget) and proposes 2-4 child issues, each taking a subset of the parent's
// task list. Every parent task goes to exactly one child: `normalizeSplit` repairs a model's
// proposal (unknown tasks dropped, a task given twice kept in its first child, a missing one put
// next to its predecessor) and `checkSplit` refuses an owner's edit that breaks the rule. An issue
// with no signal is never split, whatever the model says.
// `fileSplit` files the children on the owner's click (gh/glab issue create, each with the parent's
// context, evidence and Decision), then updates the parent: an umbrella task list `- [ ] #n` appended
// as a dated section, or a comment and the parent closed. Children of a parent in an epic join it.
// A preview never calls the CLI: it returns the commands it would run.

const fs = require('fs');
const path = require('path');
const backlog = require('../backlog/backlog');
const epics = require('../backlog/epics');
const Language = require('@multiagent/shared/language');

const MAX_TASKS = 8;
const MIN_CHILDREN = 2;
const MAX_CHILDREN = 4;
const CHUNK = 6;
const TOO_BIG_FROM = 4;
const PARENT_ACTIONS = ['umbrella', 'close'];
const TASK_LINE = /^\s*[-*+] \[([ xX])\]\s*(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/;
const FILE = /(?:[\w@.-]+\/)+[\w@.-]+\.[a-z]{1,5}\b/gi;

/** The parent's task list, in order: [{ n (1-based), text, done, part (the heading above it) }]. */
function parentTasks(body) {
  const out = [];
  let part = null;
  for (const line of String(body || '').replace(/\r\n/g, '\n').split('\n')) {
    const h = line.match(HEADING);
    if (h) { part = h[1].trim(); continue; }
    const t = line.match(TASK_LINE);
    if (t) out.push({ n: out.length + 1, text: t[2].trim(), done: t[1] !== ' ', part });
  }
  return out;
}

// The area of the code a task names: the folder of the first file it names (null when it names none).
function areaOf(text) {
  const file = String(text || '').match(FILE)?.[0];
  if (!file) return null;
  const dir = file.split('/').slice(0, -1).join('/');
  return dir || null;
}

// Each task's area, a task naming no file taking the area of the task before it (or after it).
function taskAreas(tasks) {
  const areas = tasks.map((t) => areaOf(t.text));
  for (let i = 1; i < areas.length; i++) if (!areas[i]) areas[i] = areas[i - 1];
  for (let i = areas.length - 2; i >= 0; i--) if (!areas[i]) areas[i] = areas[i + 1];
  return areas;
}

// The parts of the task list under different headings (at least two tasks each), or [].
function taskParts(tasks) {
  const parts = [];
  for (const t of tasks) {
    const last = parts[parts.length - 1];
    if (last && last.name === t.part) last.tasks.push(t.n); else parts.push({ name: t.part, tasks: [t.n] });
  }
  return parts.length >= 2 && parts.every((p) => p.name && p.tasks.length >= 2) ? parts : [];
}

/**
 * Why an issue is too big for one run (empty when it is not).
 * complexity: its `complexity:n` label (null without one); history: product-owner runHistory
 * (each run's complexity and hitContext / hitTestTime).
 */
function splitSignals(issue, { complexity = null, history = [] } = {}) {
  const tasks = parentTasks(issue?.body);
  const reasons = [];
  if (complexity != null && complexity >= TOO_BIG_FROM) reasons.push(`Complexity ${complexity}: issues of complexity 4-5 are too big for one run.`);
  if (tasks.length > MAX_TASKS) reasons.push(`${tasks.length} tasks (more than ${MAX_TASKS}).`);
  if (tasks.length >= 4) {
    const areas = [...new Set(taskAreas(tasks).filter(Boolean))];
    if (areas.length >= 2) reasons.push(`Tasks in ${areas.length} unrelated areas of the code: ${areas.slice(0, 4).join(', ')}.`);
    const parts = taskParts(tasks);
    if (parts.length) reasons.push(`Parts that could ship on their own: ${parts.slice(0, 4).map((p) => `"${p.name}"`).join(', ')}.`);
  }
  if (complexity != null && complexity >= 3) {
    const similar = (history || []).filter((h) => h.complexity != null && h.complexity >= complexity - 1);
    const context = similar.filter((h) => h.hitContext).map((h) => h.runId);
    const testTime = similar.filter((h) => h.hitTestTime).map((h) => h.runId);
    if (context.length) reasons.push(`Past runs of a similar size hit the context limit (${context.slice(0, 3).join(', ')}).`);
    if (testTime.length) reasons.push(`Past runs of a similar size hit the test time budget (${testTime.slice(0, 3).join(', ')}).`);
  }
  return tasks.length >= MIN_CHILDREN ? reasons : [];
}

// Merges the smallest bucket into its neighbour until there are at most MAX_CHILDREN.
function capBuckets(buckets) {
  const out = buckets.map((b) => ({ ...b, tasks: [...b.tasks] }));
  while (out.length > MAX_CHILDREN) {
    let at = 0;
    out.forEach((b, i) => { if (b.tasks.length < out[at].tasks.length) at = i; });
    const into = at > 0 ? at - 1 : 1;
    out[into].tasks = [...out[into].tasks, ...out[at].tasks].sort((a, b) => a - b);
    out[into].name = `${out[Math.min(at, into)].name} + ${out[Math.max(at, into)].name}`;
    out.splice(at, 1);
  }
  return out;
}

const childComplexity = (complexity, count, total) => Math.max(1, Math.min(5, Math.round(((complexity ?? 3) * count) / total)));
const shortTitle = (t) => { const s = String(t || '').trim(); return s.length > 60 ? `${s.slice(0, 59)}…` : s; };

/**
 * The deterministic proposal (the simulated answer, and the fallback for a model's unusable one):
 * by part when the tasks sit under different headings, else by area of the code, else in chunks of
 * about six tasks in the parent's order. Areas can run together (stage 1); parts and chunks run in order.
 */
function proposeSplit(issue, { complexity = null, history = [] } = {}) {
  const reasons = splitSignals(issue, { complexity, history });
  if (!reasons.length) return null;
  const tasks = parentTasks(issue.body);
  let kind = 'part';
  let buckets = taskParts(tasks);
  if (!buckets.length) {
    kind = 'area';
    const areas = taskAreas(tasks);
    const byArea = new Map();
    tasks.forEach((t, i) => { const a = areas[i] || 'other'; if (!byArea.has(a)) byArea.set(a, []); byArea.get(a).push(t.n); });
    buckets = byArea.size >= MIN_CHILDREN ? [...byArea].map(([name, ns]) => ({ name, tasks: ns })) : [];
  }
  if (!buckets.length) {
    kind = 'chunk';
    const k = Math.min(MAX_CHILDREN, Math.max(MIN_CHILDREN, Math.ceil(tasks.length / CHUNK)));
    const size = Math.ceil(tasks.length / k);
    for (let i = 0; i < tasks.length; i += size) buckets.push({ name: `part ${buckets.length + 1}`, tasks: tasks.slice(i, i + size).map((t) => t.n) });
  }
  buckets = capBuckets(buckets);
  return {
    issue: issue.number,
    reasons,
    parent: 'umbrella',
    children: buckets.map((b, i) => ({
      title: `${shortTitle(issue.title)}: ${b.name}`,
      tasks: b.tasks,
      complexity: childComplexity(complexity, b.tasks.length, tasks.length),
      stage: kind === 'area' ? 1 : i + 1,
      reason: kind === 'area' ? `The tasks in ${b.name}: another area of the code, so it can run next to the others.`
        : kind === 'part' ? `The "${b.name}" part: it can ship on its own.` : `Tasks ${b.tasks[0]}-${b.tasks[b.tasks.length - 1]}, in the parent's order.`,
    })),
  };
}

/**
 * A model's split proposal kept to the rules: only an issue with a signal, 2-4 children, every
 * parent task in exactly one child. Falls back to proposeSplit when fewer than two children are left.
 * Returns { issue, title, reasons, parent, children: [{ title, tasks, complexity, stage, reason }], tasks, repaired? } or null.
 */
function normalizeSplit(raw, issue, { complexity = null, history = [] } = {}) {
  if (!issue || issue.state !== 'open') return null;
  const signals = splitSignals(issue, { complexity, history });
  if (!signals.length) return null;
  const tasks = parentTasks(issue.body);
  const n = tasks.length;
  const seen = new Set();
  let repaired = false;
  let children = (raw?.children || []).map((c, i) => {
    const ns = [];
    for (const t of c?.tasks || []) {
      const k = Number(t);
      if (!Number.isInteger(k) || k < 1 || k > n || seen.has(k)) { repaired = true; continue; }
      seen.add(k);
      ns.push(k);
    }
    const cx = Number(c?.complexity);
    return {
      title: String(c?.title || '').trim() || `${shortTitle(issue.title)}: part ${i + 1}`,
      tasks: ns,
      complexity: Number.isInteger(cx) && cx >= 1 && cx <= 5 ? cx : null,
      stage: Number.isInteger(c?.stage) && c.stage > 0 ? c.stage : i + 1,
      reason: String(c?.reason || ''),
    };
  });
  // a task no child took goes to the child holding the task before it (else the first child)
  for (let k = 1; k <= n; k++) {
    if (seen.has(k) || !children.length) continue;
    repaired = true;
    const home = children.find((c) => c.tasks.includes(k - 1)) || children[0];
    home.tasks.push(k);
    home.tasks.sort((a, b) => a - b);
    seen.add(k);
  }
  children = children.filter((c) => c.tasks.length);
  if (children.length > MAX_CHILDREN) {
    repaired = true;
    const extra = children.splice(MAX_CHILDREN - 1);
    children.push({ ...extra[0], tasks: extra.flatMap((c) => c.tasks).sort((a, b) => a - b), title: extra[0].title });
  }
  if (children.length < MIN_CHILDREN) {
    const fallback = proposeSplit(issue, { complexity, history });
    return fallback && { ...fallback, title: issue.title, tasks, repaired: true };
  }
  const modelReasons = (raw?.reasons || []).map(String).filter(Boolean);
  return {
    issue: issue.number,
    title: issue.title,
    reasons: [...new Set([...signals, ...modelReasons])],
    parent: PARENT_ACTIONS.includes(raw?.parent) ? raw.parent : 'umbrella',
    children: children.map((c) => ({ ...c, complexity: c.complexity ?? childComplexity(complexity, c.tasks.length, n) })),
    tasks,
    ...(repaired ? { repaired: true } : {}),
  };
}

/**
 * Checks a proposal the owner may have edited (tasks moved, children merged) before it is filed:
 * 2-4 children with a title, every task of the parent in exactly one. Returns the cleaned split.
 */
function checkSplit(split, issue) {
  if (!issue) throw new Error('The issue to split is not in the synced backlog.');
  if (issue.state !== 'open') throw new Error(`#${issue.number} is closed.`);
  const n = parentTasks(issue.body).length;
  const children = (split?.children || []).map((c) => ({
    title: String(c?.title || '').trim(),
    tasks: (c?.tasks || []).map(Number),
    complexity: Math.max(1, Math.min(5, Number(c?.complexity) || 1)),
    stage: Number.isInteger(Number(c?.stage)) && Number(c.stage) > 0 ? Number(c.stage) : 1,
    reason: String(c?.reason || ''),
  })).filter((c) => c.tasks.length);
  if (children.length < MIN_CHILDREN || children.length > MAX_CHILDREN) throw new Error(`A split has ${MIN_CHILDREN} to ${MAX_CHILDREN} children with tasks (this one has ${children.length}).`);
  if (children.some((c) => !c.title)) throw new Error('Every child needs a title.');
  const all = children.flatMap((c) => c.tasks);
  const missing = [];
  for (let k = 1; k <= n; k++) if (!all.includes(k)) missing.push(k);
  if (missing.length) throw new Error(`Every task goes to one child: task${missing.length > 1 ? 's' : ''} ${missing.join(', ')} ${missing.length > 1 ? 'have' : 'has'} none.`);
  if (all.length !== n || all.some((k) => k < 1 || k > n)) throw new Error('A task is in two children, or a child names a task the issue does not have.');
  return { issue: issue.number, parent: PARENT_ACTIONS.includes(split?.parent) ? split.parent : 'umbrella', children };
}

// The parent's body without its task lines and the headings left empty: its context, evidence and Decision.
function parentContext(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n').filter((l) => !TASK_LINE.test(l));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (HEADING.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length || HEADING.test(lines[j])) continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A child's description: where it comes from, its tasks, then the parent's context (headings: #328). */
function childBody({ parent, child, index, total, headings = Language.issueHeadings() }) {
  const tasks = parentTasks(parent.body);
  const mine = child.tasks.map((k) => tasks[k - 1]).filter(Boolean);
  // the parent's headings one level down, under "## From #n"
  const context = parentContext(parent.body).replace(/^(#{1,5})(?=\s)/gm, '$1#');
  return [
    `Split from #${parent.number} (${parent.title}): part ${index + 1} of ${total}.${child.reason ? ` ${child.reason}` : ''}`,
    '',
    headings.tasks,
    '',
    ...mine.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}`),
    ...(context ? ['', `${headings.fromIssue} #${parent.number}`, '', context] : []),
    '',
  ].join('\n');
}

// The parent's labels for a child: its complexity instead of the parent's, never `epic`.
const childLabels = (parent, complexity) => [
  ...(parent.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter((l) => l && !/^complexity\s*[:=/-]/i.test(l) && !/^epic($|::)/i.test(l)),
  `complexity:${complexity}`,
];

/**
 * Files a checked split (checkSplit) on the owner's click: the children, then the parent (umbrella
 * task list, or a comment and closed). dir: where each text sent is kept. epicList: the cache's epics
 * (children of a parent in an epic join it). timeZone (#273): the owner's zone, the umbrella's
 * "## Update" day. issuesLanguage (#328): the children's headings. Returns { preview, commands, children: [{ number, url,
 * title, tasks, stage }], parent: { number, action }, skippedLabels?, epicError? }.
 */
async function fileSplit({ platform, repo, parent, split, dir, preview = false, epicList = [], timeZone = null, issuesLanguage = null, exec = backlog.execCli }) {
  const commands = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const send = async (cmd, file, text) => {
    commands.push(cmd.display);
    if (preview) return '';
    if (file) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, text); }
    return String(await exec(cmd.cli, cmd.args) || '');
  };
  const known = preview ? null : await backlog.repoLabels({ platform, repo, exec });
  const skipped = new Set();
  const children = [];
  for (const [i, child] of split.children.entries()) {
    const body = childBody({ parent, child, index: i, total: split.children.length, headings: Language.issueHeadings(issuesLanguage) });
    let labels = childLabels(parent, child.complexity);
    if (known) { labels.filter((l) => !known.includes(l)).forEach((l) => skipped.add(l)); labels = labels.filter((l) => known.includes(l)); }
    const file = path.join(dir, `${stamp}-split-${parent.number}-${i + 1}.md`);
    const out = await send(backlog.issueCreateCommand({ platform, repo, title: child.title, labels, file, text: body }), file, body);
    const url = out.match(/https?:\/\/\S+/)?.[0] || null;
    children.push({ number: Number(url?.match(/\/(\d+)\/?$/)?.[1]) || null, url, title: child.title, tasks: child.tasks, stage: child.stage, complexity: child.complexity });
  }
  const refs = children.map((c, i) => (c.number ? `#${c.number}` : `<child ${i + 1}>`));
  if (split.parent === 'close') {
    const text = `Split into ${refs.join(', ')}: each child takes part of this issue's tasks, with its context.\n`;
    const file = path.join(dir, `${stamp}-split-${parent.number}-comment.md`);
    await send(backlog.issueSaveCommand({ platform, repo, number: parent.number, mode: 'comment', file, text }), file, text);
    await send(backlog.issueCloseCommand({ platform, repo, number: parent.number }));
  } else {
    const addition = `Split into:\n\n${children.map((c, i) => `- [ ] ${refs[i]} ${c.title}`).join('\n')}\n\nThis issue is now an umbrella: it is done when its children are.`;
    const original = preview ? parent.body : (await backlog.fetchIssue({ platform, repo, number: parent.number, exec })).body;
    const text = backlog.issueAppendBody({ original, addition, timeZone });
    const file = path.join(dir, `${stamp}-split-${parent.number}-umbrella.md`);
    await send(backlog.issueSaveCommand({ platform, repo, number: parent.number, mode: 'replace', file, text }), file, text);
  }
  let epicError = null;
  if (parent.epic && epicList.some((e) => e.id === parent.epic)) {
    try {
      const res = await epics.applyEpic({ platform, repo, epic: { id: parent.epic }, issues: children.map((c) => c.number).filter(Boolean), epics: epicList, dir, preview, issuesLanguage, exec });
      commands.push(...res.commands);
    } catch (e) { epicError = e.message; }
  }
  return {
    preview: !!preview, commands, children, parent: { number: parent.number, action: split.parent },
    ...(skipped.size ? { skippedLabels: [...skipped] } : {}), ...(epicError ? { epicError } : {}),
  };
}

module.exports = {
  checkSplit,
  childBody,
  fileSplit,
  normalizeSplit,
  parentTasks,
  proposeSplit,
  splitSignals,
};
