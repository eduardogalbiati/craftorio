// #416 (acceptance tests, written before the code): whole simulated runs of a workflow with a human
// gate between two agent steps (the #411 evidence: `test_failed` answered after a night away, then `build`).
// The clock is faked (node:test mock timers, Date only): the owner answers the gate 10h37m after it
// opened, while the run worked minutes.
//   - the gate wait does not count toward max_total_duration: the answer is taken and the run goes on;
//   - a gate asked again by a resumed run (a run paused/interrupted at its gate, #288/#368) is the same;
//   - over a limit for another reason when the owner answers (max_total_cost_usd), the run stops AT the
//     gate with the reason, before taking the answer: the gate is not recorded as answered and the next
//     step never starts (the answer can be given again after raising the limit).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../src/engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { tempWorkflow } = require('../engine-helpers');

const H = 3600e3;
const NIGHT = 10 * H + 37 * 60e3;
const YAML = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: gate-wait-limits-416 }
orchestrator:
  limits:
    max_total_duration: 8h
    max_total_cost_usd: 5
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: develop
    agent: a
    prompt: "do it"
  - id: test_failed
    type: human_approval
    message: "The tests failed. Continue?"
  - id: build
    agent: a
    prompt: "build it"
`;

// a run whose owner answers its gate a night later; onGate(run) runs while the gate is open
async function runAnsweredNextMorning(t, { resume = null, onGate = () => {} } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-15T21:00:00Z') });
  const { file } = tempWorkflow(t, YAML);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-416-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, ...(resume ? { resume } : {}) });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      setTimeout(() => {
        onGate(run);
        t.mock.timers.tick(NIGHT);
        run.resolveApproval(ev.approval_id, true, 'owner', '', null, [], { answered_by: 'owner', via: 'mobile' });
      }, 20);
    }
  });
  await run.start();
  return { events, finished: events.find((e) => e.type === 'workflow.finished') };
}

test('#416 a run that waits a night at a human gate takes the answer and goes on: the wait is not run time', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runAnsweredNextMorning(t);
  assert.equal(events.some((e) => e.type === 'limit.exceeded'), false, 'no limit.exceeded after the answer');
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(events.some((e) => e.type === 'step.started' && e.step_id === 'build'), true, 'build ran after the gate');
  // the summary still shows the wall clock and the time waiting at gates
  assert.ok(finished.summary.timing.gate_wait_ms >= NIGHT, `gate_wait_ms ${finished.summary.timing.gate_wait_ms}`);
});

test('#416 a gate asked again by a resumed run (interrupted at its gate) does not count either', { timeout: 60000 }, async (t) => {
  const resume = { runId: 'prev-416', fromStep: 'test_failed', paused: true, steps: { develop: { output: { text: 'done' }, visits: 1 } }, sessions: {}, handoffs: {} };
  const { events, finished } = await runAnsweredNextMorning(t, { resume });
  assert.equal(events.some((e) => e.type === 'approval.requested' && e.step_id === 'test_failed'), true, 'the gate asked again');
  assert.equal(events.some((e) => e.type === 'limit.exceeded'), false);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(events.some((e) => e.type === 'step.started' && e.step_id === 'build'), true);
});

test('#416 over the cost limit when the owner answers: the run stops at the gate with the reason, before taking the answer', { timeout: 60000 }, async (t) => {
  // the run's spend went past max_total_cost_usd (5) while the gate was open
  const overCost = (run) => { for (const s of run.sessions.values()) s.costUsd = 50; };
  const { events, finished } = await runAnsweredNextMorning(t, { onGate: overCost });
  assert.notEqual(finished.status, 'success');
  assert.match(String(finished.error || finished.summary?.error || ''), /Maximum cost exceeded/);
  const exceeded = events.find((e) => e.type === 'limit.exceeded');
  assert.equal(exceeded?.limit, 'max_total_cost_usd');
  assert.equal(events.some((e) => e.type === 'step.started' && e.step_id === 'build'), false, 'nothing ran after the gate');
  // the answer is not taken: the gate is not recorded as answered, so it can be answered again
  const gateDone = events.find((e) => e.type === 'step.finished' && e.step_id === 'test_failed' && !e.error);
  assert.equal(gateDone === undefined || gateDone.output?.approved === undefined, true, 'the gate\'s answer is not recorded as its output');
  assert.equal(events.some((e) => e.type === 'approval.resolved' && e.step_id === 'test_failed' && e.approved === true), false, 'no approval.resolved with the answer');
});
