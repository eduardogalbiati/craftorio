// Limits tonight (#337): while a Night watch with an end time is on, the owner can expand every run
// limit, so no run is stopped or paused at night by a limit sized for the day. `effectiveLimits`
// (pure) is what a run reads at each check: the workflow's own limit (after its templates and the
// #262 per-model lift) × tonight's multiplier, or tonight's custom value; never below the day value
// nor below what the run was already granted (the morning never cuts a run); a limit the workflow
// does not set stays unset. `saveNightLimits` / `tonightLimits`: the settings of the watch in force,
// kept in the Oracle's folder (night-limits.json, tied to the watch's startedAt) and logged as `oracle.limits`; Self-healing's standing watch
// (#278) never expands. `pastDayLimits`: the morning summary's runs past a day limit. The Oracle
// gets no permission over these limits: only the owner sets them (views/nightwatch/).

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { parseDuration, parseTokens } = require('./engine/run/load');
const actions = require('./oracle-actions');
const { logNight } = require('./night-watch');

const MULTIPLIERS = Object.freeze([1.5, 2, 3]);
const DEFAULT_MULTIPLIER = 2;
const KEYS = ['context', 'cost', 'duration'];
const VALUE_KEYS = ['context', 'cost', 'duration', 'turns', 'budget'];

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

// day { context, cost, duration } (0 / null: no limit), tonight null | { multiplier } | { values },
// granted: the highest limits this run was granted so far, or null → { context, cost, duration, turns }
function effectiveLimits(day, tonight, granted = null) {
  const m = num(tonight?.multiplier);
  const values = tonight?.values || null;
  const out = {};
  for (const k of KEYS) {
    const base = day?.[k];
    if (!num(base)) { out[k] = base ?? null; continue; }
    const t = values ? num(values[k]) : m ? base * m : 0;
    out[k] = Math.max(num(base), t, num(granted?.[k]));
  }
  out.turns = Math.max(1, values ? num(values.turns) : m, num(granted?.turns));
  return out;
}

// The settings to save: { multiplier } (one of MULTIPLIERS) or { values } (positive numbers only)
function normalize(limits) {
  if (limits?.multiplier != null) {
    const m = Number(limits.multiplier);
    if (!MULTIPLIERS.includes(m)) throw new Error(`Invalid multiplier: ${limits.multiplier} (1.5, 2 or 3).`);
    return { multiplier: m };
  }
  if (limits?.values && typeof limits.values === 'object') {
    const values = {};
    for (const k of VALUE_KEYS) if (num(limits.values[k])) values[k] = num(limits.values[k]);
    return { values };
  }
  throw new Error('Missing limits: a multiplier or custom values.');
}

const limitsFile = (dir) => path.join(dir, 'night-limits.json');

// The Night watch these limits can belong to: on, with an end time not passed yet (never Self-healing's
// standing watch, which has no end time)
function nightInForce(dir, now) {
  const w = actions.nightWatch(dir, now);
  return w.active && w.startedAt ? w : null;
}

/** Saves tonight's limits ({ multiplier } | { values }) for the Night watch in force; → the saved record. */
function saveNightLimits(dir, limits, { by = 'the owner', now = Date.now() } = {}) {
  const w = nightInForce(dir, now);
  if (!w) throw new Error('Limits tonight need a Night watch with an end time (Self-healing never expands limits).');
  const saved = { ...normalize(limits), night: w.startedAt, by, at: new Date(now).toISOString() };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(limitsFile(dir), JSON.stringify(saved, null, 2));
  logNight(dir, 'oracle.limits', { multiplier: saved.multiplier ?? null, values: saved.values ?? null, by, at: saved.at });
  return saved;
}

/** Tonight's settings while the Night watch they were set for is in force; null otherwise. */
function tonightLimits(dir, now = Date.now()) {
  const w = nightInForce(dir, now);
  if (!w) return null;
  let l = null;
  try { l = JSON.parse(fs.readFileSync(limitsFile(dir), 'utf8')); } catch { /* none set */ }
  return l && l.night === w.startedAt ? l : null;
}

/**
 * The day values the Night watch screen shows (#337): the largest limits of the workspace's workflows
 * ({ context, cost, duration }, `{{ inputs.x }}` read from the input's default; 0 when none sets one)
 * and the nightly budget (`budget`, null when unset).
 */
function dayReference(workflowsDir, settings) {
  const day = { context: 0, cost: 0, duration: 0, budget: num(settings?.budget?.nightlyUsd) || null };
  let files = [];
  try { files = fs.readdirSync(workflowsDir).filter((f) => /\.ya?ml$/i.test(f)); } catch { return day; }
  for (const f of files) {
    let wf = null;
    try { wf = yaml.load(fs.readFileSync(path.join(workflowsDir, f), 'utf8')); } catch { continue; }
    const lim = wf?.orchestrator?.limits;
    if (!lim || typeof lim !== 'object') continue;
    const value = (raw) => String(raw ?? '').replace(/\{\{\s*inputs\.([\w-]+)\s*\}\}/g, (_, k) => String(wf.inputs?.[k]?.default ?? '')).trim();
    day.context = Math.max(day.context, parseTokens(value(lim.max_total_context)) || 0);
    day.cost = Math.max(day.cost, num(value(lim.max_total_cost_usd)));
    day.duration = Math.max(day.duration, parseDuration(value(lim.max_total_duration) || null, 0) || 0);
  }
  return day;
}

const M = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`);
const usd = (n) => `US$ ${+(+n).toFixed(2)}`;

// runs [{ label, used: { context, cost }, day, tonight }] → { lines, overDayUsd }: one line per run that
// went past a day limit, with how far; overDayUsd: what they spent above their day cost limits.
function pastDayLimits(runs) {
  const lines = [];
  let over = 0;
  for (const r of runs || []) {
    const used = r.used || {};
    const day = r.day || {};
    const tonight = r.tonight || {};
    const past = (k) => num(day[k]) > 0 && num(used[k]) > num(day[k]);
    if (!past('context') && !past('cost')) continue;
    const parts = [];
    if (num(day.context)) parts.push(`context ${M(num(used.context))} of ${M(num(tonight.context) || num(day.context))} tonight${past('context') ? ` (day limit ${M(num(day.context))})` : ''}`);
    if (num(day.cost)) parts.push(`${usd(num(used.cost))} of ${usd(num(tonight.cost) || num(day.cost))}${past('cost') ? ` (day limit ${usd(num(day.cost))})` : ''}`);
    lines.push(`${r.label}: ${parts.join(', ')}`);
    if (past('cost')) over += num(used.cost) - num(day.cost);
  }
  return { lines, overDayUsd: +over.toFixed(2) };
}

module.exports = {
  dayReference,
  DEFAULT_MULTIPLIER,
  effectiveLimits,
  MULTIPLIERS,
  pastDayLimits,
  saveNightLimits,
  tonightLimits,
};
