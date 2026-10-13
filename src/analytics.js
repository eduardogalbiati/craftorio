// Analytics screen: tokens and session metrics over a date range (default: the last 30 days).
//
// It complements Usage (budgets, prices, the month in progress) and uses the same two scopes:
// - orchestrator: the runs' sessions (summary.json), enriched with the metrics the CLIs recorded
//   for the same provider session (tool calls, prompts, files...) when their transcripts exist;
// - machine: every session the CLIs recorded on this machine (src/local-usage.js).
// Days are the owner's local days (settings.timeZone, #273; UTC when no zone is given), like Usage.
// A session's metrics are those of the whole session, even when it only partly falls in the range;
// its tokens and cost are only those in the range.

const TimeZone = require('./time-zone');
const {
  providerId,
  PROVIDERS,
  readRuns,
  sessionCost,
  totalTokens,
} = require('./usage');
const { TOOL_KINDS } = require('./local-usage');

const DAY = 864e5;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;
const MAX_SESSIONS = 300;

// calendar math on day keys ('YYYY-MM-DD' parses as UTC midnight); an instant's day goes through TimeZone
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && Number.isFinite(Date.parse(s));

/** { from, to, days[] } for the asked range: default the last 30 days up to the local today, capped at a year. */
function dateRange({ from, to, now = new Date(), timeZone = 'UTC' } = {}) {
  let end = isDay(to) ? to : TimeZone.dayKey(now, timeZone);
  let start = isDay(from) ? from : dayKey(Date.parse(end) - (DEFAULT_DAYS - 1) * DAY);
  if (start > end) [start, end] = [end, start];
  if ((Date.parse(end) - Date.parse(start)) / DAY >= MAX_DAYS) start = dayKey(Date.parse(end) - (MAX_DAYS - 1) * DAY);
  const days = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += DAY) days.push(dayKey(t));
  return { from: start, to: end, days };
}

const emptyTokens = () => ({ input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, total: 0 });
function addTokens(acc, t = {}) {
  for (const k of ['input', 'output', 'cache_read', 'cache_write', 'reasoning']) acc[k] += t[k] || 0;
  acc.total += totalTokens(t);
}
// Share of the prompt read from cache: cache_read / (input + cache_read + cache_write).
function cacheHitRate(t) {
  const prompt = (t.input || 0) + (t.cache_read || 0) + (t.cache_write || 0);
  return prompt ? (t.cache_read || 0) / prompt : null;
}

// 0-100: the mean of turns, tool calls, files touched, tokens and active minutes, each on a log
// scale up to a cap (a session at every cap scores 100). Missing metrics are left out of the mean.
const COMPLEXITY_CAPS = { turns: 200, toolCalls: 300, files: 50, tokens: 2e7, activeMinutes: 240 };
function complexityScore(x) {
  const parts = Object.entries(COMPLEXITY_CAPS)
    .filter(([k]) => x[k] != null)
    .map(([k, cap]) => Math.min(1, Math.log10(1 + Math.max(0, x[k])) / Math.log10(1 + cap)));
  return parts.length ? Math.round((100 * parts.reduce((a, b) => a + b, 0)) / parts.length) : null;
}
const complexityLevel = (score) => (score == null ? null : score >= 67 ? 'high' : score >= 34 ? 'medium' : 'low');

