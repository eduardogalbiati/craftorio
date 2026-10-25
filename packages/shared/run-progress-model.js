// A run's progress by step groups (the workflow's optional `groups:`), for the runs list and the
// Run screen's sidebar. Two pure parts, no DOM:
// - StepTrail turns run events into a light list of step visits (step, agents with provider and
//   model, status, duration, cost). The engine writes it into summary.json (`progress`); runs
//   without it are rebuilt from events.jsonl (src/domains/run/runs.js); the UI feeds it live run:event.
// - progressGroups folds a trail into the chips the runs list shows: only the groups visited, in
//   order, a return to a group counted (×N), the last one with the run's state.
// hydrationEvents merges a run's recorded and live events for a window that opened mid-run.
// estimateProgress (#194): a run's estimated % along its workflow's steps, weighted by the typical
// time of each step in past runs (typicalStepTimes), for the roadmap card's ring; runClock,
// clockText and timerTone (#272): the card's run timer.
// Browser: window.RunProgress; Node: module.exports.
// Loaded before the renderer's files, like every packages/shared/ module (app.js draws its run lists with it).
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
  const END_STATES = { success: 'done', failed: 'failed', cancelled: 'stopped', interrupted: 'stopped', paused: 'stopped' };

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

  // ---- the fixed stations of a workflow's pipeline (#282: the roadmap card's Workflow band) -----------
  const MODE_GATE = (mode) => new RegExp(`inputs\\.mode\\s*==\\s*['"]${String(mode).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
  /**
   * A workflow's stations, in the order of its steps: one per group (`human`: a group of human gates
   * only), one per step in no group. A human gate in no group is never a station of its own, but the
   * gates the item's `mode` turns on: a human_approval step reached by a transition whose `when`
   * asks for that mode (`inputs.mode == 'validated'`) is a station right after the one that holds it
   * (its group, else the step that leads to it).
   * `steps`: [{ id, type, agent, agents, transitions: [{ goto, when }] }], `groups`: [{ name, steps }]
   * → [{ key, name, grouped, steps: [ids], human?: true, gate?: true, host?: { name, grouped } }]
   */
  function workflowStations({ steps = [], groups = [], mode = null } = {}) {
    const groupOf = new Map();
    for (const g of groups || []) for (const s of g.steps || []) groupOf.set(s, g.name);
    const human = (s) => s.type === 'human_approval';
    const asked = mode == null || mode === '' ? null : MODE_GATE(mode);
    const targets = new Map(); // gate step id → the first step that leads to it in that mode
    if (asked) {
      for (const s of steps) for (const t of s.transitions || []) if (t?.goto && asked.test(String(t.when || '')) && !targets.has(t.goto)) targets.set(t.goto, s.id);
    }
    const gates = steps.filter((s) => human(s) && targets.has(s.id));
    const gateIds = new Set(gates.map((s) => s.id));
    const byKey = new Map();
    const out = [];
    for (const s of steps) {
      if (gateIds.has(s.id)) continue;
      const name = groupOf.get(s.id);
      if (name == null && human(s)) continue;
      const key = name != null ? `group:${name}` : `step:${s.id}`;
      let st = byKey.get(key);
      if (!st) { st = { key, name: name ?? s.id, grouped: name != null, steps: [], work: 0 }; byKey.set(key, st); out.push(st); }
      st.steps.push(s.id);
      if (!human(s)) st.work += 1;
    }
    const stations = out.map(({ work, ...st }) => (work ? st : { ...st, human: true }));
    for (const g of gates) {
      const group = groupOf.get(g.id);
      const hostKey = group != null ? `group:${group}` : byKey.has(`step:${targets.get(g.id)}`) ? `step:${targets.get(g.id)}` : `group:${groupOf.get(targets.get(g.id))}`;
      let at = stations.findIndex((st) => st.key === hostKey);
      if (at < 0) continue;
      const host = stations[at];
      while (stations[at + 1]?.gate) at += 1; // after the gates already placed there
      stations.splice(at + 1, 0, { key: `gate:${g.id}`, name: g.id, grouped: false, steps: [g.id], gate: true, host: { name: host.name, grouped: host.grouped } });
    }
    return stations;
  }

  /**
   * The stations with what a run did at each (its trail): → the stations, each with
   * state: todo (not reached) | gate (a mode's gate not reached) | done | skipped (the run went past
   *   it without entering) | running | waiting | failed | stopped | back (it sent the run back to an
   *   earlier station: `sentBackBy`, estimateProgress's), round (the times the run entered it), current
   *   (the step it is at, on the station it is at), agents (who worked there, as progressGroups').
   * Without a trail every station is todo (a gate: gate).
   */
  function pipeline({ steps = [], groups = [], mode = null, progress = [], status = 'running', sentBackBy = null } = {}) {
    const stations = workflowStations({ steps, groups, mode });
    const idle = (st) => ({ ...st, state: st.gate ? 'gate' : 'todo', round: 0, current: null, agents: [] });
    const chips = progressGroups(progress, stations.map((st) => ({ name: st.key, steps: st.steps })), status);
    const indexOf = (chip) => stations.findIndex((st) => chip.key === `group:${st.key}`);
    const visits = chips.map(indexOf);
    // where the run is: the last station it entered (a step of no station, a human gate, stays on it)
    const at = visits.reduce((a, i) => (i >= 0 ? i : a), -1);
    if (at < 0) return stations.map(idle);
    const now = chips.at(-1).status;
    const over = now === 'done';
    return stations.map((st, i) => {
      const mine = chips.filter((c, k) => visits[k] === i);
      if (!mine.length) return { ...idle(st), ...(i < at || over ? { state: 'skipped' } : {}) };
      const agents = [];
      for (const a of mine.flatMap((c) => c.agents)) {
        const same = agents.find((x) => x.agent === a.agent && !!x.human === !!a.human);
        if (!same) agents.push({ ...a, steps: [...a.steps] });
        else Object.assign(same, { provider: a.provider || same.provider, model: a.model || same.model, steps: [...new Set([...same.steps, ...a.steps])], cost: same.cost + a.cost, durationMs: same.durationMs + a.durationMs });
      }
      const state = i === at ? now : i < at || over ? 'done' : sentBackBy && st.steps.includes(sentBackBy) ? 'back' : st.gate ? 'gate' : 'todo';
      return { ...st, state, round: Math.max(...mine.map((c) => c.round)), current: i === at ? chips.at(-1).current : null, agents };
    });
  }

  // ---- the estimate of a run's progress (#194: the roadmap card's ring) ------------------------------
  /**
   * The typical time of each step in past runs: the median of the finished visits' durations, from
   * runs that succeeded (their `progress` trail). → { times: { stepId: ms }, runs: how many runs }
   */
  function typicalStepTimes(runs = []) {
    const visits = new Map();
    let count = 0;
    for (const r of runs || []) {
      if (r?.status !== 'success' || !r.progress?.length) continue;
      count++;
      for (const e of r.progress) {
        if (e.status !== 'done' || !(e.durationMs > 0)) continue;
        (visits.get(e.step) || visits.set(e.step, []).get(e.step)).push(e.durationMs);
      }
    }
    const times = {};
    for (const [step, list] of visits) {
      list.sort((a, b) => a - b);
      const mid = Math.floor(list.length / 2);
      times[step] = list.length % 2 ? list[mid] : Math.round((list[mid - 1] + list[mid]) / 2);
    }
    return { times, runs: count };
  }

  const STOPPED = new Set(['cancelled', 'interrupted', 'paused']);
  const toMs = (ts) => { const t = Date.parse(ts || ''); return Number.isFinite(t) ? t : null; };

  /**
   * A run's estimated progress: the steps done along the expected path, weighted by each step's
   * typical time when past runs have it (`typical`, typicalStepTimes), else each step counts the same.
   * `path`: the workflow's step ids in order; with history, only the steps past runs went through (or
   * this run did). A return to an earlier step (a review → developer loop) lowers the estimate; it
   * never says more than 99% before the run ends.
   * `keep` (#272, the roadmap card): a return to a step already visited (a fix round) keeps what the
   * run had earned, the furthest step it reached counted as a step in progress at its cap, so the
   * percentage never falls (`leftMs` still counts the steps to redo), and the result says the round.
   * → { percent, state: running | waiting | failed | stopped | done, step, elapsedMs, leftMs (null:
   *   unknown), basis: 'history' | 'steps', done, total }; with `keep` also round (the visit of the
   *   current step: 2 in its first fix round) and sentBackBy (the step the run last went back from
   *   to an earlier one, while round > 1; null when the step was only retried)
   */
  function estimateProgress({ steps = [], path = [], typical = {}, status = 'running', startedAt = null, now = Date.now(), keep = false } = {}) {
    const last = steps.at(-1) || null;
    const state = status === 'success' ? 'done' : status === 'failed' ? 'failed' : STOPPED.has(status) ? 'stopped'
      : last?.status === 'waiting' ? 'waiting' : last?.status === 'failed' ? 'failed' : 'running';
    const start = toMs(startedAt) ?? toMs(steps[0]?.ts) ?? now;
    const elapsedMs = Math.max(0, now - start);
    const visited = new Set(steps.map((e) => e.step));
    const known = Object.values(typical || {}).filter((ms) => ms > 0);
    const basis = known.length ? 'history' : 'steps';
    let route = (path || []).filter((id) => basis === 'steps' || typical[id] > 0 || visited.has(id));
    if (!route.length) route = [...visited];
    const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
    const weight = (id) => (typical?.[id] > 0 ? typical[id] : avg);
    const total = route.reduce((a, id) => a + weight(id), 0) || 1;
    // #272 a fix round: the visit of the current step; the latest visit followed by a step at or
    // before it on the route (`again`: a step run again, a retry of the same step included) and the
    // latest one the run went back from, to an earlier step (`back`: what sent it back)
    const places = steps.map((e) => route.indexOf(e.step));
    const round = last ? steps.filter((e) => e.step === last.step).length : 1;
    const latest = (went) => {
      for (let k = steps.length - 2; k >= 0; k--) if (places[k] >= 0 && places[k + 1] >= 0 && went(places[k + 1], places[k])) return k;
      return -1;
    };
    const again = latest((to, from) => to <= from);
    const back = latest((to, from) => to < from);
    const out = { state, step: last?.step || null, elapsedMs, basis, total: route.length, ...(keep ? { round, sentBackBy: round > 1 && back >= 0 ? steps[back].step : null } : {}) };
    if (state === 'done') return { ...out, percent: 100, leftMs: 0, done: route.length };
    const at = last ? route.indexOf(last.step) : -1;
    // the steps before the current one on the route; a step off the route: the route steps visited
    const before = at >= 0 ? route.slice(0, at) : route.filter((id) => visited.has(id) && id !== last?.step);
    let doneW = before.reduce((a, id) => a + weight(id), 0);
    // a step in progress: its time so far against its typical time (90% at most), half a step without history
    const cap = basis === 'history' ? 0.9 : 0.5;
    if (last && at >= 0 && state === 'running') {
      const inStep = toMs(last.ts) != null ? Math.max(0, now - toMs(last.ts)) : 0;
      doneW += basis === 'history' ? Math.min(inStep, cap * weight(last.step)) : cap * weight(last.step);
    }
    // what the run had earned before it ran a step again
    const far = keep && again >= 0 ? Math.max(...places.slice(0, -1)) : -1;
    const earnedW = far >= 0 ? route.slice(0, far).reduce((a, id) => a + weight(id), 0) + cap * weight(route[far]) : 0;
    const percent = Math.max(0, Math.min(99, Math.floor((100 * Math.max(doneW, earnedW)) / total)));
    const leftMs = basis === 'history' ? Math.max(0, Math.round(total - doneW)) : percent > 0 ? Math.round((elapsedMs * (100 - percent)) / percent) : null;
    return { ...out, percent, leftMs, done: before.length };
  }

  // ---- a run's timer (#272, the roadmap card): its working time against the item's time estimate ----
  const pad2 = (n) => String(n).padStart(2, '0');
  // "23:41", "1:05:12"
  function clockText(ms) {
    const s = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(s / 3600);
    return `${h ? `${h}:${pad2(Math.floor((s % 3600) / 60))}` : Math.floor(s / 60)}:${pad2(s % 60)}`;
  }
  // within the estimate, up to 130% of it, beyond; neutral without an estimate
  function timerTone(ms, minutes) {
    if (!(minutes > 0)) return 'neutral';
    const ratio = ms / (minutes * 60000);
    return ratio < 1 ? 'ok' : ratio <= 1.3 ? 'warn' : 'over';
  }
  /**
   * How long a run has worked, gate waits left out as #215 counts them (a finished human gate's
   * duration, and the time since the gate it waits at started): → { ms, since }, or null when the run
   * has no start. `since`: the instant the timer counts from while it ticks (the run's start moved by
   * its gate waits); null while it is paused at a gate or frozen at the run's end.
   */
  function runClock(run, now = Date.now()) {
    const start = toMs(run.startedAt) ?? toMs(run.progress?.[0]?.ts);
    const active = run.status === 'running' || run.status === 'pending';
    const end = active ? now : toMs(run.finishedAt);
    if (start == null || end == null) return null;
    let gates = 0;
    let paused = false;
    for (const e of run.progress || []) {
      if (e.type !== 'human_approval' && e.status !== 'waiting') continue;
      if (e.status !== 'waiting' && e.status !== 'running') gates += e.durationMs || 0;
      else if (active && toMs(e.ts) != null) { gates += Math.max(0, now - toMs(e.ts)); paused = true; }
    }
    return { ms: Math.max(0, end - start - gates), since: active && !paused ? start + gates : null };
  }

  /**
   * #368: the pause line of the run screen and the roadmap's stage, from a pause record: pausing
   * ({ state: 'pausing', step, agents?, command? }, runs:active) or paused ({ state: 'paused', step,
   * next, at }, a paused run's summary; a stage's has no step: { state: 'paused', at, runs }). '' for none.
   */
  function pauseLabel(pause) {
    if (!pause) return '';
    if (pause.state === 'pausing') {
      const agents = pause.agents || [];
      const what = pause.command ? `${pause.command} to finish`
        : agents.length ? `${agents.join(' and ')} to finish ${agents.length > 1 ? 'their turns' : 'its turn'}` : 'the current step to finish';
      return `Pausing: waiting for ${what}${pause.step ? ` (${pause.step})` : ''}`;
    }
    if (pause.state !== 'paused') return '';
    const at = toMs(pause.at);
    // in the owner's time zone (#273, time-zone.js; in node, the computer's)
    const when = at == null ? '' : ` · ${new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short', timeZone: typeof TimeZone !== 'undefined' ? TimeZone.current() : undefined })}`;
    if (!pause.step) return `Paused after the current step${pause.runs ? ` (${pause.runs} run${pause.runs === 1 ? '' : 's'} paused)` : ''}${when}`;
    return `Paused at ${pause.step}, next: ${pause.next || 'the next step'}'s turn${when}`;
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

  const api = {
    StepTrail,
    clockText,
    estimateProgress,
    hydrationEvents,
    pauseLabel,
    pipeline,
    progressGroups,
    runClock,
    timerTone,
    trailOf,
    typicalStepTimes,
    workflowStations,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunProgress = api;
})(typeof window !== 'undefined' ? window : globalThis);
