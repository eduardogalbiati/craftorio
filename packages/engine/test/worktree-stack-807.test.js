// #807 a stacked stage's branch (a Remote, pull request, run that starts from the previous stage's branch):
// where it starts, how it follows its parent, and what it does once the parent merged
// (packages/engine/engine/run/checkout.js, packages/engine/engine/worktree.js). Acceptance tests, written
// before the code. Throwaway repositories in os.tmpdir() (test/worktree-helpers.js fixture: `origin` bare,
// `repo` the project's clone, `other` someone else pushing to origin, as the platform merging a PR would).
//
// The interface these tests assume:
// - setupWorktree outside fork mode: inputs.parent_branch (a stacked roadmap item) makes the run start at
//   origin/<parent_branch> (prepareWorktree's parentBranch, no longer only with fork).
// - restackOnParent({ repo, dir, parentBranch, log }) (worktree.js): fetches origin and rebases the run's
//   branch onto origin/<parentBranch> (its new commits), the branch keeps its name → { base, commit }; a
//   conflict aborts the rebase and throws (message naming the conflict), leaving the branch as it was.
// - restackOnBase({ repo, dir, base, parentBranch, fork: false, log }): outside fork mode the parent merged
//   into origin/<base> (a merge commit or a squash), and the run's own commits (after origin/<parentBranch>)
//   are rebased onto origin/<base>, never repeating the parent's.
// New exports are read inside each test: before the code exists each test fails on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { commit, fixture, git } = require('./worktree-helpers');

const worktree = () => require('../engine/worktree');
const checkout = () => require('../engine/run/checkout');

// the parent stage's branch on origin, one commit on top of main
function parentOnOrigin(f, name = 'parent-1') {
  git(f.other, 'checkout', '-q', '-b', name);
  const tip = commit(f.other, 'p.txt', 'p\n', 'the parent stage');
  git(f.other, 'push', '-q', 'origin', name);
  git(f.other, 'checkout', '-q', 'main');
  return tip;
}

// the stacked run's worktree: branch child-2 from origin/parent-1 with one commit of its own
function childOn(f, parent = 'parent-1') {
  git(f.repo, 'fetch', '-q', 'origin');
  const dir = path.join(f.worktrees, 'child');
  git(f.repo, 'worktree', 'add', '-q', '-b', 'child-2', dir, `origin/${parent}`);
  const own = commit(dir, 'd.txt', 'd\n', 'the stacked stage');
  return { dir, own };
}

// what lies between origin/main and the branch, by subject
const ownCommits = (dir) => git(dir, 'log', '--format=%s', 'origin/main..HEAD').split('\n').filter(Boolean);

test('#807 setupWorktree in Remote mode: a stacked item\'s run starts at its parent\'s branch', async (t) => {
  const f = fixture(t, 'canonical');
  const tip = parentOnOrigin(f);
  const run = {
    wf: { orchestrator: { worktree: { repo: f.repo, base: 'main', remote: "{{ inputs.mode != 'local' }}", fork: "{{ inputs.mode == 'fork' }}" } } },
    ctx: { inputs: { mode: 'remote', parent_branch: 'parent-1' } },
    worktreesDir: f.worktrees,
    runId: 'run-stacked',
    machine: { simulated: false },
    emitEvent: () => {},
    logRepoCommands: () => {},
    prepareDeps: async () => {},
  };
  await checkout().methods.setupWorktree.call(run);
  assert.equal(run.worktree.commit, tip);
});

test('#807 restackOnParent: the parent got new commits, the stacked branch is rebased onto them and keeps its name', async (t) => {
  const f = fixture(t, 'canonical');
  parentOnOrigin(f);
  const { dir } = childOn(f);
  git(f.other, 'checkout', '-q', 'parent-1');
  const moved = commit(f.other, 'q.txt', 'q\n', 'the parent, after review');
  git(f.other, 'push', '-q', 'origin', 'parent-1');
  await worktree().restackOnParent({ repo: f.repo, dir, parentBranch: 'parent-1', log: () => {} });
  assert.deepEqual([git(dir, 'rev-parse', 'HEAD~1'), git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), fs.readFileSync(path.join(dir, 'd.txt'), 'utf8')], [moved, 'child-2', 'd\n']);
});

test('#807 restackOnParent: a conflict with the parent\'s new commits throws and leaves the branch as it was', async (t) => {
  const f = fixture(t, 'canonical');
  parentOnOrigin(f);
  const { dir, own } = childOn(f);
  git(f.other, 'checkout', '-q', 'parent-1');
  commit(f.other, 'd.txt', 'the parent wrote d too\n', 'the parent, conflicting');
  git(f.other, 'push', '-q', 'origin', 'parent-1');
  await assert.rejects(worktree().restackOnParent({ repo: f.repo, dir, parentBranch: 'parent-1', log: () => {} }), /conflict/i);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), own);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('#807 restackOnBase outside fork mode: the parent merged with a merge commit, only the stacked commit sits on origin/main', async (t) => {
  const f = fixture(t, 'canonical');
  parentOnOrigin(f);
  const { dir } = childOn(f);
  git(f.other, 'merge', '-q', '--no-ff', 'origin/parent-1', '-m', 'Merge the parent PR');
  git(f.other, 'push', '-q', 'origin', 'main');
  const merged = git(f.other, 'rev-parse', 'HEAD');
  await worktree().restackOnBase({ repo: f.repo, dir, base: 'main', parentBranch: 'parent-1', fork: false, log: () => {} });
  assert.deepEqual([git(dir, 'rev-parse', 'HEAD~1'), ownCommits(dir)], [merged, ['the stacked stage']]);
});

test('#807 restackOnBase outside fork mode: the parent was squash-merged, its commits are not repeated', async (t) => {
  const f = fixture(t, 'canonical');
  parentOnOrigin(f);
  const { dir } = childOn(f);
  git(f.other, 'merge', '-q', '--squash', 'origin/parent-1');
  git(f.other, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'The parent PR (squashed)');
  git(f.other, 'push', '-q', 'origin', 'main');
  const squashed = git(f.other, 'rev-parse', 'HEAD');
  await worktree().restackOnBase({ repo: f.repo, dir, base: 'main', parentBranch: 'parent-1', fork: false, log: () => {} });
  assert.deepEqual([git(dir, 'rev-parse', 'HEAD~1'), ownCommits(dir)], [squashed, ['the stacked stage']]);
});
