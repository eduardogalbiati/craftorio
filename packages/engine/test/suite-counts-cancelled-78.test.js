// #78 splitCancelled (packages/engine/engine/suite-counts.js): the parsed failures of a suite log split
// into the red ones and the ones the runner cancelled or never finished (node:test's pending-promise
// message, or a `fail 0` / `cancelled N` summary). Only the red ones are filed by the base check.
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitCancelled, isCancelled } = require('../engine/suite-counts');

const PENDING = "'Promise resolution is still pending but the event loop has already resolved'";
const A = { test: 'cart totals include tax', file: 'test/cart.test.js', error: 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal' };
const B = { test: 'tax rounds half up', file: 'test/tax.test.js', error: 'AssertionError [ERR_ASSERTION]: 0.5 !== 1' };
const C = { test: 'test/pages.test.js', file: 'test/pages.test.js', error: PENDING };

const summary = (fail, cancelled) => ['ℹ tests 10', `ℹ pass ${10 - fail - cancelled}`, `ℹ fail ${fail}`, `ℹ cancelled ${cancelled}`, 'ℹ skipped 0'].join('\n');
const names = ({ failed, cancelled }) => ({ failed: failed.map((f) => f.test), cancelled: cancelled.map((f) => f.test) });

test('#78 a log with fail 0 and cancelled N: every parsed failure is a cancellation', () => {
  const log = `${summary(0, 1)}\n✖ failing tests:\n`;
  assert.deepEqual(names(splitCancelled(log, [{ ...C, error: 'test failed' }])), { failed: [], cancelled: ['test/pages.test.js'] });
});

test('#78 a log with fail 1 and cancelled 1: the assertion failure stays red, the pending file is cancelled', () => {
  assert.deepEqual(names(splitCancelled(summary(1, 1), [A, C])), { failed: ['cart totals include tax'], cancelled: ['test/pages.test.js'] });
});

test('#78 a log with two node summaries (fail 2, then fail 0 / cancelled 1) keeps the two real failures red', () => {
  // e.g. a test script that runs node --test twice: the first run failed two tests, the second was cut short
  const log = [summary(2, 0), '✖ failing tests:', '', summary(0, 1), '✖ failing tests:', ''].join('\n');
  assert.deepEqual(names(splitCancelled(log, [A, B, C])), { failed: ['cart totals include tax', 'tax rounds half up'], cancelled: ['test/pages.test.js'] });
});

test('#78 no summary and no failure: nothing either way', () => {
  assert.deepEqual(names(splitCancelled('', [])), { failed: [], cancelled: [] });
});

test('#78 isCancelled: the pending-promise message is a cancellation, an assertion is not', () => {
  assert.deepEqual([isCancelled(C), isCancelled(A), isCancelled({}), isCancelled(null)], [true, false, false, false]);
});
