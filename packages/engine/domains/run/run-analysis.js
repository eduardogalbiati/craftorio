// One run in depth (#228), for Analytics' Run tab: its header, a timeline of step visits per agent
// (machine steps on the orchestrator's row), per-agent turns, time, cost and tokens (with the
// effective $/M tokens and, #308, the sub-agents' calls and tokens they include), per-step visits,
// suite rounds, gate waits and the slowest tool calls, from the run's summary.json and events.jsonl; and its comparison with the other real successful runs of
// the same workflow (median and p25-p75 per figure). Pure: the service (analytics:run in
// packages/engine/service/areas/insights.js) reads the run record (packages/engine/domains/run/run-record.js) and caches the figures;
// a record of an older shape is upgraded first (#350, packages/shared/run-record.js).

const { upgradeRunRecord } = require('@multiagent/shared/run-record');

const MIN_RUNS = 3;
const HISTORY = 30;
const TOP_TOOLS = 10;
const ORCHESTRATOR = 'orchestrator';
const TOKEN_KINDS = ['input', 'output', 'cache_read', 'cache_write'];

const ms = (t) => Date.parse(t || '');
const tokensOf = (u = {}) => Object.fromEntries(TOKEN_KINDS.map((k) => [k, Number(u?.[k]) || 0]));
const addTokens = (a, b) => Object.fromEntries(TOKEN_KINDS.map((k) => [k, a[k] + b[k]]));
const sumTokens = (t) => TOKEN_KINDS.reduce((s, k) => s + t[k], 0);
const countOf = (x) => (Array.isArray(x) ? x.length : Number(x) || 0);
// the record in the current shape; a run still going has no summary: {}
function upgradedOf(summary, events) {
  const record = upgradeRunRecord({ summary, events });
  return { summary: record.summary || {}, events: record.events };
}
// each turn's own cost (the record's upgrades corrected the older ones)
const turnCost = (e) => Number(e.cost_usd) || 0;
// the attempts stopped before their result: estimated, or their cost was not recorded
const stoppedOf = (events) => events.filter((e) => e.type === 'session.attempt_stopped').map((e) => ({
  agent: e.session?.agent || e.agent || null, sessionId: e.session_id, step: e.step_id || null, t: ms(e.ts), costUsd: turnCost(e), estimated: !!e.estimated, notRecorded: !!e.cost_not_recorded,
}));

