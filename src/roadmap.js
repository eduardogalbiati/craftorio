// Backlog roadmap (#106): an ordered plan of runs per project, in
// <workspace>/backlog/<project id>.roadmap.json, next to the queue (src/backlog.js). Stages run one
// after the other; the items of a stage (each one run: a workflow with one issue or a group, the
// queue's item shape, so `itemIssues`/`runInputs` start it like an assigned group) run in parallel
// up to the concurrency limit. A stage is over when every item is done (finished successfully and
// merged: `localMerge` for the local workflow, the `gh pr merge`/`glab mr merge` action for
// software-development, success for a simulation) or skipped. A failed, cancelled or interrupted
// run pauses the roadmap at its stage (`pausedBy`): the owner resumes the run (#100, `adoptResumed`),
// retries or skips the item, or stops the roadmap; nothing is skipped or approved by itself.
// `advance` is the pure sequencing step; the service's `dispatchRoadmaps` applies it after each run
// and when a workspace opens (a restart continues where it was). `propose` takes the Product
// Owner's "Build a roadmap" answer (#105) as planned stages; only Start (`state: running`) runs them.
// Run this stage (#141, `scope: { stage: <id> }`): only that stage's items start, in any order; when
// they are all finished the roadmap pauses ("Stage N done") with the scope cleared, so Start then
// runs the whole roadmap from its first unfinished stage.
// Screen: src/renderer/views/backlog/backlog-roadmap.js; channels: src/service/channels/roadmap.js.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { itemIssues } = require('./backlog');
const { writeJsonSafe } = require('./state-file');

// planned: edited, never started by itself · running · paused (a failure, the owner, a proposal) · done
const STATES = ['done', 'paused', 'planned', 'running'];
const ITEM_STATES = ['done', 'failed', 'planned', 'running', 'skipped'];
const FINISHED = new Set(['done', 'skipped']);

const roadmapFile = (dir, projectId) => path.join(dir, `${path.basename(String(projectId))}.roadmap.json`);
const emptyRoadmap = () => ({ state: 'planned', simulated: false, error: null, pausedBy: null, scope: null, stages: [], updatedAt: null });
const newId = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex')}`;

// One item shape (#163): every item has an `issues` list (one issue or more), and the first issue's
// fields (`number`, `url`, `title`, `body`) stay on the item for older readers. Files written before
// stored a single issue as the item itself, with no list: they are normalized when read and written.
const normalizeItem = (x) => (!x || typeof x !== 'object' || (Array.isArray(x.issues) && x.issues.length) || !x.number ? x : { ...x, issues: itemIssues(x) });
const normalizeStages = (stages) => (Array.isArray(stages) ? stages.map((s) => (s && Array.isArray(s.items) ? { ...s, items: s.items.map(normalizeItem) } : s)) : stages);

function readRoadmap(dir, projectId) {
  try {
    const r = { ...emptyRoadmap(), ...JSON.parse(fs.readFileSync(roadmapFile(dir, projectId), 'utf8')) };
    return { ...r, stages: normalizeStages(r.stages) };
  } catch { return emptyRoadmap(); }
}

// What a roadmap file must look like (#112: a write that breaks it is refused, src/state-file.js).
function roadmapProblem(r) {
  if (!r || typeof r !== 'object') return 'not an object';
  if (!STATES.includes(r.state)) return `unknown state ${JSON.stringify(r.state)}`;
  if (!Array.isArray(r.stages)) return 'stages is not a list';
  if (r.scope != null && typeof r.scope.stage !== 'string') return 'scope has no stage id';
  for (const s of r.stages) {
    if (!s || !Array.isArray(s.items)) return 'a stage has no items list';
    for (const x of s.items) {
      if (!x?.id || !x.workflow) return 'an item has no id or workflow';
      if (!ITEM_STATES.includes(x.status)) return `item ${x.id} has an unknown status ${JSON.stringify(x.status)}`;
      if (x.runs && !Array.isArray(x.runs)) return `item ${x.id}: runs is not a list`;
    }
  }
  return null;
}

