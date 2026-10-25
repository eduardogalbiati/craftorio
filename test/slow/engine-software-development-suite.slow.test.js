// software-development whole runs in mock mode (#305: one theme per slow file): the suite step and the test writer (failing, pre-existing and blocked suites, tests_plan).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const evidence = require('../../src/domains/evidence/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { runSoftwareDevelopment } = require('../engine-helpers');

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
