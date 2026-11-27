// #124: a gate crossed by the supervisor on call is visible on the Run screen's Chat (who, which answer,
// why), in the interface language. These are guards over what #71 already draws (they may be green now):
// RunChatModel turns the supervisor's escalation `route` into a supervisor message with `answered` (the
// gate's answer) and its explanation (the reason), and runchat.js draws `answered` with
// runchat.supervisor_answered_gate. A held-back answer (the gate opened for the owner instead, #124)
// is never drawn as answered.
// Seams: RunChatModel (fronts/build/views/runchat/run-chat-model.js) fed the run's events, and the
// catalogs packages/shared/i18n/en.json and pt-BR.json through I18n.
// Note: the issue's tests ask for packages/ui-kit/test; the Run screen's chat lives in fronts/build, so
// the test sits with the other run chat tests here.
const test = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('@craftorio/shared/i18n');
const { RunChatModel } = require('../views/runchat/run-chat-model');

const T = (m, s = 0) => new Date(Date.UTC(2026, 10, 27, 12, m, s)).toISOString();
const REASON = 'The engine confirmed both failures on the base (abc1234).';
test.afterEach(() => I18n.setLanguage('en'));

function chatOf(decision, finished) {
  const m = new RunChatModel();
  for (const ev of [
    { seq: 0, type: 'workflow.started', run_id: 'r1', workflow: 'feature', ts: T(0) },
    { seq: 1, type: 'step.started', step_id: 'test_failed', visit: 1, step_type: 'human_approval', agent: null, ts: T(1) },
    { seq: 2, type: 'supervisor.started', step_id: 'test_failed', kind: 'escalation', error: 'escalation gate: the run would ask you about a problem', ts: T(1, 1) },
    { seq: 3, type: 'supervisor.decision', step_id: 'test_failed', kind: 'escalation', explanation: REASON, ts: T(1, 2), ...decision },
    ...(finished ? [{ seq: 4, type: 'step.finished', step_id: 'test_failed', visit: 1, ts: T(1, 3), output: finished }] : []),
  ]) m.apply(ev);
  return m.items.filter((i) => i.kind === 'supervisor' && i.stepId === 'test_failed').map((i) => ({ answered: i.answered, explanation: i.explanation, action: i.action }));
}

test('#124 run chat: a gate the supervisor answered alone shows the supervisor, its answer and its reason', () => {
  const [it] = chatOf({ action: 'route', route: 'continue' }, { choice: 'continue', feedback: '', by: 'supervisor' });
  assert.ok(it, 'the chat has the supervisor\'s message on test_failed');
  assert.equal(it.answered, 'continue');
  assert.equal(it.explanation.includes(REASON), true);
});

test('#124 run chat: a supervisor answer held back for the owner (escalate) is never shown as answered', () => {
  const [it] = chatOf({ action: 'escalate', recommend: 'continue', recommendation: 'Continue: the failures are preexisting.', note: 'only the owner may take an answer that merges' }, null);
  assert.ok(it, 'the chat has the supervisor\'s message');
  assert.equal(it.answered, null);
});

test('#124 run chat: the answered line reads in the interface language (en and pt-BR differ, the answer kept)', () => {
  const en = I18n.t('runchat.supervisor_answered_gate', { answer: 'continue' });
  I18n.setLanguage('pt-BR');
  const pt = I18n.t('runchat.supervisor_answered_gate', { answer: 'continue' });
  assert.notEqual(pt, en);
  assert.equal(en.includes('continue') && pt.includes('continue'), true);
  assert.notEqual(pt, 'runchat.supervisor_answered_gate', 'the key exists');
});
