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

// resume.js startRecovered on a recovered run in its PR monitor (no turn the crash cut)
function recoveredRun(prFixInterrupted) {
  const { methods } = require('../../engine/run/resume');
  const events = [];
  const run = {
    ...methods,
    wf: { steps: [{ id: 'pr_monitor', type: 'pr_monitor' }], agents: {} },
    recovered: { nextStep: 'pr_monitor', lostTurns: [], from: 7 },
    prFixInterrupted,
    emitEvent: (type, data) => events.push({ type, ...data }),
    syncGateClock: () => {}, // #10: startRecovered closes the gate clock restored from the log (costs.js)
  };
  return { run, events };
}

test('#811 startRecovered: a fix round the restart cut ends failed with its reason, and is told once', () => {
  const cut = { url: 'https://github.com/o/r/pull/1', round: 2, ids: ['c1'], note: 'n', requests: [] };
  const { run, events } = recoveredRun(cut);
  run.startRecovered();
  const fixes = events.filter((e) => e.type === 'pr.fix');
  assert.deepStrictEqual(fixes.map((e) => [e.step_id, e.url, e.round, e.status, e.reason]), [['pr_monitor', 'https://github.com/o/r/pull/1', 2, 'failed', 'the app restarted during the fix']]);
  assert.strictEqual(run.prFixInterrupted, null);
  assert.strictEqual(events.some((e) => e.type === 'run.recovered'), true);
});

test('#811 startRecovered: no round cut, no pr.fix event', () => {
  const { run, events } = recoveredRun(null);
  run.startRecovered();
  assert.strictEqual(events.filter((e) => e.type === 'pr.fix').length, 0);
});
