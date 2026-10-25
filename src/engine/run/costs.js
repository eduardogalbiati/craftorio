// @ts-check
// Costs, limits and budgets (#250, from src/engine/workflow.js): the run's `max_total_duration` and
// `max_total_cost_usd` checked before every step (`checkLimits`, children included; the duration
// counts the work, the time waiting for the owner at gates excluded: `gateClockMs`, #416), the limits per
// model (`modelLimits`, #262), the monthly budget per provider over this run and its peers
// (`checkBudget`), the `max_total_context` pause gate (`contextGate`), the supervisor's and the
// children's spend, the price of a turn on a model Claude Code does not know (`priceUnrecognizedTurn`,
// #369), and the step timing and context metrics of the summary (`timingSummary`,
// `contextSummary`). `childRunCost`: what a child run cost from its summary (#175).

'use strict';

const {
  priceOf,
  providerId,
  sessionCost,
  tokensCost,
  totalTokens,
  WARN_AT,
} = require('../../usage');
const nightLimits = require('../../domains/night/night-limits');
const sessionCache = require('../../domains/session/session-cache');
const { render } = require('./templates');
const { parseDuration, parseTokens } = require('./load');

// Context an agent read in its turns: everything sent to the model, cached or not.
const contextTokens = (t) => (t ? (t.input || 0) + (t.cache_read || 0) + (t.cache_write || 0) : 0);

