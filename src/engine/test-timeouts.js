// Per-test budgets of this project's suite (#402): a hung test fails fast and by name, and the round
// goes on, instead of the suite step's own timeout killing the whole round with no failure named.
// `testTimeoutMs(file, env)` is the `--test-timeout` scripts/test.js gives a file's tests:
// UNIT_TEST_TIMEOUT_MS for test/*.test.js, SLOW_TEST_TIMEOUT_MS for the slow files (a slow/ folder or
// *.slow.test.js, #305/#306: affected-tests.js isSlow). MULTIAGENT_TEST_TIMEOUT_MS overrides every file (#390: 0 = none; blank
// or invalid keeps the default); a test may still set its own `{ timeout }`.
// MAX_TEST_TIMEOUT_MS is the largest default budget: the suite step's timeout stays above it plus a
// margin (suite-step.js suiteTimeout), a backstop a single hung test can no longer reach.
// Measured before the change (#402, two full rounds, 2026-10-15, 607/615 files, concurrency 19,
// 220/233 s): slowest test 68 s (test/slow/contract-repeatable-339), slowest outside test/slow/ 23 s
// (workflow-builder); slowest file 122 s (screenshot-seed-modules-249, outside test/slow/), slowest
// under test/slow/ 91 s (ai-development-local-hero). The budgets are per test, about 4× these.

const { isSlow } = require('./affected-tests');

const UNIT_TEST_TIMEOUT_MS = 90e3;
const SLOW_TEST_TIMEOUT_MS = 5 * 60e3;
const MAX_TEST_TIMEOUT_MS = Math.max(UNIT_TEST_TIMEOUT_MS, SLOW_TEST_TIMEOUT_MS);

// The override in ms, or null when unset, blank or invalid (a negative number, not a number)
function overrideMs(env = process.env) {
  const raw = String(env.MULTIAGENT_TEST_TIMEOUT_MS ?? '').trim();
  if (!raw) return null;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function testTimeoutMs(file, env = process.env) {
  const ms = overrideMs(env);
  if (ms != null) return ms;
  // the slow-file rule of the affected selection (affected-tests.js isSlow), on a Windows path too
  return isSlow(String(file || '').replace(/\\/g, '/')) ? SLOW_TEST_TIMEOUT_MS : UNIT_TEST_TIMEOUT_MS;
}

module.exports = {
  MAX_TEST_TIMEOUT_MS,
  overrideMs,
  SLOW_TEST_TIMEOUT_MS,
  testTimeoutMs,
  UNIT_TEST_TIMEOUT_MS,
};
