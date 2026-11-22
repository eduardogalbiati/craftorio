// packages/engine/fronts/analyser/areas/diff.js (#118): the diff viewer's data. runDiff lists a run's changed files
// (added/modified/deleted/renamed, binary/image, large files without a patch) since the merge base
// with its base branch, or one commit only; runDiffFile returns one file's patch and both sides'
// contents. A mock run, or one without a worktree, gets the developer's reported files instead of
// git's. Tested at the area's own seam (its factory, (ctx) => { runDiff, runDiffFile }), with a
// minimal ctx standing in for the engine's live run (`.mock`, `.pendingGates()`) and a real run
// folder on disk: no engine run needed, and the real git fixture does the rest.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const diffArea = require('@craftorio/engine/fronts/analyser/areas/diff');
const { gitRepo } = require('@craftorio/engine/test/service/helpers');

// A minimal ctx for diff.js: a real runs/ folder (ctx.runFolder behaves like workspace.js's, an
// events.jsonl is required) and `active`, a fake stand-in for the engine's live WorkflowRun map.
function makeDiffCtx(t) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-diffctx-'));
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
  return { ctx, active, writeRun };
}

// A repository with an added, a modified, a deleted, a renamed (unchanged content) and a large
// file, over two commits after `base`: commit1 (modify/delete/add binary), commit2 (rename, grow
// big.txt past the "large" threshold).
function diffRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-diffrepo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-diffrepo-cfg-'));
  t.after(() => fs.rmSync(cfgDir, { recursive: true, force: true }));
  const cfg = path.join(cfgDir, 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(dir, 'gone.txt'), 'bye\n');
  fs.writeFileSync(path.join(dir, 'old.txt'), 'same\n');
  fs.writeFileSync(path.join(dir, 'big.txt'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');

  const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  fs.rmSync(path.join(dir, 'gone.txt'));
  fs.writeFileSync(path.join(dir, 'image.png'), imageBuffer);
  git('add', '-A');
  git('commit', '-q', '-m', 'commit1: modify a.txt, delete gone.txt, add a binary image');
  const commit1 = git('rev-parse', 'HEAD');

  git('mv', 'old.txt', 'new.txt');
  fs.writeFileSync(path.join(dir, 'big.txt'), Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n') + '\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'commit2: rename old.txt, grow big.txt past the large threshold');
  const commit2 = git('rev-parse', 'HEAD');

  return { dir, base, commit1, commit2, imageBuffer };
}

// A run active at a gate offering a diff (diff_base/work_dir), as pendingGates() would report it.
function openDiffGate(t, repo) {
  const { ctx, active, writeRun } = makeDiffCtx(t);
  const runId = writeRun('r1', [{ type: 'workflow.started', ts: new Date().toISOString(), mock: false, workflow: 'x', inputs: {} }]);
  active.set(runId, { mock: false, pendingGates: () => [{ approval_id: 'a1', work_dir: repo.dir, diff_base: repo.base }] });
  return { ctx, runId, approvalId: 'a1' };
}

// ---- runDiff: the whole branch ------------------------------------------------------------------

test('runDiff: an added, a modified, a deleted, a renamed (unchanged content) and a binary image file, with the right counts and statuses', async (t) => {
  const repo = diffRepo(t);
  const { ctx, runId, approvalId } = openDiffGate(t, repo);
  const result = await ctx.runDiff({ runId, approvalId });

  assert.equal(result.simulated, false);
  assert.equal(result.unavailable, null);
  assert.equal(result.base, repo.base);
  assert.equal(result.commits.length, 2);
  assert.equal(result.commits[0].sha, repo.commit2, 'newest first');
  assert.equal(result.commits[1].sha, repo.commit1);

  const byFile = Object.fromEntries(result.files.map((f) => [f.file, f]));
  assert.deepEqual([byFile['a.txt'].status, byFile['a.txt'].added, byFile['a.txt'].deleted], ['modified', 1, 0]);
  assert.match(byFile['a.txt'].patch, /\+two/);

  assert.deepEqual([byFile['gone.txt'].status, byFile['gone.txt'].added, byFile['gone.txt'].deleted], ['deleted', 0, 1]);
  assert.match(byFile['gone.txt'].patch, /-bye/);

  assert.equal(byFile['image.png'].status, 'added');
  assert.equal(byFile['image.png'].binary, true);
  assert.equal(byFile['image.png'].image, true);
  assert.equal(byFile['image.png'].patch, null);

  assert.equal(byFile['new.txt'].status, 'renamed');
  assert.equal(byFile['new.txt'].oldFile, 'old.txt');
  assert.match(byFile['new.txt'].patch, /rename from old\.txt/);

  assert.equal(byFile['big.txt'].large, true);
  assert.equal(byFile['big.txt'].patch, null);
  assert.ok(byFile['big.txt'].added + byFile['big.txt'].deleted > 1500);
});

test('runDiff with a commit: lists only that commit\'s files', async (t) => {
  const repo = diffRepo(t);
  const { ctx, runId, approvalId } = openDiffGate(t, repo);
  const result = await ctx.runDiff({ runId, approvalId, commit: repo.commit1 });

  assert.equal(result.commit, repo.commit1);
  assert.deepEqual(result.files.map((f) => f.file).sort(), ['a.txt', 'gone.txt', 'image.png']);
});

test('runDiff with an unknown commit throws', async (t) => {
  const repo = diffRepo(t);
  const { ctx, runId, approvalId } = openDiffGate(t, repo);
  await assert.rejects(
    ctx.runDiff({ runId, approvalId, commit: 'deadbeef' }),
    /is not one of this branch's commits/,
  );
});

// ---- runDiffFile: one file's patch and both sides -----------------------------------------------

test('runDiffFile: before/after text for a modified file', async (t) => {
  const repo = diffRepo(t);
  const { ctx, runId, approvalId } = openDiffGate(t, repo);
  const res = await ctx.runDiffFile({ runId, approvalId, file: 'a.txt' });
  assert.equal(res.before, 'one\n');
  assert.equal(res.after, 'one\ntwo\n');
  assert.equal(res.image, false);
});

test('runDiffFile: null for the missing side of an added or a deleted file', async (t) => {
  const repo = diffRepo(t);
  const { ctx, runId, approvalId } = openDiffGate(t, repo);
  const deleted = await ctx.runDiffFile({ runId, approvalId, file: 'gone.txt' });
  assert.equal(deleted.before, 'bye\n');
  assert.equal(deleted.after, null);

  const added = await ctx.runDiffFile({ runId, approvalId, file: 'image.png' });
  assert.equal(added.before, null);
});

test('runDiffFile: a renamed file reads both sides from oldFile/file; unchanged content on both sides', async (t) => {
  const repo = diffRepo(t);
  const { ctx, runId, approvalId } = openDiffGate(t, repo);
  const res = await ctx.runDiffFile({ runId, approvalId, file: 'new.txt', oldFile: 'old.txt' });
  assert.equal(res.before, 'same\n');
  assert.equal(res.after, 'same\n');
});

test('runDiffFile: an image file returns a data:image URL of its exact bytes', async (t) => {
  const repo = diffRepo(t);
  const { ctx, runId, approvalId } = openDiffGate(t, repo);
  const res = await ctx.runDiffFile({ runId, approvalId, file: 'image.png' });
  assert.equal(res.image, true);
  assert.match(res.after, /^data:image\/png;base64,/);
  assert.deepEqual(Buffer.from(res.after.split(',')[1], 'base64'), repo.imageBuffer);
});

// ---- A mock run, or one without a worktree/gate ------------------------------------------------

test('runDiff: a mock run returns the developer\'s reported files, not git\'s, whatever pendingGates() offers', async (t) => {
  const { ctx, active, writeRun } = makeDiffCtx(t);
  const runId = writeRun('r1', [
    { type: 'workflow.started', ts: new Date().toISOString(), mock: true, workflow: 'x', inputs: {} },
    { type: 'step.finished', ts: new Date().toISOString(), step_id: 'work', output: { files_changed: ['src/a.js', { file: 'src/b.js' }] } },
  ]);
  // even with a gate that looks like it offers a real diff, a mock (simulated) run never reads git
  active.set(runId, { mock: true, pendingGates: () => [{ approval_id: 'a1', work_dir: '/some/dir', diff_base: 'main' }] });

  const result = await ctx.runDiff({ runId, approvalId: 'a1' });
  assert.equal(result.simulated, true);
  assert.equal(result.unavailable, null);
  assert.deepEqual(result.files.map((f) => f.file), ['src/a.js', 'src/b.js']);
  assert.ok(result.files.every((f) => f.status === 'reported'));
});

test('runDiff: no worktree.ready and no open gate: unavailable, with the developer\'s reported files (none here)', async (t) => {
  const { ctx, writeRun } = makeDiffCtx(t);
  const runId = writeRun('r1', [{ type: 'workflow.started', ts: new Date().toISOString(), mock: false, workflow: 'x', inputs: {} }]);

  const result = await ctx.runDiff({ runId });
  assert.equal(result.simulated, false);
  assert.match(result.unavailable, /no git worktree/);
  assert.deepEqual(result.files, []);
});

test('runDiff: without approvalId, the base comes from events.jsonl\'s worktree.ready; "origin/main" (no remote here) falls back to "main" (no such branch here), then to the commit', async (t) => {
  const { ctx, writeRun } = makeDiffCtx(t);
  const repo = gitRepo(t); // base commit, then a.txt gains a line, on branch "main"
  execFileSync('git', ['-C', repo.dir, 'checkout', '-q', '--detach']);
  execFileSync('git', ['-C', repo.dir, 'branch', '-D', 'main']);

  const runId = writeRun('r1', [
    { type: 'workflow.started', ts: new Date().toISOString(), mock: false, workflow: 'x', inputs: {} },
    { type: 'worktree.ready', ts: new Date().toISOString(), dir: repo.dir, base: 'origin/main', commit: repo.base },
  ]);

  const result = await ctx.runDiff({ runId });
  assert.equal(result.simulated, false);
  assert.equal(result.unavailable, null);
  assert.equal(result.base, repo.base);
  assert.deepEqual(result.files.map((f) => f.file), ['a.txt']);
});
