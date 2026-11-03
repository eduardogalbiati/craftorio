// @ts-check
// Backlog roadmap (#106): an ordered plan of runs per project, in
// <workspace>/backlog/<project id>.roadmap.json, next to the queue (packages/engine/domains/backlog/backlog.js). Stages run one
// after the other; the items of a stage (each one run: a workflow with one issue or a group, the
// queue's item shape, so `itemIssues`/`runInputs` start it like an assigned group) run in parallel
// up to the concurrency limit. A stage is over when every item is done (finished successfully and
// merged: `localMerge` for the local workflow, the `gh pr merge`/`glab mr merge` action for
// software-development, success for a simulation or for a workflow with `metadata.merges: false`
// such as backlog-refresh, #161) or skipped. A failed, cancelled or interrupted
// run pauses the roadmap at its stage (`pausedBy`): the owner resumes the run (#100, `adoptResumed`),
// retries or skips the item, or stops the roadmap; nothing is skipped or approved by itself.
// `advance` is the pure sequencing step; the service's `dispatchRoadmaps` applies it after each run
// and when a workspace opens (a restart continues where it was). `propose` takes the Product
// Owner's "Build a roadmap" answer (#105) as planned stages; only Start (`state: running`) runs them.
// Run this stage (#141, `scope: { stage: <id> }`): only that stage's items start, in any order; when
// they are all finished the roadmap pauses ("Stage N done") with the scope cleared, so Start then
// runs the whole roadmap from its first unfinished stage. The bar's "Pause after this stage" (#391,
// `pauseAfterStage`) sets the same scope on the current stage, with `pauseAfter: true`.
// The items' issue texts are read-only copies (#168): each sync refreshes the items not started yet
// (`refreshCopies`), and the service reads the issues again right before a start (an item whose
// issues are all closed then is skipped, `skipClosed`).
// Live roadmap (#164, `live`, packages/engine/domains/roadmap/live-roadmap.js): when the last stage of a live roadmap ends,
// `advance` asks for a refill (`refill: true`) instead of ending it; the service adds the Product
// Owner's next stages (`propose` keeps a running roadmap running, #654) and the roadmap goes on.
// Cost (#205, #206): an item keeps the Product Owner's Cost choices (`cost`: the step, the inputs it
// set, the grouping); a test-batch item (`testsLater`) tests the issues of the stage before it, so it
// may name issues another item holds and runs even when they are closed. The budget cap (packages/engine/domains/usage/budget.js)
// pauses a roadmap before a start (`budget`: the period, spent, cap and next stage); "Resume anyway"
// records `budgetWaived` (the day or night it covers) and Start clears the pause.
// Cut lines (#260, packages/engine/domains/releases/releases.js): a release is its own entry of the ordered list (#555,
// `{ kind: 'release', id, name, status?, runId?, shippedAt?, items: [] }` between two stages, "Release
// here"); moving, disabling, emptying or removing a stage leaves it where it is. When every enabled
// stage before it is finished, `advance` starts nothing after it and asks for the release run
// (`release: { id, name }`); the service starts the bundled release workflow and records it on the
// entry (`takeRelease`: `runId`, `status: 'running'`), and the stages after it wait until it shipped
// (`status: 'shipped'`, `setRelease`). A release run that ends otherwise leaves the entry held or
// failed and pauses the roadmap there (`holdRelease`, `releaseHold`: its id); Resume checks the
// release again. A running or shipped release keeps its name and place. A roadmap running one stage
// (`scope`) and a roadmap without releases never wait. Files written before #555 kept the cut line as
// a `release` field of the stage before it: a read moves it into an entry right after that stage.
// Stale edits (#287): every write reads and writes the file in one synchronous step (`updateRoadmap`),
// so the service's writers never interleave; `readRoadmapAt` gives back the stages a screen read, by
// their `updatedAt`, for a save based on that read (packages/engine/domains/roadmap/roadmap-merge.js).
// Rules and writes (#349): the rules (the states, what is finished, the current stage, which owner
// action applies) are packages/shared/roadmap-model.js, pure and shared with the screens; this module is
// the only writer of a roadmap's `state`, `pausedBy`, `scope` and item statuses (other modules ask
// it: `pauseRoadmap`, `finishRoadmap`).
// Move on (#395): an item whose run waits at a human gate is parked (`itemAction` park, or the stage's
// `parkStage`): it counts as finished, the next stage starts and the run keeps waiting at its gate,
// the owner's to answer. Answered later, the item takes the run's outcome (done, or failed without
// pausing the roadmap). A later stage's runs start without the parked change.
// Main stays green (#405, packages/engine/domains/project/base-health.js): a red test on the base puts a fix item in a new stage
// before the current one (`insertFrontStage`).
// The waiting refactor stage (#435): a disabled stage marked `waiting` (Send to Refactor's items,
// fronts/analyser/engine/channels/refactor.js) stays last: `propose` adds its stages before it, and so does
// `cleanStages` with the stages a save adds after it (the owner's add stage). Enabled, it loses
// the marker and becomes a plain stage.
// Screen: fronts/build/views/backlog/backlog-roadmap.js; channels: packages/engine/service/channels/roadmap.js.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { itemIssues, withSyncedText } = require('../backlog/issues');
const { normalizeThen } = require('@multiagent/shared/chain-model');
const { isArchived } = require('@multiagent/shared/backlog-archive');
const { dropWaitingSuffix } = require('../refactor/refactor-cadence');
const {
  allowedActions,
  atGate,
  currentStage,
  isFinished,
  isLockedRelease,
  isRelease,
  ITEM_STATES,
  pendingRelease,
  releaseEntries,
  stageNumber,
  STATES,
} = require('@multiagent/shared/roadmap-model');
const { writeJsonSafe } = require('../workspace/state-file');
const {
  assertEarlierDependencies,
  dependencyBase,
  dependsOnField,
  forgetGoneParents,
} = require('./roadmap-dependency');

/** @typedef {import('@multiagent/shared/types').Roadmap} Roadmap */
/** @typedef {((runId: string) => any) | null} Alive `alive(runId)`: as for `runIsAlive` */

// #205: a test-backfill item tests the issues the items before it implemented (#631: and an item
// saved with the old name test-batch.yaml, its alias)
const testsLater = (item) => ['test-backfill.yaml', 'test-batch.yaml'].includes(path.basename(String(item?.workflow || '')));

const roadmapFile = (dir, projectId) => path.join(dir, `${path.basename(String(projectId))}.roadmap.json`);
/** @returns {Roadmap} */
const emptyRoadmap = () => ({ state: 'planned', simulated: false, error: null, pausedBy: null, scope: null, stages: [], updatedAt: null });
const newId = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex')}`;

