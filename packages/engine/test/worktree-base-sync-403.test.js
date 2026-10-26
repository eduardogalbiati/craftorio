// #403: syncWithBase (packages/engine/engine/worktree.js) brings the local base into a run's worktree before a
// suite or E2E round, in throwaway repositories (test/worktree-helpers.js). A base that moved is
// rebased in; a conflict, uncommitted changes or a rebase git refuses for another reason (here a
// pre-rebase hook) leave the worktree as it was, with no rebase left in progress, and say why. The
// local base is never modified. The `blocked` outcome (an abort that fails) has no seam to provoke it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { prepareWorktree, syncWithBase } = require('../engine/worktree');
const { commit, fixture, git } = require('./worktree-helpers');

async function setup(t) {
  const f = fixture(t);
  const dir = path.join(f.worktrees, 'run1');
  await prepareWorktree({ repo: f.repo, base: 'main', dir, remote: false });
  git(dir, 'switch', '-q', '-c', 'run1');
  return { ...f, dir };
}
const midRebase = (dir) => ['rebase-merge', 'rebase-apply'].some((n) => fs.existsSync(path.resolve(dir, git(dir, 'rev-parse', '--git-path', n))));

test('#403 syncWithBase rebases the branch onto a base that moved and names the base commits it got', async (t) => {
  const f = await setup(t);
  commit(f.dir, 'feature.txt', 'feature\n', 'the run\'s change');
  const fix = commit(f.repo, 'fix.txt', 'fixed\n', 'fix the failing test on main');
  const r = await syncWithBase({ repo: f.repo, dir: f.dir, base: 'main' });
  assert.equal(r.moved, true);
  assert.equal(r.base_commit, fix);
  assert.equal(r.count, 1);
  assert.equal(r.commits.length, 1);
  assert.match(r.commits[0], /fix the failing test on main/);
  assert.equal(r.to, git(f.dir, 'rev-parse', 'HEAD'));
  assert.equal(git(f.dir, 'merge-base', 'HEAD', 'main'), fix, 'the branch sits on the base');
  assert.equal(git(f.dir, 'show', 'HEAD:feature.txt'), 'feature');
  assert.equal(git(f.repo, 'rev-parse', 'refs/heads/main'), fix, 'the base is not modified');
});

test('#403 syncWithBase leaves an up-to-date branch as it is', async (t) => {
  const f = await setup(t);
  const head = commit(f.dir, 'feature.txt', 'feature\n', 'the run\'s change');
  const r = await syncWithBase({ repo: f.repo, dir: f.dir, base: 'main' });
  assert.equal(r.moved, false);
  assert.equal(r.conflict, false);
  assert.equal(r.skipped, null);
  assert.equal(r.base_commit, git(f.repo, 'rev-parse', 'refs/heads/main'));
  assert.equal(git(f.dir, 'rev-parse', 'HEAD'), head);
});

test('#403 syncWithBase: a base that conflicts is a conflict with its files; the branch stays as it was, no rebase in progress', async (t) => {
  const f = await setup(t);
  const head = commit(f.dir, 'a.txt', 'branch\n', 'the run\'s change to a.txt');
  const forkPoint = git(f.dir, 'rev-parse', 'HEAD~1');
  const conflicting = commit(f.repo, 'a.txt', 'base\n', 'a conflicting change on main');
  const r = await syncWithBase({ repo: f.repo, dir: f.dir, base: 'main' });
  assert.equal(r.moved, false);
  assert.equal(r.conflict, true);
  assert.deepEqual(r.files, ['a.txt']);
  assert.equal(r.blocked, null);
  assert.equal(r.base_commit, forkPoint, 'the base commit the branch still sits on');
  assert.equal(git(f.dir, 'rev-parse', 'HEAD'), head);
  assert.equal(midRebase(f.dir), false);
  assert.equal(git(f.repo, 'rev-parse', 'refs/heads/main'), conflicting);
});

test('#403 syncWithBase: a rebase git refuses without a conflict (a pre-rebase hook) is skipped with git\'s message; the branch stays as it was', async (t) => {
  const f = await setup(t);
  const head = commit(f.dir, 'feature.txt', 'feature\n', 'the run\'s change');
  const fix = commit(f.repo, 'fix.txt', 'fixed\n', 'fix the failing test on main');
  const hooks = path.resolve(f.dir, git(f.dir, 'rev-parse', '--git-path', 'hooks'));
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(path.join(hooks, 'pre-rebase'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const r = await syncWithBase({ repo: f.repo, dir: f.dir, base: 'main' });
  assert.equal(r.moved, false);
  assert.equal(r.conflict, false);
  assert.equal(r.blocked, null);
  assert.match(String(r.skipped), /rebase failed: .*pre-rebase hook refused/i);
  assert.equal(r.count, 1, 'the base commit that was not brought in');
  assert.equal(git(f.dir, 'rev-parse', 'HEAD'), head);
  assert.equal(midRebase(f.dir), false);
  assert.equal(git(f.repo, 'rev-parse', 'refs/heads/main'), fix);
});

test('#610 syncWithBase: a hook refusal keeps git\'s message when a shell warning comes first on stderr', async (t) => {
  const f = await setup(t);
  const head = commit(f.dir, 'feature.txt', 'feature\n', 'the run\'s change');
  commit(f.repo, 'fix.txt', 'fixed\n', 'fix the failing test on main');
  const hooks = path.resolve(f.dir, git(f.dir, 'rev-parse', '--git-path', 'hooks'));
  fs.mkdirSync(hooks, { recursive: true });
  // Git for Windows' bash prints this when it finds no /tmp, before git's own refusal line (#610)
  fs.writeFileSync(path.join(hooks, 'pre-rebase'), '#!/bin/sh\necho "bash.exe: warning: could not find /tmp, please create!" >&2\nexit 1\n', { mode: 0o755 });
  const r = await syncWithBase({ repo: f.repo, dir: f.dir, base: 'main' });
  assert.equal(r.moved, false);
  assert.equal(r.blocked, null);
  assert.match(String(r.skipped), /rebase failed: .*pre-rebase hook refused/i);
  assert.equal(git(f.dir, 'rev-parse', 'HEAD'), head);
  assert.equal(midRebase(f.dir), false);
});

test('#403 syncWithBase: uncommitted changes to tracked files skip the rebase and keep the changes', async (t) => {
  const f = await setup(t);
  const head = commit(f.dir, 'feature.txt', 'feature\n', 'the run\'s change');
  commit(f.repo, 'fix.txt', 'fixed\n', 'fix the failing test on main');
  fs.writeFileSync(path.join(f.dir, 'feature.txt'), 'work in progress\n');
  const r = await syncWithBase({ repo: f.repo, dir: f.dir, base: 'main' });
  assert.equal(r.moved, false);
  assert.match(String(r.skipped), /uncommitted changes/);
  assert.equal(git(f.dir, 'rev-parse', 'HEAD'), head);
  assert.equal(fs.readFileSync(path.join(f.dir, 'feature.txt'), 'utf8'), 'work in progress\n');
});

test('#403 syncWithBase without a local base branch returns null', async (t) => {
  const f = await setup(t);
  assert.equal(await syncWithBase({ repo: f.repo, dir: f.dir, base: 'no-such-branch' }), null);
});
