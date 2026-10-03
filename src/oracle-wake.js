// The Oracle's wake-ups (#123): the run events that change a decision wake the Oracle (src/oracle.js
// wake()), batched, instead of it polling. Routine events (streams, tool calls, step starts and ends,
// transitions) never wake it. What wakes it, by kind (settings.oracle.wakeOn):
//   gate         approval.requested (a human gate waits)
//   finished     workflow.finished (with its status and cost)
//   merge        a run that failed on a merge (a local merge conflict), a log of kind merge_blocked
//   limit        limit.exceeded, budget.exceeded
//   stall        a log of kind stall, agent_idle or loop_blocked; supervisor.decision
//   invalid      the same step's output invalid twice (log kind invalid_output)
//   interrupted  a log of kind agent_interrupted; run.interrupted (the app closed during the run,
//                found at the next start); run.elsewhere (a run seen in progress in another app process)
// settings.oracle.wakeScope: 'all' (every run, except the runs the owner muted), 'watched' (only the
// runs and projects the Oracle watches) or 'off'. "Watch this run" (or a project's roadmap) wakes it
// on that run's events with the same filter, even when muted or out of scope, until the run ends
// (a project's watch: until its roadmap is no longer running) or the owner unwatches it.
// The first waking event starts a batch window (BATCH_MS); every event of the window goes in the same
// wake-up, one short turn. The mutes and watches are kept in <oracle dir>/wake.json.

const fs = require('fs');
const path = require('path');

const BATCH_MS = 30e3;
const WAKE_KINDS = [
  'finished',
  'gate',
  'interrupted',
  'invalid',
  'limit',
  'merge',
  'stall',
];
const KIND_LABELS = {
  finished: 'Runs that finish (status and cost)',
  gate: 'Human gates waiting',
  interrupted: 'Runs interrupted or seen in another app process',
  invalid: 'Repeated invalid outputs',
  limit: 'Limits and budgets reached',
  merge: 'Merge conflicts and blocked merges',
  stall: 'Stalls and supervisor decisions',
};
const SCOPES = ['all', 'watched', 'off'];
const STALL_LOGS = new Set(['agent_idle', 'loop_blocked', 'stall']);

/** The wake-up settings with their defaults: { wakeScope, wakeOn: [kind] }. */
function wakeSettings(settings = {}) {
  const o = settings.oracle || {};
  const wakeScope = SCOPES.includes(o.wakeScope) ? o.wakeScope : 'all';
  const wakeOn = Array.isArray(o.wakeOn) ? WAKE_KINDS.filter((k) => o.wakeOn.includes(k)) : [...WAKE_KINDS];
  return { wakeScope, wakeOn };
}

/** The wake kind of a run event, or null (routine: it never wakes the Oracle). Invalid outputs wake from the second one of a step. */
function wakeKind(ev, invalidCount = 0) {
  switch (ev?.type) {
    case 'approval.requested': return 'gate';
    case 'workflow.finished': return ev.status === 'failed' && /\bmerge|conflict/i.test(String(ev.error || '')) ? 'merge' : 'finished';
    case 'limit.exceeded':
    case 'budget.exceeded': return 'limit';
    case 'supervisor.decision': return 'stall';
    case 'run.interrupted':
    case 'run.elsewhere': return 'interrupted';
    case 'log':
      if (STALL_LOGS.has(ev.kind)) return 'stall';
      if (ev.kind === 'agent_interrupted') return 'interrupted';
      if (ev.kind === 'merge_blocked') return 'merge';
      if (ev.kind === 'invalid_output') return invalidCount >= 2 ? 'invalid' : null;
      return null;
    default: return null;
  }
}

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const clip = (s, n = 300) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** One line of a wake-up for an event (the Oracle reads it as data). */
function wakeLine(ev, kind) {
  const at = String(ev.ts || new Date().toISOString()).slice(11, 19);
  const run = ev.run_id || '?';
  switch (ev.type) {
    // the gate's "What happened" line (#213) and its recommendation, else the start of its message
    case 'approval.requested': {
      const what = ev.brief?.headline || ev.message;
      const rec = ev.brief?.recommendation;
      const advice = rec?.label || rec?.reason ? `; recommended: ${clip([rec.label, rec.reason].filter(Boolean).join(', '), 120)}` : '';
      return `${at} ${run}: gate ${ev.step_id || ev.id || '?'} waits for the owner${what ? ` (${clip(what, 200)}${advice})` : ''}`;
    }
    case 'workflow.finished': {
      const cost = ev.summary?.cost_usd ?? ev.summary?.costUsd ?? ev.cost_usd;
      return `${at} ${run}: ${kind === 'merge' ? 'failed on a merge' : `finished ${ev.status || '?'}`}${cost != null ? `, cost ${money(cost)}` : ''}${ev.error ? ` (${clip(ev.error, 200)})` : ''}`;
    }
    case 'limit.exceeded': return `${at} ${run}: limit ${ev.limit || '?'} reached (${ev.current ?? '?'} of ${ev.value ?? '?'})${ev.paused ? ', paused for the owner' : ''}`;
    case 'budget.exceeded': return `${at} ${run}: budget exceeded${ev.message ? ` (${clip(ev.message, 160)})` : ''}`;
    case 'supervisor.decision': return `${at} ${run}: supervisor decided ${ev.action || ev.decision || '?'}${ev.step_id ? ` at ${ev.step_id}` : ''}`;
    case 'run.interrupted': return `${at} ${run}: interrupted (the app closed while it ran)`;
    case 'run.elsewhere': return `${at} ${run}: in progress in another app process`;
    default: return `${at} ${run}: ${ev.kind || ev.type}${ev.step_id ? ` at ${ev.step_id}` : ''}${ev.message ? ` (${clip(ev.message, 200)})` : ''}`;
  }
}

