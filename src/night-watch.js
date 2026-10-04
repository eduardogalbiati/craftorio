// Night watch (#172): what the owner lets the Oracle do without asking during the night, the Oracle's
// own log of the night, and the night's metrics. No service here: the files and pure functions that
// src/oracle.js (the decision to act alone), src/service/channels/nightwatch.js (detection, the
// screen, the morning summary) and the Night watch screen (views/nightwatch/) share.
//
// Its files, in <workspace>/oracle/ next to night-watch.json (the switch, src/oracle-actions.js):
//   night-permissions.json  { allowed: [permission id], updatedAt }: the owner's checklist
//   night-log.jsonl         the Oracle's events while the watch is on, one per line { ts, type, ... }:
//     oracle.watch      { on, until, startedAt, by }      the switch turned on (or its end time moved) or off;
//                       with selfHealing: true (#278) the standing watch of Settings › Oracle (until null)
//     oracle.detected   { id, kind, target, runId, projectId, since, evidence? }   an anomaly (INCIDENT_KINDS);
//                       evidence: what a Self-healing detector saw (the command, the test files, the turn)
//     oracle.action     { actionId, kind, title, target, runId, projectId, permission, auto, backup, result, ok }
//     oracle.escalated  { target, recommendation, reason, actionId? }   left for the owner (a gate, a refused action)
//     oracle.blocked    { actionId, kind, target, reason: permission | content | loop }   an action it could not take alone
//     oracle.undone     { action_id }                     the owner undid an action
// Every metric (nightMetrics) is computed from that log and the runs' events.jsonl; nothing is
// estimated, except "hours saved", which is labelled as an estimate.
// Self-healing (#278, settings.oracle.selfHealing): the same watch with no end time. Its detectors
// (detectSelfHealing: memory, cost-gap, environment, repeat) are pure functions over the runs' events;
// its report is per UTC day (selfHealingDays → nightMetrics, selfHealingMetrics).

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
  // #278: a finished turn recorded at US$ 0 with tokens, or below a usage item of the same turn (#277)
  'cost-gap': 'Turn recorded below its cost',
  'dispatch-idle': 'Dispatch idle with planned items',
  // #278: test files failing in runs of different issues within one hour, passing on the base
  environment: 'Tests failing across runs (environment)',
  failed: 'Failed run',
  interrupted: 'Run interrupted or duplicated',
  limit: 'Paused by a limit',
  // #276: the engine's memory guard stopped a run's process or held a suite / run for low memory;
  // the engine already acted, the watch only records it
  memory: 'Process stopped or run held for memory',
  // #278: the same command failing or stopped REPEAT_TIMES times in one step of a run
  repeat: 'Same command failing repeatedly',
  'roadmap-empty': 'Roadmap empty',
  'roadmap-paused': 'Roadmap paused or in error',
  stalled: 'Stalled run',
};
const LOG_TYPES = ['oracle.action', 'oracle.blocked', 'oracle.detected', 'oracle.escalated', 'oracle.undone', 'oracle.watch'];
const STALL_LOGS = new Set(['agent_idle', 'loop_blocked', 'stall']);
// a low-memory hold (memory.hold) longer than this is an incident
const MEMORY_HOLD_MS = 5 * 60e3;
const PROGRESS_EVENTS = new Set(['step.finished', 'step.started', 'workflow.started']);
// Self-healing (#278): a command failing or stopped this many times in one step is a `repeat` incident
const REPEAT_TIMES = 3;
// ... and a test file failing in runs of different issues within this time is an `environment` incident
const ENVIRONMENT_WINDOW_MS = 3600e3;
const DAY_MS = 24 * 3600e3;
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

