// Step regressions (#335): a workflow step whose cost or time rises against its own history. Like a
// performance budget per machine class, a step is compared only with the runs where it used the same
// provider, model and effort (its class). For each workflow file, step and class, over the real runs
// that succeeded (simulated runs and mock sessions never count), newest first: the `recentRuns`
// newest are the recent window, the at most `baselineRuns` before them the baseline. Each measure is
// a median: the step's cost per complexity point (as packages/engine/domains/usage/cost-estimate.js: its sessions' cost, priced
// from tokens when unreported, ÷ the run's complexity) and its minutes (the run's trail). Fewer than
// `minRuns` baseline runs: 'not-measurable'. A recent median above baseline × (1 + threshold) is a
// regression of that measure; a key flagged earlier (`flagged`) that is back within is 'recovered'.
// Report only: nothing here pauses, changes or answers anything. Pure: callers pass the run list
// (packages/engine/domains/run/runs.js listRuns). Used by the Night watch's regression finding (packages/engine/domains/night/night-watch.js) and the
// Oracle's run_analysis `regressions` focus (packages/engine/domains/oracle/oracle-run-focus.js).

const path = require('path');
const { complexityOfIssues, stepMinutes } = require('../usage/cost-estimate');
const { sessionCost } = require('../usage/usage');

// The one place for the thresholds and windows (thresholds: the share above the baseline).
const REGRESSION_DEFAULTS = Object.freeze({
  baselineRuns: 20,
  cost: 0.3,
  minRuns: 5,
  minutes: 0.3,
  recentRuns: 3,
});

const MEASURES = ['cost', 'minutes'];
const FIELD = { cost: 'costPerPoint', minutes: 'minutes' };

const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (n) => (n == null ? null : Math.round(n * 10000) / 10000);
const fileOf = (w) => path.basename(String(w || '').replace(/\\/g, '/'));
const baseStep = (id) => String(id || 'run').split(':')[0];
const isMockRun = (r) => r.mock || (r.sessions || []).some((s) => s?.provider === 'mock');
const classOf = (s) => ({ provider: String(s.provider || ''), model: String(s.model || ''), effort: String(s.effort || '') });
const keyOf = (workflow, step, c) => [workflow, step, c.provider, c.model, c.effort].join('|');

// One run's samples, one per step: { step, class, cost, minutes } (the class of the step's dearest
// session, so a run counts once per step).
function samplesOf(run, byNumber, prices) {
  const steps = new Map();
  for (const s of run.sessions || []) {
    const step = baseStep(s.step_id);
    // a cost neither reported nor priced is unknown, not zero (as packages/engine/domains/usage/cost-estimate.js)
    const cost = s.cost_usd ? s.cost_usd : sessionCost(s, prices);
    const cur = steps.get(step) || { cost: null, top: null, topCost: -1 };
    if (cost != null) cur.cost = (cur.cost || 0) + cost;
    if ((cost || 0) > cur.topCost) Object.assign(cur, { top: s, topCost: cost || 0 });
    steps.set(step, cur);
  }
  const issues = (run.issues || []).map((i) => byNumber.get(Number(i?.number ?? i)) || i);
  const complexity = complexityOfIssues(issues);
  const minutes = stepMinutes(run);
  return [...steps].map(([step, v]) => ({
    step,
    class: classOf(v.top),
    costPerPoint: v.cost == null ? null : v.cost / complexity,
    minutes: minutes[step] ?? null,
  }));
}

// The medians of a window of samples: { costPerPoint, minutes, runIds }.
function windowOf(list) {
  const known = (field) => list.map((x) => x[field]).filter((v) => v != null);
  const raw = { costPerPoint: median(known('costPerPoint')), minutes: median(known('minutes')) };
  return { costPerPoint: round(raw.costPerPoint), minutes: round(raw.minutes), runIds: list.map((x) => x.runId), raw };
}
const publicWindow = ({ raw, ...w }) => w;

/**
 * One entry per workflow file, step and class seen in real successful runs:
 * { key, workflow, step, class, status, regressed, baseline, recent } (see the header).
 */
function stepRegressions(runs, { issues = [], prices = {}, thresholds = {}, flagged = [] } = {}) {
  const opts = { ...REGRESSION_DEFAULTS, ...thresholds };
  const byNumber = new Map((issues || []).map((i) => [Number(i.number), i]));
  const wasFlagged = new Set(flagged || []);
  const groups = new Map();
  const real = (runs || [])
    .filter((r) => r && r.status === 'success' && r.finishedAt && !isMockRun(r))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  for (const run of real) {
    const workflow = fileOf(run.file);
    for (const s of samplesOf(run, byNumber, prices)) {
      const key = keyOf(workflow, s.step, s.class);
      if (!groups.has(key)) groups.set(key, { key, workflow, step: s.step, class: s.class, samples: [] });
      groups.get(key).samples.push({ ...s, runId: run.runId });
    }
  }
  return [...groups.values()].map(({ samples, ...g }) => {
    const recent = windowOf(samples.slice(0, opts.recentRuns));
    const older = samples.slice(opts.recentRuns, opts.recentRuns + opts.baselineRuns);
    if (older.length < opts.minRuns) {
      return { ...g, status: 'not-measurable', regressed: [], baseline: null, recent: publicWindow(recent) };
    }
    const baseline = windowOf(older);
    const regressed = MEASURES.filter((m) => {
      const b = baseline.raw[FIELD[m]];
      const r = recent.raw[FIELD[m]];
      return b != null && r != null && b > 0 && r > b * (1 + opts[m]);
    });
    const status = regressed.length ? 'regressed' : wasFlagged.has(g.key) ? 'recovered' : 'within';
    return { ...g, status, regressed, baseline: publicWindow(baseline), recent: publicWindow(recent) };
  });
}

/** The rise of a regressed measure over its baseline, in whole percent (50 for +50%). */
function risePercent(entry, measure) {
  const b = entry?.baseline?.[FIELD[measure]];
  const r = entry?.recent?.[FIELD[measure]];
  return b > 0 && r != null ? Math.round((r / b - 1) * 100) : 0;
}

/** The one-line headline of a regression, led by the step: 'test: +42% cost over 3 runs'. */
function regressionLine(entry) {
  const rises = (entry?.regressed || []).map((m) => `+${risePercent(entry, m)}% ${m}`);
  const n = entry?.recent?.runIds?.length || 0;
  return `${entry?.step}: ${rises.join(', ')} over ${n} run${n === 1 ? '' : 's'}`;
}

module.exports = {
  REGRESSION_DEFAULTS,
  regressionLine,
  risePercent,
  stepRegressions,
};
