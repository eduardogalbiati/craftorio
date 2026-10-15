// Usage recorded by the CLIs themselves on this machine, including everything run outside the
// orchestrator. These are undocumented internal formats, so every reader is defensive:
// unknown lines are skipped and a broken file never breaks the others.
//
//   Claude Code  ~/.claude/projects/<project>/*.jsonl       one line per message chunk with
//                message.usage; the same message is written several times while streaming,
//                so records are deduplicated by message id + request id. No cost.
//   Codex CLI    ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl   `token_count` events with the
//                turn's usage (input includes cached) and the plan's rate limits and credits.
//   Grok Build   ~/.grok/sessions/<cwd>/<id>/usage.json      per-turn tokens and cost
//                (costUsdTicks, 1e10 ticks = 1 USD; input includes cached).
//
// Record: { provider, sessionId, model, ts, cwd|null, tokens: { input, output, cache_read, cache_write, reasoning }, costUsd|null }
//
// Each reader also returns per-session metrics (Analytics screen), `null` where the format does not
// record them: see newMetrics() below.
//
// #389: the scan is incremental (each transcript is read only from where the last scan stopped) and
// the service runs it in a worker thread (readLocalUsageAsync, src/local-usage-worker.js), so the main
// process never blocks on the CLIs' gigabytes of transcripts.

const fs = require('fs');
const path = require('path');
const { cliConfigDirs, cliSessionDirs } = require('./cli-config-dirs');
const { workerClient } = require('./worker-client');

// A pause longer than this between two messages is idle time (the person was away), not active time.
const IDLE_GAP_MS = 5 * 60e3;

// Tool call families. Claude Code, Codex and Grok name their tools differently.
const TOOL_KINDS = ['read', 'edit', 'shell', 'web', 'agent', 'other'];
function toolKind(name) {
  const n = String(name || '').toLowerCase();
  if (/todo|plan/.test(n)) return 'other';
  if (/web|fetch|browse|url/.test(n)) return 'web';
  if (/bash|shell|exec|command|powershell|terminal|stdin/.test(n)) return 'shell';
  if (/edit|write|patch|str_replace|create_file|notebook/.test(n)) return 'edit';
  if (/read|view|cat|grep|glob|search|find|^ls$|list/.test(n)) return 'read';
  if (/^(task|agent)$|subagent|spawn/.test(n)) return 'agent';
  return 'other';
}

/**
 * Per-session metrics. `null` = the CLI's files do not record it (e.g. Grok has no tool calls in
 * usage.json). times: every message timestamp (turned into duration and active time by finishMetrics).
 */
function newMetrics(provider, sessionId) {
  return {
    provider, sessionId, cwd: null, model: null, headless: false, sidechain: true, firstPrompt: null, times: [],
    userPrompts: 0, assistantTurns: 0, toolCalls: Object.fromEntries(TOOL_KINDS.map((k) => [k, 0])), failedToolCalls: 0,
    permissionDenials: 0, interrupts: 0, compactions: 0, peakContext: 0, files: new Set(), linesAdded: 0, linesRemoved: 0,
  };
}

function finishMetrics(m) {
  const t = m.times.map((x) => Date.parse(x)).filter(Number.isFinite).sort((a, b) => a - b);
  let active = 0;
  for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] <= IDLE_GAP_MS) active += t[i] - t[i - 1];
  const { times, files, ...rest } = m;
  return {
    ...rest, files: [...files],
    firstTs: t.length ? new Date(t[0]).toISOString() : null, lastTs: t.length ? new Date(t[t.length - 1]).toISOString() : null,
    durationMs: t.length ? t[t.length - 1] - t[0] : 0, activeMs: active,
  };
}

const countLines = (s) => (typeof s === 'string' && s.length ? s.split('\n').length : 0);
const clip = (s, n) => String(s).replace(/\s+/g, ' ').trim().slice(0, n);
// A prompt a person typed, not a command, command output or injected context (like src/cli-sessions.js).
const isTypedPrompt = (t) => !!t && !/^\s*</.test(t) && !/^\s*Caveat:/.test(t);
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x?.type === 'text' || x?.type === 'input_text').map((x) => x.text).join('\n') : '');

