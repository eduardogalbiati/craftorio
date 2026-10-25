// The conversational agents' usage (#280): the Oracle, the Product Owner and the Supervisor chat record
// every real turn the same way, and Analytics' Agents tab reads the three (channel analytics:agents,
// packages/engine/service/areas/usage.js).
//   <workspace>/oracle/usage.jsonl                  the Oracle (packages/engine/domains/oracle/oracle.js: also cumulativeUsd, wake)
//   <workspace>/backlog/product-owner.usage.jsonl   the Product Owner (packages/engine/domains/po/product-owner.js: projectId)
//   <workspace>/supervisor/usage.jsonl              the Supervisor chat (packages/engine/domains/supervisor/supervisor-chat.js: also cumulativeUsd)
// One line per real turn (a simulated turn records nothing), appended, never rewritten:
//   { ts, agent, projectId?, provider, model, tokens: { input, output, cache_read, cache_write }, costUsd,
//     sessionId, session: 'fresh' | 'resumed', startReason? (why a fresh session started: first,
//     compaction, model-change, idle, reset, cleared or one-shot), contextTokens? (the context after
//     the turn, when known) }
// Lines from before #280 lack agent, session and startReason (the Product Owner's, sessionId too): they
// are read as they are, their sessions with no start reason. agentsAnalytics is pure: the service
// gives it each agent's lines.

const fs = require('fs');
const path = require('path');
const TimeZone = require('../analytics/time-zone');

const AGENTS = ['oracle', 'product-owner', 'supervisor'];
const TOKEN_KINDS = ['input', 'output', 'cache_read', 'cache_write'];

/**
 * A .jsonl file's lines (a line that is not JSON is skipped). A file that cannot be read has none, like
 * a missing one (the budget checks go on); `strict` throws instead, unless it is missing (the Agents
 * tab shows the error).
 */
function readLines(file, { strict = false } = {}) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (strict && e.code !== 'ENOENT') throw e; return []; }
  return text.split('\n').map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
}

/**
 * Appends one real turn to an agent's usage file → the line. `startReason`: why the turn started a
 * session (null: it resumed one); `extra`: the agent's own fields (cumulativeUsd, the Oracle's wake).
 */