/** The figures of one run: `summary` its summary.json (null: none yet), `events` its events.jsonl. */
function runFigures({ summary: recorded = null, events: all = [], now = Date.now() }) {
  const { summary, events } = upgradedOf(recorded, all);
  const started = events.find((e) => e.type === 'workflow.started') || {};
  const finished = events.findLast((e) => e.type === 'workflow.finished');
  const startedAt = summary.started_at || started.ts || null;
  const finishedAt = summary.finished_at || finished?.ts || null;
  const end = ms(finishedAt) || now;
  const issues = summary.issues || started.issues || [];
  // a run still going has no summary, so no sessions yet
  const sessions = summary.sessions || [];
  const costUsd = Number(summary.cost_usd ?? finished?.summary?.cost_usd) || 0;
  const stopped = stoppedOf(events);

  // agents: the sessions' totals, the turns' active and waiting time
  const sessionAgent = new Map(sessions.map((s) => [s.id, s.agent]));
  const stepAgent = new Map();
  const agents = new Map();
  const agentOf = (name) => {
    if (!agents.has(name)) agents.set(name, { agent: name, turns: 0, costUsd: 0, costEstimatedUsd: 0, costNotRecorded: false, activeMs: 0, waitingMs: 0, tokens: tokensOf() });
    return agents.get(name);
  };
  for (const s of sessions) {
    const a = agentOf(s.agent || s.step_id || 'agent');
    a.turns += Number(s.turns) || 0;
    a.costUsd += Number(s.cost_usd) || 0;
    a.tokens = addTokens(a.tokens, tokensOf(s.tokens));
  }
  const fromSessions = new Set(agents.keys());
  const turns = [];
  for (const e of events) {
    if (e.type === 'step.started' && e.agent) stepAgent.set(e.step_id, e.agent);
    if (e.type !== 'session.message_received') continue;
    const name = sessionAgent.get(e.session_id) || stepAgent.get(e.step_id) || e.step_id || 'agent';
    const a = agentOf(name);
    a.activeMs += Number(e.active_ms) || 0;
    a.waitingMs += Number(e.waiting_ms) || 0;
    // #308: the sub-agents' share of the agent's tokens (already in its usage); absent on a turn
    // recorded before, or one that started none
    if (e.subagents?.calls) {
      a.subagents ??= { calls: 0, tokens: 0 };
      a.subagents.calls += Number(e.subagents.calls) || 0;
      a.subagents.tokens += sumTokens(tokensOf(e.subagents.usage));
    }
    // a run still going (no summary): the turns are the only source
    if (!fromSessions.has(name)) {
      a.turns += 1;
      a.costUsd += turnCost(e);
      a.tokens = addTokens(a.tokens, tokensOf(e.usage));
    }
    turns.push({ t: ms(e.ts), step: e.step_id, agent: name, cost: turnCost(e) });
  }
  for (const x of stopped) {
    const name = x.agent || sessionAgent.get(x.sessionId) || stepAgent.get(x.step) || 'agent';
    const a = agentOf(name);
    if (!fromSessions.has(name)) a.costUsd += x.costUsd;
    if (x.estimated) a.costEstimatedUsd += x.costUsd;
    if (x.notRecorded) a.costNotRecorded = true;
    turns.push({ t: x.t, step: x.step, agent: name, cost: x.costUsd, estimated: x.estimated ? x.costUsd : 0, notRecorded: x.notRecorded });
  }
  const agentList = [...agents.values()].map((a) => {
    const all = sumTokens(a.tokens);
    return { ...a, totalTokens: all, usdPerMTokens: all ? a.costUsd / (all / 1e6) : null };
  }).sort((x, y) => y.costUsd - x.costUsd);

  // step visits: the timeline bars and the per-step totals
  const open = new Map();
  const timeline = [];
  const steps = new Map();
  const stepOf = (id) => {
    if (!steps.has(id)) steps.set(id, { step: id, visits: 0, durationMs: 0, agent: '' });
    return steps.get(id);
  };
  const suiteRounds = [];
  for (const e of events) {
    if (e.type === 'step.started') {
      open.set(e.step_id, e);
      const s = stepOf(e.step_id);
      s.visits += 1;
      s.agent = e.agent || s.agent;
    } else if (e.type === 'step.finished') {
      const st = open.get(e.step_id);
      open.delete(e.step_id);
      const from = st ? ms(st.ts) : ms(e.ts) - (Number(e.duration_ms) || 0);
      const to = ms(e.ts);
      const durationMs = Number(e.duration_ms) || Math.max(0, to - from);
      stepOf(e.step_id).durationMs += durationMs;
      const agent = st?.agent || '';
      // an old run's stopped attempt is only known by its agent's log line: matched by agent and time
      const within = turns.filter((x) => (x.step ? x.step === e.step_id : !!agent && x.agent === agent) && x.t >= from && x.t <= to);
      timeline.push({
        row: agent || ORCHESTRATOR, step: e.step_id, visit: e.visit || st?.visit || 1, agent, kind: st?.step_type || (agent ? 'agent' : 'machine'),
        from: new Date(from).toISOString(), to: new Date(to).toISOString(), durationMs,
        costUsd: within.reduce((s, x) => s + x.cost, 0),
        costEstimatedUsd: within.reduce((s, x) => s + (x.estimated || 0), 0),
        costNotRecorded: within.some((x) => x.notRecorded),
        status: e.status || e.output?.status || null,
      });
      if (e.output?.kind === 'suite') {
        suiteRounds.push({
          step: e.step_id, round: e.output.round ?? suiteRounds.length + 1, status: e.output.status || null,
          durationMs: Number(e.output.duration_ms) || durationMs, failures: countOf(e.output.failures), preexisting: countOf(e.output.preexisting),
          // #304: scope affected: the files it selected and why, and whether the whole suite ran after them
          scope: e.output.scope || null, affected: !!e.output.affected,
          selection: e.output.selection ? { mode: e.output.selection.mode || null, why: e.output.selection.why || '', reasons: e.output.selection.reasons || {} } : null,
        });
      }
    }
  }
  // a step still running (the run is open, or was cut): its bar runs to the end
  for (const [id, st] of open) {
    timeline.push({ row: st.agent || ORCHESTRATOR, step: id, visit: st.visit || 1, agent: st.agent || '', kind: st.step_type || 'agent', from: st.ts, to: new Date(end).toISOString(), durationMs: Math.max(0, end - ms(st.ts)), costUsd: 0, status: 'running' });
  }

  // gate waits, by gate name
  const requested = new Map();
  const gates = [];
  for (const e of events) {
    if (e.type === 'approval.requested') requested.set(e.approval_id, e);
    else if (e.type === 'approval.resolved' && requested.has(e.approval_id)) {
      const r = requested.get(e.approval_id);
      requested.delete(e.approval_id);
      gates.push({ gate: r.step_id || e.step_id, from: r.ts, to: e.ts, waitMs: Number(e.wait_ms) || Math.max(0, ms(e.ts) - ms(r.ts)), approved: e.approved !== false, by: e.by || null });
    }
  }
  for (const r of requested.values()) gates.push({ gate: r.step_id, from: r.ts, to: null, waitMs: Math.max(0, end - ms(r.ts)), approved: null, by: null });

  // tool calls: the time from the call to its result
  const calls = new Map();
  const tools = [];
  for (const e of events) {
    if (e.type !== 'session.stream' || !e.item) continue;
    const key = `${e.session_id} ${e.item.id}`;
    if (e.item.kind === 'tool_call') calls.set(key, e);
    else if (e.item.kind === 'tool_result' && calls.has(key)) {
      const c = calls.get(key);
      calls.delete(key);
      const input = c.item.input || {};
      tools.push({
        tool: c.item.name || 'tool', command: String(input.command || input.file_path || input.pattern || input.description || c.item.name || ''),
        durationMs: Math.max(0, ms(e.ts) - ms(c.ts)), agent: sessionAgent.get(c.session_id) || '', step: c.step_id || null, at: c.ts,
      });
    }
  }

  const gateWaitMs = Number(summary.timing?.gate_wait_ms) || gates.reduce((s, g) => s + g.waitMs, 0);
  const durationMs = Number(summary.duration_ms ?? summary.timing?.duration_ms) || Math.max(0, end - ms(startedAt));
  return {
    runId: summary.run_id || null,
    workflow: summary.workflow || started.workflow || null,
    file: started.file || summary.file || null,
    // the workflow's display names (#245): id → name, for agents and steps
    agentNames: (started.display?.agents || started.agent_names) ? { ...started.display?.agents, ...started.agent_names } : null,
    stepNames: started.display?.steps || null,
    title: summary.title || null,
    issues,
    status: summary.status || finished?.status || 'running',
    mock: !!(summary.mock ?? started.mock),
    startedAt,
    finishedAt,
    costUsd,
    // #233: the part of costUsd estimated from stopped attempts; a stopped attempt without a cost
    costEstimatedUsd: stopped.reduce((s, x) => s + (x.estimated ? x.costUsd : 0), 0),
    costNotRecorded: stopped.some((x) => x.notRecorded),
    costPerIssue: issues.length ? costUsd / issues.length : null,
    durationMs,
    gateWaitMs,
    activeMs: Math.max(0, durationMs - gateWaitMs),
    tokens: tokensOf(summary.tokens),
    agents: agentList,
    steps: [...steps.values()],
    suiteRounds,
    gates,
    slowestTools: tools.sort((a, b) => b.durationMs - a.durationMs).slice(0, TOP_TOOLS),
    timeline: timeline.sort((a, b) => ms(a.from) - ms(b.from)),
  };
}

