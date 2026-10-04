// Run costs as read from a run's events (#233), shared by the run lists (src/runs.js), Analytics'
// Run tab (src/run-analysis.js) and through them the roadmap's real cost (src/cost-estimate.js).
// Runs recorded since `cost_accounting: 'per_turn'` (workflow.started, summary.json) are read as
// recorded: each turn's cost_usd is its own and an attempt stopped before its result has a
// `session.attempt_stopped` event (estimated, or cost not recorded), except a Claude turn with several
// `result` events recorded before #277 (summary without `turn_cost: 'max_result'`): its cost_usd is
// the last event's (often 0), so it costs the highest cost among its `usage` stream items. Runs
// recorded before per-turn costs:
// - a Claude turn recorded the CLI's `total_cost_usd`, cumulative over the CLI session on `--resume`:
//   its own cost is the difference with the previous turn of the same CLI session, and the session
//   costs its last total (handoff sessions, one turn each, and other providers are unchanged);
// - an `attempt N/M failed` log line is an attempt whose cost was never recorded.
// Pure: the files are read by the callers and never rewritten. The Run screen reads a live or
// replayed run's events itself (src/renderer/app.js) with the same two regexes below.

const ATTEMPT_FAILED = /^\[([^\]]+)\] attempt \d+\/\d+ failed: (.*)$/;
// failures before the CLI ran: nothing was paid
const NOT_STARTED = /not found in PATH|Working directory does not exist|Provider ".*" is not defined/;

const perTurn = (summary, events) => summary?.cost_accounting === 'per_turn'
  || (events || []).some((e) => e.type === 'workflow.started' && e.cost_accounting === 'per_turn');

/**
 * The costs of a run read from its events: `turnCost(ev)` the corrected cost of a
 * session.message_received or session.attempt_stopped event, `overcount` per session id (what its
 * recorded cost_usd counted twice), `stopped` the attempts stopped before their result
 * ({ agent, sessionId, t, costUsd, estimated, notRecorded }).
 */
function runCosts(events = [], summary = null) {
  const fixed = perTurn(summary, events);
  const own = new Map();
  const overcount = new Map();
  const stopped = [];
  const provider = new Map();
  const agentOf = new Map();
  const last = new Map();
  const streamed = new Map(); // `${session_id}:${turn}` → the highest cost among the turn's usage items
  for (const e of events) {
    if (e.type === 'session.stream') {
      const c = e.item?.kind === 'usage' ? Number(e.item.costUsd) : NaN;
      const k = `${e.session_id}:${e.turn}`;
      if (fixed && c > (streamed.get(k) || 0)) streamed.set(k, c);
      continue;
    }
    const snap = e.session;
    if (snap && e.session_id) {
      if (snap.provider) provider.set(e.session_id, snap.provider);
      if (snap.agent) agentOf.set(e.session_id, snap.agent);
    }
    if (e.type === 'session.attempt_stopped') {
      stopped.push({ agent: agentOf.get(e.session_id) || null, sessionId: e.session_id, step: e.step_id || null, t: Date.parse(e.ts || ''),
        costUsd: Number(e.cost_usd) || 0, estimated: !!e.estimated, notRecorded: !!e.cost_not_recorded });
      continue;
    }
    if (!fixed && e.type === 'log' && e.level === 'error') {
      const m = ATTEMPT_FAILED.exec(String(e.message || ''));
      if (m && !NOT_STARTED.test(m[2])) stopped.push({ agent: m[1], sessionId: null, step: null, t: Date.parse(e.ts || ''), costUsd: 0, estimated: false, notRecorded: true });
      continue;
    }
    if (e.type !== 'session.message_received') continue;
    if (fixed) {
      // #277: a turn with several `result` events was recorded with the last one's cost (often 0)
      const recorded = Number(e.cost_usd) || 0;
      const best = streamed.get(`${e.session_id}:${e.turn}`) || 0;
      if (best > recorded) {
        own.set(e, best);
        overcount.set(e.session_id, (overcount.get(e.session_id) || 0) + recorded - best);
      }
      continue;
    }
    if (provider.get(e.session_id) !== 'claude') continue;
    const recorded = Number(e.cost_usd) || 0;
    const cli = snap?.provider_session_id || null;
    const prev = last.get(e.session_id);
    const cost = prev && cli && prev.cli === cli && recorded >= prev.total ? recorded - prev.total : recorded;
    last.set(e.session_id, { cli, total: recorded });
    if (cost !== recorded) {
      own.set(e, cost);
      overcount.set(e.session_id, (overcount.get(e.session_id) || 0) + recorded - cost);
    }
  }
  return {
    perTurn: fixed,
    overcount,
    stopped,
    turnCost: (e) => (own.has(e) ? own.get(e) : Number(e.cost_usd) || 0),
    overcountUsd: [...overcount.values()].reduce((a, x) => a + x, 0),
  };
}

// an old run's stopped attempt is known by its agent's name and time: the session open at that time
const openAt = (s, t) => !(Date.parse(s.opened_at || '') > t) && !(Date.parse(s.closed_at || '') < t);

/**
 * `sessions` (summary.json's or rebuilt from events) with the overcount of `costs` removed, and
 * `cost_not_recorded` on a session with a stopped attempt whose cost was not recorded.
 */
function correctSessions(sessions = [], costs) {
  const missing = (costs?.stopped || []).filter((x) => x.notRecorded);
  if (!costs?.overcount.size && !missing.length) return sessions;
  return sessions.map((s) => {
    let out = s;
    if (costs.overcount.has(s.id)) out = { ...s, cost_usd: +Math.max(0, (Number(s.cost_usd) || 0) - costs.overcount.get(s.id)).toFixed(6), recorded_cost_usd: s.cost_usd };
    if (!s.cost_not_recorded && missing.some((x) => (x.sessionId ? x.sessionId === s.id : x.agent === s.agent && openAt(s, x.t)))) out = { ...out, cost_not_recorded: true };
    return out;
  });
}

// a run recorded before per-turn costs: its events say which turns counted twice and which attempts
// left no cost; one recorded before #277 (no `turn_cost: 'max_result'`): which turns recorded 0
const needsEvents = (summary) => (summary?.cost_accounting !== 'per_turn' || summary?.turn_cost !== 'max_result')
  && (summary?.sessions || []).length > 0;

module.exports = {
  correctSessions,
  needsEvents,
  runCosts,
};
