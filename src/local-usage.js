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
// Record: { provider, sessionId, model, ts, tokens: { input, output, cache_read, cache_write, reasoning }, costUsd|null }

const fs = require('fs');
const os = require('os');
const path = require('path');

const cache = new Map(); // file -> { key, records, plan }

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

// Parses each file once per (mtime, size).
function cached(file, parse) {
  let st;
  try { st = fs.statSync(file); } catch { return { records: [] }; }
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit;
  let val;
  try { val = parse(fs.readFileSync(file, 'utf8')); } catch { val = { records: [] }; }
  const entry = { key, ...val };
  cache.set(file, entry);
  return entry;
}

const lines = (text) => text.split('\n').map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
const tokens = (input, output, cacheRead, cacheWrite, reasoning) => ({
  input: Math.max(0, input || 0), output: output || 0, cache_read: cacheRead || 0, cache_write: cacheWrite || 0, reasoning: reasoning || 0,
});

function parseClaude(text) {
  const seen = new Set();
  const records = [];
  for (const j of lines(text)) {
    const u = j.message?.usage;
    if (!u || j.type !== 'assistant') continue;
    const id = `${j.message.id}:${j.requestId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    records.push({
      provider: 'claude', sessionId: j.sessionId, model: j.message.model, ts: j.timestamp,
      tokens: tokens(u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens, u.output_tokens_details?.thinking_tokens),
      costUsd: typeof j.costUSD === 'number' ? j.costUSD : null,
    });
  }
  return { records };
}

function parseCodex(text) {
  const records = [];
  let sessionId = null;
  let model = null;
  let plan = null;
  for (const j of lines(text)) {
    const p = j.payload || {};
    if (j.type === 'session_meta') sessionId = p.id || p.session_id || sessionId;
    else if (j.type === 'turn_context' && p.model) model = p.model;
    else if (j.type === 'event_msg' && p.type === 'token_count') {
      const u = p.info?.last_token_usage;
      if (u) {
        const cachedIn = u.cached_input_tokens || 0;
        records.push({
          provider: 'codex', sessionId, model: model || 'codex', ts: j.timestamp,
          tokens: tokens((u.input_tokens || 0) - cachedIn, u.output_tokens, cachedIn, u.cache_write_input_tokens, u.reasoning_output_tokens),
          costUsd: null,
        });
      }
      if (p.rate_limits) plan = { ts: j.timestamp, ...p.rate_limits };
    }
  }
  return { records, plan };
}

function parseGrok(text) {
  const j = JSON.parse(text);
  const model = j.session?.primaryModelId || 'grok';
  const records = (j.turns || []).map((t) => ({
    provider: 'grok', sessionId: j.sessionId, model, ts: t.endedAt,
    tokens: tokens((t.inputTokens || 0) - (t.cachedReadTokens || 0), t.outputTokens, t.cachedReadTokens, t.cacheCreationTokens, t.reasoningTokens),
    costUsd: typeof t.costUsdTicks === 'number' ? t.costUsdTicks / 1e10 : null,
  }));
  return { records };
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

const SOURCES = (home) => ({
  claude: path.join(home, '.claude', 'projects'),
  codex: path.join(home, '.codex', 'sessions'),
  grok: path.join(home, '.grok', 'sessions'),
});

/** All usage records the CLIs wrote on this machine, plus Codex plan limits. */
function readLocalUsage({ home = os.homedir() } = {}) {
  const src = SOURCES(home);
  const records = [];
  const found = { claude: false, codex: false, grok: false };
  for (const f of walk(src.claude, (n) => n.endsWith('.jsonl'))) { found.claude = true; records.push(...cached(f, parseClaude).records); }
  let latestPlan = null;
  for (const f of walk(src.codex, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'))) {
    found.codex = true;
    const r = cached(f, parseCodex);
    records.push(...r.records);
    if (r.plan && (!latestPlan || String(r.plan.ts) > String(latestPlan.ts))) latestPlan = r.plan;
  }
  for (const f of walk(src.grok, (n) => n === 'usage.json')) { found.grok = true; records.push(...cached(f, parseGrok).records); }
  return { records, plans: { codex: codexPlan(latestPlan) }, found, sources: src };
}

module.exports = { readLocalUsage, parseClaude, parseCodex, parseGrok, codexPlan };
