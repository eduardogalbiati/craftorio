// The agents at work on the project city (#374): what each agent of a run touches, from the run's
// events, and where it stands on #373's layout (src/shared/city-layout.js). Pure and deterministic:
// no I/O, clock or randomness. The service's architecture:agents reads the runs in progress with it,
// the City view's agents overlay (src/renderer/views/project/project-city-agents.js) places them.
// - relativePath(file, worktree): the repository-relative path (forward slashes) of a tool's file,
//   the run's worktree prefix dropped (Windows: any drive case, any slash; POSIX), or null outside it.
// - touchOf(item): a session.stream tool_call naming a file → { tool, kind: 'change'|'read', file };
//   Edit, Write, MultiEdit and NotebookEdit change it, Read and Grep only look at it.
// - extractTouches(events, { worktree }) → [{ session_id, agent, step, tool, kind, path, ts }];
//   lastTouches(touches) → each session's last one; trailOf(touches, n) → the last n changed paths;
//   closedSessions(events) → the sessions whose agents no longer work (shown only while open).
// - collisions(runs [{ id, changed }]) → [{ path, runs }]: a path two runs or more change.
// - placeAgents(layout, agents) → { robots, cranes, building, trails, collisions }: a changing agent
//   on its building's roof, a reading one at its door, a file the city lacks as a building under
//   construction in the district sharing its longest folder prefix.
// - CityReplay(touches): a finished run's touches played over the city (timeline, play/pause, speed).
// Browser: window.CityAgents; Node: module.exports.
(function (root) {
  // the tool → the input field naming its file
  const CHANGE = { Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path', Write: 'file_path' };
  const READ = { Grep: 'path', Read: 'file_path' };
  const TRAIL = 10;
  const SPEEDS = [1, 2, 4, 8, 16];
  const arr = (x) => (Array.isArray(x) ? x : []);
  const slashes = (s) => String(s).replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const isAbsolute = (s) => /^[A-Za-z]:\//.test(s) || s.startsWith('/');

  /** The repository-relative path of `file` in the run's `worktree`, or null when it is outside. */
  function relativePath(file, worktree) {
    if (typeof file !== 'string' || !file.trim()) return null;
    const f = slashes(file.trim());
    if (!isAbsolute(f)) {
      const rel = f.replace(/^(\.\/)+/, '');
      return rel && !rel.split('/').some((p) => p === '.' || p === '..') ? rel : null;
    }
    if (typeof worktree !== 'string' || !worktree.trim()) return null;
    const wt = slashes(worktree.trim()).replace(/\/+$/, '');
    // Windows paths compare without case (C: and c:, C:\Users and c:\users)
    const windows = /^[A-Za-z]:/.test(wt);
    const cmp = (s) => (windows ? s.toLowerCase() : s);
    if (!cmp(f).startsWith(`${cmp(wt)}/`)) return null;
    return f.slice(wt.length + 1) || null;
  }

  /** What a session.stream item touches: { tool, kind, file } or null. */
  function touchOf(item) {
    if (!item || item.kind !== 'tool_call' || !item.input || typeof item.input !== 'object') return null;
    const name = String(item.name || '');
    const kind = Object.hasOwn(CHANGE, name) ? 'change' : Object.hasOwn(READ, name) ? 'read' : null;
    if (!kind) return null;
    const file = item.input[kind === 'change' ? CHANGE[name] : READ[name]];
    if (typeof file !== 'string' || !file.trim()) return null;
    // Grep's path is often a folder ('.', 'src'): only a name with an extension counts as a file
    if (name === 'Grep' && !/\.[^./\\]+$/.test(slashes(file.trim()).split('/').pop())) return null;
    return { tool: name, kind, file };
  }

  /** The run's file touches in event order, each with its session's agent and step. */
  function extractTouches(events, { worktree = null } = {}) {
    const sessions = {};
    const out = [];
    for (const e of arr(events)) {
      if (!e || !e.session_id) continue;
      if (e.type === 'session.opened') {
        const s = e.session || {};
        // the provider and model pick the agent's robot when it has no saved look
        sessions[e.session_id] = { agent: s.agent || null, model: s.model || null, provider: s.provider || null, step: s.step_id || e.step_id || null };
        continue;
      }
      if (e.type !== 'session.stream') continue;
      const t = touchOf(e.item);
      const path = t && relativePath(t.file, worktree);
      if (!path) continue;
      const s = sessions[e.session_id] || { agent: null, model: null, provider: null, step: e.step_id || null };
      out.push({ agent: s.agent, kind: t.kind, model: s.model, path, provider: s.provider, session_id: e.session_id, step: s.step, tool: t.tool, ts: e.ts || null });
    }
    return out;
  }

  /** The sessions the run has closed: their agents no longer work on the city. */
  function closedSessions(events) {
    return new Set(arr(events).filter((e) => e && e.type === 'session.closed' && e.session_id).map((e) => e.session_id));
  }

  /** Each session's last touch, one entry per session. */
  function lastTouches(touches) {
    const last = new Map();
    for (const t of arr(touches)) last.set(t.session_id, t);
    return [...last.values()];
  }

  /** The last `n` distinct changed paths (reads ignored), most recent last. */
  function trailOf(touches, n = TRAIL) {
    const list = [];
    for (const t of arr(touches)) {
      if (t.kind !== 'change') continue;
      const i = list.indexOf(t.path);
      if (i >= 0) list.splice(i, 1);
      list.push(t.path);
    }
    return n > 0 ? list.slice(-n) : [];
  }

  /** The paths changed by two runs or more: [{ path, runs }], sorted by path. */
  function collisions(runs) {
    const by = new Map();
    for (const r of arr(runs)) {
      for (const p of new Set(arr(r.changed))) {
        if (!by.has(p)) by.set(p, []);
        if (!by.get(p).includes(r.id)) by.get(p).push(r.id);
      }
    }
    return [...by].filter(([, ids]) => ids.length > 1).map(([path, ids]) => ({ path, runs: ids }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  const folders = (p) => String(p).split('/').slice(0, -1);
  const shared = (a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };

  /** The district of a file the city does not have: the one whose files share its longest folder prefix. */
  function districtFor(layout, path) {
    const mine = folders(path);
    let best = null;
    let depth = -1;
    for (const b of arr(layout && layout.buildings)) {
      const n = shared(mine, folders(b.path));
      if (n > depth) [best, depth] = [b.district, n];
    }
    return arr(layout && layout.districts).find((d) => d.id === best) || arr(layout && layout.districts)[0] || null;
  }

  /** Where the agents of the runs in progress stand on the city, and what they leave on it. */
  function placeAgents(layout, agents) {
    const at = Object.fromEntries(arr(layout && layout.buildings).map((b) => [b.path, b]));
    const runs = arr(agents && agents.runs);
    const building = new Map();
    const lacking = (path) => {
      if (at[path] || building.has(path)) return;
      const d = districtFor(layout, path);
      if (d) building.set(path, { district: d.id, path });
    };
    // several agents on one spot stand side by side
    const crowd = {};
    const spread = (key, size) => {
      const k = (crowd[key] = (crowd[key] || 0) + 1) - 1;
      return ((k % 3) - 1) * Math.min(size / 4, 0.8);
    };
    const robots = [];
    for (const run of runs) {
      for (const a of arr(run.agents)) {
        if (a.kind === 'change') lacking(a.path);
        const b = at[a.path];
        // a file the city lacks: its robot stands in the district of its building under construction
        const spot = b || districtFor(layout, a.path);
        if (!spot) continue;
        const roof = !!b && a.kind === 'change';
        const door = !!b && !roof;
        robots.push({
          agent: a.agent, at: roof ? 'roof' : 'door', colour: run.colour, label: `${a.agent} · ${a.step}`, path: a.path,
          runId: run.id, session_id: a.session_id, step: a.step,
          x: spot.x + spot.w / 2 + spread(`${a.path}:${roof}`, spot.w),
          y: roof ? b.h : 0,
          // the door is on the building's edge facing the home view (z + d)
          z: door ? spot.z + spot.d : spot.z + spot.d / 2,
        });
      }
      for (const p of arr(run.trail)) lacking(p);
    }
    return {
      robots,
      cranes: [...new Set(runs.flatMap((r) => arr(r.dirty)))].filter((p) => at[p]),
      building: [...building.values()],
      trails: runs.map((r) => ({ runId: r.id, colour: r.colour, paths: arr(r.trail) })),
      collisions: arr(agents && agents.collisions),
    };
  }

  /** A finished run's touches played over the city: time in ms from its first touch. */
  class CityReplay {
    constructor(touches) {
      this.touches = arr(touches).filter((t) => Number.isFinite(Date.parse(t.ts)));
      const times = this.touches.map((t) => Date.parse(t.ts));
      this.start = times.length ? Math.min(...times) : 0;
      this.duration = times.length ? Math.max(...times) - this.start : 0;
      this.time = 0;
      this.playing = false;
      this.speed = 1;
    }

    play() {
      if (this.time >= this.duration) this.time = 0;
      this.playing = true;
    }

    pause() { this.playing = false; }

    setSpeed(speed) { if (SPEEDS.includes(speed)) this.speed = speed; }

    seek(ms) { this.time = Math.min(this.duration, Math.max(0, Number(ms) || 0)); }

    /** Advances by `ms` of wall time at the chosen speed; stops at the end. */
    tick(ms) {
      if (!this.playing) return;
      this.time = Math.min(this.duration, this.time + Math.max(0, Number(ms) || 0) * this.speed);
      if (this.time >= this.duration) this.playing = false;
    }

    /** The touches so far and each session's last one. */
    frame() {
      const cut = this.start + this.time;
      const touches = this.touches.filter((t) => Date.parse(t.ts) <= cut);
      return { last: lastTouches(touches), time: this.time, touches };
    }
  }

  const api = {
    // the tools that change a file (the Oracle's run focus counts their edits too)
    CHANGE_TOOLS: Object.keys(CHANGE),
    CityReplay,
    closedSessions,
    collisions,
    districtFor,
    extractTouches,
    lastTouches,
    placeAgents,
    relativePath,
    SPEEDS,
    touchOf,
    trailOf,
    TRAIL,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CityAgents = api;
})(typeof window !== 'undefined' ? window : globalThis);
