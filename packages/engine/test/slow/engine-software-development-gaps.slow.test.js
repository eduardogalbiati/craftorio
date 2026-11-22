// feature.yaml whole runs in mock mode, Local and Remote (#305: one theme per slow file): the requirements_left_out gate (a declared gap, the owner's gate).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';
const { root, runSoftwareDevelopment: runFeature } = require('../engine-helpers');

test('#98: requirements_left_out is a human gate; neither a retry nor the supervisor can answer it', () => {
  const wf = loadWorkflow(path.join(root, 'workflows', 'feature.yaml'));
  const gate = wf.steps.find((s) => s.id === 'requirements_left_out');
  assert.equal(gate.type, 'human_approval');
  assert.deepEqual(gate.choices.map((c) => c.id), ['continue', 'stop']);
});

for (const mode of ['local', 'remote']) {
  const file = `feature.yaml (${mode})`;
  // `file` below is the test title's label: the run is always feature.yaml in this mode
  // E2E and screenshots off: no testid_check / developer_screenshots round trips through develop
  // (their own tests), so each develop visit here is a gap round
  const runSoftwareDevelopment = ({ file: _label, ...opts }) => runFeature({ ...opts, inputs: { mode, e2e_tests: 'off', screenshots: 'off', ...opts.inputs } });
  const toEnd = {};
  // the moves between these three steps, skipping the agent-less steps in between (rule_check:
  // the repository has a `check` script) and hiding the rest of the pipeline
  const groupBy = (xs, steps) => {
    const visited = xs.length ? [xs[0].split('>')[0], ...xs.map((x) => x.split('>')[1])] : [];
    const kept = visited.filter((s) => steps.includes(s));
    return kept.slice(1).map((s, i) => `${kept[i]}>${s}`);
  };
  const DEV_STEPS = ['develop', 'requirements_left_out', 'code_review'];

  test(`${file}: no declared gap goes straight develop > code_review`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({ file, mockSequences: { verdict: ['approved'], ...toEnd } });
    assert.deepEqual(groupBy(transitions, DEV_STEPS), ['develop>code_review']);
    assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out'));
    // #160: the test writer's capabilities log line shows the Agent/Task tool is offered
    const log = events.find((e) => e.type === 'log' && e.kind === 'capabilities' && e.agent === 'test_writer');
    assert.match(log.message, /subagents: Agent\/Task tool offered/, file);
  });

  test(`${file}: a gap declared once sends the developer back before the review, never straight to code_review`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({ file, mockSequences: { left_out: [1, 0], verdict: ['approved'], ...toEnd } });
    assert.deepEqual(groupBy(transitions, DEV_STEPS), ['develop>develop', 'develop>code_review']);
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
    assert.deepEqual(groupBy(transitions, DEV_STEPS), ['develop>develop', 'develop>requirements_left_out']);
  });

  test(`${file}: "continue" at the gate moves on to the review`, { timeout: 120000 }, async () => {
    const { transitions, finished } = await runSoftwareDevelopment({
      file, mockSequences: { left_out: [1, 1, 0], verdict: ['approved'], ...toEnd }, answers: { requirements_left_out: 'continue' },
    });
    assert.equal(finished.status, 'success', finished.error);
    assert.deepEqual(groupBy(transitions, DEV_STEPS), ['develop>develop', 'develop>requirements_left_out', 'requirements_left_out>code_review']);
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
    assert.ok(!groupBy(transitions, DEV_STEPS).includes('develop>code_review'), transitions.join(' '));
    assert.deepEqual(groupBy(transitions, DEV_STEPS), [
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

}
