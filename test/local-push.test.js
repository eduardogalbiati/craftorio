// Local merges not pushed (src/local-push.js): what the local base has that origin has not, the
// push, a rejected push then Update and push, and a conflict that keeps every local commit.
// Throwaway repositories in os.tmpdir() with a local bare repository as `origin` (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { localStatus, pushBase, updateAndPush, conflictTask, closedIssues } = require('../src/local-push');

// No user git config (identity, hooks, aliases), as on CI.
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function commit(cwd, file, text, msg = file) {
  fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}

// origin (bare) + repo (the workspace clone, main checked out) + other (someone pushing to origin)
function fixture(t) {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'push-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  const other = path.join(tmp, 'other');
  git(tmp, 'init', '-q', '--bare', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'checkout', '-q', '-b', 'main');
  commit(repo, 'a.txt', 'a\n', 'init');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(tmp, 'clone', '-q', '-b', 'main', origin, other);
  return { tmp, origin, repo, other };
}

const originHead = (f) => git(f.origin, 'rev-parse', 'refs/heads/main');

test('closedIssues: the issues a commit message closes, closing keywords only', () => {
  assert.deepEqual(closedIssues('Add X (#5)\n\nSee #6.\n\nCloses #89\nFixes #3, #4'), [3, 4, 89]);
  assert.deepEqual(closedIssues('Refactor\n\nNo issue'), []);
});

test('localStatus: counts the local commits not on origin and the issues they close; nothing when pushed', async (t) => {
  const f = fixture(t);
  let s = await localStatus({ repo: f.repo, base: 'main' });
  assert.deepEqual([s.ahead, s.behind, s.issues, s.error], [0, 0, [], null]);
  const b1 = commit(f.repo, 'b.txt', 'b\n', 'Add b\n\nCloses #12');
  const b2 = commit(f.repo, 'c.txt', 'c\n', 'Add c\n\nCloses #7\nCloses #12');
  s = await localStatus({ repo: f.repo, base: 'main' });
  assert.equal(s.ahead, 2);
  assert.deepEqual(s.commits.map((c) => [c.sha, c.subject, c.issues]), [[b2, 'Add c', [7, 12]], [b1, 'Add b', [12]]]);
  assert.deepEqual(s.issues, [7, 12]);
  assert.equal(s.base, 'main');
  // no base given: the repository's default branch
  assert.equal((await localStatus({ repo: f.repo, fetch: false })).ahead, 2);
});

test('localStatus: origin/<base> that moved is counted as behind after the fetch', async (t) => {
  const f = fixture(t);
  commit(f.other, 'o.txt', 'o\n', 'other');
  git(f.other, 'push', '-q', 'origin', 'main');
  assert.equal((await localStatus({ repo: f.repo, base: 'main', fetch: false })).behind, 0); // not fetched yet
  assert.equal((await localStatus({ repo: f.repo, base: 'main' })).behind, 1);
});

test('localStatus: a base missing on origin is reported, not thrown; a folder outside git throws', async (t) => {
  const f = fixture(t);
  git(f.repo, 'branch', 'dev');
  const s = await localStatus({ repo: f.repo, base: 'dev' });
  assert.match(s.error, /origin\/dev not found/);
  assert.ok(s.fetchError); // origin has no dev to fetch
  await assert.rejects(localStatus({ repo: path.join(f.tmp, 'nowhere') }), /not a git repository/);
});

test('pushBase: pushes the local base to origin (only the base) and reports what went', async (t) => {
  const f = fixture(t);
  const head = commit(f.repo, 'b.txt', 'b\n', 'Add b\n\nCloses #3');
  git(f.repo, 'branch', 'feat/unrelated');
  const r = await pushBase({ repo: f.repo, base: 'main' });
  assert.equal(r.pushed, true);
  assert.deepEqual([r.commits.length, r.issues], [1, [3]]);
  assert.equal(originHead(f), head);
  assert.equal(r.status.ahead, 0);
  assert.equal(git(f.origin, 'branch', '--list', 'feat/unrelated'), ''); // no other branch went
  // nothing left: nothing pushed
  const again = await pushBase({ repo: f.repo, base: 'main' });
  assert.deepEqual([again.pushed, again.commits], [false, []]);
});