// One item shape (#163): every item has an `issues` list (one issue or more), and the first issue's
// fields (`number`, `url`, `title`, `body`) stay on the item for older readers. Files written before
// stored a single issue as the item itself, with no list: they are normalized when read and written.
const normalizeItem = (x) => (!x || typeof x !== 'object' || (Array.isArray(x.issues) && x.issues.length) || !x.number ? x : { ...x, issues: itemIssues(x) });
// #555: a release entry has no items of its own (an empty list, for the readers of every entry's
// items); a stage's cut line (`release`) becomes an entry right after it (RoadmapModel.releaseEntries;
// `migrate`: a file read, whose old cut lines get their id from the stage's)
const releaseEntry = (raw, id) => ({ kind: 'release', id, ...raw, items: [] });
const normalizeStages = (stages, migrate = false) => (Array.isArray(stages)
  ? releaseEntries(stages.map((s) => (s && !isRelease(s) && Array.isArray(s.items) ? { ...s, items: s.items.map(normalizeItem) } : s)), { migrate })
  : stages);

// #287: the stages of each roadmap file as recently read or written, by `updatedAt` (in memory, the
// last SEEN_MAX per file): an edit based on an older read is merged against what it read
// (packages/engine/domains/roadmap/roadmap-merge.js). `updatedAt` only grows, so two writes in the same millisecond differ.
const SEEN_MAX = 50;
const seen = new Map(); // file → Map(updatedAt → stages as JSON)
const newest = new Map(); // file → the latest updatedAt seen, in ms
function remember(file, at, stages) {
  if (!at) return;
  newest.set(file, Math.max(newest.get(file) || 0, Date.parse(at) || 0));
  let known = seen.get(file);
  if (!known) seen.set(file, (known = new Map()));
  if (known.has(at)) return;
  known.set(at, JSON.stringify(stages || []));
  if (known.size > SEEN_MAX) known.delete(known.keys().next().value);
}