/** The permission an action card (or an owner's request kind, #241) needs to run alone, or null (it always waits for the owner's click). */
function permissionOf(kind, params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  switch (kind) {
    case 'roadmap.item': return p.action === 'skip' ? 'skip' : p.fresh ? 'fresh-start' : 'retry';
    case 'roadmap.skip': return 'skip';
    case 'roadmap.add': return 'append';
    case 'roadmap.move': return 'regroup';
    case 'roadmap.regroup':
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
    case 'process.killed': return 'memory';
    case 'memory.hold': return ev.waited_ms > MEMORY_HOLD_MS ? 'memory' : null;
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

/** The nights in the log: [{ startedAt, until, endedAt, by }] (endedAt null while it is on). The standing watch (#278) is not a night: selfHealingDays. */
function nightsOf(log) {
  const nights = [];
  for (const e of log) {
    if (e.type !== 'oracle.watch' || e.selfHealing) continue;
    const last = nights.at(-1);
    if (e.on) {
      if (last && !last.endedAt && last.startedAt === e.startedAt) last.until = e.until;
      else nights.push({ startedAt: e.startedAt || e.ts, until: e.until, endedAt: null, by: e.by || null });
    } else if (last && !last.endedAt) last.endedAt = Date.parse(e.ts) < Date.parse(last.until) ? e.ts : last.until;
  }
  return nights;
}

// ---- Self-healing (#278) ---------------------------------------------------------------------
const tokensOf = (usage) => Object.values(usage || {}).reduce((s, v) => s + (Number(v) || 0), 0);
const clipped = (s, n = 300) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
// runs of different issues: no issue in common (two runs without issues are not told apart)
const differentIssues = (a, b) => (a.length || b.length) && !a.some((n) => b.includes(n));

/**
 * What the Self-healing detectors read of a run event, for the watch's per-run buffer (the service
 * keeps these, not the whole stream): { event (only the fields detectSelfHealing reads), trigger
 * (an event that can complete a finding: the detectors run again) } or null for any other event.
 */
function selfHealingEvent(ev) {
  const base = { ts: ev?.ts, type: ev?.type };
  switch (ev?.type) {
    case 'workflow.started': return { event: { ...base, project_id: ev.project_id || null, issues: ev.issues || [], mock: !!ev.mock }, trigger: false };
    case 'session.message_sent': return { event: { ...base, session_id: ev.session_id, turn: ev.turn, step_id: ev.step_id }, trigger: false };
    case 'session.message_received': return { event: { ...base, session_id: ev.session_id, turn: ev.turn, step_id: ev.step_id, usage: ev.usage, cost_usd: ev.cost_usd }, trigger: true };
    case 'session.stream': {
      const item = ev.item || {};
      const turn = { ...base, session_id: ev.session_id, turn: ev.turn };
      if (item.kind === 'usage') return { event: { ...turn, item: { kind: 'usage', costUsd: item.costUsd } }, trigger: false };
      if (item.kind === 'tool_call' && typeof item.input?.command === 'string') return { event: { ...turn, item: { kind: 'tool_call', id: item.id, input: { command: item.input.command } } }, trigger: false };
      if (item.kind === 'tool_result' && item.is_error) return { event: { ...turn, item: { kind: 'tool_result', id: item.id, is_error: true, output: clipped(item.output) } }, trigger: true };
      return null;
    }
    case 'process.killed':
    case 'memory.hold': return { event: ev, trigger: true };
    case 'step.finished': {
      const o = ev.output;
      if (o?.kind !== 'suite') return null;
      return { event: { ...base, step_id: ev.step_id, output: { kind: 'suite', failures: o.failures || [], preexisting: o.preexisting || [], base_check: o.base_check || null } }, trigger: true };
    }
    default: return null;
  }
}

/**
 * The Self-healing detectors: `runs` [{ runId, events }] (each run's events.jsonl lines, or their
 * selfHealingEvent copies) → [{ kind, runId, projectId, since, evidence }], at most one per run and
 * kind; `since` is the ts of the first event that shows it, `evidence` what was seen.
 *   memory       a process stopped by the memory guard, or a low-memory hold over MEMORY_HOLD_MS (#276)
 *   cost-gap     a turn recorded at US$ 0 with tokens, or below a usage item of the same turn (#277);
 *                never in a simulated run, nor for a CLI that reports no cost (cost_usd null)
 *   environment  a test file failing in the suite (passing on the base: the base check ran and the
 *                file is not in `preexisting`) of two runs of different issues within ENVIRONMENT_WINDOW_MS
 *   repeat       the same command failing (a tool call's result with is_error) or stopped by the
 *                memory guard REPEAT_TIMES times in one step
 */
function detectSelfHealing(runs = []) {
  const byRun = new Map(); // run id → { projectId, found: Map kind → finding }
  const suites = []; // { runId, issues, file, ts }: a file failing in a run's suite and passing on the base
  for (const { runId, events = [] } of runs) {
    const run = { projectId: null, found: new Map() };
    byRun.set(runId, run);
    const add = (kind, since, evidence) => { if (!run.found.has(kind)) run.found.set(kind, { kind, runId, projectId: null, since, evidence }); };
    let issues = [];
    let mock = false;
    const stepOf = new Map(); // `${session} ${turn}` → step id
    const usageUsd = new Map(); // `${session} ${turn}` → the highest cost a usage item reported
    const calls = new Map(); // `${session} ${turn} ${tool call id}` → { command, step }
    const failures = new Map(); // `${step}\n${command}` → { command, step, times, since, last }
    const turns = [];
    let repeat = null;
    const failed = (step, command, ev, output) => {
      const key = `${step}\n${command}`;
      const f = failures.get(key) || { command, step, times: 0, since: ev.ts, last: '' };
      f.times += 1;
      f.last = clipped(output);
      failures.set(key, f);
      if (f.times >= REPEAT_TIMES) repeat ??= f;
    };
    for (const ev of events) {
      const turn = `${ev.session_id} ${ev.turn}`;
      switch (ev.type) {
        case 'workflow.started':
          run.projectId = ev.project_id || run.projectId;
          issues = (Array.isArray(ev.issues) ? ev.issues : []).map((i) => i?.number ?? i).filter((n) => n != null);
          mock = !!ev.mock;
          break;
        case 'session.message_sent': stepOf.set(turn, ev.step_id); break;
        case 'session.message_received': turns.push(ev); break;
        case 'session.stream': {
          const item = ev.item || {};
          const call = `${turn} ${item.id}`;
          if (item.kind === 'usage') usageUsd.set(turn, Math.max(usageUsd.get(turn) || 0, Number(item.costUsd) || 0));
          else if (item.kind === 'tool_call' && typeof item.input?.command === 'string') calls.set(call, { command: item.input.command.trim(), step: stepOf.get(turn) ?? turn });
          else if (item.kind === 'tool_result' && item.is_error && calls.has(call)) failed(calls.get(call).step, calls.get(call).command, ev, item.output);
          break;
        }
        case 'process.killed':
          add('memory', ev.ts, { event: ev.type, command: ev.command_line || null, step: ev.step_id || null, bytes: ev.bytes ?? null, limitBytes: ev.limit_bytes ?? null });
          if (ev.command_line) failed(ev.step_id || '', String(ev.command_line).trim(), ev, 'Stopped by the memory guard.');
          break;
        case 'memory.hold':
          if (incidentOf(ev)) add('memory', ev.ts, { event: ev.type, step: ev.step_id || null, waitedMs: ev.waited_ms, freeBytes: ev.free_bytes ?? null, floorBytes: ev.floor_bytes ?? null });
          break;
        case 'step.finished': {
          const o = ev.output;
          if (o?.kind !== 'suite' || !o.base_check || o.base_check.ran === false) break;
          const onBase = new Set((o.preexisting || []).map((f) => f.file));
          for (const file of new Set((o.failures || []).map((f) => f.file).filter((f) => f && !onBase.has(f)))) suites.push({ runId, issues, file, ts: ev.ts });
          break;
        }
        default:
      }
    }
    // a CLI that reports no cost (cost_usd null: Codex) has no cost to lose: only a recorded 0 counts
    const gaps = mock ? [] : turns.filter((ev) => {
      const cost = Number(ev.cost_usd) || 0;
      return (ev.cost_usd != null && cost === 0 && tokensOf(ev.usage) > 0) || (usageUsd.get(`${ev.session_id} ${ev.turn}`) || 0) > cost + 1e-9;
    });
    if (gaps.length) {
      const g = gaps[0];
      add('cost-gap', g.ts, { step: g.step_id || null, session: g.session_id ?? null, turn: g.turn ?? null, recordedUsd: Number(g.cost_usd) || 0, usageUsd: usageUsd.get(`${g.session_id} ${g.turn}`) || 0, tokens: tokensOf(g.usage), turns: gaps.length });
    }
    if (repeat) add('repeat', repeat.since, { command: repeat.command, step: repeat.step || null, times: repeat.times, lastOutput: repeat.last });
  }
  for (const a of suites) {
    const others = suites.filter((b) => b.runId !== a.runId && b.file === a.file && Math.abs(ms(b.ts) - ms(a.ts)) <= ENVIRONMENT_WINDOW_MS && differentIssues(a.issues, b.issues));
    if (!others.length) continue;
    const { found } = byRun.get(a.runId);
    const f = found.get('environment') || { kind: 'environment', runId: a.runId, projectId: null, since: a.ts, evidence: { files: [], runs: [], issues: a.issues } };
    if (a.ts < f.since) f.since = a.ts;
    f.evidence.files = [...new Set([...f.evidence.files, a.file])].sort();
    f.evidence.runs = [...new Set([...f.evidence.runs, ...others.map((b) => b.runId)])].sort();
    found.set('environment', f);
  }
  return [...byRun.values()].flatMap((run) => [...run.found.values()].sort((a, b) => (a.kind < b.kind ? -1 : 1)).map((f) => ({ ...f, projectId: run.projectId })));
}

/**
 * The standing watch's days (#278) as windows nightMetrics reads, oldest first: [{ day (UTC,
 * YYYY-MM-DD), startedAt, until (the day's end), endedAt (the switch turned off that day, else
 * null), by, selfHealing: true }], from the log's oracle.watch entries with selfHealing.
 */
function selfHealingDays(log, now = Date.now()) {
  const days = new Map();
  const span = (from, to, ended) => {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    let d =Date.parse(`${new Date(from).toISOString().slice(0, 10)}T00:00:00.000Z`);
    do {
      const day = new Date(d).toISOString().slice(0, 10);
      const endedAt = ended && to <= d + DAY_MS ? new Date(to).toISOString() : null;
      days.set(day, { day, startedAt: days.get(day)?.startedAt || new Date(Math.max(from, d)).toISOString(), until: new Date(d + DAY_MS).toISOString(), endedAt, by: 'Self-healing', selfHealing: true });
      d += DAY_MS;
    } while (d < to);
  };
  let start = null;
  for (const e of log) {
    if (e.type !== 'oracle.watch' || !e.selfHealing) continue;
    const t = Number.isFinite(ms(e.startedAt)) && e.on ? ms(e.startedAt) : ms(e.ts);
    if (e.on) { if (start == null && Number.isFinite(t)) start = t; } else if (start != null) { span(start, t, true); start = null; }
  }
  if (start != null) span(start, now, false);
  return [...days.values()];
}

/**
 * Self-healing's report of one UTC day (YYYY-MM-DD): { day, detected (oracle.detected), repaired
 * (actions taken alone that did not fail), waiting (left for the owner: oracle.escalated, and the
 * actions blocked in an owner's inbox), costUsd, tokens (the Oracle's usage.jsonl lines of the day) }.
 */
function selfHealingMetrics({ log = [], usage = [], day }) {
  const on = (e) => String(e.ts).slice(0, 10) === day;
  const entries = log.filter(on);
  const escalated = entries.filter((e) => e.type === 'oracle.escalated');
  const asked = new Set(escalated.map((e) => e.actionId).filter(Boolean));
  const use = usage.filter(on);
  return {
    day,
    detected: entries.filter((e) => e.type === 'oracle.detected').length,
    repaired: entries.filter((e) => e.type === 'oracle.action' && e.auto && e.ok !== false).length,
    waiting: escalated.length + entries.filter((e) => e.type === 'oracle.blocked' && !asked.has(e.actionId)).length,
    costUsd: use.reduce((s, u) => s + (Number(u.costUsd) || 0), 0),
    tokens: use.reduce((s, u) => s + tokensOf(u.tokens), 0),
  };
}

/** A Self-healing day in one line (the Dashboard's morning card, the Night watch screen). */
function selfHealingSummary(d) {
  return `Self-healing on ${d.day}: ${d.detected} detected, ${d.repaired} repaired alone, ${d.waiting} waiting for you, US$ ${d.costUsd.toFixed(2)} (${d.tokens.toLocaleString('en-US')} tokens).`;
}

/** A run's facts from its events:{ runId, projectId, start, end, status, cost, issues, progress, gates }. */
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
    did: `${m.incidents.count} incident(s)${m.incidents.byKind?.memory ? ` (${m.incidents.byKind.memory} memory: a process stopped or a run held by the memory guard)` : ''}, ${m.actions.auto} action(s) without asking, ${m.resolved} resolved (${pct(m.resolution)}), ${m.escalations} escalated.`,
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
  detectSelfHealing,
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
  selfHealingDays,
  selfHealingEvent,
  selfHealingMetrics,
  selfHealingSummary,
  STALL_MS,
  stalledRuns,
  targetOf,
  total,
  union,
};
