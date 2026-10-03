// src/repo-performance.js (#159): Analytics' Repository performance tab and the files-most-runs-edit
// map the Product Owner shares (#150). Seams: conflictsOf, runFacts, filesEditedByRuns, fileCounts,
// sharedFiles and repositoryPerformance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  CONFLICT_STEPS, conflictsOf, fileCounts, filesEditedByRuns, repositoryPerformance, runFacts, SHARED_LIMIT, sharedFiles,
} = require('../src/repo-performance');

// Isolated identity on every call: nothing depends on the machine's git config (as in worktree.test.js).
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function commit(cwd, file, text, msg = file) {
  fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}

function tmpRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-perf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  git(dir, 'init', '-q');
  return dir;
}

function writeEvents(t, events) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-perf-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));
  return dir;
}

function fakeStore(cache = {}) {
  const puts = [];
  return {
    runFiles(runId) { return cache[runId] || null; },
    putRunFiles(runId, key, files) { puts.push({ runId, key, files }); cache[runId] = { key, files }; },
    puts,
  };
}

// ---- conflictsOf -------------------------------------------------------------------------------

test('conflictsOf: "Merge conflict in X" names a plain file (Dockerfile) with no extension or folder', (t) => {
  const dir = writeEvents(t, [{ type: 'log', message: 'CONFLICT (content): Merge conflict in Dockerfile' }]);
  const out = conflictsOf(dir);
  assert.deepEqual(out.files, ['Dockerfile']);
  assert.equal(out.count, 1);
});

test('conflictsOf: "(modify/delete)" and the branch after "modified in" are stripped; only the file name is kept', (t) => {
  const dir = writeEvents(t, [{ type: 'log', message: 'CONFLICT (modify/delete): Makefile deleted in HEAD and modified in run/x.' }]);
  const out = conflictsOf(dir);
  assert.deepEqual(out.files, ['Makefile']);
  assert.ok(!out.files.includes('run/x'));
  assert.ok(!out.files.includes('modify/delete'));
  assert.ok(!out.files.includes('HEAD'));
});

test('conflictsOf: a path with folders (src/renderer/index.html) named twice across events is counted once', (t) => {
  const dir = writeEvents(t, [
    { type: 'log', message: 'CONFLICT (content): Merge conflict in src/renderer/index.html' },
    { type: 'log', message: 'Still unresolved: Merge conflict in src/renderer/index.html' },
  ]);
  const out = conflictsOf(dir);
  assert.deepEqual(out.files, ['src/renderer/index.html']);
  assert.equal(out.count, 2); // both messages are counted, even though they name the same file
});

test('conflictsOf: a trailing sentence dot is not part of the file name', (t) => {
  const dir = writeEvents(t, [{ type: 'log', message: 'Still conflicting: README.md.' }]);
  const out = conflictsOf(dir);
  assert.deepEqual(out.files, ['README.md']);
});

test('conflictsOf: the files list is capped at 10, the messages kept at 3, but count reflects every conflict message', (t) => {
  const events = Array.from({ length: 12 }, (_, i) => ({ type: 'log', message: `Merge conflict in file${i}.txt` }));
  const dir = writeEvents(t, events);
  const out = conflictsOf(dir);
  assert.equal(out.count, 12);
  assert.equal(out.files.length, 10);
  assert.equal(out.messages.length, 3);
});

test('conflictsOf: a workflow.finished event\'s error also counts as a conflict message', (t) => {
  const dir = writeEvents(t, [{ type: 'workflow.finished', error: 'merge conflict in a.js' }]);
  const out = conflictsOf(dir);
  assert.deepEqual(out.files, ['a.js']);
});

test('conflictsOf: a run with no events.jsonl reports no conflicts', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-perf-empty-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(conflictsOf(dir), { count: 0, files: [], messages: [] });
});

// ---- runFacts -----------------------------------------------------------------------------------

test('CONFLICT_STEPS names both step ids the engine uses for a merge conflict', () => {
  assert.ok(CONFLICT_STEPS.has('resolve_conflict'));
  assert.ok(CONFLICT_STEPS.has('resolve_merge'));
});

test('runFacts: the worktree.ready commit, a resolve_merge step, and the conflict\'s files', (t) => {
  const dir = writeEvents(t, [
    { type: 'worktree.ready', commit: 'abc123' },
    { type: 'step.started', step_id: 'resolve_merge' },
    { type: 'log', message: 'CONFLICT (content): Merge conflict in shared.js' },
  ]);
  const facts = runFacts(dir);
  assert.equal(facts.baseCommit, 'abc123');
  assert.equal(facts.conflictStep, 'resolve_merge');
  assert.equal(facts.failedMerge, false);
  assert.deepEqual(facts.conflictFiles, ['shared.js']);
});