function readRoadmap(dir, projectId) {
  try {
    const file = roadmapFile(dir, projectId);
    const r = { ...emptyRoadmap(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    remember(file, r.updatedAt, r.stages);
    return { ...r, stages: normalizeStages(r.stages, true) };
  } catch { return emptyRoadmap(); }
}

/** #287: the stages of the roadmap as they were at `updatedAt` (read or written by this process), or null. */
function readRoadmapAt(dir, projectId, updatedAt) {
  const text = seen.get(roadmapFile(dir, projectId))?.get(String(updatedAt || ''));
  return text ? normalizeStages(JSON.parse(text), true) : null;
}

// What a roadmap file must look like (#112: a write that breaks it is refused, packages/engine/domains/workspace/state-file.js).
function roadmapProblem(r) {
  if (!r || typeof r !== 'object') return 'not an object';
  if (!STATES.includes(r.state)) return `unknown state ${JSON.stringify(r.state)}`;
  if (!Array.isArray(r.stages)) return 'stages is not a list';
  if (r.scope != null && typeof r.scope.stage !== 'string') return 'scope has no stage id';
  if (r.live != null && typeof r.live !== 'boolean') return 'live is not true or false';
  for (const s of r.stages) {
    if (!s || !Array.isArray(s.items)) return 'a stage has no items list';
    if (isRelease(s) && (!s.id || !String(s.name || '').trim() || s.items.length)) return 'a release has no id or name, or has items';
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
    // a stage's `pause` (#368: its pause line) is the screen's too
    stages: normalizeStages(roadmap.stages || [], true).map(({ pause: _p, ...s }) => ({
      ...s,
      // `waiting` and `run` (#194: its progress for the card) are the screen's, never stored
      items: (s.items || []).map(({ waiting: _w, run: _r, ...x }) => (isFinished(x) ? x : { ...x, status: 'planned', error: x.runId ? null : x.error || null })),
    })),
  };
}

const runFailure = (runId, run) => `Run ${runId} ${run.status === 'success' ? 'finished without merging: merge it, then skip the item'
  : `${run.status === 'interrupted' ? 'was interrupted' : run.status}${run.error ? `: ${String(run.error).slice(0, 200)}` : ''}`}`;

// An item's status from its run: running (a live run, in this process or another one, `waiting` at
// a gate), paused (#368: its run paused after its current turn, never a failure), done (it merged),
// failed (it ended otherwise, or it could not start), else as stored.
// #395: a parked item stays parked while its run waits (or was interrupted, or paused); once its gate
// is answered it takes the run's outcome: done when it merged, else failed, still marked `parked` so
// it never holds its stage or pauses the roadmap (packages/shared/roadmap-model.js isFinished).
function itemStatus(item, runOf) {
  if (item.status === 'parked') {
    const parked = item.parked || { at: null, gate: null };
    const run = item.runId ? runOf(item.runId) : null;
    if (!run) return { status: 'failed', error: `Run ${item.runId} no longer exists.`, parked };
    if (['interrupted', 'paused', 'pending', 'running'].includes(run.status)) return { status: 'parked', error: null, parked };
    if (run.status === 'success' && run.merged) return { status: 'done', error: null, parked };
    return { status: 'failed', error: runFailure(item.runId, run), parked };
  }
  if (isFinished(item)) return { status: item.status, error: item.error || null };
  if (!item.runId) return item.error ? { status: 'failed', error: item.error } : { status: 'planned', error: null };
  const run = runOf(item.runId);
  if (!run) return { status: 'failed', error: `Run ${item.runId} no longer exists.` };
  if (['pending', 'running'].includes(run.status)) return { status: 'running', error: null, ...(run.waiting ? { waiting: true } : {}) };
  if (run.status === 'paused') return { status: 'paused', error: null };
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
// written before #112) its stored status. A parked item's run (#395) still waits at its gate.
const runIsAlive = (item, alive) => (alive ? !!item.runId && (!isFinished(item) || item.status === 'parked') && !!alive(item.runId) : ['parked', 'running'].includes(item.status));

function writeRoadmap(dir, projectId, roadmap) {
  const file = roadmapFile(dir, projectId);
  const last = Math.max(newest.get(file) || 0, Date.parse(roadmap?.updatedAt) || 0);
  const out = { ...persisted(roadmap), updatedAt: new Date(Math.max(Date.now(), last + 1)).toISOString() };
  const written = writeJsonSafe(file, out, { validate: roadmapProblem });
  remember(file, out.updatedAt, out.stages);
  return written;
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

/** @param {Roadmap} roadmap */
const allItems = (roadmap) => roadmap.stages.flatMap((s) => s.items);
/**
 * @param {Roadmap} roadmap
 * @param {string} itemId
 */
const findItem = (roadmap, itemId) => allItems(roadmap).find((x) => x.id === itemId) || null;
/**
 * @param {Roadmap} roadmap
 * @param {string} stageId
 */
const findStage = (roadmap, stageId) => roadmap.stages.find((s) => s.id === stageId) || null;

// One issue of an item, from a number, an issue of the synced backlog or an item's issue.
function issueOf(ref, known) {
  const number = Number(typeof ref === 'object' ? ref?.number : ref);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Not an issue number: ${JSON.stringify(ref)}`);
  const synced = known.get(number);
  const src = { ...(typeof ref === 'object' ? ref : {}), ...(synced || {}) };
  return {
    number, url: src.url || '', title: src.title || `#${number}`, body: src.body || '', labels: src.labels || [], updatedAt: src.updatedAt || null,
    knownPullRequests: src.knownPullRequests || (src.pullRequests || []).map((p) => p.url),
  };
}

/**
 * Brings the issue copies of the items not started yet (not finished, no run) up to `issues` (a
 * sync, or the fresh read right before a start, #168): the platform is the source of truth, the
 * copies only show it. Items with a run keep the text their run used. Writes only on a change.
 */
function refreshCopies(dir, projectId, issues) {
  if (!fs.existsSync(roadmapFile(dir, projectId))) return false;
  const known = new Map((issues || []).map((i) => [i.number, i]));
  const refresh = (x) => {
    if (isFinished(x) || x.runId) return x;
    const list = itemIssues(x).map((i) => withSyncedText(i, known.get(i.number)));
    return { ...x, ...list[0], issues: list };
  };
  const before = readRoadmap(dir, projectId);
  if (allItems(before).every((x) => JSON.stringify(refresh(x)) === JSON.stringify(x))) return false;
  updateRoadmap(dir, projectId, (r) => ({ ...r, stages: r.stages.map((s) => ({ ...s, items: s.items.map(refresh) })) }));
  return true;
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
  // #238: an archived issue cannot join an item (what an item already held stays, so the roadmap
  // can still be edited when an issue was archived on the platform)
  const held = new Set(old ? itemIssues(old).map((i) => i.number) : []);
  const archived = issues.find((i) => !held.has(i.number) && isArchived(known.get(i.number)));
  if (archived) throw new Error(`Issue #${archived.number} is archived: restore it in the Backlog before planning it.`);
  const state = old || { status: 'planned', runId: null, runs: [], error: null };
  const reason = String(raw.reason ?? old?.reason ?? '').trim();
  const modeReason = String(raw.modeReason ?? raw.mode_reason ?? old?.modeReason ?? '').trim();
  const origin = String(raw.origin ?? old?.origin ?? '').trim();
  // #527: who added the item ('base-health': the base check's fix item, skipped when its issue is in a live run)
  const source = String(raw.source ?? old?.source ?? '').trim();
  // what happens with the item's run result when it finishes (#134), given to its start
  const then = normalizeThen(raw.then);
  // the Product Owner's Cost choices (#205), shown on the card
  const cost = raw.cost && typeof raw.cost === 'object' ? raw.cost : old?.cost || null;
  // #262: the provider / model / effort per agent chosen for the item's run (its Edit's Agents)
  const agentOverrides = raw.agentOverrides && typeof raw.agentOverrides === 'object' && Object.keys(raw.agentOverrides).length ? raw.agentOverrides : null;
  return {
    id: old ? old.id : newId('item'), workflow, workflowName: raw.workflowName || old?.workflowName || workflow,
    inputs: raw.inputs && typeof raw.inputs === 'object' ? raw.inputs : {}, mock: !!raw.mock,
    ...(reason ? { reason } : {}), ...(modeReason ? { modeReason } : {}), ...(origin ? { origin } : {}), ...(source ? { source } : {}), ...(then ? { then } : {}), ...(cost ? { cost } : {}),
    // #738: the earlier item this one builds on (a split implementation, roadmap-dependency.js)
    ...(agentOverrides ? { agentOverrides } : {}), ...dependsOnField(raw, old),
    ...issues[0], issues,
    ...runState(state),
  };
}

// The run-related fields an edited item keeps from the stored one (cleanItem)
function runState(state) {
  return {
    status: ITEM_STATES.includes(state.status) ? state.status : 'planned', runId: state.runId || null, runs: state.runs || [], error: state.error || null,
    // #395: where the roadmap moved on past the item's gate
    ...(state.parked ? { parked: state.parked } : {}),
  };
}

// An issue belongs to at most one item that has not finished (done/skipped items keep their history).
function assertUnique(stages) {
  const seen = new Map();
  for (const [n, stage] of stages.entries()) {
    for (const item of stage.items) {
      if (isFinished(item) || testsLater(item)) continue;
      for (const i of itemIssues(item)) {
        if (seen.has(i.number)) throw new Error(`Issue #${i.number} is in two roadmap items (stages ${seen.get(i.number)} and ${n + 1}): keep it in one.`);
        seen.set(i.number, n + 1);
      }
    }
  }
}

// A release entry (#260, #555): its name, trimmed (none without a name), its id kept (a new one gets
// one). What the release run did to it (status, runId, when it shipped) comes from the same entry
// already in the roadmap, never from the edit: an edit cannot mark a release shipped, a renamed one
// is a new release, and a running or shipped one keeps its name (cleanStages keeps its place too).
function cleanRelease(raw, old) {
  if (isLockedRelease(old)) return { ...old };
  const name = String(raw?.name || '').trim();
  if (!name) return null;
  return old?.name === name ? { ...old, name } : releaseEntry({ name }, String(raw?.id || '') || newId('release'));
}

// #555: the running and shipped releases of `previous` stay where they were: right after the stage
// (or release) they followed, at the start when they led; one an edit left out comes back
function keepLockedReleases(out, previous) {
  const before = previous?.stages || [];
  const locked = before.filter((s) => isRelease(s) && isLockedRelease(s));
  if (!locked.length) return out;
  const ids = new Set(locked.map((s) => s.id));
  const kept = new Map(out.filter((s) => ids.has(s.id)).map((s) => [s.id, s]));
  const list = out.filter((s) => !ids.has(s.id));
  for (const entry of locked) {
    // the nearest entry before it that is still there (its stage removed: the one before that)
    let k = before.indexOf(entry) - 1;
    while (k >= 0 && !list.some((s) => s.id === before[k].id)) k -= 1;
    list.splice(k < 0 ? 0 : list.findIndex((s) => s.id === before[k].id) + 1, 0, kept.get(entry.id) || { ...entry });
  }
  return list;
}

// #284: a stage is not disabled while one of its items runs (nothing in progress would stop)
const DISABLE_BUSY = 'An item of this stage is running: wait for it, or stop its run, before disabling the stage.';

/**
 * Validated stages from the UI or a proposal: [{ id?, name?, note?, items: [...] }], with the release
 * entries between them ({ kind: 'release', id?, name }, #555; a stage's `release: { name }` of an older
 * writer becomes one after it). Empty stages are dropped, the releases stay. `known`: the synced backlog's issues (titles, URLs, bodies); `previous`:
 * the roadmap edited; `alive(runId)`: as for `runIsAlive` (the file stores a running item as planned).
 * @param {any} stages
 * @param {{ issues?: any[] | null, previous?: Roadmap | null, alive?: Alive }} [options]
 */
function cleanStages(stages, { issues = [], previous = null, alive = null } = {}) {
  const known = new Map((issues || []).map((i) => [i.number, i]));
  const prevItems = new Map(allItems(previous || emptyRoadmap()).map((x) => [x.id, x]));
  const prevReleases = new Map((previous?.stages || []).filter((s) => s?.id && isRelease(s)).map((s) => [s.id, s]));
  const prevDisabled = new Set((previous?.stages || []).filter((s) => s?.id && s.disabled).map((s) => s.id));
  const prevWaiting = new Set((previous?.stages || []).filter((s) => s?.id && s.waiting).map((s) => s.id));
  const prevBusy = new Set((previous?.stages || []).filter((s) => s?.id && (s.items || []).some((x) => runIsAlive(x, alive))).map((s) => s.id));
  const listed = normalizeStages((Array.isArray(stages) ? stages : []).filter(Boolean));
  const out = listed.map((s) => {
    if (isRelease(s)) return cleanRelease(s, prevReleases.get(s.id));
    // #284: only an edit that says so changes the switch; a writer that does not know it (the
    // Oracle's roadmap.stages, a proposal, an outside script) keeps what is stored
    const disabled = s?.disabled === undefined ? prevDisabled.has(s?.id) : !!s.disabled;
    // the screen's Disable is off while an item of the stage runs; any other writer gets the same answer
    if (disabled && !prevDisabled.has(s?.id) && prevBusy.has(s?.id)) throw new Error(DISABLE_BUSY);
    // #435: the refactor stage waiting for the owner's OK stays one while disabled; enabled, it is a
    // plain stage that drops the "(waiting for your OK)" of its name
    const waiting = (s?.waiting === undefined ? prevWaiting.has(s?.id) : !!s.waiting);
    const name = String(s?.name || '').trim();
    return {
      // no name: shown as "Stage <n>" wherever it is when shown (reordering renumbers it)
      id: s?.id || newId('stage'), name: waiting && !disabled ? dropWaitingSuffix(name) : name, note: String(s?.note || '').trim(),
      ...(disabled ? { disabled: true } : {}),
      ...(waiting && disabled ? { waiting: true } : {}),
      items: (Array.isArray(s?.items) ? s.items : []).map((x) => cleanItem(x, known, prevItems)),
    };
  }).filter((s) => s && (isRelease(s) || s.items.length));
  out.splice(0, out.length, ...keepLockedReleases(out, previous));
  // #435: stages the owner adds after the waiting refactor stage (the Backlog's add stage, a move to
  // a new last stage) go before it, so it stays last; reordering stored stages is left as asked
  const prevIds = new Set((previous?.stages || []).map((s) => s?.id).filter(Boolean));
  const prevLast = previous?.stages?.[previous.stages.length - 1];
  const w = prevLast?.waiting ? out.findIndex((s) => s.id === prevLast.id && s.waiting) : -1;
  if (w >= 0 && w < out.length - 1 && out.slice(w + 1).every((s) => !prevIds.has(s.id))) out.push(...out.splice(w, 1));
  assertUnique(out);
  // #738: a removed parent leaves its children without a dependency, not an unsavable roadmap
  const kept = forgetGoneParents(out, prevItems.keys());
  assertEarlierDependencies(kept);
  return kept;
}

/**
 * Replaces the stages (reorder, move an issue, add/remove items, edit inputs). The state is kept.
 * @param {string} dir
 * @param {string} projectId
 * @param {any} stages
 * @param {{ issues?: any[] | null, alive?: Alive }} [options]
 */
function saveStages(dir, projectId, stages, { issues, alive = null } = {}) {
  return updateRoadmap(dir, projectId, (r) => {
    const next = { ...r, stages: cleanStages(stages, { issues, previous: r, alive }) };
    // #284: a stage run on its own (#141) that is disabled is no scope any more: a Resume runs the roadmap
    if (next.scope && next.stages.some((s) => s.id === next.scope.stage && s.disabled)) next.scope = null;
    // an edit that leaves nothing to run ends a running roadmap (not one that waits at a cut line, #260)
    return next.stages.length && currentStage(next) < 0 && r.state === 'running' && !pendingRelease(next, -1) ? { ...next, state: 'done', scope: null } : next;
  });
}

/**
 * #281: Undo and Restore put stages back as they were stored, ids and run states included (saveStages
 * would plan a returned item again under a new id). `change(stages)` gives the new stages, or throws
 * to refuse. The state is kept, except that a roadmap that was done and gets unfinished items back
 * is paused: it never starts them by itself, the owner resumes it.
 */
function restoreStages(dir, projectId, change, { alive = null } = {}) {
  return updateRoadmap(dir, projectId, (r) => {
    const stages = change(r.stages).filter((s) => isRelease(s) || s.items.length);
    assertUnique(stages);
    // #284: an Undo that would disable a stage whose item started meanwhile is refused, with the reason
    const now = new Map(r.stages.map((s) => [s.id, s]));
    if (stages.some((s) => s.disabled && now.has(s.id) && !now.get(s.id).disabled && now.get(s.id).items.some((x) => runIsAlive(x, alive)))) throw new Error(DISABLE_BUSY);
    const next = { ...r, stages };
    return r.state === 'done' && currentStage(next) >= 0 ? { ...next, state: 'paused' } : next;
  });
}

// The issue numbers of the items not finished yet.
function plannedNumbers(roadmap) {
  return new Set(allItems(roadmap).filter((x) => !isFinished(x) && !testsLater(x)).flatMap((x) => itemIssues(x).map((i) => i.number)));
}

/**
 * #405: a fix for the base's red tests goes at the front of the roadmap: a new stage `raw` (as for
 * cleanStages) before the current one, at the end when none is left. The other stages and items stay
 * as they are; a done roadmap is paused (the owner resumes it, it never starts by itself).
 * @returns {object|null} the stage added, or null when its issues are all planned already
 */
function insertFrontStage(dir, projectId, raw) {
  const [stage] = cleanStages([raw]);
  const have = plannedNumbers(readRoadmap(dir, projectId));
  if (!stage || stage.items.every((x) => itemIssues(x).every((i) => have.has(i.number)))) return null;
  updateRoadmap(dir, projectId, (r) => {
    const stages = [...r.stages];
    const at = currentStage(r);
    stages.splice(at < 0 ? stages.length : at, 0, stage);
    return { ...r, stages, state: r.state === 'done' ? 'paused' : r.state };
  });
  return stage;
}

/**
 * The Product Owner's roadmap (#105), as planned stages: `replace` swaps the roadmap (refused while
 * one of its runs is in progress), else the stages are added at the end, without the issues the
 * roadmap already plans (listed in `dropped`). Adding never pauses (#654): a running roadmap keeps
 * running and the new stages run in their turn; a planned or paused one keeps its state, its scope,
 * pausedBy and error; a done one becomes planned (nothing starts until Start). `keepRunning` (the
 * analyser's waiting refactor stage, #435): a done roadmap stays done too.
 * @param {string} dir
 * @param {string} projectId
 * @param {{ stages: object[], note?: string } | object[]} proposal
 * @param {{ replace?: boolean, issues?: any[] | null, alive?: Alive, keepRunning?: boolean }} [options]
 */
function propose(dir, projectId, proposal, { replace = false, issues = [], alive = null, keepRunning = false } = {}) {
  // #238: archived issues are left out of a proposal; the rest of it is kept
  const archived = new Set((issues || []).filter(isArchived).map((i) => i.number));
  const refNumber = (i) => Number(typeof i === 'object' ? i?.number : i);
  const stages = (Array.isArray(proposal) ? proposal : proposal?.stages || []).map((s) => ({
    ...s,
    items: (s?.items || []).map((x) => {
      const refs = Array.isArray(x?.issues) && x.issues.length ? x.issues : x?.number ? [x] : [];
      return { ...x, number: undefined, issues: refs.filter((i) => !archived.has(refNumber(i))) };
    }).filter((x) => x.issues.length),
  }));
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
    // #435: the refactor stage waiting for the owner's OK stays last
    const last = r.stages[r.stages.length - 1];
    const at = last && last.disabled && last.waiting && !added.some((s) => s.waiting) ? r.stages.length - 1 : r.stages.length;
    const next = [...r.stages.slice(0, at), ...added, ...r.stages.slice(at)];
    // #654: the state is kept (a running roadmap goes on); a done one waits for Start again
    return { ...r, state: r.state === 'done' && !keepRunning ? 'planned' : r.state, stages: next };
  });
  return { roadmap, dropped };
}

/** Takes issues out of the items not finished and not running (they were assigned elsewhere); empty items and stages go. */
function dropIssues(dir, projectId, numbers, { alive = null } = {}) {
  const out = new Set((numbers || []).map(Number));
  if (!fs.existsSync(roadmapFile(dir, projectId))) return readRoadmap(dir, projectId);
  return updateRoadmap(dir, projectId, (r) => ({
    ...r,
    // #738: the children of a dropped item lose their dependency (forgetGoneParents)
    stages: forgetGoneParents(r.stages.map((s) => ({
      ...s,
      items: s.items.flatMap((x) => {
        if (isFinished(x) || runIsAlive(x, alive)) return [x];
        const left = itemIssues(x).filter((i) => !out.has(i.number));
        if (left.length === itemIssues(x).length) return [x];
        const { issues: _old, ...rest } = x;
        return left.length ? [{ ...rest, ...left[0], issues: left }] : [];
      }),
    })).filter((s) => isRelease(s) || s.items.length), allItems(r).map((x) => x.id)),
  }));
}

/** Moves the plain queue's items into a new planned stage at the end (the queue loses them). */
function fromQueue(queueItems, name = 'From the queue') {
  return {
    name,
    note: 'Moved from the assignment queue.',
    items: queueItems.map((q) => ({ workflow: q.workflow, workflowName: q.workflowName, inputs: q.inputs, mock: q.mock, then: q.then, agentOverrides: q.agentOverrides, issues: itemIssues(q) })),
  };
}

/**
 * #446: the plain queue is retired. The queues an older version left with items (`fromIndex`: the
 * index's rows per project, store.leftoverQueues; else the backlog/<id>.queue.json file) become one
 * planned stage at the end of each project's roadmap, once (fromQueue's rule), without their pause;
 * then their files go and `onMoved` drops their rows, so nothing reads them again (a failed move
 * keeps both for the next start). Returns the moved ids.
 * @param {string} dir the backlog folder
 * @param {{ fromIndex?: Record<string, object[]>, issuesOf?: (projectId: string) => any[], onMoved?: (projectId: string) => void }} [options]
 */
function moveLeftoverQueues(dir, { fromIndex = {}, issuesOf = () => [], onMoved = () => {} } = {}) {
  const SUFFIX = '.queue.json';
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(SUFFIX)).map((f) => f.slice(0, -SUFFIX.length)); } catch { /* no backlog folder yet */ }
  const moved = [];
  for (const projectId of new Set([...Object.keys(fromIndex || {}), ...files])) {
    const file = path.join(dir, `${projectId}${SUFFIX}`);
    try {
      let items = fromIndex?.[projectId];
      if (!items) { try { items = JSON.parse(fs.readFileSync(file, 'utf8')).items; } catch { items = []; } }
      items = (Array.isArray(items) ? items : []).filter((q) => q?.workflow && itemIssues(q).length);
      if (items.length) {
        propose(dir, projectId, [fromQueue(items)], { issues: issuesOf(projectId) });
        moved.push(projectId);
      }
      for (const f of [file, `${file}.bak`]) fs.rmSync(f, { force: true });
      onMoved(projectId);
    } catch (e) { console.error(`backlog queue move (${projectId}):`, e.message); }
  }
  return moved;
}