// Files and lines of an apply_patch body (Codex): "*** Update File: x", then +/- lines.
function patchStats(m, patch) {
  for (const line of String(patch || '').split('\n')) {
    const f = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line);
    if (f) m.files.add(f[1].trim());
    else if (line.startsWith('+') && !line.startsWith('+++')) m.linesAdded++;
    else if (line.startsWith('-') && !line.startsWith('---')) m.linesRemoved++;
  }
}

function walk(dir, match, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, match, out);
    else if (match(e.name)) out.push(p);
  }
  return out;
}

const lines = (text) => text.split('\n').map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
const tokens = (input, output, cacheRead, cacheWrite, reasoning) => ({
  input: Math.max(0, input || 0), output: output || 0, cache_read: cacheRead || 0, cache_write: cacheWrite || 0, reasoning: reasoning || 0,
});

// Claude Code: user lines carry the prompts and the tool results (is_error), assistant lines the
// tool_use blocks and usage; compactions are `compact_boundary` system lines (older versions: a user
// line with isCompactSummary); an interrupt is the "[Request interrupted by user" user text.
// The parser keeps its state between chunks (#389): the lines appended to a transcript are fed to
// the same state, and the result is the same as parsing the whole file at once.
const claudeState = () => ({
  kind: 'claude', seen: new Set(), records: [], metrics: new Map(), toolIds: new Set(), turnIds: new Set(), boundaries: 0, compactSummaries: 0,
});
function parseClaude(text) {
  const s = claudeState();
  feedClaude(s, text);
  return claudeResult(s);
}
function feedClaude(s, text) {
  const { seen, records, metrics, toolIds, turnIds } = s;
  for (const j of lines(text)) {
    if (!j.sessionId) continue;
    let m = metrics.get(j.sessionId);
    if (!m) metrics.set(j.sessionId, (m = newMetrics('claude', j.sessionId)));
    m.cwd ??= j.cwd || null;
    if (/^sdk/.test(j.entrypoint || '')) m.headless = true;
    if (j.type === 'system' && j.subtype === 'compact_boundary') s.boundaries++;
    if (j.type !== 'user' && j.type !== 'assistant') continue;
    if (!j.isSidechain) m.sidechain = false;
    if (j.timestamp) m.times.push(j.timestamp);
    const content = j.message?.content;
    if (j.type === 'user') {
      if (j.isCompactSummary) { s.compactSummaries++; continue; }
      for (const r of Array.isArray(content) ? content : []) {
        if (r?.type !== 'tool_result' || !r.is_error) continue;
        m.failedToolCalls++;
        if (/doesn't want to proceed|was rejected|permission/i.test(textOf(r.content) || String(r.content || ''))) m.permissionDenials++;
      }
      const t = textOf(content);
      if (/^\[Request interrupted by user/.test(t)) m.interrupts++;
      else if (!j.isMeta && !j.toolUseResult && isTypedPrompt(t)) {
        m.userPrompts++;
        if (!j.isSidechain) m.firstPrompt ??= clip(t, 300);
      }
      continue;
    }
    if (j.message?.model && j.message.model !== '<synthetic>') m.model ??= j.message.model;
    if (j.message?.id && !turnIds.has(j.message.id)) { turnIds.add(j.message.id); m.assistantTurns++; }
    for (const c of Array.isArray(content) ? content : []) {
      if (c?.type !== 'tool_use' || toolIds.has(c.id)) continue;
      toolIds.add(c.id);
      m.toolCalls[toolKind(c.name)]++;
      const input = c.input || {};
      const file = input.file_path || input.notebook_path;
      if (toolKind(c.name) === 'edit' && file) m.files.add(file);
      if (typeof input.content === 'string') m.linesAdded += countLines(input.content); // Write
      for (const e of [input, ...(Array.isArray(input.edits) ? input.edits : [])]) { // Edit, MultiEdit
        m.linesAdded += countLines(e.new_string);
        m.linesRemoved += countLines(e.old_string);
      }
    }
    const u = j.message?.usage;
    if (!u) continue;
    m.peakContext = Math.max(m.peakContext, (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0));
    const id = `${j.message.id}:${j.requestId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    records.push({
      provider: 'claude', sessionId: j.sessionId, model: j.message.model, ts: j.timestamp,
      tokens: tokens(u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens, u.output_tokens_details?.thinking_tokens),
      costUsd: typeof j.costUSD === 'number' ? j.costUSD : null,
    });
  }
}
function claudeResult(s) {
  // a file is one conversation: its compactions go to its (first) session
  const first = s.metrics.values().next().value;
  if (first) first.compactions = Math.max(s.boundaries, s.compactSummaries);
  return { records: s.records, sessions: [...s.metrics.values()].map(finishMetrics) };
}

// Codex: tool calls are response_item function_call / custom_tool_call / local_shell_call (apply_patch
// carries the diff), prompts are user_message events, interrupts turn_aborted, compactions `compacted`.
function codexState() {
  const m = newMetrics('codex', null);
  m.sidechain = false;
  m.permissionDenials = null; // not recorded
  return { kind: 'codex', records: [], sessionId: null, model: null, plan: null, m };
}
function parseCodex(text) {
  const s = codexState();
  feedCodex(s, text);
  return codexResult(s);
}
function feedCodex(s, text) {
  const { records, m } = s;
  for (const j of lines(text)) {
    const p = j.payload || {};
    if (j.timestamp) m.times.push(j.timestamp);
    if (j.type === 'session_meta') {
      s.sessionId = p.id || p.session_id || s.sessionId;
      m.cwd ??= p.cwd || null;
      if (p.source === 'exec' || /exec/.test(p.originator || '')) m.headless = true;
    } else if (j.type === 'turn_context' && p.model) s.model = p.model;
    else if (j.type === 'compacted' || (j.type === 'event_msg' && p.type === 'context_compacted')) m.compactions++;
    else if (j.type === 'response_item' && /^(function_call|custom_tool_call|local_shell_call)$/.test(p.type)) {
      const name = p.type === 'local_shell_call' ? 'shell' : p.name;
      let args = p.input ?? p.arguments ?? p.action;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* a raw patch */ } }
      const cmd = Array.isArray(args?.command) ? args.command : null;
      const patch = /apply_patch/.test(name || '') ? (typeof args === 'string' ? args : args?.input) : cmd?.some((x) => /apply_patch/.test(x)) ? cmd[cmd.length - 1] : null;
      m.toolCalls[patch != null ? 'edit' : toolKind(name)]++;
      if (patch != null) patchStats(m, patch);
    } else if (j.type === 'response_item' && p.type === 'function_call_output') {
      let out = p.output;
      if (typeof out === 'string') { try { out = JSON.parse(out); } catch { out = null; } }
      if (out?.metadata?.exit_code) m.failedToolCalls++;
    } else if (j.type === 'event_msg' && p.type === 'user_message') {
      const t = String(p.message || '');
      if (!/^\s*<environment_context>/.test(t)) { m.userPrompts++; m.firstPrompt ??= clip(t, 300); }
    } else if (j.type === 'event_msg' && p.type === 'turn_aborted') m.interrupts++;
    else if (j.type === 'event_msg' && p.type === 'token_count') {
      const u = p.info?.last_token_usage;
      if (u) {
        const cachedIn = u.cached_input_tokens || 0;
        m.assistantTurns++;
        m.peakContext = Math.max(m.peakContext, u.input_tokens || 0);
        records.push({
          provider: 'codex', sessionId: s.sessionId, model: s.model || 'codex', ts: j.timestamp,
          tokens: tokens((u.input_tokens || 0) - cachedIn, u.output_tokens, cachedIn, u.cache_write_input_tokens, u.reasoning_output_tokens),
          costUsd: null,
        });
      }
      if (p.rate_limits) s.plan = { ts: j.timestamp, ...p.rate_limits };
    }
  }
}
function codexResult(s) {
  s.m.sessionId = s.sessionId;
  s.m.model = s.model;
  return { records: s.records, plan: s.plan, sessions: s.sessionId ? [finishMetrics(s.m)] : [] };
}

// Grok: usage.json has turns only (no prompts or tool calls); the cwd is in summary.json next to it.
function parseGrok(text, file) {
  const j = JSON.parse(text);
  const model = j.session?.primaryModelId || 'grok';
  const records = (j.turns || []).map((t) => ({
    provider: 'grok', sessionId: j.sessionId, model, ts: t.endedAt,
    tokens: tokens((t.inputTokens || 0) - (t.cachedReadTokens || 0), t.outputTokens, t.cachedReadTokens, t.cacheCreationTokens, t.reasoningTokens),
    costUsd: typeof t.costUsdTicks === 'number' ? t.costUsdTicks / 1e10 : null,
  }));
  const m = newMetrics('grok', j.sessionId || null);
  Object.assign(m, { model, sidechain: false, userPrompts: null, toolCalls: null, failedToolCalls: null, permissionDenials: null, interrupts: null, compactions: null, linesAdded: null, linesRemoved: null });
  for (const t of j.turns || []) {
    m.times.push(...[t.startedAt, t.endedAt].filter(Boolean));
    m.assistantTurns++;
    m.peakContext = Math.max(m.peakContext, t.inputTokens || 0);
  }
  if (file) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'summary.json'), 'utf8'));
      m.cwd = s.info?.cwd || null;
      m.headless = s.session_kind === 'headless';
      m.firstPrompt = s.session_summary ? clip(s.session_summary, 300) : null;
    } catch { /* no summary */ }
  }
  const out = finishMetrics(m);
  out.files = null;
  return { records, sessions: m.sessionId ? [out] : [] };
}

/**
 * Merges the metrics of one session found in several files (Claude Code writes subagent transcripts
 * in their own files, with the parent's session id). Their active time overlaps the parent's, so only
 * main-conversation files add active time.
 */
function mergeMetrics(a, b) {
  if (!a) return { ...b, activeMs: b.sidechain ? 0 : b.activeMs, files: b.files && [...b.files], toolCalls: b.toolCalls && { ...b.toolCalls } };
  const sum = (x, y) => (x == null && y == null ? null : (x || 0) + (y || 0));
  for (const k of ['userPrompts', 'assistantTurns', 'failedToolCalls', 'permissionDenials', 'interrupts', 'compactions', 'linesAdded', 'linesRemoved']) a[k] = sum(a[k], b[k]);
  if (b.toolCalls) { a.toolCalls ??= {}; for (const [k, v] of Object.entries(b.toolCalls)) a.toolCalls[k] = (a.toolCalls[k] || 0) + v; }
  if (b.files) a.files = [...new Set([...(a.files || []), ...b.files])];
  a.peakContext = Math.max(a.peakContext || 0, b.peakContext || 0);
  if (b.firstTs && (!a.firstTs || b.firstTs < a.firstTs)) a.firstTs = b.firstTs;
  if (b.lastTs && (!a.lastTs || b.lastTs > a.lastTs)) a.lastTs = b.lastTs;
  a.durationMs = a.firstTs ? Date.parse(a.lastTs) - Date.parse(a.firstTs) : 0;
  if (!b.sidechain) { a.activeMs += b.activeMs; a.sidechain = false; a.firstPrompt = a.firstPrompt || b.firstPrompt; }
  a.cwd ??= b.cwd; a.model ??= b.model; a.headless = a.headless || b.headless;
  return a;
}

// Codex plan limits (from the most recent token_count event) in a UI-friendly shape.
function codexPlan(raw) {
  if (!raw) return null;
  const win = (w, label) => w && {
    label,
    usedPercent: w.used_percent ?? null,
    windowMinutes: w.window_minutes ?? null,
    resetsAt: w.resets_at ? new Date(w.resets_at * 1000).toISOString() : null,
  };
  const label = (w) => (!w?.window_minutes ? 'window' : w.window_minutes >= 1440 ? `${Math.round(w.window_minutes / 1440)}-day window` : `${Math.round(w.window_minutes / 60)}-hour window`);
  return {
    planType: raw.plan_type || null,
    windows: [win(raw.primary, label(raw.primary)), win(raw.secondary, label(raw.secondary))].filter(Boolean),
    credits: raw.credits ? { hasCredits: !!raw.credits.has_credits, unlimited: !!raw.credits.unlimited, balance: raw.credits.balance ?? null } : null,
    limitReached: raw.rate_limit_reached_type || null,
    updatedAt: raw.ts || null,
  };
}

const SOURCES = (home) => cliSessionDirs(cliConfigDirs(home));

// ---- incremental scan (#389) -------------------------------------------------------------------
// Each transcript keeps an entry between scans: { kind, key: "<mtimeMs>:<size>", offset, state, result }.
// An unchanged key is not read; a JSONL transcript that grew is read from `offset` (the end of the last
// complete line read) and fed to its kept parser state; a smaller one is read again from the start.
// Grok's usage.json is rewritten in place: read whole when its key changes.
const NEW_STATE = { claude: claudeState, codex: codexState };
const FEED = { claude: feedClaude, codex: feedCodex };
const RESULT = { claude: claudeResult, codex: codexResult };

// Reads `file` from entry.offset to `size` and feeds its complete lines; returns the bytes read.
function readAppended(file, entry, size) {
  const length = size - entry.offset;
  if (length <= 0) return 0;
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  let got = 0;
  try {
    while (got < length) {
      const n = fs.readSync(fd, buf, got, length - got, entry.offset + got);
      if (!n) break;
      got += n;
    }
  } finally { fs.closeSync(fd); }
  let end = buf.lastIndexOf(0x0a, got - 1) + 1;
  let text = buf.toString('utf8', 0, end);
  // a last line without its newline counts once it is complete JSON (a line being written is not)
  if (end < got) {
    const tail = buf.toString('utf8', end, got);
    try { JSON.parse(tail); text += tail; end = got; } catch { /* still being written */ }
  }
  FEED[entry.kind](entry.state, text);
  entry.offset += end;
  return got;
}

// The entry of `file` after this scan, and how many bytes were read for it (0: `prev` as it was).
function scanFile(file, kind, prev) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${st.mtimeMs}:${st.size}`;
  if (prev && prev.key === key) return { entry: prev, bytes: 0 };
  if (kind === 'grok') {
    let result;
    try { result = parseGrok(fs.readFileSync(file, 'utf8'), file); } catch { result = { records: [] }; }
    return { entry: { kind, key, result }, bytes: st.size };
  }
  const fresh = !prev || prev.kind !== kind || st.size < prev.offset;
  const entry = fresh ? { kind, key, offset: 0, state: NEW_STATE[kind]() } : { ...prev, key };
  let bytes = 0;
  try { bytes = readAppended(file, entry, st.size); } catch { /* unreadable now: kept as it was */ }
  entry.result = RESULT[kind](entry.state);
  return { entry, bytes };
}

/**
 * One scan of the CLIs' transcripts over the kept entries (`states`: file → entry, updated in place).
 * Returns readLocalUsage's result plus `scan` ({ files, parsedFiles, bytesParsed }), and `changed`
 * (the files whose entry changed) and `gone` (the files no longer there) for the index.
 */
function scanLocalUsage({ home, states = new Map() } = {}) {
  const src = SOURCES(home);
  const records = [];
  const sessions = new Map();
  const found = { claude: false, codex: false, grok: false };
  const scan = { files: 0, parsedFiles: 0, bytesParsed: 0 };
  const present = new Set();
  const changed = [];
  let latestPlan = null;
  const each = (kind, files) => {
    for (const f of files) {
      found[kind] = true;
      scan.files++;
      present.add(f);
      const prev = states.get(f);
      const r = scanFile(f, kind, prev);
      if (!r) continue;
      if (r.entry !== prev) { states.set(f, r.entry); changed.push(f); }
      if (r.bytes) { scan.parsedFiles++; scan.bytesParsed += r.bytes; }
      const res = r.entry.result;
      for (const x of res.records) records.push(x);
      for (const m of res.sessions || []) {
        const k = `${m.provider}:${m.sessionId}`;
        sessions.set(k, mergeMetrics(sessions.get(k), m));
      }
      if (res.plan && (!latestPlan || String(res.plan.ts) > String(latestPlan.ts))) latestPlan = res.plan;
    }
  };
  each('claude', walk(src.claude, (n) => n.endsWith('.jsonl')));
  each('codex', walk(src.codex, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl')));
  each('grok', walk(src.grok, (n) => n === 'usage.json'));
  const gone = [...states.keys()].filter((f) => !present.has(f) && [src.claude, src.codex, src.grok].some((d) => d && f.startsWith(d)));
  for (const f of gone) states.delete(f);
  return { records, sessions, plans: { codex: codexPlan(latestPlan) }, found, sources: src, scan, changed, gone };
}

// An entry as JSON for the index (Sets and Maps kept; a parser's result is rebuilt from its state), and back.
const encodeEntry = ({ result, ...entry }) => JSON.stringify(entry.state ? entry : { ...entry, result },
  (k, v) => (v instanceof Set ? { $set: [...v] } : v instanceof Map ? { $map: [...v] } : v));
function decodeEntry(text) {
  const entry = JSON.parse(text, (k, v) => (v && Array.isArray(v.$set) ? new Set(v.$set) : v && Array.isArray(v.$map) ? new Map(v.$map) : v));
  if (entry.state) entry.result = RESULT[entry.kind](entry.state);
  return entry;
}

const syncStates = new Map(); // file → entry, for readLocalUsage in this thread

/**
 * All usage records the CLIs wrote on this machine, plus Codex plan limits, plus the metrics of each
 * session (`sessions`, keyed "<provider>:<sessionId>"). Synchronous, in the calling thread: the
 * service uses readLocalUsageAsync.
 */
function readLocalUsage({ home } = {}) {
  const { changed, gone, ...out } = scanLocalUsage({ home, states: syncStates });
  return out;
}

// ---- the usage worker (#389) ---------------------------------------------------------------------
// One worker thread per process (src/local-usage-worker.js) keeps the entries between calls and,
// given the workspace's index.db (`index`), loads and saves them in its usage_files table. If it
// cannot start, the work runs in the calling thread.
const usageWorker = workerClient(path.join(__dirname, 'local-usage-worker.js'));
function inUsageWorker(message, fallback) {
  try { return usageWorker(message); } catch (e) {
    console.error('usage worker:', e.message);
    return Promise.resolve().then(fallback);
  }
}

/**
 * readLocalUsage off the calling thread (#389): resolves to its result plus `scan`
 * ({ files, parsedFiles, bytesParsed }: what this call read). `index`: the workspace's index.db,
 * where the per-file entries are kept between app starts.
 */
function readLocalUsageAsync({ home, index } = {}) {
  return inUsageWorker({ op: 'scan', home, index: index || null }, () => readLocalUsage({ home }));
}

/**
 * src/usage.js computeUsage(opts) in the usage worker (#389): the machine scope's records never
 * cross to the calling thread, only the totals. The runs are read from runs/ (the index is the
 * service's), `local` from the worker's own scan of `home`'s transcripts.
 */
function computeUsageAsync({ home, index, ...opts }) {
  return inUsageWorker({ op: 'usage', home, index: index || null, opts }, () => require('./usage').computeUsage({
    ...opts, local: opts.scope === 'machine' ? readLocalUsage({ home }) : null,
  }));
}

module.exports = {
  codexPlan,
  computeUsageAsync,
  decodeEntry,
  encodeEntry,
  IDLE_GAP_MS,
  mergeMetrics,
  parseClaude,
  parseCodex,
  parseGrok,
  readLocalUsage,
  readLocalUsageAsync,
  scanLocalUsage,
  TOOL_KINDS,
  toolKind,
};