const quantile = (list, q) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};

// One figure against the same figure of the other runs: lower is better (cost, time).
function compareValue(value, list) {
  const values = list.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (value == null || !values.length) return null;
  const median = quantile(values, 0.5);
  const p25 = quantile(values, 0.25);
  const p75 = quantile(values, 0.75);
  const diff = value - median;
  const verdict = Math.abs(diff) < 1e-9 ? 'same' : diff < 0 ? 'better' : 'worse';
  // worse: amber up to the p75, red beyond it
  const level = verdict === 'worse' ? (value > p75 ? 'red' : 'amber') : verdict === 'better' ? 'green' : 'neutral';
  return { value, median, p25, p75, diff, diffPct: median ? (diff / median) * 100 : null, verdict, level, count: values.length };
}

/**
 * `figures` (runFigures, or the same shape) against `history`: the real successful runs of its
 * workflow, other than itself, the latest `limit`. Fewer than MIN_RUNS: reported, not compared.
 */
function compareWithWorkflow(figures, history = [], { limit = HISTORY, minRuns = MIN_RUNS } = {}) {
  const peers = history
    .filter((h) => h.workflow === figures.workflow && h.status === 'success' && !h.mock && h.runId !== figures.runId)
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
    .slice(0, limit);
  const out = { workflow: figures.workflow, count: peers.length, tooFew: peers.length < minRuns, minRuns, runIds: peers.map((p) => p.runId), metrics: {}, agents: {} };
  if (out.tooFew) return out;
  for (const key of ['costUsd', 'durationMs', 'costPerIssue']) {
    const c = compareValue(figures[key], peers.map((p) => p[key]));
    if (c) out.metrics[key] = c;
  }
  for (const a of figures.agents || []) {
    const same = peers.map((p) => (p.agents || []).find((x) => x.agent === a.agent)).filter(Boolean);
    const entry = {};
    for (const key of ['costUsd', 'activeMs']) {
      const c = compareValue(a[key], same.map((x) => x[key]));
      if (c) entry[key] = c;
    }
    if (Object.keys(entry).length) out.agents[a.agent] = entry;
  }
  return out;
}

module.exports = {
  compareWithWorkflow,
  MIN_RUNS,
  ORCHESTRATOR,
  quantile,
  runFigures,
};
