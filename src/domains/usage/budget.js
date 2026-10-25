// The spending budget (#206): an optional cap in US$ per day (the owner's local calendar day,
// settings.timeZone, #273) and per night (the
// Night watch's window, from its start: src/domains/oracle/oracle-actions.js nightWatch), in settings.json
// (`budget: { dailyUsd, nightlyUsd, raised }`, Settings › Budget). Spending is counted from the runs'
// recorded session costs (live runs included: their sessions so far), real runs only; a session with
// no reported cost (Codex) is priced from its tokens × settings.prices (src/domains/usage/usage.js sessionCost) and
// the total is marked `estimated`.
// The cap stops starts, never runs mid-way or gates: before the roadmap starts an item, `overBudget`
// says whether its estimate (src/domains/usage/cost-estimate.js) would pass a cap; the roadmap then pauses with
// `pauseMessage` ("Budget reached: $X of $Y today; next stage ≈ $Z"), and the owner picks "Raise for
// today" (`raiseFor`: today's cap becomes what is spent plus the next stage, `raised` for that day
// or that night only) or "Resume anyway" (the roadmap's `budgetWaived`: that roadmap ignores the cap
// until the day or the night ends). The live roadmap's refills check the same cap
// (src/service/areas/live-roadmap.js). Pure: the service passes the runs and the Night watch state.

const TimeZone = require('../analytics/time-zone');
const { sessionCost } = require('./usage');

const DEFAULTS = Object.freeze({ dailyUsd: null, nightlyUsd: null, raised: null });

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
/** The owner's local calendar day of `d` (YYYY-MM-DD, settings.timeZone, #273; unset: the computer's): the daily budget's period. */
const dayKey = (d = new Date(), timeZone = null) => TimeZone.dayKey(d, timeZone);
const dayStart = (d = new Date(), timeZone = null) => new Date(TimeZone.startOfDay(d, timeZone));
const usd = (n) => `$${round(n).toFixed(2).replace(/\.00$/, '')}`;
const amount = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? round(v) : null);

/** The budget settings, normalized: caps null when unset or 0. */
function budgetSettings(settings) {
  const b = settings?.budget || {};
  const raised = b.raised && typeof b.raised === 'object' ? b.raised : null;
  return { dailyUsd: amount(b.dailyUsd), nightlyUsd: amount(b.nightlyUsd), raised };
}

/** What real runs started at or after `since` cost: { usd, estimated, runs }. */
function spentSince(runs, since, { prices = {} } = {}) {
  const from = new Date(since).getTime();
  let total = 0;
  let estimated = false;
  let count = 0;
  for (const r of runs || []) {
    if (r.mock || !(Date.parse(r.startedAt) >= from)) continue;
    count++;
    for (const s of r.sessions || []) {
      const cost = s.cost_usd ? s.cost_usd : sessionCost(s, prices);
      if (!s.cost_usd && cost) estimated = true;
      total += cost || 0;
    }
  }
  return { usd: round(total), estimated, runs: count };
}

/**
 * Today's spending against the caps (`day`), and the night's while the Night watch is on (`night`,
 * null otherwise). `night`: the Night watch state ({ active, startedAt }).
 */
function budgetState({ settings, runs, night = null, now = new Date() }) {
  const b = budgetSettings(settings);
  const prices = settings?.prices || {};
  const today = dayKey(now, settings?.timeZone);
  const raisedDay = b.raised?.day === today ? amount(b.raised.dailyUsd) : null;
  const day = spentSince(runs, dayStart(now, settings?.timeZone), { prices });
  const nightOn = !!(night?.active && night.startedAt);
  const raisedNight = nightOn && b.raised?.night === night.startedAt ? amount(b.raised.nightlyUsd) : null;
  const nightSpent = nightOn ? spentSince(runs, night.startedAt, { prices }) : null;
  return {
    day: { key: today, spentUsd: day.usd, limitUsd: b.dailyUsd ? Math.max(b.dailyUsd, raisedDay || 0) : null, raised: !!raisedDay, estimated: day.estimated },
    night: nightOn ? { since: night.startedAt, spentUsd: nightSpent.usd, limitUsd: b.nightlyUsd ? Math.max(b.nightlyUsd, raisedNight || 0) : null, raised: !!raisedNight, estimated: nightSpent.estimated } : null,
  };
}

/**
 * The cap a start of `nextUsd` would pass (the night's first, then the day's), or null. A cap already
 * reached stops any start, even one with no estimate (`nextUsd` 0).
 */
function overBudget(state, nextUsd = 0) {
  for (const period of ['night', 'day']) {
    const p = state?.[period];
    if (!p?.limitUsd) continue;
    if (p.spentUsd >= p.limitUsd || p.spentUsd + (Number(nextUsd) || 0) > p.limitUsd) return { period, spentUsd: p.spentUsd, limitUsd: p.limitUsd, nextUsd: round(nextUsd) };
  }
  return null;
}

/** "Budget reached: $38 of $60 today; next stage ≈ $25" (`stageUsd` null: no estimate yet). */
function pauseMessage(over, stageUsd) {
  const when = over.period === 'night' ? 'tonight' : 'today';
  const next = stageUsd != null ? `next stage ≈ ${usd(stageUsd)}` : 'next stage: no estimate yet';
  return `Budget reached: ${usd(over.spentUsd)} of ${usd(over.limitUsd)} ${when}; ${next}. Raise for ${over.period === 'night' ? 'tonight' : 'today'}, or resume anyway.`;
}

/**
 * The budget settings after "Raise for today" (or tonight): the period's cap becomes what is spent plus
 * the next stage's estimate, rounded up to the next dollar, for that day (or that night) only.
 */
function raiseFor(settings, { period = 'day', spentUsd = 0, nextUsd = 0, night = null, now = new Date() }) {
  const b = budgetSettings(settings);
  const to = Math.ceil(round(spentUsd) + round(nextUsd) + 0.001);
  const raised = { ...(b.raised || {}) };
  if (period === 'night') Object.assign(raised, { night: night?.startedAt || null, nightlyUsd: to });
  else Object.assign(raised, { day: dayKey(now, settings?.timeZone), dailyUsd: to });
  return { ...(settings?.budget || {}), raised };
}

/** The period key a "Resume anyway" covers: the night's start while it is on, else today. */
const waiverKey = (state) => (state?.night ? `night:${state.night.since}` : `day:${state.day.key}`);
/** Whether a roadmap's "Resume anyway" still covers now (the same day, or the same night). */
const waived = (roadmap, state) => !!roadmap?.budgetWaived && [`day:${state?.day?.key}`, state?.night ? `night:${state.night.since}` : null].includes(roadmap.budgetWaived);

/** The top bar's line: "$38 / $60 today" (no cap: "$38 today"); the night's while the Night watch is on. */
function meterText(state) {
  const p = state?.night?.limitUsd ? state.night : state?.day;
  if (!p) return '';
  const when = p === state.night ? 'tonight' : 'today';
  return `${p.estimated ? '≈ ' : ''}${usd(p.spentUsd)}${p.limitUsd ? ` / ${usd(p.limitUsd)}` : ''} ${when}`;
}

module.exports = {
  budgetSettings,
  budgetState,
  dayKey,
  DEFAULTS,
  meterText,
  overBudget,
  pauseMessage,
  raiseFor,
  spentSince,
  waived,
  waiverKey,
};
