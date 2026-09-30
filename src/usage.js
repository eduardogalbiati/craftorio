// Token and cost usage per provider, and monthly budgets.
//
// Two scopes:
// - orchestrator: the runs' summary.json files (<workspace>/runs/*/summary.json; mock runs
//   are ignored) plus the sessions of the run in progress;
// - machine: everything the CLIs recorded on this machine (src/local-usage.js), including use
//   outside the orchestrator. The orchestrator's part is found by provider session id. Cost is what the CLI reported
// (Claude Code and Grok do), otherwise an estimate from the per-model prices in settings
// (Codex does not report cost). Budgets live in settings.json and are enforced by the
// engine before each agent turn.

const fs = require('fs');
const path = require('path');

const PROVIDERS = [
  { id: 'claude', type: 'claude-code', command: 'claude', name: 'Claude Code', costReported: true, installHint: 'irm https://claude.ai/install.ps1 | iex   (then run `claude` once to log in)' },
  { id: 'codex', type: 'codex-cli', command: 'codex', name: 'Codex CLI', costReported: false, installHint: 'npm install -g @openai/codex   (then `codex login`)' },
  { id: 'grok', type: 'grok-cli', command: 'grok', name: 'Grok Build', costReported: true, installHint: 'install Grok Build from x.ai (then `grok login`)' },
];
const WARN_AT = 0.8;

const TOKEN_KEYS = ['input', 'output', 'cache_read', 'cache_write', 'reasoning'];
const emptyTotals = () => ({ tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, total: 0 }, costUsd: 0, unpricedTokens: 0, turns: 0, runs: 0 });
// reasoning is already counted inside output, so it is not added to the total
const totalTokens = (t = {}) => (t.input || 0) + (t.output || 0) + (t.cache_read || 0) + (t.cache_write || 0);

// Maps a session's provider (the workflow's provider name or type) to one of PROVIDERS.
function providerId(p) {
  const s = String(p || '').toLowerCase();
  const hit = PROVIDERS.find((x) => s === x.id || s === x.type || s.startsWith(x.id));
  return hit ? hit.id : null;
}

/** USD for a session: the reported cost, else an estimate from prices, else null. */
function sessionCost(session, prices = {}) {
  if (session.cost_usd) return session.cost_usd;
  const price = prices[session.model];
  if (!price) return null;
  const t = session.tokens || {};
  return ((t.input || 0) * (price.input || 0) + (t.output || 0) * (price.output || 0) + (t.cache_read || 0) * (price.cache_read ?? price.input ?? 0)) / 1e6;
}

function addSession(tot, session, prices) {
  const t = session.tokens || {};
  for (const k of TOKEN_KEYS) tot.tokens[k] += t[k] || 0;
  const total = totalTokens(t);
  tot.tokens.total += total;
  tot.turns += session.turns || 0;
  const cost = sessionCost(session, prices);
  if (cost == null) tot.unpricedTokens += total;
  else tot.costUsd += cost;
}

function readRuns(runsDir) {
  let dirs = [];
  try { dirs = fs.readdirSync(runsDir); } catch { return []; }
  const runs = [];
  for (const d of dirs) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(runsDir, d, 'summary.json'), 'utf8'));
      if (!s.mock) runs.push(s);
    } catch { /* running, crashed or not a run folder */ }
  }
  return runs;
}

const monthKey = (d) => new Date(d).toISOString().slice(0, 7);
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

const recordAsSession = (r) => ({ provider: r.provider, model: r.model, tokens: r.tokens, cost_usd: r.costUsd, turns: 1 });

/**
 * @param scope       'orchestrator' (default) or 'machine' (needs `local`)
 * @param local       readLocalUsage() result, for the machine scope and countOutside budgets
 * @param runsDir     <workspace>/runs
 * @param settings    workspace settings ({ budgets, prices })
 * @param live        optional summary-like object of a run in progress ({ run_id, workflow, started_at, sessions }),
 *                    or a list of them (concurrent runs)
 * @param installed   { claude: bool, codex: bool, grok: bool }
 * @param now         Date (tests)
 */