// Statuses are derived from the runs when read (#112, `withStatus`): the file keeps the plan, each
// item's links to runs (`runId`, `runs`) and only the outcomes no run can change any more: done
// (merged), skipped (the owner, or every issue closed). An item with a run is stored `planned`, and
// its `error` is kept only when it has no run (it could not start).
function persisted(roadmap) {
  return {
    ...roadmap,
    stages: normalizeStages(roadmap.stages || []).map((s) => ({
      ...s,
      items: (s.items || []).map(({ waiting: _w, ...x }) => (FINISHED.has(x.status) ? x : { ...x, status: 'planned', error: x.runId ? null : x.error || null })),
    })),
  };
}

const runFailure = (runId, run) => `Run ${runId} ${run.status === 'success' ? 'finished without merging: merge it, then skip the item'
  : `${run.status === 'interrupted' ? 'was interrupted' : run.status}${run.error ? `: ${String(run.error).slice(0, 200)}` : ''}`}`;

// An item's status from its run: running (a live run, in this process or another one, `waiting` at
// a gate), done (it merged), failed (it ended otherwise, or it could not start), else as stored.
function itemStatus(item, runOf) {
  if (FINISHED.has(item.status)) return { status: item.status, error: item.error || null };
  if (!item.runId) return item.error ? { status: 'failed', error: item.error } : { status: 'planned', error: null };
  const run = runOf(item.runId);
  if (!run) return { status: 'failed', error: `Run ${item.runId} no longer exists.` };
  if (['pending', 'running'].includes(run.status)) return { status: 'running', error: null, ...(run.waiting ? { waiting: true } : {}) };
  if (run.status === 'success' && run.merged) return { status: 'done', error: null };
  return { status: 'failed', error: runFailure(item.runId, run) };
}

/** The roadmap with each item's status derived from its run (`runOf` as in `advance`). */
function withStatus(roadmap, runOf) {
  return {
    ...roadmap,
    stages: (roadmap.stages || []).map((s) => ({ ...s, items: (s.items || []).map(({ waiting: _w, ...x }) => ({ ...x, ...itemStatus(x, runOf) })) })),
  };
}

// Whether an item's run is alive: `alive(runId)` from the service, else (no service: a stored file
// written before #112) its stored status.
const runIsAlive = (item, alive) => (alive ? !!item.runId && !FINISHED.has(item.status) && !!alive(item.runId) : item.status === 'running');

function writeRoadmap(dir, projectId, roadmap) {
  const out = { ...persisted(roadmap), updatedAt: new Date().toISOString() };
  return writeJsonSafe(roadmapFile(dir, projectId), out, { validate: roadmapProblem });
}

const updateRoadmap = (dir, projectId, fn) => writeRoadmap(dir, projectId, fn(readRoadmap(dir, projectId)) || readRoadmap(dir, projectId));

function clearRoadmap(dir, projectId) {
  try { fs.unlinkSync(roadmapFile(dir, projectId)); } catch { /* none */ }
  return emptyRoadmap();
}

// Project ids with a roadmap file.
function roadmapProjects(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.roadmap.json')).map((f) => f.slice(0, -'.roadmap.json'.length)); } catch { return []; }
}

const allItems = (roadmap) => (roadmap.stages || []).flatMap((s) => s.items || []);
const findItem = (roadmap, itemId) => allItems(roadmap).find((x) => x.id === itemId) || null;
/** Index of the stage in progress: the first one with an item not done or skipped (-1: none left). */
const currentStage = (roadmap) => (roadmap.stages || []).findIndex((s) => (s.items || []).some((x) => !FINISHED.has(x.status)));

// One issue of an item, from a number, an issue of the synced backlog or an item's issue.
function issueOf(ref, known) {
  const number = Number(typeof ref === 'object' ? ref?.number : ref);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Not an issue number: ${JSON.stringify(ref)}`);
  const synced = known.get(number);
  const src = { ...(typeof ref === 'object' ? ref : {}), ...(synced || {}) };
  return {
    number, url: src.url || '', title: src.title || `#${number}`, body: src.body || '',
    knownPullRequests: src.knownPullRequests || (src.pullRequests || []).map((p) => p.url),
  };
}