// A cheap guess of what a session was for, from its first prompt and its tool mix. The supervisor's
// report (analyzeSessions) classifies with more judgement.
// A run session with no transcript is classified by its agent's name (developer, reviewer...).
function sessionIntent(prompt, tools, agent) {
  const p = String(prompt || '').toLowerCase();
  const edits = tools?.edit || 0;
  if (!p && agent) {
    const a = String(agent).toLowerCase();
    if (/review|audit/.test(a)) return 'review';
    if (/debug|fix|diagnos/.test(a)) return 'debugging';
    if (/doc|writer|editor/.test(a)) return 'docs';
    if (/research|analy|explor|plan/.test(a)) return 'research';
    if (/develop|implement|coder|engineer|test|build/.test(a)) return 'coding';
  }
  if (/\breview\b|\baudit\b|pull request|\bpr\b/.test(p)) return 'review';
  if (/\bbug\b|\bfix|\berror\b|\bfail|crash|exception|broken|not working|stack trace/.test(p)) return 'debugging';
  if (/\breadme\b|\bdocs?\b|documentation|write-?up|changelog/.test(p)) return 'docs';
  if (edits > 0) return 'coding';
  if (/research|investigate|compare|explain|how does|what is|why\b|\?$/.test(p) || (tools && (tools.read || 0) + (tools.web || 0) > 0)) return 'research';
  return 'other';
}

/**
 * @param runsDir    <workspace>/runs
 * @param local      readLocalUsage() result (needed by the machine scope; enriches the orchestrator one)
 * @param settings   workspace settings ({ prices, timeZone })
 * @param projects   [{ id, name }]
 * @param projectOf  (cwd) => { id, name } | null: the project a folder belongs to
 * @param scope      'orchestrator' (default) or 'machine'
 * @param from, to   'YYYY-MM-DD' (inclusive, local days); default the last 30 days
 */
