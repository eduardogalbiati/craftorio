// A run's progress by step groups (the workflow's optional `groups:`), for the runs list and the
// Run screen's sidebar. Two pure parts, no DOM:
// - StepTrail turns run events into a light list of step visits (step, agents with provider and
//   model, status, duration, cost). The engine writes it into summary.json (`progress`); runs
//   without it are rebuilt from events.jsonl (src/runs.js); the UI feeds it live run:event.
// - progressGroups folds a trail into the chips the runs list shows: only the groups visited, in
//   order, a return to a group counted (×N), the last one with the run's state.
// hydrationEvents merges a run's recorded and live events for a window that opened mid-run.
// Browser: window.RunProgress; Node: module.exports.
(function (root) {
  const baseStep = (id) => String(id || '').split(':')[0];
  const subStep = (id) => String(id || '').split(':')[1] || null;

  class StepTrail {
    constructor(steps = []) {
      this.steps = steps; // [{ step, visit, type, status, agents: [{ agent, provider, model, cost, durationMs }], cost, durationMs, ts }]
      this.sessions = new Map(); // session id → { agent, provider, model }
      this.seq = 0;
    }

    // The latest visit of a step.
    visitOf(stepId) {
      for (let i = this.steps.length - 1; i >= 0; i--) if (this.steps[i].step === stepId) return this.steps[i];
      return null;
    }

    agentIn(entry, s) {
      let a = entry.agents.find((x) => x.agent === s.agent);
      if (!a) entry.agents.push(a = { agent: s.agent, provider: null, model: null, cost: 0, durationMs: 0 });
      if (s.provider) a.provider = s.provider;
      if (s.model) a.model = s.model;
      return a;
    }

    // Applies one event; returns true when the trail changed.
    apply(ev) {
      if (ev.seq) {
        if (ev.seq <= this.seq) return false; // already applied (replay + live overlap)
        this.seq = ev.seq;
      }
      const fn = HANDLERS[ev.type];
      return fn ? fn.call(this, ev) !== false : false;
    }
  }

  const HANDLERS = {
    'session.opened'(ev) {
      const s = ev.session || {};
      this.sessions.set(ev.session_id, { agent: s.agent, provider: s.provider, model: s.model });
      return false;
    },

    'step.started'(ev) {
      const human = ev.step_type === 'human_approval';
      this.steps.push({
        step: ev.step_id, visit: ev.visit || 1, type: ev.step_type || 'agent', status: 'running', ts: ev.ts || null, cost: 0, durationMs: 0,
        agents: human ? [] : String(ev.agent || '').split(' · ').filter(Boolean).map((agent) => ({ agent, provider: null, model: null, cost: 0, durationMs: 0 })),
      });
    },

    // who works in a step (provider, model), including agents it delegates to
    'session.message_sent'(ev) {
      const s = this.sessions.get(ev.session_id);
      const entry = this.visitOf(baseStep(ev.step_id));
      if (!s || !entry || s.agent === 'orchestrator' || subStep(ev.step_id) === 'supervisor' || entry.type === 'human_approval') return false;
      this.agentIn(entry, s);
    },

    'session.message_received'(ev) {
      const s = { ...this.sessions.get(ev.session_id), ...(ev.session ? { agent: ev.session.agent, provider: ev.session.provider, model: ev.session.model } : {}) };
      const entry = this.visitOf(baseStep(ev.step_id));
      if (!s.agent || !entry || s.agent === 'orchestrator' || subStep(ev.step_id) === 'supervisor' || entry.type === 'human_approval') return false;
      const a = this.agentIn(entry, s);
      a.cost += ev.cost_usd || 0;
      a.durationMs += ev.duration_ms || 0;
      entry.cost += ev.cost_usd || 0;
    },

    'approval.requested'(ev) {
      const entry = this.visitOf(ev.step_id);
      if (!entry) return false;
      entry.status = 'waiting';
    },

    'approval.resolved'() {
      const entry = this.steps.at(-1);
      if (entry?.status !== 'waiting') return false;
      entry.status = 'running';
    },

    'step.finished'(ev) {
      const entry = this.visitOf(ev.step_id);
      if (!entry) return false;
      entry.status = ev.error ? 'failed' : 'done';
      entry.durationMs = ev.duration_ms || 0;
    },

    'workflow.finished'(ev) {
      const entry = this.steps.at(-1);
      if (!entry || (entry.status !== 'running' && entry.status !== 'waiting')) return false;
      entry.status = ev.status === 'success' ? 'done' : 'failed';
      if (entry.ts && ev.ts) entry.durationMs = Math.max(0, Date.parse(ev.ts) - Date.parse(entry.ts));
    },
  };

  /** Run events → the trail's steps. */
  function trailOf(events) {
    const t = new StepTrail();
    for (const ev of events) t.apply(ev);
    return t.steps;
  }

  // The chip of a run's last visited group says how the run stands there.
  const END_STATES = { success: 'done', failed: 'failed', cancelled: 'stopped', interrupted: 'stopped' };

  /**
   * Trail steps + the workflow's groups → the chips of the runs list:
   * [{ key, name, grouped, round, status, current, steps: [trail entries], agents: [{ agent, provider,
   *   model, human, steps, cost, durationMs }], cost, durationMs }]
   * `round` counts the times the run entered the group (a loop back shows "Develop ×2"); steps in
   * no group are chips of their own, named after the step. `status` is done for every chip but the
   * last, which takes the run's state: running, waiting (a human gate), done, failed or stopped.
   */
  function progressGroups(steps, groups, runStatus) {
    const groupOf = new Map();
    for (const g of groups || []) for (const s of g.steps || []) groupOf.set(s, g.name);
    const chips = [];
    const rounds = new Map();
    for (const e of steps || []) {
      const name = groupOf.get(e.step);
      const key = name != null ? `group:${name}` : `step:${e.step}`;
      let chip = chips.at(-1);
      if (chip?.key !== key) {
        rounds.set(key, (rounds.get(key) || 0) + 1);
        chip = { key, name: name ?? e.step, grouped: name != null, round: rounds.get(key), status: 'done', current: null, steps: [], agents: [], cost: 0, durationMs: 0 };
        chips.push(chip);
      }
      chip.steps.push(e);
      chip.cost += e.cost || 0;
      chip.durationMs += e.durationMs || 0;
      const who = e.type === 'human_approval' ? [{ agent: 'You', human: true, cost: 0, durationMs: e.durationMs || 0 }] : e.agents || [];
      for (const w of who) {
        let a = chip.agents.find((x) => x.agent === w.agent && !!x.human === !!w.human);
        if (!a) chip.agents.push(a = { agent: w.agent, provider: w.provider || null, model: w.model || null, human: !!w.human, steps: [], cost: 0, durationMs: 0 });
        if (w.provider) a.provider = w.provider;
        if (w.model) a.model = w.model;
        if (!a.steps.includes(e.step)) a.steps.push(e.step);
        a.cost += w.cost || 0;
        a.durationMs += w.durationMs || 0;
      }
    }
    const last = chips.at(-1);
    if (last) {
      const e = last.steps.at(-1);
      last.current = e.step;
      if (runStatus === 'running') last.status = e.status === 'waiting' ? 'waiting' : 'running';
      else last.status = END_STATES[runStatus] || (e.status === 'failed' ? 'failed' : 'done');
    }
    return chips;
  }

  // The events that rebuild the view of a run picked up mid-way: the ones recorded on disk (from
  // workflow.started on), then the live ones that came in while the file was read and are not on
  // disk yet: those after the last recorded `seq` (the engine numbers a run's events). Events
  // without a seq (older recordings) are matched by what identifies them (type, time, step,
  // session, turn, gate), not by their content, which the recorder may redact. Nothing recorded
  // from workflow.started: only the live events.
  const eventKey = (e) => [e.type, e.ts, e.step_id, e.session_id, e.turn, e.approval_id].map((x) => x ?? '').join('|');
  function hydrationEvents(recorded = [], live = []) {
    const start = recorded.findIndex((e) => e.type === 'workflow.started');
    if (start < 0) return live.slice();
    const past = recorded.slice(start);
    const lastSeq = past.reduce((m, e) => Math.max(m, e.seq || 0), 0);
    const seen = new Set(past.map(eventKey));
    return past.concat(live.filter((e) => (e.seq && lastSeq ? e.seq > lastSeq : !seen.has(eventKey(e)))));
  }

  const api = { StepTrail, trailOf, progressGroups, hydrationEvents };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunProgress = api;
})(typeof window !== 'undefined' ? window : globalThis);
