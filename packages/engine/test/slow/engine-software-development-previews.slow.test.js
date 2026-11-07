// feature.yaml (remote) whole runs in mock mode (#305: one theme per slow file; #630: the old
// software-development.yaml, whose previews and deploys are gone): a code or infra failure of the
// PR/MR's CI or of the build, the fix rounds, and the gates' "retry".
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { runSoftwareDevelopment } = require('../engine-helpers');

const run = ({ inputs = {}, ...rest } = {}) => runSoftwareDevelopment({ file: 'feature.yaml', ...rest, inputs: { mode: 'remote', ...inputs } });

test('feature.yaml (remote): a CI code failure goes to the developer, then ci again → pr_monitor', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await run({ mockSequences: { ci_status: ['failed', 'success'], failure_class: ['code'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(events.some((e) => e.type === 'log' && e.message === 'ci delegated to developer'));
  // the developer's fix reaches the CI Pusher
  const ciPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'ci').map((e) => e.prompt);
  assert.match(ciPrompts.at(-1), /The developer fixed a previous failure and pushed/);
  assert.ok(!transitions.includes('ci>ci_failed'), 'no human gate for a fixable failure');
  assert.deepEqual(transitions.slice(-2), ['ci>pr_monitor', 'pr_monitor>end']);
});
test('feature.yaml (remote): CI code failures stop at the ci_failed gate after 5 fix rounds', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await run({
    mockSequences: { ci_status: ['failed'], failure_class: ['code'] },
    answers: { ci_failed: false },
  });
  assert.equal(events.filter((e) => e.type === 'log' && e.message === 'ci delegated to developer').length, 5, 'no fix is asked once the limit is reached');
  assert.ok(transitions.includes('ci>ci_failed'));
  // reject: the run failed (it did not deliver), not a success
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /ended as failed at step "ci_failed"/);
});
test('feature.yaml (remote): a CI infra failure goes to the ci_failed gate; approving checks CI again', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await run({ mockSequences: { ci_status: ['failed', 'success'], failure_class: ['infra'] } });
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'ci_failed');
  assert.match(gate.message, /did not pass \(status: failed\)/);
  assert.ok(!events.some((e) => e.type === 'log' && e.message === 'ci delegated to developer'), 'an infra failure is not sent to the developer');
  assert.deepEqual(transitions.filter((x) => /ci_failed|^ci>(?!ci$)/.test(x)), ['ci>ci_failed', 'ci_failed>ci', 'ci>pr_monitor']);
});
test('feature.yaml (remote): an infra build failure skips the fix rounds; "retry" builds again', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await run({
    mockSequences: { build_status: ['failed', 'success'], failure_class: ['infra'] },
    answers: { build_failed: 'retry' },
  });
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'build_failed');
  assert.deepEqual(gate.choices.map((c) => c.id), ['continue', 'retry', 'stop']);
  assert.match(gate.message, /because of the environment, not the code/);
  assert.ok(!events.some((e) => e.type === 'log' && e.message === 'build delegated to developer'), 'no developer round for an infra failure');
  assert.deepEqual(transitions.filter((x) => /build_failed|^build>/.test(x)), ['build>build_failed', 'build_failed>build', 'build>evidence']);
});
test('feature.yaml (remote): a code build failure still goes to the developer first', { timeout: 120000 }, async () => {
  const { events, transitions } = await run({ mockSequences: { build_status: ['failed', 'success'], failure_class: ['code'] } });
  assert.ok(events.some((e) => e.type === 'log' && e.message === 'build delegated to developer'));
  assert.ok(!transitions.includes('build>build_failed'));
});
