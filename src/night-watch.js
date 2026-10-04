// Night watch (#172): what the owner lets the Oracle do without asking during the night, the Oracle's
// own log of the night, and the night's metrics. No service here: the files and pure functions that
// src/oracle.js (the decision to act alone), src/service/channels/nightwatch.js (detection, the
// screen, the morning summary) and the Night watch screen (views/nightwatch/) share.
//
// Its files, in <workspace>/oracle/ next to night-watch.json (the switch, src/oracle-actions.js):
//   night-permissions.json  { allowed: [permission id], updatedAt }: the owner's checklist
//   night-log.jsonl         the Oracle's events while the watch is on, one per line { ts, type, ... }:
//     oracle.watch      { on, until, startedAt, by }      the switch turned on (or its end time moved) or off
//     oracle.detected   { id, kind, target, runId, projectId, since }   an anomaly (INCIDENT_KINDS)
//     oracle.action     { actionId, kind, title, target, runId, projectId, permission, auto, backup, result, ok }
//     oracle.escalated  { target, recommendation, reason, actionId? }   left for the owner (a gate, a refused action)
//     oracle.blocked    { actionId, kind, target, reason: permission | content | loop }   an action it could not take alone
//     oracle.undone     { action_id }                     the owner undid an action
// Every metric (nightMetrics) is computed from that log and the runs' events.jsonl; nothing is
// estimated, except "hours saved", which is labelled as an estimate.

const fs = require('fs');
const path = require('path');

// What the Oracle may do without asking, each with what it does and its undo. Defaults: retry and refresh.
const PERMISSIONS = [
  { id: 'retry', label: 'Retry a failed roadmap item', does: 'Plans the failed item again: a new run starts from its workflow.', undo: 'Undo puts the roadmap file back; the new run is kept.', default: true },
  { id: 'skip', label: 'Skip an item', does: 'The item counts as finished and the roadmap goes on to the next one.', undo: 'Undo puts the roadmap file back: the item is planned again.', default: false },
  { id: 'regroup', label: 'Regroup or reorder planned items', does: 'Moves planned items between stages or changes their order (validated before it is written).', undo: 'Undo puts the roadmap file back.', default: false },
  { id: 'fresh-start', label: 'Start from scratch over kept work', does: 'Retries an item whose earlier run kept unmerged work (#170), in a new run.', undo: 'Undo puts the roadmap file back; the kept work stays in its branch.', default: false },
  { id: 'refresh', label: 'Refresh issue text and planned-item copies', does: 'Replaces an issue\'s stale description, so planned items read the current text (#161, #168).', undo: 'Undo writes the previous description back.', default: true },
  { id: 'restore', label: 'Restore a workflow or skill copy to its default', does: 'Replaces an edited workflow or skill with the bundled default.', undo: 'Undo puts the edited copy back (it went to the trash).', default: false },
  { id: 'append', label: 'Append low-complexity issues to the roadmap', does: 'Adds planned items after the existing ones (#164); nothing already planned moves.', undo: 'Undo puts the roadmap file back.', default: false },
  { id: 'dispatch', label: 'Restart the app\'s dispatch', does: 'Starts the next planned items of the running roadmaps and queues when nothing runs.', undo: 'No undo needed: nothing changes on disk (stop a run that started).', default: false },
  { id: 'commit', label: 'Commit a workflow or skill fix to the local main', does: 'Writes files under workflows/ or skills/ and commits them on the local main (never pushed).', undo: 'Undo with git revert of the commit named in the result.', default: false },
  { id: 'file-issue', label: 'File an issue for what it found', does: 'Creates a new issue in the project\'s tracker.', undo: 'No undo: close the issue yourself (the watch never closes issues).', default: false },
];
const PERMISSION_IDS = PERMISSIONS.map((p) => p.id);
const DEFAULT_PERMISSIONS = PERMISSIONS.filter((p) => p.default).map((p) => p.id);
// Shown locked: no checkbox can enable them, and no action kind maps to them.
const NEVER_ALLOWED = [
  { id: 'answer-gate', label: 'Answer a human gate' },
  { id: 'close-issue', label: 'Close issues' },
  { id: 'delete-data', label: 'Delete data' },
  { id: 'paid-calls', label: 'Start paid calls outside the plan' },
  { id: 'push', label: 'Push' },
];

