// The Refactor tab's cadence (#357): "Add a refactor to the roadmap every X runs", off by default,
// X from 3 to 50. Pure: which runs count (the project's real finished runs, never a simulated or
// unfinished one), how many runs until the next refactor, which proposal is picked (the top ranked
// one with an issue and no unfinished roadmap item) and the roadmap stage it goes to (the Product
// Owner's placement rules: the earliest stage after every stage holding an item that shares a file
// with it, or that touches a file the conflict map records merge conflicts on as it does). #435: Send
// to Refactor and Add to roadmap now plan in the waiting stage (placeWaiting: a disabled stage at the
// end, an item that already changes the same file joined), "run it now" after the stage in progress
// (placeRunNow); the cadence keeps placeRefactor. The service
// (packages/engine/fronts/analyser/channels/refactor.js) stores the cadence and adds the item through packages/engine/domains/roadmap/roadmap.js.

'use strict';

const I18n = require('@craftorio/shared/i18n');
const RoadmapModel = require('@craftorio/shared/roadmap-model');

const CADENCE_MIN = 3;
const CADENCE_MAX = 50;
const DEFAULT_CADENCE = Object.freeze({ on: false, every: 10 });
const UNFINISHED_RUN = new Set(['running', 'interrupted']);

/** The project's real (not simulated) finished runs, finished after `since` when given. */
function countedRuns(runs, project, since = null) {
  const from = since ? Date.parse(since) : -Infinity;
  return (runs || []).filter((r) => r && !r.mock && r.finishedAt && !UNFINISHED_RUN.has(r.status)
    && r.projectId === project?.id && Date.parse(r.finishedAt) > from).length;
}

/** The runs still to finish before the next refactor joins the roadmap (0 when due). */
const runsUntilNext = ({ runs, project, every, since = null }) => Math.max(0, every - countedRuns(runs, project, since));

/** A valid cadence { on, every }; throws when every is not a whole number from 3 to 50. */
function cleanCadence({ on, every } = {}) {
  if (!Number.isInteger(every) || every < CADENCE_MIN || every > CADENCE_MAX) {
    throw new Error(`A refactor every ${every} runs is out of range: pick a whole number from ${CADENCE_MIN} to ${CADENCE_MAX}.`);
  }
  return { on: !!on, every };
}

/** The issue numbers of the roadmap's items not finished yet (roadmap-model isFinished). */
const unfinishedNumbers = (roadmap) => new Set((roadmap?.stages || []).flatMap((s) => s.items || [])
  .filter((x) => !RoadmapModel.isFinished(x)).flatMap((x) => RoadmapModel.itemIssues(x).map((i) => Number(i.number))));

/** The top ranked open proposal with an issue and no unfinished roadmap item, or null (nothing ready). */
function pickNext(proposals, roadmap) {
  const busy = unfinishedNumbers(roadmap);
  const ready = (proposals || []).filter((p) => p && p.status !== 'dismissed' && Number.isInteger(p.rank) && p.issue && !busy.has(Number(p.issue)));
  return ready.sort((a, b) => a.rank - b.rank)[0] || null;
}

// a file path, from a string or a finding's { path }
const pathOf = (f) => (typeof f === 'string' ? f : f?.path || f?.file || '');

/** A proposal's files: its files' paths, then its target, without repeats. */
const filesOf = (p) => [...new Set([...(p?.files || []).map(pathOf), ...(p?.target ? [p.target] : [])].filter(Boolean))];

// the files the conflict map records merge conflicts on (packages/engine/domains/project/conflict-map.js files[].conflicts)
const conflictFiles = (conflictMap) => new Set((conflictMap?.files || []).filter((f) => f.conflicts > 0).map((f) => f.file));

// whether an item touches what the refactor touches: a shared file, or both touch conflicting files
function clashes(item, files, hubs) {
  const own = (item.files || []).map(pathOf);
  if (own.some((f) => files.has(f))) return true;
  return hubs.size > 0 && own.some((f) => hubs.has(f)) && [...files].some((f) => hubs.has(f));
}

// an entry no item goes to: a disabled stage (#284) or a release entry (#555, it keeps no items)
const notForItems = (s) => !!s.disabled || RoadmapModel.isRelease(s);

/**
 * The 0-based stage the refactor goes to (stages.length: a new stage at the end): after the last stage
 * it clashes with, never in a stage already finished, a disabled one (#284) nor a release entry (#555).
 */
function placeRefactor({ roadmap, files, conflictMap = null }) {
  const mine = new Set((files || []).map(pathOf).filter(Boolean));
  const hubs = conflictFiles(conflictMap);
  const stages = roadmap?.stages || [];
  let last = -1;
  stages.forEach((s, n) => { if ((s.items || []).some((x) => clashes(x, mine, hubs))) last = n; });
  const open = stages.findIndex((s) => (s.items || []).some((x) => !RoadmapModel.isFinished(x)));
  let stage = Math.max(last + 1, open < 0 ? stages.length : open);
  while (stage < stages.length && notForItems(stages[stage])) stage++;
  return { stage };
}

