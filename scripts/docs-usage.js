#!/usr/bin/env node
// Which docs and rules the coding agents use (#574), counted from a project's recorded runs: per
// run and session, the docs/agents/*.md, skills/*/SKILL.md and AGENTS.md files the agent read (its
// Read tool calls), the files it edited (Edit / Write / MultiEdit / NotebookEdit), the topic docs of
// the folders it edited without reading them (TOPICS), and the rules the commands and edits show
// broken (a shared list edited, a push to main, a real run started); then the reads per doc, the
// docs no session read and the rules the data cannot show (NOT_MEASURED).
// Runs are <workspace>/runs/<id> read through readRunRecord (the record upgrade on read, #350), so
// an older run shape counts too; the tool calls are its `session.stream` events of kind tool_call.
// Read-only, no model call: a Markdown report, or the JSON model with --json.
//
//   node scripts/docs-usage.js [--workspace <dir>] [--root <repo>] [--project <id>] [--since YYYY-MM-DD] [--json]
//   npm run docs:usage -- --project multiagent-orchestrator --since 2026-09-26
//
// Defaults: $MULTIAGENT_WORKSPACE (else ~/multiagent-workspace), this repository, its project id
// and the last 30 days.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readRunRecord } = require('@multiagent/engine/domains/run/run-record');

