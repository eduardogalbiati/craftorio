// Git worktree per run, local workflows (orchestrator.worktree.remote: false + merge: local):
// prepareWorktree from the local base and mergeLocally (packages/engine/engine/worktree.js), in throwaway repositories.
// Split from test/worktree.test.js (#305); shared fixtures in test/worktree-helpers.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareWorktree, removeWorktree, mergeLocally, canonicalPath } = require('../engine/worktree');
const { commit, fixture, git, logger } = require('./worktree-helpers');

test('prepareWorktree remote: false starts from the local base, with unpushed commits, even when origin moved', async (t) => {
  const f = fixture(t);
  const local = commit(f.repo, 'local.txt', 'only here\n', 'local, never pushed');
  // someone pushes to origin: a remote worktree would start there, a local one must not
  commit(f.other, 'remote.txt', 'remote\n');
  git(f.other, 'push', '-q', 'origin', 'main');
  const dir = path.join(f.worktrees, 'run-local');
  const info = await prepareWorktree({ repo: f.repo, base: 'main', dir, remote: false });
  assert.equal(info.ref, 'main');
  assert.equal(info.remote, false);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), local);
  assert.ok(fs.existsSync(path.join(dir, 'local.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'remote.txt')));
});

test('mergeLocally: fast-forwards the checked-out local base; the merged branch is deleted with the worktree', async (t) => {
  const f = fixture(t);
  const dir = path.join(f.worktrees, 'run1');
  await prepareWorktree({ repo: f.repo, base: 'main', dir, remote: false });
  git(dir, 'switch', '-q', '-c', 'feat/local');
  const head = commit(dir, 'feature.txt', 'feature\n');
  const { lines, log } = logger();
  const r = await mergeLocally({ repo: f.repo, dir, base: 'main', log });
  assert.deepEqual(r, { branch: 'feat/local', base: 'main', commit: head, checkout: canonicalPath(f.repo), rebased: false });
  assert.equal(git(f.repo, 'rev-parse', 'main'), head);
  assert.ok(fs.existsSync(path.join(f.repo, 'feature.txt')), 'the main checkout was updated too');
  assert.match(lines.join('\n'), /fast-forwarded to feat\/local .*nothing pushed/);
  // nothing was pushed
  assert.notEqual(git(f.repo, 'rev-parse', 'origin/main'), head);

  const rm = await removeWorktree({ repo: f.repo, dir, base: 'main', remote: false });
  assert.deepEqual(rm, { removed: true, branch: 'feat/local', branchDeleted: true });
});

test('mergeLocally: rebases onto a base that moved (another local merge), then fast-forwards', async (t) => {
  const f = fixture(t);
  const a = path.join(f.worktrees, 'run-a');
  const b = path.join(f.worktrees, 'run-b');
  await prepareWorktree({ repo: f.repo, base: 'main', dir: a, remote: false });
  await prepareWorktree({ repo: f.repo, base: 'main', dir: b, remote: false });
  git(a, 'switch', '-q', '-c', 'feat/a');
  commit(a, 'a-feature.txt', 'a\n');
  git(b, 'switch', '-q', '-c', 'feat/b');
  commit(b, 'b-feature.txt', 'b\n');
  await mergeLocally({ repo: f.repo, dir: a, base: 'main' });
  const r = await mergeLocally({ repo: f.repo, dir: b, base: 'main' });
  assert.equal(r.rebased, true);
  assert.equal(git(f.repo, 'rev-parse', 'main'), git(b, 'rev-parse', 'HEAD'));
  // linear history: both features on main, no merge commit
  assert.ok(fs.existsSync(path.join(f.repo, 'a-feature.txt')) && fs.existsSync(path.join(f.repo, 'b-feature.txt')));
  assert.equal(git(f.repo, 'rev-list', '--merges', '--count', 'main'), '0');
});

test('mergeLocally: a conflict aborts the rebase, leaves the branch and the base untouched, and names the files', async (t) => {
  const f = fixture(t);
  const a = path.join(f.worktrees, 'run-a');
  const b = path.join(f.worktrees, 'run-b');
  await prepareWorktree({ repo: f.repo, base: 'main', dir: a, remote: false });
  await prepareWorktree({ repo: f.repo, base: 'main', dir: b, remote: false });
  git(a, 'switch', '-q', '-c', 'feat/a');
  commit(a, 'a.txt', 'from a\n');
  git(b, 'switch', '-q', '-c', 'feat/b');
  const bHead = commit(b, 'a.txt', 'from b\n');
  await mergeLocally({ repo: f.repo, dir: a, base: 'main' });
  const mainBefore = git(f.repo, 'rev-parse', 'main');
  await assert.rejects(mergeLocally({ repo: f.repo, dir: b, base: 'main' }), /feat\/b conflicts with the local main in a\.txt/);
  assert.equal(git(b, 'rev-parse', 'HEAD'), bHead, 'branch left as it was');
  assert.equal(git(b, 'symbolic-ref', '--short', 'HEAD'), 'feat/b', 'no rebase in progress');
  assert.equal(git(f.repo, 'rev-parse', 'main'), mainBefore);
});

test('mergeLocally: refuses uncommitted changes where the base is checked out, and moves the ref when it is checked out nowhere', async (t) => {
  const f = fixture(t);
  const dir = path.join(f.worktrees, 'run1');
  await prepareWorktree({ repo: f.repo, base: 'main', dir, remote: false });
  git(dir, 'switch', '-q', '-c', 'feat/x');
  const head = commit(dir, 'x.txt', 'x\n');
  fs.writeFileSync(path.join(f.repo, 'a.txt'), 'edited, not committed\n');
  await assert.rejects(mergeLocally({ repo: f.repo, dir, base: 'main' }), /has uncommitted changes on main/);
  assert.notEqual(git(f.repo, 'rev-parse', 'main'), head);
  // the owner works on another branch: main is checked out nowhere, so the ref moves
  git(f.repo, 'checkout', '-q', 'a.txt');
  git(f.repo, 'switch', '-q', '-c', 'owner-work');
  const r = await mergeLocally({ repo: f.repo, dir, base: 'main' });
  assert.equal(r.checkout, null);
  assert.equal(git(f.repo, 'rev-parse', 'main'), head);
  assert.equal(git(f.repo, 'symbolic-ref', '--short', 'HEAD'), 'owner-work', 'the owner\'s checkout is untouched');
  // uncommitted changes in the run's own worktree are refused too
  const dir2 = path.join(f.worktrees, 'run2');
  await prepareWorktree({ repo: f.repo, base: 'main', dir: dir2, remote: false });
  git(dir2, 'switch', '-q', '-c', 'feat/y');
  commit(dir2, 'y.txt', 'y\n');
  fs.writeFileSync(path.join(dir2, 'y.txt'), 'dirty\n');
  await assert.rejects(mergeLocally({ repo: f.repo, dir: dir2, base: 'main' }), /run's worktree has uncommitted changes/);
});
