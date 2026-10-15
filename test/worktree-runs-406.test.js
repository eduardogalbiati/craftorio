// #406 worktreeRuns (src/engine/worktree.js): the worktree folders each run works or worked in,
// [{ runId, dirs, live }], read from the run folders as the engine leaves them. The stray check reads
// it every minute, so an ended run's dirs are kept between reads: a summary.json rewritten later
// (the cleanup's worktree.removed, #202) must be read again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { worktreeRuns, samePath } = require('../src/engine/worktree');

const A = '20261015-114050-aaaaaaaa';
const B = '20261015-131216-bbbbbbbb';

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-runs-406-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runsDir = path.join(dir, 'runs');
  const worktreesDir = path.join(dir, 'worktrees');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.mkdirSync(worktreesDir, { recursive: true });
  return { runsDir, worktreesDir };
}

const writeEvents = (runDir, events) => {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
};
const writeSummary = (runDir, summary, mtimeMs) => {
  const file = path.join(runDir, 'summary.json');
  fs.writeFileSync(file, JSON.stringify(summary));
  if (mtimeMs) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
};
const runOf = (list, id) => list.find((r) => r.runId === id);
const has = (dirs, dir) => dirs.some((d) => samePath(d, dir));

test('#406 worktreeRuns: an ended run lists its summary\'s worktree, and a rewritten summary is read again', (t) => {
  const { runsDir, worktreesDir } = scratch(t);
  const wtA = path.join(worktreesDir, A);
  const other = path.join(worktreesDir, 'elsewhere');
  const runDir = path.join(runsDir, A);
  writeEvents(runDir, [{ type: 'workflow.started', run_id: A }]);
  writeSummary(runDir, { run_id: A, status: 'failed', worktree: { dir: wtA, branch: 'fix' } }, Date.parse('2026-10-15T12:00:00Z'));

  const first = runOf(worktreeRuns(runsDir, worktreesDir), A);
  assert.equal(first?.live, false);
  assert.equal(has(first.dirs, wtA), true);

  // the cleanup marks the worktree removed: the folder is still the run's
  writeSummary(runDir, { run_id: A, status: 'failed', worktree: { dir: wtA, branch: 'fix', removed: true } }, Date.parse('2026-10-15T13:00:00Z'));
  assert.equal(has(runOf(worktreeRuns(runsDir, worktreesDir), A).dirs, wtA), true, 'after the cleanup rewrite');

  // a summary that names another folder: the cached dirs are not reused
  writeSummary(runDir, { run_id: A, status: 'failed', worktree: { dir: other } }, Date.parse('2026-10-15T14:00:00Z'));
  const after = runOf(worktreeRuns(runsDir, worktreesDir), A);
  assert.equal(has(after.dirs, other), true, 'the rewritten summary is read');
  assert.equal(has(after.dirs, wtA), false, 'the old dirs are gone');
});

test('#406 worktreeRuns: a live resumed run lists the folder it resumes into, before and after its worktree.ready', (t) => {
  const { runsDir, worktreesDir } = scratch(t);
  const wtA = path.join(worktreesDir, A);
  const runDir = path.join(runsDir, B);
  writeEvents(runDir, [{ type: 'workflow.started', run_id: B, resumed_from: { run_id: A, step: 'develop' } }]);
  fs.writeFileSync(path.join(runDir, 'owner.json'), JSON.stringify({ pid: process.ppid, host: os.hostname(), started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() }));

  const before = runOf(worktreeRuns(runsDir, worktreesDir), B);
  assert.equal(before?.live, true);
  assert.equal(has(before.dirs, wtA), true, 'claimed from workflow.started');

  fs.appendFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ type: 'worktree.ready', dir: wtA, work_dir: wtA, reused: true })}\n`);
  const live = worktreeRuns(runsDir, worktreesDir, { liveOnly: true });
  assert.deepEqual(live.map((r) => r.runId), [B]);
  assert.equal(has(live[0].dirs, wtA), true);
});

test('#406 worktreeRuns: liveOnly leaves out ended runs and since leaves out older runs', (t) => {
  const { runsDir, worktreesDir } = scratch(t);
  const wtA = path.join(worktreesDir, A);
  writeEvents(path.join(runsDir, A), [{ type: 'workflow.started', run_id: A }]);
  writeSummary(path.join(runsDir, A), { run_id: A, status: 'success', worktree: { dir: wtA } });
  writeEvents(path.join(runsDir, B), [{ type: 'workflow.started', run_id: B, resumed_from: { run_id: A, step: 'develop' } }]);
  writeSummary(path.join(runsDir, B), { run_id: B, status: 'failed', worktree: { dir: wtA } });

  assert.deepEqual(worktreeRuns(runsDir, worktreesDir, { liveOnly: true }), []);
  assert.deepEqual(worktreeRuns(runsDir, worktreesDir).map((r) => r.runId).sort(), [A, B]);
  assert.deepEqual(worktreeRuns(runsDir, worktreesDir, { since: B }).map((r) => r.runId), [B]);
});

test('#406 worktreeRuns: a missing runs folder gives no runs', () => {
  assert.deepEqual(worktreeRuns(path.join(os.tmpdir(), 'wt-runs-406-none', 'runs'), path.join(os.tmpdir(), 'wt-runs-406-none', 'worktrees')), []);
});