// Owner actions on the roadmap: start (running; `simulated` starts every item as a simulation),
// pause (nothing new starts, runs in progress go on), stop (back to a plan). `stage` (a stage id, with
// running): run only that stage (#141); a start without it runs the whole roadmap, a pause keeps the scope.
// Stop also turns a live roadmap off (#164): a plan never refills itself.
/**
 * @param {string} dir
 * @param {string} projectId
 * @param {string} state
 * @param {{ simulated?: boolean, stage?: string | null }} [options]
 */
function setState(dir, projectId, state, { simulated, stage = null } = {}) {
  if (!STATES.includes(state)) throw new Error(`Unknown roadmap state: ${state}`);
  return updateRoadmap(dir, projectId, (r) => {
    if (state === 'running' && !r.stages.length) throw new Error('The roadmap has no stage: add items first.');
    let scope = state === 'paused' ? r.scope || null : null;
    const s = state === 'running' && stage ? r.stages.find((x) => x.id === stage) : null;
    const over = !s || !s.items.some((x) => !isFinished(x));
    // #237: a Resume of a scope whose stage is over (or gone) drops it and runs the whole roadmap
    if (state === 'running' && stage && !(over && r.scope?.stage === stage)) {
      if (!s) throw new Error('This stage is no longer in the roadmap.');
      if (s.disabled) throw new Error('This stage is disabled: enable it to run it.');
      if (over) throw new Error('Every item of this stage is done or skipped.');
      scope = { stage: s.id };
    }
    return {
      ...r, state, scope, error: null, pausedBy: null, budget: null, ...(r.pausedStage ? { pausedStage: null, pausedAt: null } : {}), ...(r.releaseHold ? { releaseHold: null } : {}), ...(simulated !== undefined ? { simulated: !!simulated } : {}), ...(state === 'planned' && r.live ? { live: false } : {}),
    };
  });
}