// An item from what the UI or a proposal sends: { id?, workflow, workflowName?, inputs?, mock?, issues,
// reason?, modeReason? (or mode_reason), origin? }: the reasons are the Product Owner's (#105, #110), for the
// group and for its mode; `origin` is the timestamp of the Product Owner's answer the item was added
// from (#140: its groups show "In roadmap", the others "Already in the roadmap"). The run-related
// fields (status, runId, runs, error) come from the item with the same id already in the roadmap:
// editing never loses track of a run.
function cleanItem(raw, known, previous) {
  const workflow = path.basename(String(raw?.workflow || ''));
  if (!workflow) throw new Error('Every roadmap item needs a workflow.');
  const refs = Array.isArray(raw.issues) && raw.issues.length ? raw.issues : raw.number ? [raw] : [];
  if (!refs.length) throw new Error(`The ${workflow} item has no issue.`);
  const issues = refs.map((r) => issueOf(r, known));
  const old = previous.get(raw.id);
  const state = old || { status: 'planned', runId: null, runs: [], error: null };
  const reason = String(raw.reason ?? old?.reason ?? '').trim();
  const modeReason = String(raw.modeReason ?? raw.mode_reason ?? old?.modeReason ?? '').trim();
  const origin = String(raw.origin ?? old?.origin ?? '').trim();
  return {
    id: old ? old.id : newId('item'), workflow, workflowName: raw.workflowName || old?.workflowName || workflow,
    inputs: raw.inputs && typeof raw.inputs === 'object' ? raw.inputs : {}, mock: !!raw.mock,
    ...(reason ? { reason } : {}), ...(modeReason ? { modeReason } : {}), ...(origin ? { origin } : {}),
    ...issues[0], issues,
    status: ITEM_STATES.includes(state.status) ? state.status : 'planned', runId: state.runId || null, runs: state.runs || [], error: state.error || null,
  };
}

// An issue belongs to at most one item that has not finished (done/skipped items keep their history).
function assertUnique(stages) {
  const seen = new Map();
  for (const [n, stage] of stages.entries()) {
    for (const item of stage.items) {
      if (FINISHED.has(item.status)) continue;
      for (const i of itemIssues(item)) {
        if (seen.has(i.number)) throw new Error(`Issue #${i.number} is in two roadmap items (stages ${seen.get(i.number)} and ${n + 1}): keep it in one.`);
        seen.set(i.number, n + 1);
      }
    }
  }
}

/**
 * Validated stages from the UI or a proposal: [{ id?, name?, note?, items: [...] }]. Empty stages are
 * dropped. `known`: the synced backlog's issues (titles, URLs, bodies); `previous`: the roadmap edited.
 */
function cleanStages(stages, { issues = [], previous = null } = {}) {
  const known = new Map((issues || []).map((i) => [i.number, i]));
  const prevItems = new Map(allItems(previous || emptyRoadmap()).map((x) => [x.id, x]));
  const out = (Array.isArray(stages) ? stages : []).map((s) => ({
    // no name: shown as "Stage <n>" wherever it is when shown (reordering renumbers it)
    id: s?.id || newId('stage'), name: String(s?.name || '').trim(), note: String(s?.note || '').trim(),
    items: (Array.isArray(s?.items) ? s.items : []).map((x) => cleanItem(x, known, prevItems)),
  })).filter((s) => s.items.length);
  assertUnique(out);
  return out;
}

/** Replaces the stages (reorder, move an issue, add/remove items, edit inputs). The state is kept. */
function saveStages(dir, projectId, stages, { issues } = {}) {
  return updateRoadmap(dir, projectId, (r) => {
    const next = { ...r, stages: cleanStages(stages, { issues, previous: r }) };
    // an edit that leaves nothing to run ends a running roadmap
    return next.stages.length && currentStage(next) < 0 && r.state === 'running' ? { ...next, state: 'done', scope: null } : next;
  });
}

// The issue numbers of the items not finished yet.
function plannedNumbers(roadmap) {
  return new Set(allItems(roadmap).filter((x) => !FINISHED.has(x.status)).flatMap((x) => itemIssues(x).map((i) => i.number)));
}

