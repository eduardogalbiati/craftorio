// The run record normalizer (#350): a recorded run ({ summary, events }: summary.json, null while the
// run has none, and events.jsonl) in today's shape. Each change of a run's shape has one upgrade,
// named after its change, that turns a record of the older shape into the newer one; they run in
// order, once each, on read (src/run-record.js reads the files, the renderer upgrades live events).
// Pure: the record given is never changed and the run's files are never rewritten. An upgrade that
// does not apply returns the record as is, so a current run passes through unchanged and upgrading
// twice gives the same record. Readers (src/run-analysis.js, src/oracle-run-analysis.js,
// src/runs.js, src/analytics.js through the run index, src/renderer/app.js) read the current shape
// only. Adding an upgrade: docs/agents/storage.md.
// Browser: window.RunRecord; Node: module.exports.
(function (root) {
  const ATTEMPT_FAILED = /^\[([^\]]+)\] attempt \d+\/\d+ failed: (.*)$/;
  // failures before the CLI ran: nothing was paid
  const NOT_STARTED = /not found in PATH|Working directory does not exist|Provider ".*" is not defined/;
  // the events that carry a session's snapshot (`session`); session.updated: #320
  const SESSION_EVENTS = new Set([
    'session.attempt_stopped',
    'session.closed',
    'session.message_received',
    'session.opened',
    'session.updated',
  ]);

  const round = (n) => +Math.max(0, Number(n) || 0).toFixed(6);
  const isStarted = (e) => e.type === 'workflow.started';
  const isFinished = (e) => e.type === 'workflow.finished' && !!e.summary;
  const perTurn = ({ summary, events }) => summary?.cost_accounting === 'per_turn'
    || events.some((e) => isStarted(e) && e.cost_accounting === 'per_turn');
  const maxResult = ({ summary, events }) => summary?.turn_cost === 'max_result'
    || events.some((e) => (isStarted(e) && e.turn_cost === 'max_result') || (isFinished(e) && e.summary.turn_cost === 'max_result'));

  // `fn` applied to the summary and to the copy workflow.finished carries; `started` to workflow.started
  function withSummaries({ summary, events }, fn, started = null) {
    return {
      summary: summary ? fn(summary) : summary,
      events: events.map((e) => (isFinished(e) ? { ...e, summary: fn(e.summary) } : started && isStarted(e) ? started(e) : e)),
    };
  }

  // The record with each turn's own cost (`own`: session.message_received event → its cost): the
  // snapshots, the sessions and the run's cost without what the recorded costs counted twice.
  function withOwnCosts(record, own) {
    if (!own.size) return record;
    const over = new Map(); // session id → what its recorded costs counted twice so far
    const events = record.events.map((e) => {
      let out = e;
      if (own.has(e)) {
        over.set(e.session_id, (over.get(e.session_id) || 0) + (Number(e.cost_usd) || 0) - own.get(e));
        out = { ...e, cost_usd: own.get(e) };
      }
      if (e.session && over.get(e.session_id)) out = { ...out, session: { ...e.session, cost_usd: round(Number(e.session.cost_usd) - over.get(e.session_id)) } };
      return out;
    });
    const total = [...over.values()].reduce((a, x) => a + x, 0);
    return withSummaries({ summary: record.summary, events }, (s) => ({
      ...s,
      cost_usd: round(Number(s.cost_usd) - total),
      ...(Array.isArray(s.sessions) ? { sessions: s.sessions.map((x) => (over.has(x.id) ? { ...x, cost_usd: round(Number(x.cost_usd) - over.get(x.id)) } : x)) } : {}),
    }));
  }

  // an old run's failed attempt: its log line's [agent] and error, null for another line or a
  // failure before the CLI ran
  function failedAttempt(e) {
    if (e.type !== 'log' || e.level !== 'error') return null;
    const m = ATTEMPT_FAILED.exec(String(e.message || ''));
    return m && !NOT_STARTED.test(m[2]) ? { agent: m[1], error: m[2] } : null;
  }

  // a summary session open at time t (its final snapshot's dates)
  const openAt = (s, t) => !(Date.parse(s.opened_at || '') > t) && !(Date.parse(s.closed_at || '') < t);

  const addUsage = (a = {}, b = {}) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, (Number(a[k]) || 0) + (Number(b[k]) || 0)]));

  /**
   * The sessions of a run from its events' snapshots (the latest of each, with its final status),
   * as summary.json lists them; a turn recorded without its session's snapshot adds itself to it.
   */
  function sessionsOfEvents(events = []) {
    const byId = new Map();
    for (const e of events) {
      if (SESSION_EVENTS.has(e.type) && e.session) byId.set(e.session_id, { ...e.session, status: e.type === 'session.closed' ? e.status : e.session.status });
      else if (e.type === 'session.status' && byId.has(e.session_id)) byId.get(e.session_id).status = e.status;
      else if (e.type === 'session.message_received' && byId.has(e.session_id)) {
        const s = byId.get(e.session_id);
        Object.assign(s, { turns: (Number(s.turns) || 0) + 1, tokens: addUsage(s.tokens, e.usage), cost_usd: round((Number(s.cost_usd) || 0) + (Number(e.cost_usd) || 0)) });
      }
    }
    return [...byId.values()];
  }

  const onlyIssue = (x) => !!x && x.issue != null && !(Array.isArray(x.issues) && x.issues.length);
  const withIssues = (x) => (onlyIssue(x) ? { ...x, issues: [x.issue] } : x);

  // In order: each one reads the shape the ones before it left.
  const UPGRADES = [
    {
      // a run from before multi-issue runs recorded its single `issue`
      name: 'single issue: issues',
      applies: ({ summary, events }) => onlyIssue(summary) || events.some((e) => isStarted(e) && onlyIssue(e)),
      upgrade: (record) => withSummaries(record, withIssues, withIssues),
    },
    {
      // #233: an attempt stopped before its result was recorded only as an `attempt N/M failed` log
      // line: it becomes a session.attempt_stopped whose cost was not recorded, on the session of
      // its agent open at that time, after the line (the line stays)
      name: '#233 stopped attempt',
      applies: (record) => !perTurn(record) && record.events.some(failedAttempt),
      upgrade({ summary, events }) {
        const snaps = new Map(); // session id → latest snapshot, while open
        const steps = new Map(); // step id → agent, while running
        const flagged = new Set();
        const flag = (s) => ({ ...s, cost_not_recorded: true });
        const out = [];
        for (const e of events) {
          if (e.type === 'step.started') steps.set(e.step_id, e.agent);
          else if (e.type === 'step.finished') steps.delete(e.step_id);
          if (e.session && SESSION_EVENTS.has(e.type)) snaps.set(e.session_id, e.session);
          if (e.type === 'session.closed') snaps.delete(e.session_id);
          out.push(e.session && flagged.has(e.session_id) ? { ...e, session: flag(e.session) } : e);
          const failed = failedAttempt(e);
          if (!failed) continue;
          const t = Date.parse(e.ts || '');
          const id = [...snaps].reverse().find(([, s]) => s.agent === failed.agent)?.[0]
            ?? (summary?.sessions || []).findLast((s) => s.agent === failed.agent && openAt(s, t))?.id ?? null;
          const step = [...steps].reverse().find(([, agent]) => agent === failed.agent)?.[0] ?? null;
          if (id != null) flagged.add(id);
          out.push({
            ts: e.ts, type: 'session.attempt_stopped', session_id: id, step_id: step, agent: failed.agent, cost_usd: 0, cost_not_recorded: true,
            ...(snaps.has(id) ? { session: flag(snaps.get(id)) } : {}),
          });
        }
        const fix = (s) => (Array.isArray(s.sessions) ? { ...s, sessions: s.sessions.map((x) => (flagged.has(x.id) ? flag(x) : x)) } : s);
        return withSummaries({ summary, events: out }, fix);
      },
    },
    {
      // #233: a Claude turn resumed (--resume) before per-turn costs recorded the CLI session's
      // cumulative total_cost_usd: its own cost is the difference with the previous turn of the same
      // CLI session (handoff sessions, one turn each, and other providers are unchanged). The record
      // is then per-turn, and its turn costs final (#277's correction never applied to these runs).
      name: '#233 per-turn cost',
      applies: (record) => !perTurn(record),
      upgrade(record) {
        const own = new Map();
        const provider = new Map();
        const last = new Map(); // session id → { cli, total } of its previous turn
        for (const e of record.events) {
          if (e.session?.provider && e.session_id) provider.set(e.session_id, e.session.provider);
          if (e.type !== 'session.message_received' || provider.get(e.session_id) !== 'claude') continue;
          const recorded = Number(e.cost_usd) || 0;
          const cli = e.session?.provider_session_id || null;
          const prev = last.get(e.session_id);
          last.set(e.session_id, { cli, total: recorded });
          if (prev && cli && prev.cli === cli && recorded >= prev.total && prev.total) own.set(e, round(recorded - prev.total));
        }
        const marks = { cost_accounting: 'per_turn', turn_cost: 'max_result' };
        return withSummaries(withOwnCosts(record, own), (s) => ({ ...s, ...marks }), (e) => ({ ...e, ...marks }));
      },
    },
    {
      // #277: a per-turn Claude turn with several `result` events, recorded before `turn_cost:
      // 'max_result'`, kept the last one's cost (often 0): it costs the highest cost among its
      // `usage` stream items after its last stopped attempt (that attempt's items are its own cost)
      name: '#277 multi-result turn',
      applies: (record) => perTurn(record) && !maxResult(record),
      upgrade(record) {
        const own = new Map();
        const streamed = new Map(); // `${session_id}:${turn}` → highest usage cost of the current attempt
        for (const e of record.events) {
          const k = `${e.session_id}:${e.turn}`;
          if (e.type === 'session.stream') {
            const c = e.item?.kind === 'usage' ? Number(e.item.costUsd) : NaN;
            if (c > (streamed.get(k) || 0)) streamed.set(k, c);
          } else if (e.type === 'session.attempt_stopped') streamed.delete(k);
          else if (e.type === 'session.message_received' && (streamed.get(k) || 0) > (Number(e.cost_usd) || 0)) own.set(e, round(streamed.get(k)));
        }
        return withSummaries(withOwnCosts(record, own), (s) => ({ ...s, turn_cost: 'max_result' }));
      },
    },
    {
      // a summary recorded before it listed its sessions: the events' latest snapshots
      name: 'sessions in the summary',
      applies: ({ summary }) => !!summary && !Array.isArray(summary.sessions),
      upgrade: (record) => withSummaries(record, (s) => (Array.isArray(s.sessions) ? s : { ...s, sessions: sessionsOfEvents(record.events) })),
    },
  ];

  /** `{ summary, events }` of a recorded run (summary null: none yet) in the current shape. */
  function upgradeRunRecord({ summary = null, events = [] } = {}) {
    let record = { summary: summary || null, events: events || [] };
    for (const u of UPGRADES) if (u.applies(record)) record = u.upgrade(record);
    return record;
  }

  /** Whether a summary.json needs its run's events to reach the current shape (else its own upgrade is enough). */
  const summaryNeedsEvents = (summary) => !!summary
    && (summary.cost_accounting !== 'per_turn' || summary.turn_cost !== 'max_result' || !Array.isArray(summary.sessions));

  const api = {
    sessionsOfEvents,
    summaryNeedsEvents,
    upgradeRunRecord,
    UPGRADES,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunRecord = api;
})(typeof window !== 'undefined' ? window : globalThis);
