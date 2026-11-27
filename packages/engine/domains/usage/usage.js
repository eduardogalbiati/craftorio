// Token and cost usage per provider, and monthly budgets.
//
// Two scopes:
// - orchestrator: the runs' summary.json files (<workspace>/runs/*/summary.json, through the run
//   index when it is open: packages/engine/domains/workspace/store.js; mock runs
//   are ignored) plus the sessions of the run in progress;
// - machine: everything the CLIs recorded on this machine (packages/engine/domains/local/local-usage.js), including use
//   outside the orchestrator. The orchestrator's part is found by provider session id. A session's cost is
// packages/shared/session-cost.js's, the one rule of every screen (#72); a total that includes an unknown
// cost has `costApprox`. Budgets live in settings.json and are enforced by the engine before each agent turn.

const fs = require('fs');
const path = require('path');
const { cachedModels } = require('../cli/cli-sessions');
const { installCommand } = require('../machine/install-commands');
const { readRunSummary } = require('../run/run-record');
const { runSummaries } = require('../run/runs');
const registry = require('@craftorio/shared/providers');
const I18n = require('@craftorio/shared/i18n');
const OrchestratorModels = require('@craftorio/shared/orchestrator-models');
const {
  isApprox,
  priceOf,
  runCost,
  sessionCost,
  tokensCost,
  totalTokens,
} = require('@craftorio/shared/session-cost');
const TimeZone = require('../analytics/time-zone');

// The CLIs, from their adapters (packages/shared/providers/). installCommand: what the Usage screen's play
// button runs (#147); installNote: what to do after it
const PROVIDERS = registry.clis().map((a) => {
  const install = installCommand(a.id);
  return {
    id: a.id, type: a.type, command: a.cli, name: a.label, costReported: a.costReported,
    installCommand: install, installNote: a.installNote, installHint: a.installHint || `${install}   (${a.installNote})`,
  };
});
const WARN_AT = 0.8;

const TOKEN_KEYS = ['input', 'output', 'cache_read', 'cache_write', 'reasoning'];
const emptyTotals = () => ({ tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, total: 0 }, costUsd: 0, unpricedTokens: 0, turns: 0, runs: 0 });

// Maps a session's provider (the workflow's provider name or type) to one of PROVIDERS.
function providerId(p) {
  const s = String(p || '').toLowerCase();
  const hit = PROVIDERS.find((x) => s === x.id || s === x.type || s.startsWith(x.id));
  return hit ? hit.id : null;
}

function addTokens(tot, session) {
  const t = session.tokens || {};
  for (const k of TOKEN_KEYS) tot.tokens[k] += t[k] || 0;
  tot.tokens.total += totalTokens(t);
  tot.turns += session.turns || 0;
}

function addSession(tot, session, prices) {
  addTokens(tot, session);
  const cost = sessionCost(session, prices);
  if (cost == null) tot.unpricedTokens += totalTokens(session.tokens);
  else tot.costUsd += cost;
  if (isApprox(session, prices)) tot.costApprox = true;
}

// #72: adds a total's cost to another's, with its mark
function addCost(tot, from) {
  tot.costUsd += from.costUsd;
  if (from.costApprox) tot.costApprox = true;
}

// From the run index when the service has it open (packages/engine/domains/workspace/store.js), else the summary.json files; in
// the current shape both ways (#350, packages/engine/domains/run/run-record.js).
function readRuns(runsDir) {
  const indexed = runSummaries(runsDir, { mock: false });
  if (indexed) return indexed;
  let dirs = [];
  try { dirs = fs.readdirSync(runsDir); } catch { return []; }
  // null: running, crashed or not a run folder
  return dirs.map((d) => readRunSummary(path.join(runsDir, d))).filter((s) => s && !s.mock);
}

// the owner's local month and day (settings.timeZone, #273; UTC when no zone is given)
const monthKey = (d, tz = 'UTC') => TimeZone.monthKey(d, tz);
const dayKey = (d, tz = 'UTC') => TimeZone.dayKey(d, tz);

const recordAsSession = (r) => ({ provider: r.provider, model: r.model, tokens: r.tokens, cost_usd: r.costUsd, turns: 1 });

/**
 * @param scope       'orchestrator' (default) or 'machine' (needs `local`)
 * @param local       readLocalUsage() result, for the machine scope and countOutside budgets
 * @param runsDir     <workspace>/runs
 * @param settings    workspace settings ({ budgets, prices, timeZone })
 * @param live        optional summary-like object of a run in progress ({ run_id, workflow, started_at, sessions }),
 *                    or a list of them (concurrent runs)
 * @param installed   { claude: bool, codex: bool, grok: bool }
 * @param now         Date (tests)
 * @param extraRuns   summary-like spend that is in no run folder, e.g. the Oracle's days (packages/engine/domains/oracle/oracle.js usageRuns)
 */