/**
 * The Product Owner's roadmap (#105), as planned stages: `replace` swaps the roadmap (refused while
 * one of its runs is in progress), else the stages are added at the end, without the issues the
 * roadmap already plans (listed in `dropped`). It never starts by itself: a running roadmap is paused
 * so the owner reviews the new stages and presses Start.
 * @param {{ stages: object[], note?: string } | object[]} proposal
 */
function propose(dir, projectId, proposal, { replace = false, issues = [], alive = null } = {}) {
  const stages = Array.isArray(proposal) ? proposal : proposal?.stages;
  let dropped = [];
  const roadmap = updateRoadmap(dir, projectId, (r) => {
    if (replace) {
      if (allItems(r).some((x) => runIsAlive(x, alive))) throw new Error('A run of the roadmap is in progress: wait for it to end, or add the proposal instead of replacing the roadmap.');
      return { ...emptyRoadmap(), stages: cleanStages(stages, { issues }) };
    }
    const have = plannedNumbers(r);
    const fresh = (Array.isArray(stages) ? stages : []).map((s) => ({
      ...s, id: null,
      items: (s?.items || []).map((x) => {
        const refs = Array.isArray(x?.issues) && x.issues.length ? x.issues : x?.number ? [x] : [];
        const keep = refs.filter((i) => !have.has(Number(typeof i === 'object' ? i.number : i)));
        dropped = dropped.concat(refs.filter((i) => !keep.includes(i)).map((i) => Number(typeof i === 'object' ? i.number : i)));
        return { ...x, id: null, number: undefined, issues: keep };
      }).filter((x) => x.issues.length),
    }));
    const added = cleanStages(fresh, { issues });
    const state = r.state === 'running' ? 'paused' : r.state === 'done' ? 'planned' : r.state;
    return { ...r, state, error: r.state === 'running' && added.length ? `${added.length} stage(s) added from a proposal: press Start to continue.` : r.error, stages: [...r.stages, ...added] };
  });
  return { roadmap, dropped };
}

/** Takes issues out of the items not finished and not running (they were assigned elsewhere); empty items and stages go. */
function dropIssues(dir, projectId, numbers, { alive = null } = {}) {
  const out = new Set((numbers || []).map(Number));
  if (!fs.existsSync(roadmapFile(dir, projectId))) return readRoadmap(dir, projectId);
  return updateRoadmap(dir, projectId, (r) => ({
    ...r,
    stages: r.stages.map((s) => ({
      ...s,
      items: s.items.flatMap((x) => {
        if (FINISHED.has(x.status) || runIsAlive(x, alive)) return [x];
        const left = itemIssues(x).filter((i) => !out.has(i.number));
        if (left.length === itemIssues(x).length) return [x];
        const { issues: _old, ...rest } = x;
        return left.length ? [{ ...rest, ...left[0], issues: left }] : [];
      }),
    })).filter((s) => s.items.length),
  }));
}

/** Moves the plain queue's items into a new planned stage at the end (the queue loses them). */
function fromQueue(queueItems, name = 'From the queue') {
  return {
    name,
    note: 'Moved from the assignment queue.',
    items: queueItems.map((q) => ({ workflow: q.workflow, workflowName: q.workflowName, inputs: q.inputs, mock: q.mock, issues: itemIssues(q) })),
  };
}

// Owner actions on the roadmap: start (running; `simulated` starts every item as a simulation),
// pause (nothing new starts, runs in progress go on), stop (back to a plan). `stage` (a stage id, with
// running): run only that stage (#141); a start without it runs the whole roadmap, a pause keeps the scope.
function setState(dir, projectId, state, { simulated, stage = null } = {}) {
  if (!STATES.includes(state)) throw new Error(`Unknown roadmap state: ${state}`);
  return updateRoadmap(dir, projectId, (r) => {
    if (state === 'running' && !r.stages.length) throw new Error('The roadmap has no stage: add items first.');
    let scope = state === 'paused' ? r.scope || null : null;
    if (state === 'running' && stage) {
      const s = r.stages.find((x) => x.id === stage);
      if (!s) throw new Error('This stage is no longer in the roadmap.');
      if (!s.items.some((x) => !FINISHED.has(x.status))) throw new Error('Every item of this stage is done or skipped.');
      scope = { stage: s.id };
    }
    return { ...r, state, scope, error: null, pausedBy: null, ...(simulated !== undefined ? { simulated: !!simulated } : {}) };
  });
}

