// #807 a stacked run follows its parent (packages/engine/engine/run/transitions.js pollStep / pollParent, the
// ci step's wait.parent). Acceptance tests, written before the code, on the engine's methods with a fake run
// (as wait-parent-738.test.js) and a throwaway repository (test/worktree-helpers.js fixture).
//
// The interface these tests assume. A stacked run: inputs.parent_branch set and inputs.mode not 'fork' (its
// PR targets the parent's branch, so it does not wait for the parent's merge to open it):
// - parent PR still open: the engine rebases the branch onto origin/<parent_branch> when it moved
//   (worktree.js restackOnParent), then the step's own probe runs (no wait on the parent);
//   the rebase conflicts → the run stops at a gate (requestApproval) saying it could not rebase.
// - parent merged: the branch is rebased onto origin/<base> (restackOnBase, fork false), st.parentMerged,
//   and the agent's news says to move the PR's base to the project's base (`--base <base_branch>`).
// - parent closed without merge: the run does not go on to the agent: a gate (requestApproval) says the
//   parent was closed, its choices' ids include 'rebase_onto_base' and 'stop'.
// - Fork + PR (inputs.mode 'fork'): #738 as today (a closed parent calls the agent, no gate).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { commit, fixture, git } = require('./worktree-helpers');

const transitions = () => require('../engine/run/transitions');

const PARENT = 'https://github.com/acme/widgets/pull/7';
const OWN = 'https://github.com/acme/widgets/pull/9';
const step = { id: 'ci', wait: { parent: '{{inputs.parent_pr}}', probe: 'pr_checks', target: '{{output.pr_url}}' } };

// probe answers by target: the parent's PR and the run's own
function fakeRun({ parent, own = { state: 'pending', detail: 'checks running' }, inputs = {}, wt = null }) {
  const probes = [];
  const asked = [];
  const run = {
    ...transitions().methods,
    ctx: { inputs: { mode: 'remote', base_branch: 'main', parent_branch: 'parent-1', parent_pr: PARENT, ...inputs }, worktree_dir: wt?.dir || '' },
    worktree: wt,
    probeStats: {},
    abort: new AbortController(),
    emitEvent: () => {},
    probe: async ({ target }) => { probes.push(target); return target === PARENT ? parent : own; },
    requestApproval: async (s) => { asked.push(s); return { answer: 'stop' }; },
    loopWait: async (s) => s.id,
  };
  return { run, probes, asked };
}
const turn = () => ({ output: { pr_url: OWN }, iteration: 1 });
const poll = (run, st) => run.pollStep(step, st, Date.now()).catch((e) => e);

// the parent stage's branch on origin and the stacked run's worktree (child-2, one commit of its own)
function stacked(t) {
  const f = fixture(t, 'canonical');
  git(f.other, 'checkout', '-q', '-b', 'parent-1');
  commit(f.other, 'p.txt', 'p\n', 'the parent stage');
  git(f.other, 'push', '-q', 'origin', 'parent-1');
  git(f.repo, 'fetch', '-q', 'origin');
  const dir = path.join(f.worktrees, 'child');
  git(f.repo, 'worktree', 'add', '-q', '-b', 'child-2', dir, 'origin/parent-1');
  commit(dir, 'd.txt', 'd\n', 'the stacked stage');
  return { f, dir, wt: { repo: f.repo, dir, workDir: dir, base: 'main' } };
}

test('#807 parent still open with new commits: the stacked branch is rebased onto them and the own PR is checked', async (t) => {
  const { f, dir, wt } = stacked(t);
  const moved = commit(f.other, 'q.txt', 'q\n', 'the parent, after review');
  git(f.other, 'push', '-q', 'origin', 'parent-1');
  const { run, probes, asked } = fakeRun({ parent: { state: 'pending', detail: 'open' }, wt });
  await poll(run, turn());
  assert.deepEqual([git(dir, 'rev-parse', 'HEAD~1'), probes.includes(OWN), asked.length], [moved, true, 0]);
});

test('#807 parent\'s new commits conflict: the run says it could not rebase and stops at a gate', async (t) => {
  const { f, wt } = stacked(t);
  commit(f.other, 'd.txt', 'the parent wrote d too\n', 'the parent, conflicting');
  git(f.other, 'push', '-q', 'origin', 'parent-1');
  const { run, asked } = fakeRun({ parent: { state: 'pending', detail: 'open' }, wt });
  await poll(run, turn());
  assert.equal(asked.length, 1);
  assert.match(String(asked[0]?.message), /could not rebase|conflict/i);
});

