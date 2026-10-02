// Live roadmap (#164): a roadmap with `live: true` (src/roadmap.js setLive, only while it runs) does
// not end when its last stage ends: `advance` asks for a refill, and the service
// (src/service/areas/live-roadmap.js) asks the Product Owner a fixed question about the issues it may
// pick (`candidates`: open and to do, not in the roadmap or the queue, no open PR/MR, no run in
// progress, not an epic, not flagged to enrich first, `complexity:n` up to the cap, lowest first). The
// answer's first stages (`refillStages`, at most `maxStages`, without the issues it flags to enrich)
// are added as planned stages through roadmap.propose and the roadmap goes on, again and again.
// It stops by itself (`applyRefill`): nothing left to pick, or the daily budget reached (`spentToday`:
// the live roadmap's runs and refills over the last 24 h), ends the roadmap `done` with live still on
// (Start tries again); a refill that fails pauses it (live never skips a failure, like a failed item).
// Turning live off lets the current stages finish and adds nothing more. A refill only adds planned
// stages: it never answers a human gate. Settings: `liveRoadmap` (src/workspace.js).
// Roadmap file fields: live, liveSince, liveBy, liveRefill ({ status, at, added, costUsd, message }:
// the last refill; status refilling | added | empty | budget | failed | off), liveRefills ([{ at,
// costUsd }], the last 24 h, for the budget). Screen: backlog-roadmap.js (the switch box) and
// backlog.js (the banner).

const { itemIssues } = require('./backlog');

const DEFAULTS = { complexityCap: 2, maxStages: 3, dailyBudgetUsd: 50, refreshFirst: true };
const DAY_MS = 24 * 3600e3;
const REFILL_STATUSES = ['added', 'budget', 'empty', 'failed', 'off', 'refilling'];
const COMPLEXITY = /^complexity\s*[:=/-]?\s*(\d+)/i;
// labels that say an issue must be enriched before it is implemented (#103)
const ENRICH_LABEL = /^(needs[-_ ]?(info|details|enrich\w*)|enrich\w*)$/i;

const labelName = (l) => String(l?.name ?? l);
const num = (v, min, max, fallback) => (Number.isFinite(Number(v)) && Number(v) >= min ? Math.min(Number(v), max) : fallback);

/** The `liveRoadmap` settings with their defaults, kept to sane ranges. */
function liveSettings(settings) {
  const s = { ...DEFAULTS, ...(settings?.liveRoadmap || {}) };
  return {
    complexityCap: Math.floor(num(s.complexityCap, 1, 10, DEFAULTS.complexityCap)),
    maxStages: Math.floor(num(s.maxStages, 1, 10, DEFAULTS.maxStages)),
    dailyBudgetUsd: num(s.dailyBudgetUsd, 0, 10000, DEFAULTS.dailyBudgetUsd),
    refreshFirst: s.refreshFirst !== false,
  };
}