// The Live roadmap switch (#164): on only while the roadmap runs (Start first), with when and who;
// off any time (the current stages finish, nothing more is added).
function setLive(dir, projectId, on, { by = 'owner', now = new Date() } = {}) {
  return updateRoadmap(dir, projectId, (r) => {
    if (!on) return r.live ? { ...r, live: false } : null;
    if (r.state !== 'running') throw new Error('Start the roadmap first: only a running roadmap can go live.');
    return r.live ? null : { ...r, live: true, liveSince: now.toISOString(), liveBy: String(by || 'owner'), liveRefill: null };
  });
}

// Owner actions on an item: retry (planned again, its runs kept in `runs`), skip (counts as finished).
// On the item that paused the roadmap, the roadmap goes on (the owner decided what to do with it).
// `alive(runId)`: whether a process (this one or another app) still runs it (#112): a retry then
// would start the same work twice, so it is refused (and a skip: stop the run first).
// park (#395, "Move on"): the item's run waits at a human gate (`runOf(runId).waiting`, as advance's
// env, with the gate's name in `gate`): the item is parked (finished for its stage) and the run is
// left as it is, still waiting at the same gate for the owner.
function itemAction(dir, projectId, itemId, action, { alive = null, runOf = null, now = new Date() } = {}) {
  if (!['park', 'retry', 'skip'].includes(action)) throw new Error(`Unknown roadmap item action: ${action}`);
  return updateRoadmap(dir, projectId, (r) => {
    const item = findItem(r, itemId);
    if (!item) throw new Error('This roadmap item no longer exists.');
    if (action === 'park') return parkItems(r, new Set([itemId]), gateOf(item, runOf), now);
    if (runIsAlive(item, alive)) {
      throw new Error(action === 'retry' && item.runId ? `Run ${item.runId} is still running.` : 'Its run is in progress: stop the run first.');
    }
    const status = action === 'retry' ? 'planned' : 'skipped';
    const unblocked = r.pausedBy === itemId;
    return {
      ...r, ...(unblocked ? { pausedBy: null, error: null, state: r.state === 'paused' ? 'running' : r.state } : {}),
      // a retried item runs again from its stage: it is no longer parked (#395)
      stages: r.stages.map((s) => ({ ...s, items: s.items.map((x) => (x.id === itemId ? { ...(action === 'retry' ? unparked(x) : x), status, runId: action === 'retry' ? null : x.runId, error: action === 'skip' ? 'Skipped by the owner.' : null } : x)) })),
    };
  });
}

