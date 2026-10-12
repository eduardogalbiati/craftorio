// software-development whole runs in mock mode (#305: one theme per slow file): previews and builds (a code or infra failure of a preview or a build, the fix rounds, "retry").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const evidence = require('../../src/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { runSoftwareDevelopment } = require('../engine-helpers');

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
