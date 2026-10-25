// #69 (merge conflicts at approve_merge: re-check before merging and go back in the flow), through
// mock runs of workflows/software-development.yaml: the recovery path after approve_merge /
// merge_failed. Split from test/merge-recovery.test.js (#305).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = process.env.MULTIAGENT_MOCK_DELAY_SCALE || '0.05';
const root = path.join(__dirname, '..', '..', '..', '..');
const SOFTWARE_DEV = path.join(root, 'workflows', 'software-development.yaml');

// ---- #69: workflows/software-development.yaml, the recovery path around approve_merge ----------

// Runs the real software-development workflow; gates get `answers[step]` (default: approve /
// first choice). `patchAgent` can replace a step's answer, as in runLocalHero.
async function runSoftwareDev(t, { mockSequences, answers = {}, patchAgent } = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: SOFTWARE_DEV, inputs: { task: 'Engine test', repo_path: root },
    mock: true, runsDir, mockSequences: { preview_status: ['success'], ...mockSequences },
  });
  if (patchAgent) {
    const original = run.sendToAgent.bind(run);
    run.sendToAgent = (agentName, prompt, opts) => patchAgent(agentName, prompt, opts, original);
  }
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const answer = ev.step_id in answers ? answers[ev.step_id] : ev.choices ? ev.choices[0].id : true;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer));
    }
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const prompt = (step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step).map((e) => e.prompt);
  return { run, events, finished, transitions, prompt };
}

const sinceApprove = (transitions) => transitions.slice(transitions.findIndex((x) => x.startsWith('deploy_test>')));

test('software-development: approve_merge shows the PR state and when it was checked, and says it checks again on approval', { timeout: 180000 }, async (t) => {
  const { finished, events } = await runSoftwareDev(t, {
    mockSequences: { behaviour_changed: [false] }, // no conflict: the default probe state is "passed"
  });
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'approve_merge');
  assert.match(gate.message, /CI green and mergeable \(\(simulated\) pr_mergeable: passed\)/);
  assert.match(gate.message, /checked at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.match(gate.message, /It is checked again when you approve/);
});

test('software-development: a conflict found right before approve_merge opens recovers through resolve_conflict, then asks for approval again', { timeout: 180000 }, async (t) => {
  const { finished, transitions, prompt, events } = await runSoftwareDev(t, {
    mockSequences: { probes: { 'approve_merge:check': ['conflict', 'passed'] }, blocked: [false], behaviour_changed: [false] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(sinceApprove(transitions), [
    'deploy_test>approve_merge', 'approve_merge>resolve_conflict', 'resolve_conflict>code_review',
    'code_review>test', 'test>suite', 'suite>ci', 'ci>pr_babysitter', 'pr_babysitter>deploy_test', 'deploy_test>approve_merge', 'approve_merge>deploy_prod',
    'deploy_prod>deploy_prod', 'deploy_prod>end',
  ]);
  // never asked for approval on a PR/MR the check already found not mergeable
  assert.equal(events.filter((e) => e.type === 'approval.requested' && e.step_id === 'approve_merge').length, 1);
  assert.ok(events.some((e) => e.type === 'supervisor.started' && e.kind === 'action_error' && e.step_id === 'approve_merge'));
  const decision = events.find((e) => e.type === 'supervisor.decision' && e.kind === 'action_error');
  assert.deepEqual([decision.action, decision.goto], ['goto', 'resolve_conflict']);

  const resolvePrompt = prompt('resolve_conflict').at(-1);
  assert.match(resolvePrompt, /was not merged into `main`/);
  assert.match(resolvePrompt, /State checked by the orchestrator at .*: conflict/);
  assert.match(resolvePrompt, /git merge origin\/main/);

  const scopedReview = prompt('code_review').at(-1);
  assert.match(scopedReview, /Review the RESOLUTION of a merge conflict on branch/);
  assert.match(scopedReview, /git show --remerge-diff \(simulated\) merge_commit/);
  assert.match(scopedReview, /git log --oneline \(simulated\) merge_commit\.\./);
  assert.doesNotMatch(scopedReview, /This run implements/);

  const scopedTest = prompt('test').at(-1);
  assert.match(scopedTest, /Your tests already passed on this change/);
  assert.match(scopedTest, /Check out the branch \(pull it: the developer pushed\) and run the tests of the files the\s+resolution touched \(the orchestrator runs the whole suite\s+next\)/);
  assert.doesNotMatch(scopedTest, /Write the tests the change needs/);

  // the second approval shows the branch changed since the last one
  const secondGate = events.filter((e) => e.type === 'approval.requested' && e.step_id === 'approve_merge').at(-1);
  assert.match(secondGate.message, /The branch changed after your last approval: a merge conflict with main was resolved/);

  // deploy_test retriggers the preview publication (it was reached via pr_babysitter, not straight after itself)
  const deployPrompts = prompt('deploy_test');
  assert.match(deployPrompts.at(-1), /Trigger the preview publication/);
});

test('software-development: the merge action itself failing (not the check) still recovers, never ends the run as failed', { timeout: 180000 }, async (t) => {
  const { finished, transitions, events } = await runSoftwareDev(t, {
    mockSequences: { action_errors: { approve_merge: 1 }, blocked: [false], behaviour_changed: [false] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(sinceApprove(transitions), [
    'deploy_test>approve_merge', 'approve_merge>resolve_conflict', 'resolve_conflict>code_review',
    'code_review>test', 'test>suite', 'suite>ci', 'ci>pr_babysitter', 'pr_babysitter>deploy_test', 'deploy_test>approve_merge', 'approve_merge>deploy_prod',
    'deploy_prod>deploy_prod', 'deploy_prod>end',
  ]);
  assert.equal(events.filter((e) => e.type === 'approval.requested' && e.step_id === 'approve_merge').length, 2, 'approved once, the merge failed, approved again after the resolution');
  assert.ok(!events.some((e) => e.type === 'log' && /ended as failed/.test(e.message)));
});

test('software-development: 2 resolution rounds that stay conflicted reach the merge_failed gate, never merged automatically', { timeout: 180000 }, async (t) => {
  const { finished, transitions, events } = await runSoftwareDev(t, {
    mockSequences: { probes: { 'approve_merge:check': ['conflict'] }, blocked: [false], behaviour_changed: [false] },
    answers: { merge_failed: 'stop' },
  });
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /ended as failed at step "merge_failed"/);
  assert.equal(sinceApprove(transitions).filter((x) => x === 'resolve_conflict>code_review').length, 2, 'max_visits: 2 on resolve_conflict');
  assert.ok(sinceApprove(transitions).slice(-2).includes('resolve_conflict>merge_failed'));
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'merge_failed');
  assert.deepEqual(gate.choices.map((c) => c.id), ['retry', 'resolve', 'stop']);
});
