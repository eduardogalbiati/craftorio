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
const { pathKey } = require('./platform-paths');
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

// The span and active time of m.times, continued from m.fold ({ first, last, active }: the times an
// index entry folded, #389). A time before the folded span's end counts as inside it.
function foldTimes(m) {
  const t = m.times.map((x) => Date.parse(x)).filter(Number.isFinite).sort((a, b) => a - b);
  let { first = null, last = null, active = 0 } = m.fold || {};
  for (const x of t) {
    if (last == null) { first = last = x; continue; }
    if (x < last) { first = Math.min(first, x); continue; }
    if (x - last <= IDLE_GAP_MS) active += x - last;
    last = x;
  }
  return { first, last, active };
}

function finishMetrics(m) {
  const { first, last, active } = foldTimes(m);
  const { times, fold, files, ...rest } = m;
  return {
    ...rest, files: [...files],
    firstTs: first == null ? null : new Date(first).toISOString(), lastTs: last == null ? null : new Date(last).toISOString(),
    durationMs: first == null ? 0 : last - first, activeMs: active,
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
  for (const j of lines(text)) {
    if (!j.sessionId) continue;
    const m = claudeSession(s, j);
    if (j.type === 'system' && j.subtype === 'compact_boundary') s.boundaries++;
    if (j.type !== 'user' && j.type !== 'assistant') continue;
    if (!j.isSidechain) m.sidechain = false;
    if (j.timestamp) m.times.push(j.timestamp);
    if (j.type === 'user') claudeUser(s, m, j);
    else claudeAssistant(s, m, j);
  }
}
function claudeSession(s, j) {
  let m = s.metrics.get(j.sessionId);
  if (!m) s.metrics.set(j.sessionId, (m = newMetrics('claude', j.sessionId)));
  m.cwd ??= j.cwd || null;
  if (/^sdk/.test(j.entrypoint || '')) m.headless = true;
  return m;
}
function claudeUser(s, m, j) {
  if (j.isCompactSummary) { s.compactSummaries++; return; }
  const content = j.message?.content;
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
}
function claudeAssistant(s, m, j) {
  const msg = j.message || {};
  if (msg.model && msg.model !== '<synthetic>') m.model ??= msg.model;
  if (msg.id && !s.turnIds.has(msg.id)) { s.turnIds.add(msg.id); m.assistantTurns++; }
  for (const c of Array.isArray(msg.content) ? msg.content : []) {
    if (c?.type !== 'tool_use' || s.toolIds.has(c.id)) continue;
    s.toolIds.add(c.id);
    claudeToolUse(m, c);
  }
  const u = msg.usage;
  if (!u) return;
  m.peakContext = Math.max(m.peakContext, (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0));
  const id = `${msg.id}:${j.requestId}`;
  if (s.seen.has(id)) return;
  s.seen.add(id);
  s.records.push({
    provider: 'claude', sessionId: j.sessionId, model: msg.model, ts: j.timestamp,
    tokens: tokens(u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens, u.output_tokens_details?.thinking_tokens),
    costUsd: typeof j.costUSD === 'number' ? j.costUSD : null,
  });
}
function claudeToolUse(m, c) {
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
  for (const j of lines(text)) {
    const p = j.payload || {};
    if (j.timestamp) s.m.times.push(j.timestamp);
    if (j.type === 'session_meta') codexMeta(s, p);
    else if (j.type === 'turn_context' && p.model) s.model = p.model;
    else if (j.type === 'compacted' || (j.type === 'event_msg' && p.type === 'context_compacted')) s.m.compactions++;
    else if (j.type === 'response_item') codexResponseItem(s.m, p);
    else if (j.type === 'event_msg') codexEvent(s, j, p);
  }
}
function codexMeta(s, p) {
  s.sessionId = p.id || p.session_id || s.sessionId;
  s.m.cwd ??= p.cwd || null;
  if (p.source === 'exec' || /exec/.test(p.originator || '')) s.m.headless = true;
}
function codexResponseItem(m, p) {
  if (/^(function_call|custom_tool_call|local_shell_call)$/.test(p.type)) {
    const name = p.type === 'local_shell_call' ? 'shell' : p.name;
    let args = p.input ?? p.arguments ?? p.action;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* a raw patch */ } }
    const cmd = Array.isArray(args?.command) ? args.command : null;
    const patch = /apply_patch/.test(name || '') ? (typeof args === 'string' ? args : args?.input) : cmd?.some((x) => /apply_patch/.test(x)) ? cmd[cmd.length - 1] : null;
    m.toolCalls[patch != null ? 'edit' : toolKind(name)]++;
    if (patch != null) patchStats(m, patch);
  } else if (p.type === 'function_call_output') {
    let out = p.output;
    if (typeof out === 'string') { try { out = JSON.parse(out); } catch { out = null; } }
    if (out?.metadata?.exit_code) m.failedToolCalls++;
  }
}
function codexEvent(s, j, p) {
  const { m } = s;
  if (p.type === 'user_message') {
    const t = String(p.message || '');
    if (!/^\s*<environment_context>/.test(t)) { m.userPrompts++; m.firstPrompt ??= clip(t, 300); }
  } else if (p.type === 'turn_aborted') m.interrupts++;
  else if (p.type === 'token_count') {
    const u = p.info?.last_token_usage;
    if (u) {
      const cachedIn = u.cached_input_tokens || 0;
      m.assistantTurns++;
      m.peakContext = Math.max(m.peakContext, u.input_tokens || 0);
      s.records.push({
        provider: 'codex', sessionId: s.sessionId, model: s.model || 'codex', ts: j.timestamp,
        tokens: tokens((u.input_tokens || 0) - cachedIn, u.output_tokens, cachedIn, u.cache_write_input_tokens, u.reasoning_output_tokens),
        costUsd: null,
      });
    }
    if (p.rate_limits) s.plan = { ts: j.timestamp, ...p.rate_limits };
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
  try { bytes = readAppended(file, entry, st.size); } catch {
    // unreadable now: read again at the next scan (a fresh entry starts over then)
    if (prev && !fresh) return { entry: prev, bytes: 0 };
    entry.key = null;
  }
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
      if (r.entry !== prev) { states.set(f, r.entry); if (r.entry.key) changed.push(f); } // no key: unreadable, not saved
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
  // the entries of this scan's folders whose file is gone (other homes' entries stay)
  const under = (f, d) => d && pathKey(f).startsWith(pathKey(d) + path.sep);
  const gone = [...states.keys()].filter((f) => !present.has(f) && [src.claude, src.codex, src.grok].some((d) => under(f, d)));
  for (const f of gone) states.delete(f);
  return { records, sessions, plans: { codex: codexPlan(latestPlan) }, found, sources: src, scan, changed, gone };
}

// An entry as compact JSON for the index, and back (a parser's result is rebuilt from its state):
// records as rows, each session's times folded into { first, last, active }, and only the last
// RECENT_IDS ids of each dedup set (a message's repeated chunks and tool calls are adjacent lines).
const ENTRY_VERSION = 2;
const RECENT_IDS = 1000;
const recent = (set) => [...set].slice(-RECENT_IDS);
const packRecords = (rs) => rs.map((r) => [r.sessionId, r.model, r.ts, r.tokens.input, r.tokens.output, r.tokens.cache_read, r.tokens.cache_write, r.tokens.reasoning, r.costUsd]);
const unpackRecords = (provider, rows) => rows.map(([sessionId, model, ts, input, output, cache_read, cache_write, reasoning, costUsd]) => ({
  provider, sessionId, model, ts, tokens: { input, output, cache_read, cache_write, reasoning }, costUsd,
}));
const packMetrics = (m) => ({ ...m, times: [], fold: foldTimes(m), files: [...m.files] });
const unpackMetrics = (m) => ({ ...m, files: new Set(m.files) });
function packState(s) {
  const out = { ...s, records: packRecords(s.records) };
  if (s.kind !== 'claude') return { ...out, m: packMetrics(s.m) };
  return { ...out, seen: recent(s.seen), toolIds: recent(s.toolIds), turnIds: recent(s.turnIds), metrics: [...s.metrics].map(([k, m]) => [k, packMetrics(m)]) };
}
function unpackState(s) {
  const out = { ...s, records: unpackRecords(s.kind, s.records) };
  if (s.kind !== 'claude') return { ...out, m: unpackMetrics(s.m) };
  return { ...out, seen: new Set(s.seen), toolIds: new Set(s.toolIds), turnIds: new Set(s.turnIds), metrics: new Map(s.metrics.map(([k, m]) => [k, unpackMetrics(m)])) };
}
function encodeEntry({ result, ...entry }) {
  const packed = entry.state ? { ...entry, state: packState(entry.state) } : { ...entry, result: { ...result, records: packRecords(result.records) } };
  return JSON.stringify({ v: ENTRY_VERSION, ...packed });
}
function decodeEntry(text) {
  const { v, ...entry } = JSON.parse(text);
  if (v !== ENTRY_VERSION) throw new Error('an older entry');
  if (!entry.state) return { ...entry, result: { ...entry.result, records: unpackRecords(entry.kind, entry.result.records) } };
  entry.state = unpackState(entry.state);
  entry.result = RESULT[entry.kind](entry.state);
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
// cannot start (or stops), the work runs in the calling thread; an error of the work itself is
// rethrown (running it again here would only block this thread to fail the same way).
// Shared with the worker: [GEN] counts the index releases (a message of an older generation no
// longer touches the index), [BUSY] is 1 while the worker holds a connection to it.
const usageControl = new Int32Array(new SharedArrayBuffer(8));
const usageWorker = workerClient(path.join(__dirname, 'local-usage-worker.js'), { workerData: { control: usageControl } });
function inUsageWorker(message, fallback) {
  const here = (e) => {
    if (e.answered) throw e;
    console.error('usage worker:', e.message);
    return fallback();
  };
  const gen = Atomics.load(usageControl, 0);
  try { return usageWorker({ ...message, gen }).catch(here); } catch (e) { return Promise.resolve(e).then(here); }
}

/**
 * Before the service closes the workspace's index (shutdown, a workspace switch): the usage worker
 * drops the saves still pending for it and this waits (blocking, at most `timeoutMs`) until it no
 * longer holds a connection, so the workspace folder can be removed or moved (Windows) (#389).
 */
function releaseUsageIndex(timeoutMs = 10000) {
  Atomics.add(usageControl, 0, 1);
  const end = Date.now() + timeoutMs;
  while (Atomics.load(usageControl, 1) === 1 && Date.now() < end) Atomics.wait(usageControl, 1, 1, end - Date.now());
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
  releaseUsageIndex,
  scanLocalUsage,
  TOOL_KINDS,
  toolKind,
};