/** An issue's `complexity:n` label (null when it has none). */
function complexityOf(issue) {
  for (const l of issue?.labels || []) {
    const m = labelName(l).match(COMPLEXITY);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * The issues a refill may pick, lowest complexity first (then the oldest number): `data` is the
 * Backlog with its runs (the service's withIssueRuns: `column`, `queued`, `roadmap`, `runs`).
 * Issues without a `complexity:n` label are left out (their size is unknown).
 */
function candidates(data, { complexityCap = DEFAULTS.complexityCap } = {}) {
  const planned = new Set((data?.roadmap?.stages || []).flatMap((s) => (s.items || []).flatMap((x) => itemIssues(x).map((i) => i.number))));
  const queued = new Set((data?.queue?.items || []).flatMap((q) => itemIssues(q).map((i) => i.number)));
  return (data?.issues || [])
    .filter((i) => i.state === 'open' && !i.isEpic && !(i.labels || []).some((l) => /^epic$/i.test(labelName(l))))
    .filter((i) => (!i.column || i.column === 'todo') && !i.queued && !queued.has(i.number) && !i.roadmap && !planned.has(i.number))
    .filter((i) => !(i.pullRequests || []).length && !(i.runs || []).some((r) => ['pending', 'running'].includes(r.status)))
    .filter((i) => !(i.labels || []).some((l) => ENRICH_LABEL.test(labelName(l))))
    .map((i) => ({ issue: i, complexity: complexityOf(i) }))
    .filter((x) => x.complexity != null && x.complexity <= complexityCap)
    .sort((a, b) => a.complexity - b.complexity || a.issue.number - b.issue.number)
    .map((x) => x.issue);
}

/** The fixed refill question (no owner input): the issues go with it as the attached selection. */
function refillQuestion({ complexityCap = DEFAULTS.complexityCap, maxStages = DEFAULTS.maxStages } = {}) {
  return [
    `Live roadmap refill: the roadmap's last stage has ended and the machine should keep working. Plan the attached issues (open, complexity ${complexityCap} or less) as the next stages of the roadmap, lowest complexity first.`,
    `Use your usual rules: group the issues that touch the same files into one run within the group size limits, never put in one stage issues that must not run in parallel, and use at most ${maxStages} stage${maxStages === 1 ? '' : 's'}.`,
    'List in `enrich` the issues too vague to implement without guessing: they are left out of the roadmap.',
  ].join(' ');
}

const clock = (at) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const usd = (n) => `US$ ${(Number(n) || 0).toFixed(2)}`;

/** The note of each stage a refill adds. */
const refillNote = (at, costUsd) => `Added by the live roadmap at ${clock(at)}, Product Owner answer ${usd(costUsd)}.`;

/**
 * The stages to add from the Product Owner's plan answer (product-owner normalizeAnswer): its groups
 * kept to `allowed` (the candidates) minus the issues it flags to enrich, an issue in one group only,
 * grouped by the answer's `stage` in order, the first `maxStages` stages.
 */
function refillStages(answer, { allowed, maxStages = DEFAULTS.maxStages, mock = false, origin = '', note = '' } = {}) {
  const enrich = new Set((answer?.enrich || []).map((e) => Number(e?.issue)));
  const seen = new Set();
  const groups = [];
  for (const g of answer?.groups || []) {
    const issues = (g.issues || []).map(Number).filter((n) => allowed.has(n) && !enrich.has(n) && !seen.has(n));
    if (!issues.length || !g.workflow) continue;
    issues.forEach((n) => seen.add(n));
    groups.push({ ...g, issues });
  }
  const order = [...new Set(groups.map((g) => g.stage || 1))].sort((a, b) => a - b).slice(0, maxStages);
  return order.map((s, k) => ({
    name: `Live refill ${k + 1}`,
    note,
    items: groups.filter((g) => (g.stage || 1) === s).map((g) => ({
      workflow: g.workflow, inputs: g.inputs || {}, mock: !!mock, issues: g.issues,
      ...(g.reason ? { reason: g.reason } : {}), ...(g.modeReason ? { modeReason: g.modeReason } : {}), ...(origin ? { origin } : {}),
    })),
  }));
}

/**
 * What the live roadmap spent over the last 24 h (and since it was turned on): its refills
 * (`liveRefills`) and the runs of its items started in that window. `runCost(runId)`: { costUsd,
 * startedAt } or null.
 */
function spentToday({ roadmap, runCost, now = new Date() }) {
  const since = Math.max(now.getTime() - DAY_MS, Date.parse(roadmap?.liveSince) || 0);
  const refills = (roadmap?.liveRefills || []).filter((x) => Date.parse(x.at) >= since).reduce((a, x) => a + (Number(x.costUsd) || 0), 0);
  const ids = new Set((roadmap?.stages || []).flatMap((s) => (s.items || []).flatMap((x) => [...(x.runs || []), ...(x.runId ? [x.runId] : [])])));
  let used = 0;
  for (const id of ids) {
    const r = runCost(id);
    if (r && Date.parse(r.startedAt) >= since) used += Number(r.costUsd) || 0;
  }
  return Math.round((refills + used) * 100) / 100;
}

/** The message when the daily budget stops refills (null while there is room; a 0 budget: no cap). */
function budgetProblem(spentUsd, { dailyBudgetUsd = DEFAULTS.dailyBudgetUsd } = {}) {
  if (!(dailyBudgetUsd > 0) || spentUsd < dailyBudgetUsd) return null;
  return `Live roadmap: the daily budget of ${usd(dailyBudgetUsd)} is reached (${usd(spentUsd)} over the last 24 h): no more refills until it frees up.`;
}

/**
 * A refill's outcome on the roadmap (pure): `liveRefill` records it, its cost joins `liveRefills`
 * (kept to the last 24 h). When nothing was added and every stage is finished, a running roadmap
 * ends: `failed` pauses it with the message (Resume tries again), any other outcome ends it `done`
 * (live stays on). `refilling` only records that the Product Owner is being asked.
 */
function applyRefill(roadmap, { status, at = new Date().toISOString(), added = 0, costUsd = 0, message = '' }) {
  if (!REFILL_STATUSES.includes(status)) throw new Error(`Unknown live refill status: ${status}`);
  const cutoff = Date.parse(at) - DAY_MS;
  const liveRefills = [...(roadmap.liveRefills || []), ...(costUsd ? [{ at, costUsd }] : [])].filter((x) => Date.parse(x.at) >= cutoff);
  const r = { ...roadmap, liveRefill: { status, at, added, costUsd, message }, liveRefills };
  const left = (r.stages || []).some((s) => (s.items || []).some((x) => !['done', 'skipped'].includes(x.status)));
  if (status === 'refilling' || status === 'added' || left || r.state !== 'running') return r;
  if (status === 'failed') return { ...r, state: 'paused', pausedBy: null, error: message };
  return { ...r, state: 'done', error: null, pausedBy: null, scope: null };
}

module.exports = {
  applyRefill,
  budgetProblem,
  candidates,
  complexityOf,
  DEFAULTS,
  liveSettings,
  refillNote,
  refillQuestion,
  refillStages,
  spentToday,
};