function computeUsage({ runsDir, settings = {}, live = null, installed = {}, now = new Date(), scope = 'orchestrator', local = null }) {
  const prices = settings.prices || {};
  const budgets = settings.budgets || {};
  const month = monthKey(now);
  const today = dayKey(now);
  const lives = [].concat(live || []);
  const liveIds = new Set(lives.map((l) => l.run_id));
  const runs = readRuns(runsDir).filter((r) => !liveIds.has(r.run_id));
  for (const l of lives) runs.push({ ...l, status: 'running' });

  const byProvider = Object.fromEntries(PROVIDERS.map((p) => [p.id, { month: emptyTotals(), today: emptyTotals(), models: {} }]));
  const totals = { month: emptyTotals(), today: emptyTotals() };
  const recent = [];
  const orchSessionIds = new Set();

  for (const run of runs) {
    const started = run.started_at || run.startedAt;
    if (!started) continue;
    const inMonth = monthKey(started) === month;
    const inToday = dayKey(started) === today;
    const row = { runId: run.run_id, workflow: run.workflow, startedAt: started, status: run.status, tokens: 0, costUsd: 0, byProvider: {} };
    const seen = { month: new Set(), today: new Set() };
    for (const s of run.sessions || []) {
      const id = providerId(s.provider);
      if (!id) continue; // orchestrator / mock
      if (s.provider_session_id) orchSessionIds.add(s.provider_session_id);
      const cost = sessionCost(s, prices) || 0;
      const tok = totalTokens(s.tokens);
      row.tokens += tok;
      row.costUsd += cost;
      row.byProvider[id] ??= { tokens: 0, costUsd: 0 };
      row.byProvider[id].tokens += tok;
      row.byProvider[id].costUsd += cost;
      const bp = byProvider[id];
      if (inMonth) {
        addSession(bp.month, s, prices);
        addSession(totals.month, s, prices);
        bp.models[s.model] ??= emptyTotals();
        addSession(bp.models[s.model], s, prices);
        if (!seen.month.has(id)) { bp.month.runs++; seen.month.add(id); }
      }
      if (inToday) {
        addSession(bp.today, s, prices);
        addSession(totals.today, s, prices);
        if (!seen.today.has(id)) { bp.today.runs++; seen.today.add(id); }
      }
    }
    if (inMonth) totals.month.runs++;
    if (inToday) totals.today.runs++;
    if (Object.keys(row.byProvider).length) recent.push(row);
  }
  recent.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

  // Machine scope: all local records. Cost = the orchestrator's (reported by the CLI during the
  // run) + the cost of records outside it (reported, or estimated from prices).
  const machine = scope === 'machine' && local ? {} : null;
  if (machine) {
    for (const p of PROVIDERS) machine[p.id] = { month: emptyTotals(), today: emptyTotals(), models: {} };
    for (const r of local.records) {
      const m = machine[r.provider];
      if (!m || !r.ts) continue;
      const inOrch = r.sessionId && orchSessionIds.has(r.sessionId);
      const session = recordAsSession(inOrch ? { ...r, costUsd: 0 } : r); // orchestrator cost is added below
      const buckets = [];
      if (monthKey(r.ts) === month) buckets.push(m.month, (m.models[r.model] ??= emptyTotals()));
      if (dayKey(r.ts) === today) buckets.push(m.today);
      for (const b of buckets) {
        addSession(b, session, prices);
        if (inOrch) b.unpricedTokens -= totalTokens(r.tokens); // priced by the orchestrator's own numbers
      }
    }
    for (const p of PROVIDERS) {
      machine[p.id].month.costUsd += byProvider[p.id].month.costUsd;
      machine[p.id].today.costUsd += byProvider[p.id].today.costUsd;
      machine[p.id].month.runs = byProvider[p.id].month.runs;
      machine[p.id].today.runs = byProvider[p.id].today.runs;
    }
  }

  const providers = PROVIDERS.map((p) => {
    const orch = byProvider[p.id];
    const u = machine ? machine[p.id] : orch;
    const budget = { monthlyUsd: null, monthlyTokens: null, blockOnLimit: true, countOutside: false, ...(budgets[p.id] || {}) };
    const usedPctUsd = budget.monthlyUsd ? u.month.costUsd / budget.monthlyUsd : null;
    const usedPctTokens = budget.monthlyTokens ? u.month.tokens.total / budget.monthlyTokens : null;
    const worst = Math.max(usedPctUsd ?? 0, usedPctTokens ?? 0);
    return {
      id: p.id, name: p.name, installed: installed[p.id] ?? null, installHint: p.installHint, costReported: p.costReported,
      month: u.month, today: u.today, budget, usedPctUsd, usedPctTokens,
      status: worst >= 1 ? 'over' : worst >= WARN_AT ? 'warn' : 'ok',
      models: Object.entries(u.models).map(([model, month]) => ({ model, month })).sort((a, b) => b.month.tokens.total - a.month.tokens.total),
      orchestrator: machine ? orch.month : null, // the orchestrator's part of the machine totals
      localAvailable: local ? !!local.found?.[p.id] : null,
      plan: local?.plans?.[p.id] || null,
    };
  });

  const scopeTotals = machine
    ? Object.fromEntries(['month', 'today'].map((k) => {
      const t = emptyTotals();
      for (const p of PROVIDERS) {
        const x = machine[p.id][k];
        for (const key of Object.keys(t.tokens)) t.tokens[key] += x.tokens[key];
        t.costUsd += x.costUsd; t.unpricedTokens += x.unpricedTokens; t.turns += x.turns;
      }
      t.runs = totals[k].runs;
      return [k, t];
    }))
    : totals;

  return {
    scope: machine ? 'machine' : 'orchestrator', month, totals: scopeTotals, providers, prices,
    runs: recent.slice(0, 30), live: lives.length > 0, sources: local?.sources || null,
  };
}

