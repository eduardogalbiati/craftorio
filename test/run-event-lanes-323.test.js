// #323: the #250 event baseline is compared by lanes (test/run-event-lanes.js) so two concurrent
// sessions that interleave differently still match, while an event that disappears, appears twice
// or moves to another step does not ("no weaker check").
// Seam: eventLanes(events), on a small run with two concurrent reviewers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { eventLanes } = require('./run-event-lanes');

const opened = (id, agent) => ({ type: 'session.opened', session_id: id, session: { agent } });
const stream = (id) => ({ type: 'session.stream', session_id: id });
const received = (id, step) => ({ type: 'session.message_received', session_id: id, step_id: step });
// develop, then code_review with reviewer (s1) and ui_reviewer (s2) at the same time
const run = (review) => [
  { type: 'workflow.started' },
  { type: 'step.started', step_id: 'develop', visit: 1 },
  { type: 'log' },
  { type: 'step.finished', step_id: 'develop' },
  { type: 'step.transition', from: 'develop', to: 'code_review' },
  { type: 'step.started', step_id: 'code_review', visit: 1 },
  { type: 'log' },
  opened('s1', 'reviewer'), opened('s2', 'ui_reviewer'),
  ...review,
  { type: 'step.finished', step_id: 'code_review' },
  { type: 'workflow.finished' },
];
const ordered = [stream('s1'), stream('s1'), received('s1', 'code_review'), stream('s2'), received('s2', 'code_review')];
const interleaved = [stream('s2'), stream('s1'), received('s2', 'code_review'), stream('s1'), received('s1', 'code_review')];

test('#323 two concurrent sessions that interleave differently give the same lanes', () => {
  assert.deepEqual(eventLanes(run(interleaved)), eventLanes(run(ordered)));
});

test('#323 an event that disappears changes the lanes', () => {
  const missing = ordered.filter((_, i) => i !== 1);
  assert.notDeepEqual(eventLanes(run(missing)), eventLanes(run(ordered)));
});

test('#323 an event that appears twice changes the lanes', () => {
  assert.notDeepEqual(eventLanes(run([...ordered, stream('s2')])), eventLanes(run(ordered)));
});

test('#323 an event that moves to another step changes the lanes, with the same count', () => {
  const base = run(ordered);
  const moved = base.slice();
  // the develop log moves into code_review (the #387 kind of move)
  moved.splice(2, 1);
  moved.splice(5, 0, { type: 'log' });
  assert.equal(moved.length, base.length);
  assert.notDeepEqual(eventLanes(moved), eventLanes(base));
});

test('#323 the order of the steps is kept', () => {
  assert.deepEqual(eventLanes(run(ordered)).steps, [
    'workflow.started', 'step.started develop', 'step.finished develop', 'step.transition develop>code_review',
    'step.started code_review', 'step.finished code_review', 'workflow.finished',
  ]);
});