const unparked = ({ parked: _p, ...x }) => x;

// #395: the gate an item's run waits at ({ gate }: its name, or null), or an error saying why it cannot move on
function gateOf(item, runOf) {
  if (item.status === 'parked') throw new Error('This item is already parked: its run waits at its gate for you.');
  const run = !isFinished(item) && item.runId && runOf ? runOf(item.runId) : null;
  if (!run?.waiting) throw new Error('Only an item whose run waits at a human gate can move on: this one is not at a gate.');
  return { gate: run.gate || null };
}

// #395: the items `ids` parked (their gates named in `gates`: id → { gate }, or one { gate } for a
// single item) and the items `skip` skipped; a roadmap paused by one of them goes on.
function parkItems(r, ids, gates, now, skip = new Set()) {
  const unblocked = ids.has(r.pausedBy) || skip.has(r.pausedBy);
  const gateFor = (id) => (gates instanceof Map ? gates.get(id) : gates)?.gate || null;
  return {
    ...r, ...(unblocked ? { pausedBy: null, error: null, state: r.state === 'paused' ? 'running' : r.state } : {}),
    stages: r.stages.map((s) => ({
      ...s,
      items: s.items.map((x) => (ids.has(x.id) ? { ...x, status: 'parked', error: null, parked: { at: now.toISOString(), gate: gateFor(x.id) } }
        : skip.has(x.id) ? { ...x, status: 'skipped', error: 'Skipped: the owner moved on from the stage.' } : x)),
    })),
  };
}

/**
 * #395: a stage's "Move on from this stage": its items whose run waits at a human gate are parked, its
 * planned items not started are skipped, so the next stage starts. Refused (nothing written) while an
 * item of the stage runs an agent turn or a command: the reason points to "Pause after current step".
 * `runOf` as advance's env (`waiting` at a gate, `gate` its name). Nothing answers, stops or closes a gate.
 */
function parkStage(dir, projectId, stageId, { runOf, now = new Date() }) {
  return updateRoadmap(dir, projectId, (r) => {
    const run = (x) => (x.runId && !isFinished(x) ? runOf(x.runId) : null);
    // the items as the screen sees them: an interrupted run still at its gate is `run.atGate`
    const view = withStatus(r, runOf);
    const seen = { ...view, stages: view.stages.map((s) => ({ ...s, items: s.items.map((x) => ({ ...x, run: { atGate: !!run(findItem(r, x.id))?.waiting } })) })) };
    const stage = seen.stages.find((s) => s.id === stageId);
    if (!stage) throw new Error('This stage is no longer in the roadmap.');
    const may = allowedActions(seen, stage).parkStage;
    if (!may.allowed) throw new Error(may.reason);
    const gates = new Map(stage.items.filter(atGate).map((x) => [x.id, { gate: run(findItem(r, x.id))?.gate || null }]));
    const skip = new Set(stage.items.filter((x) => x.status === 'planned' && !x.runId).map((x) => x.id));
    return parkItems(r, new Set(gates.keys()), gates, now, skip);
  });
}

