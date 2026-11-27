// #124 internals: safeGateAnswer (packages/engine/engine/run/supervision.js), the rule that decides
// whether the supervisor on call may take an escalation gate's answer without the owner.
const test = require('node:test');
const assert = require('node:assert/strict');
const { methods, safeGateAnswer } = require('../../engine/run/supervision');
const { gateBrief } = require('../../engine/gate-summary');

const steps = [{ id: 'develop' }, { id: 'suite' }, { id: 'gate' }, { id: 'verify' }];
const gate = (transitions) => Object.assign(steps[2], { transitions });
const visited = (id) => id === 'develop' || id === 'suite';
const scope = (choice) => ({ choice, output: { choice } });
const ask = (route, transitions, more = {}) => safeGateAnswer({ steps, step: gate(transitions), route, recommended: null, scope: scope(route), visited, ...more });

test('#124 safeGateAnswer: the recommended answer is safe whatever its transition does', () => {
  assert.deepEqual(ask('continue', [{ when: "choice == 'continue'", goto: 'verify', merge: 'local' }], { recommended: 'continue' }), { safe: 'recommended' });
});

test('#124 safeGateAnswer: an end as failed, `fail` or going back to a visited earlier step merges nothing', () => {
  assert.deepEqual(ask('stop', [{ when: "choice == 'stop'", goto: 'end', status: 'failed' }]), { safe: 'no_merge' });
  assert.deepEqual(ask('stop', [{ when: "choice == 'stop'", goto: 'fail' }]), { safe: 'no_merge' });
  assert.deepEqual(ask('retry', [{ when: "choice == 'retry'", goto: 'develop' }]), { safe: 'no_merge' });
});

test('#124 safeGateAnswer: an end with no status, a later step, a merge, a ship or an action is held', () => {
  for (const t of [
    { goto: 'end' },
    { goto: 'verify' },
    { goto: 'end', status: 'failed', merge: 'local' },
    { goto: 'end', status: 'failed', ship: { tag: 'v1' } },
    { goto: 'develop', action: 'git push' },
  ]) assert.deepEqual(ask('go', [{ when: "choice == 'go'", ...t }]), { held: 'unsafe' }, JSON.stringify(t));
});

test('#124 safeGateAnswer: the engine\'s base confirmation of every failure makes it safe; failures it did not confirm are unconfirmed, whatever the text says', () => {
  const t = [{ when: "choice == 'continue'", goto: 'verify' }];
  assert.deepEqual(ask('continue', t, { suiteOutput: { failures: [], preexisting_failures: [{ test: 'a' }] } }), { safe: 'confirmed' });
  assert.deepEqual(ask('continue', t, { suiteOutput: { failures: [{ test: 'b' }], preexisting_failures: [{ test: 'a' }] } }), { held: 'unconfirmed' });
  assert.deepEqual(ask('continue', t, { suiteOutput: null }), { held: 'unsafe' });
});

// gateAnswerVerdict reads the suite only when the gate came from it (review #124: a verify_failed gate
// after a suite green with preexisting failures must not count them)
const verdictOf = (previous) => methods.gateAnswerVerdict.call({
  wf: { steps: [{ id: 'develop' }, { id: 'suite', type: 'suite' }, { id: 'verify' }, VERIFY_GATE, { id: 'merge' }] },
  ctx: { previous_step: previous, steps: { develop: { visits: 1 }, suite: { visits: 1, output: { status: 'pass', failures: [], preexisting_failures: [{ test: 'a' }] } }, verify: { visits: 1 } } },
}, VERIFY_GATE, { route: 'approved' }, { recommend: 'reject: the verification failed.' }, ['approve', 'reject']);
const VERIFY_GATE = { id: 'verify_failed', type: 'human_approval', kind: 'escalation', transitions: [{ when: 'approved', goto: 'merge' }, { when: 'rejected', goto: 'end', status: 'failed' }] };

test('#124 gateAnswerVerdict: a gate reached from another step never counts the suite\'s preexisting failures', () => {
  assert.deepEqual(verdictOf('verify'), { held: 'unsafe' });
  assert.deepEqual(verdictOf('suite'), { safe: 'confirmed' });
});

test('#124 gateBrief: an answer the supervisor held back keeps the workflow\'s recommendation on the card', () => {
  const answers = [{ id: 'continue', label: 'Continue' }, { id: 'stop', label: 'Stop the run' }];
  const held = gateBrief({ message: 'Red.', recommend: 'stop: not green.', answers, diagnosis: { explanation: 'x', recommend: 'continue', recommendation: 'go', answer: 'continue', answered: false } });
  assert.equal(held.recommendation.source, 'workflow');
  assert.equal(held.recommendation.answer, 'stop');
  const advised = gateBrief({ message: 'Red.', recommend: 'stop: not green.', answers, diagnosis: { explanation: 'x', recommend: 'continue', recommendation: 'go' } });
  assert.equal(advised.recommendation.source, 'supervisor');
});