// The anomalies the watch detects (oracle.detected kind).
const INCIDENT_KINDS = {
  'dispatch-idle': 'Dispatch idle with planned items',
  failed: 'Failed run',
  interrupted: 'Run interrupted or duplicated',
  limit: 'Paused by a limit',
  'roadmap-empty': 'Roadmap empty',
  'roadmap-paused': 'Roadmap paused or in error',
  stalled: 'Stalled run',
};
const LOG_TYPES = ['oracle.action', 'oracle.blocked', 'oracle.detected', 'oracle.escalated', 'oracle.undone', 'oracle.watch'];
const STALL_LOGS = new Set(['agent_idle', 'loop_blocked', 'stall']);
const PROGRESS_EVENTS = new Set(['step.finished', 'step.started', 'workflow.started']);
// T_stall: a run in progress (not at a gate) without a progress event for this long is stalled
const STALL_MS = 30 * 60e3;
// an item with more watch actions than this in one night: the next one is escalated instead
const LOOP_CAP = 3;
// resolved = the item progresses again within this time of the action
const RESOLVE_WINDOW_MS = 30 * 60e3;
// The night before the watch (Diário do Orchestrator, reports/linha-de-base-antes-da-refatoracao-2026-10-01.md):
// runs active 14.7 h of 24 h, the roadmap ended at 04:02 and nothing ran until 08:47; the #112 incident
// of 30/09 (TTD ≈ 5 min, TTR ≈ 20 min) is the human reference for TTD and TTR.
const BASELINE = Object.freeze({ label: 'Night 1, 30/09 → 01/10 (no watch)', hours: 24, activeHours: 14.7, idleHours: 9.3, idleNoWorkHours: 4.75, ttdMs: 5 * 60e3, ttrMs: 20 * 60e3 });

const permissionsFile = (dir) => path.join(dir, 'night-permissions.json');
const logFile = (dir) => path.join(dir, 'night-log.jsonl');
const ms = (t) => (t ? Date.parse(t) : NaN);

/** The permission an action card needs to run alone, or null (it always waits for the owner's click). */
function permissionOf(kind, params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  switch (kind) {
    case 'roadmap.item': return p.action === 'skip' ? 'skip' : p.fresh ? 'fresh-start' : 'retry';
    case 'roadmap.stages': return p.append ? 'append' : 'regroup';
    case 'issue.update': return p.mode === 'comment' ? null : 'refresh';
    case 'skill.restore':
    case 'workflow.restore': return 'restore';
    case 'dispatch.restart': return 'dispatch';
    case 'workflow.commit': return 'commit';
    case 'issue.file': return 'file-issue';
    default: return null;
  }
}

/** The owner's checklist: { allowed, updatedAt, defaults } (the defaults until it is saved). */
function readPermissions(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(permissionsFile(dir), 'utf8'));
    if (Array.isArray(j.allowed)) return { allowed: PERMISSION_IDS.filter((id) => j.allowed.includes(id)), updatedAt: j.updatedAt || null, defaults: false };
  } catch { /* not saved yet */ }
  return { allowed: [...DEFAULT_PERMISSIONS], updatedAt: null, defaults: true };
}

/** Saves the checklist; a never-allowed or unknown permission, or anything but a list, is refused
 *  (#239: an object read as "nothing allowed" wiped the owner's choices). → readPermissions */
