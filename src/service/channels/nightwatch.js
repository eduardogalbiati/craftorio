// Night watch screen (#172): the switch's state, the owner's permissions, the Oracle's night log and
// the nights' metrics (src/night-watch.js), and the morning summary. While the watch is on it also
// detects the anomalies (oracle.detected): from the run events (a failed, interrupted, stalled or
// limit-paused run; a human gate is escalated, never answered) and once a minute from the roadmap
// files (paused, dispatch idle with items left, nothing left) and the runs in progress (no progress
// event for T_stall, night-watch.js STALL_MS: stalled). When a watch ends (src/oracle.js
// onNightEnd → `nightwatch:ended`) the morning summary goes out as a notification.
// Screen: src/renderer/views/nightwatch/; the switch itself is the Oracle's (oracle:nightWatch).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const actions = require('../../oracle-actions');
const night = require('../../night-watch');
const demo = require('../../night-watch-demo');
const notifier = require('../../notifications');
const projects = require('../../projects');
const roadmaps = require('../../roadmap');
const runs = require('../../runs');
const simulation = require('../../engine/simulation');

const TICK_MS = 60e3;
const NIGHTS_SHOWN = 14;
// the morning summary stays on the Dashboard this long after the end of the night
const MORNING_MS = 18 * 3600e3;
const ROADMAP_KINDS = new Set(['dispatch-idle', 'roadmap-empty', 'roadmap-paused']);

const shortstat = (repo, commit) => new Promise((resolve) => {
  execFile('git', ['-C', repo, 'diff', '--shortstat', `${commit}^1`, commit], { timeout: 15e3, windowsHide: true }, (err, out) => {
    if (err) { resolve(null); return; }
    const n = (re) => Number(String(out).match(re)?.[1] || 0);
    resolve(n(/(\d+) insertion/) + n(/(\d+) deletion/));
  });
});

