// #782: what the City's notes read about an analyzed commit (seed-runs.js commitsSince, commitGone), on real
// repositories: a worktree's .git is a file, so the project's isGit is false and the count still works; only git's own
// answer says a commit is gone, never a folder with no repository.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { commitGone, commitsSince } = require('../service/seed-runs');

const GONE = 'f'.repeat(40);
const git = (cwd, ...argv) => execFileSync('git', argv, { cwd, encoding: 'utf8' }).trim();

function folder(t) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'seed-runs-782-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function repo(t) {
  const dir = folder(t);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'one');
  return dir;
}

test('#782 a worktree (.git as a file, isGit false) counts its commits and keeps its commit', async (t) => {
  const main = repo(t);
  const head = git(main, 'rev-parse', 'HEAD');
  const tree = path.join(folder(t), 'tree');
  git(main, 'worktree', 'add', '-q', '-b', 'side', tree);
  git(tree, 'commit', '-q', '--allow-empty', '-m', 'two');
  const p = { folder: tree, isGit: false };
  assert.equal(await commitsSince(p, head), 1);
  assert.equal(await commitGone(p, head), false);
});

test('#782 a commit the repository does not have is gone, and has no count', async (t) => {
  const p = { folder: repo(t), isGit: true };
  assert.equal(await commitsSince(p, GONE), null);
  assert.equal(await commitGone(p, GONE), true);
});

test('#782 a folder with no repository is not known, not gone', async (t) => {
  const p = { folder: folder(t), isGit: false };
  assert.equal(await commitsSince(p, GONE), null);
  assert.equal(await commitGone(p, GONE), false);
});

test('#782 no commit recorded: nothing to count, nothing gone', async (t) => {
  const p = { folder: repo(t), isGit: true };
  assert.equal(await commitsSince(p, null), null);
  assert.equal(await commitGone(p, null), false);
});