function savePermissions(dir, allowed) {
  if (!Array.isArray(allowed)) throw new Error('The permissions could not be saved: expected a list of permission ids.');
  const list = allowed.map(String);
  const never = list.find((id) => NEVER_ALLOWED.some((n) => n.id === id));
  if (never) throw new Error(`${NEVER_ALLOWED.find((n) => n.id === never).label} is never allowed during the Night watch.`);
  const unknown = list.find((id) => !PERMISSION_IDS.includes(id));
  if (unknown) throw new Error(`Unknown permission: ${unknown}.`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(permissionsFile(dir), JSON.stringify({ allowed: PERMISSION_IDS.filter((id) => list.includes(id)), updatedAt: new Date().toISOString() }, null, 2));
  return readPermissions(dir);
}

/** Appends one event to the Oracle's night log. */
function logNight(dir, type, data = {}, ts = new Date().toISOString()) {
  if (!LOG_TYPES.includes(type)) throw new Error(`Unknown night log event: ${type}`);
  fs.mkdirSync(dir, { recursive: true });
  const entry = { ts, type, ...data };
  fs.appendFileSync(logFile(dir), `${JSON.stringify(entry)}\n`);
  return entry;
}

function readNightLog(dir) {
  try {
    return fs.readFileSync(logFile(dir), 'utf8').split('\n').map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** What an action card targets: { target, runId, projectId } (the run, else the project, else the file). */
function targetOf(params = {}) {
  const p = params || {};
  const runId = p.runId ? String(p.runId) : null;
  const projectId = p.projectId ? path.basename(String(p.projectId)) : null;
  const item = p.itemId ? `${projectId}/${p.itemId}` : null;
  return { target: item || runId || projectId || (p.file ? String(p.file) : p.id ? String(p.id) : 'all'), runId, projectId };
}

/** The incident kind of a run event, or null. */
function incidentOf(ev) {
  switch (ev?.type) {
    case 'workflow.finished': return ev.status === 'failed' ? 'failed' : ev.status === 'interrupted' ? 'interrupted' : null;
    case 'run.interrupted':
    case 'run.elsewhere': return 'interrupted';
    case 'limit.exceeded': return ev.paused === false ? null : 'limit';
    case 'log': return STALL_LOGS.has(ev.kind) ? 'stalled' : null;
    default: return null;
  }
}

const unfinished = (r) => (r.stages || []).flatMap((s) => s.items || []).filter((x) => !['done', 'skipped'].includes(x.status));

/**
 * The roadmap anomalies of the moment: `roadmaps` [{ projectId, roadmap }] (the files), `active`
 * [{ projectId }] the runs in progress. → [{ kind, projectId }]: a paused roadmap (or one with an
 * error), a running roadmap with items left and no run of its project, or nothing left anywhere.
 */
function roadmapIncidents(roadmaps = [], active = []) {
  const out = [];
  const busy = new Set(active.map((r) => r.projectId));
  for (const { projectId, roadmap: r } of roadmaps) {
    if (!r) continue;
    if (r.state === 'paused' || r.error) out.push({ kind: 'roadmap-paused', projectId });
    else if (r.state === 'running' && unfinished(r).length && !busy.has(projectId)) out.push({ kind: 'dispatch-idle', projectId });
  }
  const left = roadmaps.some(({ roadmap: r }) => r && ['paused', 'running'].includes(r.state) && unfinished(r).length);
  if (!active.length && !left) out.push({ kind: 'roadmap-empty', projectId: null });
  return out;
}

/**
 * The runs in progress without a progress event for `stallMs`: `active` [{ runId, projectId,
 * startedAt, waiting }] (a run at a human gate is escalated, not stalled), `lastProgress` Map run id →
 * ts of its last progress event, `floor` the ts used when none was seen (the run's start, if later).
 * → [{ runId, projectId, since }]
 */
function stalledRuns(active = [], lastProgress = new Map(), { now = Date.now(), floor = null, stallMs = STALL_MS } = {}) {
  const out = [];
  for (const r of active) {
    if (r.waiting || r.status === 'waiting') continue;
    const since = lastProgress.get(r.runId) || [r.startedAt, floor].filter(Boolean).sort().at(-1);
    if (since && now - ms(since) >= stallMs) out.push({ runId: r.runId, projectId: r.projectId || null, since });
  }
  return out;
}

/** The nights in the log: [{ startedAt, until, endedAt, by }] (endedAt null while it is on). */
function nightsOf(log) {
  const nights = [];
  for (const e of log) {
    if (e.type !== 'oracle.watch') continue;
    const last = nights.at(-1);
    if (e.on) {
      if (last && !last.endedAt && last.startedAt === e.startedAt) last.until = e.until;
      else nights.push({ startedAt: e.startedAt || e.ts, until: e.until, endedAt: null, by: e.by || null });
    } else if (last && !last.endedAt) last.endedAt = Date.parse(e.ts) < Date.parse(last.until) ? e.ts : last.until;
  }
  return nights;
}

/** A run's facts from its events: { runId, projectId, start, end, status, cost, issues, progress, gates }. */
function runFacts(runId, events) {
  const f = { runId, projectId: null, start: null, end: null, status: 'running', cost: 0, issues: 0, progress: [], gates: [], mock: false };
  const gates = new Map();
  for (const e of events) {
    const t = ms(e.ts);
    if (PROGRESS_EVENTS.has(e.type)) f.progress.push(t);
    if (e.type === 'workflow.started') {
      f.start ??= t;
      f.projectId = e.project_id || f.projectId;
      f.issues = Array.isArray(e.issues) ? e.issues.length : f.issues;
      f.mock = !!e.mock;
    } else if (e.type === 'workflow.finished') {
      f.end = t;
      f.status = e.status || 'failed';
      f.cost = Number(e.summary?.cost_usd) || 0;
    } else if (e.type === 'approval.requested') gates.set(e.approval_id, { requested: t, resolved: null, by: null });
    else if (e.type === 'approval.resolved' && gates.has(e.approval_id) && !e.withdrawn) Object.assign(gates.get(e.approval_id), { resolved: t, by: e.by || null });
  }
  f.gates = [...gates.values()];
  return f;
}

const quantile = (list, q) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
const stats = (list) => ({ median: quantile(list, 0.5), p90: quantile(list, 0.9), count: list.length });
const ratio = (a, b) => (b ? a / b : null);
// the union of intervals [a, b] (ms), merged
function union(list) {
  const s = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) { const last = out.at(-1); if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  return out;
}
const covers = (list, t) => list.some(([a, b]) => t >= a && t < b);
const total = (list) => list.reduce((n, [a, b]) => n + (b - a), 0);

/**
 * The active time of runs (runFacts) inside [w0, w1]: each run from its start to its end (w1 while it
 * runs), minus the time it waited at a human gate. → { active, gates } merged intervals [a, b] (ms).
 * One implementation for the Night watch and the 24/7 meter (src/occupancy.js).
 */
function activeIntervals(facts, w0, w1) {
  const clip = ([a, b]) => [Math.max(a, w0), Math.min(b, w1)];
  const gates = union(facts.flatMap((f) => f.gates.map((g) => clip([g.requested, g.resolved ?? f.end ?? w1]))));
  const active = union(facts.map((f) => clip([f.start, f.end ?? w1])).flatMap(([a, b]) => {
    let pieces = [[a, b]];
    for (const [ga, gb] of gates) pieces = pieces.flatMap(([x, y]) => (gb <= x || ga >= y ? [[x, y]] : [[x, ga], [gb, y]]).filter(([p, q]) => q > p));
    return pieces;
  }));
  return { active, gates };
}

/**
 * The metrics of one night. `night` from nightsOf; `log` the whole night log; `runs` [{ runId,
 * events }] (the runs' events.jsonl) or their runFacts; `usage` the Oracle's usage.jsonl lines.
 * Window W = startedAt → endedAt (or the
 * end time; `now` while it is on). Durations are in ms, money in US$.
 */
function nightMetrics({ night, log = [], runs = [], usage = [], now = Date.now(), resolveWindowMs = RESOLVE_WINDOW_MS, loopCap = LOOP_CAP }) {
  const w0 = ms(night.startedAt);
  const w1 = Math.min(ms(night.endedAt || night.until), now);
  const span = Math.max(0, w1 - w0);
  const inW = (t) => t >= w0 && t <= w1;
  const entries = log.filter((e) => inW(ms(e.ts)));
  const of = (type) => entries.filter((e) => e.type === type);
  const facts = runs.map((r) => (r.events ? runFacts(r.runId, r.events) : r)).filter((f) => f.start != null && f.start <= w1 && (f.end == null || f.end >= w0));
  const byRun = new Map(facts.map((f) => [f.runId, f]));
  const clip = ([a, b]) => [Math.max(a, w0), Math.min(b, w1)];

  // active time: each run from its start to its end, minus the time it waited at a gate
  const { active, gates: gateIntervals } = activeIntervals(facts, w0, w1);

  // incidents: detected in W; progress resumed = the next progress event of the run, or a new run of its project
  const actions = of('oracle.action');
  const auto = actions.filter((a) => a.auto);
  const undone = new Set(log.filter((e) => e.type === 'oracle.undone').map((e) => e.action_id));
  const escalations = of('oracle.escalated');
  const incidents = of('oracle.detected').map((d) => {
    const t = ms(d.ts);
    const since = Number.isFinite(ms(d.since)) ? Math.min(ms(d.since), t) : t;
    let resumedAt = null;
    let resumedRun = null;
    for (const f of facts) {
      const same = d.runId && f.runId === d.runId;
      const sameProject = d.projectId && f.projectId === d.projectId;
      const next = same ? f.progress.find((p) => p > t) : sameProject && f.start > t ? f.start : undefined;
      if (next != null && next <= w1 && (resumedAt == null || next < resumedAt)) { resumedAt = next; resumedRun = f.runId; }
    }
    // an action answers the incidents of its run or project detected shortly before it
    const near = (x) => ms(x.ts) >= t && ms(x.ts) - t <= resolveWindowMs;
    const sameTarget = (x) => (d.runId && x.runId === d.runId) || (d.projectId && x.projectId === d.projectId) || (!d.runId && !d.projectId && x.target === d.target);
    const fix = auto.find((a) => near(a) && sameTarget(a) && a.ok !== false);
    const after = resumedRun ? byRun.get(resumedRun) : null;
    const endedBad = after && ['cancelled', 'failed', 'interrupted'].includes(after.status);
    const resolved = !!(fix && resumedAt != null && resumedAt >= ms(fix.ts) && resumedAt - ms(fix.ts) <= resolveWindowMs && !endedBad);
    const escalated = escalations.some((x) => near(x) && (sameTarget(x) || (d.runId && x.target === d.runId)));
    // only slow: a stall that progressed again by itself, without an action, and did not fail
    const falseAlarm = d.kind === 'stalled' && !fix && resumedAt != null && resumedAt - t <= resolveWindowMs && !endedBad && !(byRun.get(d.runId)?.status === 'failed');
    return { id: d.id, kind: d.kind, target: d.target, runId: d.runId || null, projectId: d.projectId || null, since, detectedAt: t, resumedAt, resumedRun, actionId: fix?.actionId || null, resolved, escalated, falseAlarm };
  });
  const n = incidents.length;
  const resolved = incidents.filter((i) => i.resolved);
  const ttd = incidents.map((i) => i.detectedAt - i.since);
  // TTR: every incident whose item progressed again in W, whoever unblocked it
  const resumed = incidents.filter((i) => i.resumedAt != null);
  const ttr = resumed.map((i) => i.resumedAt - i.detectedAt);

  // idle hours by cause: W minus the active time, each moment given to its first cause
  const blocked = incidents.filter((i) => i.kind !== 'roadmap-empty').map((i) => clip([i.since, i.resumedAt ?? w1]));
  const empty = incidents.filter((i) => i.kind === 'roadmap-empty').map((i) => clip([i.since, i.resumedAt ?? w1]));
  const cuts = [...new Set([w0, w1, ...[...active, ...gateIntervals, ...blocked, ...empty].flat()].filter((t) => t >= w0 && t <= w1))].sort((a, b) => a - b);
  const idle = { noWork: 0, blocked: 0, gate: 0, other: 0 };
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [a, b] = [cuts[k], cuts[k + 1]];
    const mid = (a + b) / 2;
    if (covers(active, mid)) continue;
    const cause = covers(gateIntervals, mid) ? 'gate' : covers(blocked, mid) ? 'blocked' : covers(empty, mid) ? 'noWork' : 'other';
    idle[cause] += b - a;
  }
  const activeMs = total(active);

  // the runs that ran because of a watch action (the run that resumed a resolved incident)
  const unblockedRuns = [...new Set(resolved.map((i) => i.resumedRun))].map((id) => byRun.get(id)).filter(Boolean);
  const unblockedActive = total(union(unblockedRuns.map((f) => clip([f.start, f.end ?? w1]))));

  // human gates opened in W
  const gates = facts.flatMap((f) => f.gates.filter((g) => inW(g.requested)).map((g) => ({ ...g, runId: f.runId })));
  const gateWait = gates.reduce((s, g) => s + ((g.resolved ?? w1) - g.requested), 0);

  // loops: more than `loopCap` watch actions on one target
  const perTarget = new Map();
  for (const a of auto) perTarget.set(a.target, (perTarget.get(a.target) || 0) + 1);
  const loops = [...perTarget.entries()].filter(([, c]) => c > loopCap).map(([target, count]) => ({ target, count }));

  // precision: actions undone by the owner, and those after which the item ended worse
  const worse = auto.filter((a) => {
    const f = a.runId ? byRun.get(a.runId) : null;
    const next = f || facts.filter((x) => a.projectId && x.projectId === a.projectId && x.start >= ms(a.ts)).sort((x, y) => x.start - y.start)[0];
    return next && next.end != null && next.end >= ms(a.ts) && ['failed', 'interrupted'].includes(next.status);
  });

  // cost: the Oracle's own turns in W, against the runs'
  const oracleUse = usage.filter((u) => inW(ms(u.ts)));
  const watchUsd = oracleUse.reduce((s, u) => s + (Number(u.costUsd) || 0), 0);
  const watchTokens = oracleUse.reduce((s, u) => s + Object.values(u.tokens || {}).reduce((x, v) => x + (Number(v) || 0), 0), 0);
  const runsUsd = facts.filter((f) => inW(f.start)).reduce((s, f) => s + f.cost, 0);
  // one recovery can resolve several incidents (a failed run and the roadmap it paused): counted once
  const recoveries = new Map(resolved.map((i) => [`${i.resumedRun} ${i.resumedAt}`, i.resumedAt]));
  const hoursSaved = [...recoveries.values()].reduce((s, t) => s + Math.max(0, w1 - t), 0) / 36e5;

  // safety: gates crossed by automation, never-allowed actions, refusals
  const gatesCrossed = facts.flatMap((f) => f.gates).filter((g) => g.resolved != null && inW(g.resolved) && ['oracle', 'night-watch'].includes(g.by)).length;
  const neverActions = actions.filter((a) => a.auto && (!a.permission || NEVER_ALLOWED.some((x) => x.id === a.permission))).length;
  const blockedLog = of('oracle.blocked');
  const delivered = facts.filter((f) => f.end != null && inW(f.end) && f.status === 'success');

  return {
    window: { from: new Date(w0).toISOString(), to: new Date(w1).toISOString(), hours: span / 36e5, by: night.by || null, ongoing: !night.endedAt && ms(night.until) > now },
    incidents: { count: n, byKind: Object.fromEntries(Object.keys(INCIDENT_KINDS).map((k) => [k, incidents.filter((i) => i.kind === k).length])), list: incidents },
    autonomy: ratio(auto.length, n),
    escalation: ratio(incidents.filter((i) => i.escalated).length, n),
    escalations: escalations.length,
    resolution: ratio(resolved.length, n),
    resolved: resolved.length,
    ttd: stats(ttd),
    ttr: stats(ttr),
    blockedTime: stats(resumed.map((i) => i.resumedAt - i.since)),
    activeHours: activeMs / 36e5,
    idleHours: { total: (span - activeMs) / 36e5, noWork: idle.noWork / 36e5, blocked: idle.blocked / 36e5, gate: idle.gate / 36e5, other: idle.other / 36e5 },
    hoursSaved,
    unblocked: { runs: unblockedRuns.map((f) => f.runId), issues: unblockedRuns.reduce((s, f) => s + f.issues, 0), usd: unblockedRuns.reduce((s, f) => s + f.cost, 0) },
    gates: { count: gates.length, waitMs: gateWait, open: gates.filter((g) => g.resolved == null).length },
    actions: { auto: auto.length, undone: auto.filter((a) => undone.has(a.actionId)).length, worse: worse.length },
    precision: auto.length ? 1 - auto.filter((a) => undone.has(a.actionId)).length / auto.length : null,
    loops,
    falseAlarms: ratio(incidents.filter((i) => i.falseAlarm).length, n),
    cost: { watchUsd, watchTokens, runsUsd, perResolved: ratio(watchUsd, resolved.length), perHourSaved: hoursSaved ? watchUsd / hoursSaved : null },
    yield: {
      issues: delivered.reduce((s, f) => s + f.issues, 0), perHour: span ? delivered.reduce((s, f) => s + f.issues, 0) / (span / 36e5) : null,
      occupancy: span ? activeMs / span : null, occupancyWithoutWatch: span ? Math.max(0, activeMs - unblockedActive) / span : null,
    },
    safety: {
      gatesCrossed, neverActions,
      blockedOutsidePermissions: blockedLog.filter((b) => b.reason === 'permission').length,
      contentRefused: blockedLog.filter((b) => b.reason === 'content').length,
      loopsCapped: blockedLog.filter((b) => b.reason === 'loop').length,
      alarm: gatesCrossed > 0 || neverActions > 0,
    },
    timeline: {
      runs: facts.map((f) => ({ runId: f.runId, from: new Date(Math.max(f.start, w0)).toISOString(), to: new Date(Math.min(f.end ?? w1, w1)).toISOString(), status: f.status })),
      incidents: incidents.map((i) => ({ at: new Date(i.detectedAt).toISOString(), kind: i.kind, target: i.target, resolved: i.resolved })),
      actions: actions.map((a) => ({ at: a.ts, title: a.title || a.kind, ok: a.ok !== false, auto: !!a.auto })),
    },
    actionList: actions.map((a) => ({
      actionId: a.actionId, at: a.ts, kind: a.kind, title: a.title || a.kind, target: a.target, permission: a.permission || null, auto: !!a.auto,
      backup: a.backup || null, result: a.result || '', ok: a.ok !== false, undone: undone.has(a.actionId), undoable: !!a.undoable && !undone.has(a.actionId),
    })),
  };
}

/** The morning summary's lines (the notification and the Dashboard card): what ran, what the watch did, what waits, safety. */
function morningSummary(m, { proposed = 0 } = {}) {
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const s = m.safety;
  return {
    ran: `${m.timeline.runs.length} run(s), ${m.yield.issues} issue(s) delivered, ${m.activeHours.toFixed(1)} h active of ${m.window.hours.toFixed(1)} h.`,
    did: `${m.incidents.count} incident(s), ${m.actions.auto} action(s) without asking, ${m.resolved} resolved (${pct(m.resolution)}), ${m.escalations} escalated.`,
    waits: `${m.gates.open} gate(s) open, ${proposed} proposed action(s) waiting for your click.`,
    safety: s.alarm
      ? `Safety alarm: ${s.gatesCrossed} gate(s) crossed, ${s.neverActions} never-allowed action(s).`
      : `Safety: no gate crossed, nothing pushed, closed or deleted; ${s.blockedOutsidePermissions} action(s) outside your permissions blocked, ${s.contentRefused} instruction(s) from content refused.`,
    alarm: s.alarm,
  };
}

module.exports = {
  activeIntervals,
  BASELINE,
  covers,
  DEFAULT_PERMISSIONS,
  INCIDENT_KINDS,
  incidentOf,
  LOG_TYPES,
  logNight,
  LOOP_CAP,
  morningSummary,
  NEVER_ALLOWED,
  nightMetrics,
  nightsOf,
  permissionOf,
  PERMISSIONS,
  PROGRESS_EVENTS,
  readNightLog,
  readPermissions,
  RESOLVE_WINDOW_MS,
  roadmapIncidents,
  runFacts,
  savePermissions,
  STALL_MS,
  stalledRuns,
  targetOf,
  total,
  union,
};
