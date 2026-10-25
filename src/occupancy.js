// The 24/7 meter (#188): how much of the time at least one real run is active, why the rest was idle,
// and what the active time costs. Pure and local (no model call, no network): the service
// (src/service/areas/occupancy.js) feeds it the runs' events, the app's heartbeat log and the Night
// watch's nights; Analytics' 24/7 tab and the top bar chip (src/renderer/occupancy-chip.js) show it.
// The interval logic (active = run time minus gate waits) is src/domains/night/night-watch.js's activeIntervals, so
// the Night watch and this meter agree inside a night.
//
// Idle causes, each idle moment given to the first that applies:
//   gate       a run is open at a human gate ("waiting for you")
//   appClosed  no app heartbeat (the app was closed or the machine asleep), when the app log is known
//   blocked    a Night watch incident other than "roadmap empty", or the time after a run that failed
//   noWork     nothing ran and nothing was blocked: nothing queued or planned
//   other      the time after a run the owner cancelled

const {
  activeIntervals,
  covers,
  runFacts,
  total,
  union,
} = require('./domains/night/night-watch');
const TimeZone = require('./domains/analytics/time-zone');

const HOUR = 36e5;
const GAP_MIN = 15;
const CAUSES = ['noWork', 'blocked', 'gate', 'appClosed', 'other'];
// a cause holding more than this share of the idle time gets a hint
const DOMINANT = 0.5;
const HINTS = {
  noWork: { text: 'Most idle time had no work queued: plan the next items in the Live roadmap.', view: 'roadmap' },
  appClosed: { text: 'Most idle time the app was closed or the machine asleep: turn on Keep Awake.', view: 'settings', tab: 'execution' },
  gate: { text: 'Most idle time runs waited for you at a gate: schedule validated items for the day, not the night.', view: 'nightwatch' },
};

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t || ''));
const emptyIdle = () => Object.fromEntries(CAUSES.map((c) => [c, 0]));

// The time of `segments` ({ a, b, cause }, cause 'active' or an idle cause) inside the intervals `within`.
function measure(segments, within) {
  const out = { span: 0, active: 0, idle: emptyIdle() };
  for (const [wa, wb] of within) {
    out.span += wb - wa;
    for (const s of segments) {
      const d = Math.min(s.b, wb) - Math.max(s.a, wa);
      if (d <= 0) continue;
      if (s.cause === 'active') out.active += d; else out.idle[s.cause] += d;
    }
  }
  return out;
}

const hoursOf = (m) => {
  const idle = Object.fromEntries(CAUSES.map((c) => [c, m.idle[c] / HOUR]));
  return { hours: m.span / HOUR, activeHours: m.active / HOUR, occupancy: m.span ? m.active / m.span : null, idleHours: { total: (m.span - m.active) / HOUR, ...idle } };
};

/**
 * The meter over a window. `runs` [{ runId, events }] (events.jsonl) or their runFacts (night-watch);
 * `from`/`to` the window (ISO or ms, `to` capped at `now`); `appSessions` [{ start, end }] the times
 * the app ran (null: unknown, no "app closed" time); `nights` [{ startedAt, until, endedAt }] the
 * Night watch windows; `log` the Night watch log (its incidents say "blocked" or "no work");
 * `lines` run id → lines changed (for the cost per 100 lines); `timeZone` the owner's zone
 * (settings.timeZone, #273; unset: the computer's), where its days start.
 */