test('runFacts: a failed "gh pr merge" sets failedMerge even without a resolve step', (t) => {
  const dir = writeEvents(t, [
    { type: 'action.executed', skipped: false, exit_code: 1, command: 'gh pr merge 5 --squash' },
  ]);
  const facts = runFacts(dir);
  assert.equal(facts.conflictStep, null);
  assert.equal(facts.failedMerge, true);
});

test('runFacts: a skipped action, or one that exits 0, never counts as a failed merge', (t) => {
  const skipped = writeEvents(t, [{ type: 'action.executed', skipped: true, exit_code: 1, command: 'gh pr merge 5' }]);
  assert.equal(runFacts(skipped).failedMerge, false);
  const ok = writeEvents(t, [{ type: 'action.executed', skipped: false, exit_code: 0, command: 'gh pr merge 5' }]);
  assert.equal(runFacts(ok).failedMerge, false);
});

// ---- fileCounts ---------------------------------------------------------------------------------

test('fileCounts: a run counts once per file even if it is listed twice; sorted by run count then file name', () => {
  const byRun = new Map([
    ['r1', ['a.js', 'b.js']],
    ['r2', ['b.js', 'b.js']],
    ['r3', ['c.js']],
  ]);
  const out = fileCounts(byRun);
  assert.deepEqual(out, [
    { file: 'b.js', runs: 2, share: 2 / 3, runIds: ['r1', 'r2'] },
    { file: 'a.js', runs: 1, share: 1 / 3, runIds: ['r1'] },
    { file: 'c.js', runs: 1, share: 1 / 3, runIds: ['r3'] },
  ]);
});

test('fileCounts: an empty map of runs gives no files and no division by zero', () => {
  assert.deepEqual(fileCounts(new Map()), []);
});

// ---- filesEditedByRuns ----------------------------------------------------------------------------

test('filesEditedByRuns: more than 8 uncached runs are each read through git (pool of 8), results match each run\'s own commit, and the store gets one write per run', async (t) => {
  const repo = tmpRepo(t);
  const init = commit(repo, 'init.txt', 'init\n');
  const N = 10;
  const runs = [];
  let base = init;
  for (let i = 0; i < N; i++) {
    const tip = commit(repo, `file${i}.txt`, `content ${i}\n`);
    const runDir = writeEvents(t, [{ type: 'worktree.ready', commit: base }]);
    const startedAt = new Date(Date.UTC(2026, 8, 28, 8 + i, 0, 0)).toISOString();
    const finishedAt = new Date(Date.UTC(2026, 8, 28, 8 + i, 5, 0)).toISOString();
    runs.push({ runId: `r${i}`, runDir, localMerge: { commit: tip }, pr: null, resumedFrom: null, startedAt, finishedAt });
    base = tip;
  }

  const store = fakeStore();
  const out = await filesEditedByRuns({ runs, repo, store });
  assert.equal(out.size, N);
  for (let i = 0; i < N; i++) assert.deepEqual(out.get(`r${i}`), [`file${i}.txt`]);
  assert.equal(store.puts.length, N);
  assert.deepEqual(new Set(store.puts.map((p) => p.runId)), new Set(runs.map((r) => r.runId)));

  // cached runs (same key the first call wrote) are returned as-is, never recomputed; uncached ones still are
  const keyOf = (runId) => store.puts.find((p) => p.runId === runId).key;
  const store2 = fakeStore({
    r0: { key: keyOf('r0'), files: ['BOGUS-CACHED-0.txt'] },
    r1: { key: keyOf('r1'), files: ['BOGUS-CACHED-1.txt'] },
  });
  const out2 = await filesEditedByRuns({ runs, repo, store: store2 });
  assert.deepEqual(out2.get('r0'), ['BOGUS-CACHED-0.txt']);
  assert.deepEqual(out2.get('r1'), ['BOGUS-CACHED-1.txt']);
  for (let i = 2; i < N; i++) assert.deepEqual(out2.get(`r${i}`), [`file${i}.txt`]);
  assert.equal(store2.puts.length, N - 2);
  assert.ok(!store2.puts.some((p) => p.runId === 'r0' || p.runId === 'r1'));
});

