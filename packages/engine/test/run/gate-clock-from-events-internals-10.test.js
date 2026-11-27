// #10 (developer's internals): gateClockFromEvents, the gate clock of a run rebuilt from its log.
const test = require('node:test');
const assert = require('node:assert/strict');
const { gateClockFromEvents, runStateFromEvents } = require('../../engine/run/resume');

const H = 3600e3;
const T0 = Date.parse('2026-11-15T13:58:24Z');
const log = (entries) => entries.map(([at, type, fields = {}], i) => ({ seq: i + 1, type, ts: new Date(T0 + at).toISOString(), ...fields }));

test('#10 no gate in the log: a stopped clock, no waits, no open gate', () => {
  assert.deepEqual(gateClockFromEvents(log([[0, 'workflow.started']])), { total: 0, since: null, gateWaits: {}, openGate: null });
  assert.deepEqual(gateClockFromEvents(undefined), { total: 0, since: null, gateWaits: {}, openGate: null });
});

test('#10 gates open together count once; the open one keeps the clock running from its request', () => {
  const c = gateClockFromEvents(log([
    [H, 'approval.requested', { approval_id: 'a1', step_id: 'g1' }],
    [2 * H, 'approval.requested', { approval_id: 'a2', step_id: 'g2' }],
    [3 * H, 'approval.resolved', { approval_id: 'a1', step_id: 'g1', approved: true, wait_ms: 2 * H }],
  ]));
  assert.equal(c.total, 0);
  assert.equal(c.since, T0 + H);
  assert.deepEqual(c.gateWaits, { g1: { waits: 1, wait_ms: 2 * H } });
  assert.deepEqual(c.openGate, { step: 'g2', requestedAt: T0 + 2 * H });
});

test('#10 a recovery closes the clock; the gate asked again restarts it and keeps the time it was first asked', () => {
  const c = gateClockFromEvents(log([
    [H, 'approval.requested', { approval_id: 'a1', step_id: 'ship' }],
    [5 * H, 'run.recovered', { step_id: 'ship', gate: true }],
    [5 * H + 1000, 'approval.requested', { approval_id: 'a2', step_id: 'ship' }],
  ]));
  assert.equal(c.total, 4 * H);
  assert.equal(c.since, T0 + 5 * H + 1000);
  assert.deepEqual(c.openGate, { step: 'ship', requestedAt: T0 + H });
});

test('#10 a recovery cut before the gate is asked again still reports the open gate, with a stopped clock', () => {
  const c = gateClockFromEvents(log([
    [H, 'approval.requested', { approval_id: 'a1', step_id: 'ship' }],
    [5 * H, 'run.recovered', { step_id: 'ship', gate: true }],
  ]));
  assert.equal(c.total, 4 * H);
  assert.equal(c.since, null);
  assert.deepEqual(c.openGate, { step: 'ship', requestedAt: T0 + H });
});

test('#10 a recovery at an agent turn (gate: false) forgets the open gate', () => {
  const c = gateClockFromEvents(log([
    [H, 'approval.requested', { approval_id: 'a1', step_id: 'ask' }],
    [3 * H, 'run.recovered', { step_id: 'ask', gate: false }],
  ]));
  assert.deepEqual(c, { total: 2 * H, since: null, gateWaits: {}, openGate: null });
});

test('#10 a withdrawn gate stops the clock and is no wait', () => {
  const c = gateClockFromEvents(log([
    [H, 'approval.requested', { approval_id: 'a1', step_id: 'merge' }],
    [4 * H, 'approval.resolved', { approval_id: 'a1', withdrawn: true, by: 'check' }],
  ]));
  assert.deepEqual(c, { total: 3 * H, since: null, gateWaits: {}, openGate: null });
});

test('#10 the gate a resume confirmed is no wait', () => {
  const c = gateClockFromEvents(log([
    [0, 'approval.resolved', { approval_id: 'resume-ship', step_id: 'ship', approved: true, wait_ms: 0, confirmed_at_resume: true }],
  ]));
  assert.deepEqual(c, { total: 0, since: null, gateWaits: {}, openGate: null });
});

test('#10 the resume state\'s open gate keeps its shape', () => {
  const state = runStateFromEvents(log([[H, 'approval.requested', { approval_id: 'a1', step_id: 'ship' }]]));
  assert.deepEqual(state.openGate, { step: 'ship', approval_id: 'a1' });
});