test('#807 parent squash-merged: the stacked branch sits on origin/main and the agent moves its PR\'s base to main', async (t) => {
  const { f, dir, wt } = stacked(t);
  git(f.other, 'checkout', '-q', 'main');
  git(f.other, 'merge', '-q', '--squash', 'origin/parent-1');
  git(f.other, 'commit', '-q', '-m', 'The parent PR (squashed)');
  git(f.other, 'push', '-q', 'origin', 'main');
  const squashed = git(f.other, 'rev-parse', 'HEAD');
  const { run } = fakeRun({ parent: { state: 'merged', detail: 'merged' }, wt });
  const st = turn();
  await poll(run, st);
  assert.deepEqual([st.parentMerged, git(dir, 'rev-parse', 'HEAD~1')], [true, squashed]);
  assert.match(String(st.probeNews?.detail), /--base main\b/);
});

test('#807 parent closed without merge: the stacked run does not go on, a gate offers rebase onto the base or stop', async () => {
  const { run, asked } = fakeRun({ parent: { state: 'closed', detail: 'closed' } });
  await poll(run, turn());
  assert.equal(asked.length, 1);
  assert.match(String(asked[0]?.message), /closed/i);
  const ids = (asked[0]?.choices || []).map((c) => c.id);
  assert.deepEqual([ids.includes('rebase_onto_base'), ids.includes('stop'), run.probeStats.ci?.agent_calls ?? 0], [true, true, 0]);
});

// stackHold (the service reads it as a wait for the run's own merge, areas/roadmap.js mergeGateOf / parkedRun):
// the step's id while a stacked run whose own checks passed keeps following its open parent, else null
const passedStep = { ...step, wait: { ...step.wait, output: { ci_status: 'green' } } };
const pollPassed = (run, st) => run.pollStep(passedStep, st, Date.now()).catch((e) => e);
const PASSED = { state: 'passed', detail: 'all checks passed' };

test('#807 stackHold: a stacked run whose checks passed holds for its open parent (the step\'s id), without an agent turn', async () => {
  const { run } = fakeRun({ parent: { state: 'pending', detail: 'open' }, own: PASSED });
  const next = await pollPassed(run, turn());
  assert.deepEqual([run.stackHold, next, run.probeStats.ci?.agent_calls ?? 0], ['ci', 'ci', 0]);
});

test('#807 stackHold: cleared when the parent merges (the agent moves the PR\'s base)', async () => {
  const { run } = fakeRun({ parent: { state: 'merged', detail: 'merged' }, own: PASSED });
  run.stackHold = 'ci';
  await pollPassed(run, turn());
  assert.equal(run.stackHold, null);
});

test('#807 stackHold: cleared when the parent is closed without merge (the run asks at a gate)', async () => {
  const { run, asked } = fakeRun({ parent: { state: 'closed', detail: 'closed' }, own: PASSED });
  run.stackHold = 'ci';
  await pollPassed(run, turn());
  assert.deepEqual([run.stackHold, asked.length], [null, 1]);
});

test('#807 stackHold: cleared when the restack onto the parent\'s new commits conflicts', async (t) => {
  const { f, wt } = stacked(t);
  commit(f.other, 'd.txt', 'the parent wrote d too\n', 'the parent, conflicting');
  git(f.other, 'push', '-q', 'origin', 'parent-1');
  const { run, asked } = fakeRun({ parent: { state: 'pending', detail: 'open' }, own: PASSED, wt });
  run.stackHold = 'ci';
  await pollPassed(run, turn());
  assert.deepEqual([run.stackHold, asked.length], [null, 1]);
});

test('#807 stackHold: cleared after a restack onto the parent\'s new commits (an agent turn pushes the branch)', async (t) => {
  const { f, wt } = stacked(t);
  commit(f.other, 'q.txt', 'q\n', 'the parent, after review');
  git(f.other, 'push', '-q', 'origin', 'parent-1');
  const { run, asked } = fakeRun({ parent: { state: 'pending', detail: 'open' }, own: PASSED, wt });
  run.stackHold = 'ci';
  const st = turn();
  const next = await pollPassed(run, st);
  assert.deepEqual([run.stackHold, next, asked.length], [null, null, 0]);
  assert.match(String(st.probeNews?.detail), /rebased/);
});

test('#807 Fork + PR unchanged (#738): a closed parent calls the agent, no gate', async () => {
  const { run, asked } = fakeRun({ parent: { state: 'closed', detail: 'closed' }, inputs: { mode: 'fork' } });
  const st = turn();
  const next = await poll(run, st);
  assert.deepEqual([next, asked.length], [null, 0]);
  assert.match(String(st.probeNews?.detail), /closed/);
});
