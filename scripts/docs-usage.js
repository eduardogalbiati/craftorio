#!/usr/bin/env node
// Which docs and rules the coding agents use (#574), counted from a project's recorded runs: per
// run and session, the .md files under docs/agents/ and skills/ and AGENTS.md the agent read (its
// Read tool calls), the files it edited (city-agents' touchOf: its change tools), the topic docs of
// the folders it edited without reading them (TOPICS), and the rules the commands and edits show
// broken (a shared list edited, a push to main, a real run attempted: under CRAFTORIO_SIMULATION_ONLY
// the engine refuses it, so the stream shows the try, not a run); then the reads per doc, the
// docs no session read and the rules the data cannot show (NOT_MEASURED).
// Runs are <workspace>/runs/<id> read through readRunRecord (the record upgrade on read, #350), so
// an older run shape counts too; the tool calls are its `session.stream` events of kind tool_call.
// Read-only, no model call: a Markdown report, or the JSON model with --json.
//
//   node scripts/docs-usage.js [--workspace <dir>] [--root <repo>] [--project <id>] [--since YYYY-MM-DD] [--json]
//   npm run docs:usage -- --project craftorio --since 2026-09-26
//
// Defaults: $CRAFTORIO_WORKSPACE (else ~/craftorio-workspace, or ~/multiagent-workspace from before the rename), this repository, its project id
// and the last 30 days.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readRunRecord } = require('@craftorio/engine/domains/run/run-record');
const { relativePath, touchOf } = require('@craftorio/shared/city-agents');

// the folders a topic line of AGENTS.md or a nested AGENTS.md (#572) names, with its doc ("Read
// before changing ..."); the first match wins, so packages/engine/test/ counts as testing
const TOPICS = [
  { doc: 'docs/agents/renderer.md', re: /^(packages\/ui-kit\/|fronts\/|apps\/[^/]+\/renderer\/)/ },
  { doc: 'docs/agents/testing.md', re: /^(test\/|(apps|packages)\/[^/]+\/test\/)/ },
  { doc: 'docs/agents/engine.md', re: /^(workflows\/|packages\/engine\/)/ },
  { doc: 'docs/agents/windows-gotchas.md', re: /^scripts\// },
];

// The shared lists a session's edits show: AGENTS.md and CLAUDE.md are the indexes every run reads,
// where "Add, don't edit shared lists" applies to the file itself. The name lists npm run lint:lists
// checks (module.exports, destructured requires) live in any source file and are judged by their
// layout, not by who edited them: they stay in NOT_MEASURED.
const SHARED_LISTS = ['AGENTS.md', 'CLAUDE.md'];

const RULES = ['shared_list_edit', 'push_to_main', 'real_run_in_check'];

const NOT_MEASURED = [
  'a shared name list kept one item per line and sorted (npm run lint:lists checks the files, not the sessions)',
  'a command run with a VAR= prefix that CRAFTORIO_SIMULATION_ONLY already covers',
  'a commit to the default branch that was never pushed',
  'the decision a change of behaviour needed, read in docs/agents/decisions.md before the change',
  'docs and skills given in the prompt instead of read (a step\'s skills, AGENTS.md loaded by the CLI through CLAUDE.md)',
  'docs read through shell commands (cat, grep, Get-Content) or searches (Grep, Glob) instead of the Read tool',
  'edits by a provider whose stream has no file_path in its tool calls (a patch tool, a shell redirect)',
];

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// a path relative to the session's worktree (city-agents' rule); a skill outside it (the workspace's
// skills folder) by its skills/<name>/... suffix; anything else as recorded, with forward slashes
function relative(file, cwd) {
  const rel = relativePath(file, cwd);
  if (rel) return rel;
  const p = String(file || '').replace(/\\/g, '/');
  const skill = p.match(/(?:^|\/)(skills\/[^/]+\/(?:[^/]+\/)*[^/]+\.md)$/);
  return skill ? skill[1] : p;
}

// the docs an agent can read in the repository at `root`: every .md under docs/agents/ and skills/
// (topic sub-docs such as docs/agents/engine/*.md and skill rules included), and AGENTS.md
function readableDocs(root) {
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return []; }
    return entries.flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : d.isFile() && d.name.endsWith('.md') ? [`${dir}/${d.name}`] : []));
  };
  const agents = fs.existsSync(path.join(root, 'AGENTS.md')) ? ['AGENTS.md'] : [];
  return [...walk('docs/agents'), ...walk('skills'), ...agents].sort();
}

// each command of a shell line, split at ;, &&, ||, | and new lines outside quotes
function commands(line) {
  const out = [];
  let cur = '';
  let quote = null;
  const s = String(line || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ';' || ch === '\n' || ch === '|' || (ch === '&' && s[i + 1] === '&')) {
      if ((ch === '|' || ch === '&') && s[i + 1] === ch) i++;
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim()).filter(Boolean);
}

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
    const t = touchOf(e.item);
    const command = e.item.input?.command;
    if (t?.kind === 'change') s.edited.add(relative(t.file, s.cwd));
    else if (t?.tool === 'Read') s.read.add(relative(t.file, s.cwd));
    else if (typeof command === 'string') s.commands.push(command);
  }
  return [...sessions.values()];
}

/** `{ markdown, model }` over the runs of `project` started since `since` (YYYY-MM-DD). */
function docsUsage({
  workspace = process.env.CRAFTORIO_WORKSPACE || require('@craftorio/engine/domains/workspace/workspace').existingDefaultWorkspace(),
  root = path.join(__dirname, '..'),
  project = 'craftorio',
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
    '`real_run_in_check` counts the attempts (a run command without `--mock`); the engine refuses a real run under `CRAFTORIO_SIMULATION_ONLY`.',
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
  if (arg('since') && !/^\d{4}-\d{2}-\d{2}$/.test(arg('since'))) process.stderr.write(`docs-usage: --since ${arg('since')} is not YYYY-MM-DD; the report may come out empty\n`);
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