// the folders a topic line of AGENTS.md names, with its doc ("Read before changing ...")
const TOPICS = [
  { doc: 'docs/agents/renderer.md', re: /^(packages\/ui-kit\/|fronts\/|apps\/[^/]+\/renderer\/)/ },
  { doc: 'docs/agents/engine.md', re: /^workflows\// },
  { doc: 'docs/agents/testing.md', re: /^(test\/|(apps|packages)\/[^/]+\/test\/)/ },
];

// files that hold a shared list the agents must add to, never edit ("Add, don't edit shared lists")
const SHARED_LISTS = ['AGENTS.md', 'CLAUDE.md'];

const RULES = ['shared_list_edit', 'push_to_main', 'real_run_in_check'];

const NOT_MEASURED = [
  'a shared name list kept one item per line and sorted (npm run lint:lists checks the files, not the sessions)',
  'a command run with a VAR= prefix that MULTIAGENT_SIMULATION_ONLY already covers',
  'a commit to the default branch that was never pushed',
  'the decision a change of behaviour needed, read in docs/agents/decisions.md before the change',
  'docs and skills given in the prompt instead of read (a step\'s skills, AGENTS.md loaded by the CLI through CLAUDE.md)',
  'docs read through shell commands (cat, grep, Get-Content) or searches (Grep, Glob) instead of the Read tool',
  'edits by a provider whose stream has no file_path in its tool calls (a patch tool, a shell redirect)',
];

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write']);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const slash = (p) => String(p || '').replace(/\\/g, '/');

// a path relative to the session's worktree; a skill outside it by its skills/<name>/SKILL.md suffix
function relative(file, cwd) {
  const p = slash(file);
  const base = slash(cwd).replace(/\/+$/, '');
  if (base && p.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return p.slice(base.length + 1);
  const skill = p.match(/(?:^|\/)(skills\/[^/]+\/SKILL\.md)$/);
  if (skill) return skill[1];
  return p.replace(/^\.\//, '');
}

// the docs an agent can read in the repository at `root`
function readableDocs(root) {
  const list = (dir) => { try { return fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return []; } };
  const docs = list('docs/agents').filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => `docs/agents/${d.name}`);
  const skills = list('skills').filter((d) => d.isDirectory() && fs.existsSync(path.join(root, 'skills', d.name, 'SKILL.md'))).map((d) => `skills/${d.name}/SKILL.md`);
  const agents = fs.existsSync(path.join(root, 'AGENTS.md')) ? ['AGENTS.md'] : [];
  return [...docs, ...skills, ...agents].sort();
}

// each command of a shell line (split at ;, &&, ||, | and new lines)
const commands = (line) => String(line || '').split(/\r?\n|&&|\|\||;|\|/).map((c) => c.trim()).filter(Boolean);

function pushesToMain(line) {
  return commands(line).some((c) => {
    const m = c.match(/\bgit\b(?:\s+-C\s+\S+)?\s+push\b(.*)$/);
    return !!m && m[1].trim().split(/\s+/).filter((t) => t && !t.startsWith('-')).some((t) => /^(?:\+?|.*:)(refs\/heads\/)?main$/.test(t.replace(/^["']|["']$/g, '')));
  });
}

const startsRealRun = (line) => commands(line).some((c) => /(\bnpm\s+run\s+run\b|\bnode\s+\S*scripts[\\/]run\.js\b)/.test(c) && !/\s--mock\b/.test(c));

const emptyRules = () => Object.fromEntries(RULES.map((r) => [r, 0]));
const sorted = (set) => [...set].sort();

function sessionsOfRun(summary, events) {
  const cwd = new Map();
  for (const e of events) if (e.type === 'session.opened' && e.session?.cwd) cwd.set(e.session_id, e.session.cwd);
  const workDir = summary?.worktree?.work_dir || summary?.worktree?.dir || '';
  const sessions = new Map();
  const of = (id, agent = null) => {
    if (!sessions.has(id)) sessions.set(id, { session_id: id, agent, cwd: cwd.get(id) || workDir, read: new Set(), edited: new Set(), commands: [] });
    return sessions.get(id);
  };
  for (const s of summary?.sessions || []) if (s?.id) of(s.id, s.agent || null);
  for (const e of events) {
    if (e.type !== 'session.stream' || e.item?.kind !== 'tool_call' || !e.session_id) continue;
    const s = of(e.session_id);
    const input = e.item.input || {};
    const file = input.file_path || input.notebook_path;
    if (e.item.name === 'Read' && file) s.read.add(relative(file, s.cwd));
    else if (EDIT_TOOLS.has(e.item.name) && file) s.edited.add(relative(file, s.cwd));
    else if (typeof input.command === 'string') s.commands.push(input.command);
  }
  return [...sessions.values()];
}

/** `{ markdown, model }` over the runs of `project` started since `since` (YYYY-MM-DD). */
function docsUsage({
  workspace = process.env.MULTIAGENT_WORKSPACE || path.join(os.homedir(), 'multiagent-workspace'),
  root = path.join(__dirname, '..'),
  project = 'multiagent-orchestrator',
  since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10),
} = {}) {
  const docs = readableDocs(root);
  const readable = new Set(docs);
  const runsDir = path.join(workspace, 'runs');
  let ids = [];
  try { ids = fs.readdirSync(runsDir).filter((id) => fs.existsSync(path.join(runsDir, id, 'events.jsonl'))).sort(); } catch { ids = []; }
  const runs = [];
  const reads = {};
  const skipped = {};
  const total = emptyRules();
  for (const id of ids) {
    const { summary, events } = readRunRecord(path.join(runsDir, id));
    const started = events.find((e) => e.type === 'workflow.started') || {};
    if ((summary?.project_id || started.project_id) !== project) continue;
    if (String(summary?.started_at || started.ts || '').slice(0, 10) < since) continue;
    const rules = emptyRules();
    const sessions = sessionsOfRun(summary, events).map((s) => {
      const docsRead = sorted([...s.read].filter((f) => readable.has(f)));
      const topics = new Set();
      for (const f of s.edited) {
        const topic = TOPICS.find((t) => t.re.test(f));
        if (topic && readable.has(topic.doc) && !s.read.has(topic.doc)) topics.add(topic.doc);
        if (SHARED_LISTS.includes(f)) rules.shared_list_edit++;
      }
      for (const c of s.commands) {
        if (pushesToMain(c)) rules.push_to_main++;
        if (startsRealRun(c)) rules.real_run_in_check++;
      }
      for (const d of docsRead) reads[d] = (reads[d] || 0) + 1;
      for (const d of topics) skipped[d] = (skipped[d] || 0) + 1;
      return { session_id: s.session_id, agent: s.agent, docs_read: docsRead, files_edited: sorted(s.edited), topics_skipped: sorted(topics) };
    });
    for (const r of RULES) total[r] += rules[r];
    runs.push({ run_id: id, issues: summary?.issues || started.issues || [], sessions, rules_broken: rules });
  }
  const model = {
    project,
    since,
    runs,
    reads: Object.fromEntries(Object.keys(reads).sort().map((d) => [d, reads[d]])),
    never_read: docs.filter((d) => !reads[d]),
    skipped_by_topic: Object.fromEntries(Object.keys(skipped).sort().map((d) => [d, skipped[d]])),
    rules_broken: total,
    not_measured: NOT_MEASURED,
  };
  return { markdown: markdownOf(model), model };
}

const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `|${'---|'.repeat(head.length)}`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n') : '_None._');
const byCount = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

function markdownOf(model) {
  const sessions = model.runs.reduce((n, r) => n + r.sessions.length, 0);
  const runsBroken = (rule) => model.runs.filter((r) => r.rules_broken[rule]).map((r) => r.run_id);
  return [
    `# Docs usage: ${model.project} since ${model.since}`,
    `${model.runs.length} runs, ${sessions} sessions.`,
    '## Broken rules',
    table(['Rule', 'Times', 'Runs'], byCount(model.rules_broken).map(([rule, n]) => [`\`${rule}\``, n, runsBroken(rule).join(', ') || '-'])),
    '## Topic docs skipped (folder edited, doc not read in the session)',
    table(['Topic doc', 'Sessions'], byCount(model.skipped_by_topic).map(([d, n]) => [d, n])),
    '## Never read',
    model.never_read.length ? model.never_read.map((d) => `- ${d}`).join('\n') : '_None._',
    '## Reads per doc (sessions)',
    table(['Doc', 'Sessions'], byCount(model.reads).map(([d, n]) => [d, n])),
    '## Not measured',
    model.not_measured.map((r) => `- ${r}`).join('\n'),
    '',
  ].join('\n\n');
}

if (require.main === module) {
  const { markdown, model } = docsUsage({
    ...(arg('workspace') ? { workspace: arg('workspace') } : {}),
    ...(arg('root') ? { root: arg('root') } : {}),
    ...(arg('project') ? { project: arg('project') } : {}),
    ...(arg('since') ? { since: arg('since') } : {}),
  });
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(model, null, 2)}\n` : markdown);
}

module.exports = {
  docsUsage,
  pushesToMain,
  relative,
  startsRealRun,
};
