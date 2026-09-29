// Any workflow run as a chat, rebuilt from its events (live run:event, or a past run's
// events.jsonl): one message per agent turn, the orchestrator's transitions and loops as system
// lines, human gates with their answers, the supervisor's interventions, and fan-out steps
// (`agents: [...]`) grouped. No DOM here: run-chat.js renders it, a test feeds it engine events.
// Browser: window.RunChatModel; Node: module.exports.
(function (root) {
  // A session's provider is the workflow's provider key (claude, codex, grok) or its type; in a
  // simulation it is "mock", so the model name tells which CLI it stands for.
  const PROVIDER_TYPES = { claude: 'claude-code', codex: 'codex-cli', grok: 'grok-cli', gemini: 'gemini-cli' };
  const MODEL_TYPES = [[/^claude-/, 'claude-code'], [/^(gpt-|o\d)/, 'codex-cli'], [/^grok-/, 'grok-cli'], [/^gemini-/, 'gemini-cli']];
  function providerType(provider, model = '') {
    if (PROVIDER_TYPES[provider]) return PROVIDER_TYPES[provider];
    if (Object.values(PROVIDER_TYPES).includes(provider)) return provider;
    return MODEL_TYPES.find(([re]) => re.test(model || ''))?.[1] || provider || '';
  }
  const baseStep = (id) => String(id || '').split(':')[0];
  const subStep = (id) => String(id || '').split(':')[1] || null;
  const MAX_ACTIVITY = 200; // per turn
  const MAX_TEXT = 4000; // per activity entry

  // Removes the last ```<lang> fenced block from a text: [text without it, block content | null].
  function takeBlock(text, lang) {
    const open = `\`\`\`${lang}`;
    const i = text.lastIndexOf(open);
    if (i < 0 || !/^\s*\n/.test(text.slice(i + open.length))) return [text, null];
    const rest = text.slice(i + open.length);
    const end = rest.indexOf('```');
    if (end < 0) return [text, null];
    return [text.slice(0, i) + rest.slice(end + 3), rest.slice(0, end).trim()];
  }

  // An agent's answer: the prose, the structured output (```json, the step's schema) and the
  // decision log (```decisions), shown collapsed.
  function splitAnswer(text) {
    let prose = String(text || '');
    let json, decisions;
    [prose, json] = takeBlock(prose, 'json');
    [prose, decisions] = takeBlock(prose, 'decisions');
    return { prose: prose.trim(), json, decisions };
  }

  const clip = (s, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const brief = (v) => clip(typeof v === 'string' ? v : JSON.stringify(v ?? ''), 600);

  class RunChatModel {
    constructor() {
      this.items = [];
      this.byId = new Map();
      this.run = { id: null, workflow: '', status: null, cost: 0 };
      this.seq = 0;
      this.n = 0;
      this.sessions = new Map(); // session id → { agent, provider, model }
      this.turns = new Map(); // `${session}:${turn}` → { stepId, activity }
      this.active = new Map(); // who is working now: key → { agent, provider, model, stepId, state, supervisor? }
      this.visits = {}; // step id → visits so far
      this.groups = new Map(); // fan-out step running → its group item
      this.gates = new Map(); // approval id → gate item
      this.touched = [];
    }

    add(item) {
      item.id = `i${++this.n}`;
      this.items.push(item);
      this.byId.set(item.id, item);
      this.touched.push(item.id);
      return item;
    }

    touch(item) {
      if (!this.touched.includes(item.id)) this.touched.push(item.id);
    }

    system(ev, level, text) {
      return this.add({ kind: 'system', level, text, ts: ev.ts });
    }

    // Gates still waiting for an answer.
    pendingGates() {
      return [...this.gates.values()].filter((g) => !g.resolved && !g.closed);
    }

    // Applies one event; returns the ids of the items it added or changed (in order).
    apply(ev) {
      this.touched = [];
      if (ev.seq) {
        if (ev.seq <= this.seq) return []; // already applied (replay + live overlap)
        this.seq = ev.seq;
      }
      const fn = HANDLERS[ev.type];
      if (fn) fn.call(this, ev);
      return this.touched;
    }
  }

  const HANDLERS = {
    'workflow.started'(ev) {
      Object.assign(this.run, {
        id: ev.run_id, workflow: ev.workflow || ev.file || 'workflow', version: ev.version, mock: !!ev.mock,
        runDir: ev.run_dir, status: 'running', startedAt: ev.ts, issue: ev.issue || null,
      });
      const inputs = ev.inputs || {};
      this.add({
        kind: 'start', ts: ev.ts, workflow: this.run.workflow, version: ev.version, mock: !!ev.mock,
        task: String(inputs.task || '').trim(), inputs, issue: ev.issue || null, resumedFrom: ev.resumed_from || null,
      });
    },

    'session.opened'(ev) {
      const s = ev.session || {};
      this.sessions.set(ev.session_id, { agent: s.agent, provider: s.provider, model: s.model });
    },

    'session.message_sent'(ev) {
      const s = this.sessions.get(ev.session_id) || {};
      this.turns.set(`${ev.session_id}:${ev.turn}`, { stepId: ev.step_id, activity: [] });
      if (s.agent === 'orchestrator' || subStep(ev.step_id) === 'supervisor') return;
      this.active.set(ev.session_id, { ...s, stepId: baseStep(ev.step_id), state: 'thinking' });
    },

    // Tool calls and thinking are kept per turn (shown collapsed under the answer); they also
    // say what the agent is doing right now.
    'session.stream'(ev) {
      const item = ev.item || {};
      const a = this.active.get(ev.session_id);
      const st = { thinking: 'thinking', text: 'writing', tool_call: 'reading' }[item.kind];
      if (a && st) a.state = st;
      const t = this.turns.get(`${ev.session_id}:${ev.turn}`);
      if (!t || t.activity.length >= MAX_ACTIVITY) return;
      const last = t.activity.at(-1);
      if (item.kind === 'thinking' && item.text) {
        // streamed reasoning arrives in pieces
        if (last?.kind === 'thinking') last.text = clip(last.text + item.text);
        else t.activity.push({ kind: 'thinking', text: clip(String(item.text)) });
      } else if (item.kind === 'tool_call') {
        t.activity.push({ kind: 'tool', name: item.name || 'tool', input: brief(item.input) });
      } else if (item.kind === 'tool_result' && item.is_error && last?.kind === 'tool') {
        last.error = true;
      }
    },

    'session.message_received'(ev) {
      const s = { ...this.sessions.get(ev.session_id), ...(ev.session ? { agent: ev.session.agent, provider: ev.session.provider, model: ev.session.model } : {}) };
      this.sessions.set(ev.session_id, s);
      this.active.delete(ev.session_id);
      this.run.cost += ev.cost_usd || 0;
      const t = this.turns.get(`${ev.session_id}:${ev.turn}`) || { activity: [] };
      this.turns.delete(`${ev.session_id}:${ev.turn}`);
      const stepId = baseStep(ev.step_id);
      const sub = subStep(ev.step_id);
      if (sub === 'supervisor') return; // its decision is shown instead
      const u = ev.usage || {};
      const group = !sub ? this.groups.get(stepId) : null;
      this.add({
        kind: 'turn', ts: ev.ts, sessionId: ev.session_id, turn: ev.turn, agent: s.agent || '?', provider: s.provider,
        model: s.model || '', stepId, sub, visit: this.visits[stepId] || 1, text: String(ev.text || ''), activity: t.activity,
        tokensIn: (u.input || 0) + (u.cache_read || 0) + (u.cache_write || 0), tokensOut: u.output || 0,
        cost: ev.cost_usd || 0, durationMs: ev.duration_ms || 0, parent: group?.id,
        // the engine takes the ```handoff block out of the answer; context = { start, peak } tokens
        handoff: ev.handoff || null, context: ev.context || null, fresh: ev.turn === 1,
      });
    },

    'session.closed'(ev) {
      this.active.delete(ev.session_id);
    },

    'step.started'(ev) {
      this.visits[ev.step_id] = ev.visit || 1;
      const agents = String(ev.agent || '').split(' · ').filter(Boolean);
      if (agents.length > 1) {
        this.groups.set(ev.step_id, this.add({ kind: 'group', ts: ev.ts, stepId: ev.step_id, visit: ev.visit || 1, agents, done: false }));
      }
    },

    'step.finished'(ev) {
      const group = this.groups.get(ev.step_id);
      if (group) {
        this.groups.delete(ev.step_id);
        Object.assign(group, { done: true, failed: (ev.output?.failed || []).map((f) => f.agent), error: !!ev.error });
        this.touch(group);
      }
      if (ev.error) this.add({ kind: 'fail', ts: ev.ts, stepId: ev.step_id, text: String(ev.output?.error || 'unknown error') });
    },

    'step.transition'(ev) {
      if (ev.to === 'end') {
        this.system(ev, ev.status && ev.status !== 'success' ? 'warn' : 'transition', `${ev.from} → end${ev.status ? ` (${ev.status})` : ''}${ev.when && ev.when !== '(sequential)' ? ` · ${ev.when}` : ''}`);
        return;
      }
      // going back to a step that already ran is a loop (a fix round, a retry...)
      const back = (this.visits[ev.to] || 0) > 0;
      const when = ev.when && ev.when !== '(sequential)' ? ev.when : '';
      this.system(ev, back ? 'loop' : when ? 'transition' : 'plain', `${back ? '↺ ' : ''}${ev.from} → ${ev.to}${when ? ` · ${when}` : ''}`);
    },

    'step.waiting'(ev) {
      const s = Math.round((ev.interval_ms || 0) / 1000);
      this.system(ev, 'loop', `/loop: ${ev.step_id} checks again in ${s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`}`);
    },

    // `wait:` the engine checked the PR/MR or CI run itself, without an agent turn
    'step.probe'(ev) {
      const then = { poll: 'no agent turn', output: 'step finished by the orchestrator', agent: `calling ${ev.step_id}'s agent` }[ev.action] || ev.action;
      this.system(ev, ev.action === 'agent' ? 'transition' : 'loop', `Orchestrator check (${ev.probe}) on ${ev.step_id}: ${clip(String(ev.detail || ev.state), 200)} · ${then}`);
    },

    'step.goal'(ev) {
      this.system(ev, ev.met ? 'transition' : 'loop', `/goal ${ev.met ? 'met' : 'not met yet'}: ${ev.goal} (iteration ${ev.iteration})`);
    },

    'approval.requested'(ev) {
      const gate = this.add({
        kind: 'gate', ts: ev.ts, approvalId: ev.approval_id, stepId: ev.step_id, message: String(ev.message || ''),
        choices: ev.choices || [{ id: true, label: 'Approve' }, { id: false, label: 'Reject' }], feedback: ev.feedback || null,
        resolved: null, closed: false,
      });
      this.gates.set(ev.approval_id, gate);
    },

    'approval.resolved'(ev) {
      const gate = this.gates.get(ev.approval_id);
      const choice = String(ev.choice ?? ev.approved);
      const label = gate?.choices.find((c) => String(c.id) === choice)?.label || choice;
      if (gate) {
        gate.resolved = { choice, label };
        this.touch(gate);
      }
      this.add({ kind: 'reply', ts: ev.ts, stepId: gate?.stepId || ev.step_id, label, feedback: ev.feedback || '', by: ev.by || 'user' });
    },

    'supervisor.started'(ev) {
      this.active.set(`supervisor:${ev.step_id}`, { agent: 'supervisor', supervisor: true, stepId: ev.step_id, state: 'reading' });
      this.system(ev, 'supervisor', `Supervisor called on ${ev.step_id}: ${clip(String(ev.error || 'step failed'), 200)}`);
    },

    'supervisor.decision'(ev) {
      this.active.delete(`supervisor:${ev.step_id}`);
      this.add({
        kind: 'supervisor', ts: ev.ts, stepId: ev.step_id, action: ev.action, goto: ev.goto || null,
        explanation: String(ev.explanation || ''), instruction: String(ev.instruction || ''), causeClass: ev.cause_class || null,
      });
    },

    'action.executed'(ev) {
      this.system(ev, ev.exit_code && !ev.skipped ? 'warn' : 'plain', `$ ${ev.command} ${ev.skipped ? '(not executed: simulation)' : `→ exit ${ev.exit_code}`}`);
    },

    log(ev) {
      if (ev.level === 'warn' || ev.level === 'error') this.system(ev, ev.level, clip(String(ev.message || ''), 400));
      // a persistent conversation that outgrew max_context: the agent's next turn starts fresh from its note
      else if (ev.kind === 'context_rotation') this.system(ev, 'plain', clip(String(ev.message || ''), 400));
    },

    'limit.exceeded'(ev) { this.system(ev, 'error', `Limit exceeded: ${ev.limit}`); },

    'budget.exceeded'(ev) {
      this.system(ev, ev.blocked ? 'error' : 'warn', `${ev.provider} reached its monthly budget${ev.blocked ? ': turn blocked' : ' (not blocking)'}`);
    },

    'workflow.finished'(ev) {
      const s = ev.summary || {};
      Object.assign(this.run, { status: ev.status, error: ev.error || null });
      this.active.clear();
      for (const g of this.pendingGates()) { g.closed = true; this.touch(g); }
      // a fan-out that threw (too few agents answered) gets no step.finished
      for (const group of this.groups.values()) { Object.assign(group, { done: true, error: ev.status !== 'success' }); this.touch(group); }
      this.groups.clear();
      this.add({ kind: 'end', ts: ev.ts, status: ev.status, error: String(ev.error || ''), cost: s.cost_usd ?? this.run.cost, durationMs: s.duration_ms || 0 });
    },
  };

  const api = { RunChatModel, splitAnswer, providerType };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunChatModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
