// Engine que executa o grafo de steps definido no YAML.
// Emite eventos ('event') que alimentam a UI e o recorder de observabilidade.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { exec } = require('child_process');
const yaml = require('js-yaml');
const nunjucks = require('nunjucks');
const { runTurn, refreshWindowsPath, isRetryable, sleep, emptyUsage } = require('./providers');

// ---------------------------------------------------------------------------
// Templates e expressões
// ---------------------------------------------------------------------------
const tpl = new nunjucks.Environment(null, { autoescape: false });
tpl.addFilter('to_yaml', (v) => yaml.dump(v ?? null, { lineWidth: 120 }).trim());
tpl.addFilter('to_json', (v) => JSON.stringify(v, null, 2));

const render = (s, scope) => (s == null ? '' : tpl.renderString(String(s), scope));
const evalExpr = (expr, scope) => render(`{% if ${expr} %}1{% else %}0{% endif %}`, scope).trim() === '1';

function parseDuration(v, def) {
  if (v == null) return def;
  if (typeof v === 'number') return v;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/.exec(String(v).trim());
  return m ? +m[1] * { ms: 1, s: 1e3, m: 6e4, h: 36e5 }[m[2]] : def;
}

function loadWorkflow(file) {
  const wf = yaml.load(fs.readFileSync(file, 'utf8'));
  if (!wf || !Array.isArray(wf.steps) || !wf.steps.length) throw new Error('Workflow sem "steps".');
  if (!wf.agents) throw new Error('Workflow sem "agents".');
  const ids = new Set(wf.steps.map((s) => s.id));
  for (const s of wf.steps) {
    if (s.type !== 'human_approval' && !wf.agents[s.agent]) throw new Error(`Step "${s.id}" referencia agente inexistente "${s.agent}".`);
    if (s.goal && !s.goal.until) throw new Error(`Step "${s.id}": goal precisa de "until".`);
    if (s.choices && s.type !== 'human_approval') throw new Error(`Step "${s.id}": choices só vale para human_approval.`);
    for (const t of s.transitions || []) {
      for (const target of [t.goto, t.on_exhausted, t.loop?.on_exhausted, s.goal?.on_exhausted, s.loop?.on_exhausted].filter(Boolean)) {
        if (!ids.has(target) && target !== 'end' && target !== 'fail') throw new Error(`Step "${s.id}" aponta para step inexistente "${target}".`);
      }
    }
  }
  return wf;
}

// ---------------------------------------------------------------------------
// Saída estruturada
// ---------------------------------------------------------------------------
function extractJson(text) {
  const src = String(text || '');
  const blocks = [...src.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]).reverse();
  const first = src.indexOf('{');
  const last = src.lastIndexOf('}');
  if (first >= 0 && last > first) blocks.push(src.slice(first, last + 1));
  for (const b of blocks) {
    try { return JSON.parse(b); } catch { /* tenta o próximo */ }
  }
  throw new Error('Nenhum bloco JSON válido encontrado na resposta.');
}

const TYPE_CHECK = {
  object: (x) => x !== null && typeof x === 'object' && !Array.isArray(x),
  array: Array.isArray,
  string: (x) => typeof x === 'string',
  integer: Number.isInteger,
  number: (x) => typeof x === 'number',
  boolean: (x) => typeof x === 'boolean',
};

function validateSchema(v, s, p = 'output', errs = []) {
  if (!s) return errs;
  if (s.type && TYPE_CHECK[s.type] && !TYPE_CHECK[s.type](v)) { errs.push(`${p}: esperado ${s.type}`); return errs; }
  if (s.enum && !s.enum.includes(v)) errs.push(`${p}: "${v}" fora de ${JSON.stringify(s.enum)}`);
  if (s.type === 'object') {
    for (const r of s.required || []) if (v[r] === undefined) errs.push(`${p}.${r}: obrigatório`);
    for (const [k, ps] of Object.entries(s.properties || {})) if (v[k] !== undefined) validateSchema(v[k], ps, `${p}.${k}`, errs);
  }
  if (s.type === 'array' && s.items) v.forEach((x, i) => validateSchema(x, s.items, `${p}[${i}]`, errs));
  return errs;
}

