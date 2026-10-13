// Night watch screen (#172): the switch's state, the owner's permissions, the Oracle's night log and
// the nights' metrics (src/night-watch.js), and the morning summary. While the watch is on it also
// detects the anomalies (oracle.detected): from the run events (a failed, interrupted, stalled or
// limit-paused run; a human gate is escalated, never answered) and once a minute from the roadmap
// files (paused, dispatch idle with items left, nothing left) and the runs in progress (no progress
// event for T_stall, night-watch.js STALL_MS: stalled). When a watch ends (src/oracle.js
// onNightEnd → `nightwatch:ended`) the morning summary goes out as a notification.
// Screen: src/renderer/views/nightwatch/; the switch itself is the Oracle's (oracle:nightWatch).
// Self-healing (#278, settings.oracle.selfHealing): the watch is then active day and night
// (oracle-actions.watchState). Its switch is a setting: `settings:changed` writes the oracle.watch entry
// (selfHealing: true) when it turns on or off. The detectors of src/night-watch.js (detectSelfHealing:
// memory, cost-gap, environment, repeat) run in code over a small per-run buffer of the events they
// read; a finding is logged once per run and kind (oracle.detected with its evidence) and wakes the
// Oracle with that evidence (ctx.oracleFindings, batched; in the wake-ups' scope only:
// ctx.oracleFindingsScope). While a budget pauses the Oracle the findings are still logged and the owner gets one
// notification. The report gains one window per Self-healing day (selfHealingDays).
// Step regressions (#335): after each finished run, while a watch is active, a step whose recent cost
// or minutes rose past its baseline (src/step-regressions.js) is logged once per step and class
// (oracle.detected kind regression; the keys flagged until they recover in oracle/regressions.json).
// Report only: it wakes no one and changes nothing. The morning card lists the current regressions
// with the runs behind them.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const backlog = require('../../backlog');
const actions = require('../../oracle-actions');
const night = require('../../night-watch');
const demo = require('../../night-watch-demo');
const notifier = require('../../notifications');
const projects = require('../../projects');
const roadmaps = require('../../roadmap');
const runs = require('../../runs');
const simulation = require('../../engine/simulation');
const workspace = require('../../workspace');

