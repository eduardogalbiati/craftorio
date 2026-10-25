// #403: each suite round (and each E2E round) tests the run's change on top of the current local
// base. Mock runs of test/fixtures/suite-base-sync-403.yaml in throwaway repositories (remote: false):
// - a commit that lands on the local base while the run goes on (here, right after `work`) is in
//   the tree the next suite round tests, and in the next E2E round's; the round says which base
//   commit it tested on (its output's base_commit and a log line);
// - a base that does not apply cleanly leaves the round on the branch as it is, and says so;
// - the next agent turn is told the branch moved (the base commit it got);
// - a run resumed from `suite` gets the base before its first round;
// - the base itself is never modified and nothing is pushed.
// Seams: WorkflowRun's events (step.finished output, log, session.message_sent) and the git repos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');
const { Recorder } = require('../../engine/recorder');
const supervisor = require('../../domains/supervisor/supervisor');
const { fixture, git, commit } = require('../worktree-helpers');

const FILE = path.join(__dirname, '..', 'fixtures', 'suite-base-sync-403.yaml');

// onEvent(ev, run): sees every event first; returning true leaves a gate unanswered
async function runFixture({ repo, worktreesDir, runsDir, resume, onEvent }) {
  const run = new WorkflowRun({ file: FILE, inputs: { repo_path: repo }, mock: true, runsDir, worktreesDir, resume });
  const rec = new Recorder(run.runDir); // events.jsonl: what a resume reads
  const events = [];
  run.on('event', (ev) => {
    rec.write(ev);
    events.push(ev);
    if (onEvent && onEvent(ev, run)) return;
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  await run.start();
  return { run, events, finished: events.find((e) => e.type === 'workflow.finished') };
}

const finishedOf = (events, stepId) => events.filter((e) => e.type === 'step.finished' && e.step_id === stepId).map((e) => e.output);
const isAncestor = (repo, a, b) => {
  try { git(repo, 'merge-base', '--is-ancestor', a, b); return true; } catch { return false; }
};
const logs = (events) => events.filter((e) => e.type === 'log').map((e) => String(e.message || ''));

test('#403 a commit that lands on the local base during the run is in the tree the next suite and E2E rounds test, and the rounds name the base commit', { timeout: 90000 }, async (t) => {
  const f = fixture(t);
  const originMain = git(f.origin, 'rev-parse', 'refs/heads/main');
  let workDir = null;
  let fix = null;
  let late = null;
  const r = await runFixture({
    repo: f.repo, worktreesDir: f.worktrees, runsDir: path.join(f.tmp, 'runs'),
    onEvent: (ev) => {
      if (ev.type === 'worktree.ready') workDir = ev.work_dir || ev.dir;
      // the run's change, and a fix that lands on the local base meanwhile (another file)
      if (ev.type === 'step.finished' && ev.step_id === 'work') {
        commit(workDir, 'feature.txt', 'feature\n', 'the run\'s change');
        fix = commit(f.repo, 'fix.txt', 'fixed\n', 'fix the failing test on main');
      }
      // another base commit between the unit round and the E2E round
      if (ev.type === 'step.finished' && ev.step_id === 'suite') late = commit(f.repo, 'late.txt', 'late\n', 'a later fix on main');
      return false;
    },
  });
  assert.equal(r.finished.status, 'success', r.finished.error);
  const [suite] = finishedOf(r.events, 'suite');
  assert.ok(suite?.commit, `the suite round says what it tested: ${JSON.stringify(suite)}`);
  assert.equal(isAncestor(f.repo, fix, suite.commit), true, 'the suite round tested the change on top of the base fix');
  assert.equal(suite.base_commit, fix, 'the suite round names the base commit it tested on');
  assert.equal(logs(r.events).some((m) => m.includes(fix.slice(0, 7))), true, 'a log line names the base commit');
  assert.ok(suite.log, 'the round has a log');
  assert.match(fs.readFileSync(path.join(r.run.runDir, suite.log), 'utf8'), new RegExp(`^# base: tested on top of ${fix}$`, 'm'),
    'the round\'s log says which base commit it tested on');
  const [e2e] = finishedOf(r.events, 'e2e');
  assert.ok(e2e?.commit, `the E2E round says what it tested: ${JSON.stringify(e2e)}`);
  assert.equal(isAncestor(f.repo, late, e2e.commit), true, 'the E2E round brought the later base commit in too');
  assert.equal(e2e.base_commit, late);
  // the change is still on the branch, on top of the base
  assert.equal(git(f.repo, 'show', `${e2e.commit}:feature.txt`), 'feature');
  // the base itself is never modified, nothing is pushed
  assert.equal(git(f.repo, 'rev-parse', 'refs/heads/main'), late, 'the local base is where its own commits left it');
  assert.equal(git(f.origin, 'rev-parse', 'refs/heads/main'), originMain, 'nothing is pushed');
});

test('#403 the next agent turn after a round that brought the base in is told the branch moved', { timeout: 90000 }, async (t) => {
  const f = fixture(t);
  let workDir = null;
  let fix = null;
  const r = await runFixture({
    repo: f.repo, worktreesDir: f.worktrees, runsDir: path.join(f.tmp, 'runs'),
    onEvent: (ev) => {
      if (ev.type === 'worktree.ready') workDir = ev.work_dir || ev.dir;
      if (ev.type === 'step.finished' && ev.step_id === 'work') {
        commit(workDir, 'feature.txt', 'feature\n', 'the run\'s change');
        fix = commit(f.repo, 'fix.txt', 'fixed\n', 'fix the failing test on main');
      }
      return false;
    },
  });
  assert.equal(r.finished.status, 'success', r.finished.error);
  const after = r.events.find((e) => e.type === 'session.message_sent' && e.step_id === 'after_suite');
  assert.ok(after, 'the developer runs after the suite');
  const prompt = String(after.prompt || '');
  assert.equal(prompt.includes(fix.slice(0, 7)) || prompt.includes('fix the failing test on main'), true,
    `the developer's prompt names the base commit the branch got: ${prompt.slice(-1500)}`);
});

test('#403 a base that conflicts with the branch leaves the round on the branch as it is, and the round says so', { timeout: 90000 }, async (t) => {
  const f = fixture(t);
  let workDir = null;
  let head = null;
  let conflicting = null;
  const r = await runFixture({
    repo: f.repo, worktreesDir: f.worktrees, runsDir: path.join(f.tmp, 'runs'),
    onEvent: (ev) => {
      if (ev.type === 'worktree.ready') workDir = ev.work_dir || ev.dir;
      // the branch and the base change the same line of a.txt
      if (ev.type === 'step.finished' && ev.step_id === 'work') {
        head = commit(workDir, 'a.txt', 'branch\n', 'the run\'s change to a.txt');
        conflicting = commit(f.repo, 'a.txt', 'base\n', 'a conflicting change on main');
      }
      return false;
    },
  });
  const [suite] = finishedOf(r.events, 'suite');
  assert.ok(suite, 'the suite round still runs');
  assert.notEqual(suite.status, 'blocked', `the conflict does not block the round: ${suite.message}`);
  assert.equal(suite.commit, head, 'the round tested the branch as it was');
  assert.match(String(suite.message || ''), /conflict/i, 'the round\'s message says the base did not apply');
  assert.equal(logs(r.events).some((m) => /conflict/i.test(m)), true, 'a log line says so');
  assert.equal(git(f.repo, 'rev-parse', 'refs/heads/main'), conflicting, 'the base itself is not modified');
  assert.equal(isAncestor(f.repo, conflicting, suite.commit), false);
});

test('#403 a rebase git refuses without a conflict (a pre-rebase hook) leaves the round on the branch as it is, with git\'s message', { timeout: 90000 }, async (t) => {
  const f = fixture(t);
  // the hooks folder is shared by the repository's worktrees
  const hooks = path.resolve(f.repo, git(f.repo, 'rev-parse', '--git-path', 'hooks'));
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(path.join(hooks, 'pre-rebase'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  let workDir = null;
  let head = null;
  let fix = null;
  const r = await runFixture({
    repo: f.repo, worktreesDir: f.worktrees, runsDir: path.join(f.tmp, 'runs'),
    onEvent: (ev) => {
      if (ev.type === 'worktree.ready') workDir = ev.work_dir || ev.dir;
      if (ev.type === 'step.finished' && ev.step_id === 'work') {
        head = commit(workDir, 'feature.txt', 'feature\n', 'the run\'s change');
        fix = commit(f.repo, 'fix.txt', 'fixed\n', 'fix the failing test on main');
      }
      return false;
    },
  });
  const [suite] = finishedOf(r.events, 'suite');
  assert.ok(suite, 'the suite round still runs');
  assert.notEqual(suite.status, 'blocked', `a refused rebase does not block the round: ${suite.message}`);
  assert.equal(suite.commit, head, 'the round tested the branch as it was');
  assert.match(String(suite.message || ''), /not brought in: the rebase failed: .*pre-rebase hook refused/i, 'the round\'s message says why');
  assert.equal(logs(r.events).some((m) => /pre-rebase hook refused/i.test(m)), true, 'a log line says so');
  assert.equal(isAncestor(f.repo, fix, suite.commit), false);
  assert.equal(git(f.repo, 'rev-parse', 'refs/heads/main'), fix, 'the base itself is not modified');
});

test('#403 a run resumed from the suite gets the base before its first round', { timeout: 90000 }, async (t) => {
  const f = fixture(t);
  const runsDir = path.join(f.tmp, 'runs');
  let workDir = null;
  const first = await runFixture({
    repo: f.repo, worktreesDir: f.worktrees, runsDir,
    onEvent: (ev, run) => {
      if (ev.type === 'worktree.ready') workDir = ev.work_dir || ev.dir;
      if (ev.type === 'step.finished' && ev.step_id === 'work') commit(workDir, 'feature.txt', 'feature\n', 'the run\'s change');
      if (ev.type !== 'approval.requested') return false;
      setImmediate(() => run.stop());
      return true;
    },
  });
  assert.equal(first.finished.status, 'cancelled');
  // a fix lands on the local base before the owner resumes the run
  const fix = commit(f.repo, 'fix.txt', 'fixed\n', 'fix the failing test on main');
  const spec = supervisor.resumeSpec(path.join(runsDir, first.run.runId), 'suite');
  const resumed = await runFixture({
    repo: f.repo, worktreesDir: f.worktrees, runsDir,
    resume: { runId: spec.runId, fromStep: 'suite', steps: spec.steps, sessions: spec.sessions, worktree: spec.worktree },
  });
  assert.equal(resumed.finished.status, 'success', resumed.finished.error);
  const [suite] = finishedOf(resumed.events, 'suite');
  assert.ok(suite?.commit, `the resumed suite round says what it tested: ${JSON.stringify(suite)}`);
  assert.equal(isAncestor(f.repo, fix, suite.commit), true, 'the resumed run\'s first round tested on top of the base fix');
  assert.equal(git(f.repo, 'show', `${suite.commit}:feature.txt`), 'feature', 'with the run\'s change');
  assert.equal(suite.base_commit, fix);
  assert.equal(git(f.repo, 'rev-parse', 'refs/heads/main'), fix, 'the base itself is not modified');
});
