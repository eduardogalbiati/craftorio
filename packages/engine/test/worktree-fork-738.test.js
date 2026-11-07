// #738: a run of a Fork + PR project starts from the original repository (packages/engine/engine/worktree.js,
// packages/engine/engine/run/checkout.js). Acceptance tests, written before the code.
// Throwaway repositories in os.tmpdir() (test/worktree-helpers.js): `upstream` (bare, the original, which
// rejects every push and records the attempt), `fork` (bare, the owner's fork) and `repo` (the project's
// clone: origin = fork, upstream = upstream, main checked out), `seed` (someone pushing to the original).
//
// The interface these tests assume:
// - prepareWorktree({ repo, base, dir, log, remote, fork: true, parentBranch? }): in fork mode it fetches
//   `upstream`, fast-forwards the local <base> to upstream/<base>, pushes <base> to origin (the fork), never
//   to upstream, and starts the worktree at upstream/<base>; with parentBranch (a dependent roadmap item) it
//   starts at origin/<parentBranch> (the parent's branch on the fork) instead.
// - restackOnBase({ repo, dir, base, parentBranch, log }) (worktree.js): "wait and rebase", once the parent
//   merged upstream: syncs <base> as above and rebases the run's branch (its commits after the parent's)
//   onto upstream/<base>; the branch keeps its name.
// - orchestrator.worktree.fork (a template, e.g. "{{ inputs.mode == 'fork' }}"): checkout.js's setupWorktree
//   renders it and passes fork: true to prepareWorktree.
// New exports are read inside each test: before the code exists each test fails on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { commit, git, logger, scratch } = require('./worktree-helpers');

const worktree = () => require('../engine/worktree');
const checkout = () => require('../engine/run/checkout');

function forkFixture(t) {
  const tmp = scratch(t, 'canonical');
  const upstream = path.join(tmp, 'upstream.git');
  const fork = path.join(tmp, 'fork.git');
  const seed = path.join(tmp, 'seed');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '-q', '--bare', upstream);
  git(tmp, 'clone', '-q', upstream, seed);
  git(seed, 'checkout', '-q', '-b', 'main');
  const first = commit(seed, 'a.txt', 'a\n', 'init');
  git(seed, 'push', '-q', '-u', 'origin', 'main');
  git(tmp, 'clone', '-q', '--bare', upstream, fork);
  git(tmp, 'clone', '-q', '-b', 'main', fork, repo);
  git(repo, 'remote', 'add', 'upstream', upstream);
  // the original moves on after the fork was made
  const fresh = commit(seed, 'b.txt', 'b\n', 'upstream moved');
  git(seed, 'push', '-q', 'origin', 'main');
  const marker = path.join(tmp, 'pushed-upstream');
  return { tmp, upstream, fork, seed, repo, first, fresh, marker, worktrees: path.join(tmp, 'worktrees') };
}

// from now on the original rejects every push and leaves a marker when one is tried
function guardUpstream(f) {
  const hook = path.join(f.upstream, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, `#!/bin/sh\necho tried > "${f.marker.replace(/\\/g, '/')}"\nexit 1\n`);
  fs.chmodSync(hook, 0o755);
}

// a parent item's branch on the fork, one commit on top of the fork's main
function parentOnFork(f, name = 'parent-1') {
  const other = path.join(f.tmp, 'other');
  git(f.tmp, 'clone', '-q', '-b', 'main', f.fork, other);
  git(other, 'checkout', '-q', '-b', name);
  const tip = commit(other, 'c.txt', 'c\n', 'the parent item');
  git(other, 'push', '-q', 'origin', name);
  return tip;
}

const head = (bare, ref = 'main') => git(bare, 'rev-parse', `refs/heads/${ref}`);

test('#738 fork mode: the worktree starts at the original\'s main, not the fork\'s stale one', async (t) => {
  const f = forkFixture(t);
  guardUpstream(f);
  const wt = await worktree().prepareWorktree({ repo: f.repo, base: 'main', dir: path.join(f.worktrees, 'run1'), fork: true });
  assert.equal(wt.commit, f.fresh);
});

test('#738 fork mode: the local main is fast-forwarded to upstream/main', async (t) => {
  const f = forkFixture(t);
  guardUpstream(f);
  await worktree().prepareWorktree({ repo: f.repo, base: 'main', dir: path.join(f.worktrees, 'run1'), fork: true });
  assert.equal(git(f.repo, 'rev-parse', 'refs/heads/main'), f.fresh);
});

test('#738 fork mode: the synced main is pushed to origin (the fork)', async (t) => {
  const f = forkFixture(t);
  guardUpstream(f);
  assert.equal(head(f.fork), f.first, 'the fork starts stale');
  await worktree().prepareWorktree({ repo: f.repo, base: 'main', dir: path.join(f.worktrees, 'run1'), fork: true });
  assert.equal(head(f.fork), f.fresh);
});

