// @ts-check
// Roadmap cost estimates (#206): what an item will cost before it runs, from the last HISTORY real
// runs of its workflow file that succeeded. Each past run's cost is split by step (its sessions'
// `step_id`) and divided by its complexity (the sum of its issues' `complexity:n` labels, 3 for an
// issue without one); an item's estimate is the median per step × the item's complexity. A step the
// item's inputs change is taken from the past runs with the same inputs when there are at least
// SAME_INPUTS of them, else scaled (STEP_FACTORS): the test step by `unit_tests` / `e2e_tests` (#203),
// the screenshots and evidence steps by `screenshots` (#205; the Cost step sets these inputs). A step
// turned off costs nothing. Sessions without a reported cost (Codex) are priced from their tokens ×
// settings.prices (packages/engine/domains/usage/usage.js sessionCost) and the estimate is marked `estimated`. No history:
// null ("no estimate yet"). Pure: the service passes the run list (packages/engine/domains/run/runs.js listRuns).
// Time (#215): the same rules on each step's duration (the run's `progress` trail, human gates left
// out), so an estimate also has `minutes`; a run without a trail counts its whole duration as one
// step. A stage's duration is its longest item (its items run in parallel). An item with a run
// carries its real duration (`actualMinutes`, gate waits left out; elapsed while it runs) and its
// longest step (`actualTopStep`); a stage the real cost and duration of its items' runs.
// Used by the roadmap's view (packages/engine/service/areas/roadmap.js: "≈ $X" per item and stage, the real
// cost of a finished item next to it) and by its budget cap (packages/engine/domains/usage/budget.js).

const path = require('path');
const { complexityOf } = require('../roadmap/live-roadmap');
const { sessionCost } = require('./usage');

const HISTORY = 30;
const SAME_INPUTS = 3;
const DEFAULT_COMPLEXITY = 3;

// The share of a step's median cost an input value keeps, when too few past runs had that value.
const STEP_FACTORS = {
  unit_tests: { write_and_run: 1, run_existing: 0.35, off: 0.25 },
  e2e_tests: { write: 1, write_and_run: 1.3, off: 0.8 },
  screenshots: { all: 1, changed: 0.75, off: 0.5 },
};
// steps of the development workflows each input changes (step ids)
const isTestStep = (id) => /test/i.test(id);
const isScreenshotStep = (id) => /screenshot/i.test(id);
const isEvidenceStep = (id) => /evidence/i.test(id);

const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (n) => Math.round(n * 100) / 100;
const fileOf = (w) => path.basename(String(w || ''));

/** The complexity of a list of issues (labels), DEFAULT_COMPLEXITY for each issue without one. */
function complexityOfIssues(issues) {
  const list = issues || [];
  return list.length ? list.reduce((a, i) => a + (complexityOf(i) ?? DEFAULT_COMPLEXITY), 0) : DEFAULT_COMPLEXITY;
}

const MINUTE = 60000;
const baseStep = (id) => String(id || 'run').split(':')[0];

// A run's minutes per step from its trail (a step visited twice counts both visits; human gates
// are waiting, not work); a run without a trail is one step 'run' of its whole duration.
function stepMinutes(run) {
  const out = {};
  for (const p of run.progress || []) {
    if (p?.type === 'human_approval' || !(p?.durationMs > 0)) continue;
    const id = baseStep(p.step);
    out[id] = (out[id] || 0) + p.durationMs / MINUTE;
  }
  if (!Object.keys(out).length && run.durationMs > 0) out.run = Math.max(0, run.durationMs - (run.gateWaitMs || 0)) / MINUTE;
  return out;
}

// A past run as the estimate reads it: { complexity, inputs, steps: { stepId: usd }, minutes: { stepId: min }, estimated }.
function pastRun(run, byNumber, prices) {
  const steps = {};
  let estimated = false;
  for (const s of run.sessions) {
    const id = String(s.step_id || 'run');
    const cost = s.cost_usd ? s.cost_usd : sessionCost(s, prices);
    if (cost == null) continue;
    if (!s.cost_usd && cost) estimated = true;
    steps[id] = (steps[id] || 0) + cost;
  }
  const issues = (run.issues || []).map((i) => byNumber.get(Number(i?.number ?? i)) || i);
  return { complexity: complexityOfIssues(issues), inputs: run.inputs || {}, steps, minutes: stepMinutes(run), estimated };
}

/**
 * The past runs an estimate of `workflow` reads: real, finished with success, newest first, at most
 * HISTORY. `issues`: the backlog's issues (their labels give the past runs' complexity).
 * @param {any[] | null | undefined} runs
 * @param {string | undefined} workflow
 * @param {{ issues?: any[] | null, prices?: object }} [options]
 */
