// software-development whole runs in mock mode (#305: one theme per slow file): validated mode (developer_check), the gate messages and developer_screenshots.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const evidence = require('../../src/domains/evidence/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { root, runSoftwareDevelopment } = require('../engine-helpers');

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