test('filesEditedByRuns: a run whose base commit is bad is left out, without affecting the others', async (t) => {
  const repo = tmpRepo(t);
  const init = commit(repo, 'init.txt', 'init\n');
  const tipGood = commit(repo, 'good.txt', 'good\n');
  const goodDir = writeEvents(t, [{ type: 'worktree.ready', commit: init }]);
  const badDir = writeEvents(t, [{ type: 'worktree.ready', commit: '0'.repeat(40) }]); // not a real commit
  const runs = [
    { runId: 'good', runDir: goodDir, localMerge: { commit: tipGood }, pr: null, resumedFrom: null, startedAt: '2026-09-28T08:00:00Z', finishedAt: '2026-09-28T08:05:00Z' },
    { runId: 'bad', runDir: badDir, localMerge: { commit: tipGood }, pr: null, resumedFrom: null, startedAt: '2026-09-28T09:00:00Z', finishedAt: '2026-09-28T09:05:00Z' },
  ];
  const out = await filesEditedByRuns({ runs, repo, store: fakeStore() });
  assert.deepEqual(out.get('good'), ['good.txt']);
  assert.equal(out.has('bad'), false);
});

test('filesEditedByRuns: a PR run (no localMerge) resolves its merge commit by number and diffs it', async (t) => {
  const repo = tmpRepo(t);
  commit(repo, 'init.txt', 'init\n');
  git(repo, 'checkout', '-q', '-b', 'feature');
  commit(repo, 'pr-file.txt', 'from the PR\n');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #42 from feature', 'feature');

  const runs = [{ runId: 'pr-run', runDir: null, localMerge: null, pr: { number: 42 }, resumedFrom: null, startedAt: '2026-09-28T08:00:00Z', finishedAt: '2026-09-28T08:05:00Z' }];
  const out = await filesEditedByRuns({ runs, repo, store: fakeStore() });
  assert.deepEqual(out.get('pr-run'), ['pr-file.txt']);
});

test('filesEditedByRuns: without a repository (or a non-git folder) returns an empty map', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-perf-notgit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(await filesEditedByRuns({ runs: [{ runId: 'x' }], repo: dir, store: fakeStore() }), new Map());
  assert.deepEqual(await filesEditedByRuns({ runs: [{ runId: 'x' }], repo: null, store: fakeStore() }), new Map());
});

// ---- sharedFiles (#150: the same function the Product Owner's conflict map uses) ------------------

test('sharedFiles: the Product Owner\'s conflict map is fileCounts of filesEditedByRuns, limited', async (t) => {
  const repo = tmpRepo(t);
  const init = commit(repo, 'init.txt', 'init\n');
  const tip1 = commit(repo, 'a.txt', 'a\n');
  const runs = [
    { runId: 'r1', runDir: writeEvents(t, [{ type: 'worktree.ready', commit: init }]), localMerge: { commit: tip1 }, pr: null, resumedFrom: null, startedAt: '2026-09-28T08:00:00Z', finishedAt: '2026-09-28T08:05:00Z' },
    { runId: 'r2', runDir: writeEvents(t, [{ type: 'worktree.ready', commit: tip1 }]), localMerge: { commit: commit(repo, 'z.txt', 'z\n') }, pr: null, resumedFrom: null, startedAt: '2026-09-28T09:00:00Z', finishedAt: '2026-09-28T09:05:00Z' },
  ];
  const out = await sharedFiles({ runs, repo, store: fakeStore(), limit: 1 });
  assert.equal(out.runs, 2);
  assert.deepEqual(out.files, [{ file: 'a.txt', runs: 1, share: 0.5, runIds: ['r1'] }]); // "a.txt" sorts before "z.txt", limit 1
});

// ---- repositoryPerformance (end to end) ------------------------------------------------------------

