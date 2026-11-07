// #807 Stack on a waiting stage: when a roadmap item's run waits for its PR's merge, the owner may stack the
// next stage on it (roadmap.js itemAction 'stack'): each planned item of the next stage records `stacksOn`
// (the waiting item's id), starts from that item's branch (stackBase → inputs.parent_branch / parent_pr,
// service/areas/roadmap.js) and opens its PR against it. The waiting stage then no longer holds the next one
// (stackedStage, read by advance). Refused, with the model's reason (RoadmapModel.allowedActions stack): an
// item that does not wait for a merge, Fork + PR mode (#738 keeps its wait and rebase), a stack of
// MAX_STACK_DEPTH PRs. roadmap.js re-exports stackBase.
const { allowedActions, isFinished, isRelease } = require('@multiagent/shared/roadmap-model');
const { withStatus } = require('./roadmap-status');

/** @typedef {import('@multiagent/shared/types').Roadmap} Roadmap */

/**
 * The stack field of a cleaned item: the raw one, else the stored one; '' removes it.
 * @param {any} raw
 * @param {any} old
 * @returns {{ stacksOn?: string }}
 */
function stacksOnField(raw, old) {
  const stacksOn = String(raw.stacksOn ?? old?.stacksOn ?? '').trim();
  return stacksOn ? { stacksOn } : {};
}

// the index of the stage after `at` (a release entry between them: none, -1)
function nextStage(stages, at) {
  const next = at + 1;
  return next < stages.length && !isRelease(stages[next]) ? next : -1;
}

/**
 * The roadmap with the next stage's planned items stacked on `itemId` (its run waits for its PR's merge,
 * `runOf` as advance's env); throws the model's reason when Stack is refused.
 * @param {Roadmap} r the stored roadmap
 * @param {string} itemId
 * @param {((runId: string) => any) | null} runOf
 */
function stackOn(r, itemId, runOf) {
  const derived = runOf ? withStatus(r, runOf) : r;
  const at = derived.stages.findIndex((s) => !isRelease(s) && s.items.some((x) => x.id === itemId));
  const stage = derived.stages[at];
  const verdict = allowedActions(derived, stage, stage.items.find((x) => x.id === itemId)).stack;
  if (!verdict.allowed) throw new Error(verdict.reason);
  const next = nextStage(derived.stages, at);
  const ids = new Set(next < 0 ? [] : derived.stages[next].items.filter((x) => x.status === 'planned' && !x.runId).map((x) => x.id));
  if (!ids.size) throw new Error('The next stage has no planned item to stack on this one.');
  return { ...r, stages: r.stages.map((s, n) => (n !== next ? s : { ...s, items: s.items.map((x) => (ids.has(x.id) ? { ...x, stacksOn: itemId } : x)) })) };
}

/**
 * advance (pure, statuses derived): the next stage's index when what is left of stage `at` only waits for
 * merges and the next stage stacks on one of them, so that stage goes on; else -1.
 * @param {Roadmap} r
 * @param {number} at
 */
function stackedStage(r, at) {
  const left = r.stages[at].items.filter((x) => !isFinished(x));
  if (!left.length || left.some((x) => x.status !== 'waiting_merge')) return -1;
  const next = nextStage(r.stages, at);
  const waiting = new Set(left.map((x) => x.id));
  return next >= 0 && r.stages[next].items.some((x) => waiting.has(x.stacksOn)) ? next : -1;
}

/**
 * The base of a stacked item's run: its parent's branch and PR, and whether the parent merged (then the
 * item starts from the project's base as usual). null for an item stacked on nothing.
 * @param {Roadmap} roadmap
 * @param {string} itemId
 * @param {{ runOf: (runId: string) => any }} options runOf(runId) → { branch, merged, prNumber, prUrl } | null (the service's parentRun)
 */
function stackBase(roadmap, itemId, { runOf }) {
  const items = roadmap.stages.flatMap((s) => s.items || []);
  const item = items.find((x) => x.id === itemId);
  if (!item?.stacksOn) return null;
  const parent = items.find((x) => x.id === item.stacksOn);
  const run = parent?.runId ? runOf(parent.runId) : null;
  return { parentId: item.stacksOn, branch: run?.branch || null, prNumber: run?.prNumber || null, prUrl: run?.prUrl || null, parentMerged: !!run?.merged };
}

module.exports = {
  stackBase,
  stackOn,
  stackedStage,
  stacksOnField,
};