// Owner actions on an item: retry (planned again, its runs kept in `runs`), skip (counts as finished).
// On the item that paused the roadmap, the roadmap goes on (the owner decided what to do with it).
// `alive(runId)`: whether a process (this one or another app) still runs it (#112): a retry then
// would start the same work twice, so it is refused (and a skip: stop the run first).
function itemAction(dir, projectId, itemId, action, { alive = null } = {}) {
  if (!['retry', 'skip'].includes(action)) throw new Error(`Unknown roadmap item action: ${action}`);
  return updateRoadmap(dir, projectId, (r) => {
    const item = findItem(r, itemId);
    if (!item) throw new Error('This roadmap item no longer exists.');
    if (runIsAlive(item, alive)) {
      throw new Error(action === 'retry' && item.runId ? `Run ${item.runId} is still running.` : 'Its run is in progress: stop the run first.');
    }
    const status = action === 'retry' ? 'planned' : 'skipped';
    const unblocked = r.pausedBy === itemId;
    return {
      ...r, ...(unblocked ? { pausedBy: null, error: null, state: r.state === 'paused' ? 'running' : r.state } : {}),
      stages: r.stages.map((s) => ({ ...s, items: s.items.map((x) => (x.id === itemId ? { ...x, status, runId: action === 'retry' ? null : x.runId, error: action === 'skip' ? 'Skipped by the owner.' : null } : x)) })),
    };
  });
}

// The run of an item that failed was resumed from a step (#100): the new run takes its place, and a
// roadmap that this failure paused goes on (the owner acted on it). Also when the run resumed is
// one of the item's earlier runs (`runs`, #112: an original resumed after its duplicate was cancelled).
function adoptResumed(dir, projectId, oldRunId, newRunId) {
  if (!fs.existsSync(roadmapFile(dir, projectId))) return null;
  const r = readRoadmap(dir, projectId);
  const item = allItems(r).find((x) => x.runId === oldRunId) || allItems(r).find((x) => (x.runs || []).includes(oldRunId));
  if (!item) return null;
  return updateRoadmap(dir, projectId, (cur) => ({
    ...cur, ...(cur.pausedBy === item.id ? { state: 'running', pausedBy: null, error: null } : {}),
    stages: cur.stages.map((s) => ({ ...s, items: s.items.map((x) => (x.id === item.id ? { ...x, status: 'planned', runId: newRunId, runs: [...(x.runs || []), newRunId], error: null } : x)) })),
  }));
}