/** #435 "run it now": placeRefactor's stage, never before nor inside the stage in progress. */
function placeRunNow({ roadmap, files, conflictMap = null }) {
  const stages = roadmap?.stages || [];
  const now = RoadmapModel.currentStage(roadmap || { stages: [] });
  let { stage } = placeRefactor({ roadmap, files, conflictMap });
  if (now >= 0) stage = Math.max(stage, now + 1);
  while (stage < stages.length && notForItems(stages[stage])) stage++;
  return { stage };
}

// #435: the stage Send to Refactor plans in, disabled until the owner enables it; its name's suffix
// (packages/engine/domains/roadmap/roadmap.js drops it once the stage is enabled)
const WAITING_SUFFIX = '(waiting for your OK)';
const WAITING_STAGE_NAME = `Refactor ${WAITING_SUFFIX}`;
// #36: the stage is named in the interface language when it is created (refactor_cadence.waiting_suffix); every
// language's suffix, and the English one of a stage created before, is recognized and dropped whatever the language now
const SUFFIX_KEY = 'refactor_cadence.waiting_suffix';
const waitingStageName = () => `Refactor ${I18n.t(SUFFIX_KEY)}`;
const waitingSuffixes = () => [...new Set([WAITING_SUFFIX, ...I18n.languages().map((l) => I18n.t(SUFFIX_KEY, {}, l))])].map((s) => s.toLowerCase());

/** Whether stage `s` (or an issueStages entry) is the refactor stage waiting for the owner: disabled, marked or named so. */
const isWaitingStage = (s) => !!s?.disabled && (!!s.waiting || waitingSuffixes().some((x) => String(s.name || '').toLowerCase().includes(x)));

/** Stage name `name` without the waiting stage's suffix (an enabled stage no longer waits), in any language. */
function dropWaitingSuffix(name) {
  const text = String(name || '');
  const suffix = waitingSuffixes().find((x) => text.toLowerCase().endsWith(x));
  return suffix ? text.slice(0, -suffix.length).trimEnd() : text;
}

/**
 * #435 where Send to Refactor plans: the last waiting stage, wherever it is ({ stage }, else
 * stages.length: a new one at the end) and, in it, the unfinished item that already changes one of
 * `files` (`item`, -1 for none: a new item). The items carry their `files` (refactor-priority withFiles).
 */
function placeWaiting({ roadmap, files }) {
  const stages = roadmap?.stages || [];
  const at = stages.findLastIndex(isWaitingStage);
  if (at < 0) return { stage: stages.length, item: -1 };
  const mine = new Set((files || []).map(pathOf).filter(Boolean));
  const item = (stages[at].items || []).findIndex((x) => !RoadmapModel.isFinished(x) && (x.files || []).map(pathOf).some((f) => mine.has(f)));
  return { stage: at, item };
}

/**
 * The proposals as the tab lists them: each with its issue's state on the platform (`issueState`,
 * from the synced backlog's `issues`) and its roadmap item's (`roadmapStatus`, `roadmapStage`, from
 * packages/engine/domains/roadmap/roadmap.js issueStages: number → { stage, status }), whether that stage waits for the owner's OK
 * (`roadmapWaiting`, #435), whether that item is unfinished (`roadmapUnfinished`, from
 * unfinishedNumbers) and its files (`targetFiles`, filesOf).
 */
function withIssueStatus(proposals, stages, issues = [], unfinished = new Set()) {
  const byNumber = new Map((issues || []).map((i) => [Number(i.number), i]));
  return (proposals || []).map((p) => {
    const n = Number(p.issue) || null;
    const placed = n ? stages.get(n) : null;
    return {
      ...p, issueState: n ? byNumber.get(n)?.state || null : null, roadmapStatus: placed?.status || null, roadmapStage: placed?.stage || null,
      roadmapWaiting: isWaitingStage(placed), roadmapUnfinished: !!n && unfinished.has(n), targetFiles: filesOf(p),
    };
  });
}

module.exports = {
  CADENCE_MAX,
  CADENCE_MIN,
  cleanCadence,
  countedRuns,
  DEFAULT_CADENCE,
  dropWaitingSuffix,
  filesOf,
  isWaitingStage,
  pathOf,
  pickNext,
  placeRefactor,
  placeRunNow,
  placeWaiting,
  runsUntilNext,
  unfinishedNumbers,
  WAITING_STAGE_NAME,
  WAITING_SUFFIX,
  waitingStageName,
  withIssueStatus,
};