function appendTurn(file, { agent, projectId = null, provider = 'claude', model, tokens, costUsd, sessionId, startReason = null, contextTokens = null, extra = {} }) {
  const line = {
    ts: new Date().toISOString(), agent, ...(projectId ? { projectId } : {}), provider, model, tokens: tokens || {}, costUsd: Number(costUsd) || 0, ...extra,
    sessionId: sessionId || null, session: startReason ? 'fresh' : 'resumed', ...(startReason ? { startReason } : {}),
    ...(contextTokens == null ? {} : { contextTokens }),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
  return line;
}

const usd = (n) => +n.toFixed(6);
// the Oracle's lines carry the turn's own cost in `turnUsd` (oracle.usageLines)
const costOf = (u) => Number(u.turnUsd ?? u.costUsd) || 0;
const noTokens = () => Object.fromEntries(TOKEN_KINDS.map((k) => [k, 0]));
const addTokens = (sum, tokens) => { for (const k of TOKEN_KINDS) sum[k] += Number(tokens?.[k]) || 0; return sum; };

/**
 * An agent's spend as summary-like runs, one per local day (settings.timeZone, #273; default UTC)
 * (usage.computeUsage's `extraRuns`): it is in no run folder, and counts in Usage and the monthly
 * budgets like the runs.
 */
function dayRuns(lines, { id, workflow, timeZone = 'UTC' }) {
  const days = new Map();
  for (const u of lines) {
    if (!u.ts) continue;
    const day = TimeZone.dayKey(u.ts, timeZone);
    if (!days.has(day)) days.set(day, { run_id: `${id}-${day}`, workflow, started_at: u.ts, status: 'succeeded', sessions: [] });
    days.get(day).sessions.push({ provider: u.provider || 'claude', model: u.model, tokens: u.tokens || {}, cost_usd: costOf(u), provider_session_id: u.sessionId || null, turns: 1 });
  }
  return [...days.values()];
}

// The sessions of an agent's turns (oldest first). A turn continues the session before it when it
// has its session id and did not start one; a line without a session id is a session of its own.
function sessionsOf(agent, turns) {
  const oneShot = agent === 'product-owner';
  const list = [];
  let cur = null;
  for (const u of turns) {
    const resumed = cur && !oneShot && u.sessionId && u.sessionId === cur.sessionId && u.session !== 'fresh';
    if (!resumed) {
      cur = { agent, sessionId: u.sessionId || null, start: u.ts, startReason: u.startReason || null, turns: 0, contextAtEnd: null, costUsd: 0, tokens: null, end: u.ts, endReason: null };
      list.push(cur);
    }
    cur.turns += 1;
    cur.costUsd = usd(cur.costUsd + costOf(u));
    if (u.tokens) cur.tokens = addTokens(cur.tokens || noTokens(), u.tokens);
    cur.contextAtEnd = Number(u.contextTokens) || null;
    cur.end = u.ts;
  }
  list.forEach((s, i) => { s.endReason = oneShot ? 'answered' : i === list.length - 1 ? 'open' : list[i + 1].startReason; });
  return list;
}

// One agent in a range of local days (inclusive): what happened after `to` is not looked at, so the
// last session of the range is open.
function agentUsage(agent, lines, { from, to, timeZone = 'UTC' }) {
  const dayOf = (u) => TimeZone.dayKey(u.ts, timeZone);
  const turns = lines
    .filter((u) => u?.ts && (!from || dayOf(u) >= from) && (!to || dayOf(u) <= to))
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const sessions = sessionsOf(agent, turns);
  const days = new Map();
  for (const u of turns) {
    const day = dayOf(u);
    if (!days.has(day)) days.set(day, { day, costUsd: 0, tokens: noTokens() });
    const d = days.get(day);
    d.costUsd = usd(d.costUsd + costOf(u));
    addTokens(d.tokens, u.tokens);
  }
  const totals = {
    costUsd: usd(turns.reduce((s, u) => s + costOf(u), 0)),
    tokens: turns.reduce((sum, u) => addTokens(sum, u.tokens), noTokens()),
    turns: turns.length,
    sessions: sessions.length,
    // the Supervisor chat's turns from before its usage file: their cost only
    turnsWithoutTokens: turns.filter((u) => !u.tokens).length,
  };
  if (agent === 'product-owner') totals.projects = new Set(turns.map((u) => u.projectId).filter(Boolean)).size;
  // a line from before #280 does not say what its turn answered: it is in neither count
  if (agent === 'oracle') Object.assign(totals, { wakeUps: turns.filter((u) => u.wake === true).length, questions: turns.filter((u) => u.wake === false).length });
  return { totals, days: [...days.values()], sessions };
}

/**
 * Analytics' Agents tab: { oracle, productOwner, supervisor } (each agent's usage lines), from/to
 * (local days in `timeZone`, default UTC, inclusive) → { from, to, agents: { oracle | 'product-owner' | supervisor: { totals:
 * { costUsd, tokens, turns, sessions, turnsWithoutTokens, projects? (Product Owner), wakeUps?, questions? (Oracle) },
 * days: [{ day, costUsd, tokens }], sessions: [{ agent, sessionId, start, startReason, turns,
 * contextAtEnd, costUsd, tokens (null: not recorded), end, endReason }] } } }.
 */
function agentsAnalytics({ oracle = [], productOwner = [], supervisor = [], from = null, to = null, timeZone = 'UTC' } = {}) {
  const lines = { oracle, 'product-owner': productOwner, supervisor };
  return { from, to, agents: Object.fromEntries(AGENTS.map((id) => [id, agentUsage(id, lines[id], { from, to, timeZone })])) };
}

module.exports = {
  agentsAnalytics,
  appendTurn,
  dayRuns,
  readLines,
};
