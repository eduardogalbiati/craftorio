// #738 Split implementations: a roadmap item may depend on an item of an earlier stage (item.dependsOn,
// stored by roadmap.js cleanItem). In a Fork + PR project the dependent item's run starts from its parent's
// branch on the fork, and its pull request waits for the parent to merge upstream (then it is rebased onto
// the synced default branch: worktree.js restackOnBase) or opens at once with "Depends on #<PR>", per the
// project's fork.dependentPr setting. roadmap.js checks the order on every save and re-exports dependencyBase.
const { isRelease } = require('@multiagent/shared/roadmap-model');

/** @typedef {import('@multiagent/shared/types').Roadmap} Roadmap */

/**
 * The dependency field of a cleaned item: the raw one, else the stored one; '' removes it.
 * @param {any} raw
 * @param {any} old
 * @returns {{ dependsOn?: string }}
 */
function dependsOnField(raw, old) {
  return parentField('dependsOn', raw, old);
}

/**
 * A cleaned item's parent field (`dependsOn` #738, `stacksOn` #807): the raw one, else the stored one; '' removes it.
 * @param {'dependsOn' | 'stacksOn'} field
 * @param {any} raw
 * @param {any} old
 * @returns {Record<string, string>}
 */
function parentField(field, raw, old) {
  const id = String(raw[field] ?? old?.[field] ?? '').trim();
  return id ? { [field]: id } : {};
}

/**
 * The parent of an item by its `field` (`dependsOn` #738, `stacksOn` #807) and that parent's run
 * → { parentId, run } (run: runOf(parent.runId), or null), or null for an item without that parent.
 * @param {Roadmap} roadmap
 * @param {string} itemId
 * @param {'dependsOn' | 'stacksOn'} field
 * @param {(runId: string) => any} runOf
 */
function parentOfItem(roadmap, itemId, field, runOf) {
  const items = roadmap.stages.flatMap((s) => s.items || []);
  const item = items.find((x) => x.id === itemId);
  if (!item?.[field]) return null;
  const parent = items.find((x) => x.id === item[field]);
  return { parentId: item[field], run: parent?.runId ? runOf(parent.runId) : null };
}

/**
 * An item depends only on an item of an earlier stage (its branch exists before the item starts):
 * its own id, an item of its stage or a later one, or an unknown id throws.
 * @param {any[]} stages
 */
function assertEarlierDependencies(stages) {
  const stageOf = new Map();
  stages.forEach((s, n) => { if (!isRelease(s)) for (const x of s.items) stageOf.set(x.id, n); });
  for (const [n, s] of stages.entries()) {
    if (isRelease(s)) continue;
    for (const x of s.items) {
      if (!x.dependsOn) continue;
      const at = stageOf.get(x.dependsOn);
      if (at === undefined || at >= n) throw new Error(`The item of #${x.number} depends on ${x.dependsOn}, which is not an item of an earlier stage: an item can only build on an earlier one.`);
    }
  }
}

/**
 * The stages without the dependencies on an item that was there before and is gone (removed, its issues
 * assigned elsewhere): the child then starts from the default branch, and the next save does not throw.
 * An id never stored stays, so a writer naming an unknown item still gets assertEarlierDependencies' error.
 * @param {any[]} stages
 * @param {Iterable<string>} previousIds the ids of the items before the change
 */
function forgetGoneParents(stages, previousIds) {
  const now = new Set(stages.flatMap((s) => (isRelease(s) ? [] : s.items.map((x) => x.id))));
  const gone = new Set([...previousIds].filter((id) => !now.has(id)));
  if (!gone.size) return stages;
  const forget = (x) => {
    if (!gone.has(x.dependsOn)) return x;
    const { dependsOn: _gone, ...rest } = x;
    return rest;
  };
  return stages.map((s) => (isRelease(s) ? s : { ...s, items: s.items.map(forget) }));
}

/**
 * The base of a dependent item's run: the parent's run branch on the fork, whether the parent merged
 * upstream, and the project's policy for its pull request: 'wait-and-rebase' (the default: it opens once
 * the parent merged) or 'depends-on' (it opens at once, its body saying "Depends on #<parent's PR>").
 * parentPr: the URL of the parent's pull request a 'wait-and-rebase' child waits for (the ci step's
 * wait.parent), null otherwise. null for an item without a dependency.
 * @param {Roadmap} roadmap
 * @param {string} itemId
 * @param {{ runOf: (runId: string) => any, policy?: string }} options runOf(runId) → { branch, merged, prNumber, prUrl? } | null
 */
function dependencyBase(roadmap, itemId, { runOf, policy = 'wait-and-rebase' }) {
  const found = parentOfItem(roadmap, itemId, 'dependsOn', runOf);
  if (!found) return null;
  const { parentId, run } = found;
  const how = policy === 'depends-on' ? 'depends-on' : 'wait-and-rebase';
  return {
    parentId,
    branch: run?.branch || null,
    parentMerged: !!run?.merged,
    policy: how,
    prNote: how === 'depends-on' && run?.prNumber ? `Depends on #${run.prNumber}` : null,
    parentPr: how === 'wait-and-rebase' && !run?.merged && run?.prUrl ? run.prUrl : null,
  };
}

module.exports = {
  assertEarlierDependencies,
  dependencyBase,
  dependsOnField,
  forgetGoneParents,
  parentField,
  parentOfItem,
};
