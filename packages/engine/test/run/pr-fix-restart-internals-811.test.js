// #811 internals: transitions.js prMonitorSeed keeps a fix round the restart cut (its last `pr.fix` still
// `requested`), so resume.js startRecovered tells it failed and the card offers "Ask for a fix" again.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { prMonitorSeed } = require('../../engine/run/transitions');

const fix = (round, status) => ({ type: 'pr.fix', step_id: 'pr_monitor', url: 'https://github.com/o/r/pull/1', round, status, ids: ['c1'], note: '', requests: [] });

test('#811 prMonitorSeed: a round still requested at the restart is kept as interrupted', () => {
  const seed = prMonitorSeed([fix(1, 'requested'), fix(1, 'fixed'), fix(2, 'requested')], 'pr_monitor');
  assert.strictEqual(seed.prFixRounds, 2);
  assert.deepStrictEqual(seed.prFixInterrupted, { url: 'https://github.com/o/r/pull/1', round: 2, ids: ['c1'], note: '', requests: [] });
});

test('#811 prMonitorSeed: a round that ended (fixed or failed) is not interrupted', () => {
  assert.strictEqual(prMonitorSeed([fix(1, 'requested'), fix(1, 'failed')], 'pr_monitor').prFixInterrupted, null);
  assert.strictEqual(prMonitorSeed([], 'pr_monitor').prFixInterrupted, null);
});
