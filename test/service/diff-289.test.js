// #289: the expanded run card's Repository column reads run:diff (src/service/areas/diff.js) for an
// ended run. Once the run's worktree folder is gone its branch still answers (#202); once the branch
// is gone too (deleted, nothing merged) the answer must say so instead of failing: { commits: [],
// unavailable: /branch .*gone/i }. Acceptance test, written before the code, on the area's own seam
// (its factory with a minimal ctx and a real run folder, as in test/service/diff.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const diffArea = require('../../src/service/areas/diff');

function makeDiffCtx(t) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-diffctx-289-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const active = new Map();
  const ctx = diffArea({
    ws: { runs: runsDir },
    runFolder(id) {
      const dir = path.join(runsDir, path.basename(String(id || '')));
      if (!fs.existsSync(path.join(dir, 'events.jsonl'))) throw new Error(`Run not found: ${id}`);
      return dir;
    },
    active,
  });
  function writeRun(runId, events) {
    const dir = path.join(runsDir, runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
    return runId;
  }
  return { ctx, writeRun };
}

// A repository with `main` and a run's worktree on branch run/r1 with two commits on top of main,
// as the engine records it (worktree.ready with repo, dir, base and commit).
function worktreeRepo(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-diffrepo-289-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'svc-diffwt-289-')), 'r1');
  t.after(() => fs.rmSync(path.dirname(wt), { recursive: true, force: true }));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-diffcfg-289-'));
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

test('#289 run:diff after the worktree folder is removed and then the branch deleted: the commits first, then "branch is gone" with no commits and no error', async (t) => {
  const r = worktreeRepo(t);
  const { ctx, writeRun } = makeDiffCtx(t);
  const started = { type: 'workflow.started', ts: ts(), mock: false, workflow: 'x', inputs: {} };
  const ready = { type: 'worktree.ready', ts: ts(), dir: r.wt, work_dir: r.wt, repo: r.repo, base: 'main', ref: r.branch, commit: r.base };

  // the run ended, its folder was removed, its branch kept (#202): the branch still answers
  r.git(r.repo, 'worktree', 'remove', '--force', r.wt);
  assert.equal(fs.existsSync(r.wt), false, 'the worktree folder is gone');
  writeRun('r1', [started, ready, { type: 'worktree.removed', ts: ts(), dir: r.wt, removed: true, branch: r.branch, branch_deleted: false }]);
  const kept = await ctx.runDiff({ runId: 'r1' });
  assert.equal(kept.unavailable, null, 'with the branch kept nothing is unavailable');
  assert.equal(kept.commits.length, 2, 'the branch\'s two commits');

  // the branch is deleted too (nothing merged): a clear state, not a thrown git error
  r.git(r.repo, 'branch', '-D', r.branch);
  writeRun('r1', [started, ready, { type: 'worktree.removed', ts: ts(), dir: r.wt, removed: true, branch: r.branch, branch_deleted: true }]);
  const gone = await ctx.runDiff({ runId: 'r1' });
  assert.equal(gone.commits.length, 0);
  assert.match(String(gone.unavailable), /branch .*gone/i);
  assert.equal(gone.simulated, false);
});

test('#289 run:diff when the branch is gone but the events say it was kept (deleted by hand): still "branch is gone", no error', async (t) => {
  const r = worktreeRepo(t);
  const { ctx, writeRun } = makeDiffCtx(t);
  r.git(r.repo, 'worktree', 'remove', '--force', r.wt);
  r.git(r.repo, 'branch', '-D', r.branch);
  writeRun('r1', [
    { type: 'workflow.started', ts: ts(), mock: false, workflow: 'x', inputs: {} },
    { type: 'worktree.ready', ts: ts(), dir: r.wt, work_dir: r.wt, repo: r.repo, base: 'main', ref: r.branch, commit: r.base },
    { type: 'worktree.removed', ts: ts(), dir: r.wt, removed: true, branch: r.branch, branch_deleted: false },
  ]);
  const gone = await ctx.runDiff({ runId: 'r1' });
  assert.equal(gone.commits.length, 0);
  assert.match(String(gone.unavailable), /branch .*gone/i);
});
