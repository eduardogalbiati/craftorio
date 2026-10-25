// software-development whole runs in mock mode (#305: one theme per slow file): Tests/Measure tasks are never the developer's gap (#173).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const evidence = require('../../src/domains/evidence/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { runSoftwareDevelopment } = require('../engine-helpers');

for (const file of ['software-development.yaml', 'software-development-local-hero.yaml']) {
  // software-development also needs a successful preview to reach the end; local-hero has none
  const toEnd = file === 'software-development.yaml' ? { preview_status: ['success'] } : {};
  // only transitions where both ends are one of these three steps (hides the rest of the pipeline)
  const groupBy = (xs, re) => xs.filter((x) => re.test(x));
  const DEV_RE = /^(develop|requirements_left_out|code_review)>(develop|requirements_left_out|code_review)$/;

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