function computeAnalytics({ runsDir, local = null, settings = {}, projects = [], projectOf = () => null, scope = 'orchestrator', from, to, now = new Date() }) {
  const prices = settings.prices || {};
  const timeZone = settings.timeZone || 'UTC';
  const localDay = (ts) => TimeZone.dayKey(ts, timeZone);
  const range = dateRange({ from, to, now, timeZone });
  const inRange = (ts) => !!ts && Number.isFinite(Date.parse(ts)) && localDay(ts) >= range.from && localDay(ts) <= range.to;
  const machine = scope === 'machine' && !!local;
  const localSessions = local?.sessions || new Map();
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  const totals = { tokens: emptyTokens(), costUsd: 0, unpricedTokens: 0 };
  const byDay = new Map(range.days.map((d) => [d, { day: d, tokens: 0, costUsd: 0, byProvider: {} }]));
  const byProject = new Map();
  const byProvider = new Map(PROVIDERS.map((p) => [p.id, { id: p.id, name: p.name, tokens: 0, costUsd: 0, sessions: 0 }]));
  const byModel = new Map();
  const sessions = new Map(); // "<provider>:<id>" -> row

  // One slice of usage: a run session (orchestrator) or a CLI record (machine). cost: null = unpriced.
  function add({ provider, model, day, project, tokens, cost, key, row }) {
    const tok = totalTokens(tokens);
    addTokens(totals.tokens, tokens);
    if (cost == null) totals.unpricedTokens += tok;
    else totals.costUsd += cost;
    const d = byDay.get(day);
    if (d) { d.tokens += tok; d.costUsd += cost || 0; d.byProvider[provider] = (d.byProvider[provider] || 0) + tok; }
    const pk = project?.id || project?.name || '';
    const pr = byProject.get(pk) || byProject.set(pk, { id: project?.id || null, name: project?.name || '(no project)', tokens: 0, costUsd: 0, sessions: new Set() }).get(pk);
    pr.tokens += tok; pr.costUsd += cost || 0; pr.sessions.add(key);
    const bp = byProvider.get(provider);
    if (bp) { bp.tokens += tok; bp.costUsd += cost || 0; }
    const mk = `${provider}:${model || '?'}`;
    const bm = byModel.get(mk) || byModel.set(mk, { model: model || '(unknown)', provider, tokens: 0, costUsd: 0 }).get(mk);
    bm.tokens += tok; bm.costUsd += cost || 0;
    const s = sessions.get(key) || sessions.set(key, { ...row, tokens: emptyTokens(), costUsd: 0, unpricedTokens: 0 }).get(key);
    addTokens(s.tokens, tokens);
    if (cost == null) s.unpricedTokens += tok;
    else s.costUsd += cost;
  }

  // in the current shape (#350): every summary lists its sessions, with each turn's own cost
  const runs = readRuns(runsDir);
  const outcomes = { total: 0, byStatus: {}, durationMs: 0, waitingMs: 0, supervisorTurns: 0 };
  const orchIds = new Map(); // provider session id -> { runId, agent, step }
  const orchCost = new Map(); // provider session id -> { cost, tokens }: the CLI's records carry no cost for Claude Code
  for (const run of runs) {
    const started = run.started_at || run.startedAt;
    for (const s of run.sessions) {
      if (!s.provider_session_id) continue;
      orchIds.set(s.provider_session_id, { runId: run.run_id, workflow: run.workflow, agent: s.agent, step: s.step_id });
      const c = orchCost.get(s.provider_session_id) || orchCost.set(s.provider_session_id, { cost: 0, tokens: 0, priced: true }).get(s.provider_session_id);
      const cost = sessionCost(s, prices);
      if (cost == null) c.priced = false;
      c.cost += cost || 0;
      c.tokens += totalTokens(s.tokens);
    }
    if (!inRange(started)) continue;
    outcomes.total++;
    outcomes.byStatus[run.status || 'unknown'] = (outcomes.byStatus[run.status || 'unknown'] || 0) + 1;
    outcomes.durationMs += run.duration_ms || 0;
    outcomes.waitingMs += run.timing?.waiting_ms || 0;
    const project = run.project_id ? { id: run.project_id, name: projectName.get(run.project_id) || run.project_id } : null;
    for (const s of run.sessions) {
      const id = providerId(s.provider);
      if (!id) continue; // orchestrator / mock
      if (s.agent === 'supervisor' || s.step_id === 'supervisor') outcomes.supervisorTurns += s.turns || 0;
      if (machine) continue; // the machine scope counts the CLIs' own records
      const day = localDay(s.opened_at || started);
      const key = `${id}:${s.provider_session_id || `${run.run_id}/${s.id}`}`;
      const m = s.provider_session_id ? localSessions.get(`${id}:${s.provider_session_id}`) : null;
      add({
        provider: id, model: s.model, day, project, tokens: s.tokens || {}, cost: sessionCost(s, prices), key,
        row: sessionRow({ provider: id, id: s.provider_session_id || s.id, model: s.model, project, m, own: s, run: { runId: run.run_id, workflow: run.workflow, agent: s.agent, step: s.step_id } }),
      });
    }
  }

  if (machine) {
    for (const r of local.records) {
      if (!inRange(r.ts) || !byProvider.has(r.provider)) continue;
      const m = localSessions.get(`${r.provider}:${r.sessionId}`);
      const project = projectOf(m?.cwd) || (m?.cwd ? { id: null, name: folderName(m.cwd) } : null);
      const key = `${r.provider}:${r.sessionId || '?'}`;
      // a run session's record without its own cost: its share (by tokens) of the run's cost, like Usage
      const orch = r.costUsd == null && r.sessionId ? orchCost.get(r.sessionId) : null;
      const cost = orch?.priced && orch.tokens ? (orch.cost * totalTokens(r.tokens)) / orch.tokens
        : sessionCost({ cost_usd: r.costUsd, model: r.model, tokens: r.tokens }, prices);
      add({
        provider: r.provider, model: r.model, day: localDay(r.ts), project, tokens: r.tokens, cost, key,
        row: sessionRow({ provider: r.provider, id: r.sessionId, model: r.model, project, m, run: orchIds.get(r.sessionId) || null }),
      });
    }
  }

  const rows = [...sessions.values()].map((s) => {
    const complexity = complexityScore({ turns: s.assistantTurns, toolCalls: s.toolCallsTotal, files: s.filesTouched, tokens: s.tokens.total, activeMinutes: s.activeMs != null ? s.activeMs / 60e3 : null });
    return { ...s, cacheHitRate: cacheHitRate(s.tokens), complexity, complexityLevel: complexityLevel(complexity) };
  });
  for (const s of rows) { const bp = byProvider.get(s.provider); if (bp) bp.sessions++; }
  const desc = (a, b) => b.tokens - a.tokens;
  return {
    scope: machine ? 'machine' : 'orchestrator', from: range.from, to: range.to,
    totals: { ...totals, sessions: rows.length, cacheHitRate: cacheHitRate(totals.tokens) },
    byDay: [...byDay.values()],
    byProject: [...byProject.values()].map((p) => ({ ...p, sessions: p.sessions.size })).sort(desc),
    byProvider: [...byProvider.values()],
    byModel: [...byModel.values()].sort(desc),
    metrics: summarizeMetrics(rows),
    runs: outcomes,
    sessions: rows.sort((a, b) => b.tokens.total - a.tokens.total).slice(0, MAX_SESSIONS),
    sessionsTruncated: rows.length > MAX_SESSIONS,
    localAvailable: local ? local.found || null : null,
  };
}

