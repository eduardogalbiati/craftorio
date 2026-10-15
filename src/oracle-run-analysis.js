// The Oracle's run_analysis tool (#184): where a run's time and money went, the figures behind the
// 2026-10-02 efficiency analysis (#176-#179), moved into the app from the outside session's
// night/tw/perf/toolerr scripts. Per run and in total: cost and tokens by agent and by step (each
// turn's own cost), review rounds, attempts timed out, invalid outputs, tool calls
// refused, merge conflicts, commands cut by a tool's timeout, the test writer's turns × context and
// cache re-read, and the whole-suite starts (the orchestrator's suite step and the ones an agent
// started itself) with their durations. Pure: the caller reads summary.json and events.jsonl; a
// record of an older shape is upgraded first (#350, src/shared/run-record.js).

const { upgradeRunRecord } = require('./shared/run-record');

const TOKEN_KINDS = ['input', 'output', 'cache_read', 'cache_write'];
const TEST_WRITER = /test_?writer/i;
const CONFLICT_TEXT = /merge conflict|conflicts with (the|its) (local )?(base|target)/i;
const REFUSED_TEXT = /requires approval|not allowed|permission denied by|was refused/i;

const ms = (t) => Date.parse(t || '');
const tokensOf = (u = {}) => Object.fromEntries(TOKEN_KINDS.map((k) => [k, Number(u?.[k]) || 0]));
const addTokens = (a, b) => Object.fromEntries(TOKEN_KINDS.map((k) => [k, (a[k] || 0) + (b[k] || 0)]));
const round = (n) => +Number(n || 0).toFixed(6);
// a turn's own cost (the record's upgrades corrected the older ones)
const costOf = (e) => Number(e.cost_usd) || 0;
const emptyFigures = () => ({ costUsd: 0, turns: 0, tokens: tokensOf() });
const addTo = (map, key, cost, tokens, turns = 1) => {
  const f = map[key] || (map[key] = emptyFigures());
  f.costUsd = round(f.costUsd + cost);
  f.turns += turns;
  f.tokens = addTokens(f.tokens, tokens);
};

/** One run's figures from its summary.json (may be null: still running) and events.jsonl. */
function analyzeRun(runId, recorded, all = []) {
  const { summary, events } = upgradeRunRecord({ summary: recorded, events: all });
  const agentOf = new Map(); // session id → agent
  const byAgent = {};
  const byStep = {};
  const calls = new Map(); // tool call id → { ts, command, sessionId }
  const results = new Map(); // tool call id → ts
  const tw = { turns: 0, peakContextTokens: 0, cacheReadTokens: 0, costUsd: 0 };
  const fullSuites = [];
  let reviewRounds = 0; let timeouts = 0; let invalidOutputs = 0; let deniedLogged = 0; let deniedResults = 0;
  let mergeConflicts = 0; let toolTimeouts = 0; let started = null;
  for (const e of events) {
    if (e.session_id && e.session?.agent) agentOf.set(e.session_id, e.session.agent);
    if (e.type === 'workflow.started' && !started) started = e.ts;
    if (e.type === 'session.message_received') {
      const agent = agentOf.get(e.session_id) || e.agent || '?';
      const cost = costOf(e);
      const tokens = tokensOf(e.usage);
      addTo(byAgent, agent, cost, tokens);
      addTo(byStep, e.step_id || '?', cost, tokens);
      if (TEST_WRITER.test(agent)) {
        tw.turns += 1;
        tw.cacheReadTokens += tokens.cache_read;
        tw.costUsd = round(tw.costUsd + cost);
        tw.peakContextTokens = Math.max(tw.peakContextTokens, tokens.input + tokens.cache_read + tokens.cache_write);
      }
    } else if (e.type === 'session.attempt_stopped') {
      if (/timed? ?out/i.test(String(e.error || ''))) timeouts += 1;
    } else if (e.type === 'step.finished') {
      const out = e.output || {};
      if (out.verdict != null) reviewRounds += 1;
      if (out.kind === 'suite' && (out.scope || 'full') === 'full') fullSuites.push({ by: 'orchestrator', step: e.step_id, durationMs: Number(out.duration_ms) || null, status: out.status || null, ts: e.ts });
    } else if (e.type === 'step.probe') {
      if (e.state === 'conflict') mergeConflicts += 1;
    } else if (e.type === 'session.stream') {
      const it = e.item || {};
      if (it.kind === 'tool_call' && it.id) calls.set(it.id, { ts: e.ts, command: String(it.input?.command || ''), sessionId: e.session_id });
      if (it.kind === 'tool_result' && it.id) {
        results.set(it.id, e.ts);
        if (it.is_error && REFUSED_TEXT.test(String(it.output || ''))) deniedResults += 1;
      }
    } else if (e.type === 'log') {
      if (e.kind === 'invalid_output') invalidOutputs += 1;
      else if (e.kind === 'permission_denials') deniedLogged += Number(e.denials) || 1;
      else if (e.kind === 'tool_timeout') toolTimeouts += 1;
      else if (e.kind === 'full_suite_by_agent') {
        // the agent's own call of that command, the latest one started by then, and its result
        const call = [...calls.entries()].filter(([, c]) => c.command === e.command && ms(c.ts) <= ms(e.ts) && (!e.agent || agentOf.get(c.sessionId) === e.agent)).at(-1);
        fullSuites.push({ by: e.agent || '?', step: e.step_id, command: e.command, callId: call?.[0] || null, ts: e.ts });
      } else if (/conflict/.test(String(e.kind || '')) || (e.level === 'error' && CONFLICT_TEXT.test(String(e.message || '')))) mergeConflicts += 1;
    } else if (e.type === 'step.failed' && CONFLICT_TEXT.test(String(e.error || e.message || ''))) mergeConflicts += 1;
  }
  // an agent's suite lasts from its tool call to its result (known once the result came)
  for (const s of fullSuites) {
    if (s.by === 'orchestrator') continue;
    const call = calls.get(s.callId);
    const end = results.get(s.callId);
    s.durationMs = call && end ? ms(end) - ms(call.ts) : null;
    delete s.callId;
  }
  // the context the engine recorded per turn (summary.context), when it has the test writer's
  for (const [agent, c] of Object.entries(summary?.context?.agents || {})) {
    if (!TEST_WRITER.test(agent)) continue;
    const peaks = (c.per_turn || []).map((x) => Number(x.peak) || 0);
    if (peaks.length) tw.peakContextTokens = Math.max(...peaks);
    if (Number(c.turns) > tw.turns) tw.turns = Number(c.turns);
  }
  const turnsCost = Object.values(byAgent).reduce((s, f) => s + f.costUsd, 0);
  const turnsTokens = Object.values(byAgent).reduce((s, f) => addTokens(s, f.tokens), tokensOf());
  return {
    runId,
    workflow: summary?.workflow || events.find((e) => e.type === 'workflow.started')?.workflow || null,
    status: summary?.status || 'running',
    mock: !!(summary?.mock ?? events.find((e) => e.type === 'workflow.started')?.mock),
    startedAt: summary?.started_at || started,
    durationMs: summary?.duration_ms ?? null,
    costUsd: round(summary?.cost_usd ?? turnsCost),
    tokens: summary?.tokens ? tokensOf(summary.tokens) : turnsTokens,
    byAgent,
    byStep,
    reviewRounds,
    timeouts,
    invalidOutputs,
    refusedCalls: deniedLogged || deniedResults,
    mergeConflicts,
    toolTimeouts: Math.max(toolTimeouts, Number(summary?.tool_timeouts) || 0),
    testWriter: tw,
    fullSuites,
  };
}