/**
 * The wake-ups of a service. `events`: the service's EventEmitter (run:event, run:interrupted in);
 * `settings()` the workspace settings; `file()` the wake.json path; `projectOf(runId)` a live run's
 * project id; `projectRunning(projectId)` whether its roadmap still runs; `onWake({ lines, runIds,
 * kinds })` the Oracle's turn (a rejected or `{ deferred: true }` answer puts the batch back);
 * `onChange()` the watches or mutes changed.
 */
function createWake({ events, settings, file, projectOf = () => null, projectRunning = () => false, onWake, onChange = () => {}, batchMs = BATCH_MS }) {
  let batch = [];
  let timer = null;
  const invalid = new Map(); // `${runId} ${step}` → invalid outputs seen
  const read = () => {
    try {
      const j = JSON.parse(fs.readFileSync(file(), 'utf8'));
      return { muted: Array.isArray(j.muted) ? j.muted : [], watching: Array.isArray(j.watching) ? j.watching : [] };
    } catch { return { muted: [], watching: [] }; }
  };
  const write = (s) => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(s, null, 2));
    onChange();
  };
  const watchOf = (s, ev) => s.watching.find((w) => (w.runId && w.runId === ev.run_id) || (w.projectId && w.projectId === projectOf(ev.run_id)));

  function arm() {
    if (timer) return;
    timer = setTimeout(flush, batchMs);
    timer.unref?.();
  }
  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (!batch.length) return null;
    const taken = batch;
    batch = [];
    let res;
    try { res = await onWake({ lines: taken.map((b) => b.line), runIds: [...new Set(taken.map((b) => b.runId))], kinds: [...new Set(taken.map((b) => b.kind))] }); } catch { res = { deferred: true }; }
    if (res?.deferred) { batch = [...taken, ...batch]; arm(); }
    return res;
  }

  /** Takes one run event: it joins the batch when it wakes the Oracle. → whether it did. */
  function take(ev) {
    if (!ev?.run_id) return false;
    let count = 0;
    if (ev.type === 'log' && ev.kind === 'invalid_output') {
      const key = `${ev.run_id} ${ev.step_id || String(ev.message || '').match(/Invalid output in (\S+)/)?.[1] || ''}`;
      count = (invalid.get(key) || 0) + 1;
      invalid.set(key, count);
    }
    const kind = wakeKind(ev, count);
    const s = read();
    const watch = watchOf(s, ev);
    // a run's watch ends with it; a project's when its roadmap no longer runs
    if (ev.type === 'workflow.finished') {
      for (const k of [...invalid.keys()]) if (k.startsWith(`${ev.run_id} `)) invalid.delete(k);
      const left = s.watching.filter((w) => !(w.runId === ev.run_id || (w.projectId && w.projectId === projectOf(ev.run_id) && !projectRunning(w.projectId))));
      if (left.length !== s.watching.length) write({ ...s, watching: left });
    }
    if (!kind) return false;
    const { wakeScope, wakeOn } = wakeSettings(settings());
    if (!wakeOn.includes(kind)) return false;
    const inScope = wakeScope === 'all' && !s.muted.includes(ev.run_id);
    if (!inScope && !watch) return false;
    batch.push({ line: wakeLine(ev, kind), runId: ev.run_id, kind });
    arm();
    return true;
  }

  const interrupted = (info) => take({ type: 'run.interrupted', run_id: info?.runId, ts: new Date().toISOString() });
  events.on('run:event', take);
  events.on('run:interrupted', interrupted);

  return {
    take,
    flush,
    pending: () => batch.map((b) => b.line),
    state: () => ({ ...read(), ...wakeSettings(settings()) }),

    /** Watches a run ({ runId }) or a project's roadmap ({ projectId }) until it ends; `on: false` stops. */
    watch({ runId, projectId, on = true } = {}) {
      const target = runId ? { runId: String(runId) } : projectId ? { projectId: path.basename(String(projectId)) } : null;
      if (!target) throw new Error('Say which run (runId) or project (projectId) to watch.');
      const s = read();
      const same = (w) => (target.runId ? w.runId === target.runId : w.projectId === target.projectId);
      const watching = s.watching.filter((w) => !same(w));
      if (on) watching.push({ ...target, since: new Date().toISOString() });
      // watching a run the owner muted unmutes it
      write({ muted: on && target.runId ? s.muted.filter((m) => m !== target.runId) : s.muted, watching });
      return this.state();
    },

    /** Mutes (or unmutes) one run: its events no longer wake the Oracle, unless it is watched. */
    mute(runId, on = true) {
      const id = String(runId || '');
      if (!id) throw new Error('Say which run to mute.');
      const s = read();
      write({ ...s, muted: on ? [...new Set([...s.muted, id])] : s.muted.filter((m) => m !== id) });
      return this.state();
    },

    stop() { clearTimeout(timer); timer = null; events.off('run:event', take); events.off('run:interrupted', interrupted); },
  };
}

module.exports = {
  BATCH_MS,
  createWake,
  KIND_LABELS,
  SCOPES,
  WAKE_KINDS,
  wakeKind,
  wakeLine,
  wakeSettings,
};
