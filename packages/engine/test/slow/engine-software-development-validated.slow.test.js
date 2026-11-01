// feature.yaml (remote mode) whole runs in mock mode (#305: one theme per slow file): validated mode (developer_check), the gate messages and developer_screenshots.
// #630: was software-development.yaml (removed); its `mode: validated` is feature.yaml's `validation` input,
// and its approve_merge gate is gone (the PR's review on the host is the merge approval).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const evidence = require('../../domains/evidence/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { root, runSoftwareDevelopment } = require('../engine-helpers');

// ---- #104: validated mode (validation input, developer_check gate) ------------------------

// #246/#404: develop's commit goes through testid_check, the screenshots and rule_check before the gate
const GATE_ROUTE = ['testid_check>developer_screenshots', 'developer_screenshots>rule_check', 'rule_check>developer_check'];
const gateRoute = (transitions) => transitions.filter((x) => /developer_check|developer_screenshots/.test(x));

test('feature.yaml (remote): validated mode stops at developer_check with the diff and worktree details; auto mode (the default) skips it', { timeout: 120000 }, async () => {
  const validated = await runSoftwareDevelopment({ inputs: { validation: 'validated' } });
  assert.equal(validated.finished.status, 'success', validated.finished.error);
  // recorded on the run (Details): workflow.started carries every input, validation included
  assert.equal(validated.events.find((e) => e.type === 'workflow.started').inputs.validation, 'validated');
  const gate = validated.events.find((e) => e.type === 'approval.requested' && e.step_id === 'developer_check');
  assert.ok(gate, validated.transitions.join(' '));
  // #630: feature.yaml diffs against its base_branch input (main), in both modes
  assert.equal(gate.diff_base, 'main');
  assert.equal(gate.work_dir, root);
  assert.deepEqual(gate.choices.map((c) => c.id), ['approve', 'changes', 'stop']);
  assert.match(gate.message, /Try it before the review and the tests run/);
  assert.match(gate.message, /Files changed:/);
  assert.match(gate.feedback.label, /Your change request for the developer/);
  // #630: the default mock verdicts run one review fix round after the gate; only the first route matters here
  assert.deepEqual(gateRoute(validated.transitions).slice(0, 4), [...GATE_ROUTE, 'developer_check>code_review']);

  const auto = await runSoftwareDevelopment({}); // validation defaults to "auto"
  assert.equal(auto.finished.status, 'success', auto.finished.error);
  assert.ok(!auto.events.some((e) => e.type === 'approval.requested' && e.step_id === 'developer_check'));
  assert.ok(auto.transitions.includes('rule_check>code_review'), auto.transitions.join(' '));
});
// #630: approve_merge is gone; developer_check is the gate of the happy path that lists the scenarios
test('feature.yaml (remote): developer_check\'s message shows the Dev/QA line and the test writer\'s E2E scenarios (#143)', { timeout: 120000 }, async () => {
  const { events, finished } = await runSoftwareDevelopment({ inputs: { validation: 'validated' } });
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'developer_check');
  assert.ok(gate);
  assert.match(gate.message, /Dev\/QA: read the E2E scenarios and the screenshots/);
  // #223: the scenarios are written first, with the acceptance tests, so the gate already lists them;
  // the default mock scenarios (packages/engine/engine/providers.js mockScenarios) are written, not run
  assert.match(gate.message, /E2E scenarios \(written by the test writer, run at release\): 2 written, run at release/);
  assert.match(gate.message, /- written, run at release: Filter the runs by status/);
  assert.match(gate.message, /- written, run at release: An empty filter result explains itself/);
});
test('feature.yaml (remote): validated mode — Ask for changes goes through the test writer to the developer and reopens developer_check; Approve then moves on to code_review', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    inputs: { validation: 'validated' },
    mockSequences: { verdict: ['approved'] },
    answers: { developer_check: ['changes', 'approve'] },
    feedback: { developer_check: ['Use snake_case for the new function.'] },
  });
  assert.equal(finished.status, 'success', finished.error);
  // #247: the test writer triages the change request first (developer_check > acceptance_tests)
  assert.deepEqual(gateRoute(transitions), [
    ...GATE_ROUTE, 'developer_check>acceptance_tests', ...GATE_ROUTE, 'developer_check>code_review',
  ]);
  const gates = events.filter((e) => e.type === 'approval.requested' && e.step_id === 'developer_check');
  assert.equal(gates.length, 2);
  assert.match(gates[1].message, /your change request 1/);
  const resolved = events.filter((e) => e.type === 'approval.resolved' && e.feedback);
  assert.equal(resolved[0].feedback, 'Use snake_case for the new function.');
  const developPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => e.prompt);
  // #630: the feedback reaches a later develop turn (not always the second one: testid_check may send it back first)
  assert.ok(developPrompts.some((p) => /The owner tried your change and asks for these changes/.test(p) && /Use snake_case for the new function\./.test(p)),
    developPrompts.length + ' develop prompts');
});
test('feature.yaml (remote): validated mode — a review fix round does not reopen developer_check; validate_every_round makes it stop again', { timeout: 120000 }, async () => {
  const once = await runSoftwareDevelopment({
    inputs: { validation: 'validated' },
    mockSequences: { verdict: ['changes_requested', 'approved'] },
  });
  assert.equal(once.finished.status, 'success', once.finished.error);
  assert.ok(once.transitions.includes('code_review>develop'));
  // the fix round goes through the screenshots and rule_check, then straight to the review
  assert.equal(once.transitions.filter((x) => x === 'rule_check>developer_check').length, 1, once.transitions.join(' '));
  assert.equal(once.transitions.filter((x) => x === 'rule_check>code_review').length, 1, once.transitions.join(' '));

  const every = await runSoftwareDevelopment({
    inputs: { validation: 'validated', validate_every_round: 'true' },
    mockSequences: { verdict: ['changes_requested', 'approved'] },
  });
  assert.equal(every.finished.status, 'success', every.finished.error);
  assert.deepEqual(gateRoute(every.transitions), [
    ...GATE_ROUTE, 'developer_check>code_review', ...GATE_ROUTE, 'developer_check>code_review',
  ]);
});
test('feature.yaml (remote): validated mode — Stop ends the run as cancelled, the worktree kept to resume', { timeout: 120000 }, async () => {
  const { finished, transitions } = await runSoftwareDevelopment({
    inputs: { validation: 'validated' }, answers: { developer_check: 'stop' },
  });
  assert.equal(finished.status, 'cancelled');
  assert.match(finished.error, /ended as cancelled at step "developer_check"/);
  assert.ok(!transitions.includes('developer_check>code_review'));
});
// #144: developer_screenshots, right before developer_check, runs the develop step's `screenshots`
// list through captureScreenshots (packages/engine/engine/screenshot-step.js). A mock run never captures: its
// output says so (reason), and developer_check's message shows it.
test('feature.yaml (remote): developer_screenshots captures the developer\'s UI list as simulated in a mock run, reported at developer_check', { timeout: 120000 }, async () => {
  const { events, finished } = await runSoftwareDevelopment({
    inputs: { validation: 'validated' },
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
