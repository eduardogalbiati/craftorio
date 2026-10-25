// An agent session's prompt cache (#320): how long it lives per provider and what the session's
// next turn will re-read. One pure module for the engine (session snapshots), the service
// (sessionView), the Oracle (its warm sessions, #244) and the screens (the session table's "Next
// turn" column, the gate card's Continue line). src/domains/session/session-cache.js re-exports it for Node.
// Next turn kinds: 'fresh' (from the handoff note), 'warm' (cache read until `until`), 'cold' (its
// whole context written again, since `since`), 'resume' (a lifetime nobody measured: Codex, Grok),
// 'new' (no turn yet, or ephemeral); null for a closed session.
// Browser: window.SessionCache; Node: module.exports.
(function (root) {
  const MIN = 60e3;
  const HOUR = 60 * MIN;
  // Claude Code: 1 hour on a subscription, 5 minutes on an API key (its default). Codex and Grok:
  // unknown until measured.
  const LIFETIMES = { claude: { subscription: HOUR, api_key: 5 * MIN } };
  // what `fresh_after_idle` and the Oracle keep below the lifetime (55m for Claude's hour)
  const CACHE_MARGIN_MS = 5 * MIN;

  // tier: the cache tier the provider's usage reported ('1h' | '5m'), it wins over the auth's default
  function cacheLifetimeMs(provider, { auth = 'subscription', tier = null } = {}) {
    const p = LIFETIMES[provider];
    if (!p) return null;
    if (tier === '1h') return HOUR;
    if (tier === '5m') return 5 * MIN;
    return p[auth] ?? p.subscription;
  }

  // Claude's usage: cache_creation.ephemeral_1h_input_tokens / ephemeral_5m_input_tokens (null: not reported)
  function cacheTier(usage) {
    const c = usage?.cache_creation;
    if (!c || typeof c !== 'object') return null;
    if (c.ephemeral_1h_input_tokens > 0) return '1h';
    if (c.ephemeral_5m_input_tokens > 0) return '5m';
    return null;
  }

  // What writing `tokens` to the cache costs at `price` ({ input, cache_write } per million tokens):
  // Claude bills a write at 1.25× input for 5 minutes, 2× for an hour, unless the price says it.
  function cacheWriteUsd(tokens, price, lifetimeMs) {
    if (!(tokens > 0) || !price) return null;
    const perM = price.cache_write ?? (price.input != null ? price.input * (lifetimeMs >= HOUR ? 2 : 1.25) : null);
    return perM == null ? null : (tokens * perM) / 1e6;
  }

  const has = (v) => v !== undefined && v !== null;
  const tokensOf = (n) => (n > 0 ? { tokens: n } : {});

  // session: a snapshot (snake_case: last_turn_at, context_tokens, mode, has_note,
  // fresh_after_idle_ms, cache_lifetime_ms, start_context_tokens, rotate_pending: its last turn passed
  // max_context). lifetimeMs: the cache's lifetime
  // (default: the snapshot's, else the provider's, a simulated session's provider it simulates).
  function nextTurn(session, { now = Date.now(), lifetimeMs } = {}) {
    const s = session;
    if (!s || s.closed_at || s.agent === 'orchestrator') return null;
    if (s.mode === 'ephemeral') return { kind: 'new' };
    if (s.mode === 'handoff') return s.has_note ? { kind: 'fresh', ...tokensOf(s.start_context_tokens) } : { kind: 'new' };
    const last = Date.parse(s.last_turn_at || '');
    // turns without a last turn: a snapshot from before #320 (or a first attempt stopped): unknown
    if (!Number.isFinite(last)) return s.turns > 0 ? null : { kind: 'new' };
    const idle = now - last;
    if (s.has_note && (s.rotate_pending || (s.fresh_after_idle_ms > 0 && idle > s.fresh_after_idle_ms))) return { kind: 'fresh', ...tokensOf(s.start_context_tokens) };
    const life = lifetimeMs !== undefined ? lifetimeMs
      : s.cache_lifetime_ms !== undefined ? s.cache_lifetime_ms
        : cacheLifetimeMs(s.simulates || s.provider);
    if (!has(life)) return { kind: 'resume', ...tokensOf(s.context_tokens) };
    if (idle < life) return { kind: 'warm', until: last + life, ...tokensOf(s.context_tokens) };
    return { kind: 'cold', since: last + life, ...tokensOf(s.context_tokens) };
  }

  // The next turn now, for a session in either shape (a snapshot, or sessionView's camelCase): from
  // its fields when it has them, else the next turn it came with (`next_turn` / `nextTurn`, null:
  // closed). A fresh turn without its own estimate keeps the one it came with.
  function currentTurn(session, now = Date.now()) {
    if (!session) return null;
    const given = session.next_turn !== undefined ? session.next_turn : session.nextTurn;
    if (given === null) return null;
    const pick = (snake, camel) => (session[snake] !== undefined ? session[snake] : session[camel]);
    const raw = {
      ...session,
      closed_at: pick('closed_at', 'closedAt'),
      last_turn_at: pick('last_turn_at', 'lastTurnAt'),
      context_tokens: pick('context_tokens', 'contextTokens'),
      has_note: pick('has_note', 'hasNote'),
      fresh_after_idle_ms: pick('fresh_after_idle_ms', 'freshAfterIdleMs'),
      cache_lifetime_ms: pick('cache_lifetime_ms', 'cacheLifetimeMs'),
      start_context_tokens: pick('start_context_tokens', 'startContextTokens'),
      rotate_pending: pick('rotate_pending', 'rotatePending'),
    };
    if (!raw.mode && !raw.last_turn_at) return given || null;
    const t = nextTurn(raw, { now });
    if (t && given && t.kind === given.kind && t.tokens === undefined && given.tokens > 0) t.tokens = given.tokens;
    // what writing its context again costs at the run's prices (none without a price)
    const cold = pick('cold_resume_usd', 'coldResumeUsd');
    if (t?.kind === 'cold' && cold > 0) t.cost_usd = cold;
    return t;
  }

  // ---- how the screens say it -----------------------------------------------------------------
  const kTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
  // HH:MM in the owner's time zone (#273, time-zone.js; in node, the computer's)
  const clockOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: typeof TimeZone !== 'undefined' ? TimeZone.current() : undefined });
  const usdOf = (v) => (v > 0 ? ` ≈ $${v.toFixed(2)}` : '');
  const ESTIMATE = 'The cache lifetime is an estimate (Claude: 1 hour on a subscription, 5 minutes on an API key).';
  const TURN_TITLES = {
    fresh: 'Its next turn starts a fresh session from its handoff note: it re-reads the note and the prompt, not the conversation.',
    warm: 'Its next turn resumes the conversation while the prompt cache is warm: its context is read from the cache (cheap).',
    cold: 'Its next turn resumes the conversation after the prompt cache expired: its whole context is written to the cache again.',
    resume: 'Its next turn resumes the conversation; this provider\'s cache lifetime has not been measured.',
    new: 'Its next turn opens a new session with only the prompt.',
  };

  // The session table's "Next turn" cell: the state first, then the detail
  function turnText(t, now = Date.now()) {
    if (!t) return '—';
    const tokens = t.tokens > 0 ? ` · ~${kTok(t.tokens)} tokens` : '';
    if (t.kind === 'fresh') return `fresh from note${tokens}`;
    if (t.kind === 'warm') return `warm · ${Math.max(1, Math.ceil((t.until - now) / MIN))} min left`;
    if (t.kind === 'cold') return `cold since ${clockOf(t.since)}${tokens}${usdOf(t.cost_usd)}`;
    if (t.kind === 'resume') return `resumes${tokens} · cache lifetime unknown`;
    return 'new session';
  }

  const turnTitle = (t) => (t ? `${TURN_TITLES[t.kind] || ''} ${ESTIMATE}`.trim() : 'Closed: this session has no next turn.');

  // One entry of the gate card's Continue line: "fresh from note ~20K", "resumes cold ~140K ≈ $0.70"
  function gateTurnText(t) {
    const tokens = t.tokens > 0 ? ` ~${kTok(t.tokens)}` : '';
    if (t.kind === 'fresh') return `fresh from note${tokens}`;
    if (t.kind === 'warm') return `resumes warm${tokens}`;
    if (t.kind === 'cold') return `resumes cold${tokens}${usdOf(t.cost_usd)}`;
    if (t.kind === 'resume') return `resumes${tokens} (cache lifetime unknown)`;
    return 'new session';
  }

  // The lead of the Continue line: '' when an agent resumes cold (or with an unknown lifetime)
  function continueLead(turns) {
    if (!turns.length) return 'no agent session to resume';
    return turns.some((x) => x.turn.kind === 'cold' || x.turn.kind === 'resume') ? '' : 'every agent starts fresh or warm';
  }

  // The whole line as plain text (the phone page): turns from agentNextTurns, label(agent) its name
  function continueText(turns, label = (a) => a) {
    const parts = [continueLead(turns), ...turns.map(({ agent, turn }) => `${label(agent)} ${gateTurnText(turn)}`)].filter(Boolean);
    return `Continue: ${parts.join(' · ')}`;
  }

  // The gate card's line: one entry per agent whose latest session is open, plus a handoff agent
  // whose last session closed with its note (its next turn starts fresh from it). sessions: in the
  // order they opened. → [{ agent, turn }]
  function agentNextTurns(sessions, now = Date.now()) {
    const latest = new Map();
    for (const s of sessions || []) if (s?.agent && s.agent !== 'orchestrator') latest.set(s.agent, s);
    const out = [];
    for (const [agent, s] of latest) {
      let turn = currentTurn(s, now);
      if (!turn && s.mode === 'handoff' && (s.has_note ?? s.hasNote)) turn = { kind: 'fresh', ...tokensOf(s.start_context_tokens ?? s.startContextTokens) };
      if (turn) out.push({ agent, turn });
    }
    return out;
  }

  const api = {
    CACHE_MARGIN_MS,
    agentNextTurns,
    cacheLifetimeMs,
    cacheTier,
    cacheWriteUsd,
    continueLead,
    continueText,
    currentTurn,
    gateTurnText,
    nextTurn,
    turnText,
    turnTitle,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SessionCache = api;
})(typeof window !== 'undefined' ? window : globalThis);
