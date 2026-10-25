// #289: run:diff (packages/engine/service/areas/diff.js) for a run merged locally whose branch the engine then
// deleted (worktree.merged with the merge commit, then worktree.removed with branch_deleted): the
// commits still come from the repository, read from the merge commit (a fast-forward: the commit
// itself; a true merge: its second parent) down to the base commit the run started from; only when
// that commit is gone too is the branch "gone". Also the `summary` option: the commits and the
// files' counts without any patch. Developer's tests on the area's own seam (as diff-289.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const diffArea = require('../../service/areas/diff');

function makeDiffCtx(t) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-diffctx-289m-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const ctx = diffArea({
    ws: { runs: runsDir },
    runFolder(id) {
      const dir = path.join(runsDir, path.basename(String(id || '')));
      if (!fs.existsSync(path.join(dir, 'events.jsonl'))) throw new Error(`Run not found: ${id}`);
      return dir;
    },
    active: new Map(),
  });
  function writeRun(runId, events) {
    const dir = path.join(runsDir, runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
    return runId;
  }
  return { ctx, writeRun };
}

// A repository with `main` and a run's worktree on branch run/r1 with two commits on top of main.
function worktreeRepo(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-diffrepo-289m-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'svc-diffwt-289m-')), 'r1');
  t.after(() => fs.rmSync(path.dirname(wt), { recursive: true, force: true }));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-diffcfg-289m-'));
  t.after(() => fs.rmSync(cfgDir, { recursive: true, force: true }));
  const cfg = path.join(cfgDir, 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'worktree', 'add', '-q', '-b', 'run/r1', wt, 'main');
  fs.writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo\n');
  git(wt, 'add', '.');
  git(wt, 'commit', '-q', '-m', 'first change');
  fs.writeFileSync(path.join(wt, 'b.txt'), 'new\n');
  git(wt, 'add', '.');
  git(wt, 'commit', '-q', '-m', 'second change');

  return { repo, wt, base, branch: 'run/r1', git };
}

const ts = () => new Date().toISOString();
const started = () => ({ type: 'workflow.started', ts: ts(), mock: false, workflow: 'x', inputs: {} });
const readyOf = (r) => ({ type: 'worktree.ready', ts: ts(), dir: r.wt, work_dir: r.wt, repo: r.repo, base: 'main', ref: r.branch, commit: r.base });
const mergedOf = (r, commit) => ({ type: 'worktree.merged', ts: ts(), branch: r.branch, base: 'main', commit, checkout: null, rebased: false });
const removedOf = (r) => ({ type: 'worktree.removed', ts: ts(), dir: r.wt, removed: true, branch: r.branch, branch_deleted: true, by: 'cleanup' });

// the engine's local merge: the base fast-forwarded to the branch, then the worktree and the branch removed
function mergeAndClean(r, ...mergeArgs) {
  r.git(r.repo, 'merge', '-q', ...mergeArgs, r.branch);
  const commit = r.git(r.repo, 'rev-parse', 'HEAD');
  r.git(r.repo, 'worktree', 'remove', '--force', r.wt);
  r.git(r.repo, 'branch', '-D', r.branch);
  return commit;
}

test('#289 run:diff of a run merged locally (fast-forward) whose branch was deleted: its two commits, read from the merge commit', async (t) => {
  const r = worktreeRepo(t);
  const { ctx, writeRun } = makeDiffCtx(t);
  const commit = mergeAndClean(r, '--ff-only');
  writeRun('r1', [started(), readyOf(r), mergedOf(r, commit), removedOf(r)]);
  const d = await ctx.runDiff({ runId: 'r1' });
  assert.equal(d.unavailable, null, 'nothing is unavailable while the merge commit exists');
  assert.equal(d.branchGone, false);
  assert.equal(d.branch, r.branch, 'the run\'s branch is still named');
  assert.deepEqual(d.commits.map((c) => c.subject), ['second change', 'first change']);
  assert.deepEqual(d.files.map((f) => f.file).sort(), ['a.txt', 'b.txt']);
  assert.ok(d.files.every((f) => typeof f.patch === 'string' && f.patch.startsWith('diff --git ')), 'the viewer still gets the patches');
});

