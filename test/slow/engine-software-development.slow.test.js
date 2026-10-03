const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../../src/engine/workflow');
const evidence = require('../../src/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { root, runSoftwareDevelopment, GROUP } = require('../engine-helpers');

test('software-development: a preview code failure goes to the developer, then ci → pr_babysitter → preview again', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { preview_status: ['failed', 'success'], failure_class: ['code'] },
  });
  assert.equal(finished.status, 'success', finished.error);
  const i = transitions.indexOf('deploy_test>ci');
  assert.ok(i >= 0, transitions.join(' '));
  assert.deepEqual(transitions.slice(i, i + 4), ['deploy_test>ci', 'ci>pr_babysitter', 'pr_babysitter>deploy_test', 'deploy_test>approve_merge']);
  assert.ok(events.some((e) => e.type === 'log' && e.message === 'deploy_test delegated to developer'));
  // the developer's fix reaches the CI Pusher
  const ciPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'ci').map((e) => e.prompt);
  assert.match(ciPrompts.at(-1), /The developer fixed a previous failure/);
  assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'preview_failed'), 'no human gate for a fixable failure');
  assert.equal(finished.summary.steps.deploy_test.visits, 2);
});
test('software-development: preview code failures stop at the human gate after 2 fix rounds', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { preview_status: ['failed'], failure_class: ['code'] },
    answers: { preview_failed: 'stop' },
  });
  assert.equal(transitions.filter((x) => x === 'deploy_test>ci').length, 2);
  assert.equal(events.filter((e) => e.type === 'log' && e.message === 'deploy_test delegated to developer').length, 2, 'no fix is asked once the limit is reached');
  assert.ok(transitions.includes('deploy_test>preview_failed'));
  // stop: the run failed (it did not deliver), not a success
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /ended as failed at step "preview_failed"/);
});
test('software-development: a preview infra failure goes to the gate; "retry" publishes again', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { preview_status: ['failed', 'success'], failure_class: ['infra'] },
    answers: { preview_failed: 'retry' },
  });
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'preview_failed');
  assert.deepEqual(gate.choices.map((c) => c.id), ['retry', 'fix', 'stop']);
  assert.match(gate.message, /class: infra/);
  assert.ok(!transitions.includes('deploy_test>ci'), 'an infra failure is not sent to the developer');
  assert.deepEqual(transitions.filter((x) => /preview_failed|deploy_test>/.test(x)), ['deploy_test>preview_failed', 'preview_failed>deploy_test', 'deploy_test>approve_merge']);
});
test('software-development: an infra build failure skips the fix rounds; "retry" builds again', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { build_status: ['failed', 'success'], failure_class: ['infra'], preview_status: ['success'] },
    answers: { build_failed: 'retry' },
  });
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'build_failed');
  assert.deepEqual(gate.choices.map((c) => c.id), ['continue', 'retry', 'stop']);
  assert.match(gate.message, /because of the environment, not the code/);
  assert.ok(!events.some((e) => e.type === 'log' && e.message === 'build delegated to developer'), 'no developer round for an infra failure');
  assert.deepEqual(transitions.filter((x) => /build_failed|^build>/.test(x)), ['build>build_failed', 'build_failed>build', 'build>evidence']);
});
test('software-development: a code build failure still goes to the developer first', { timeout: 120000 }, async () => {
  const { events, transitions } = await runSoftwareDevelopment({
    mockSequences: { build_status: ['failed', 'success'], failure_class: ['code'], preview_status: ['success'] },
  });
  assert.ok(events.some((e) => e.type === 'log' && e.message === 'build delegated to developer'));
  assert.ok(!transitions.includes('build>build_failed'));
});
test('software-development: rejecting the merge ends the run as cancelled; deploy_prod never ran, so merged_commit is empty', { timeout: 120000 }, async () => {
  const { finished } = await runSoftwareDevelopment({ mockSequences: { preview_status: ['success'] }, answers: { approve_merge: false } });
  assert.equal(finished.status, 'cancelled');
  assert.match(finished.error, /ended as cancelled at step "approve_merge" \(rejected\)/);
  assert.equal(finished.summary.steps.deploy_prod.visits, 0);
  // the template renders empty (no steps.deploy_prod.output): computeOutputs keeps an empty text as
  // null, like any other output the run never set (#134: still falsy, blockedReason treats it the same).
  assert.equal(finished.summary.outputs.merged_commit, null);
});
// #134 (fixed by 3a5e236): the squash merge's commit the deployer reads from the platform, never the
// branch's own last commit (develop.output.commit_sha), which is not what the base branch received.
test('software-development: merged_commit is the deploy step\'s merge_commit, not the branch\'s own commit_sha', { timeout: 120000 }, async () => {
  const wf = loadWorkflow(path.join(root, 'workflows', 'software-development.yaml'));
  assert.deepEqual(wf.steps.find((s) => s.id === 'deploy_prod').output_schema.required, ['deploy_status', 'merge_commit']);

  const { finished } = await runSoftwareDevelopment({ mockSequences: { preview_status: ['success'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(finished.summary.outputs.merged_commit, finished.summary.steps.deploy_prod.output.merge_commit);
  assert.notEqual(finished.summary.outputs.merged_commit, finished.summary.steps.develop.output.commit_sha);
});
test('software-development: a run for several issues records them, and its PR/MR closes each one', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { preview_status: ['success'] }, issues: GROUP, inputs: { issues: GROUP.map((i) => i.url) },
  });
  assert.equal(finished.status, 'success', finished.error);
  const started = events.find((e) => e.type === 'workflow.started');
  assert.deepEqual(started.issues, GROUP);
  assert.deepEqual(finished.summary.issues, GROUP);
  assert.ok(!transitions.includes('develop>issue_not_done'), 'every issue was done');
  const prompt = (step) => events.find((e) => e.type === 'session.message_sent' && e.step_id === step).prompt;
  assert.match(prompt('develop'), /This run implements 3 issues together[\s\S]*issues\/53, https:\/\/github\.com\/o\/r\/issues\/65, https:\/\/github\.com\/o\/r\/issues\/77/);
  assert.match(prompt('code_review'), /check the spec axis per issue/);
  assert.match(prompt('verify_change'), /verify each one the developer did/);
  assert.match(prompt('ci'), /one line `Closes #<number>` per issue/);
});
test('software-development: an issue of the group that cannot be done stops at the owner\'s gate', { timeout: 120000 }, async () => {
  const group = { issues: GROUP, inputs: { issues: GROUP.map((i) => i.url).join('\n') } }; // a list typed in a form
  const stopped = await runSoftwareDevelopment({ ...group, mockSequences: { done: [false] }, answers: { issue_not_done: 'stop' } });
  const gate = stopped.events.find((e) => e.type === 'approval.requested' && e.step_id === 'issue_not_done');
  assert.deepEqual(gate.choices.map((c) => c.id), ['continue', 'stop']);
  assert.match(gate.message, /could not do every issue/);
  assert.equal(stopped.finished.status, 'failed');
  assert.deepEqual(stopped.events.find((e) => e.type === 'workflow.started').inputs.issues, GROUP.map((i) => i.url));

  // continue without it: asked once, even though later developer turns still report it
  const went = await runSoftwareDevelopment({ ...group, mockSequences: { done: [false], preview_status: ['success'], verdict: ['changes_requested', 'approved'] } });
  assert.equal(went.finished.status, 'success', went.finished.error);
  assert.deepEqual(went.transitions.filter((x) => /issue_not_done/.test(x)), ['develop>issue_not_done', 'issue_not_done>code_review']);
  assert.ok(went.transitions.filter((x) => x === 'code_review>develop').length >= 1);
  // a run for one issue never asks
  const single = await runSoftwareDevelopment({ mockSequences: { done: [false], preview_status: ['success'] }, issues: [GROUP[0]], inputs: { issue: GROUP[0].url } });
  assert.ok(!single.transitions.includes('develop>issue_not_done'));
});
test('#98: requirements_left_out is a human gate; neither a retry nor the supervisor can answer it', () => {
  for (const file of ['software-development.yaml', 'software-development-local-hero.yaml']) {
    const wf = loadWorkflow(path.join(root, 'workflows', file));
    const gate = wf.steps.find((s) => s.id === 'requirements_left_out');
    assert.equal(gate.type, 'human_approval', file);
    assert.deepEqual(gate.choices.map((c) => c.id), ['continue', 'stop'], file);
  }
});

for (const file of ['software-development.yaml', 'software-development-local-hero.yaml']) {
  // software-development also needs a successful preview to reach the end; local-hero has none
  const toEnd = file === 'software-development.yaml' ? { preview_status: ['success'] } : {};
  // only transitions where both ends are one of these three steps (hides the rest of the pipeline)
  const groupBy = (xs, re) => xs.filter((x) => re.test(x));
  const DEV_RE = /^(develop|requirements_left_out|code_review)>(develop|requirements_left_out|code_review)$/;

  test(`${file}: no declared gap goes straight develop > code_review`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({ file, mockSequences: { verdict: ['approved'], ...toEnd } });
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>code_review']);
    assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out'));
    // #160: the test writer's capabilities log line shows the Agent/Task tool is offered
    const log = events.find((e) => e.type === 'log' && e.kind === 'capabilities' && e.agent === 'test_writer');
    assert.match(log.message, /subagents: Agent\/Task tool offered/, file);
  });

  test(`${file}: a gap declared once sends the developer back before the review, never straight to code_review`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({ file, mockSequences: { left_out: [1, 0], verdict: ['approved'], ...toEnd } });
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>develop', 'develop>code_review']);
    assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out'));
  });

  test(`${file}: a gap still open after one round stops at the owner's gate; "stop" ends the run failed, no review`, { timeout: 120000 }, async () => {
    const { transitions, finished, events } = await runSoftwareDevelopment({
      file, mockSequences: { left_out: [1, 1], ...toEnd }, answers: { requirements_left_out: 'stop' },
    });
    const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out');
    assert.deepEqual(gate.choices.map((c) => c.id), ['continue', 'stop']);
    assert.match(gate.message, /left these requirements of the task out, even after being sent back once/);
    assert.equal(finished.status, 'failed');
    assert.match(finished.error, /ended as failed at step "requirements_left_out"/);
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>develop', 'develop>requirements_left_out']);
  });

  test(`${file}: "continue" at the gate moves on to the review`, { timeout: 120000 }, async () => {
    const { transitions, finished } = await runSoftwareDevelopment({
      file, mockSequences: { left_out: [1, 1, 0], verdict: ['approved'], ...toEnd }, answers: { requirements_left_out: 'continue' },
    });
    assert.equal(finished.status, 'success', finished.error);
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>develop', 'develop>requirements_left_out', 'requirements_left_out>code_review']);
  });

  test(`${file}: a gap declared again on a review fix round goes back to the gate, not straight to the review`, { timeout: 120000 }, async () => {
    const { transitions, finished, events } = await runSoftwareDevelopment({
      file,
      mockSequences: { left_out: [1, 1, 1, 0], verdict: ['changes_requested', 'approved'], ...toEnd },
      answers: { requirements_left_out: 'continue' },
    });
    assert.equal(finished.status, 'success', finished.error);
    const gates = events.filter((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out');
    assert.equal(gates.length, 2, transitions.join(' '));
    assert.ok(!transitions.includes('develop>code_review'), transitions.join(' '));
    assert.deepEqual(groupBy(transitions, DEV_RE), [
      'develop>develop', 'develop>requirements_left_out', 'requirements_left_out>code_review',
      'code_review>develop', 'develop>requirements_left_out', 'requirements_left_out>code_review',
    ]);
    // vars.accepted_gaps accumulates across both gate answers instead of being overwritten: both
    // accepted requirements show up (not just the latest one) by the second code_review visit
    const developPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => e.prompt);
    assert.match(developPrompts[2], /do not list them again: \(simulated\) requirement;/);
    const reviewPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'code_review').map((e) => e.prompt);
    const accepted = reviewPrompts[1].match(/accepted that the run goes on without these requirements \(not blocking\): (.*)/)[1];
    assert.equal((accepted.match(/\(simulated\) requirement/g) || []).length, 2, accepted);
    // the two accepted requirements must stay distinguishable, not run together into one word
    assert.match(accepted, /requirement;\s+\(simulated\) requirement;|requirement,\s*\(simulated\) requirement;/, accepted);
  });

  // #173: the issue's Tests and Measure tasks are never the developer's, so declaring only those
  // (mockSequences.left_out_not_mine) never sends the run back nor stops it at the human gate.
  test(`${file}: declaring only the Tests and Measure tasks never returns to develop nor opens the gate`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({ file, mockSequences: { left_out_not_mine: true, verdict: ['approved'], ...toEnd } });
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>code_review']);
    assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out'));
  });

  test(`${file}: a real gap still returns to develop and reaches the gate even with Tests/Measure also declared`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({
      file, mockSequences: { left_out: [1], left_out_not_mine: true, verdict: ['approved'], ...toEnd }, answers: { requirements_left_out: 'continue' },
    });
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>develop', 'develop>requirements_left_out', 'requirements_left_out>code_review']);
    const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out');
    assert.match(gate.message, /\(simulated\) requirement/);
    assert.ok(!/Tests|Measure/.test(gate.message), gate.message);
    const reviewPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'code_review').map((e) => e.prompt);
    const accepted = reviewPrompts.at(-1).match(/accepted that the run goes on without these requirements \(not blocking\): (.*)/)[1];
    assert.match(accepted, /\(simulated\) requirement/);
    assert.ok(!/Tests|Measure/.test(accepted), accepted);
  });

  test(`${file}: Tests/Measure never count toward the second visit's gap either, so a 2nd clean visit goes straight to the review`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({ file, mockSequences: { left_out: [1, 0], left_out_not_mine: true, verdict: ['approved'], ...toEnd } });
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>develop', 'develop>code_review']);
    assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out'));
    const developPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => e.prompt);
    const listed = developPrompts[1].match(/so the review was not called:\n([\s\S]*?)\nFinish them/)[1];
    assert.match(listed, /\(simulated\) requirement/, listed);
    assert.ok(!/Tests|Measure/.test(listed), listed);
  });
}
// ---- #104: validated mode (mode input, developer_check gate) ------------------------------