/**
 * Budget state the engine checks before each turn: what each provider already used this
 * month in finished runs (the run itself adds its own sessions on top).
 */
function budgetBaseline({ runsDir, settings = {}, now = new Date(), local = null }) {
  const orch = computeUsage({ runsDir, settings, now });
  const all = local ? computeUsage({ runsDir, settings, now, scope: 'machine', local }) : null;
  return Object.fromEntries(orch.providers.map((o, i) => {
    const p = o.budget.countOutside && all ? all.providers[i] : o;
    return [p.id, {
    name: p.name,
    limitUsd: p.budget.monthlyUsd,
    limitTokens: p.budget.monthlyTokens,
    blockOnLimit: p.budget.blockOnLimit !== false,
    usedUsd: p.month.costUsd,
    usedTokens: p.month.tokens.total,
    countOutside: !!(o.budget.countOutside && all),
  }];
  }));
}

/**
 * The budget state with the usage of other runs in progress added (their sessions are not on disk
 * yet): what a new run's preflight checks against.
 * @param sessions [{ provider, model, tokens, costUsd }]
 */
function withPeerUsage(budget, sessions, prices = {}) {
  const out = Object.fromEntries(Object.entries(budget || {}).map(([id, b]) => [id, { ...b }]));
  for (const s of sessions || []) {
    const b = out[providerId(s.provider)];
    if (!b) continue;
    b.usedUsd = (b.usedUsd || 0) + (sessionCost({ cost_usd: s.costUsd, model: s.model, tokens: s.tokens }, prices) || 0);
    b.usedTokens = (b.usedTokens || 0) + totalTokens(s.tokens);
  }
  return out;
}

/**
 * Checks, before a real run, that every CLI the workflow's agents use is installed and that
 * no provider is already over a blocking budget. Returns a list of human-readable problems.
 */
function preflight(wf, budget, resolveCommand, inputs = {}) {
  const problems = [];
  // folder inputs (repo_path, project_path…): agents working in a missing or empty folder
  // produce confident documents about nothing, so refuse early
  for (const [key, value] of Object.entries(inputs || {})) {
    if (!/path|dir/i.test(key) || !value || !(wf.inputs || {})[key]) continue;
    let entries = null;
    try { entries = fs.readdirSync(value); } catch { /* missing */ }
    if (!entries) problems.push(`The folder for "${key}" does not exist: ${value}`);
    else if (!entries.length) problems.push(`The folder for "${key}" is empty: ${value}. Point the project to the folder that has the code or documents.`);
  }
  const used = [...new Set(Object.values(wf.agents || {}).map((a) => a.provider))];
  for (const name of used) {
    const cfg = wf.providers?.[name];
    if (!cfg) { problems.push(`Provider "${name}" is not defined in the workflow.`); continue; }
    const meta = PROVIDERS.find((p) => p.type === cfg.type || p.id === name);
    if (!resolveCommand(cfg.command)) {
      problems.push(`${meta?.name || name} is not installed (command "${cfg.command}" not found). Install: ${meta?.installHint || 'see README'}`);
    }
    const b = meta && budget?.[meta.id];
    if (b?.blockOnLimit && ((b.limitUsd && b.usedUsd >= b.limitUsd) || (b.limitTokens && b.usedTokens >= b.limitTokens))) {
      problems.push(`${meta.name} already reached its monthly budget. Raise it in Usage to run this workflow.`);
    }
  }
  return problems;
}

module.exports = {
  budgetBaseline,
  computeUsage,
  preflight,
  providerId,
  PROVIDERS,
  readRuns,
  sessionCost,
  totalTokens,
  WARN_AT,
  withPeerUsage,
};
