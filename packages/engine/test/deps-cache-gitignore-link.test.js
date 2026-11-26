// The dependency cache links node_modules into a worktree (packages/engine/engine/deps-cache.js). A
// project's .gitignore with `node_modules/` (GitHub's Node template) matches a folder, not that link,
// so git listed `?? node_modules` and the test writer's leftover check (commitLeftoverTests) stopped
// at its gate on every round (exploratory run 20261126-093311-93fd1414). ensureDeps now puts
// `node_modules` in the repository's exclude file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const depsCache = require('../engine/deps-cache');

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repoWithWorktree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-exclude-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(['init', '-q', '-b', 'main'], repo);
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"p"}');
  fs.writeFileSync(path.join(repo, 'package-lock.json'), '{}');
  git(['add', '-A'], repo);
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'init'], repo);
  const wt = path.join(root, 'wt');
  git(['worktree', 'add', '-q', wt], repo);
  return { root, repo, wt };
}

function fakeRun() {
  return async (cmd, args, opts = {}) => {
    if (args[0] === '--version') return { code: 0, output: '1.0.0', timedOut: false };
    const nm = path.join(opts.cwd, 'node_modules');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, '.package-lock.json'), '{}');
    return { code: 0, output: '', timedOut: false };
  };
}

test('a worktree whose node_modules the cache linked shows no untracked node_modules, with `node_modules/` in .gitignore', { skip: process.platform === 'win32' && 'links need rights on Windows' }, async (t) => {
  const { root, repo, wt } = repoWithWorktree(t);
  const cacheDir = path.join(root, 'cache');
  const r = await depsCache.ensureDeps({ workDir: wt, cacheDir, project: 'p', run: fakeRun() });
  assert.equal(r.status, 'miss');
  assert.ok(fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink(), 'node_modules is the cache link');
  assert.equal(git(['status', '--porcelain'], wt), '', 'git sees nothing new in the worktree');
  // a second worktree of the same repository gets a hit: still clean, the exclude line written once
  const wt2 = path.join(root, 'wt2');
  git(['worktree', 'add', '-q', wt2], repo);
  assert.equal((await depsCache.ensureDeps({ workDir: wt2, cacheDir, project: 'p', run: fakeRun() })).status, 'hit');
  assert.equal(git(['status', '--porcelain'], wt2), '');
  const exclude = fs.readFileSync(path.resolve(wt, git(['rev-parse', '--git-path', 'info/exclude'], wt)), 'utf8');
  assert.equal(exclude.split('\n').filter((l) => l === 'node_modules').length, 1, 'one exclude line');
  assert.equal(git(['status', '--porcelain'], repo), '', 'the project\'s tracked files are untouched');
});

test('excludeDepsLink outside a git repository changes nothing and does not throw', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-exclude-nogit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(depsCache.excludeDepsLink(dir), false);
});