const kTokens = (n) => (n == null ? '?' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

// What a child run cost from its summary (#175): its own sessions and its own child runs.
const childRunCost = (summary) => +((+summary?.cost_usd || 0) + (+summary?.children_cost_usd || 0)).toFixed(6);

const methods = {
  checkLimits() {
    const lim = this.wf.orchestrator?.limits || {};
    const day = this.dayLimits();
    const maxDur = this.effectiveLimits().duration;
    // #416: the limit measures the work, not the time waiting for the owner at gates
    const gateWaitMs = this.gateClockMs();
    const worked = Date.now() - this.startedAt - gateWaitMs;
    if (maxDur && worked > maxDur) {
      const hours = (ms) => `${+(ms / 3600e3).toFixed(1)}h`;
      const value = maxDur === day.duration ? lim.max_total_duration : hours(maxDur);
      this.emitEvent('limit.exceeded', { limit: 'max_total_duration', value, worked_ms: worked, gate_wait_ms: gateWaitMs });
      throw new Error(`Maximum duration exceeded (worked ${hours(worked)} of ${value}).`);
    }
    // its child runs' cost counts too (#175)
    const children = this.childrenCostUsd();
    // #369: the CLI's figure of the turns the app has no price for counts too, so a limit is never skipped
    const cost = [...this.sessions.values()].reduce((a, s) => a + s.costUsd + (s.cliOnlyUsd || 0), 0) + children;
    const maxCost = this.maxTotalCost();
    if (maxCost && cost > maxCost) {
      this.emitEvent('limit.exceeded', { limit: 'max_total_cost_usd', value: maxCost, current: cost, ...(children ? { children } : {}) });
      throw new Error(`Maximum cost exceeded (US$ ${maxCost}${children ? `, of which US$ ${children.toFixed(2)} by its child runs` : ''}).`);
    }
  },

  // #262: the limits of a model (the workflow's `models`, else Settings'), {} for none
  modelLimits(model) {
    return (model && this.models && Object.hasOwn(this.models, model) && this.models[model]) || {};
  },

  // The day cost limit: orchestrator.limits.max_total_cost_usd, lifted to the largest
  // max_total_cost_usd of the models its agents run on now (#262: e.g. a developer on Fable 5.1).
  // A workflow without a cost limit stays without one.
  dayTotalCost() {
    const base = Number(this.wf.orchestrator?.limits?.max_total_cost_usd) || 0;
    if (!base) return 0;
    return Math.max(base, ...Object.values(this.wf.agents).map((a) => Number(this.modelLimits(a.model).max_total_cost_usd) || 0));
  },

  // The run's cost limit in force: the day one, expanded tonight (#337)
  maxTotalCost() {
    return this.effectiveLimits().cost;
  },

  // The workflow's own limits (#337): { context (tokens), cost (US$, after the #262 lift), duration (ms) },
  // templates rendered; null / 0 when it sets none
  dayLimits() {
    const lim = this.wf.orchestrator?.limits || {};
    const rendered = (raw) => (raw == null ? null : render(String(raw), this.ctx).trim());
    return {
      context: parseTokens(rendered(lim.max_total_context)) || null,
      cost: this.dayTotalCost(),
      duration: parseDuration(rendered(lim.max_total_duration), null) || null,
    };
  },

  // The limits in force now (#337, src/domains/night/night-limits.js): the day ones, expanded by tonight's settings
  // (read at each call, so a raise reaches a run in progress at its next check), never below the
  // highest this run was granted (the morning never cuts a run). Each new grant is recorded as a
  // `limits.expanded` event { day, limits } (the morning summary's runs past a day limit).
  effectiveLimits() {
    const day = this.dayLimits();
    const tonight = this.nightLimits?.() || null;
    const e = nightLimits.effectiveLimits(day, tonight, this.grantedLimits);
    if (tonight || this.grantedLimits) {
      const prev = this.grantedLimits;
      this.grantedLimits = e;
      if (!prev || ['context', 'cost', 'duration', 'turns'].some((k) => e[k] !== prev[k])) this.emitEvent('limits.expanded', { day, limits: e });
    }
    return e;
  },

  // The owner raised tonight's limits (#337, the service calls it on every live run): a context_limit
  // gate already open stays open for the owner to answer, with a note. Never resolves, skips or times out a gate.
  noteLimitsRaised() {
    for (const a of this.approvals.values()) {
      if (!a.gate || !String(a.stepId).endsWith(':context_limit')) continue;
      a.gate.note = 'The limits were raised after it opened: it still waits for your answer.';
      this.emitEvent('log', { level: 'info', message: `${a.stepId}: the limits were raised after it opened; it still waits for the owner.` });
    }
  },

  // orchestrator.limits.max_total_context (e.g. 20M): the context the run's agents have read
  // (input + cache read/write, summed over every turn). Past it, the run pauses before the next
  // agent turn until the user answers: Continue grants one more block of the same size, Stop
  // ends the run as cancelled (its branch keeps the work, so it can be resumed). Never cuts a turn.
  // #337: the limit is the one in force (effectiveLimits), so tonight's raise moves the allowance up.
  async contextGate(stepId) {
    const lim = this.effectiveLimits().context;
    if (!lim) return;
    const used = [...this.sessions.values()].reduce((a, s) => a + contextTokens(s.tokens), 0);
    this.contextAllowance = Math.max(this.contextAllowance || 0, lim);
    if (used < this.contextAllowance) return;
    const m = (n) => `${(n / 1e6).toFixed(1)}M`;
    this.emitEvent('limit.exceeded', { limit: 'max_total_context', value: this.contextAllowance, current: used, paused: true });
    const { answer } = await this.requestApproval({
      id: `${stepId}:context_limit`, raw: true,
      message: `Paused: this run's agents have read ${m(used)} tokens of context, past its limit of ${m(this.contextAllowance)} (orchestrator.limits.max_total_context).\n\nContinue to allow another ${m(lim)}, or stop the run (its branch keeps the work, so it can be resumed).`,
      choices: [{ id: 'continue', label: `Continue (another ${m(lim)})` }, { id: 'stop', label: 'Stop the run' }],
    });
    if (answer !== 'continue') {
      this.emitEvent('log', { level: 'info', message: `context limit: stopped by ${answer === false || answer === 'stop' ? 'the user' : 'timeout'}` });
      this.stop();
      throw new Error('Cancelled');
    }
    this.contextAllowance = used + lim;
    this.emitEvent('log', { level: 'info', message: `context limit: continued up to ${m(this.contextAllowance)}` });
    this.setStatus(this.orchestrator, 'active');
  },

  // Monthly budget per provider: checked before every real (non-mock) turn, over this run's sessions
  // and those of the other runs in progress.
  checkBudget(providerName) {
    const id = providerId(providerName);
    const b = id && this.budget[id];
    if (!b || (!b.limitUsd && !b.limitTokens)) return;
    let usd = b.usedUsd || 0;
    let tokens = b.usedTokens || 0;
    for (const s of [...this.sessions.values(), ...this.peerSessions()]) {
      if (providerId(s.provider) !== id) continue;
      usd += sessionCost({ cost_usd: s.costUsd + (s.cliOnlyUsd || 0), model: s.model, tokens: s.tokens }, this.prices) || 0;
      tokens += totalTokens(s.tokens);
    }
    const pct = Math.max(b.limitUsd ? usd / b.limitUsd : 0, b.limitTokens ? tokens / b.limitTokens : 0);
    const detail = [b.limitUsd && `$${usd.toFixed(2)} of $${b.limitUsd}`, b.limitTokens && `${tokens} of ${b.limitTokens} tokens`].filter(Boolean).join(', ');
    if (pct >= 1) {
      this.emitEvent('budget.exceeded', { provider: id, usd, tokens, limit_usd: b.limitUsd, limit_tokens: b.limitTokens, blocked: b.blockOnLimit });
      if (b.blockOnLimit) throw new Error(`Monthly budget for ${b.name || id} reached (${detail}). Raise it in Usage or wait for next month.`);
    } else if (pct >= WARN_AT && !this.budgetWarned.has(id)) {
      this.budgetWarned.add(id);
      this.emitEvent('log', { level: 'warn', message: `${b.name || id} is at ${Math.round(pct * 100)}% of its monthly budget (${detail}).` });
    }
  },

  // #369: a Claude turn on a model the installed Claude Code does not know (res.unrecognized, from its
  // stderr): the CLI priced it at another model's rates, so the turn is priced from its tokens at the
  // model's prices (settings.prices, else the adapter's table), cache writes at the session's cache
  // tier. The CLI's figure stays as cli_cost_usd. With no price the turn's cost is unknown (null) and
  // the CLI's figure counts toward the limits (s.cliOnlyUsd). Rewrites res.costUsd; warns once per
  // model. Returns the fields of the turn's event ({} for a model the CLI knows).
  priceUnrecognizedTurn(session, res, { tier, stepId, agentName }) {
    const u = res.unrecognized;
    if (!u) return {};
    const model = u.model || session.model;
    const cliCost = res.costUsd ?? null;
    const price = priceOf(model, this.prices);
    const cost = price ? +tokensCost(res.usage, price, sessionCache.cacheLifetimeMs('claude', { tier: tier || session.cacheTier || null })).toFixed(6) : null;
    const source = cost == null ? 'unknown' : 'tokens';
    res.costUsd = cost;
    if (cost == null) session.cliOnlyUsd = (session.cliOnlyUsd || 0) + (cliCost || 0);
    session.costEstimate = {
      source, model, cli_version: u.cliVersion || null,
      cli_cost_usd: +((session.costEstimate?.cli_cost_usd || 0) + (cliCost || 0)).toFixed(6),
    };
    if (!this.unknownModelWarned.has(model)) {
      this.unknownModelWarned.add(model);
      const cli = `Claude Code${u.cliVersion ? ` ${u.cliVersion}` : ''}`;
      this.emitEvent('log', {
        level: 'warn', kind: 'unrecognized_model', step_id: stepId, agent: agentName, model,
        message: `[${agentName}] ${cli} does not know ${model}: it priced the turn at another model's rates (US$ ${(cliCost || 0).toFixed(4)}). `
          + (cost == null
            ? `There is no price for ${model}: its cost is unknown (add one in Usage › Prices); the run's limits count the CLI's figure.`
            : 'Its turns are estimated from tokens at its own prices.')
          + ' Update the CLI with `claude update`.',
      });
    }
    return { cost_source: source, cli_cost_usd: cliCost, ...(cost == null ? { cost_note: `no price for ${model}` } : {}) };
  },

  // What this run's child runs cost (#175), their own children included: it counts toward this run's
  // max_total_cost_usd and shows next to its cost; their context never counts toward its context limit.
  childrenCostUsd() {
    return this.childRuns.reduce((a, c) => a + (+c.cost_usd || 0), 0);
  },

  supervisorCost() {
    return [...this.sessions.values()].filter((s) => s.agent === this.supervisorCfg?.agent).reduce((a, s) => a + (s.costUsd || 0), 0);
  },

  addStepTiming(stepId, t) {
    const s = (this.stepTiming[stepId || 'delegated'] ??= { turns: 0, duration_ms: 0, active_ms: 0, waiting_ms: 0, stalled_ms: 0 });
    s.turns++;
    for (const k of ['duration_ms', 'active_ms', 'waiting_ms', 'stalled_ms']) s[k] += t[k];
  },

  // Agent time per step: active (the model working) vs waiting (a tool call running), and the part
  // of the waits with no output past idleWarnMs (stalled). Explains why a slow step was slow.
  // gate_wait_ms: the time the run waited for the owner at its human gates, apart from agent time.
  timingSummary() {
    const total = { duration_ms: 0, active_ms: 0, waiting_ms: 0, stalled_ms: 0 };
    for (const s of Object.values(this.stepTiming)) for (const k of Object.keys(total)) total[k] += s[k];
    const gateWaitMs = Object.values(this.gateWaits).reduce((a, g) => a + g.wait_ms, 0);
    return { steps: this.stepTiming, ...total, gates: this.gateWaits, gate_wait_ms: gateWaitMs };
  },

  // #416: the time this run waited for the owner with at least one gate open (gates open together
  // count once), the gate open now included: what max_total_duration does not count
  gateClockMs() {
    const c = this.gateClock;
    return c ? c.total + (c.since == null ? 0 : Date.now() - c.since) : 0;
  },

  // Starts or stops the gate clock after a gate opens or closes (#416)
  syncGateClock() {
    const c = (this.gateClock ??= { total: 0, since: null });
    if (this.approvals.size && c.since == null) c.since = Date.now();
    else if (!this.approvals.size && c.since != null) {
      c.total += Date.now() - c.since;
      c.since = null;
    }
  },

  // Per run and per agent: context at the start of each turn, its peak, tokens, and the tokens spent
  // on turns that could not progress ("waste": every tool call refused, or a blocked /loop iteration).
  // subagent_calls: sub-agent calls per agent, in total and per step, to compare runs (#160).
  contextSummary() {
    const agents = {};
    let waste = 0;
    for (const r of this.turnLog) {
      const a = (agents[r.agent] ??= { mode: r.mode, turns: 0, fresh_sessions: 0, tokens: 0, peak: null, waste_tokens: 0, subagent_calls: 0, subagent_calls_by_step: {}, per_turn: [] });
      a.turns++;
      if (r.fresh) a.fresh_sessions++;
      a.tokens += r.tokens;
      if (r.context_peak != null) a.peak = Math.max(a.peak || 0, r.context_peak);
      if (r.waste) { a.waste_tokens += r.tokens; waste += r.tokens; }
      if (r.subagent_calls) {
        a.subagent_calls += r.subagent_calls;
        a.subagent_calls_by_step[r.step] = (a.subagent_calls_by_step[r.step] || 0) + r.subagent_calls;
      }
      a.per_turn.push({ step: r.step, visit: r.visit, start: r.context_start, peak: r.context_peak, tokens: r.tokens, ...(r.subagent_calls ? { subagent_calls: r.subagent_calls } : {}), ...(r.waste ? { waste: r.waste } : {}), ...(r.cut ? { cut: true, requests: r.requests } : {}) });
      if (a.per_turn.length > 200) a.per_turn.shift();
    }
    return { agents, waste_tokens: waste };
  },
};

module.exports = {
  childRunCost,
  kTokens,
  methods,
};
