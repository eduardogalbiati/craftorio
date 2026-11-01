// @ts-check
// The AI supervisor in a run (#250, from packages/engine/engine/workflow.js): `superviseFailure` on a step error
// (`askSupervisor` validates one decision), the supervisor on call (`checkStalls`: the same output or
// a slow visit → `superviseStall` / `superviseSlow`; escalation gates → `superviseEscalation`; a
// failed action, an exhausted loop or an idle agent), its budget and what blocks it (`onCallBlocked`),
// and `supervisorAsksHuman` when it gives up. It never crosses a human gate (`kind: decision`).

'use strict';

const supervisor = require('../../domains/supervisor/supervisor');
const { render } = require('./templates');
const {
  answeredKey,
  extractJson,
  repeatKey,
  validateSchema,
} = require('./outputs');
const { GATE, isLooping } = require('./load');
const { DENIAL_WARN } = require('./turns');

// Stall signals of an agent step (orchestrator.supervisor.stall, 0 = off): the same decision this many
// visits in a row, and a visit this many times longer than the step's usual one (its earlier visits in
// the run), past STALL_SLOW_MIN_MS. With the supervisor on call, a stall wakes it.
const STALL_SAME_OUTPUT = 3;
const STALL_SLOW_FACTOR = 3;
const STALL_SLOW_MIN_MS = 10 * 60e3;
// #567: an agent's questions in a row (needs_human) that make a stall; one question never is one
const STALL_QUESTIONS = 2;
// What the supervisor may spend per run (orchestrator.supervisor.max_cost_usd) before the person is asked.
const SUPERVISOR_MAX_COST_USD = 5;
const median = (xs) => {
  if (!xs?.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const methods = {
  // ---- stall detection and the supervisor on call (#41) ---------------------------------------
  // Stall signals of an agent step's visit (deterministic, no tokens): the same decision N visits in a
  // row, refused tool calls in a row, a visit far longer than the step's usual one (watchSlowStep). Each
  // is a `log` warning of kind `stall`; with the supervisor on call, it decides whether the run goes on
  // to `next` (superviseStall). Not when the run ends there or reaches an escalation gate, where the
  // supervisor is called anyway (with these signals).
  async checkStalls(step, st, output, t0, next, again) {
    const cfg = this.wf.orchestrator?.supervisor?.stall || {};
    const signals = [];
    // a /loop iteration repeats its answer by design (polling); a fix round (goto itself) counts
    const same = Number(cfg.same_output ?? STALL_SAME_OUTPUT);
    if (!(again && isLooping(step)) && same) {
      // the findings a fix round answers: those of the step it came from (e.g. code_review)
      const from = this.ctx.previous_step !== step.id && this.wf.steps.find((s) => s.id === this.ctx.previous_step);
      const answered = from ? answeredKey(from, this.ctx.steps[from.id]?.output) : null;
      const key = repeatKey(step, output, { head: () => this.worktreeHead(), answered });
      st.repeat = st.repeat?.key === key ? { key, count: st.repeat.count + 1 } : { key, count: 1 };
      if (st.repeat.count % same === 0) signals.push({ kind: 'same_output', detail: `the same answer ${st.repeat.count} visits in a row: ${key.slice(0, 200)}` });
    }
    const tools = st.tools || {};
    if ((tools.maxStreak || 0) >= DENIAL_WARN) {
      signals.push({ kind: 'permission_denials', detail: `${tools.denials} tool calls refused in this visit (${tools.maxStreak} in a row), e.g. ${(tools.denied || []).slice(-2).join(' · ')}` });
    }
    for (const s of signals) this.recordStall(step.id, s);
    // already reported while the step ran; not again when the supervisor decided on it then
    if (st.slow && !st.slow.handled) signals.push(st.slow);
    st.slow = null;
    (st.durations ??= []).push(Date.now() - t0);
    if (!signals.length || next === 'end' || next === 'fail' || !this.supervisorCfg?.onCall) return next;
    if (this.wf.steps.find((s) => s.id === next)?.kind === 'escalation') return next;
    // an exhausted loop: the supervisor was called on it (finishStep) or is called at the gate (runStep)
    if (st.exhaustedVisit === st.visits || this.exhausted?.target === next) return next;
    return (await this.superviseStall(step, st, signals, next)) || next;
  },

  // A visit running `slow_factor` times longer than the step's usual one (the median of its earlier
  // visits in this run) is reported while it runs and wakes the supervisor on call right away
  // (superviseSlow): the step keeps running, or its turn is stopped and the step runs again. After a
  // `wait`, it is checked again when the visit has run twice as long. stop(): the visit ended.
  watchSlowStep(step, st) {
    const factor = Number(this.wf.orchestrator?.supervisor?.stall?.slow_factor ?? STALL_SLOW_FACTOR);
    const usual = median(st.durations);
    if (!factor || !usual) return null;
    const t0 = Date.now();
    let timer = null;
    let stopped = false;
    const arm = (after) => {
      timer = setTimeout(async () => {
        const ran = Date.now() - t0;
        st.slow = { kind: 'slow_step', detail: `running for ${Math.round(ran / 6e4)} min, ${factor}× its usual ${Math.round(usual / 6e3) / 10} min or more` };
        this.recordStall(step.id, st.slow);
        const again = await this.superviseSlow(step, st).catch((e) => {
          this.emitEvent('log', { level: 'error', message: `Supervisor could not decide on the slow step ${step.id}: ${e.message}` });
          return false;
        });
        if (again && !stopped) arm(ran);
      }, after);
      timer.unref?.();
    };
    arm(Math.max(usual * factor, STALL_SLOW_MIN_MS));
    return { stop: () => { stopped = true; clearTimeout(timer); } };
  },

  // The supervisor on call on a step still running far longer than usual: `wait` (true: check again
  // later), `interrupt` its running turns (the step runs again with the instruction, idleRetry), or
  // `user_action` (the person is told what to do while the step keeps running). Parallel steps are
  // not interrupted (their turns' errors do not come back as one), only diagnosed.
  async superviseSlow(step, st) {
    if (!this.supervisorCfg?.onCall) return false;
    const blocked = this.onCallBlocked(st);
    if (blocked) {
      this.emitEvent('log', { level: 'warn', message: `Supervisor on call: not called on the slow step ${step.id} (${blocked}); it keeps running.` });
      return false;
    }
    const signal = st.slow;
    const d = await this.askOnCall(step, st, { kind: 'slow', signals: [{ step: step.id, ...signal }], steps: [], actions: supervisor.SLOW_ACTIONS, running: true });
    if (!d || st.slow !== signal) return false; // no decision, or the visit ended meanwhile
    signal.handled = true;
    const evidence = `${signal.kind}: ${signal.detail}`;
    if (d.action === 'interrupt') {
      const turns = step.agents ? [] : [...(this.liveTurns.get(step.id) || [])];
      const stopped = turns.filter((stop) => stop(d)).length > 0;
      this.onCallDecided(step, 'stall', d, stopped ? 'interrupt' : 'wait', {
        goto: stopped ? step.id : null, evidence,
        ...(stopped ? {} : { note: step.agents ? 'not interrupted: a parallel step is not interrupted' : 'not interrupted: no turn of the step was running' }),
      });
      return !stopped;
    }
    this.onCallDecided(step, 'stall', d, d.action === 'user_action' ? 'user_action' : 'wait', { evidence });
    if (d.action === 'user_action') {
      this.emitEvent('log', { level: 'warn', kind: 'user_action', step_id: step.id, message: `The supervisor on call needs you while ${step.id} keeps running: ${d.user_action || d.recommendation || d.explanation}` });
    }
    return true;
  },

  // quiet: already reported by its own warning (a blocked /loop)
  recordStall(stepId, s, { quiet = false } = {}) {
    this.stalls.push({ step: stepId, ...s, ts: new Date().toISOString() });
    if (this.stalls.length > 20) this.stalls.shift();
    if (!quiet) this.emitEvent('log', { level: 'warn', kind: 'stall', stall: s.kind, step_id: stepId, message: `${stepId} may be stuck (${s.kind}): ${s.detail}` });
  },

  // Why the supervisor on call is not called on this step (null: it is): off, or a limit reached.
  onCallBlocked(st) {
    const cfg = this.supervisorCfg;
    if (!cfg?.onCall) return 'off';
    if ((st.onCall?.length || 0) >= cfg.perStep) return `its ${cfg.perStep} interventions on this step are used`;
    if (this.supervisorUsed >= cfg.total) return `its ${cfg.total} interventions in this run are used`;
    if (cfg.maxCost != null && this.supervisorCost() >= cfg.maxCost) return `its cost cap for this run (US$ ${cfg.maxCost}) is reached`;
    return null;
  },

  /**
   * @param {any} step
   * @param {any} st
   * @param {{ kind: string, gate?: any, signals: any[], retryStep?: string | null, steps: string[], actions: string[], running?: boolean }} options
   */
  async askOnCall(step, st, { kind, gate, signals, retryStep, steps, actions, running = false }) {
    const cfg = this.supervisorCfg;
    this.supervisorUsed++;
    st.onCall ??= [];
    this.emitEvent('supervisor.started', {
      step_id: step.id, kind, error: gate ? 'escalation gate: the run would ask you about a problem' : `stall: ${signals.map((s) => `${s.kind} (${s.detail})`).join('; ')}`,
    });
    const handoffs = [...this.handoffNotes.entries()].map(([agent, n]) => ({ agent, ...n }));
    const history = this.wf.steps.filter((s) => this.ctx.steps[s.id]?.visits > 0).map((s) => ({ step: s.id, visits: this.ctx.steps[s.id].visits, output: this.ctx.steps[s.id].output }));
    const limits = `Interventions left after this one: ${cfg.perStep - st.onCall.length - 1} on this step, ${cfg.total - this.supervisorUsed} in this run.`
      + (cfg.maxCost != null ? ` Your cost in this run so far: US$ ${this.supervisorCost().toFixed(2)} of US$ ${cfg.maxCost}.` : '');
    const prompt = supervisor.onCallPrompt({ wf: this.wf, step, gate, signals, retryStep, steps, history, previous: st.onCall, events: this.recent, handoffs, limits, running, language: this.languageSetting() });
    const d = await this.askSupervisor(step, prompt, supervisor.onCallSchema({ actions, steps, routes: gate?.routes, answers: gate?.answers }), st.onCall.length + 1);
    if (d) st.onCall.push({ action: d.action, explanation: d.explanation });
    return d;
  },

  // Every on-call intervention: an event (run chat, watch mode, timeline) and a decision-log row.
  /**
   * @param {any} step
   * @param {string} kind
   * @param {any} d
   * @param {string} action
   * @param {{ goto?: string | null, route?: any, note?: string | null, evidence?: string }} [options]
   */
  onCallDecided(step, kind, d, action, { goto = null, route = null, note = null, evidence = '' } = {}) {
    this.emitEvent('supervisor.decision', {
      step_id: step.id, kind, action, goto, cause_class: d.cause_class || null, explanation: d.explanation, instruction: d.instruction || null,
      ...(route != null ? { route } : {}), ...(d.recommendation ? { recommendation: d.recommendation } : {}),
      ...(d.user_action ? { user_action: d.user_action } : {}), ...(note ? { note } : {}),
    });
    const asked = action === 'escalate' || action === 'user_action';
    this.logDecisions('supervisor', step.id, [[
      kind === 'escalation' ? 'on-call' : 'stall', `${action}${goto ? ` → ${goto}` : ''}${route != null ? ` → ${route}` : ''}`, d.explanation,
      evidence, note || (asked ? 'asked the person' : 'applied'),
    ]]);
  },

  // Back to an agent step with the supervisor's instruction; false when the step is not allowed.
  onCallGoto(from, d, target, allowed) {
    if (!target || !allowed.includes(target)) return false;
    this.ctx.steps[target].supervisorNote = d.instruction || `The supervisor on call sent the run back here: ${d.explanation}`;
    this.emitEvent('step.transition', { from: from.id, to: target, when: `supervisor on call: ${d.action}` });
    return true;
  },

  // An escalation gate: the supervisor retries or resumes an agent step, routes the gate itself, or
  // returns its diagnosis for the gate (escalate, an action only the person can take, an invalid
  // choice, or no decision). Over its limits, the gate opens with its last diagnosis on this gate.
  // decision: a decision gate an exhausted loop led to: the supervisor never answers it (no `route`).
  async superviseEscalation(step, st, t0, { decision = false } = {}) {
    const blocked = this.onCallBlocked(st);
    if (blocked) {
      if (blocked === 'off') return null;
      this.emitEvent('log', { level: 'warn', message: `Supervisor on call: not called at ${step.id} (${blocked}); asking you.` });
      return st.lastDiagnosis ? { diagnosis: { ...st.lastDiagnosis, note: `not called again: ${blocked}` } } : null;
    }
    const routes = decision ? [] : step.choices ? step.choices.filter((c) => !c.feedback_required).map((c) => c.id) : ['approved', 'rejected'];
    const transitions = (step.transitions || []).map((t) => `- ${t.when} → ${t.goto}${t.status ? ` (the run ends as ${t.status})` : ''}${t.delegate ? ` (${t.delegate.agent} acts first)` : ''}`).join('\n');
    const steps = this.resumableSteps();
    const prev = this.ctx.previous_step;
    const retryStep = steps.includes(prev) ? prev : null;
    // answers: what the supervisor may recommend to the person (#213), the gate's buttons
    const answers = step.choices ? step.choices.map((c) => c.id) : ['approve', 'reject'];
    const gate = { message: render(step.message, this.ctx).trim(), routes, answers, transitions, decision };
    const actions = decision ? supervisor.ESCALATION_ACTIONS.filter((a) => a !== 'route') : supervisor.ESCALATION_ACTIONS;
    const d = await this.askOnCall(step, st, { kind: 'escalation', gate, signals: this.stalls.slice(-10), retryStep, steps, actions });
    if (!d) return null;
    st.lastDiagnosis = {
      explanation: d.explanation,
      recommend: answers.includes(d.recommend) ? d.recommend : null,
      recommendation: d.recommendation || null,
      options: Array.isArray(d.options) ? d.options.filter((o) => typeof o === 'string' && o.trim()).slice(0, 3) : null,
      user_action: d.user_action || null,
    };
    const evidence = gate.message.slice(0, 300);
    if (d.action === 'retry' || d.action === 'resume') {
      const target = d.action === 'retry' ? retryStep : d.step;
      if (target && steps.includes(target)) {
        st.output = { supervisor: { action: d.action, goto: target, explanation: d.explanation } };
        this.onCallDecided(step, 'escalation', d, d.action, { goto: target, evidence });
        this.emitEvent('step.finished', { step_id: step.id, visit: st.visits, iteration: st.iteration, output: st.output, duration_ms: Date.now() - t0 });
        this.onCallGoto(step, d, target, steps);
        return { goto: target };
      }
      this.onCallDecided(step, 'escalation', d, 'escalate', { evidence, note: `"${target}" is not a step the run can go back to` });
      return { diagnosis: st.lastDiagnosis };
    }
    if (d.action === 'route') {
      if (routes.includes(d.route)) {
        this.onCallDecided(step, 'escalation', d, 'route', { route: d.route, evidence });
        return { route: step.choices ? d.route : d.route === 'approved' };
      }
      this.onCallDecided(step, 'escalation', d, 'escalate', { evidence, note: `"${d.route}" is not an answer of this gate` });
      return { diagnosis: st.lastDiagnosis };
    }
    this.onCallDecided(step, 'escalation', d, d.action === 'user_action' ? 'user_action' : 'escalate', { evidence });
    return { diagnosis: st.lastDiagnosis };
  },

  // A stall on an agent step: the run goes on to `next` (continue), the step runs again or the run
  // resumes from an earlier agent step with an instruction, or the person is asked for an action only
  // they can take. Returns the step to go to instead of `next`, or null.
  async superviseStall(step, st, signals, next) {
    const blocked = this.onCallBlocked(st);
    if (blocked) {
      this.emitEvent('log', { level: 'warn', message: `Supervisor on call: not called on the stall of ${step.id} (${blocked}); the run goes on to ${next}.` });
      return null;
    }
    const steps = this.resumableSteps();
    const d = await this.askOnCall(step, st, { kind: 'stall', signals, retryStep: step.id, steps, actions: supervisor.STALL_ACTIONS });
    if (!d) return null;
    const evidence = signals.map((s) => `${s.kind}: ${s.detail}`).join('; ').slice(0, 300);
    if (d.action === 'retry' || d.action === 'resume') {
      const target = d.action === 'retry' ? step.id : d.step;
      if (this.onCallGoto(step, d, target, steps)) {
        this.onCallDecided(step, 'stall', d, d.action, { goto: target, evidence });
        return target;
      }
      this.onCallDecided(step, 'stall', d, 'continue', { evidence, note: `"${target}" is not a step the run can go back to` });
      return null;
    }
    if (d.action !== 'user_action') {
      this.onCallDecided(step, 'stall', d, 'continue', { goto: next, evidence });
      return null;
    }
    this.onCallDecided(step, 'stall', d, 'user_action', { evidence });
    const { answer, feedback } = await this.requestApproval({
      id: step.id, raw: true,
      message: `The step "${step.id}" seems stuck and the supervisor on call needs an action only you can take.\n\n${d.explanation}\n\nWhat to do:\n${d.user_action || d.recommendation || '(no action given)'}`,
      choices: [{ id: 'retry', label: 'Done: run the step again' }, { id: 'continue', label: `Continue to ${next}` }, { id: 'stop', label: 'Stop the run' }],
      feedback: { label: 'Your instruction for the new attempt (optional)' },
    });
    if (answer === 'stop') throw new Error(`Stopped at ${step.id} by the user, at the supervisor's request.`);
    if (answer !== 'retry') return null;
    this.onCallGoto(step, { ...d, instruction: feedback || d.instruction }, step.id, [step.id]);
    return step.id;
  },

  // #567: an agent asking again right after an answer (STALL_QUESTIONS in a row) is a stall: the
  // supervisor on call may `continue` with the agent's own default (its decision, never the
  // owner's answer) or leave it to the owner (`user_action`). Returns the human_answer it gives, or
  // null: the gate opens (off, a limit reached, no decision, user_action).
  async superviseQuestion(step, st, q) {
    if (st.asks < STALL_QUESTIONS) return null;
    const signal = { kind: 'repeated_question', detail: `${st.asks} questions in a row: ${String(q.question).slice(0, 200)}${q.default != null ? ` (its default: ${q.default})` : ''}` };
    this.recordStall(step.id, signal);
    const blocked = this.onCallBlocked(st);
    if (blocked) {
      if (blocked !== 'off') this.emitEvent('log', { level: 'warn', message: `Supervisor on call: not called on the repeated question of ${step.id} (${blocked}); asking you.` });
      return null;
    }
    const d = await this.askOnCall(step, st, { kind: 'stall', signals: [{ step: step.id, ...signal }], retryStep: null, steps: [], actions: ['continue', 'user_action'] });
    if (!d) return null;
    const evidence = `${signal.kind}: ${signal.detail}`.slice(0, 300);
    if (d.action !== 'continue') {
      this.onCallDecided(step, 'stall', d, 'user_action', { evidence });
      return null;
    }
    this.onCallDecided(step, 'stall', d, 'continue', { goto: step.id, evidence, note: `gave the agent its default: ${q.default ?? '(none: its own best assumption)'}` });
    const def = q.default != null ? String(q.default) : null;
    const label = def && Array.isArray(q.options) ? q.options.find((o) => o && String(o.id) === def)?.label || null : null;
    return { question: String(q.question).trim(), choice: def, label, feedback: d.instruction || '', default: def, by: 'supervisor' };
  },

  async superviseActionError(step, route, e) {
    const cfg = this.supervisorCfg;
    if (!cfg) return null;
    if (this.supervisorUsed >= cfg.total) {
      this.emitEvent('log', { level: 'warn', message: `Supervisor: no more interventions allowed; ${step.id} goes to ${route.on_error}.` });
      return null;
    }
    this.supervisorUsed++;
    const st = this.ctx.steps[step.id];
    st.actionChecks = (st.actionChecks || 0) + 1;
    this.emitEvent('supervisor.started', { step_id: step.id, kind: 'action_error', error: e.message });
    const handoffs = [...this.handoffNotes.entries()].map(([agent, n]) => ({ agent, ...n }));
    const prompt = supervisor.actionErrorPrompt({ wf: this.wf, step, error: e.message, check: e.check, recover: route.recover, gate: route.on_error, events: this.recent, handoffs, language: this.languageSetting() });
    const d = await this.askSupervisor(step, prompt, supervisor.actionSchema(route.recover), st.actionChecks);
    if (!d) return null;
    const back = d.action === 'goto' && route.recover.includes(d.goto);
    const at = new Date().toISOString().slice(11, 16);
    const record = back ? `went back to ${d.goto} at ${at} UTC because ${d.explanation}` : `stopped at ${route.on_error} at ${at} UTC: ${d.explanation}`;
    this.emitEvent('supervisor.decision', {
      step_id: step.id, kind: 'action_error', action: back ? 'goto' : 'escalate', goto: back ? d.goto : route.on_error,
      cause_class: d.cause_class || null, explanation: d.explanation, instruction: d.instruction || null, record,
      ...(d.action === 'goto' && !back ? { note: `"${d.goto}" is not a recovery step` } : {}),
    });
    this.logDecisions('supervisor', step.id, [['recover', record, d.explanation, e.check ? `${e.check.state}: ${e.check.detail}` : e.message.slice(0, 300), back ? `goto ${d.goto}` : `gate ${route.on_error}`]]);
    return { ...d, action: back ? 'goto' : 'escalate', record };
  },

  // A loop ran out towards a step, `end` or `fail`: the supervisor on call decides whether the run
  // goes there (continue) or back to the agents with an instruction (retry/resume, one more round).
  async superviseExhausted(step, st, target) {
    const ex = this.exhausted;
    this.exhausted = null;
    if (!this.supervisorCfg?.onCall) return target;
    st.exhaustedVisit = st.visits; // checkStalls does not call it again on this visit
    const next = await this.superviseStall(step, st, [{ step: step.id, kind: 'loop_exhausted', detail: `${ex.detail} → ${target}` }], target);
    if (!next) return target;
    ex.refund();
    return next;
  },

  // ---- AI supervisor (orchestrator.supervisor in the YAML; skill run-supervisor) ------------
  // Called only when a step fails. It explains the failure and picks a recovery; the engine
  // validates it: fixed outputs must match the step's schema, goto only to the step's own
  // targets, and it never touches a human gate.
  setupSupervisor() {
    const orch = this.wf.orchestrator || {};
    const cfg = orch.supervisor;
    if (!cfg || cfg.enabled === false) { this.supervisorCfg = null; return; }
    const providerName = cfg.provider || orch.provider || 'claude';
    const name = this.wf.agents.supervisor ? '_supervisor' : 'supervisor';
    // Opus 5.5 by default on Claude, unless the workflow names a model
    const model = cfg.model || orch.model || (providerName === 'claude' ? 'claude-opus-5-5' : undefined);
    // read-only on the run folder: it works on the workflow, never on the user's code
    this.wf.agents[name] = {
      provider: providerName, model, ...(cfg.effort ? { effort: cfg.effort } : {}), session: 'ephemeral', working_dir: '{{ run_dir }}',
      skills: ['run-supervisor'], capabilities: { tools: ['read'], web: false }, timeout: cfg.timeout || '10m',
      system_prompt: 'You are the run supervisor of this workflow engine.',
    };
    this.ctx.agents[name] = { provider: providerName, model };
    // onCall (#41, `on_call: false` turns it off): escalation gates and stalls call it before the person;
    // maxCost: what it may spend per run (max_cost_usd), with max_interventions / max_total
    this.supervisorCfg = {
      agent: name, perStep: cfg.max_interventions ?? 2, total: cfg.max_total ?? 6,
      onCall: cfg.on_call !== false, maxCost: cfg.max_cost_usd ?? SUPERVISOR_MAX_COST_USD,
    };
    this.supervisorUsed = 0;
  },

  async superviseFailure(step, st, err) {
    const cfg = this.supervisorCfg;
    // `supervise: false` (#290): a step whose failure costs nothing to skip goes straight to its on_error
    if (!cfg || step.supervise === false) return null;
    st.interventions ??= [];
    if (st.interventions.length >= cfg.perStep || this.supervisorUsed >= cfg.total) {
      this.emitEvent('log', { level: 'warn', message: `Supervisor: no more interventions allowed on ${step.id}.` });
      return null;
    }
    this.supervisorUsed++;
    const allowed = [...new Set([step.id, step.on_error, ...(step.transitions || []).flatMap((t) => [t.goto, t.on_exhausted])])]
      .filter((x) => x && x !== 'end' && x !== 'fail' && this.wf.steps.some((y) => y.id === x && !GATE.includes(y.type)));
    this.emitEvent('supervisor.started', { step_id: step.id, error: err.message });
    // the agents' own summaries of where they are, instead of their full transcripts
    const handoffs = (step.agents || [step.agent]).map((a) => this.handoffNotes.get(a) && { agent: a, ...this.handoffNotes.get(a) }).filter(Boolean);
    const prompt = supervisor.decisionPrompt({ wf: this.wf, step, error: err.message, answer: st.lastAnswer, allowed, events: this.recent, previous: st.interventions, handoffs, language: this.languageSetting() });
    const decision = await this.askSupervisor(step, prompt, supervisor.DECISION_SCHEMA, st.interventions.length + 1);
    if (!decision) return null;
    st.interventions.push({ action: decision.action, explanation: decision.explanation });
    const emit = (action, extra = {}) => {
      this.emitEvent('supervisor.decision', {
        step_id: step.id, action, cause_class: decision.cause_class || null, explanation: decision.explanation,
        instruction: decision.instruction || null, goto: decision.goto || null, ...extra,
      });
      this.logDecisions('supervisor', step.id, [['failure', `${action}${action === 'goto' ? ` → ${decision.goto}` : ''}`, decision.explanation, err.message.slice(0, 300), extra.note || 'applied']]);
    };
    const retry = (instruction) => { st.supervisorNote = instruction || decision.instruction || 'Your previous attempt failed; read the error and try again.'; return { goto: step.id, decision }; };

    switch (decision.action) {
      case 'fix_output': {
        const errs = step.agents ? ['parallel steps cannot be fixed'] : step.output_schema ? validateSchema(decision.output, step.output_schema) : [];
        if (decision.output != null && !errs.length) { emit('fix_output'); return { output: decision.output, decision }; }
        emit('retry', { note: `fixed output rejected: ${errs.join('; ') || 'empty'}` });
        return retry();
      }
      case 'retry':
        emit('retry');
        return retry();
      case 'goto':
        if (allowed.includes(decision.goto)) { emit('goto'); return { goto: decision.goto, decision }; }
        emit('ask_human', { note: `goto "${decision.goto}" is not allowed` });
        return this.supervisorAsksHuman(step, decision, retry, allowed);
      case 'ask_human':
        emit('ask_human');
        return this.supervisorAsksHuman(step, decision, retry, allowed);
      default:
        emit('fail');
        return null;
    }
  },

  // One supervisor decision that validates against `schema` (asked again once), or null.
  async askSupervisor(step, prompt, schema, visit) {
    const cfg = this.supervisorCfg;
    const opts = { stepId: `${step.id}:supervisor`, hint: { stepId: `${step.id}:supervisor`, visit, schema, sequences: this.mockSequences } };
    let decision;
    try {
      const full = `${prompt}\n\n---\nAt the end of your response you MUST include a \`\`\`json block with an object that validates against this JSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``;
      let res = await this.sendToAgent(cfg.agent, full, opts);
      for (let attempt = 0; ; attempt++) {
        let errs;
        try { decision = extractJson(res.text); errs = validateSchema(decision, schema); } catch (e) { errs = [e.message]; }
        if (!errs.length) return decision;
        if (attempt >= 1) throw new Error(`invalid decision: ${errs.join('; ')}`);
        res = await this.sendToAgent(cfg.agent, this.retryPrompt(cfg.agent, full, res.text, schema, errs), opts);
      }
    } catch (e) {
      this.emitEvent('log', { level: 'error', message: `Supervisor could not decide on ${step.id}: ${e.message}` });
      return null;
    }
  },

  // An agent_idle warning on a step's turn wakes the supervisor with the command being waited on.
  // `wait` leaves the turn alone; `interrupt` stops it (interrupt()), and the step runs again with the
  // supervisor's instruction (idleRetry). Counts against max_total, not the step's failure interventions.
  async superviseIdle(step, stall, { agentName, interrupt }) {
    const cfg = this.supervisorCfg;
    if (this.supervisorUsed >= cfg.total) {
      this.emitEvent('log', { level: 'warn', message: `Supervisor: no more interventions allowed; ${step.id} keeps waiting.` });
      return;
    }
    this.supervisorUsed++;
    const st = this.ctx.steps[step.id];
    st.idleChecks = (st.idleChecks || 0) + 1;
    this.emitEvent('supervisor.started', { step_id: step.id, kind: 'idle', error: `agent idle: ${stall.command}` });
    const handoffs = (step.agents || [step.agent]).map((a) => this.handoffNotes.get(a) && { agent: a, ...this.handoffNotes.get(a) }).filter(Boolean);
    const prompt = supervisor.idlePrompt({ wf: this.wf, step, agent: agentName, idle: stall, events: this.recent, handoffs, language: this.languageSetting() });
    const decision = await this.askSupervisor(step, prompt, supervisor.IDLE_SCHEMA, st.idleChecks);
    if (!decision) return;
    const interrupted = decision.action === 'interrupt' && interrupt(decision, stall);
    this.emitEvent('supervisor.decision', {
      step_id: step.id, kind: 'idle', action: decision.action, explanation: decision.explanation,
      instruction: decision.instruction || null, command: stall.command,
      ...(decision.action === 'interrupt' && !interrupted ? { note: 'not interrupted: the agent had resumed or the turn had ended' } : {}),
    });
  },

  // A turn the supervisor interrupted: the step runs again with its instruction (no second supervisor call).
  idleRetry(step, st, e) {
    st.supervisorNote = e.idleInterrupt.instruction
      || (e.idleInterrupt.command
        ? `Your previous attempt was stopped after waiting with no output on: ${e.idleInterrupt.command}. Run long commands in the foreground with a timeout and read their exit code.`
        : 'Your previous attempt was stopped because it ran far longer than this step usually takes. Check what you were waiting on, and run long commands in the foreground with a timeout.');
    return { goto: step.id, decision: { action: 'retry', explanation: e.message } };
  },

  // #380: when the supervisor says a retry would fail the same way and names an allowed step to
  // resume from (`goto`), the gate offers that instead of Retry. Only the person answers it.
  async supervisorAsksHuman(step, decision, retry, allowed = []) {
    const forward = decision.retry_would_fail && allowed.includes(decision.goto) && decision.goto !== step.id ? decision.goto : null;
    const { answer, feedback } = await this.requestApproval({
      id: step.id, raw: true,
      message: `The step "${step.id}" failed and the supervisor needs you.\n\n${decision.explanation}${decision.instruction ? `\n\nSuggested instruction for a new attempt:\n${decision.instruction}` : ''}`,
      choices: forward
        ? [{ id: 'resume', label: `Resume from "${forward}"` }, { id: 'stop', label: 'Stop here' }]
        : [{ id: 'retry', label: 'Retry the step with the suggestion' }, { id: 'stop', label: 'Stop here' }],
      ...(forward ? {} : { feedback: { label: 'Your instruction for the new attempt (optional, replaces the suggestion)' } }),
    });
    if (forward && answer === 'resume') return { goto: forward, decision };
    return answer === 'retry' ? retry(feedback) : null;
  },
};

module.exports = {
  methods,
};
