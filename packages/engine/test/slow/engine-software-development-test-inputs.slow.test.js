// feature.yaml (remote mode) whole runs in mock mode (#203): every unit_tests x e2e_tests pair visits the
// test and suite steps it should (#630: was software-development.yaml, removed). Moved out of test/engine-helpers.js (#305), where it ran again in
// every file requiring the helper.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';
const { runSoftwareDevelopment } = require('../engine-helpers');

for (const unit_tests of ['write_and_run', 'run_existing', 'off']) {
  for (const e2e_tests of ['off', 'write', 'write_and_run']) {
    // #630/#223: the scenarios are written first, at acceptance_tests: only write_and_run visits the test step
    const testVisited = unit_tests === 'write_and_run';
    const suiteVisited = unit_tests !== 'off';
    test(`feature.yaml (remote): unit_tests=${unit_tests} x e2e_tests=${e2e_tests}: test visited=${testVisited}, suite visited=${suiteVisited}`, { timeout: 120000 }, async () => {
      const { finished } = await runSoftwareDevelopment({
        inputs: { unit_tests, e2e_tests },
        mockSequences: { verdict: ['approved'], tests_status: ['pass'], suite: { suite: ['pass'] } },
      });
      assert.equal(finished.status, 'success', finished.error);
      assert.equal(finished.summary.steps.test.visits > 0, testVisited, 'test step');
      assert.equal(finished.summary.steps.suite.visits > 0, suiteVisited, 'suite step');
    });
  }
}
