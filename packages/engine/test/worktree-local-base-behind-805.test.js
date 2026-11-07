// #805 "A local run says when its base is behind origin before it starts": acceptance tests written before the
// code, on prepareWorktree (packages/engine/engine/worktree.js) in throwaway repositories.
//
// Contract (the seam these tests assume):
// - prepareWorktree({ repo, base, dir, remote: false, log }) on a NEW worktree fetches origin/<base> and returns
//   `info.baseCheck` = { base, state, ahead, behind } (canUpdate not required here), state one of
//   equal | ahead | behind | diverged | no-remote | fetch-failed. It always starts from the local base and never
//   moves it.
// - behind: one `warn` log matching /\b2 commits behind origin\/main/ (singular: /\b1 commit behind origin\/main/);
//   origin/main (remote-tracking) is up to date after it; HEAD of the worktree = local main.
// - diverged: one `warn` log matching /diverged/i and /\b2 commits behind origin\/main/; local main not moved.
// - ahead, equal: the state says so, no warn log.
// - no origin remote: state `no-remote`, no warn log, the worktree is created as today.
// - failed fetch (origin's URL is a missing folder): state `fetch-failed`, a `warn` log matching
//   /could not fetch origin\/main/, the worktree created from the local base.
// - remote: true and fork: true are unchanged: info.baseCheck is undefined.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { prepareWorktree } = require('../engine/worktree');
const { commit, fixture, git, logger } = require('./worktree-helpers');

// someone else pushes `count` commits to origin; the repository has not fetched them
function pushedToOrigin(f, count) {
  for (let i = 0; i < count; i++) commit(f.other, `remote-${i}.txt`, `${i}\n`);
  git(f.other, 'push', '-q', 'origin', 'main');
  return git(f.other, 'rev-parse', 'HEAD');
}

async function prepared(f, options = {}) {
  const { lines, log } = logger();
  const dir = path.join(f.worktrees, 'run-805');
  const info = await prepareWorktree({ repo: f.repo, base: 'main', dir, remote: false, log, ...options });
  return { info, dir, warnings: lines.filter((l) => l.startsWith('warn: ')) };
}

const counts = (check) => [check?.base, check?.state, check?.ahead, check?.behind];

test('#805 a local base 2 commits behind: the run starts from it, unmoved, one warning gives the count and origin/main is refreshed', async (t) => {
  const f = fixture(t);
  const local = git(f.repo, 'rev-parse', 'main');
  const tip = pushedToOrigin(f, 2);
  const { info, dir, warnings } = await prepared(f);
  assert.deepEqual(counts(info.baseCheck), ['main', 'behind', 0, 2]);
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /\b2 commits behind origin\/main/);
  assert.equal(git(f.repo, 'rev-parse', 'refs/remotes/origin/main'), tip);
  assert.equal(git(f.repo, 'rev-parse', 'main'), local);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), local);
});

test('#805 a local base 1 commit behind: the warning says "1 commit" in the singular', async (t) => {
  const f = fixture(t);
  pushedToOrigin(f, 1);
  const { info, warnings } = await prepared(f);
  assert.deepEqual(counts(info.baseCheck), ['main', 'behind', 0, 1]);
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /\b1 commit behind origin\/main/);
});

test('#805 a local base ahead of origin: the state says so and nothing is warned', async (t) => {
  const f = fixture(t);
  const local = commit(f.repo, 'local.txt', 'only here\n');
  const { info, dir, warnings } = await prepared(f);
  assert.deepEqual(counts(info.baseCheck), ['main', 'ahead', 1, 0]);
  assert.deepEqual(warnings, []);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), local);
});

test('#805 a local base that diverged: one warning says so with the count, and the local base is not moved', async (t) => {
  const f = fixture(t);
  const local = commit(f.repo, 'local.txt', 'only here\n');
  pushedToOrigin(f, 2);
  const { info, dir, warnings } = await prepared(f);
  assert.deepEqual(counts(info.baseCheck), ['main', 'diverged', 1, 2]);
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /diverged/i);
  assert.match(warnings[0], /\b2 commits behind origin\/main/);
  assert.equal(git(f.repo, 'rev-parse', 'main'), local);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), local);
});

test('#805 a local base equal to origin: the state says so and nothing is warned', async (t) => {
  const f = fixture(t);
  const { info, warnings } = await prepared(f);
  assert.deepEqual(counts(info.baseCheck), ['main', 'equal', 0, 0]);
  assert.deepEqual(warnings, []);
});

test('#805 a repository with no origin remote: the state is no-remote, nothing is warned and the worktree is created', async (t) => {
  const f = fixture(t);
  const local = git(f.repo, 'rev-parse', 'main');
  git(f.repo, 'remote', 'remove', 'origin');
  const { info, dir, warnings } = await prepared(f);
  assert.equal(info.baseCheck?.state, 'no-remote');
  assert.deepEqual(warnings, []);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), local);
});

test('#805 a fetch that fails: the state is fetch-failed, a warning says so and the worktree starts from the local base', async (t) => {
  const f = fixture(t);
  const local = git(f.repo, 'rev-parse', 'main');
  git(f.repo, 'remote', 'set-url', 'origin', path.join(f.tmp, 'no-such-origin.git'));
  const { info, dir, warnings } = await prepared(f);
  assert.equal(info.baseCheck?.state, 'fetch-failed');
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /could not fetch origin\/main/);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), local);
});

test('#805 unchanged: a remote worktree starts from the fetched origin/main and has no baseCheck', async (t) => {
  const f = fixture(t);
  const tip = pushedToOrigin(f, 2);
  const { info, dir, warnings } = await prepared(f, { remote: true });
  assert.equal(info.baseCheck, undefined);
  assert.equal(info.ref, 'origin/main');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), tip);
  assert.deepEqual(warnings, []);
});

test('#805 unchanged: a fork worktree starts from upstream/main and has no baseCheck', async (t) => {
  const f = fixture(t);
  git(f.repo, 'remote', 'add', 'upstream', f.origin);
  const tip = pushedToOrigin(f, 2);
  const { info, dir } = await prepared(f, { remote: true, fork: true });
  assert.equal(info.baseCheck, undefined);
  assert.equal(info.ref, 'upstream/main');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), tip);
});
