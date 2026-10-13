// Run costs as read from a run's events (#233, #277), for callers that hold a run's events as
// recorded. The corrections themselves are the run record's upgrades (src/shared/run-record.js,
// #350): this reads their result back per event. The readers of recorded runs read the upgraded
// record instead (src/run-record.js). Pure: the files are read by the callers and never rewritten.

const { upgradeRunRecord } = require('./shared/run-record');

const isTurn = (e) => e.type === 'session.message_received';

/**
 * The costs of a run read from its events: `turnCost(ev)` the corrected cost of one of its
 * session.message_received or session.attempt_stopped events, `overcount` per session id (what its
 * recorded cost_usd counted twice), `stopped` the attempts stopped before their result
 * ({ agent, sessionId, step, t, costUsd, estimated, notRecorded }).
 */
function runCosts(events = [], summary = null) {
  const upgraded = upgradeRunRecord({ summary, events }).events;
  // the upgrades never add or remove a turn: the n-th turn recorded is the n-th upgraded
  const own = new Map();
  const turns = upgraded.filter(isTurn);
  events.filter(isTurn).forEach((e, i) => own.set(e, turns[i]));
  const overcount = new Map();
  for (const [e, u] of own) {
    const diff = (Number(e.cost_usd) || 0) - (Number(u.cost_usd) || 0);
    if (Math.abs(diff) > 1e-9) overcount.set(e.session_id, (overcount.get(e.session_id) || 0) + diff);
  }
  const agentOf = new Map();
  const stopped = [];
  for (const e of upgraded) {
    if (e.session?.agent && e.session_id) agentOf.set(e.session_id, e.session.agent);
    if (e.type !== 'session.attempt_stopped') continue;
    stopped.push({ agent: agentOf.get(e.session_id) || e.agent || null, sessionId: e.session_id ?? null, step: e.step_id || null, t: Date.parse(e.ts || ''),
      costUsd: Number(e.cost_usd) || 0, estimated: !!e.estimated, notRecorded: !!e.cost_not_recorded });
  }
  return {
    overcount,
    stopped,
    turnCost: (e) => Number((own.get(e) || e).cost_usd) || 0,
    overcountUsd: [...overcount.values()].reduce((a, x) => a + x, 0),
  };
}

// a stopped attempt without a session is known by its agent's name and time: the session open at that time
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

module.exports = {
  correctSessions,
  runCosts,
};
