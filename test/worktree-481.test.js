// #481 (SEC-23), src/engine/worktree.js: `git fetch origin <base>` with a base_branch that starts with
// `-` (e.g. `--upload-pack=<program>`) must never reach git as an option: the base is refused (a
// value that is not a valid branch name, check-ref-format semantics) or passed after
// --end-of-options. Observable: the program never runs. Here the "program" is `mkdir <marker>`
// against a local origin (git runs --upload-pack through its shell on every OS); prepareWorktree and
// removeWorktree may throw or warn, but the marker folder must not appear.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { prepareWorktree, removeWorktree } = require('../src/engine/worktree');

// <scratch>/origin (one commit on main) cloned to <scratch>/work
function repos(t) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-481-'));
  t.after(() => { try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* EBUSY */ } });
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const origin = path.join(scratch, 'origin');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q');
  fs.writeFileSync(path.join(origin, 'a.txt'), 'one\n');
  git(origin, 'add', '.');
  git(origin, 'commit', '-q', '-m', 'first');
  git(scratch, 'clone', '-q', origin, 'work');
  // forward slashes: the shell git runs the upload-pack with is sh, also on Windows
  const marker = path.join(scratch, 'pwned').replace(/\\/g, '/');
  return { scratch, git, work: path.join(scratch, 'work'), marker };
}

test('#481 prepareWorktree: a base_branch like --upload-pack=<program> never runs the program', async (t) => {
  const { scratch, work, marker } = repos(t);
  await prepareWorktree({ repo: work, base: `--upload-pack=mkdir ${marker}`, dir: path.join(scratch, 'wt') }).catch(() => null);
  assert.equal(fs.existsSync(marker), false, 'git took the base for an option and ran --upload-pack');
});

test('#481 removeWorktree: a base like --upload-pack=<program> never runs the program', async (t) => {
  const { scratch, git, work, marker } = repos(t);
  const dir = path.join(scratch, 'wt');
  const info = await prepareWorktree({ repo: work, base: 'main', dir });
  git(info.dir, 'checkout', '-q', '-b', 'run/x');
  await removeWorktree({ repo: work, dir, base: `--upload-pack=mkdir ${marker}` }).catch(() => null);
  assert.equal(fs.existsSync(marker), false, 'git took the base for an option and ran --upload-pack');
});

test('#481 prepareWorktree: a normal base (main) still starts from origin/main', async (t) => {
  const { scratch, work } = repos(t);
  const info = await prepareWorktree({ repo: work, base: 'main', dir: path.join(scratch, 'wt') });
  assert.equal(info.ref, 'origin/main');
});