// The run of an item that failed was resumed from a step (#100): the new run takes its place, and a
// roadmap that this failure paused goes on (the owner acted on it). Also when the run resumed is
// one of the item's earlier runs (`runs`, #112: an original resumed after its duplicate was cancelled).
function adoptResumed(dir, projectId, oldRunId, newRunId) {
  if (!fs.existsSync(roadmapFile(dir, projectId))) return null;
  const r = readRoadmap(dir, projectId);
  const item = allItems(r).find((x) => x.runId === oldRunId) || allItems(r).find((x) => (x.runs || []).includes(oldRunId));
  // #260: a cut line's release run resumed (from its Ship gate after a Hold): the new run is the line's,
  // and a roadmap paused at that line waits for it again
  const line = item ? null : r.stages.find((s) => isRelease(s) && s.runId === oldRunId);
  if (line) return takeRelease(dir, projectId, line.id, newRunId);
  if (!item) return null;
  return updateRoadmap(dir, projectId, (cur) => ({
    ...cur, ...(cur.pausedBy === item.id ? { state: 'running', pausedBy: null, error: null } : {}),
    // a parked item (#395) stays parked: its resumed run waits at its gate again, the roadmap moved on
    stages: cur.stages.map((s) => ({ ...s, items: s.items.map((x) => (x.id === item.id ? { ...x, status: x.status === 'parked' ? 'parked' : 'planned', runId: newRunId, runs: [...(x.runs || []), newRunId], error: null } : x)) })),
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

// #555: the release entry `id` patched with `patch` (its run's fields), the others as they are
const patchRelease = (r, id, patch) => r.stages.map((s) => (isRelease(s) && s.id === id ? { ...s, ...patch } : s));
const hasRelease = (dir, projectId, id) => isRelease(findStage(readRoadmap(dir, projectId), id));

/** Records what the release run did on a release entry (#260, #555: its id): `patch` = { status, runId, ... }; null when the entry is gone. */
function setRelease(dir, projectId, releaseId, patch) {
  if (!hasRelease(dir, projectId, releaseId)) return null;
  return updateRoadmap(dir, projectId, (r) => ({ ...r, stages: patchRelease(r, releaseId, patch) }));
}

/**
 * A release entry's run started (#260: by the roadmap, by the owner on the Releases screen, or a
 * resumed one): it is the entry's run, and a roadmap that the entry's last release run paused
 * (`releaseHold`) waits for it again. Null when the entry is gone.
 */
function takeRelease(dir, projectId, releaseId, runId) {
  if (!hasRelease(dir, projectId, releaseId)) return null;
  return updateRoadmap(dir, projectId, (r) => ({
    ...r, ...(r.releaseHold ? { releaseHold: null } : {}), ...(r.releaseHold === releaseId && r.state === 'paused' ? { state: 'running', error: null } : {}),
    stages: patchRelease(r, releaseId, { status: 'running', runId }),
  }));
}

/**
 * A release entry's run ended without shipping (#260; `status`: held | failed): the entry says so
 * and a running roadmap pauses at it (`releaseHold`: its id, so only this pause is undone when a
 * release run takes the entry again). Start / Resume clears it: the release is then checked again.
 * @returns {object|null} the roadmap, or null when the entry is gone
 */
function holdRelease(dir, projectId, releaseId, status, message) {
  if (!hasRelease(dir, projectId, releaseId)) return null;
  return updateRoadmap(dir, projectId, (r) => ({
    ...r, ...(r.state === 'running' ? { state: 'paused', pausedBy: null, error: message, releaseHold: releaseId } : {}),
    stages: patchRelease(r, releaseId, { status }),
  }));
}

/** The roadmap paused with `message`, no item to blame (pure; a refill that failed, packages/engine/domains/roadmap/live-roadmap.js). */
const pauseRoadmap = (r, message) => ({ ...r, state: 'paused', pausedBy: null, error: message });

/**
 * #368: the stage's "Pause after current step" (#391's name): the roadmap pauses at that stage (`pausedStage`,
 * `pausedAt`), no item to blame and no failure named; the service pauses the stage's runs after
 * their current turn. Start / Resume (setState) clears it.
 */
function pauseStage(dir, projectId, stageId, { now = new Date() } = {}) {
  return updateRoadmap(dir, projectId, (r) => {
    const at = r.stages.findIndex((s) => s.id === stageId);
    if (at < 0) throw new Error('This stage is no longer in the roadmap.');
    const message = `${stageName(r, at)} paused after the current step: Resume continues its runs where they stopped, then starts the next items.`;
    return { ...pauseRoadmap(r, message), pausedStage: stageId, pausedAt: now.toISOString() };
  });
}

/**
 * #391: the roadmap bar's "Pause after this stage": a running roadmap keeps running its current stage
 * (every item still starts) and pauses with "Stage N done" when it is over, as #141's scope does
 * (`scope: { stage, pauseAfter: true }`, so the screen tells it from "Run this stage"). A stage run on
 * its own already stops after it; a roadmap held by a cut line's release, or with no stage left,
 * pauses now. `cancelPause` takes it back: the whole roadmap runs again.
 */
function pauseAfterStage(dir, projectId) {
  return updateRoadmap(dir, projectId, (r) => {
    if (r.state !== 'running') throw new Error('The roadmap is not running.');
    if (r.scope) return null;
    const at = currentStage(r);
    if (at < 0 || pendingRelease(r, at)) return pauseRoadmap(r, null);
    return { ...r, scope: { stage: r.stages[at].id, pauseAfter: true } };
  });
}
function cancelPause(dir, projectId) {
  return updateRoadmap(dir, projectId, (r) => (r.scope?.pauseAfter ? { ...r, scope: null } : null));
}

/** #368: the pause line of the stage a roadmap paused at ({ state: 'paused', at, runs }: its paused items), else null (pure). */
function stagePauseLine(r, stage) {
  if (r.state !== 'paused' || r.pausedStage !== stage.id) return null;
  return { state: 'paused', at: r.pausedAt || null, runs: stage.items.filter((x) => x.status === 'paused').length };
}
/** The roadmap ended: done, the scope and the pause cleared (pure). */
const finishRoadmap = (r) => ({ ...r, state: 'done', error: null, pausedBy: null, scope: null });

const refs = (item) => itemIssues(item).map((i) => `#${i.number}`).join(', ');
const stageName = (r, at) => r.stages[at].name || `Stage ${stageNumber(r, at)}`;

// One stage's step: its items whose issues are all closed are skipped, a failure pauses the roadmap,
// else the items to start; null when every item is finished.
function stageStep(r, at, { closed, canStart, now }) {
  const stage = r.stages[at];
  for (const item of stage.items) {
    if (item.status === 'planned' && !testsLater(item) && itemIssues(item).every((i) => closed(i.number, item))) {
      Object.assign(item, { status: 'skipped', error: 'Every issue is closed.' });
    }
  }
  // a parked item that failed later (#395) never pauses the roadmap: it counts as finished
  const failed = stage.items.find((x) => x.status === 'failed' && !isFinished(x));
  if (failed) {
    return {
      roadmap: { ...r, state: 'paused', pausedBy: failed.id, error: `${stageName(r, at)}: ${refs(failed)} failed. Resume its run, retry or skip the item, or stop the roadmap. ${failed.error || ''}`.trim() },
      start: [],
    };
  }
  if (stage.items.every((x) => isFinished(x))) return null;
  // #368: what is left of the stage is runs the owner paused: the roadmap waits at it, paused, for Resume
  if (!stage.items.some((x) => ['planned', 'running'].includes(x.status))) {
    return { roadmap: { ...pauseRoadmap(r, `${stageName(r, at)}: its runs are paused. Resume continues them where they stopped.`), pausedStage: stage.id, pausedAt: r.pausedAt || now().toISOString() }, start: [] };
  }
  return { roadmap: r, start: stage.items.filter((x) => x.status === 'planned' && canStart(x)) };
}

/**
 * One sequencing step (pure): derives the items' statuses from their runs (`withStatus`), pauses on
 * a failure, moves to the next stage when every item is done or skipped, and lists the items to start.
 * A roadmap running one stage (`scope`, #141) only works on that stage, and pauses when it is over.
 * @param {object} roadmap
 * @param {{ runOf: (runId) => ({ status, waiting?, merged? } | null), closed?: (number, item) => boolean, canStart?: (item) => boolean, now?: () => Date }} env
 * (now: the clock of a stage pause's `pausedAt`, #368)
 * A live roadmap (#164) whose last stage ends stays running and asks for a refill (`refill: true`):
 * the caller adds the next stages, or ends it (packages/engine/domains/roadmap/live-roadmap.js applyRefill).
 * A release entry (#260, #555) the roadmap reached and that has not shipped holds everything after it:
 * nothing starts and the caller is asked for the release run (`release: { id, name }`).
 * @returns {{ roadmap: object, start: object[], refill?: true, release?: { id: string, name: string } }} the items to start (still `planned`: the caller marks them)
 */
function advance(roadmap, { runOf, closed = () => false, canStart = () => true, now = () => new Date() }) {
  // Statuses follow the runs whatever the roadmap state (#112): `runOf` reports a run another live
  // process owns as running, so an item is never failed while its run is alive; and a roadmap paused
  // by an item whose run is alive again (resumed, or judged by another app process) goes on.
  let r = withStatus(roadmap, runOf);
  const blocker = r.pausedBy && findItem(r, r.pausedBy);
  if (blocker?.status === 'running') r = { ...r, pausedBy: null, error: null, state: r.state === 'paused' ? 'running' : r.state };
  const finished = finishRoadmap(r);
  const scopeOver = (at) => {
    // #391: a pause after the last stage still pauses when a refill (#164) or a release (#260) would come next
    const more = r.scope?.pauseAfter && (r.live || pendingRelease(r, -1));
    if (currentStage(r) < 0 && !more) return { roadmap: finished, start: [] };
    // #391: a pause after the stage names it by its number, as the bar's "Pausing after stage N" did
    const name = r.scope?.pauseAfter ? `Stage ${stageNumber(r, at)} done${r.stages[at].name ? ` (${r.stages[at].name})` : ''}` : `${stageName(r, at)} done`;
    return { roadmap: { ...r, state: 'paused', pausedBy: null, scope: null, error: `${name}. The other stages are still planned: Start runs the roadmap from its first unfinished stage.` }, start: [] };
  };
  // #237: a scope whose stage ended while the roadmap was paused goes as it does while running
  if (r.state === 'paused' && r.scope && !r.pausedBy) {
    const at = r.stages.findIndex((s) => s.id === r.scope.stage);
    if (at < 0) return { roadmap: { ...r, scope: null }, start: [] };
    if (r.stages[at].items.every((x) => isFinished(x))) return scopeOver(at);
  }
  // only starting new items (and pausing on a failure) waits for a running roadmap
  if (r.state !== 'running') return { roadmap: r, start: [] };
  if (r.scope) {
    const at = r.stages.findIndex((s) => s.id === r.scope.stage);
    if (at < 0) return { roadmap: { ...r, state: 'paused', pausedBy: null, scope: null, error: 'The stage run on its own is no longer in the roadmap: press Start to run the roadmap.' }, start: [] };
    // #284: disabled meanwhile (a file edited outside the app): nothing of it starts
    if (r.stages[at].disabled) return { roadmap: { ...r, state: 'paused', pausedBy: null, scope: null, error: 'The stage run on its own is disabled: enable it, or press Start to run the roadmap.' }, start: [] };
    const step = stageStep(r, at, { closed, canStart, now });
    if (step) return step;
    return scopeOver(at);
  }
  for (;;) {
    const at = currentStage(r);
    const line = pendingRelease(r, at);
    if (line) return { roadmap: r, start: [], release: { id: line.id, name: line.name } };
    if (at < 0) return r.live ? { roadmap: r, start: [], refill: true } : { roadmap: finished, start: [] };
    const step = stageStep(r, at, { closed, canStart, now });
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

// #206: the budget cap pauses a running roadmap before its next start (`budget`: { period, spentUsd,
// limitUsd, nextUsd, stageUsd }, the message in `error`); the runs in progress go on.
function budgetPause(dir, projectId, budget, message) {
  return updateRoadmap(dir, projectId, (r) => (r.state !== 'running' ? null : { ...pauseRoadmap(r, message), budget }));
}

// "Resume anyway" (#206): the roadmap runs again and ignores the cap for the period `key` (packages/engine/domains/usage/budget.js waiverKey).
function waiveBudget(dir, projectId, key) {
  return updateRoadmap(dir, projectId, (r) => {
    if (!r.stages.length) throw new Error('The roadmap has no stage: add items first.');
    return { ...r, state: 'running', error: null, pausedBy: null, budget: null, budgetWaived: String(key) };
  });
}

// An item whose issues were all found closed right before its start (#168: read again from the platform).
function skipClosed(dir, projectId, itemId) {
  return skipItem(dir, projectId, itemId, 'Every issue is closed.');
}

// An item skipped at its start, `why` kept as its error (#527: a base-health fix item whose issue a live run has).
function skipItem(dir, projectId, itemId, why) {
  return updateRoadmap(dir, projectId, (r) => ({
    ...r, stages: r.stages.map((s) => ({ ...s, items: s.items.map((x) => (x.id === itemId ? { ...x, status: 'skipped', error: String(why || '') || null } : x)) })),
  }));
}

/** Each planned issue's place in the roadmap (the Backlog's cards): number → { stage, status, itemId }; a test-batch item never hides the item that implements the issue. */
function issueStages(roadmap) {
  const out = new Map();
  (roadmap.stages || []).forEach((s, n) => {
    for (const x of s.items) for (const i of itemIssues(x)) if (!testsLater(x) || !out.has(i.number)) out.set(i.number, { stage: stageNumber(roadmap, n), name: s.name || `Stage ${stageNumber(roadmap, n)}`, status: x.status, itemId: x.id, origin: x.origin || null, ...(s.disabled ? { disabled: true } : {}), ...(s.disabled && s.waiting ? { waiting: true } : {}) });
  });
  return out;
}

module.exports = {
  adoptResumed,
  advance,
  budgetPause,
  cancelPause,
  cleanStages,
  clearRoadmap,
  currentStage,
  dependencyBase,
  dropIssues,
  findItem,
  findStage,
  finishRoadmap,
  fromQueue,
  holdRelease,
  insertFrontStage,
  issueStages,
  itemAction,
  markStarted,
  mergedPullRequest,
  moveLeftoverQueues,
  normalizeItem,
  parkStage,
  pauseAfterStage,
  pauseRoadmap,
  pauseStage,
  persisted,
  propose,
  readRoadmap,
  readRoadmapAt,
  refreshCopies,
  restoreStages,
  roadmapProjects,
  saveStages,
  setLive,
  setRelease,
  setState,
  skipClosed,
  skipItem,
  stagePauseLine,
  takeRelease,
  testsLater,
  updateRoadmap,
  waiveBudget,
  withStatus,
  writeRoadmap,
};
