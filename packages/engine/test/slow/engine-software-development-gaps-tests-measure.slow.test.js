// feature.yaml whole runs in mock mode, Local and Remote (#305: one theme per slow file): Tests/Measure tasks are never the developer's gap (#173).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { runSoftwareDevelopment: runFeature } = require('../engine-helpers');

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

  // #173: the issue's Tests and Measure tasks are never the developer's, so declaring only those
  // (mockSequences.left_out_not_mine) never sends the run back nor stops it at the human gate.
  test(`${file}: declaring only the Tests and Measure tasks never returns to develop nor opens the gate`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({ file, mockSequences: { left_out_not_mine: true, verdict: ['approved'], ...toEnd } });
    assert.deepEqual(groupBy(transitions, DEV_STEPS), ['develop>code_review']);
    assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out'));
  });

  test(`${file}: a real gap still returns to develop and reaches the gate even with Tests/Measure also declared`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({
      file, mockSequences: { left_out: [1], left_out_not_mine: true, verdict: ['approved'], ...toEnd }, answers: { requirements_left_out: 'continue' },
    });
    assert.deepEqual(groupBy(transitions, DEV_STEPS), ['develop>develop', 'develop>requirements_left_out', 'requirements_left_out>code_review']);
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
    assert.deepEqual(groupBy(transitions, DEV_STEPS), ['develop>develop', 'develop>code_review']);
    assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out'));
    const developPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => e.prompt);
    const listed = developPrompts[1].match(/so the review was not called:\n([\s\S]*?)\nFinish them/)[1];
    assert.match(listed, /\(simulated\) requirement/, listed);
    assert.ok(!/Tests|Measure/.test(listed), listed);
  });
}