// ---------------------------------------------------------------------------
// `loop` é o formato atual; `mode: polling` + `poll` continuam aceitos
const isLooping = (step) => !!step.loop || step.mode === 'polling';
const loopConfig = (step) => step.loop || step.poll || {};

// Instruções no estilo /goal e /loop do Claude Code. O engine é quem de fato
// repete o step e aplica os limites; o agente só precisa saber o contrato.
function goalLoopInstructions(step, st, scope) {
  const lines = [];
  if (step.goal) {
    lines.push(`/goal: ${render(step.goal.description, scope)}`);
    lines.push('Seu trabalho neste step só termina quando esse objetivo for atingido. Não declare sucesso sem verificar o estado real.');
  }
  if (isLooping(step)) {
    const cfg = loopConfig(step);
    lines.push(`/loop: iteração ${st.iteration}. O orquestrador vai chamar você de novo a cada ${cfg.interval || '1m'} (limite: ${cfg.max_duration || 'sem limite'}) até o /goal ser atingido.`);
    lines.push('Em cada chamada: verifique o estado atual, tome a ação necessária e responda imediatamente. Não fique bloqueado esperando (não use watch/sleep longos).');
  }
  return lines.join('\n');
}

function newRunId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomUUID().slice(0, 8)}`;
}

function addUsage(total, u) {
  for (const k of Object.keys(total)) total[k] += (u && u[k]) || 0;
}

class WorkflowRun extends EventEmitter {
  constructor({ file, inputs, mock, runsDir }) {
    super();
    refreshWindowsPath(); // ações (ex.: gh pr merge) precisam do PATH atualizado
    this.file = file;
    this.wf = loadWorkflow(file);
    this.mock = !!mock;
    this.runId = newRunId();
    this.runDir = path.join(runsDir, this.runId);
    this.inputs = this.resolveInputs(inputs || {});
    this.ctx = { inputs: this.inputs, steps: {}, loop: { iteration: 0 }, run_id: this.runId };
    for (const s of this.wf.steps) this.ctx.steps[s.id] = { output: null, visits: 0 };

    this.sessions = new Map();      // id local -> sessão
    this.agentSessions = new Map(); // agente persistente -> id local
    this.counters = {};
    this.loops = {};
    this.approvals = new Map();
    this.abort = new AbortController();
    this.seq = 0;
    this.nSession = 0;
    this.nApproval = 0;
    this.status = 'pending';
  }

  resolveInputs(given) {
    const out = {};
    for (const [k, def] of Object.entries(this.wf.inputs || {})) {
      let v = given[k];
      if (v === undefined || v === '') v = def.default;
      if (def.required && (v === undefined || v === '')) throw new Error(`Input obrigatório não informado: ${k}`);
      if (def.enum && v !== undefined && !def.enum.includes(v)) throw new Error(`Input "${k}" deve ser um de ${def.enum.join(', ')}`);
      out[k] = v;
    }
    return out;
  }

  emitEvent(type, data = {}) {
    const ev = { seq: ++this.seq, ts: new Date().toISOString(), run_id: this.runId, type, ...data };
    this.emit('event', ev);
    return ev;
  }

  // ---- sessões -------------------------------------------------------------
  openSession({ agent, provider, model, parentId, stepId }) {
    const s = {
      id: agent === 'orchestrator' ? 'orchestrator' : `s${++this.nSession}`,
      agent, provider, model, parentId, stepId,
      openedAt: Date.now(), closedAt: null,
      turns: 0, activeMs: 0, tokens: emptyUsage(), costUsd: 0,
      status: 'idle', providerSessionId: null,
    };
    this.sessions.set(s.id, s);
    this.emitEvent('session.opened', { session_id: s.id, session: this.snapshot(s) });
    return s;
  }

  setStatus(s, status) {
    s.status = status;
    this.emitEvent('session.status', { session_id: s.id, status });
  }

  closeSession(s, status) {
    if (s.closedAt) return;
    s.closedAt = Date.now();
    s.status = status;
    this.emitEvent('session.closed', { session_id: s.id, status, session: this.snapshot(s) });
  }

  snapshot(s) {
    const duration = (s.closedAt || Date.now()) - s.openedAt;
    return {
      id: s.id, agent: s.agent, provider: s.provider, model: s.model,
      parent_id: s.parentId, step_id: s.stepId,
      opened_at: new Date(s.openedAt).toISOString(),
      closed_at: s.closedAt ? new Date(s.closedAt).toISOString() : null,
      duration_ms: duration, active_ms: s.activeMs, idle_ms: Math.max(0, duration - s.activeMs),
      turns: s.turns, tokens: { ...s.tokens }, cost_usd: +s.costUsd.toFixed(6),
      status: s.status, provider_session_id: s.providerSessionId,
    };
  }

  // ---- execução ------------------------------------------------------------
  stepById(id) {
    const s = this.wf.steps.find((x) => x.id === id);
    if (!s) throw new Error(`Step inexistente: ${id}`);
    return s;
  }

  async start() {
    this.startedAt = Date.now();
    this.status = 'running';
    this.emitEvent('workflow.started', {
      workflow: this.wf.metadata?.name, version: this.wf.metadata?.version,
      file: path.basename(this.file), inputs: this.inputs, mock: this.mock, run_dir: this.runDir,
      steps: this.wf.steps.map((s) => ({ id: s.id, type: s.type || 'agent', agent: s.agent || null })),
    });
    this.orchestrator = this.openSession({
      agent: 'orchestrator', provider: 'engine', model: 'engine (determinístico)', parentId: null, stepId: null,
    });
    this.setStatus(this.orchestrator, 'active');

    let current = this.wf.steps[0].id;
    let guard = 0;
    try {
      while (current !== 'end') {
        if (current === 'fail') throw new Error('Workflow encaminhado para "fail" (limite de tentativas atingido).');
        if (++guard > 500) throw new Error('Limite de 500 transições atingido.');
        if (this.abort.signal.aborted) throw new Error('Cancelado');
        this.checkLimits();
        current = await this.runStep(this.stepById(current));
      }
      this.finish('success');
    } catch (e) {
      this.finish(this.abort.signal.aborted ? 'cancelled' : 'failed', e);
    }
  }

  stop() {
    this.abort.abort();
    for (const a of this.approvals.values()) a.reject(new Error('Cancelado'));
  }

  checkLimits() {
    const lim = this.wf.orchestrator?.limits || {};
    const maxDur = parseDuration(lim.max_total_duration, null);
    if (maxDur && Date.now() - this.startedAt > maxDur) {
      this.emitEvent('limit.exceeded', { limit: 'max_total_duration', value: lim.max_total_duration });
      throw new Error(`Duração máxima excedida (${lim.max_total_duration}).`);
    }
    const cost = [...this.sessions.values()].reduce((a, s) => a + s.costUsd, 0);
    if (lim.max_total_cost_usd && cost > lim.max_total_cost_usd) {
      this.emitEvent('limit.exceeded', { limit: 'max_total_cost_usd', value: lim.max_total_cost_usd, current: cost });
      throw new Error(`Custo máximo excedido (US$ ${lim.max_total_cost_usd}).`);
    }
  }

  async runStep(step) {
    const st = this.ctx.steps[step.id];
    st.visits++;
    st.firstVisitAt ??= Date.now();
    // iteração do /loop: reinicia sempre que o step é (re)entrado a partir de outro step
    if (this.prevStepId !== step.id) { st.iteration = 0; st.loopStartedAt = Date.now(); }
    st.iteration++;
    this.prevStepId = step.id;
    const t0 = Date.now();
    this.emitEvent('step.started', { step_id: step.id, visit: st.visits, iteration: st.iteration, step_type: step.type || 'agent', agent: step.agent || null });

    let output, scope;
    if (step.type === 'human_approval') {
      const answer = await this.requestApproval(step);
      if (step.choices) {
        output = { choice: answer };
        scope = { ...this.ctx, output, choice: answer };
      } else {
        output = { approved: answer };
        scope = { ...this.ctx, output, approved: answer, rejected: !answer };
      }
      st.output = output;
    } else {
      output = await this.runAgentStep(step, st);
      st.output = output;
      scope = { ...this.ctx, output, iteration: st.iteration };
    }
    this.emitEvent('step.finished', { step_id: step.id, visit: st.visits, iteration: st.iteration, output, duration_ms: Date.now() - t0 });

    if (step.goal) {
      const met = evalExpr(step.goal.until, scope);
      this.emitEvent('step.goal', { step_id: step.id, goal: render(step.goal.description, scope), met, iteration: st.iteration });
    }

    if (!step.transitions?.length) {
      const i = this.wf.steps.indexOf(step);
      const next = this.wf.steps[i + 1]?.id || 'end';
      this.emitEvent('step.transition', { from: step.id, to: next, when: '(sequencial)' });
      return next;
    }

    for (const t of step.transitions) {
      if (!evalExpr(t.when, scope)) continue;
      if (t.action) await this.runAction(render(t.action, scope));
      let delegated = null;
      if (t.delegate) {
        this.emitEvent('log', { level: 'info', message: `${step.id} delegou para ${t.delegate.agent}` });
        const res = await this.sendToAgent(t.delegate.agent, render(t.delegate.prompt, scope), { stepId: `${step.id}:delegate` });
        delegated = { agent: t.delegate.agent, text: res.text };
      }
      let target = this.applyCounters(step, t);
      if (target === step.id && isLooping(step)) target = await this.loopWait(step);
      // o resultado da delegação vai para o próximo step (ex.: babysitter responde no PR com o hash)
      if (delegated && this.ctx.steps[target]) this.ctx.steps[target].delegate_result = delegated;
      this.emitEvent('step.transition', { from: step.id, to: target, when: t.when });
      return target;
    }
    throw new Error(`Nenhuma transição satisfeita no step "${step.id}".`);
  }

  applyCounters(step, t) {
    let target = t.goto;
    if (t.max_visits) {
      const key = `${step.id}->${t.goto}`;
      this.counters[key] = (this.counters[key] || 0) + 1;
      if (this.counters[key] > t.max_visits) {
        target = t.on_exhausted || 'fail';
        this.emitEvent('log', { level: 'warn', message: `max_visits (${t.max_visits}) atingido em ${key} → ${target}` });
      }
    }
    if (t.loop) {
      const name = t.loop.name || `${step.id}->${t.goto}`;
      this.loops[name] = (this.loops[name] || 0) + 1;
      if (this.loops[name] > t.loop.max_iterations) {
        target = t.loop.on_exhausted || 'fail';
        this.emitEvent('log', { level: 'warn', message: `loop "${name}" atingiu ${t.loop.max_iterations} iterações → ${target}` });
      } else {
        this.ctx.loop = { name, iteration: this.loops[name] };
      }
    }
    return target;
  }

  async loopWait(step) {
    const st = this.ctx.steps[step.id];
    const cfg = loopConfig(step);
    const maxDur = parseDuration(cfg.max_duration, null);
    if (maxDur && Date.now() - st.loopStartedAt > maxDur) {
      const target = step.goal?.on_exhausted || cfg.on_exhausted || 'fail';
      this.emitEvent('log', { level: 'warn', message: `/loop de ${step.id} excedeu ${cfg.max_duration} sem atingir o /goal → ${target}` });
      return target;
    }
    const interval = Math.min(parseDuration(cfg.interval, 60000), this.mock ? 3000 : Infinity);
    this.emitEvent('step.waiting', { step_id: step.id, until: new Date(Date.now() + interval).toISOString(), interval_ms: interval });
    this.setStatus(this.orchestrator, 'waiting');
    await sleep(interval, this.abort.signal);
    this.setStatus(this.orchestrator, 'active');
    return step.id;
  }

  async runAgentStep(step, st) {
    const visit = st.visits;
    const schema = step.output_schema;
    let prompt = render(step.prompt, { ...this.ctx, iteration: st.iteration, delegate_result: st.delegate_result }).trim();
    st.delegate_result = null; // consumido
    const extra = goalLoopInstructions(step, st, this.ctx);
    if (extra) prompt += '\n\n---\n' + extra;
    if (schema) {
      prompt += '\n\n---\nAo final da sua resposta, inclua OBRIGATORIAMENTE um bloco ```json com um objeto que valide contra este JSON Schema:\n```json\n'
        + JSON.stringify(schema, null, 2) + '\n```';
    }
    const hint = { stepId: step.id, visit, schema };
    let res = await this.sendToAgent(step.agent, prompt, { stepId: step.id, hint });
    if (!schema) return { text: res.text };

    for (let attempt = 0; ; attempt++) {
      let errs;
      try {
        const out = extractJson(res.text);
        errs = validateSchema(out, schema);
        if (!errs.length) return out;
      } catch (e) {
        errs = [e.message];
      }
      this.emitEvent('log', { level: 'warn', message: `Saída inválida em ${step.id}: ${errs.join('; ')}` });
      if (attempt >= 2) throw new Error(`Saída do step "${step.id}" não validou: ${errs.join('; ')}`);
      res = await this.sendToAgent(step.agent,
        `Sua última resposta não validou contra o schema:\n- ${errs.join('\n- ')}\nResponda novamente apenas com o bloco \`\`\`json corrigido.`,
        { stepId: step.id, hint });
    }
  }

  async sendToAgent(agentName, prompt, { stepId, hint } = {}) {
    const def = this.wf.agents[agentName];
    if (!def) throw new Error(`Agente inexistente: ${agentName}`);
    const agent = { ...(this.wf.defaults || {}), ...def };
    const persistent = agent.session !== 'ephemeral';

    let session = persistent ? this.sessions.get(this.agentSessions.get(agentName)) : null;
    if (!session) {
      session = this.openSession({
        agent: agentName, provider: this.mock ? 'mock' : agent.provider, model: agent.model,
        parentId: this.orchestrator.id, stepId,
      });
      if (persistent) this.agentSessions.set(agentName, session.id);
    }

    const turn = ++session.turns;
    let fullPrompt = prompt;
    if (turn === 1 && agent.system_prompt) {
      fullPrompt = `<system>\n${render(agent.system_prompt, this.ctx).trim()}\n</system>\n\n${prompt}`;
    }
    this.emitEvent('session.message_sent', { session_id: session.id, turn, step_id: stepId, prompt: fullPrompt });

    const provider = this.mock ? { type: 'mock' } : this.wf.providers?.[agent.provider];
    if (!provider) throw new Error(`Provider "${agent.provider}" não definido.`);

    const retry = agent.retry || {};
    const maxAttempts = retry.max_attempts || 1;
    let delay = this.mock ? 1000 : parseDuration(retry.initial_delay, 5000);
    let lastErr;

    for (let a = 1; a <= maxAttempts; a++) {
      const t0 = Date.now();
      this.setStatus(session, 'active');
      try {
        const res = await runTurn({
          provider, model: agent.model, providerSessionId: session.providerSessionId,
          prompt: fullPrompt, cwd: render(agent.working_dir, this.ctx) || process.cwd(),
          extraArgs: agent.cli_args || [], timeoutMs: parseDuration(agent.timeout, 30 * 60e3),
          signal: this.abort.signal, hint, render,
          onItem: (item) => this.emitEvent('session.stream', { session_id: session.id, turn, item }),
        });
        const dur = Date.now() - t0;
        session.activeMs += dur;
        if (res.providerSessionId) session.providerSessionId = res.providerSessionId;
        addUsage(session.tokens, res.usage);
        session.costUsd += res.costUsd || 0;
        session.status = 'idle';
        this.emitEvent('session.message_received', {
          session_id: session.id, turn, step_id: stepId, text: res.text, usage: res.usage,
          cost_usd: res.costUsd, duration_ms: dur, session: this.snapshot(session),
        });
        if (!persistent) this.closeSession(session, 'success');
        return res;
      } catch (e) {
        session.activeMs += Date.now() - t0;
        lastErr = e;
        if (this.abort.signal.aborted) break;
        this.emitEvent('log', { level: 'error', message: `[${agentName}] tentativa ${a}/${maxAttempts} falhou: ${e.message}` });
        if (!isRetryable(e)) {
          this.emitEvent('log', { level: 'error', message: `[${agentName}] erro não recuperável, sem novas tentativas.` });
          break;
        }
        if (a < maxAttempts) {
          this.setStatus(session, 'retrying');
          await sleep(delay, this.abort.signal);
          if (retry.backoff === 'exponential') delay *= 2;
        }
      }
    }
    if (persistent) this.setStatus(session, 'error');
    else this.closeSession(session, 'failed');
    throw lastErr;
  }

  requestApproval(step) {
    const id = `a${++this.nApproval}`;
    const message = render(step.message, this.ctx).trim();
    const choices = step.choices ? step.choices.map((c) => ({ id: c.id, label: render(c.label, this.ctx) })) : null;
    this.emitEvent('approval.requested', { approval_id: id, step_id: step.id, message, choices });
    this.setStatus(this.orchestrator, 'waiting');
    const timeout = parseDuration(step.timeout, null);

    return new Promise((resolve, reject) => {
      const onTimeout = step.choices ? step.choices[step.choices.length - 1].id : false;
      const timer = timeout ? setTimeout(() => this.resolveApproval(id, onTimeout, 'timeout'), timeout) : null;
      this.approvals.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  // answer: boolean (aprovar/rejeitar) ou o id de uma das choices do step
  resolveApproval(id, answer, by = 'user') {
    const a = this.approvals.get(id);
    if (!a) return false;
    this.approvals.delete(id);
    const data = typeof answer === 'boolean' ? { approved: answer } : { choice: answer };
    this.emitEvent('approval.resolved', { approval_id: id, ...data, by });
    this.setStatus(this.orchestrator, 'active');
    a.resolve(answer);
    return true;
  }

  runAction(cmd) {
    if (this.mock) {
      this.emitEvent('action.executed', { command: cmd, skipped: true, output: '[mock] ação não executada' });
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      exec(cmd, { cwd: this.inputs.repo_path || process.cwd(), windowsHide: true, env: process.env }, (err, stdout, stderr) => {
        const exitCode = err ? err.code ?? 1 : 0;
        this.emitEvent('action.executed', { command: cmd, exit_code: exitCode, output: `${stdout}${stderr}`.slice(-4000) });
        if (exitCode) reject(new Error(`Ação falhou (exit ${exitCode}): ${cmd}
${stderr || stdout}`.slice(0, 1500)));
        else resolve();
      });
    });
  }

  finish(status, err) {
    this.status = status;
    for (const a of this.approvals.values()) a.reject(new Error('Encerrado'));
    this.approvals.clear();
    for (const s of this.sessions.values()) {
      // o status da sessão reflete a própria sessão, não o desfecho do workflow
      if (!s.closedAt) this.closeSession(s, s.status === 'error' ? 'failed' : status === 'cancelled' ? 'cancelled' : s.id === 'orchestrator' ? status : 'success');
    }
    const sessions = [...this.sessions.values()].map((s) => this.snapshot(s));
    const tokens = emptyUsage();
    sessions.forEach((s) => addUsage(tokens, s.tokens));
    this.emitEvent('workflow.finished', {
      status, error: err?.message || null,
      summary: {
        run_id: this.runId, workflow: this.wf.metadata?.name, status,
        started_at: new Date(this.startedAt).toISOString(), finished_at: new Date().toISOString(),
        duration_ms: Date.now() - this.startedAt, inputs: this.inputs, mock: this.mock,
        tokens, cost_usd: +sessions.reduce((a, s) => a + s.cost_usd, 0).toFixed(6),
        steps: Object.fromEntries(Object.entries(this.ctx.steps).map(([k, v]) => [k, { visits: v.visits, output: v.output }])),
        sessions,
      },
    });
  }
}

module.exports = { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr };
