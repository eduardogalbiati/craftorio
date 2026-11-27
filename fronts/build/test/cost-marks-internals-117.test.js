// #117 internals: one rule for a total's unknown / partial marks (session-cost.js totalMarks), used by
// the 3D model (run3d-model.js costMarks, costPartial, usdPerMTokens) and the run chat's model, and the
// user's prices (settings.prices) pricing a turn with no recorded cost in both models.
const test = require('node:test');
const assert = require('node:assert/strict');
const SessionCost = require('@craftorio/shared/session-cost');
const { Run3DModel } = require('@craftorio/ui-kit/run3d-model');
const { RunChatModel } = require('../views/runchat/run-chat-model');

const T0 = Date.parse('2026-11-27T10:00:00.000Z');
const NO_COST = { cost_usd: null };
const MODEL = 'gpt-117-internal';

function events(review) {
  let seq = 0;
  const ev = (s, type, fields = {}) => ({ seq: ++seq, ts: new Date(T0 + s * 1000).toISOString(), run_id: 'run-1', type, ...fields });
  const steps = [{ id: 'develop', type: 'agent', agent: 'developer' }, { id: 'review', type: 'agent', agent: 'reviewer' }];
  const turn = (s, session, step, fields) => [
    ev(s, 'session.message_sent', { session_id: session, step_id: step, turn: 1 }),
    ev(s + 5, 'session.message_received', { session_id: session, step_id: step, turn: 1, text: 'done', usage: { input: 1000000, output: 0 }, ...fields }),
  ];
  return [
    ev(0, 'workflow.started', { workflow: 'w', file: 'w.yaml', inputs: { task: 'x' }, steps, groups: [] }),
    ev(1, 'session.opened', { session_id: 's-dev', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }),
    ev(1, 'session.opened', { session_id: 's-rev', session: { agent: 'reviewer', provider: 'codex', model: MODEL } }),
    ev(2, 'step.started', { step_id: 'develop', visit: 1, step_type: 'agent' }),
    ...turn(3, 's-dev', 'develop', { cost_usd: 0.5 }),
    ev(10, 'step.started', { step_id: 'review', visit: 1, step_type: 'agent' }),
    ...turn(11, 's-rev', 'review', review),
  ];
}

test('totalMarks: unknown with nothing priced, partial when a priced total misses a cost', () => {
  assert.deepEqual(SessionCost.totalMarks(0, true), { unknown: true, partial: false });
  assert.deepEqual(SessionCost.totalMarks(0.5, true), { unknown: false, partial: true });
  assert.deepEqual(SessionCost.totalMarks(0.5, false), { unknown: false, partial: false });
});

test('the 3D model marks a mixed run partial, an unpriced agent unknown, and has no $/M for it', () => {
  const m = new Run3DModel();
  m.applyAll(events(NO_COST));
  assert.equal(m.costPartial(), true);
  assert.equal(m.costUnknown(), false);
  const reviewer = (x) => x.agent === 'reviewer';
  assert.equal(m.costUnknown(reviewer), true);
  assert.equal(m.usdPerMTokens(reviewer), null);
  assert.equal(m.costUnknown((x) => x.agent === 'developer'), false);
});

test('the user\'s prices price a turn with no recorded cost in the 3D and the chat models', () => {
  const prices = { [MODEL]: { input: 2, output: 8 } };
  const m = new Run3DModel({ prices });
  m.applyAll(events(NO_COST));
  assert.equal(m.costPartial(), false);
  assert.ok(Math.abs(m.cost() - 2.5) < 1e-9, `${m.cost()}`);

  const chat = new RunChatModel({ prices });
  for (const ev of events(NO_COST)) chat.apply(ev);
  assert.equal(chat.run.costPartial, false);
  assert.ok(Math.abs(chat.run.cost - 2.5) < 1e-9, `${chat.run.cost}`);

  const unpriced = new RunChatModel();
  for (const ev of events(NO_COST)) unpriced.apply(ev);
  assert.equal(unpriced.run.costPartial, true);
});