test('pushBase: rejected when origin moved; updateAndPush rebases the local commits onto it and pushes', async (t) => {
  const f = fixture(t);
  commit(f.repo, 'b.txt', 'b\n', 'Add b\n\nCloses #3');
  const theirs = commit(f.other, 'o.txt', 'o\n', 'other');
  git(f.other, 'push', '-q', 'origin', 'main');
  // a push that raced origin: the local clone had not fetched the new commit when it pushed
  git(f.repo, 'config', 'remote.origin.fetch', '+refs/heads/none:refs/remotes/origin/none'); // the fetch brings nothing
  const r = await pushBase({ repo: f.repo, base: 'main' });
  assert.equal(r.pushed, false);
  assert.equal(r.rejected, true);
  assert.equal(originHead(f), theirs); // origin untouched, nothing forced
  git(f.repo, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');

  const u = await updateAndPush({ repo: f.repo, base: 'main' });
  assert.equal(u.pushed, true);
  assert.deepEqual(u.issues, [3]);
  const log = git(f.origin, 'log', '--format=%s', 'main').split('\n');
  assert.deepEqual(log, ['Add b', 'other', 'init']); // linear: the local commit on top of theirs
  assert.equal(git(f.repo, 'rev-parse', 'main'), originHead(f));
  assert.equal(u.status.ahead, 0);
});

test('updateAndPush: works when the base is checked out nowhere (temporary worktree, removed after)', async (t) => {
  const f = fixture(t);
  commit(f.repo, 'b.txt', 'b\n', 'Add b\n\nCloses #3');
  git(f.repo, 'checkout', '-q', '--detach');
  commit(f.other, 'o.txt', 'o\n', 'other');
  git(f.other, 'push', '-q', 'origin', 'main');
  const u = await updateAndPush({ repo: f.repo, base: 'main' });
  assert.equal(u.pushed, true);
  assert.deepEqual(git(f.origin, 'log', '--format=%s', 'main').split('\n'), ['Add b', 'other', 'init']);
  assert.equal(git(f.repo, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length, 1);
});

test('updateAndPush: a conflict stops with the files and keeps every local commit; nothing is pushed', async (t) => {
  const f = fixture(t);
  const mine = commit(f.repo, 'a.txt', 'mine\n', 'Change a\n\nCloses #5');
  const theirs = commit(f.other, 'a.txt', 'theirs\n', 'their a');
  git(f.other, 'push', '-q', 'origin', 'main');
  const u = await updateAndPush({ repo: f.repo, base: 'main' });
  assert.equal(u.pushed, false);
  assert.equal(u.conflict, true);
  assert.deepEqual(u.files, ['a.txt']);
  assert.match(u.error, /conflicts with origin\/main in a\.txt.*still has every local commit/);
  assert.equal(git(f.repo, 'rev-parse', 'main'), mine); // the local base as it was
  assert.equal(git(f.repo, 'status', '--porcelain'), ''); // no rebase left in progress
  assert.equal(originHead(f), theirs);
  assert.deepEqual([u.status.ahead, u.status.behind, u.status.issues], [1, 1, [5]]);
});

test('conflictTask: merging origin into a branch of the local base, as it says, keeps the local commits and makes the push go', async (t) => {
  const f = fixture(t);
  const mine = commit(f.repo, 'a.txt', 'mine\n', 'Change a\n\nCloses #5');
  commit(f.other, 'a.txt', 'theirs\n', 'their a');
  git(f.other, 'push', '-q', 'origin', 'main');
  const u = await updateAndPush({ repo: f.repo, base: 'main' });
  const task = conflictTask({ ...u.status, files: u.files });
  assert.match(task, /^Bring the local main up to date with origin\/main/);
  assert.match(task, /conflicted in: a\.txt/);
  assert.match(task, /`git merge origin\/main` on your branch \(a merge, not a rebase/);
  assert.match(task, /do not fetch, pull or push/);
  assert.match(task, new RegExp(`- ${mine.slice(0, 8)} Change a`));
  assert.match(task, /They close #5 once pushed/);

  // what the run does: a branch from the local main, the merge resolved, the local merge (fast-forward)
  git(f.repo, 'checkout', '-q', '-b', 'fix/push');
  assert.throws(() => git(f.repo, 'merge', '-q', 'origin/main'));
  fs.writeFileSync(path.join(f.repo, 'a.txt'), 'mine and theirs\n');
  git(f.repo, 'commit', '-q', '-am', 'Merge origin/main');
  git(f.repo, 'checkout', '-q', 'main');
  git(f.repo, 'merge', '-q', '--ff-only', 'fix/push');

  const p = await pushBase({ repo: f.repo, base: 'main' });
  assert.equal(p.pushed, true);
  assert.deepEqual(p.issues, [5]);
  git(f.origin, 'merge-base', '--is-ancestor', mine, 'refs/heads/main'); // the local commit went as it was
  assert.equal(p.status.ahead, 0);
});

test('conflictTask: without files, commits or issues it still says what to do', () => {
  const task = conflictTask({ base: 'develop' });
  assert.match(task, /origin\/develop moved\) and `git pull --rebase origin develop` conflicted\. /);
  assert.doesNotMatch(task, /Local commits|They close/);
  assert.doesNotMatch(task, /\n\n\n/);
});

test('updateAndPush: refuses uncommitted changes where the base is checked out', async (t) => {
  const f = fixture(t);
  commit(f.repo, 'b.txt', 'b\n', 'Add b');
  fs.writeFileSync(path.join(f.repo, 'a.txt'), 'dirty\n');
  await assert.rejects(updateAndPush({ repo: f.repo, base: 'main' }), /has uncommitted changes on main/);
});