/** Whether a run's events show a PR/MR merged by its action (`gh pr merge` / `glab mr merge`, exit 0). */
function mergedPullRequest(runDir) {
  let text;
  try { text = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'); } catch { return false; }
  return text.split('\n').some((l) => {
    if (!l.includes('"action.executed"')) return false;
    try {
      const ev = JSON.parse(l);
      return ev.exit_code === 0 && !ev.skipped && /\b(gh\s+pr|glab\s+mr)\s+merge\b/.test(ev.command || '');
    } catch { return false; }
  });
}

const refs = (item) => itemIssues(item).map((i) => `#${i.number}`).join(', ');
const stageName = (r, at) => r.stages[at].name || `Stage ${at + 1}`;

// One stage's step: its items whose issues are all closed are skipped, a failure pauses the roadmap,
// else the items to start; null when every item is finished.
function stageStep(r, at, { closed, canStart }) {
  const stage = r.stages[at];
  for (const item of stage.items) {
    if (item.status === 'planned' && itemIssues(item).every((i) => closed(i.number))) {
      Object.assign(item, { status: 'skipped', error: 'Every issue is closed.' });
    }
  }
  const failed = stage.items.find((x) => x.status === 'failed');
  if (failed) {
    return {
      roadmap: { ...r, state: 'paused', pausedBy: failed.id, error: `${stageName(r, at)}: ${refs(failed)} failed. Resume its run, retry or skip the item, or stop the roadmap. ${failed.error || ''}`.trim() },
      start: [],
    };
  }
  if (stage.items.every((x) => FINISHED.has(x.status))) return null;
  return { roadmap: r, start: stage.items.filter((x) => x.status === 'planned' && canStart(x)) };
}

/**
 * One sequencing step (pure): derives the items' statuses from their runs (`withStatus`), pauses on
 * a failure, moves to the next stage when every item is done or skipped, and lists the items to start.
 * A roadmap running one stage (`scope`, #141) only works on that stage, and pauses when it is over.
 * @param {object} roadmap
 * @param {{ runOf: (runId) => ({ status, waiting?, merged? } | null), closed?: (number) => boolean, canStart?: (item) => boolean }} env
 * @returns {{ roadmap: object, start: object[] }} the items to start (still `planned`: the caller marks them)
 */
function advance(roadmap, { runOf, closed = () => false, canStart = () => true }) {
  // Statuses follow the runs whatever the roadmap state (#112): `runOf` reports a run another live
  // process owns as running, so an item is never failed while its run is alive; and a roadmap paused
  // by an item whose run is alive again (resumed, or judged by another app process) goes on.
  let r = withStatus(roadmap, runOf);
  const blocker = r.pausedBy && findItem(r, r.pausedBy);
  if (blocker?.status === 'running') r = { ...r, pausedBy: null, error: null, state: r.state === 'paused' ? 'running' : r.state };
  // only starting new items (and pausing on a failure) waits for a running roadmap
  if (r.state !== 'running') return { roadmap: r, start: [] };
  const finished = { ...r, state: 'done', error: null, pausedBy: null, scope: null };
  if (r.scope) {
    const at = r.stages.findIndex((s) => s.id === r.scope.stage);
    if (at < 0) return { roadmap: { ...r, state: 'paused', pausedBy: null, scope: null, error: 'The stage run on its own is no longer in the roadmap: press Start to run the roadmap.' }, start: [] };
    const step = stageStep(r, at, { closed, canStart });
    if (step) return step;
    if (currentStage(r) < 0) return { roadmap: finished, start: [] };
    return { roadmap: { ...r, state: 'paused', pausedBy: null, scope: null, error: `${stageName(r, at)} done. The other stages are still planned: Start runs the roadmap from its first unfinished stage.` }, start: [] };
  }
  for (;;) {
    const at = currentStage(r);
    if (at < 0) return { roadmap: finished, start: [] };
    const step = stageStep(r, at, { closed, canStart });
    if (step) return step;
  }
}

// Marks an item started (runId) or failed to start (error, the roadmap paused).
function markStarted(dir, projectId, itemId, { runId = null, error = null }) {
  return updateRoadmap(dir, projectId, (r) => ({
    ...r,
    ...(error ? { state: 'paused', pausedBy: itemId, error: `Could not start ${refs(findItem(r, itemId) || { number: '?' })}: ${error}` } : {}),
    stages: r.stages.map((s) => ({
      ...s,
      // statuses are derived (withStatus): no run and an error reads as failed, a run as its run's status
      items: s.items.map((x) => (x.id !== itemId ? x : error ? { ...x, status: 'planned', runId: null, error } : { ...x, status: 'planned', runId, runs: [...(x.runs || []), runId], error: null })),
    })),
  }));
}

/** Each planned issue's place in the roadmap (the Backlog's cards): number → { stage, status, itemId }. */
function issueStages(roadmap) {
  const out = new Map();
  (roadmap.stages || []).forEach((s, n) => {
    for (const x of s.items) for (const i of itemIssues(x)) out.set(i.number, { stage: n + 1, name: s.name || `Stage ${n + 1}`, status: x.status, itemId: x.id, origin: x.origin || null });
  });
  return out;
}

module.exports = {
  adoptResumed,
  advance,
  cleanStages,
  clearRoadmap,
  currentStage,
  dropIssues,
  findItem,
  fromQueue,
  issueStages,
  itemAction,
  markStarted,
  mergedPullRequest,
  normalizeItem,
  persisted,
  propose,
  readRoadmap,
  roadmapProjects,
  saveStages,
  setState,
  updateRoadmap,
  withStatus,
  writeRoadmap,
};
