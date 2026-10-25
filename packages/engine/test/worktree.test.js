// Git worktree per run (packages/engine/engine/worktree.js + orchestrator.worktree in the engine).
// Uses throwaway repositories in os.tmpdir() with a local bare repository as `origin` (no network).
//
// Must pass on Windows, Linux and macOS, whatever the machine's git config. The paths handed to
// the code under test are deliberately NOT the canonical spelling git prints: by default they go
// through a symlink (a junction on Windows, which needs no admin rights), like macOS's
// /var -> /private/var; on Windows the path tests also run through an 8.3 short name, like
// os.tmpdir() on the GitHub Windows runner (C:\Users\RUNNER~1 vs git's C:/Users/runneradmin).
// This file: canonicalPath/samePath, prepareWorktree and removeWorktree. Split by #305:
// cleanupWorktrees is in test/worktree-cleanup.test.js, local merges in test/worktree-local-merge.test.js,
// the engine in test/slow/worktree-engine.slow.test.js; shared fixtures in test/worktree-helpers.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareWorktree, removeWorktree, listWorktrees, isMerged, samePath, canonicalPath } = require('../engine/worktree');
const { commit, fixture, git, logger, scratch, shortPath, spelled, SPELLINGS } = require('./worktree-helpers');

test('canonicalPath/samePath: symlinks, 8.3 names, missing tails, separators and case', (t) => {
  const real = scratch(t, 'canonical');
  const link = path.join(path.dirname(real), 'linked');
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(canonicalPath(link), real);
  // a path that does not exist yet: the existing ancestor is resolved, the rest appended
  assert.equal(canonicalPath(path.join(link, 'not', 'yet')), path.join(real, 'not', 'yet'));
  assert.ok(samePath(path.join(link, 'x'), path.join(real, 'x')));
  assert.ok(samePath(`${real}${path.sep}`, real));
  assert.ok(samePath(real.replace(/\\/g, '/'), real), 'forward slashes, as git prints them on Windows');
  assert.ok(!samePath(path.join(real, 'a'), path.join(real, 'b')));
  if (process.platform === 'win32' || process.platform === 'darwin') assert.ok(samePath(real.toUpperCase(), real));
  const short = shortPath(real);
  if (short) {
    assert.equal(canonicalPath(short), real);
    assert.ok(samePath(path.join(short, 'missing'), path.join(link, 'missing')));
  }
});

test('prepareWorktree: a folder outside git returns null (the caller works in the folder)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(await prepareWorktree({ repo: dir, base: 'main', dir: path.join(dir, 'wt') }), null);
  assert.equal(await prepareWorktree({ repo: path.join(dir, 'missing'), base: 'main', dir: path.join(dir, 'wt') }), null);
});

for (const spelling of SPELLINGS) {
  test(`prepareWorktree (${spelling} paths): detached at the freshly fetched origin/<base>, not the stale local base`, async (t) => {
    const f = spelled(t, spelling);
    if (!f) return;
    const fresh = commit(f.other, 'b.txt', 'b\n');
    git(f.other, 'push', '-q', 'origin', 'main');
    const dir = path.join(f.worktrees, 'run1');
    const wt = await prepareWorktree({ repo: f.repo, base: 'main', dir });
    assert.equal(wt.ref, 'origin/main');
    assert.equal(wt.commit, fresh);
    assert.equal(wt.dir, canonicalPath(dir));
    assert.equal(wt.workDir, canonicalPath(dir), 'the worktree itself, not the repository or a path climbing out of it');
    assert.equal(wt.repo, canonicalPath(f.repo));
    assert.equal(git(dir, 'rev-parse', 'HEAD'), fresh);
    assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD', 'detached');
    assert.notEqual(git(f.repo, 'rev-parse', 'main'), fresh, 'the local main is untouched');
    assert.ok((await listWorktrees(f.repo)).some((w) => samePath(w.dir, dir)));

    // same folder again (resume): reused as is
    const again = await prepareWorktree({ repo: f.repo, base: 'main', dir });
    assert.equal(again.reused, true);
    assert.equal(again.workDir, wt.workDir);
  });
}

test('prepareWorktree: no reachable remote only warns and falls back to what is local', async (t) => {
  const f = fixture(t);
  git(f.repo, 'remote', 'set-url', 'origin', path.join(f.tmp, 'gone.git'));
  const { lines, log } = logger();
  const wt = await prepareWorktree({ repo: f.repo, base: 'main', dir: path.join(f.worktrees, 'run1'), log });
  assert.equal(wt.ref, 'origin/main'); // the last fetched state
  assert.match(lines.join('\n'), /could not fetch origin\/main/);

  git(f.repo, 'remote', 'remove', 'origin');
  const local = await prepareWorktree({ repo: f.repo, base: 'main', dir: path.join(f.worktrees, 'run2'), log });
  assert.equal(local.ref, 'main');
  assert.match(lines.join('\n'), /starting from the local main/);
});

