// Costs, limits and budgets (#250, from src/engine/workflow.js): the run's `max_total_duration` and
// `max_total_cost_usd` checked before every step (`checkLimits`, children included), the limits per
// model (`modelLimits`, #262), the monthly budget per provider over this run and its peers
// (`checkBudget`), the `max_total_context` pause gate (`contextGate`), the supervisor's and the
// children's spend, and the step timing and context metrics of the summary (`timingSummary`,
// `contextSummary`). `childRunCost`: what a child run cost from its summary (#175).

'use strict';

const {
  providerId,
  sessionCost,
  totalTokens,
  WARN_AT,
} = require('../../usage');
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
    const maxDur = parseDuration(lim.max_total_duration, null);
    if (maxDur && Date.now() - this.startedAt > maxDur) {
      this.emitEvent('limit.exceeded', { limit: 'max_total_duration', value: lim.max_total_duration });
      throw new Error(`Maximum duration exceeded (${lim.max_total_duration}).`);
    }
    // its child runs' cost counts too (#175)
    const children = this.childrenCostUsd();
    const cost = [...this.sessions.values()].reduce((a, s) => a + s.costUsd, 0) + children;
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

  // The run's cost limit: orchestrator.limits.max_total_cost_usd, lifted to the largest
  // max_total_cost_usd of the models its agents run on now (#262: e.g. a developer on Fable 5.1).
  // A workflow without a cost limit stays without one.
  maxTotalCost() {
    const base = Number(this.wf.orchestrator?.limits?.max_total_cost_usd) || 0;
    if (!base) return 0;
    return Math.max(base, ...Object.values(this.wf.agents).map((a) => Number(this.modelLimits(a.model).max_total_cost_usd) || 0));
  },

  // orchestrator.limits.max_total_context (e.g. 20M): the context the run's agents have read
  // (input + cache read/write, summed over every turn). Past it, the run pauses before the next
  // agent turn until the user answers: Continue grants one more block of the same size, Stop
  // ends the run as cancelled (its branch keeps the work, so it can be resumed). Never cuts a turn.
  async contextGate(stepId) {
    const raw = this.wf.orchestrator?.limits?.max_total_context;
    const lim = raw == null ? null : parseTokens(render(String(raw), this.ctx));
    if (!lim) return;
    const used = [...this.sessions.values()].reduce((a, s) => a + contextTokens(s.tokens), 0);
    this.contextAllowance ??= lim;
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
      usd += sessionCost({ cost_usd: s.costUsd, model: s.model, tokens: s.tokens }, this.prices) || 0;
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