test('#738 fork mode never pushes to upstream', async (t) => {
  const f = forkFixture(t);
  guardUpstream(f);
  const { lines, log } = logger();
  await worktree().prepareWorktree({ repo: f.repo, base: 'main', dir: path.join(f.worktrees, 'run1'), fork: true, log });
  assert.equal(fs.existsSync(f.marker), false, `a push to upstream was tried: ${lines.join('\n')}`);
  assert.equal(head(f.upstream), f.fresh);
});

test('#805 fork mode: a dirty checkout of main is left as it is, with a warning, and the fork still syncs', async (t) => {
  const f = forkFixture(t);
  guardUpstream(f);
  fs.writeFileSync(path.join(f.repo, 'a.txt'), 'my edit\n');
  const { lines, log } = logger();
  const onto = await worktree().syncForkBase(f.repo, 'main', log);
  assert.equal(onto, 'upstream/main');
  assert.equal(lines.filter((l) => /^warn: worktree \(fork\): .*uncommitted changes on main; the local main was left as it is/.test(l)).length, 1, lines.join('\n'));
  assert.equal(git(f.repo, 'rev-parse', 'refs/heads/main'), f.first);
  assert.equal(fs.readFileSync(path.join(f.repo, 'a.txt'), 'utf8'), 'my edit\n');
  assert.equal(head(f.fork), f.fresh);
});

test('#805 fork mode: a local main with commits of its own is left as it is, with a warning', async (t) => {
  const f = forkFixture(t);
  guardUpstream(f);
  const own = commit(f.repo, 'local.txt', 'only here\n');
  const { lines, log } = logger();
  await worktree().syncForkBase(f.repo, 'main', log);
  assert.equal(lines.filter((l) => /^warn: worktree \(fork\): .*commits that are not in upstream\/main; the local main was left as it is/.test(l)).length, 1, lines.join('\n'));
  assert.equal(git(f.repo, 'rev-parse', 'refs/heads/main'), own);
});

test('#738 a dependent item\'s run starts from its parent\'s branch on the fork', async (t) => {
  const f = forkFixture(t);
  const parent = parentOnFork(f);
  guardUpstream(f);
  const wt = await worktree().prepareWorktree({ repo: f.repo, base: 'main', dir: path.join(f.worktrees, 'child'), fork: true, parentBranch: 'parent-1' });
  assert.equal(wt.commit, parent);
  assert.equal(fs.existsSync(f.marker), false, 'nothing pushed to upstream');
});

test('#738 wait and rebase: once the parent merged upstream, the child branch is rebased onto the synced main', async (t) => {
  const f = forkFixture(t);
  parentOnFork(f);
  const dir = path.join(f.worktrees, 'child');
  await worktree().prepareWorktree({ repo: f.repo, base: 'main', dir, fork: true, parentBranch: 'parent-1' });
  git(dir, 'switch', '-q', '-c', 'child-2');
  commit(dir, 'd.txt', 'd\n', 'the child item');
  // the parent's PR is squash-merged into the original
  const merged = commit(f.seed, 'c.txt', 'c\n', 'the parent item (squashed)');
  git(f.seed, 'push', '-q', 'origin', 'main');
  guardUpstream(f);
  await worktree().restackOnBase({ repo: f.repo, dir, base: 'main', parentBranch: 'parent-1', log: () => {} });
  assert.equal(git(dir, 'rev-parse', 'HEAD~1'), merged, 'the child\'s commit sits on the original\'s main');
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'child-2');
  assert.equal(fs.readFileSync(path.join(dir, 'd.txt'), 'utf8'), 'd\n');
  assert.equal(head(f.fork), merged, 'the fork\'s main is synced too');
  assert.equal(fs.existsSync(f.marker), false, 'nothing pushed to upstream');
});

// the checkout's view: what a run's setupWorktree does with the workflow's worktree config
function fakeRun(f, mode) {
  const events = [];
  return {
    wf: { orchestrator: { worktree: { repo: f.repo, base: 'main', remote: "{{ inputs.mode != 'local' }}", fork: "{{ inputs.mode == 'fork' }}" } } },
    ctx: { inputs: { mode } },
    worktreesDir: f.worktrees,
    runId: `run-${mode}`,
    machine: { simulated: false },
    emitEvent: (type, data) => events.push({ type, data }),
    logRepoCommands: () => {},
    prepareDeps: async () => {},
    events,
  };
}

test('#738 setupWorktree: worktree.fork rendered true starts the run at the original\'s main and syncs the fork', async (t) => {
  const f = forkFixture(t);
  guardUpstream(f);
  const run = fakeRun(f, 'fork');
  await checkout().methods.setupWorktree.call(run);
  assert.equal(run.worktree.commit, f.fresh);
  assert.equal(head(f.fork), f.fresh);
  assert.equal(fs.existsSync(f.marker), false);
});

test('#738 guard: setupWorktree in Remote mode leaves the fork\'s main and the upstream remote alone', async (t) => {
  const f = forkFixture(t);
  guardUpstream(f);
  const run = fakeRun(f, 'remote');
  await checkout().methods.setupWorktree.call(run);
  assert.equal(run.worktree.commit, f.first, 'Remote mode starts at origin/main');
  assert.equal(head(f.fork), f.first);
  assert.equal(fs.existsSync(f.marker), false);
});