for (const spelling of SPELLINGS) {
  test(`prepareWorktree (${spelling} paths): a subfolder of the repository keeps the same subfolder in the worktree`, async (t) => {
    const f = spelled(t, spelling);
    if (!f) return;
    fs.mkdirSync(path.join(f.repo, 'app'));
    commit(f.repo, 'app/x.txt', 'x\n');
    git(f.repo, 'push', '-q', 'origin', 'main');
    const dir = path.join(f.worktrees, 'run1');
    const wt = await prepareWorktree({ repo: path.join(f.repo, 'app'), base: 'main', dir });
    assert.equal(wt.workDir, path.join(canonicalPath(dir), 'app'));
    assert.ok(fs.existsSync(path.join(wt.workDir, 'x.txt')));
  });
}

test('removeWorktree: deletes a squash-merged branch, keeps an unmerged one', async (t) => {
  const f = fixture(t);
  const dir = path.join(f.worktrees, 'run1');
  await prepareWorktree({ repo: f.repo, base: 'main', dir });
  git(dir, 'switch', '-q', '--no-track', '-c', 'feat/x', 'origin/main');
  commit(dir, 'feature.txt', 'feature\n');
  commit(dir, 'feature2.txt', 'more\n');
  git(dir, 'push', '-q', '-u', 'origin', 'feat/x');
  // the branch cannot be deleted from the main checkout while the worktree has it checked out
  // (git < 2.42 says "checked out at", newer versions "used by worktree at")
  assert.throws(() => git(f.repo, 'branch', '-D', 'feat/x'), /checked out|used by worktree/);
  // squash merge on the "server"
  git(f.other, 'fetch', '-q', 'origin');
  git(f.other, 'merge', '-q', '--squash', 'origin/feat/x');
  git(f.other, 'commit', '-q', '-m', 'squash');
  git(f.other, 'push', '-q', 'origin', 'main');
  git(f.repo, 'fetch', '-q', 'origin');
  assert.equal(await isMerged(f.repo, 'feat/x', 'origin/main'), true);

  const r = await removeWorktree({ repo: f.repo, dir, base: 'main' });
  assert.deepEqual(r, { removed: true, branch: 'feat/x', branchDeleted: true });
  assert.ok(!fs.existsSync(dir));
  assert.equal(git(f.repo, 'branch', '--list', 'feat/x'), '');

  const dir2 = path.join(f.worktrees, 'run2');
  await prepareWorktree({ repo: f.repo, base: 'main', dir: dir2 });
  git(dir2, 'switch', '-q', '-c', 'feat/y');
  commit(dir2, 'y.txt', 'y\n');
  const { lines, log } = logger();
  const r2 = await removeWorktree({ repo: f.repo, dir: dir2, base: 'main', log });
  assert.deepEqual(r2, { removed: true, branch: 'feat/y', branchDeleted: false });
  assert.equal(git(f.repo, 'branch', '--list', 'feat/y').replace(/^[*+ ]+/, ''), 'feat/y');
  assert.match(lines.join('\n'), /not merged .* kept/);
});

test('removeWorktree: a node_modules linking the shared dependency cache (#198) is unlinked first; removal never follows it into the cache', async (t) => {
  const f = fixture(t);
  const dir = path.join(f.worktrees, 'run1');
  await prepareWorktree({ repo: f.repo, base: 'main', dir });
  const cacheEntry = path.join(f.tmp, 'cache-entry');
  fs.mkdirSync(path.join(cacheEntry, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(cacheEntry, 'node_modules', 'kept.txt'), 'kept');
  fs.symlinkSync(path.join(cacheEntry, 'node_modules'), path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

  const r = await removeWorktree({ repo: f.repo, dir, base: 'main' });
  assert.equal(r.removed, true);
  assert.ok(!fs.existsSync(dir));
  assert.ok(fs.existsSync(path.join(cacheEntry, 'node_modules', 'kept.txt')), 'the shared cache entry is untouched');
});

test('prepareWorktree: resume recreates a deleted worktree from the run branch', async (t) => {
  const f = fixture(t);
  const dir = path.join(f.worktrees, 'run1');
  await prepareWorktree({ repo: f.repo, base: 'main', dir });
  git(dir, 'switch', '-q', '-c', 'feat/z');
  const head = commit(dir, 'z.txt', 'z\n');
  git(f.repo, 'worktree', 'remove', '--force', dir);
  const wt = await prepareWorktree({ repo: f.repo, base: 'main', dir, branch: 'feat/z' });
  assert.equal(wt.recreated, true);
  assert.equal(wt.ref, 'feat/z');
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feat/z');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
});

// #202: no worktree folder is kept for an ended run (the branch keeps the work): succeeded, failed