test('repositoryPerformance: a conflict run\'s cost share, the file the two runs share (over the shared limit), and the peak of overlapping runs', async (t) => {
  const repo = tmpRepo(t);
  const init = commit(repo, 'init.txt', 'init\n');
  const tip1 = commit(repo, 'shared.js', 'a\n');
  const tip2 = commit(repo, 'shared.js', 'a\nb\n');

  const rc = {
    runId: 'rc', mock: false, status: 'success', workflow: 'wf', title: 'Conflict run', costUsd: 2,
    startedAt: '2026-09-28T08:00:00Z', finishedAt: '2026-09-28T08:10:00Z',
    localMerge: { commit: tip1 }, pr: null, resumedFrom: null,
    runDir: writeEvents(t, [
      { type: 'worktree.ready', commit: init },
      { type: 'step.started', step_id: 'resolve_merge' },
      { type: 'log', message: 'CONFLICT (content): Merge conflict in shared.js' },
    ]),
  };
  const ro = {
    runId: 'ro', mock: false, status: 'success', workflow: 'wf', title: 'Other run', costUsd: 1,
    startedAt: '2026-09-28T09:00:00Z', finishedAt: '2026-09-28T09:10:00Z',
    localMerge: { commit: tip2 }, pr: null, resumedFrom: null,
    runDir: writeEvents(t, [{ type: 'worktree.ready', commit: tip1 }]),
  };
  const pa = {
    runId: 'pa', mock: false, status: 'success', workflow: 'wf', title: 'Parallel A', costUsd: 0,
    startedAt: '2026-09-30T08:00:00Z', finishedAt: '2026-09-30T09:00:00Z',
    localMerge: null, pr: null, resumedFrom: null, runDir: path.join(repo, 'no-such-run-dir'),
  };
  const pb = {
    runId: 'pb', mock: false, status: 'success', workflow: 'wf', title: 'Parallel B', costUsd: 0,
    startedAt: '2026-09-30T08:30:00Z', finishedAt: '2026-09-30T09:30:00Z',
    localMerge: null, pr: null, resumedFrom: null, runDir: path.join(repo, 'no-such-run-dir-2'),
  };

  const result = await repositoryPerformance({
    runs: [rc, ro, pa, pb], repo, store: fakeStore(), from: '2026-09-01', to: '2026-10-01', marker: '2026-09-29', now: Date.now(),
  });

  assert.equal(result.sharedLimit, SHARED_LIMIT);
  assert.equal(result.empty, false);
  assert.equal(result.runs, 4);
  assert.equal(result.runsWithCommits, 2);
  assert.equal(result.costUsd, 3);
  assert.deepEqual(result.topFile, { file: 'shared.js', share: 1 });
  assert.equal(result.filesOverLimit, 1); // shared.js: 2 runs, share 1 > SHARED_LIMIT (0.2)
  assert.equal(result.conflictRuns, 1);
  assert.equal(result.conflictShare, 0.25);
  assert.equal(Math.round(result.conflictCostShare * 1000) / 1000, Math.round((2 / 3) * 1000) / 1000);
  assert.equal(result.peak, 2); // pa and pb overlap; rc/ro are on a different day and never overlap

  assert.deepEqual(result.files, [{ file: 'shared.js', runs: 2, share: 1, lines: 2, generated: false }]);

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].runId, 'rc');
  assert.equal(result.conflicts[0].via, 'resolve_merge');
  assert.deepEqual(result.conflicts[0].files, ['shared.js']);
  assert.equal(result.conflicts[0].costUsd, 2);

  // the marker splits the runs by startedAt: rc/ro are well before it, pa/pb well after, in any time zone
  assert.equal(result.compare.marker, '2026-09-29');
  assert.equal(result.compare.commit, null);
  assert.equal(result.compare.before.runs, 2);
  assert.equal(result.compare.before.conflictRuns, 1);
  assert.equal(result.compare.before.peak, 1);
  assert.equal(result.compare.after.runs, 2);
  assert.equal(result.compare.after.runsWithCommits, 0);
  assert.equal(result.compare.after.conflictRuns, 0);
  assert.equal(result.compare.after.peak, 2);
});

test('repositoryPerformance: no runs with commits and no conflicts is reported as empty', async (t) => {
  const repo = tmpRepo(t);
  commit(repo, 'init.txt', 'init\n');
  const result = await repositoryPerformance({ runs: [], repo, store: fakeStore(), from: '2026-09-01', to: '2026-10-01' });
  assert.equal(result.empty, true);
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.conflicts, []);
});

test('repositoryPerformance: a marker that is neither a date nor a commit of the repository reports an error, not a crash', async (t) => {
  const repo = tmpRepo(t);
  commit(repo, 'init.txt', 'init\n');
  const result = await repositoryPerformance({ runs: [], repo, store: fakeStore(), from: '2026-09-01', to: '2026-10-01', marker: 'not-a-real-commit-or-date' });
  assert.match(result.compare.error, /neither a date.*nor a commit/);
});

test('repositoryPerformance: a mock run is left out even when it falls in the range', async (t) => {
  const repo = tmpRepo(t);
  commit(repo, 'init.txt', 'init\n');
  const mockRun = { runId: 'm', mock: true, status: 'success', startedAt: '2026-09-28T08:00:00Z', finishedAt: '2026-09-28T08:05:00Z', costUsd: 5, localMerge: null, pr: null, resumedFrom: null, runDir: null };
  const result = await repositoryPerformance({ runs: [mockRun], repo, store: fakeStore(), from: '2026-09-01', to: '2026-10-01' });
  assert.equal(result.runs, 0);
  assert.equal(result.costUsd, 0);
});