function historyOf(runs, workflow, { issues = [], prices = {} } = {}) {
  const byNumber = new Map((issues || []).map((i) => [i.number, i]));
  const file = fileOf(workflow);
  return (runs || [])
    .filter((r) => !r.mock && r.status === 'success' && r.finishedAt && fileOf(r.file) === file)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, HISTORY)
    .map((r) => pastRun(r, byNumber, prices))
    .filter((r) => Object.keys(r.steps).length);
}

// The input of `inputs` that changes step `id`, if any (the test step reads both test inputs).
function inputsOfStep(id) {
  if (isTestStep(id)) return ['unit_tests', 'e2e_tests'];
  if (isScreenshotStep(id) || isEvidenceStep(id)) return ['screenshots'];
  return [];
}

// A step's share for the item's inputs: 0 when its inputs turn it off, else the product of their factors.
function stepFactor(id, inputs) {
  if (isTestStep(id) && inputs.unit_tests === 'off' && inputs.e2e_tests === 'off') return 0;
  if (isScreenshotStep(id) && inputs.screenshots === 'off') return 0;
  return inputsOfStep(id).reduce((f, k) => f * (inputs[k] != null ? STEP_FACTORS[k][inputs[k]] ?? 1 : 1), 1);
}

// The estimate per complexity point of one measure (`field`: 'steps' for usd, 'minutes'), from the
// past runs that have it: { perPoint, notes }.
function perPointOf(past, field, inputs) {
  const runs = past.filter((r) => Object.keys(r[field]).length);
  const ids = [...new Set(runs.flatMap((r) => Object.keys(r[field])))];
  const notes = [];
  let perPoint = 0;
  for (const id of ids) {
    const keys = inputsOfStep(id).filter((k) => inputs[k] != null);
    const factor = stepFactor(id, inputs);
    if (factor === 0) { notes.push(`${id} off`); continue; }
    // the runs that had this step (a step a run skipped is not a zero cost for an item that runs it)
    const had = runs.filter((r) => r[field][id] != null);
    const same = keys.length ? had.filter((r) => keys.every((k) => (r.inputs[k] ?? null) === inputs[k])) : [];
    const base = same.length >= SAME_INPUTS ? same : had;
    const scale = same.length >= SAME_INPUTS ? 1 : factor;
    // a step most runs skipped counts for the share of runs that ran it
    const share = keys.length ? 1 : had.length / runs.length;
    perPoint += median(base.map((r) => r[field][id] / r.complexity)) * scale * share;
    if (keys.length && scale !== 1) notes.push(`${id} ×${scale}`);
  }
  return { perPoint, notes, runs: runs.length };
}

/**
 * The estimate of one roadmap item (or a planned group): { usd, minutes, perPoint, complexity, runs,
 * basis, estimated } or null when its workflow has no past run (`minutes` null when no past run has
 * a duration). `item`: { workflow, inputs, issues } (issues with their labels), or `complexity` given.
 * @param {any} item
 * @param {any[] | null | undefined} runs
 * @param {{ issues?: any[] | null, prices?: object, complexity?: number | null }} [options]
 */
function estimateItem(item, runs, { issues = [], prices = {}, complexity = null } = {}) {
  const past = historyOf(runs, item?.workflow, { issues, prices });
  if (!past.length) return null;
  const inputs = item?.inputs || {};
  // the item's issues with their labels from the backlog (a roadmap item keeps only number and title;
  // an item stored before #163 is its one issue)
  const byNumber = new Map((issues || []).map((i) => [Number(i.number), i]));
  const own = item?.issues?.length ? item.issues : item?.number ? [item] : [];
  const size = complexity ?? complexityOfIssues(own.map((i) => byNumber.get(Number(i?.number ?? i)) || i));
  const { perPoint, notes } = perPointOf(past, 'steps', inputs);
  const time = perPointOf(past, 'minutes', inputs);
  const estimated = past.some((r) => r.estimated);
  const runsText = `${past.length} successful run${past.length > 1 ? 's' : ''}`;
  return {
    usd: round(perPoint * size),
    minutes: time.runs ? Math.round(time.perPoint * size) : null,
    perPoint: round(perPoint),
    complexity: size,
    runs: past.length,
    estimated,
    basis: `Median cost per step and complexity point of the last ${runsText} of ${fileOf(item.workflow)}, × complexity ${size}${notes.length ? ` (${notes.join(', ')})` : ''}${estimated ? '; some costs estimated from tokens × the model prices' : ''}.`,
    timeBasis: time.runs ? `Median duration per step and complexity point of the last ${runsText} of ${fileOf(item.workflow)} (human gates left out), × complexity ${size}${time.notes.length ? ` (${time.notes.join(', ')})` : ''}.` : '',
  };
}

