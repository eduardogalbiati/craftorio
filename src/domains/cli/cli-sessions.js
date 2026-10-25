// Conversations the provider CLIs recorded on this machine (Claude Code, Codex CLI, Grok Build),
// for the Sessions screen: each one can be reopened in its CLI, and new ones started. Like
// src/domains/local/local-usage.js these are undocumented internal formats, so every reader is defensive.
// Session files can be large (tens of MB), so only the head and the tail of each file are read,
// and each file is parsed once per (mtime, size).
//
//   Claude Code  ~/.claude/projects/<project>/<id>.jsonl   head: cwd, first prompt, model,
//                entrypoint (sdk-* = headless `claude -p`); tail: custom-title / ai-title.
//   Codex CLI    ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl   session_meta (id, cwd, source),
//                turn_context (model), first user message.
//   Grok Build   ~/.grok/sessions/<cwd>/<id>/summary.json   id, cwd, model, dates, kind; the first
//                prompt comes from <cwd>/prompt_history.jsonl.
//
// Session: { provider, id, title, cwd, model, createdAt, updatedAt, headless }

const fs = require('fs');
const path = require('path');
const { cliConfigDirs, cliSessionDirs } = require('./cli-config-dirs');
const registry = require('../../shared/providers');

const HEAD_BYTES = 512 * 1024;
const TAIL_BYTES = 256 * 1024;
const TITLE_MAX = 120;
const cache = new Map(); // file -> { key, session }

// The interactive CLIs: what the Sessions screen can start or reopen (from their adapters,
// src/shared/providers/: models, efforts, newArgs, interactiveResumeArgs, modelsCache).
const CLI_PROVIDERS = Object.fromEntries(registry.clis().map((a) => [a.id, {
  name: a.label, command: a.cli, models: a.models, efforts: a.efforts,
  newArgs: a.newArgs, resumeArgs: a.interactiveResumeArgs, modelsCache: a.modelsCache || null,
}]));

// The models each CLI offers this account, from the list the CLI itself caches (refreshed whenever
// it runs; its adapter's modelsCache reads it), in the CLI's own order: [{ id, name, efforts,
// defaultEffort }]. Claude Code keeps no such list, and a missing cache falls back to CLI_PROVIDERS' models.
const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const byEffort = (list) => [...list].sort((a, b) => (EFFORT_ORDER.indexOf(a) + 1 || 99) - (EFFORT_ORDER.indexOf(b) + 1 || 99));

function cachedModels(provider, home) {
  return rawCachedModels(provider, home).map((m) => ({ ...m, efforts: byEffort(m.efforts) }));
}

function rawCachedModels(provider, home) {
  const cache = CLI_PROVIDERS[provider]?.modelsCache;
  if (!cache) return [];
  const cfg = cliConfigDirs(home);
  let c = null;
  try { c = JSON.parse(fs.readFileSync(path.join(cfg[provider], cache.file), 'utf8')); } catch { /* no cache yet */ }
  return cache.models(c);
}

/** The models a provider's CLI offers (see cachedModels), else the built-in list. */
function providerModels(provider, { home } = {}) {
  const p = CLI_PROVIDERS[provider];
  const cached = cachedModels(provider, home);
  if (cached.length) return cached;
  return (p?.models || []).map((id) => ({ id, name: id, efforts: p.efforts, defaultEffort: null }));
}

// Values that end up on a command line (and through cmd.exe for .cmd shims): no spaces or shell syntax.
const SAFE_ARG = /^[\w.:@/[\]-]{1,100}$/;
function checkArg(value, what) {
  if (value && !SAFE_ARG.test(String(value))) throw new Error(`Invalid ${what}: ${value}`);
  return value ? String(value) : '';
}