test('#289 run:diff of a run merged with a true merge commit: the branch is its second parent, the two commits only', async (t) => {
  const r = worktreeRepo(t);
  const { ctx, writeRun } = makeDiffCtx(t);
  const commit = mergeAndClean(r, '--no-ff', '-m', 'merge run/r1');
  writeRun('r1', [started(), readyOf(r), mergedOf(r, commit), removedOf(r)]);
  const d = await ctx.runDiff({ runId: 'r1' });
  assert.equal(d.unavailable, null);
  assert.deepEqual(d.commits.map((c) => c.subject), ['second change', 'first change'], 'not the merge commit itself');
  assert.deepEqual(d.files.map((f) => f.file).sort(), ['a.txt', 'b.txt']);
});

test('#289 run:diff when the branch is deleted and the merge commit is gone too: "branch is gone", no commits, no error', async (t) => {
  const r = worktreeRepo(t);
  const { ctx, writeRun } = makeDiffCtx(t);
  mergeAndClean(r, '--ff-only');
  writeRun('r1', [started(), readyOf(r), mergedOf(r, '0123456789abcdef0123456789abcdef01234567'), removedOf(r)]);
  const d = await ctx.runDiff({ runId: 'r1' });
  assert.equal(d.branchGone, true);
  assert.equal(d.commits.length, 0);
  assert.match(String(d.unavailable), /branch .*gone/i);
});

test('#289 run:diff { summary: true } answers the commits and the files\' counts with every patch null', async (t) => {
  const r = worktreeRepo(t);
  const { ctx, writeRun } = makeDiffCtx(t);
  writeRun('r1', [started(), readyOf(r)]);
  const d = await ctx.runDiff({ runId: 'r1', summary: true });
  assert.equal(d.commits.length, 2);
  assert.deepEqual(d.files.map((f) => f.file).sort(), ['a.txt', 'b.txt']);
  assert.ok(d.files.every((f) => f.patch === null), 'no patch in a summary');
  assert.ok(d.files.every((f) => Number.isInteger(f.added) && Number.isInteger(f.deleted)), 'the counts stay');
  const full = await ctx.runDiff({ runId: 'r1' });
  assert.ok(full.files.every((f) => typeof f.patch === 'string'), 'without summary the patches come');
});

// The engine's local merge when the base moved (packages/engine/engine/worktree.js mergeLocally): the branch is
// rebased onto the base, then the base fast-forwards to it (worktree.merged { rebased: true }).
// The run's commits are the rebased ones only: the commit the base gained in the meantime is not
// the run's (issue #289: "The run's own commits only (not the base's)").
test('#289 run:diff of a rebased local merge whose branch was deleted lists the run\'s two commits, not the commit the base gained meanwhile', async (t) => {
  const r = worktreeRepo(t);
  const { ctx, writeRun } = makeDiffCtx(t);
  fs.writeFileSync(path.join(r.repo, 'c.txt'), 'meanwhile\n');
  r.git(r.repo, 'add', '.');
  r.git(r.repo, 'commit', '-q', '-m', 'meanwhile on main');
  r.git(r.wt, 'rebase', '-q', 'main');
  const commit = mergeAndClean(r, '--ff-only');
  const merged = Object.assign(mergedOf(r, commit), { rebased: true });
  writeRun('r1', [started(), readyOf(r), merged, removedOf(r)]);
  const d = await ctx.runDiff({ runId: 'r1' });
  assert.equal(d.unavailable, null, 'nothing is unavailable while the merge commit exists');
  assert.deepEqual(d.commits.map((c) => c.subject), ['second change', 'first change'], 'the rebased commits of the run, newest first, and no commit of the base');
  assert.deepEqual(d.files.map((f) => f.file).sort(), ['a.txt', 'b.txt'], 'the files the run changed, not the base\'s c.txt');
});