module.exports = (ctx) => {
  const dir = () => ctx.ws.oracle || path.join(ctx.ws.root, 'oracle');
  const open = new Map(); // `${kind} ${target}` → incident id, for the watch in progress
  let openFor = null; // the startedAt of the watch the open incidents belong to
  const lastProgress = new Map(); // run id → ts of its last progress event (a stall's start)
  const factsCache = new Map(); // events.jsonl → { sig, facts }
  const watchingSince = new Date().toISOString(); // a run's stall floor when none of its events was seen

  const watch = () => {
    const w = actions.nightWatch(dir());
    if (openFor !== w.startedAt) { open.clear(); openFor = w.startedAt; }
    return w;
  };
  function detect({ kind, runId = null, projectId = null, since, key }) {
    if (open.has(key)) return;
    const id = crypto.randomUUID();
    open.set(key, id);
    night.logNight(dir(), 'oracle.detected', { id, kind, target: runId || projectId || 'all', runId, projectId, since });
  }

  function onRunEvent(ev) {
    if (!ev?.run_id || !ctx.ws) return;
    if (night.PROGRESS_EVENTS.has(ev.type)) {
      lastProgress.set(ev.run_id, ev.ts);
      // progress again: the next stall of this run is a new incident
      open.delete(`stalled ${ev.run_id}`);
    }
    const kind = night.incidentOf(ev);
    const gate = ev.type === 'approval.requested';
    if (ev.type === 'workflow.finished') lastProgress.delete(ev.run_id);
    if (!kind && !gate) return;
    try {
      if (!watch().active) return;
      const projectId = ctx.liveRun(ev.run_id)?.projectId || null;
      if (gate) {
        night.logNight(dir(), 'oracle.escalated', { target: ev.run_id, runId: ev.run_id, projectId, reason: 'gate', recommendation: `Run ${ev.run_id} waits at the human gate ${ev.step_id || ''}: answer it when you are back (the watch never answers a gate).` });
        return;
      }
      const since = kind === 'stalled' ? lastProgress.get(ev.run_id) || ev.ts : ev.ts || new Date().toISOString();
      detect({ kind, runId: ev.run_id, projectId, since, key: `${kind} ${ev.run_id}` });
    } catch (e) { console.error('Night watch detection:', e.message); }
  }
  const onInterrupted = (info) => onRunEvent({ type: 'run.interrupted', run_id: info?.runId, ts: new Date().toISOString() });

  // the last run's end: when a roadmap went idle or empty
  function lastEnd() {
    let t = null;
    for (const r of runs.listRuns(ctx.ws.runs).slice(0, 30)) if (r.finishedAt && (!t || r.finishedAt > t)) t = r.finishedAt;
    return t;
  }
  function tick() {
    if (!ctx.ws) return;
    // ends a watch whose end time passed (the Oracle posts its summary and calls onNightEnd)
    try { ctx.oracleService?.().state(); } catch { /* checked again next minute */ }
    try {
      const w = watch();
      if (!w.active) return;
      const files = roadmaps.roadmapProjects(ctx.ws.backlog).map((projectId) => ({ projectId, roadmap: roadmaps.readRoadmap(ctx.ws.backlog, projectId) }));
      const active = ctx.activeRuns();
      const found = night.roadmapIncidents(files, active);
      const key = (f) => `${f.kind} ${f.projectId || 'all'}`;
      const now = new Set(found.map(key));
      // a cleared condition closes its incident: the next one is a new incident
      for (const k of [...open.keys()]) if (ROADMAP_KINDS.has(k.split(' ')[0]) && !now.has(k)) open.delete(k);
      const floor = (t) => (t && t > w.startedAt ? t : w.startedAt);
      for (const f of found) {
        const since = f.kind === 'roadmap-paused' ? files.find((x) => x.projectId === f.projectId)?.roadmap.updatedAt : lastEnd();
        detect({ kind: f.kind, projectId: f.projectId, since: floor(since), key: key(f) });
      }
      // a run that went quiet without a stall log: no progress event for T_stall (since this
      // process started watching, when it saw none of the run's events)
      for (const s of night.stalledRuns(active, lastProgress, { floor: watchingSince })) {
        detect({ kind: 'stalled', runId: s.runId, projectId: s.projectId, since: floor(s.since), key: `stalled ${s.runId}` });
      }
    } catch (e) { console.error('Night watch check:', e.message); }
  }

  // ---- the metrics ---------------------------------------------------------------------------
  // the runs that may overlap the nights: their facts, cached by the events file's size and time
  function nightFacts(from) {
    const out = [];
    let ids = [];
    try { ids = fs.readdirSync(ctx.ws.runs); } catch { return out; }
    for (const id of ids) {
      const file = path.join(ctx.ws.runs, id, 'events.jsonl');
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (st.mtimeMs < from) continue;
      const sig = `${st.size} ${st.mtimeMs}`;
      let c = factsCache.get(file);
      if (c?.sig !== sig) { c = { sig, facts: night.runFacts(id, runs.runEvents(path.dirname(file))) }; factsCache.set(file, c); }
      out.push(c.facts);
    }
    return out;
  }
  const readUsage = () => {
    try { return fs.readFileSync(path.join(dir(), 'usage.jsonl'), 'utf8').split('\n').map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean); } catch { return []; }
  };
  const proposed = () => {
    try { return ctx.oracleService().history().filter((m) => m.kind === 'action' && m.action?.status === 'proposed').length; } catch { return 0; }
  };
  // the lines changed by the runs a watch action unblocked (their local merge commit)
  async function unblockedLines(runIds) {
    let total = null;
    for (const id of runIds.slice(0, 10)) {
      let s = null;
      try { s = JSON.parse(fs.readFileSync(path.join(ctx.ws.runs, id, 'summary.json'), 'utf8')); } catch { continue; }
      const repo = s.worktree?.repo;
      const commit = s.local_merge?.commit;
      if (!repo || !commit || !fs.existsSync(repo)) continue;
      const n = await shortstat(repo, commit);
      if (n != null) total = (total || 0) + n;
    }
    return total;
  }

  /** The nights (newest first), each with its metrics and morning summary, and the baseline. */
  async function report() {
    const log = night.readNightLog(dir());
    const nights = night.nightsOf(log).slice(-NIGHTS_SHOWN);
    const waiting = proposed();
    if (!nights.length) return { nights: [], baseline: night.BASELINE };
    const facts = nightFacts(Date.parse(nights[0].startedAt));
    const usage = readUsage();
    const list = [];
    for (const n of nights.reverse()) {
      const m = night.nightMetrics({ night: n, log, runs: facts, usage });
      m.unblocked.lines = await unblockedLines(m.unblocked.runs);
      list.push({ ...m, summary: night.morningSummary(m, { proposed: waiting }) });
    }
    return { nights: list, baseline: night.BASELINE };
  }

  function state() {
    // the Oracle is there when its service answers with its state (no Oracle channel in this
    // process, or an Oracle that cannot start in this workspace: the screen's empty state)
    let oracleState = null;
    try { oracleState = ctx.oracleService?.().state() || null; } catch { oracleState = null; }
    const active = ctx.activeRuns();
    return {
      oracle: !!oracleState?.nightWatch,
      watch: oracleState?.nightWatch || actions.nightWatch(dir()),
      permissions: { catalog: night.PERMISSIONS, never: night.NEVER_ALLOWED, ...night.readPermissions(dir()) },
      runs: { active: active.length, waiting: active.filter((r) => r.waiting).length },
      loopCap: night.LOOP_CAP,
      simulation: simulation.simulationOnly(),
    };
  }

  /** The Dashboard's morning card: the last night that ended less than MORNING_MS ago, or null. */
  async function morning() {
    const last = night.nightsOf(night.readNightLog(dir())).at(-1);
    if (!last) return null;
    const end = Date.parse(last.endedAt || last.until);
    if (!(end <= Date.now()) || Date.now() - end > MORNING_MS) return null;
    const r = await report();
    return r.nights[0] ? { window: r.nights[0].window, summary: r.nights[0].summary } : null;
  }

  ctx.events.on('run:event', onRunEvent);
  ctx.events.on('run:interrupted', onInterrupted);
  ctx.events.on('nightwatch:ended', async () => {
    try {
      const m = (await report()).nights[0];
      if (m) ctx.notify?.(notifier.nightWatchNotice(m.summary));
    } catch (e) { console.error('Night watch summary:', e.message); }
  });
  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();

  return [
    // { oracle, watch: { on, until, startedAt, by, active }, permissions: { catalog, never, allowed, updatedAt, defaults }, runs: { active, waiting }, loopCap, simulation }
    { channel: 'nightwatch:state', method: 'nightWatchState', fn: () => state() },
    // { nights: [metrics + summary], newest first; baseline }
    { channel: 'nightwatch:report', method: 'nightWatchReport', fn: () => report() },
    // the last night's summary for the Dashboard (less than 18 h after it ended), or null
    { channel: 'nightwatch:morning', method: 'nightWatchMorning', fn: () => morning() },
    // the owner's checklist: [permission id] → state (a never-allowed permission is refused)
    {
      channel: 'nightwatch:permissions',
      method: 'saveNightWatchPermissions',
      params: ['allowed'],
      fn: ({ allowed }) => { night.savePermissions(dir(), allowed); return state(); },
    },
    // simulated mode: replays two demo nights into the workspace (src/night-watch-demo.js) → report
    {
      channel: 'nightwatch:replay',
      method: 'replayNightWatch',
      fn: async () => {
        if (!simulation.simulationOnly()) throw new Error('Replaying a sample night writes demo runs: only in simulated mode.');
        const projectId = projects.listProjects(ctx.ws.projects)[0]?.id || 'demo-app';
        demo.writeDemoNights(ctx.ws, projectId);
        return report();
      },
    },
  ];
};
