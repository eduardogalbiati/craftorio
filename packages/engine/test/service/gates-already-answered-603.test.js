// #603 acceptance: a second answer to a gate that was already answered says so, with the time.
//
// The remote-engine window can miss the approval.resolved push and show a gate that is no longer
// waiting; answering it again used to come back as a bare `false` (the same as a refused answer),
// so the gate card showed an error. The card now says "already answered at <time>"
// (fronts/build/views/run/run.js), from what the engine answers.
//
// The interface these tests expect (the developer implements it; this file is not edited):
// `approval:resolve` (packages/engine/service/channels/runs.js) on a gate of that run that was
// already answered (its run still going or finished) answers, with no error (HTTP 200 over the
// server), the object `{ already_answered: true, answered_at }`, `answered_at` being the `ts` of
// that gate's approval.resolved event (an ISO date). A gate id the run never asked still answers
// false, as today.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeResumeService, untilTrue } = require('./helpers');

// Starts fixture-resume.yaml in mock mode and resolves with its approval.requested event.
function startToGate(service, api) {
  return new Promise((resolve, reject) => {
    const onEv = (ev) => {
      if (ev.type === 'approval.requested') { service.events.off('run:event', onEv); resolve(ev); }
    };
    service.events.on('run:event', onEv);
    api['run:start']({ file: 'fixture-resume.yaml', inputs: {}, mock: true }).catch(reject);
  });
}

// what a call answered, as primitives
const shape = (r) => (r && typeof r === 'object' ? { already_answered: r.already_answered, answered_at: r.answered_at } : { value: r });

test('#603 approval:resolve on a gate already answered answers { already_answered: true, answered_at } with the time of its answer', async (t) => {
  const { service, api } = makeResumeService(t);
  const resolved = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'approval.resolved') resolved.push({ id: ev.approval_id, ts: ev.ts }); });
  const gate = await startToGate(service, api);
  const { run_id: runId, approval_id: approvalId } = gate;

  const first = await api['approval:resolve']({ runId, id: approvalId, answer: true });
  assert.equal(first, true, 'the first answer is taken');
  await untilTrue(() => resolved.length === 1);
  const answeredAt = resolved[0].ts;
  assert.ok(!Number.isNaN(Date.parse(answeredAt)), 'the approval.resolved event has a ts');

  // again, the run still going or just finished
  const again = await api['approval:resolve']({ runId, id: approvalId, answer: false });
  assert.deepEqual(shape(again), { already_answered: true, answered_at: answeredAt }, 'a second answer while the run goes on');

  // again, once the run has ended
  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
  const late = await api['approval:resolve']({ runId, id: approvalId, answer: true });
  assert.deepEqual(shape(late), { already_answered: true, answered_at: answeredAt }, 'a second answer after the run ended');
  assert.equal(resolved.length, 1, 'the gate was answered once');

  // a gate the run never asked: still false
  assert.equal(await api['approval:resolve']({ runId, id: 'a99', answer: true }), false);
});