const COUNTS = ['reviewRounds', 'timeouts', 'invalidOutputs', 'refusedCalls', 'mergeConflicts', 'toolTimeouts'];

/** The runs' figures added up: cost, tokens, by agent and step, the counts, the test writer, suites. */
function totalOf(runs) {
  const total = { runs: runs.length, costUsd: 0, tokens: tokensOf(), byAgent: {}, byStep: {}, testWriter: { turns: 0, peakContextTokens: 0, cacheReadTokens: 0, costUsd: 0 }, fullSuites: 0, fullSuitesMs: 0 };
  for (const k of COUNTS) total[k] = 0;
  for (const r of runs) {
    total.costUsd = round(total.costUsd + r.costUsd);
    total.tokens = addTokens(total.tokens, r.tokens);
    for (const [k, f] of Object.entries(r.byAgent)) addTo(total.byAgent, k, f.costUsd, f.tokens, f.turns);
    for (const [k, f] of Object.entries(r.byStep)) addTo(total.byStep, k, f.costUsd, f.tokens, f.turns);
    for (const k of COUNTS) total[k] += r[k];
    total.testWriter.turns += r.testWriter.turns;
    total.testWriter.cacheReadTokens += r.testWriter.cacheReadTokens;
    total.testWriter.costUsd = round(total.testWriter.costUsd + r.testWriter.costUsd);
    total.testWriter.peakContextTokens = Math.max(total.testWriter.peakContextTokens, r.testWriter.peakContextTokens);
    total.fullSuites += r.fullSuites.length;
    total.fullSuitesMs += r.fullSuites.reduce((s, x) => s + (x.durationMs || 0), 0);
  }
  return total;
}

const topByCost = (map, n) => Object.fromEntries(Object.entries(map).sort((a, b) => b[1].costUsd - a[1].costUsd).slice(0, n));

/** A run's figures with only its `top` costliest agents and steps and its suites counted (a short answer for many runs). */
function briefOf(run, top = 3) {
  const { byAgent, byStep, fullSuites, ...rest } = run;
  return {
    ...rest,
    topAgents: topByCost(byAgent, top),
    topSteps: topByCost(byStep, top),
    fullSuites: fullSuites.length,
    fullSuitesMs: fullSuites.reduce((s, x) => s + (x.durationMs || 0), 0),
  };
}

module.exports = {
  analyzeRun,
  briefOf,
  totalOf,
};
