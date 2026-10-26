// #607: recoveryStateFromEvents, the pure reduction a start-up recovery continues a run from: the
// turn the crash cut (its tool calls and usage), each step's last output, each session's last
// snapshot and the counters the recovered run's ids follow on from.
const test = require('node:test');
const assert = require('node:assert/strict');
const { recoveryStateFromEvents } = require('../../engine/run/resume');

const snap = (id, turns, cost) => ({ id, agent: 'a', provider: 'claude', model: 'm', mode: 'ephemeral', turns, cost_usd: cost });

const LOG = [
  { seq: 1, type: 'workflow.started', ts: '2026-10-26T10:00:00.000Z', mock: true },
  { seq: 2, type: 'step.started', step_id: 'plan', visit: 1 },
  { seq: 3, type: 'session.opened', session_id: 's2', session: snap('s2', 0, 0) },
  { seq: 4, type: 'session.message_sent', session_id: 's2', step_id: 'plan', turn: 1 },
  { seq: 5, type: 'session.message_received', session_id: 's2', step_id: 'plan', turn: 1, session: snap('s2', 1, 0.5) },
  { seq: 6, type: 'step.finished', step_id: 'plan', output: { ok: true } },
  { seq: 7, type: 'step.transition', from: 'plan', to: 'work' },
  { seq: 8, type: 'step.started', step_id: 'work', visit: 1 },
  { seq: 9, type: 'session.opened', session_id: 's3', session: snap('s3', 0, 0) },
  { seq: 10, type: 'session.message_sent', session_id: 's3', step_id: 'work', turn: 1 },
  { seq: 11, type: 'session.stream', session_id: 's3', turn: 1, item: { kind: 'tool_call', id: 't1', name: 'Bash', input: { command: 'ls' } } },
  { seq: 12, type: 'session.stream', session_id: 's3', turn: 1, item: { kind: 'tool_result', id: 't1', output: 'a.js' } },
  { seq: 13, type: 'session.stream', session_id: 's3', turn: 1, item: { kind: 'usage', usage: { input_tokens: 10, output_tokens: 2 }, costUsd: 0.25 } },
];

test('the turn the crash cut comes back with its tool calls and what its stream reported', () => {
  const state = recoveryStateFromEvents(LOG);
  assert.equal(state.nextStep, 'work');
  assert.deepEqual(state.outputs, { plan: { ok: true } });
  assert.equal(state.snapshots.s2.cost_usd, 0.5);
  assert.equal(state.lostTurn.session_id, 's3');
  assert.equal(state.lostTurn.step_id, 'work');
  assert.equal(state.lostTurn.attempt, 1);
  assert.deepEqual(state.lostTurn.calls.map((c) => [c.name, c.result?.output]), [['Bash', 'a.js']]);
  assert.deepEqual(state.lostTurn.usage, { input_tokens: 10, output_tokens: 2 });
  assert.equal(state.lostTurn.costUsd, 0.25);
  assert.equal(state.lostTurn.modelCalls, 1);
  assert.deepEqual([state.seq, state.nSession, state.lastFinished], [13, 3, 'plan']);
  assert.equal(state.startedAt, Date.parse('2026-10-26T10:00:00.000Z'));
});

test('an answered turn, or a stopped attempt retried, leaves no lost turn of its own', () => {
  const answered = [...LOG, { seq: 14, type: 'session.message_received', session_id: 's3', step_id: 'work', turn: 1 }];
  assert.equal(recoveryStateFromEvents(answered).lostTurn, null);
  const retried = [...LOG, { seq: 14, type: 'session.attempt_stopped', session_id: 's3', turn: 1, attempt: 1 }];
  const lost = recoveryStateFromEvents(retried).lostTurn;
  assert.deepEqual([lost.attempt, lost.calls.length, lost.usage], [2, 0, null]);
});

test('it never mutates the log it reads', () => {
  const copy = JSON.parse(JSON.stringify(LOG));
  recoveryStateFromEvents(LOG);
  assert.deepEqual(LOG, copy);
});