function computeUsage({ runsDir, settings = {}, live = null, installed = {}, now = new Date(), scope = 'orchestrator', local = null, extraRuns = [] }) {
  const prices = settings.prices || {};
  const budgets = settings.budgets || {};
  const tz = settings.timeZone || 'UTC';
  const month = monthKey(now, tz);
  const today = dayKey(now, tz);
  const lives = [].concat(live || []);
  const liveIds = new Set(lives.map((l) => l.run_id));
  const runs = readRuns(runsDir).filter((r) => !liveIds.has(r.run_id));
  for (const l of lives) runs.push({ ...l, status: 'running' });
  runs.push(...(extraRuns || []));

  const byProvider = Object.fromEntries(PROVIDERS.map((p) => [p.id, { month: emptyTotals(), today: emptyTotals(), models: {} }]));
  const totals = { month: emptyTotals(), today: emptyTotals() };
  const recent = [];
  const orchSessionIds = new Set();

  for (const run of runs) {
    const started = run.started_at || run.startedAt;
    if (!started) continue;
    const inMonth = monthKey(started, tz) === month;
    const inToday = dayKey(started, tz) === today;
    const row = { runId: run.run_id, workflow: run.workflow, startedAt: started, status: run.status, tokens: 0, costUsd: 0, costApprox: false, byProvider: {} };
    const seen = { month: new Set(), today: new Set() };
    for (const s of run.sessions || []) {
      const id = providerId(s.provider);
      if (!id) continue; // orchestrator / mock
      if (s.provider_session_id) orchSessionIds.add(s.provider_session_id);
      const { usd, approx } = runCost([s], prices);
      const tok = totalTokens(s.tokens);
      row.byProvider[id] ??= { tokens: 0, costUsd: 0 };
      for (const sum of [row, row.byProvider[id]]) {
        sum.tokens += tok;
        addCost(sum, { costUsd: usd, costApprox: approx });
      }
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
      const session = recordAsSession(r);
      const buckets = [];
      if (monthKey(r.ts, tz) === month) buckets.push(m.month, (m.models[r.model] ??= emptyTotals()));
      if (dayKey(r.ts, tz) === today) buckets.push(m.today);
      for (const b of buckets) {
        if (inOrch) addTokens(b, session); // its cost is the orchestrator's own, added below
        else addSession(b, session, prices);
      }
    }
    for (const p of PROVIDERS) {
      addCost(machine[p.id].month, byProvider[p.id].month);
      addCost(machine[p.id].today, byProvider[p.id].today);
      for (const [model, month] of Object.entries(byProvider[p.id].models)) addCost(machine[p.id].models[model] ??= emptyTotals(), month);
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
      id: p.id, name: p.name, installed: installed[p.id] ?? null, installHint: p.installHint, installCommand: p.installCommand, installNote: p.installNote, costReported: p.costReported,
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
        addCost(t, x);
        t.unpricedTokens += x.unpricedTokens; t.turns += x.turns;
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
function budgetBaseline({ runsDir, settings = {}, now = new Date(), local = null, extraRuns = [] }) {
  const orch = computeUsage({ runsDir, settings, now, extraRuns });
  const all = local ? computeUsage({ runsDir, settings, now, scope: 'machine', local, extraRuns }) : null;
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
 * @param sessions [{ provider, model, tokens, costUsd, cliOnlyUsd }] (cliOnlyUsd: the CLI's figure of
 *   turns with no known price, #369, counted like the run's own)
 */
function withPeerUsage(budget, sessions, prices = {}) {
  const out = Object.fromEntries(Object.entries(budget || {}).map(([id, b]) => [id, { ...b }]));
  for (const s of sessions || []) {
    const b = out[providerId(s.provider)];
    if (!b) continue;
    b.usedUsd = (b.usedUsd || 0) + (sessionCost({ cost_usd: s.costUsd + (s.cliOnlyUsd || 0), model: s.model, tokens: s.tokens }, prices) || 0);
    b.usedTokens = (b.usedTokens || 0) + totalTokens(s.tokens);
  }
  return out;
}

/**
 * Checks, before a real run, that every CLI the workflow's agents use is installed and that
 * no provider is already over a blocking budget. Returns a list of human-readable problems.
 * #97: also that every agent's model is offered to the account, for a CLI that caches its model
 * list (Codex: ~/.codex/models_cache.json; no cache: nothing is known, nothing reported).
 * @param {{ home?: string }} [opts] the home folder of the CLIs' config (tests)
 */
function preflight(wf, budget, resolveCommand, inputs = {}, { home } = {}) {
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
  problems.push(...unavailableModels(wf, home));
  return problems;
}

// #97: the agents' models a CLI's cached model list does not offer (a mapped Codex model the account lacks);
// #111: a Codex model with an offered fallback is not one (the run swaps it, orchestrator-choice.js
// applyCodexFallback); the problem reads in the interface language
function unavailableModels(wf, home) {
  const offered = new Map();
  const missing = new Map();
  for (const agent of Object.values(wf.agents || {})) {
    const cfg = agent && wf.providers?.[agent.provider];
    const meta = cfg && PROVIDERS.find((p) => p.type === cfg.type || p.id === agent.provider);
    const model = typeof agent?.model === 'string' ? agent.model.trim() : '';
    if (!meta || !model || model.includes('{{')) continue;
    if (!offered.has(meta.id)) offered.set(meta.id, new Set(cachedModels(meta.id, home).map((m) => m.id)));
    const list = offered.get(meta.id);
    if (!list.size || list.has(model)) continue;
    if (meta.id === OrchestratorModels.CODEX && OrchestratorModels.codexFallback(model, [...list])) continue; // #111
    missing.set(model, meta);
  }
  return [...missing].map(([model, meta]) => I18n.t('usage.model_not_offered', { name: meta.name, model }));
}

module.exports = {
  budgetBaseline,
  computeUsage,
  preflight,
  priceOf,
  providerId,
  PROVIDERS,
  readRuns,
  sessionCost,
  tokensCost,
  totalTokens,
  WARN_AT,
  withPeerUsage,
};
