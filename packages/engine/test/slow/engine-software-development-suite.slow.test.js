// feature.yaml (remote mode) whole runs in mock mode (#305: one theme per slow file): the suite step and the test writer (failing, pre-existing and blocked suites, tests_plan).
// #630: was software-development.yaml (removed); runSoftwareDevelopment runs feature.yaml in remote mode.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const evidence = require('../../domains/evidence/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { runSoftwareDevelopment } = require('../engine-helpers');

test('feature.yaml (remote): a failing suite goes back to the test writer once with the failures, then passes; summary.suite_runs counts the engine\'s runs', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { verdict: ['approved'], tests_status: ['pass'], suite: { suite: ['fail', 'pass'] } },
  });
  assert.equal(finished.status, 'success', finished.error);
  const i = transitions.indexOf('test>suite');
  // #630: e2e_tests defaults to write_and_run in feature.yaml, so a green suite goes on to the e2e step
  assert.deepEqual(transitions.slice(i, i + 4), ['test>suite', 'suite>test', 'test>suite', 'suite>e2e'], transitions.join(' '));
  const testPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'test').map((e) => e.prompt);
  assert.equal(testPrompts.length, 2);
  assert.match(testPrompts[1], /The orchestrator ran the whole suite after your last step and it failed/);
  assert.match(testPrompts[1], /simulated failing test/);
  // scope: affected: the failing round and the passing one run the affected files (not the engine's whole
  // suite); the whole suite runs once, after the affected files first pass. #630: the e2e step (e2e_tests
  // defaults to write_and_run) is the engine's second run
  assert.deepEqual(finished.summary.suite_runs, { engine: 2, agents: 0, affected: 2 });
});
test('feature.yaml (remote): pre-existing suite failures never loop back to the test writer', { timeout: 120000 }, async () => {
  const { finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { verdict: ['approved'], tests_status: ['pass'], preexisting_failures: true, suite: { suite: ['preexisting'] } },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.filter((x) => /^(test|suite)>/.test(x)), ['test>suite', 'suite>e2e']);
  // #630: the suite once, then the e2e step
  assert.deepEqual(finished.summary.suite_runs, { engine: 2, agents: 0, affected: 1 });
});
test('feature.yaml (remote): a suite that cannot run (blocked) goes straight to test_failed', { timeout: 120000 }, async () => {
  const { finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { verdict: ['approved'], tests_status: ['pass'], suite: { suite: ['blocked'] } },
    answers: { test_failed: 'stop' },
  });
  assert.deepEqual(transitions.filter((x) => /^(test|suite)>/.test(x)), ['test>suite', 'suite>test_failed']);
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /ended as failed at step "test_failed"/);
});
test('feature.yaml (remote): a suite that keeps failing exhausts its 2 retries (3 rounds total) and stops at test_failed, with the failures in the gate message', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { verdict: ['approved'], tests_status: ['pass'], suite: { suite: ['fail'] } },
    answers: { test_failed: 'stop' },
  });
  assert.deepEqual(transitions.filter((x) => /^(test|suite)>/.test(x)), ['test>suite', 'suite>test', 'test>suite', 'suite>test', 'test>suite', 'suite>test_failed']);
  assert.equal(finished.status, 'failed');
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'test_failed');
  assert.match(gate.message, /still fails after 3 round/);
  assert.match(gate.message, /simulated failing test/);
});
test('feature.yaml (remote): unit_tests \'run_existing\' with a failing suite delegates to the developer instead of the test writer', { timeout: 120000 }, async () => {
  const { events, transitions } = await runSoftwareDevelopment({
    inputs: { unit_tests: 'run_existing', e2e_tests: 'off' },
    mockSequences: { verdict: ['approved'], suite: { suite: ['fail', 'pass'] } },
  });
  assert.deepEqual(transitions.filter((x) => /^(code_review|test|suite)>/.test(x)), ['code_review>suite', 'suite>suite', 'suite>build']);
  assert.ok(events.some((e) => e.type === 'log' && e.message === 'suite delegated to developer'));
  assert.ok(!events.some((e) => e.type === 'session.message_sent' && e.step_id === 'test'), 'the test writer never runs with unit_tests: run_existing + e2e_tests: off');
});
test('feature.yaml (remote): the test writer\'s skills follow e2e_tests (the unit skill always, for the acceptance tests; no e2e skill when off)', { timeout: 120000 }, async () => {
  // #630: the test writer's session starts at acceptance_tests (tests first): its first prompt carries the skills
  const firstTestPrompt = (events) => events.find((e) => e.type === 'session.message_sent' && e.step_id === 'acceptance_tests').prompt;

  const both = await runSoftwareDevelopment({
    inputs: { unit_tests: 'write_and_run', e2e_tests: 'write' },
    mockSequences: { verdict: ['approved'], tests_status: ['pass'], suite: { suite: ['pass'] } },
  });
  const bothPrompt = firstTestPrompt(both.events);
  assert.match(bothPrompt, /<skill name="unit-test-writer-js"/);
  assert.match(bothPrompt, /<skill name="e2e-test-writer-js"/);

  const unitOnly = await runSoftwareDevelopment({
    inputs: { unit_tests: 'write_and_run', e2e_tests: 'off' },
    mockSequences: { verdict: ['approved'], tests_status: ['pass'], suite: { suite: ['pass'] } },
  });
  const unitOnlyPrompt = firstTestPrompt(unitOnly.events);
  assert.match(unitOnlyPrompt, /<skill name="unit-test-writer-js"/);
  assert.doesNotMatch(unitOnlyPrompt, /<skill name="e2e-test-writer-js"/);

  const e2eOnly = await runSoftwareDevelopment({
    inputs: { unit_tests: 'run_existing', e2e_tests: 'write' },
    mockSequences: { verdict: ['approved'], tests_status: ['pass'], suite: { suite: ['pass'] } },
  });
  const e2eOnlyPrompt = firstTestPrompt(e2eOnly.events);
  // #630: the acceptance tests are always written first, so acceptance_tests loads the unit skill
  // whatever unit_tests says; run_existing only drops the extra test step after the review
  assert.match(e2eOnlyPrompt, /<skill name="unit-test-writer-js"/, 'the acceptance tests are written first');
  assert.match(e2eOnlyPrompt, /<skill name="e2e-test-writer-js"/);
  assert.ok(!e2eOnly.events.some((e) => e.type === 'session.message_sent' && e.step_id === 'test'), 'run_existing never visits the test step');
});
test('feature.yaml (remote): tests_plan records whether a value is the workflow default or chosen for this run', { timeout: 120000 }, async () => {
  const def = await runSoftwareDevelopment({ mockSequences: { verdict: ['approved'], tests_status: ['pass'], suite: { suite: ['pass'] } } });
  const planOf = (f, k) => f.summary.tests_plan.find((p) => p.input === k);
  assert.equal(planOf(def.finished, 'unit_tests').source, 'workflow default');
  assert.equal(planOf(def.finished, 'unit_tests').value, 'write_and_run');
  const startedPlan = def.events.find((e) => e.type === 'workflow.started').tests_plan;
  assert.equal(planOf({ summary: { tests_plan: startedPlan } }, 'unit_tests').source, 'workflow default');

  const chosen = await runSoftwareDevelopment({
    inputs: { unit_tests: 'off', e2e_tests: 'off' },
    mockSequences: { verdict: ['approved'] },
  });
  assert.equal(planOf(chosen.finished, 'unit_tests').source, 'chosen for this run');
  assert.equal(planOf(chosen.finished, 'unit_tests').value_label, 'Off');
});
