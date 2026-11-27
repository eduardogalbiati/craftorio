// #124 internals: safeGateAnswer (packages/engine/engine/run/supervision.js), the rule that decides
// whether the supervisor on call may take an escalation gate's answer without the owner.
const test = require('node:test');
const assert = require('node:assert/strict');
const { safeGateAnswer } = require('../../engine/run/supervision');

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

test('#124 safeGateAnswer: the engine\'s base confirmation of every failure makes it safe; a "preexisting" claim alone is unconfirmed', () => {
  const t = [{ when: "choice == 'continue'", goto: 'verify' }];
  assert.deepEqual(ask('continue', t, { suiteOutput: { failures: [], preexisting_failures: [{ test: 'a' }] } }), { safe: 'confirmed' });
  const claim = 'The failures are preexisting: they fail on main too.';
  assert.deepEqual(ask('continue', t, { explanation: claim, suiteOutput: { failures: [{ test: 'b' }], preexisting_failures: [{ test: 'a' }] } }), { held: 'unconfirmed' });
  assert.deepEqual(ask('continue', t, { explanation: claim, suiteOutput: null }), { held: 'unconfirmed' });
});