test('software-development: validated mode stops at developer_check with the diff and worktree details; auto mode (the default) skips it', { timeout: 120000 }, async () => {
  const validated = await runSoftwareDevelopment({ inputs: { mode: 'validated' }, mockSequences: { preview_status: ['success'] } });
  assert.equal(validated.finished.status, 'success', validated.finished.error);
  // recorded on the run (Details): workflow.started carries every input, mode included
  assert.equal(validated.events.find((e) => e.type === 'workflow.started').inputs.mode, 'validated');
  const gate = validated.events.find((e) => e.type === 'approval.requested' && e.step_id === 'developer_check');
  assert.ok(gate, validated.transitions.join(' '));
  assert.equal(gate.diff_base, 'origin/main');
  assert.equal(gate.work_dir, root);
  assert.deepEqual(gate.choices.map((c) => c.id), ['approve', 'changes', 'stop']);
  assert.match(gate.message, /Try it before the review and the tests run/);
  assert.match(gate.message, /Files changed:/);
  // E2E scenarios (#143): the Dev/QA line is always there; the test step has not run yet here
  assert.match(gate.message, /Dev\/QA: read the E2E scenarios and the screenshots/);
  // #203: e2e_tests defaults to "write" (not "write_and_run"), so the test writer only writes them
  assert.match(gate.message, /E2E scenarios: none yet\. The test writer writes them after the code review; they show at the merge approval\./);
  assert.match(gate.feedback.label, /Your change request for the developer/);
  assert.deepEqual(validated.transitions.filter((x) => /developer_check|developer_screenshots/.test(x)), [
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>code_review',
  ]);

  const auto = await runSoftwareDevelopment({ mockSequences: { preview_status: ['success'] } }); // mode defaults to "auto"
  assert.equal(auto.finished.status, 'success', auto.finished.error);
  assert.ok(!auto.events.some((e) => e.type === 'approval.requested' && e.step_id === 'developer_check'));
  assert.ok(auto.transitions.includes('develop>code_review'));
});
test('software-development: approve_merge\'s message shows the Dev/QA line and the test writer\'s E2E scenarios (#143)', { timeout: 120000 }, async () => {
  const { events, finished } = await runSoftwareDevelopment({ mockSequences: { preview_status: ['success'] } });
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'approve_merge');
  assert.ok(gate);
  assert.match(gate.message, /Dev\/QA: read the E2E scenarios and the screenshots/);
  // the test step's schema has no `passed` status (#199): the default mock scenarios
  // (src/engine/providers.js mockScenarios) are written, not run, whatever the visit
  assert.match(gate.message, /E2E scenarios \(written by the test writer, run at release\): 2 written, run at release/);
  assert.match(gate.message, /- written, run at release: Filter the runs by status/);
  assert.match(gate.message, /- written, run at release: An empty filter result explains itself/);
});
test('software-development: validated mode — Ask for changes sends the feedback to the developer and reopens developer_check; Approve then moves on to code_review', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    inputs: { mode: 'validated' },
    mockSequences: { preview_status: ['success'], verdict: ['approved'] },
    answers: { developer_check: ['changes', 'approve'] },
    feedback: { developer_check: ['Use snake_case for the new function.'] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.filter((x) => /developer_check|developer_screenshots/.test(x)), [
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>develop',
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>code_review',
  ]);
  const gates = events.filter((e) => e.type === 'approval.requested' && e.step_id === 'developer_check');
  assert.equal(gates.length, 2);
  assert.match(gates[1].message, /your change request 1/);
  const resolved = events.filter((e) => e.type === 'approval.resolved' && e.feedback);
  assert.equal(resolved[0].feedback, 'Use snake_case for the new function.');
  const developPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => e.prompt);
  assert.match(developPrompts[1], /The owner tried your change and asks for these changes \(change request 1\):/);
  assert.match(developPrompts[1], /Use snake_case for the new function\./);
});
test('software-development: validated mode — a review fix round does not reopen developer_check; validate_every_round makes it stop again', { timeout: 120000 }, async () => {
  const once = await runSoftwareDevelopment({
    inputs: { mode: 'validated' },
    mockSequences: { preview_status: ['success'], verdict: ['changes_requested', 'approved'] },
  });
  assert.equal(once.finished.status, 'success', once.finished.error);
  assert.deepEqual(once.transitions.filter((x) => /developer_check|developer_screenshots/.test(x)), [
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>code_review',
  ]);
  assert.ok(once.transitions.includes('code_review>develop'));
  assert.equal(once.transitions.filter((x) => x === 'develop>code_review').length, 1, once.transitions.join(' '));

  const every = await runSoftwareDevelopment({
    inputs: { mode: 'validated', validate_every_round: 'true' },
    mockSequences: { preview_status: ['success'], verdict: ['changes_requested', 'approved'] },
  });
  assert.equal(every.finished.status, 'success', every.finished.error);
  assert.deepEqual(every.transitions.filter((x) => /developer_check|developer_screenshots/.test(x)), [
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>code_review',
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>code_review',
  ]);
});
test('software-development: validated mode — Stop ends the run as cancelled, the worktree kept to resume', { timeout: 120000 }, async () => {
  const { finished, transitions } = await runSoftwareDevelopment({
    inputs: { mode: 'validated' }, mockSequences: { preview_status: ['success'] }, answers: { developer_check: 'stop' },
  });
  assert.equal(finished.status, 'cancelled');
  assert.match(finished.error, /ended as cancelled at step "developer_check"/);
  assert.ok(!transitions.includes('developer_check>code_review'));
});
// #144: developer_screenshots, right before developer_check, runs the develop step's `screenshots`
// list through captureScreenshots (src/engine/screenshot-step.js). A mock run never captures: its
// output says so (reason), and developer_check's message shows it.
test('software-development: developer_screenshots captures the developer\'s UI list as simulated in a mock run, reported at developer_check', { timeout: 120000 }, async () => {
  const { events, finished } = await runSoftwareDevelopment({
    inputs: { mode: 'validated' }, mockSequences: { preview_status: ['success'] },
  });
  assert.equal(finished.status, 'success', finished.error);
  const step = events.find((e) => e.type === 'step.finished' && e.step_id === 'developer_screenshots');
  assert.ok(step, events.map((e) => e.type).join(' '));
  assert.equal(step.output.kind, 'screenshots');
  assert.equal(step.output.taken, 0);
  assert.deepEqual(step.output.errors, []);
  assert.match(step.output.reason, /simulated run \(the app is not captured\)/);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'developer_check');
  assert.match(gate.message, /Screenshots: No screenshots: simulated run \(the app is not captured\)/);
});
test('software-development: a failing suite goes back to the test writer once with the failures, then passes; summary.suite_runs counts the engine\'s runs', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['fail', 'pass'] } },
  });
  assert.equal(finished.status, 'success', finished.error);
  const i = transitions.indexOf('test>suite');
  assert.deepEqual(transitions.slice(i, i + 4), ['test>suite', 'suite>test', 'test>suite', 'suite>build'], transitions.join(' '));
  const testPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'test').map((e) => e.prompt);
  assert.equal(testPrompts.length, 2);
  assert.match(testPrompts[1], /The orchestrator ran the whole suite after your last step and it failed/);
  assert.match(testPrompts[1], /simulated failing test/);
  // scope: affected: the failing round and the passing one run the affected files (not the engine's whole
  // suite); the whole suite runs once, after the affected files first pass
  assert.deepEqual(finished.summary.suite_runs, { engine: 1, agents: 0, affected: 2 });
});
test('software-development: pre-existing suite failures never loop back to the test writer', { timeout: 120000 }, async () => {
  const { finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], preexisting_failures: true, suite: { suite: ['preexisting'] } },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.filter((x) => /^(test|suite)>/.test(x)), ['test>suite', 'suite>build']);
  assert.deepEqual(finished.summary.suite_runs, { engine: 1, agents: 0, affected: 1 });
});
test('software-development: a suite that cannot run (blocked) goes straight to test_failed', { timeout: 120000 }, async () => {
  const { finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { verdict: ['approved'], tests_status: ['pass'], suite: { suite: ['blocked'] } },
    answers: { test_failed: false },
  });
  assert.deepEqual(transitions.filter((x) => /^(test|suite)>/.test(x)), ['test>suite', 'suite>test_failed']);
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /ended as failed at step "test_failed"/);
});
test('software-development: a suite that keeps failing exhausts its 2 retries (3 rounds total) and stops at test_failed, with the failures in the gate message', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { verdict: ['approved'], tests_status: ['pass'], suite: { suite: ['fail'] } },
    answers: { test_failed: false },
  });
  assert.deepEqual(transitions.filter((x) => /^(test|suite)>/.test(x)), ['test>suite', 'suite>test', 'test>suite', 'suite>test', 'test>suite', 'suite>test_failed']);
  assert.equal(finished.status, 'failed');
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'test_failed');
  assert.match(gate.message, /still fails after 3 round/);
  assert.match(gate.message, /simulated failing test/);
});
test('software-development: unit_tests \'run_existing\' with a failing suite delegates to the developer instead of the test writer', { timeout: 120000 }, async () => {
  const { events, transitions } = await runSoftwareDevelopment({
    inputs: { unit_tests: 'run_existing', e2e_tests: 'off' },
    mockSequences: { verdict: ['approved'], preview_status: ['success'], suite: { suite: ['fail', 'pass'] } },
  });
  assert.deepEqual(transitions.filter((x) => /^(code_review|test|suite)>/.test(x)), ['code_review>suite', 'suite>suite', 'suite>build']);
  assert.ok(events.some((e) => e.type === 'log' && e.message === 'suite delegated to developer'));
  assert.ok(!events.some((e) => e.type === 'session.message_sent' && e.step_id === 'test'), 'the test writer never runs with unit_tests: run_existing + e2e_tests: off');
});
test('software-development: the test writer\'s skills follow unit_tests / e2e_tests (no unit skill unless write_and_run, no e2e skill when off)', { timeout: 120000 }, async () => {
  const firstTestPrompt = (events) => events.find((e) => e.type === 'session.message_sent' && e.step_id === 'test').prompt;

  const both = await runSoftwareDevelopment({
    inputs: { unit_tests: 'write_and_run', e2e_tests: 'write' },
    mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['pass'] } },
  });
  const bothPrompt = firstTestPrompt(both.events);
  assert.match(bothPrompt, /<skill name="unit-test-writer-js"/);
  assert.match(bothPrompt, /<skill name="e2e-test-writer-js"/);

  const unitOnly = await runSoftwareDevelopment({
    inputs: { unit_tests: 'write_and_run', e2e_tests: 'off' },
    mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['pass'] } },
  });
  const unitOnlyPrompt = firstTestPrompt(unitOnly.events);
  assert.match(unitOnlyPrompt, /<skill name="unit-test-writer-js"/);
  assert.doesNotMatch(unitOnlyPrompt, /<skill name="e2e-test-writer-js"/);

  const e2eOnly = await runSoftwareDevelopment({
    inputs: { unit_tests: 'run_existing', e2e_tests: 'write' },
    mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['pass'] } },
  });
  const e2eOnlyPrompt = firstTestPrompt(e2eOnly.events);
  assert.doesNotMatch(e2eOnlyPrompt, /<skill name="unit-test-writer-js"/, 'run_existing never loads the unit-test-writer skill');
  assert.match(e2eOnlyPrompt, /<skill name="e2e-test-writer-js"/);
});
test('software-development: tests_plan records whether a value is the workflow default or chosen for this run', { timeout: 120000 }, async () => {
  const def = await runSoftwareDevelopment({ mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['pass'] } } });
  const planOf = (f, k) => f.summary.tests_plan.find((p) => p.input === k);
  assert.equal(planOf(def.finished, 'unit_tests').source, 'workflow default');
  assert.equal(planOf(def.finished, 'unit_tests').value, 'write_and_run');
  const startedPlan = def.events.find((e) => e.type === 'workflow.started').tests_plan;
  assert.equal(planOf({ summary: { tests_plan: startedPlan } }, 'unit_tests').source, 'workflow default');

  const chosen = await runSoftwareDevelopment({
    inputs: { unit_tests: 'off', e2e_tests: 'off' },
    mockSequences: { verdict: ['approved'], preview_status: ['success'] },
  });
  assert.equal(planOf(chosen.finished, 'unit_tests').source, 'chosen for this run');
  assert.equal(planOf(chosen.finished, 'unit_tests').value_label, 'Off');
});