const folderName = (cwd) => String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(cwd);

// A session's row: the CLI's metrics (m) when its transcript exists; a run session's own numbers
// (own: duration, active time, turns) otherwise, or on top for what the CLI does not record.
function sessionRow({ provider, id, model, project, m, own = null, run = null }) {
  const tools = m?.toolCalls || null;
  const toolCallsTotal = tools ? Object.values(tools).reduce((a, b) => a + b, 0) : null;
  return {
    provider, id, model: model || m?.model || null, project: project?.name || null, projectId: project?.id || null,
    title: m?.firstPrompt || null, cwd: m?.cwd || own?.cwd || null, headless: !!m?.headless || !!run,
    start: m?.firstTs || own?.opened_at || null, end: m?.lastTs || own?.closed_at || null,
    durationMs: m ? m.durationMs : own?.duration_ms ?? null, activeMs: m ? m.activeMs : own?.active_ms ?? null,
    userPrompts: m ? m.userPrompts : null, assistantTurns: m ? m.assistantTurns : own?.turns ?? null,
    toolCalls: tools, toolCallsTotal,
    failedToolCalls: m?.failedToolCalls ?? null, permissionDenials: m?.permissionDenials ?? null, interrupts: m?.interrupts ?? null,
    compactions: m?.compactions ?? null, peakContext: m?.peakContext || null,
    filesTouched: m?.files ? m.files.length : null, linesAdded: m?.linesAdded ?? null, linesRemoved: m?.linesRemoved ?? null,
    intent: sessionIntent(m?.firstPrompt, tools, run?.agent), run, outcome: own?.status || null,
  };
}

// Totals and averages of the sessions' metrics (null metrics are left out; null = no session records it).
function summarizeMetrics(rows) {
  const known = (k) => rows.filter((s) => s[k] != null).length;
  const sum = (k) => (known(k) ? rows.reduce((a, s) => a + (s[k] || 0), 0) : null);
  const avg = (k) => (known(k) ? sum(k) / known(k) : null);
  const toolMix = Object.fromEntries(TOOL_KINDS.map((k) => [k, 0]));
  const intents = {};
  const complexity = { low: 0, medium: 0, high: 0 };
  for (const s of rows) {
    for (const [k, v] of Object.entries(s.toolCalls || {})) toolMix[k] = (toolMix[k] || 0) + v;
    intents[s.intent] = (intents[s.intent] || 0) + 1;
    if (s.complexityLevel) complexity[s.complexityLevel]++;
  }
  return {
    durationMs: sum('durationMs'), activeMs: sum('activeMs'), avgDurationMs: avg('durationMs'), avgActiveMs: avg('activeMs'),
    userPrompts: sum('userPrompts'), assistantTurns: sum('assistantTurns'), toolCalls: sum('toolCallsTotal'), toolMix,
    failedToolCalls: sum('failedToolCalls'), permissionDenials: sum('permissionDenials'), interrupts: sum('interrupts'),
    compactions: sum('compactions'), peakContext: rows.reduce((a, s) => Math.max(a, s.peakContext || 0), 0) || null,
    filesTouched: sum('filesTouched'), linesAdded: sum('linesAdded'), linesRemoved: sum('linesRemoved'),
    avgComplexity: avg('complexity'), complexity, intents,
  };
}