function readSlice(file, size, fromEnd) {
  const fd = fs.openSync(file, 'r');
  try {
    const len = Math.min(size, fs.fstatSync(fd).size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, fromEnd ? fs.fstatSync(fd).size - len : 0);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// Whole JSON lines of a slice (the lines cut at the slice's edges fail to parse and are skipped).
const jsonLines = (text) => text.split('\n').map((l) => { try { return l.trim() ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);

// One line of text for a list: markup and whitespace collapsed, shortened.
function oneLine(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join(' ') : '');

// A prompt the user typed (not a slash command, command output or injected context).
const isTypedPrompt = (t) => !!t && !/^\s*</.test(t) && !/^\s*Caveat:/.test(t);
// Title for a prompt written by a program (e.g. an orchestrator agent's first turn): the text
// outside the tagged blocks (<system>, <skill>, <environment_context>...), else the tags stripped.
const outsideTags = (t) => String(t).replace(/<([\w-]+)[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').trim();
/** The prompt that names a session: the first one typed, else the first with text outside tags. */
function firstPrompt(texts) {
  const list = texts.filter(Boolean);
  return list.find(isTypedPrompt) || list.map(outsideTags).find(Boolean) || null;
}

function parseClaude(file) {
  const head = jsonLines(readSlice(file, HEAD_BYTES, false));
  const tail = jsonLines(readSlice(file, TAIL_BYTES, true));
  const st = fs.statSync(file);
  let cwd = null, model = null, entrypoint = null, createdAt = null, id = null;
  const texts = [];
  for (const j of head) {
    id ??= j.sessionId || null;
    cwd ??= j.cwd || null;
    entrypoint ??= j.entrypoint || null;
    if (j.timestamp) createdAt ??= j.timestamp;
    if (j.type === 'assistant' && j.message?.model && j.message.model !== '<synthetic>') model ??= j.message.model;
    if (j.type === 'user' && !j.isMeta && !j.isSidechain && !j.toolUseResult) texts.push(textOf(j.message?.content));
  }
  const prompt = firstPrompt(texts);
  // the latest title of each kind; a custom title (renamed by the user) wins over generated ones
  const all = [...head, ...tail];
  const last = (type, field) => all.filter((j) => j.type === type && j[field]).pop()?.[field] || null;
  const title = last('custom-title', 'customTitle') || last('ai-title', 'aiTitle') || last('summary', 'summary');
  if (!prompt && !title && !model) return null; // empty or not a conversation
  return {
    provider: 'claude', id: id || path.basename(file, '.jsonl'), title: oneLine(title || prompt || '(no prompt)'),
    cwd, model, createdAt: createdAt || st.birthtime.toISOString(), updatedAt: st.mtime.toISOString(),
    headless: /^sdk/.test(entrypoint || ''),
  };
}

function parseCodex(file) {
  const head = jsonLines(readSlice(file, HEAD_BYTES, false));
  const st = fs.statSync(file);
  let meta = null, model = null;
  const texts = [];
  for (const j of head) {
    const p = j.payload || {};
    if (j.type === 'session_meta') meta ??= p;
    else if (j.type === 'turn_context' && p.model) model ??= p.model;
    else if (j.type === 'response_item' && p.type === 'message' && p.role === 'user') texts.push(textOf(p.content));
  }
  // the first user message is the environment context Codex injects
  const prompt = firstPrompt(texts.filter((t) => !/^\s*<environment_context>/.test(t)));
  if (!meta?.id) return null;
  return {
    provider: 'codex', id: meta.id, title: oneLine(prompt || '(no prompt)'), cwd: meta.cwd || null, model,
    createdAt: meta.timestamp || st.birthtime.toISOString(), updatedAt: st.mtime.toISOString(),
    headless: meta.source === 'exec' || /exec/.test(meta.originator || ''),
  };
}

// Grok's first prompt per session, from prompt_history.jsonl in the session's folder group.
function grokPrompts(dir) {
  const file = path.join(dir, 'prompt_history.jsonl');
  const out = new Map();
  let text = '';
  try { text = readSlice(file, HEAD_BYTES * 4, false); } catch { return out; }
  for (const j of jsonLines(text)) if (j.session_id && !out.has(j.session_id) && isTypedPrompt(j.prompt)) out.set(j.session_id, j.prompt);
  return out;
}

function parseGrok(file, prompts) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (j.num_messages === 0) return null; // opened and left without a message: nothing to resume
  const id = j.info?.id || path.basename(path.dirname(file));
  const st = fs.statSync(file);
  return {
    provider: 'grok', id, title: oneLine(j.session_summary || prompts.get(id) || '(no prompt)'),
    cwd: j.info?.cwd || null, model: j.current_model_id || null,
    createdAt: j.created_at || st.birthtime.toISOString(), updatedAt: j.last_active_at || j.updated_at || st.mtime.toISOString(),
    headless: j.session_kind === 'headless',
  };
}

function cached(file, parse) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.session;
  let session = null;
  try { session = parse(file); } catch { session = null; }
  cache.set(file, { key, session });
  return session;
}

const dirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)); } catch { return []; } };
const files = (dir, match) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && match(e.name)).map((e) => path.join(dir, e.name)); } catch { return []; } };

const SOURCES = (home) => cliSessionDirs(cliConfigDirs(home));

/** Every session the CLIs recorded on this machine, most recently active first. */
function listCliSessions({ home } = {}) {
  const src = SOURCES(home);
  const out = [];
  // <project>/<id>.jsonl only: the <id>/ folders next to them hold subagent transcripts
  for (const d of dirs(src.claude)) for (const f of files(d, (n) => n.endsWith('.jsonl'))) out.push(cached(f, parseClaude));
  for (const y of dirs(src.codex)) for (const m of dirs(y)) for (const d of dirs(m)) {
    for (const f of files(d, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'))) out.push(cached(f, parseCodex));
  }
  for (const group of dirs(src.grok)) {
    let prompts = null;
    for (const d of dirs(group)) {
      const f = path.join(d, 'summary.json');
      if (!fs.existsSync(f)) continue;
      prompts ??= grokPrompts(group);
      out.push(cached(f, (file) => parseGrok(file, prompts)));
    }
  }
  return out.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** A recorded session by provider and id (the folder to resume it in comes from here, never from the caller). */
function findCliSession(provider, id, opts) {
  return listCliSessions(opts).find((s) => s.provider === provider && s.id === id) || null;
}

/** Command-line arguments to reopen a session or start a new one. */
function cliArgs(provider, { resume, model, effort } = {}) {
  const p = CLI_PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider: ${provider}`);
  if (resume) return p.resumeArgs(checkArg(resume, 'session id'));
  return p.newArgs({ model: checkArg(model, 'model'), effort: checkArg(effort, 'effort') });
}

module.exports = {
  CLI_PROVIDERS,
  cliArgs,
  findCliSession,
  listCliSessions,
  parseClaude,
  parseCodex,
  parseGrok,
  providerModels,
};
