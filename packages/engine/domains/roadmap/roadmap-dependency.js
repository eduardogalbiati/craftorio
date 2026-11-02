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
  const dependsOn = String(raw.dependsOn ?? old?.dependsOn ?? '').trim();
  return dependsOn ? { dependsOn } : {};
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
 * The base of a dependent item's run: the parent's run branch on the fork, whether the parent merged
 * upstream, and the project's policy for its pull request: 'wait-and-rebase' (the default: it opens once
 * the parent merged) or 'depends-on' (it opens at once, its body saying "Depends on #<parent's PR>").
 * null for an item without a dependency.
 * @param {Roadmap} roadmap
 * @param {string} itemId
 * @param {{ runOf: (runId: string) => any, policy?: string }} options runOf(runId) → { branch, merged, prNumber } | null
 */
function dependencyBase(roadmap, itemId, { runOf, policy = 'wait-and-rebase' }) {
  const items = roadmap.stages.flatMap((s) => s.items);
  const item = items.find((x) => x.id === itemId);
  if (!item?.dependsOn) return null;
  const parent = items.find((x) => x.id === item.dependsOn);
  const run = parent?.runId ? runOf(parent.runId) : null;
  const how = policy === 'depends-on' ? 'depends-on' : 'wait-and-rebase';
  return {
    parentId: item.dependsOn,
    branch: run?.branch || null,
    parentMerged: !!run?.merged,
    policy: how,
    prNote: how === 'depends-on' && run?.prNumber ? `Depends on #${run.prNumber}` : null,
  };
}

module.exports = {
  assertEarlierDependencies,
  dependencyBase,
  dependsOnField,
};