// Plain-text digest of an analytics result for the supervisor's report (analyzeSessions).
function analyticsReport(a, { maxSessions = 80 } = {}) {
  const n = (x) => (x == null ? '-' : Math.round(x).toLocaleString('en-US'));
  const min = (ms) => (ms == null ? '-' : `${Math.round(ms / 60e3)} min`);
  const usd = (x) => `$${(x || 0).toFixed(2)}`;
  const m = a.metrics;
  return [
    `# Sessions from ${a.from} to ${a.to} (${a.scope === 'machine' ? 'every CLI session on this machine' : 'orchestrator runs'})`,
    `Total: ${n(a.totals.tokens.total)} tokens, ${usd(a.totals.costUsd)}${a.totals.unpricedTokens ? ` (+${n(a.totals.unpricedTokens)} unpriced tokens)` : ''}, ${a.totals.sessions} sessions, cache hit rate ${a.totals.cacheHitRate == null ? '-' : `${Math.round(a.totals.cacheHitRate * 100)}%`}.`,
    `\n## By provider\n${a.byProvider.filter((p) => p.tokens).map((p) => `- ${p.name}: ${n(p.tokens)} tokens, ${usd(p.costUsd)}, ${p.sessions} sessions`).join('\n') || '- none'}`,
    `\n## By model\n${a.byModel.slice(0, 15).map((x) => `- ${x.model} (${x.provider}): ${n(x.tokens)} tokens`).join('\n') || '- none'}`,
    `\n## By project\n${a.byProject.slice(0, 20).map((p) => `- ${p.name}: ${n(p.tokens)} tokens, ${p.sessions} sessions`).join('\n') || '- none'}`,
    `\n## Metrics\n- time: ${min(m.durationMs)} wall-clock, ${min(m.activeMs)} active\n- prompts ${n(m.userPrompts)}, assistant turns ${n(m.assistantTurns)}, tool calls ${n(m.toolCalls)} (${Object.entries(m.toolMix).map(([k, v]) => `${k} ${v}`).join(', ')})\n- failed tool calls ${n(m.failedToolCalls)}, permission denials ${n(m.permissionDenials)}, interrupts ${n(m.interrupts)}, compactions ${n(m.compactions)}\n- files touched ${n(m.filesTouched)}, lines +${n(m.linesAdded)} -${n(m.linesRemoved)}\n- heuristic intents: ${Object.entries(m.intents).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`,
    a.runs.total ? `\n## Orchestrator runs\n- ${a.runs.total} runs: ${Object.entries(a.runs.byStatus).map(([k, v]) => `${k} ${v}`).join(', ')}\n- run time ${min(a.runs.durationMs)}, waiting (human gates, waits) ${min(a.runs.waitingMs)}, supervisor turns ${a.runs.supervisorTurns}` : '',
    `\n## Sessions (largest first, ${Math.min(maxSessions, a.sessions.length)} of ${a.totals.sessions})`,
    a.sessions.slice(0, maxSessions).map((s) => `- ${s.provider} ${s.model || ''} | ${s.project || s.cwd || '?'} | ${s.start ? s.start.slice(0, 16) : '?'} | ${n(s.tokens.total)} tok | active ${min(s.activeMs)} | prompts ${n(s.userPrompts)} | tools ${n(s.toolCallsTotal)} | files ${n(s.filesTouched)} | complexity ${s.complexity ?? '-'} | ${s.run ? `run ${s.run.runId} agent ${s.run.agent}` : 'interactive'} | ${s.title ? `"${s.title.slice(0, 160)}"` : ''}`).join('\n'),
  ].filter(Boolean).join('\n');
}

module.exports = {
  analyticsReport,
  cacheHitRate,
  complexityLevel,
  complexityScore,
  computeAnalytics,
  dateRange,
  sessionIntent,
};
