// Roadmap cost estimates (#206): what an item will cost before it runs, from the last HISTORY real
// runs of its workflow file that succeeded. Each past run's cost is split by step (its sessions'
// `step_id`) and divided by its complexity (the sum of its issues' `complexity:n` labels, 3 for an
// issue without one); an item's estimate is the median per step × the item's complexity. A step the
// item's inputs change is taken from the past runs with the same inputs when there are at least
// SAME_INPUTS of them, else scaled (STEP_FACTORS): the test step by `unit_tests` / `e2e_tests` (#203),
// the screenshots and evidence steps by `screenshots` (#205; the Cost step sets these inputs). A step
// turned off costs nothing. Sessions without a reported cost (Codex) are priced from their tokens ×
// settings.prices (src/usage.js sessionCost) and the estimate is marked `estimated`. No history:
// null ("no estimate yet"). Pure: the service passes the run list (src/runs.js listRuns).
// Used by the roadmap's view (src/service/areas/roadmap.js: "≈ $X" per item and stage, the real
// cost of a finished item next to it) and by its budget cap (src/budget.js).

const path = require('path');
const { complexityOf } = require('./live-roadmap');
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

// A past run as the estimate reads it: { complexity, inputs, steps: { stepId: usd }, estimated }.
function pastRun(run, byNumber, prices) {
  const steps = {};
  let estimated = false;
  for (const s of run.sessions || []) {
    const id = String(s.step_id || 'run');
    const cost = s.cost_usd ? s.cost_usd : sessionCost(s, prices);
    if (cost == null) continue;
    if (!s.cost_usd && cost) estimated = true;
    steps[id] = (steps[id] || 0) + cost;
  }
  const issues = (run.issues || []).map((i) => byNumber.get(Number(i?.number ?? i)) || i);
  return { complexity: complexityOfIssues(issues), inputs: run.inputs || {}, steps, estimated };
}

/**
 * The past runs an estimate of `workflow` reads: real, finished with success, newest first, at most
 * HISTORY. `issues`: the backlog's issues (their labels give the past runs' complexity).
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

/**
 * The estimate of one roadmap item (or a planned group): { usd, perPoint, complexity, runs, basis,
 * estimated } or null when its workflow has no past run. `item`: { workflow, inputs, issues } (issues
 * with their labels), or `complexity` given.
 */
function estimateItem(item, runs, { issues = [], prices = {}, complexity = null } = {}) {
  const past = historyOf(runs, item?.workflow, { issues, prices });
  if (!past.length) return null;
  const inputs = item?.inputs || {};
  const size = complexity ?? complexityOfIssues(item?.issues);
  const ids = [...new Set(past.flatMap((r) => Object.keys(r.steps)))];
  const notes = [];
  let perPoint = 0;
  for (const id of ids) {
    const keys = inputsOfStep(id).filter((k) => inputs[k] != null);
    const factor = stepFactor(id, inputs);
    if (factor === 0) { notes.push(`${id} off`); continue; }
    // the runs that had this step (a step a run skipped is not a zero cost for an item that runs it)
    const had = past.filter((r) => r.steps[id] != null);
    const same = keys.length ? had.filter((r) => keys.every((k) => (r.inputs[k] ?? null) === inputs[k])) : [];
    const base = same.length >= SAME_INPUTS ? same : had;
    const scale = same.length >= SAME_INPUTS ? 1 : factor;
    // a step most runs skipped counts for the share of runs that ran it
    const share = keys.length ? 1 : had.length / past.length;
    perPoint += median(base.map((r) => r.steps[id] / r.complexity)) * scale * share;
    if (keys.length && scale !== 1) notes.push(`${id} ×${scale}`);
  }
  const estimated = past.some((r) => r.estimated);
  return {
    usd: round(perPoint * size),
    perPoint: round(perPoint),
    complexity: size,
    runs: past.length,
    estimated,
    basis: `Median cost per step and complexity point of the last ${past.length} successful run${past.length > 1 ? 's' : ''} of ${fileOf(item.workflow)}, × complexity ${size}${notes.length ? ` (${notes.join(', ')})` : ''}${estimated ? '; some costs estimated from tokens × the model prices' : ''}.`,
  };
}

/** The real cost of an item's runs (`runs`: listRuns rows by id), null when it has none. */
function actualCost(item, runById) {
  const ids = [...new Set([...(item?.runs || []), ...(item?.runId ? [item.runId] : [])])];
  const found = ids.map((id) => runById.get(id)).filter(Boolean);
  if (!found.length) return null;
  return round(found.reduce((a, r) => a + (r.costUsd || 0) + (r.childrenCostUsd || 0), 0));
}

/**
 * The roadmap with an `estimate` on each item and stage, and the real cost (`actualUsd`) of each
 * item with a run. A stage's estimate sums its items' (`missing`: items with no estimate yet).
 */
function withEstimates(roadmap, runs, { issues = [], prices = {} } = {}) {
  const runById = new Map((runs || []).map((r) => [r.runId, r]));
  return {
    ...roadmap,
    stages: (roadmap.stages || []).map((s) => {
      const items = (s.items || []).map((x) => {
        const estimate = estimateItem(x, runs, { issues, prices });
        const actualUsd = actualCost(x, runById);
        return { ...x, estimate, ...(actualUsd != null ? { actualUsd } : {}) };
      });
      const known = items.filter((x) => x.estimate);
      return {
        ...s,
        items,
        estimate: known.length ? { usd: round(known.reduce((a, x) => a + x.estimate.usd, 0)), items: known.length, missing: items.length - known.length, runs: Math.max(...known.map((x) => x.estimate.runs)) } : null,
      };
    }),
  };
}

module.exports = {
  actualCost,
  complexityOfIssues,
  estimateItem,
  HISTORY,
  historyOf,
  STEP_FACTORS,
  withEstimates,
};
