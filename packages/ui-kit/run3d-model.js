// The run's 3D view (run3d.js, the overlay; its scene is the run3d/ bundle) as a pure model: the
// engine's raw events in (the recorded ones from runs:events with `activity: true`, then the live
// run:event), the floor and what happens on it out. No DOM and no three.js: the scene and the HUD
// only draw it, a test feeds it events (test/run3d-model.test.js).
// - Run3DModel: one reducer per engine event (the compaction of poc/embed-run.js folded into the
//   replay's reducers of poc/run-3d.html): the steps' status and visits, a robot per agent and desk
//   (thinking, reading, writing, done, waiting, error, sleeping), the supervisor, the gates asked,
//   the cost, the merge, a feed of what happened. A live run has no known end: a visit is open
//   (t1 null) until its step finishes, a turn's cost arrives when it ends.
// - buildLayout: the floor plan, in plain numbers (x right, z towards the viewer): one station per
//   step in the workflow's order on rows, a lane in front of them, the dock of each station on the
//   lane, the supervisor's podium. Human gates get a station when they are on the workflow's main
//   path (`mainGates`, given by the caller) or when the run reaches them.
// - pointAt: a point of the lane by its distance from the start (the cart).
// - dump / restore: the whole state as plain data, so a replay (run3d-replay.js) can keep the state
//   at a step's start and go back to it; `floorOf` gives a replayed moment the floor of the whole run.
// Browser: window.Run3DModel; Node: module.exports.
(function (root) {
  // names as people read them (display-name.js, #245): the YAML's display names when the workflow has them, else the slug made readable
  const displayName = typeof module === 'object' && module.exports ? require('@craftorio/shared/display-name.js').displayName : root.displayName;
  // #735: the steps and agents the run's (resolved) inputs rule out, dimmed on the floor like on the run screen
  const RunPlan = typeof module === 'object' && module.exports ? require('@craftorio/shared/run-plan.js') : root.RunPlan;
  const SessionCost = () => (typeof module === 'object' && module.exports ? require('@craftorio/shared/session-cost') : root.SessionCost);
  function notApplyingOf(steps, inputs) {
    if (!RunPlan || !inputs) return {};
    const declared = Object.fromEntries(Object.keys(inputs).map((k) => [k, {}]));
    const wf = { inputs: declared, steps: steps.map((s) => ({ id: s.id, agent_when: Object.fromEntries(s.agents.map((a) => [a, true])) })) };
    return Object.fromEntries(RunPlan.stepsThatDontApply(wf, inputs).map((x) => [x.id, x.reason]));
  }
  const baseOf = (id) => String(id || '').split(':')[0]; // "develop:context_limit" → "develop"
  const subOf = (id) => String(id || '').split(':')[1] || null;
  const isSupervisor = (agent, stepId) => /^_?supervisor$/.test(agent || '') || subOf(stepId) === 'supervisor';
  const DONE_MS = 5000; // a robot that finished a turn shows `done` this long, then `idle`
  const SUPERVISOR_DONE_MS = 6000;
  const MAX_FEED = 80;
  const STATUS_LABELS = { pending: 'Queued', running: 'Running', done: 'Done', changes: 'Changes requested', failed: 'Failed', waiting: 'Waiting for you', not_run: 'Not run' };
  const WRITES = /^(Edit|MultiEdit|Write|NotebookEdit|file_change|apply_patch)$/;
  // #833: the token kinds of a turn's usage, as Analytics reads them (engine's run-analysis.js TOKEN_KINDS); a missing kind counts 0
  const TOKEN_KINDS = ['input', 'output', 'cache_read', 'cache_write'];
  const tokensOf = (u) => Object.fromEntries(TOKEN_KINDS.map((k) => [k, Number(u?.[k]) || 0]));

  const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  // no machine paths on the floor: a worktree file by its path in the repository, the rest by its name
  const clean = (s) => one(s)
    .replace(/[A-Za-z]:[\\/][^\s"'`]*?[\\/]worktrees[\\/][^\\/\s"'`]+[\\/]?/g, '')
    .replace(/[A-Za-z]:[\\/](?:[^\\/\s"'`]+[\\/])+/g, '')
    .replace(/\\/g, '/');
  const short = (s, n) => { const t = clean(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

  /** How a step ended, from its output: done, failed, changes (a reviewer asked for changes) or not_run. */
  function outcome(o) {
    if (!o || typeof o !== 'object') return 'done';
    if (o.kind === 'suite' || o.kind === 'test_ids') return ['pass', 'not_run'].includes(o.status) ? 'done' : 'failed'; // #71: a project with no tests
    // #404: the rule checks, skipped when the project has none
    if (o.kind === 'check') return o.status === 'fail' ? 'failed' : 'done';
    // #49: a finding, or a gitleaks that failed; a skipped scan is never shown as done
    if (o.kind === 'secret_scan') return o.status === 'pass' ? 'done' : o.status === 'skipped' ? 'not_run' : 'failed';
    if (o.results) return Object.values(o.results).some((r) => r && r.verdict && r.verdict !== 'approved') ? 'changes' : 'done';
    if (o.verdict) return o.verdict === 'not_verified' ? 'failed' : 'done';
    if (o.tests_status) return o.tests_status === 'pass' ? 'done' : 'failed';
    if (o.build_status) return o.build_status === 'success' ? 'done' : 'failed';
    if (o.blocked === true) return 'failed';
    return 'done';
  }

  /** One line about a step's output. */
  function noteOf(o) {
    if (!o || typeof o !== 'object') return one(o);
    if (o.kind === 'suite') {
      if (o.status === 'not_run') return String(o.message || 'not run');
      const counts = o.passed == null && o.failed == null ? `${o.status || 'ran'}${(o.failures || []).length ? `, ${o.failures.length} failure(s)` : ''}` : `${o.passed ?? 0} passed, ${o.failed ?? 0} failed`;
      return `${counts} (${o.scope || 'suite'}): ${o.command || ''}`;
    }
    if (o.kind === 'screenshots') return `${o.taken ?? 0} screenshots of ${o.screens ?? 0} screens`;
    if (o.results) {
      return Object.entries(o.results).filter(([, r]) => r && r.verdict)
        .map(([agent, r]) => `${agent}: ${String(r.verdict).replace(/_/g, ' ')}, ${(r.findings || []).length} finding(s)`).join('; ');
    }
    if (o.error) return String(o.error);
    return o.summary || o.message || o.claim || Object.values(o).find((v) => typeof v === 'string') || '';
  }

  const DETAIL_KEYS = ['description', 'file_path', 'pattern', 'command', 'prompt', 'query'];
  /** What a tool call works on. Recorded events carry the input as a cut JSON string. */
  function toolDetail(input) {
    if (input && typeof input === 'object') {
      const key = DETAIL_KEYS.find((k) => input[k]);
      return key ? String(input[key]) : '';
    }
    const text = String(input || '');
    try { return toolDetail(JSON.parse(text)); } catch { /* cut at 600 characters: read the fields one by one */ }
    for (const k of DETAIL_KEYS) {
      const m = new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(text);
      if (m) return m[1].replace(/\\(.)/g, '$1');
    }
    return text;
  }

  // ---------------------------------------------------------------------------------------------
  // The floor plan
  // ---------------------------------------------------------------------------------------------
  const LANE = 3.2, DX = 5.7, DZ = 6.5;
  const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  /**
   * The floor of a run: `steps` [{ id, type, agents, label }] in workflow order, `shown(step)` says
   * whether a human gate gets a station. → { stations, byId, path, cum, total, dock, endDir, bounds,
   * center, sup, overview, lane }: stations { id, type, agents, label, kind (agent | machine | gate),
   * row, x, z }, path the lane's corners [{ x, z }], dock a station's distance along the lane.
   */
  function buildLayout(steps, shown = () => false) {
    const stations = steps.filter((s) => s.type !== 'human_approval' || shown(s))
      .map((s) => ({ ...s, kind: s.type === 'human_approval' ? 'gate' : s.agents.length ? 'agent' : 'machine' }));
    // more columns on a long workflow, so the floor grows in rows more slowly
    const n = Math.max(1, stations.length), cols = n <= 6 ? 3 : n <= 12 ? 4 : n <= 20 ? 5 : 6, rows = Math.ceil(n / cols);
    const half = ((cols - 1) * DX) / 2, z0 = -((rows - 1) * DZ) / 2, edge = half + 3.5;
    const laneZ = (r) => z0 + r * DZ + LANE;
    const byId = {};
    stations.forEach((st, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      Object.assign(st, { row: r, x: r % 2 === 0 ? -half + c * DX : half - c * DX, z: z0 + r * DZ });
      byId[st.id] = st;
    });
    // the lane: along a row, down at its end, back along the next one
    const path = [{ x: -half - 5.3, z: laneZ(0) }];
    let endDir = 1;
    for (let r = 0; r < rows; r++) {
      const ltr = r % 2 === 0;
      if (r === rows - 1) {
        const lastX = stations.length ? stations[stations.length - 1].x : -half;
        endDir = ltr ? 1 : -1;
        path.push({ x: lastX + endDir * 5.3, z: laneZ(r) });
      } else {
        const x = ltr ? edge : -edge;
        path.push({ x, z: laneZ(r) }, { x, z: laneZ(r + 1) });
      }
    }
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]));
    const dock = {};
    for (const st of stations) dock[st.id] = cum[st.row * 2] + Math.abs(st.x - path[st.row * 2].x);
    const bounds = { minX: -half - 8.4, maxX: half + 8.4, minZ: z0 - 3.7, maxZ: laneZ(rows - 1) + 2.7 };
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    return {
      stations, byId, path, cum, total: cum[cum.length - 1], dock, endDir, bounds, lane: LANE,
      center: { x: 0, z: (bounds.minZ + bounds.maxZ) / 2 }, sup: { x: -half - 5.7, z: z0 - 0.9 },
      overview: clamp(span * 1.72, 46, 104),
    };
  }

  /** The point of the lane `d` along it (clamped to its ends). */
  function pointAt(layout, d) {
    const { path, cum } = layout;
    if (path.length < 2) return { ...path[0] };
    d = clamp(d, 0, layout.total);
    let i = 0;
    while (i < path.length - 2 && d > cum[i + 1]) i++;
    const len = cum[i + 1] - cum[i] || 1, t = (d - cum[i]) / len;
    return { x: path[i].x + (path[i + 1].x - path[i].x) * t, z: path[i].z + (path[i + 1].z - path[i].z) * t };
  }

  // ---------------------------------------------------------------------------------------------
  // The model
  // ---------------------------------------------------------------------------------------------
  class Run3DModel {
    /** `mainGates`: the human gates drawn before the run reaches them (the workflow's main path). */
    constructor({ mainGates = [] } = {}) {
      this.mainGates = new Set(mainGates);
      this.seq = 0;
      this.version = 0;
      this.listeners = new Set();
      this.run = { id: null, workflow: '', file: '', mode: '', issues: [], task: '', startedAt: null, endedAt: null, status: 'loading', final: '', resumedFrom: '', groups: [], branch: '', base: '' };
      this.steps = []; // the workflow's steps in order: { id, type, agents, label }
      this.agents = {}; // name → { name, label, provider, model }
      this.sessions = {}; // session id → { agent, provider, model }
      this.state = {}; // step id → { status, visits, note, handoff, ask, t0, t1, before, asked }
      this.visits = []; // every visit of a step: { step, visit, t0, t1 (null while it runs) }
      this.robots = {}; // "station:agent" or "supervisor" → { busy, act, tool, say, ctx, doneAt, seen }
      this.turnOf = {}; // session id → the robot its turn animates
      this.turns = 0;
      this.spend = []; // a finished turn: { agent, step, cost, out, tokens: { input, output, cache_read, cache_write } }
      this.sup = { target: null, calls: 0, text: '' };
      this.gates = {}; // approval id → { id, step, text, resolved }
      this.feed = []; // newest first: { n, ts, kind, text, target }
      this.feedN = 0;
      this.activeId = null;
      this.merged = null;
      this.lastTs = 0;
      this.now = 0;
      this.displayAgents = {};
      this.supervisorModel = '';
      this.notApplying = {}; // #735: step or agent id → why it can't run with the run's inputs (run-plan.js)
      this.floorOf = null; // a replayed moment stands on the floor of the whole run: the model that has it
      this._layout = null;
      this._layoutKey = '';
    }

    /** The whole state as plain data (a deep copy): what `restore` takes back. */
    dump() {
      const out = {};
      for (const k of DUMPED) out[k] = this[k];
      return structuredClone(out);
    }

    /** Back to a state `dump` gave (the dump itself is not touched, so it can be restored again). */
    restore(dump) {
      Object.assign(this, structuredClone(dump));
      this._layout = null;
      this._layoutKey = '';
      return this;
    }

    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

    /** Tells the views something changed (also on a clock tick: elapsed time, `done` robots that go idle). */
    notify() { this.version++; for (const fn of [...this.listeners]) fn(); }

    /** Applies one engine event; true when it changed the view. */
    apply(ev) {
      if (!ev || typeof ev !== 'object') return false;
      if (ev.seq) {
        if (ev.seq <= this.seq) return false; // already applied (recorded + live overlap)
        this.seq = ev.seq;
      }
      const fn = HANDLERS[ev.type];
      if (!fn) return false;
      const ts = Date.parse(ev.ts);
      this.now = Number.isFinite(ts) ? ts : this.lastTs || 0;
      this.lastTs = Math.max(this.lastTs, this.now);
      return fn.call(this, ev) !== false;
    }

    /** Applies events in order and tells the views once. */
    applyAll(events) {
      let changed = false;
      for (const ev of events || []) changed = this.apply(ev) || changed;
      if (changed) this.notify();
      return changed;
    }

    /** A past run that never recorded its end (the app closed under it): shown as interrupted. */
    interrupt() {
      if (this.run.status !== 'running') return false;
      this.finish('interrupted', this.lastTs);
      this.notify();
      return true;
    }

    // ---- helpers of the reducers ----
    say(kind, text, target) {
      this.feed.unshift({ n: ++this.feedN, ts: this.now, kind, text, target: target || null });
      if (this.feed.length > MAX_FEED) this.feed.pop();
    }

    robot(key) {
      if (!key) return null;
      return (this.robots[key] ||= { busy: false, act: 'thinking', tool: '', say: '', ctx: 0, doneAt: -Infinity, seen: false });
    }

    label(id) { return this.steps.find((s) => s.id === id)?.label || displayName(id); }

    agentOf(name) {
      return (this.agents[name] ||= { name, label: displayName(name, this.displayAgents || {}), provider: '', model: '' });
    }

    // The robot an agent's turn animates: the one at that step's desk, else the agent's own desk (a
    // developer called by the test step works from the develop desk); the supervisor on its podium.
    robotKey(agent, stepId) {
      if (isSupervisor(agent, stepId)) return 'supervisor';
      const step = this.steps.find((s) => s.id === baseOf(stepId));
      if (step && step.agents.includes(agent)) return `${step.id}:${agent}`;
      const home = this.steps.find((s) => s.agents.includes(agent));
      return home ? `${home.id}:${agent}` : null;
    }

    finish(status, ts) {
      Object.assign(this.run, { status: 'finished', final: status, endedAt: ts });
      for (const st of Object.values(this.state)) {
        if (st.status === 'running' || st.status === 'waiting') st.status = status === 'success' ? 'done' : 'failed';
        st.ask = '';
      }
      for (const v of this.visits) if (v.t1 == null) v.t1 = ts;
      for (const r of Object.values(this.robots)) if (r.busy) Object.assign(r, { busy: false, tool: '' });
      for (const g of Object.values(this.gates)) g.resolved ||= 'closed';
      this.sup.target = null;
      this.activeId = null;
    }

    // ---- what the views read ----
    get live() { return this.run.status === 'running'; }
    get finished() { return this.run.status === 'finished'; }

    /** The floor (cached while the set of stations stays the same). */
    layout() {
      if (this.floorOf) return this.floorOf.layout();
      const shown = (s) => this.mainGates.has(s.id) || !!this.state[s.id]?.visits || !!this.state[s.id]?.asked;
      const key = this.steps.filter((s) => s.type !== 'human_approval' || shown(s)).map((s) => s.id).join('|');
      if (!this._layout || key !== this._layoutKey) {
        this._layout = buildLayout(this.steps, shown);
        this._layoutKey = key;
      }
      return this._layout;
    }

    /**
     * The robot state (robots.js STATES) of a robot ("<station>:<agent>" or "supervisor") at `now` (ms).
     * `stretch`: a replay at 16× keeps `done` 16 times longer in the run's time, so it is still seen.
     */
    robotState(key, now = this.lastTs, stretch = 1) {
      const r = this.robots[key];
      if (key === 'supervisor') {
        if (r?.busy) return r.act;
        if (this.sup.target) return 'thinking';
        return r && now - r.doneAt < SUPERVISOR_DONE_MS * stretch ? 'done' : 'sleeping';
      }
      const st = this.state[key.slice(0, key.indexOf(':'))];
      if (!st) return 'sleeping';
      if (st.status === 'waiting') return 'waiting';
      if (r?.busy) return r.act;
      if (!r?.seen) return 'sleeping';
      if (st.status === 'failed') return 'error';
      return now - r.doneAt < DONE_MS * stretch ? 'done' : 'idle';
    }

    /** The agent of a station to show first: one that is working, else the first. */
    leadOf(station) {
      return station.agents.find((a) => this.robots[`${station.id}:${a}`]?.busy) || station.agents[0];
    }

    /** Where the cart goes: the dock of the step the run is at, the lane's end once the run ended. */
    cartGoal(layout = this.layout()) {
      if (this.finished) return layout.total;
      return this.activeId && layout.dock[this.activeId] != null ? layout.dock[this.activeId] : 0;
    }

    /** How far along the lane the run has been (the blue part of the lane). */
    farthest(layout = this.layout()) {
      if (this.finished) return layout.total;
      let d = 0;
      for (const v of this.visits) if (layout.dock[v.step] != null) d = Math.max(d, layout.dock[v.step]);
      return d;
    }

    /** Milliseconds since the run started: up to `now` while it runs, its whole length once it ended. */
    elapsed(now = this.lastTs) {
      if (this.run.startedAt == null) return 0;
      const end = this.finished ? this.run.endedAt ?? this.lastTs : this.live ? Math.max(now, this.lastTs) : this.lastTs;
      return Math.max(0, end - this.run.startedAt);
    }

    /** How long a step's last visit has run (an open visit: until `now`). */
    stepTime(id, now = this.lastTs) {
      const st = this.state[id];
      if (!st?.visits) return null;
      return Math.max(0, (st.t1 ?? (this.live ? Math.max(now, this.lastTs) : this.lastTs)) - st.t0);
    }

    /** What the run spent: everything, or the turns `filter` keeps ({ agent, step, cost, out }). */
    cost(filter) { return this.spend.reduce((sum, x) => sum + (!filter || filter(x) ? x.cost : 0), 0); }
    /** #72: whether that includes a cost the app does not know (drawn "≈"). */
    costApprox(filter) { return this.spend.some((x) => x.approx && (!filter || filter(x))); }
    tokensOut(filter) { return this.spend.reduce((sum, x) => sum + (!filter || filter(x) ? x.out : 0), 0); }
    /** #833: the kept turns' tokens by kind, their total and the share of cache reads (0 with no tokens). */
    tokens(filter) {
      const t = tokensOf();
      for (const x of this.spend) if (!filter || filter(x)) for (const k of TOKEN_KINDS) t[k] += x.tokens?.[k] || 0;
      const total = TOKEN_KINDS.reduce((sum, k) => sum + t[k], 0);
      return { ...t, total, cacheShare: total ? t.cache_read / total : 0 };
    }
    /** #833: the effective $/M over the four kinds (Analytics › Run's usdPerMTokens); null with no tokens yet. */
    usdPerMTokens(filter) {
      const { total } = this.tokens(filter);
      return total ? this.cost(filter) / (total / 1e6) : null;
    }
    stepCost(id) { return this.cost((x) => x.step === id); }
    agentCost(agent) { return this.cost((x) => x.agent === agent); }

    /** #735: why a step (or a step's agent) doesn't apply to this run (an i18n key), null when it does or already ran. */
    doesntApply(id) {
      const why = this.notApplying[id];
      return why && !(this.state[id] && this.state[id].visits) ? why : null;
    }

    /** The visits of a step so far. */
    visitsOf(id) { return this.visits.filter((v) => v.step === id).length; }

    /** The gates waiting for an answer: [{ id, step, text }]. */
    pendingGates() { return Object.values(this.gates).filter((g) => !g.resolved); }
  }

  // what dump() copies: everything the reducers write (not the listeners, the floor's cache or mainGates)
  const DUMPED = ['seq', 'run', 'steps', 'agents', 'sessions', 'state', 'visits', 'robots', 'turnOf', 'turns', 'spend', 'sup', 'gates',
    'feed', 'feedN', 'activeId', 'merged', 'lastTs', 'now', 'displayAgents', 'supervisorModel', 'notApplying'];

  const HANDLERS = {
    'workflow.started'(ev) {
      const display = ev.display || {};
      this.displayAgents = { ...(display.agents || {}), ...(ev.agent_names || {}) };
      Object.assign(this.run, {
        id: ev.run_id || this.run.id, workflow: ev.workflow || ev.file || 'workflow', file: ev.file || '', mode: ev.inputs?.mode || '',
        issues: (ev.issues || (ev.issue ? [ev.issue] : [])).map((i) => ({ number: i.number, title: i.title || '' })),
        task: short(ev.inputs?.task, 120), startedAt: this.now, endedAt: null, status: 'running', final: '',
        resumedFrom: ev.resumed_from ? ev.resumed_from.step : '', groups: ev.groups || [],
      });
      this.steps = (ev.steps || []).map((s) => {
        const agents = s.agent ? String(s.agent).split('·').map((a) => a.trim()).filter(Boolean) : [];
        agents.forEach((a) => this.agentOf(a));
        return { id: s.id, type: s.type || 'agent', agents, label: displayName(s.id, display.steps || {}) };
      });
      this.state = Object.fromEntries(this.steps.map((s) => [s.id, { status: 'pending', visits: 0, note: '', handoff: '', ask: '', t0: 0, t1: null, before: 'pending', asked: false }]));
      this.notApplying = notApplyingOf(this.steps, ev.inputs);
      this.say('running', `${this.run.workflow} started${this.run.resumedFrom ? ` (resumed at ${this.run.resumedFrom})` : ''}`, 'start');
    },

    'session.opened'(ev) {
      const s = ev.session || {};
      if (!s.agent || s.agent === 'orchestrator') return false;
      this.sessions[ev.session_id] = { agent: s.agent, provider: s.provider || '', model: s.model || '' };
      if (!isSupervisor(s.agent)) {
        const a = this.agentOf(s.agent);
        if (!a.model) Object.assign(a, { provider: s.provider || '', model: s.model || '' });
      } else this.supervisorModel ||= s.model || '';
      return false;
    },

    'worktree.ready'(ev) {
      Object.assign(this.run, { branch: ev.ref || this.run.branch, base: ev.base || this.run.base });
    },

    'step.started'(ev) {
      const st = this.state[ev.step_id];
      if (!st) return false;
      const gate = ev.step_type === 'human_approval' || this.steps.find((s) => s.id === ev.step_id)?.type === 'human_approval';
      Object.assign(st, { status: gate ? 'waiting' : 'running', visits: ev.visit || st.visits + 1, t0: this.now, t1: null, note: '' });
      this.visits.push({ step: ev.step_id, visit: st.visits, t0: this.now, t1: null });
      this.activeId = ev.step_id;
      this.say(gate ? 'waiting' : 'running', `${this.label(ev.step_id)} started${st.visits > 1 ? ` (visit ${st.visits})` : ''}`, ev.step_id);
    },

    'step.finished'(ev) {
      const st = this.state[ev.step_id];
      if (!st) return false;
      const status = ev.error ? 'failed' : outcome(ev.output);
      const note = short(noteOf(ev.output), 220);
      Object.assign(st, { status, note, t1: this.now, ask: '' });
      const v = this.visits.findLast((x) => x.step === ev.step_id && x.t1 == null);
      if (v) v.t1 = this.now;
      this.say(status, `${this.label(ev.step_id)}: ${note || STATUS_LABELS[status].toLowerCase()}`, ev.step_id);
    },

    'step.transition'(ev) {
      if (ev.when !== 'on_error') return false;
      this.say('failed', `${ev.from} raised an error: the run goes to ${ev.to}`, baseOf(ev.to));
    },

    'session.message_sent'(ev) {
      const s = this.sessions[ev.session_id];
      if (!s) return false;
      const key = this.robotKey(s.agent, ev.step_id), r = this.robot(key);
      this.turnOf[ev.session_id] = key;
      if (key !== 'supervisor') this.turns++;
      if (r) Object.assign(r, { busy: true, act: 'thinking', seen: true, tool: '' });
    },

    'session.message_received'(ev) {
      const s = this.sessions[ev.session_id];
      if (!s) return false;
      const u = ev.usage || {};
      const { usd, approx } = SessionCost().turnCost(ev); // #72: a turn of unknown cost counts the CLI's figure, marked
      this.spend.push({ agent: isSupervisor(s.agent, ev.step_id) ? 'supervisor' : s.agent, step: baseOf(ev.step_id), cost: usd, approx, out: u.output || 0, tokens: tokensOf(u) });
      const r = this.robot(this.turnOf[ev.session_id]);
      if (r) Object.assign(r, { busy: false, doneAt: this.now, say: short(ev.text, 240) || r.say, tool: '' });
      delete this.turnOf[ev.session_id];
    },

    'session.closed'(ev) {
      const r = this.robot(this.turnOf[ev.session_id]);
      delete this.turnOf[ev.session_id];
      if (!r?.busy) return false;
      Object.assign(r, { busy: false, tool: '' });
    },

    // what an agent does right now: thinking → thinking, its text → writing, an Edit / Write → writing,
    // another tool → reading, a tool's result → thinking again
    'session.stream'(ev) {
      const item = ev.item || {};
      const r = this.robot(this.turnOf[ev.session_id]);
      if (!r) return false;
      if (item.kind === 'tool_call') {
        const d = short(toolDetail(item.input), 72);
        Object.assign(r, { busy: true, act: WRITES.test(item.name || '') ? 'writing' : 'reading', tool: d ? `${item.name} · ${d}` : String(item.name || 'tool') });
      } else if (item.kind === 'tool_result') r.act = 'thinking';
      else if (item.kind === 'text') Object.assign(r, { act: 'writing', say: short(item.text, 150) || r.say });
      else if (item.kind === 'thinking') r.act = 'thinking';
      else if (item.kind === 'context' && Number.isFinite(item.tokens)) r.ctx = item.tokens;
      else return false;
    },

    'handoff.saved'(ev) {
      const st = this.state[baseOf(ev.step_id)];
      if (st) st.handoff = short(ev.note, 260);
      this.say('info', `${this.agentOf(ev.agent || '').label || 'An agent'} saved a handoff note`, baseOf(ev.step_id));
    },

    // a gate, or an approval asked on an agent step (develop:context_limit): the station waits
    'approval.requested'(ev) {
      const id = baseOf(ev.step_id), st = this.state[id];
      const text = short((ev.brief && ev.brief.headline) || ev.message, 220);
      this.gates[ev.approval_id] = { id: ev.approval_id, step: id, text, resolved: null };
      if (st) {
        Object.assign(st, { before: st.status === 'waiting' ? st.before : st.status, status: 'waiting', ask: text, asked: true });
        this.activeId = id;
      }
      this.say('waiting', `Waiting for you: ${text}`, id);
    },

    'approval.resolved'(ev) {
      const gate = this.gates[ev.approval_id];
      const id = gate?.step || baseOf(ev.step_id), st = this.state[id];
      const choice = ev.withdrawn ? 'withdrawn' : String(ev.choice ?? (ev.approved === false ? 'reject' : 'approve'));
      if (gate) gate.resolved = choice;
      const by = ev.by || 'user';
      const wait = ev.wait_ms ? ` after ${clockOf(ev.wait_ms)}` : '';
      if (st) {
        const isGate = this.steps.find((s) => s.id === id)?.type === 'human_approval';
        Object.assign(st, { status: isGate ? 'done' : st.before, ask: '', note: `Answered “${choice}” by ${by}${ev.via ? ` (${ev.via})` : ''}${wait}` });
      }
      this.say('done', `Answered “${choice}” by ${by}${wait}`, id);
    },

    'supervisor.started'(ev) {
      const id = baseOf(ev.step_id);
      Object.assign(this.sup, { target: this.state[id] ? id : null, calls: this.sup.calls + 1, text: short(ev.error, 160) });
      this.robot('supervisor').seen = true;
      this.say('failed', `Supervisor called on ${id}: ${short(ev.error, 160) || 'the step failed'}`, 'supervisor');
    },

    'supervisor.decision'(ev) {
      const what = `${ev.action || 'decided'}${ev.goto ? ` → ${ev.goto}` : ''}`;
      Object.assign(this.sup, { target: null, text: `${what}: ${short(ev.record || ev.explanation, 220)}` });
      this.robot('supervisor').doneAt = this.now;
      this.say('info', `Supervisor decided: ${what}`, 'supervisor');
    },

    'limit.exceeded'(ev) { this.say('changes', short(ev.message || `Limit exceeded: ${ev.limit || ev.kind || ''}`, 160)); },

    log(ev) {
      if (ev.level !== 'warn' && ev.level !== 'error') return false;
      this.say(ev.level === 'error' ? 'failed' : 'changes', short(ev.message, 160));
    },

    'worktree.merged'(ev) {
      this.merged = { branch: ev.branch || this.run.branch, base: ev.base || this.run.base, commit: String(ev.commit || '').slice(0, 7) };
      this.say('done', `Merged ${this.merged.branch} into ${this.merged.base}${this.merged.commit ? ` (${this.merged.commit})` : ''}`, 'end');
    },

    'workflow.finished'(ev) {
      this.finish(ev.status || 'unknown', this.now);
      this.say(ev.status === 'success' ? 'done' : 'failed', `Run finished: ${ev.status}`, 'end');
    },
  };

  const two = (n) => String(Math.floor(n)).padStart(2, '0');
  /** 75000 → "01:15", 3725000 → "1:02:05". */
  function clockOf(ms) {
    const sec = Math.max(0, Math.round((ms || 0) / 1000)), h = Math.floor(sec / 3600);
    return h ? `${h}:${two((sec % 3600) / 60)}:${two(sec % 60)}` : `${two(sec / 60)}:${two(sec % 60)}`;
  }

  const api = {
    baseOf,
    buildLayout,
    clockOf,
    noteOf,
    outcome,
    pointAt,
    Run3DModel,
    STATUS_LABELS,
    toolDetail,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Run3DModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