function occupancyOf({ runs = [], from, to, now = Date.now(), appSessions = null, nights = [], log = [], lines = {}, timeZone = null }) {
  const w0 = ms(from);
  const w1 = Math.max(w0, Math.min(ms(to), now));
  const span = w1 - w0;
  const clip = ([a, b]) => [Math.max(a, w0), Math.min(b, w1)];
  const facts = runs.map((r) => (r.events ? runFacts(r.runId, r.events) : r))
    .filter((f) => !f.mock && f.start != null && f.start <= w1 && (f.end == null || f.end >= w0));
  const { active, gates } = activeIntervals(facts, w0, w1);

  const appUp = Array.isArray(appSessions) ? union(appSessions.map((s) => clip([ms(s.start), ms(s.end ?? now)]))) : null;
  const incidents = log.filter((e) => e.type === 'oracle.detected');
  const resumeOf = (d) => facts.map((f) => f.start).filter((t) => t > ms(d.ts)).sort((a, b) => a - b)[0] ?? w1;
  const blocked = union([
    ...incidents.filter((d) => d.kind !== 'roadmap-empty').map((d) => clip([ms(d.since || d.ts), resumeOf(d)])),
    // a failed item blocks its project until the next run starts
    ...facts.filter((f) => f.end != null && ['failed', 'interrupted'].includes(f.status)).map((f) => clip([f.end, facts.map((x) => x.start).filter((t) => t > f.end).sort((a, b) => a - b)[0] ?? w1])),
  ]);
  const cancelled = union(facts.filter((f) => f.end != null && f.status === 'cancelled').map((f) => clip([f.end, facts.map((x) => x.start).filter((t) => t > f.end).sort((a, b) => a - b)[0] ?? w1])));

  // the window cut where any of the intervals changes; each piece gets one state
  const cuts = [...new Set([w0, w1, ...[...active, ...gates, ...(appUp || []), ...blocked, ...cancelled].flat()].filter((t) => t >= w0 && t <= w1))].sort((a, b) => a - b);
  const segments = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [a, b] = [cuts[k], cuts[k + 1]];
    const mid = (a + b) / 2;
    const cause = covers(active, mid) ? 'active'
      : covers(gates, mid) ? 'gate'
        : appUp && !covers(appUp, mid) ? 'appClosed'
          : covers(blocked, mid) ? 'blocked'
            : covers(cancelled, mid) ? 'other' : 'noWork';
    const last = segments.at(-1);
    if (last && last.cause === cause && last.b === a) last.b = b; else segments.push({ a, b, cause });
  }
  const whole = hoursOf(measure(segments, span ? [[w0, w1]] : []));
  const activeMs = total(active);

  // concurrency: the peak of real runs at once, and the average while at least one is active
  const pieces = facts.map((f) => clip([f.start, f.end ?? w1])).filter(([a, b]) => b > a);
  const points = pieces.flatMap(([a, b]) => [[a, 1], [b, -1]]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let level = 0;
  let peakConcurrent = 0;
  for (const [, d] of points) { level += d; peakConcurrent = Math.max(peakConcurrent, level); }
  const runTime = facts.reduce((s, f) => s + total(activeIntervals([f], w0, w1).active), 0);

  // idle gaps over 15 min, with what ended them
  const startAt = (t) => facts.find((f) => f.start === t);
  const gaps = segments.filter((s) => s.cause !== 'active' && (s.b - s.a) / 60e3 > GAP_MIN).map((s) => ({
    from: new Date(s.a).toISOString(), to: new Date(s.b).toISOString(), minutes: (s.b - s.a) / 60e3, cause: s.cause,
    endedBy: s.b >= w1 ? null : startAt(s.b) ? `run ${startAt(s.b).runId} started`
      : s.cause === 'gate' ? 'the gate was answered' : s.cause === 'appClosed' ? 'the app started' : 'a run went on',
  }));

  // the current streak of active time, and how long it has been idle
  const last = segments.at(-1);
  const running = facts.some((f) => f.end == null && !f.gates.some((g) => g.resolved == null));
  const streakMinutes = last?.cause === 'active' && last.b >= w1 ? (last.b - last.a) / 60e3 : 0;
  const idleNowMinutes = last && last.cause !== 'active' ? (last.b - last.a) / 60e3 : 0;

  // the owner's local days, hour by hour
  const days = [];
  for (let d = TimeZone.startOfDay(w0, timeZone); d < w1; d = TimeZone.nextDay(d, timeZone)) {
    const e = TimeZone.nextDay(d, timeZone);
    const m = measure(segments, [[Math.max(d, w0), Math.min(e, w1)]].filter(([a, b]) => b > a));
    // one slot per local hour of the clock: a 23-hour day leaves its skipped hour empty, a 25-hour day
    // adds its repeated hour to the same slot
    const slots = Array.from({ length: 24 }, () => ({ active: 0, span: 0 }));
    for (let h = d; h < e; h += HOUR) {
      const hm = measure(segments, [[Math.max(h, w0), Math.min(h + HOUR, w1)]].filter(([a, b]) => b > a));
      const slot = slots[Number(TimeZone.formatTime(h, timeZone).slice(0, 2)) % 24];
      slot.active += hm.active;
      slot.span += hm.span;
    }
    const inDay = (t) => t >= d && t < e;
    days.push({
      day: TimeZone.dayKey(d, timeZone), ...hoursOf(m), hourly: slots.map((s) => (s.span ? s.active / s.span : null)), partial: d < w0 || e > w1,
      costUsd: facts.filter((f) => inDay(f.start)).reduce((s, f) => s + f.cost, 0),
      issues: facts.filter((f) => f.end != null && f.status === 'success' && inDay(f.end)).reduce((s, f) => s + f.issues, 0),
    });
  }

  // delivered issues and cost per side of the Night watch: a run's cost goes where it started,
  // its issues where it ended
  const delivered = (inside) => facts.filter((f) => f.end != null && f.status === 'success' && inside(f.end));
  const side = (within, inside) => ({
    ...hoursOf(measure(segments, within)),
    runs: facts.filter((f) => inside(f.start)).length,
    issues: delivered(inside).reduce((s, f) => s + f.issues, 0),
    lines: delivered(inside).reduce((s, f) => s + (Number(lines[f.runId]) || 0), 0),
    costUsd: facts.filter((f) => inside(f.start)).reduce((s, f) => s + f.cost, 0),
  });
  const nightIntervals = union(nights.map((n) => clip([ms(n.startedAt), ms(n.endedAt || n.until)])));
  const outsideIntervals = [];
  let cursor = w0;
  for (const [a, b] of nightIntervals) { if (a > cursor) outsideIntervals.push([cursor, a]); cursor = Math.max(cursor, b); }
  if (cursor < w1) outsideIntervals.push([cursor, w1]);
  const all = side(span ? [[w0, w1]] : [], (t) => t >= w0 && t <= w1);

  return {
    window: { from: new Date(w0).toISOString(), to: new Date(w1).toISOString(), hours: span / HOUR },
    empty: !facts.length,
    activeHours: activeMs / HOUR,
    occupancy: span ? activeMs / span : null,
    idleHours: whole.idleHours,
    peakConcurrent,
    avgConcurrent: activeMs ? runTime / activeMs : null,
    running,
    streakMinutes,
    idleNowMinutes,
    gaps,
    longestGap: gaps.reduce((best, g) => (!best || g.minutes > best.minutes ? g : best), null),
    days,
    runs: all.runs,
    issues: all.issues,
    lines: all.lines,
    costUsd: all.costUsd,
    cost: costFigures({ costUsd: all.costUsd, activeHours: activeMs / HOUR, issues: all.issues, lines: all.lines }),
    hint: idleHint(whole.idleHours),
    nightWatch: {
      nights: nightIntervals.length,
      inside: side(nightIntervals, (t) => covers(nightIntervals, t)),
      outside: side(outsideIntervals, (t) => t >= w0 && t <= w1 && !covers(nightIntervals, t)),
    },
  };
}

/** The plain hint of the dominant idle cause (more than half of the idle time), or null. */
function idleHint(idle) {
  if (!idle || !(idle.total > 0)) return null;
  const [cause, hours] = CAUSES.map((c) => [c, idle[c] || 0]).sort((a, b) => b[1] - a[1])[0];
  if (hours / idle.total <= DOMINANT || !HINTS[cause]) return null;
  return { cause, share: hours / idle.total, ...HINTS[cause] };
}

/** "24/7 at what price": cost per active hour, per delivered issue and per 100 lines (null without a denominator). */
function costFigures({ costUsd = 0, activeHours = 0, issues = 0, lines = 0 }) {
  const per = (d, k = 1) => (d > 0 ? (costUsd * k) / d : null);
  return { perActiveHour: per(activeHours), perIssue: per(issues), per100Lines: per(lines, 100) };
}

module.exports = {
  CAUSES,
  costFigures,
  idleHint,
  occupancyOf,
};