const TICK_MS = 60e3;
const NIGHTS_SHOWN = 14;
// the morning summary stays on the Dashboard this long after the end of the night
const MORNING_MS = 18 * 3600e3;
const ROADMAP_KINDS = new Set(['dispatch-idle', 'roadmap-empty', 'roadmap-paused']);
// Self-healing (#278): the findings of this long wake the Oracle in one turn (as oracle-wake.js batches run events)
const FINDINGS_BATCH_MS = 30e3;
// a run's detector events kept in memory (the oldest are dropped), and how long after its last event
const BUFFER_EVENTS = 2000;
const BUFFER_KEEP_MS = 2 * 3600e3;
// a run first seen mid-way: its workflow.started is read from this much of the head of its events.jsonl
const HEAD_BYTES = 256 * 1024;
const FINDING_LINE_CHARS = 1500;
// #335: the step regressions are checked this long after a run's workflow.finished
const REGRESSION_DELAY_MS = 10e3;

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

  const settings = () => workspace.readSettings(ctx.ws);
  // the watch in force: the Night watch, or Self-healing's standing watch (#278)
  const watch = () => {
    const w = actions.watchState(dir(), settings());
    // the open incidents belong to one night; under Self-healing, to one UTC day
    const key = w.selfHealing ? `self-healing ${actions.watchSince(w)}` : w.startedAt;
    if (openFor !== key) { open.clear(); openFor = key; }
    return w;
  };
  function detect({ kind, runId = null, projectId = null, since, key, evidence = null }) {
    if (open.has(key)) return;
    const id = crypto.randomUUID();
    open.set(key, id);
    night.logNight(dir(), 'oracle.detected', { id, kind, target: runId || projectId || 'all', runId, projectId, since, ...(evidence ? { evidence } : {}) });
  }

  // ---- Self-healing (#278) -------------------------------------------------------------------
  const healing = new Map(); // run id → { head (its workflow.started), events, last (ms), finished }: what the detectors read
  let healingOn = null; // settings.oracle.selfHealing, read again when the settings change and at each tick
  let logged = null; // { dir, keys: Set `${kind} ${runId}` }: the findings in the log (once per run and kind, across restarts)
  let pending = []; // [{ line, runId }]: the findings the Oracle has not been woken with yet
  let flushTimer = null;
  let flushing = false;
  let noticedFor = null; // the budget pause the owner was already told about
  const selfHealingOn = () => (healingOn ??= settings().oracle?.selfHealing === true);
  const loggedFindings = () => {
    if (logged?.dir !== dir()) logged = { dir: dir(), keys: new Set(night.readNightLog(dir()).filter((e) => e.type === 'oracle.detected' && e.runId && e.evidence).map((e) => `${e.kind} ${e.runId}`)) };
    return logged.keys;
  };

  // The switch is a setting: records the standing watch's start or end (self-healing.json) and
  // writes its oracle.watch entry, once per change (also at a tick: the settings file edited by hand).
  function syncSelfHealing() {
    if (!ctx.ws) return;
    healingOn = null;
    try {
      const on = selfHealingOn();
      const { changed, since } = actions.markSelfHealing(dir(), on);
      if (!changed) return;
      night.logNight(dir(), 'oracle.watch', { on, until: null, startedAt: since, by: 'Self-healing', selfHealing: true });
      actions.logAction(dir(), { event: on ? 'self-healing-on' : 'self-healing-off' });
      if (!on) { healing.clear(); pending = []; }
      ctx.events.emit('oracle:changed', { kind: 'self-healing' });
    } catch (e) { console.error('Self-healing switch:', e.message); }
  }

  // a run first seen mid-way (the app restarted): its workflow.started, from the head of its events.jsonl
  function headOf(runId) {
    let fd = null;
    try {
      fd = fs.openSync(path.join(ctx.ws.runs, path.basename(String(runId)), 'events.jsonl'), 'r');
      const buf = Buffer.alloc(HEAD_BYTES);
      const text = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0));
      for (const line of text.split('\n')) {
        let e = null;
        try { e = JSON.parse(line); } catch { continue; }
        if (e?.type === 'workflow.started') return night.selfHealingEvent(e).event;
      }
    } catch { /* no events file: the detectors work without the run's project and issues */ } finally {
      if (fd != null) fs.closeSync(fd);
    }
    return null;
  }
  function buffer(runId, event) {
    let b = healing.get(runId);
    if (!b) {
      b = { head: event.type === 'workflow.started' ? null : headOf(runId), events: [], last: 0, finished: false };
      healing.set(runId, b);
    }
    if (event.type === 'workflow.started') b.head = event;
    else b.events.push(event);
    if (b.events.length > BUFFER_EVENTS) b.events.splice(0, b.events.length - BUFFER_EVENTS);
    b.last = Date.now();
  }
  const buffered = (runId) => {
    const b = healing.get(runId) || { head: null, events: [] };
    return { runId, events: b.head ? [b.head, ...b.events] : b.events };
  };

  // The Oracle's turn for the findings, with their evidence: one per batch. A budget that pauses
  // the Oracle keeps them in its refused wake-ups; the owner is told once per pause.
  function schedule({ soon = false } = {}) {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, soon ? 0 : FINDINGS_BATCH_MS);
    flushTimer.unref?.();
  }
  async function flush() {
    if (flushing || !pending.length || !ctx.ws || !ctx.oracleFindings) return;
    const batch = pending;
    pending = [];
    flushing = true;
    try {
      const out = await ctx.oracleFindings({ lines: batch.map((p) => p.line), runIds: [...new Set(batch.map((p) => p.runId))] });
      // the Oracle is answering: the batch waits for the next one
      if (out?.deferred) pending = [...batch, ...pending];
      else if (out?.refused) {
        const pause = out.refused.resumesAt || `${out.refused.reason} ${new Date().toISOString().slice(0, 10)}`;
        if (noticedFor !== pause) { noticedFor = pause; ctx.notify?.(notifier.findingsWaitingNotice({ text: out.refused.text })); }
      }
    } catch (e) { console.error('Self-healing findings:', e.message); } finally {
      flushing = false;
      if (pending.length) schedule();
    }
  }
  function found(f, liveProject) {
    const key = `${f.kind} ${f.runId}`;
    if (loggedFindings().has(key)) return;
    const projectId = liveProject || f.projectId || null;
    open.delete(key);
    detect({ kind: f.kind, runId: f.runId, projectId, since: f.since, key, evidence: f.evidence });
    loggedFindings().add(key);
    // the Oracle is woken as for run events: never with wake-ups off, a muted run or, under "watched", an unwatched one
    if (!ctx.oracleFindings || !ctx.oracleFindingsScope?.(f.runId)) return;
    const line = `Self-healing finding (${f.kind}: ${night.INCIDENT_KINDS[f.kind]}) in run ${f.runId}${projectId ? ` of project ${projectId}` : ''}${f.evidence.step ? `, step ${f.evidence.step}` : ''}, since ${f.since}. Evidence: ${JSON.stringify(f.evidence)}`;
    pending.push({ line: line.length > FINDING_LINE_CHARS ? `${line.slice(0, FINDING_LINE_CHARS - 1)}…` : line, runId: f.runId });
    // paused by its budget: asked at once (no model call), so the owner hears of it now
    let paused = false;
    try { paused = !!ctx.oracleService?.().state().paused; } catch { /* asked at the batch */ }
    schedule({ soon: paused });
  }
  // The detectors again, after an event that can complete a finding: over this run, or over every
  // buffered run after a suite (environment compares runs).
  function heal(ev) {
    const list = ev.type === 'step.finished' ? [...healing.keys()].map(buffered) : [buffered(ev.run_id)];
    for (const f of night.detectSelfHealing(list)) found(f, ctx.liveRun(f.runId)?.projectId);
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
    if (ev.type === 'workflow.finished') {
      lastProgress.delete(ev.run_id);
      if (healing.has(ev.run_id)) healing.get(ev.run_id).finished = true;
    }
    let read = null;
    try {
      read = selfHealingOn() ? night.selfHealingEvent(ev) : null;
      if (read) buffer(ev.run_id, read.event);
    } catch (e) { console.error('Self-healing buffer:', e.message); }
    if (!kind && !gate && !read?.trigger) return;
    try {
      const w = watch();
      if (!w.active) return;
      const projectId = ctx.liveRun(ev.run_id)?.projectId || null;
      if (gate) {
        night.logNight(dir(), 'oracle.escalated', { target: ev.run_id, runId: ev.run_id, projectId, reason: 'gate', recommendation: `Run ${ev.run_id} waits at the human gate ${ev.step_id || ''}: answer it when you are back (the watch never answers a gate).` });
        return;
      }
      if (read?.trigger && w.selfHealing) heal(ev);
      // under Self-healing a memory incident is the detector's finding (once per run, with its evidence)
      if (!kind || (kind === 'memory' && w.selfHealing)) return;
      const since = kind === 'stalled' ? lastProgress.get(ev.run_id) || ev.ts : ev.ts || new Date().toISOString();
      detect({ kind, runId: ev.run_id, projectId, since, key: `${kind} ${ev.run_id}` });
    } catch (e) { console.error('Night watch detection:', e.message); }
  }
  const onInterrupted = (info) => onRunEvent({ type: 'run.interrupted', run_id: info?.runId, ts: new Date().toISOString() });

  // ---- step regressions (#335) ---------------------------------------------------------------
  const regressionsFile = () => path.join(dir(), 'regressions.json');
  const readFlagged = () => {
    try { return JSON.parse(fs.readFileSync(regressionsFile(), 'utf8')).flagged || []; } catch { return []; }
  };
  // the run list and what prices it (the issues' complexity labels, the settings' prices)
  function regressionInputs() {
    const issues = projects.listProjects(ctx.ws.projects).flatMap((p) => backlog.readBacklog(ctx.ws.backlog, p.id)?.issues || []);
    return { list: runs.listRuns(ctx.ws.runs), opts: { issues, prices: settings().prices || {} } };
  }
  // every step regressed now (flagged or not): the morning card's lines
  function currentRegressions() {
    try {
      const { list, opts } = regressionInputs();
      return night.regressionFindings(list, opts);
    } catch (e) { console.error('Step regressions:', e.message); return []; }
  }
  // after a run: a new regression is logged once; the flagged keys are the ones regressed now (a
  // recovered step leaves the list, so its next rise is reported again)
  function checkRegressions() {
    try {
      const { list, opts } = regressionInputs();
      const flagged = readFlagged();
      const fresh = night.regressionFindings(list, { ...opts, flagged });
      const byId = new Map(list.map((r) => [r.runId, r]));
      for (const f of fresh) detect({ kind: 'regression', runId: f.runId, projectId: byId.get(f.runId)?.projectId || null, since: f.since, key: `regression ${f.key}`, evidence: f.evidence });
      const now = night.regressionFindings(list, opts).map((f) => f.key).sort();
      // a recovered step's incident closes, so its next rise in the same watch is detected again
      for (const key of flagged) if (!now.includes(key)) open.delete(`regression ${key}`);
      if (JSON.stringify(now) !== JSON.stringify([...flagged].sort())) fs.writeFileSync(regressionsFile(), `${JSON.stringify({ flagged: now, updatedAt: new Date().toISOString() }, null, 2)}\n`);
    } catch (e) { console.error('Step regressions:', e.message); }
  }
  // checked a little after the run's end, once its summary.json (what listRuns reads) is written
  function onRunFinished(ev) {
    if (ev?.type !== 'workflow.finished' || !ctx.ws) return;
    const t = setTimeout(() => {
      try { if (ctx.ws && watch().active) checkRegressions(); } catch (e) { console.error('Step regressions:', e.message); }
    }, REGRESSION_DELAY_MS);
    t.unref?.();
  }
  // the summary with the current regressions, as morningSummary words them (a line and its runs each)
  const withRegressions = (summary) => {
    const found = currentRegressions();
    return { ...summary, regressions: found.map((f) => f.evidence.line), regressionRuns: found.map((f) => f.evidence.recent.runIds) };
  };

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
    syncSelfHealing();
    // the detectors' buffers of runs that ended, or went quiet, long enough ago
    for (const [id, b] of healing) if (Date.now() - b.last > (b.finished ? BUFFER_KEEP_MS : 12 * BUFFER_KEEP_MS)) healing.delete(id);
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
      const start = w.startedAt || watchingSince;
      const floor = (t) => (t && t > start ? t : start);
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

  // the windows of the log, by their end (the one in progress last): the nights, and one per Self-healing day (#278)
  const windowsOf = (log, now = Date.now()) => {
    const end = (n) => Math.min(Date.parse(n.endedAt || n.until), now);
    return [...night.nightsOf(log), ...night.selfHealingDays(log, now)].sort((a, b) => end(a) - end(b) || Date.parse(a.startedAt) - Date.parse(b.startedAt));
  };

  /**
   * The nights (newest first), each with its metrics and morning summary, and the baseline. A
   * Self-healing day is one of them: window.selfHealing, `selfHealing` (selfHealingMetrics: detected,
   * repaired alone, waiting for the owner, cost with tokens) and summary.selfHealing (that, in a line).
   */
  async function report() {
    const log = night.readNightLog(dir());
    const nights = windowsOf(log).slice(-NIGHTS_SHOWN);
    const waiting = proposed();
    if (!nights.length) return { nights: [], baseline: night.BASELINE };
    const facts = nightFacts(Math.min(...nights.map((n) => Date.parse(n.startedAt))));
    const usage = readUsage();
    const list = [];
    for (const n of nights.reverse()) {
      const m = night.nightMetrics({ night: n, log, runs: facts, usage });
      m.unblocked.lines = await unblockedLines(m.unblocked.runs);
      const summary = night.morningSummary(m, { proposed: waiting });
      if (n.selfHealing) {
        m.window.selfHealing = true;
        m.selfHealing = night.selfHealingMetrics({ log, usage, day: n.day });
        summary.selfHealing = night.selfHealingSummary(m.selfHealing);
      }
      list.push({ ...m, summary });
    }
    return { nights: list, baseline: night.BASELINE };
  }
  // the report's window that started at `startedAt` (ISO)
  const windowOf = (r, startedAt) => r.nights.find((m) => Date.parse(m.window.from) === Date.parse(startedAt)) || null;

  function state() {
    // the Oracle is there when its service answers with its state (no Oracle channel in this
    // process, or an Oracle that cannot start in this workspace: the screen's empty state)
    let oracleState = null;
    try { oracleState = ctx.oracleService?.().state() || null; } catch { oracleState = null; }
    syncSelfHealing();
    const active = ctx.activeRuns();
    return {
      oracle: !!oracleState?.nightWatch,
      watch: actions.watchState(dir(), settings()),
      permissions: { catalog: night.PERMISSIONS, never: night.NEVER_ALLOWED, ...night.readPermissions(dir()) },
      runs: { active: active.length, waiting: active.filter((r) => r.waiting).length },
      loopCap: night.LOOP_CAP,
      simulation: simulation.simulationOnly(),
    };
  }

  /**
   * The Dashboard's morning card: the last night, or the last Self-healing day that ended (#278: its
   * summary has the day's line), whichever ended later and less than MORNING_MS ago; or null.
   */
  async function morning() {
    const log = night.readNightLog(dir());
    const now = Date.now();
    const endOf = (n) => Date.parse(n.endedAt || n.until);
    const recent = (n) => n && endOf(n) <= now && now - endOf(n) <= MORNING_MS;
    const last = [night.nightsOf(log).at(-1), night.selfHealingDays(log).filter((d) => endOf(d) <= now).at(-1)].filter(recent).sort((a, b) => endOf(a) - endOf(b)).at(-1);
    if (!last) return null;
    const m = windowOf(await report(), last.startedAt);
    return m ? { window: m.window, summary: withRegressions(m.summary) } : null;
  }

  ctx.events.on('run:event', onRunEvent);
  ctx.events.on('run:event', onRunFinished);
  ctx.events.on('run:interrupted', onInterrupted);
  ctx.events.on('settings:changed', syncSelfHealing);
  ctx.events.on('nightwatch:ended', async (w) => {
    try {
      // the night that ended (under Self-healing the newest window is the day in progress)
      const r = await report();
      const m = windowOf(r, w?.startedAt) || r.nights[0];
      if (m) ctx.notify?.(notifier.nightWatchNotice(m.summary));
    } catch (e) { console.error('Night watch summary:', e.message); }
  });
  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();

  return [
    // { oracle, watch: { on, until (null under Self-healing), startedAt, by, active, selfHealing }, permissions: { catalog, never, allowed, updatedAt, defaults }, runs: { active, waiting }, loopCap, simulation }
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