// the release workflow a cut line starts (packages/engine/service/areas/releases.js, #260)
const RELEASE_WORKFLOW = 'release.yaml';

const runsOf = (item, runById) => [...new Set([...(item?.runs || []), ...(item?.runId ? [item.runId] : [])])].map((id) => runById.get(id)).filter(Boolean);

/** The real cost of an item's runs (`runs`: listRuns rows by id), null when it has none. */
function actualCost(item, runById) {
  const found = runsOf(item, runById);
  if (!found.length) return null;
  return round(found.reduce((a, r) => a + (r.costUsd || 0) + (r.childrenCostUsd || 0), 0));
}

/**
 * The real duration of an item's runs in minutes (gate waits left out; elapsed while one runs) and its
 * longest step ({ step, minutes }), null when it has no run.
 */
function actualTime(item, runById) {
  const found = runsOf(item, runById);
  if (!found.length) return null;
  const minutes = Math.round(found.reduce((a, r) => a + Math.max(0, (r.durationMs || 0) - (r.gateWaitMs || 0)), 0) / MINUTE);
  const steps = {};
  for (const r of found) for (const [id, m] of Object.entries(stepMinutes(r))) if (id !== 'run') steps[id] = (steps[id] || 0) + m;
  const [step, m] = Object.entries(steps).sort((a, b) => b[1] - a[1])[0] || [];
  return { minutes, topStep: step ? { step, minutes: Math.round(m) } : null };
}

/**
 * The roadmap with an `estimate` on each item and stage, and the real cost (`actualUsd`) and duration
 * (`actualMinutes`, `actualTopStep`) of each item with a run. A stage's estimate sums its items' costs
 * and takes its longest item's minutes (`missing`: items with no estimate yet); its `actualUsd` sums
 * its items' real costs, its `actualMinutes` is its longest item's.
 * @param {import('@multiagent/shared/types').Roadmap} roadmap
 * @param {any[] | null | undefined} runs
 * @param {{ issues?: any[], prices?: object }} [options]
 */
function withEstimates(roadmap, runs, { issues = [], prices = {} } = {}) {
  const runById = new Map((runs || []).map((r) => [r.runId, r]));
  return {
    ...roadmap,
    stages: roadmap.stages.map((s) => {
      // #421 #555: a release entry whose run has not started yet: that run's estimate (its planned card, the Roadmap's By release)
      if (s.kind === 'release') return s.runId ? s : { ...s, estimate: estimateItem({ workflow: RELEASE_WORKFLOW }, runs, { prices, complexity: 1 }) };
      const items = (s.items || []).map((x) => {
        const estimate = estimateItem(x, runs, { issues, prices });
        const actualUsd = actualCost(x, runById);
        const time = actualTime(x, runById);
        return {
          ...x,
          estimate,
          ...(actualUsd != null ? { actualUsd } : {}),
          ...(time ? { actualMinutes: time.minutes, actualTopStep: time.topStep } : {}),
        };
      });
      const known = items.map((x) => x.estimate).filter((e) => e != null);
      const timed = known.map((e) => e.minutes).filter((m) => m != null);
      const ran = items.map((x) => x.actualUsd).filter((usd) => usd != null);
      return {
        ...s,
        items,
        // #421: a cut line whose release run has not started yet: that run's estimate (the Roadmap's By release)
        ...(s.release && !s.release.runId ? { release: { ...s.release, estimate: estimateItem({ workflow: RELEASE_WORKFLOW }, runs, { prices, complexity: 1 }) } } : {}),
        estimate: known.length ? {
          usd: round(known.reduce((a, e) => a + e.usd, 0)),
          minutes: timed.length ? Math.max(...timed) : null,
          items: known.length,
          missing: items.length - known.length,
          runs: Math.max(...known.map((e) => e.runs)),
        } : null,
        ...(ran.length ? {
          actualUsd: round(ran.reduce((a, usd) => a + usd, 0)),
          actualMinutes: Math.max(0, ...items.map((x) => x.actualMinutes || 0)),
        } : {}),
      };
    }),
  };
}

module.exports = {
  actualCost,
  actualTime,
  complexityOfIssues,
  estimateItem,
  HISTORY,
  historyOf,
  STEP_FACTORS,
  stepMinutes,
  withEstimates,
};
