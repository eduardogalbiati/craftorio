// #81 What the Run screen says of a run on a project with no test runner. Acceptance tests written
// before the code.
//
// Seam: the whole page in its harness (packages/ui-kit/test/renderer-app-harness.js), the run's
// tested pill (testedPillHtml, as run-no-tests-71.test.js calls it), in English with the real catalog.
//
// Contract chosen here: the run's `tested` is "no test command" (summary.json and the run's row); its
// pill reads "Not tested: no test command", never that the tests failed or that the project has no tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('@craftorio/ui-kit/test/renderer-app-harness');

async function openPage(t) {
  const page = loadApp({ api: { listActiveRuns: async () => [] } });
  await page.boot();
  page.run("I18n.setLanguage('en')");
  t.after(() => page.run("I18n.setLanguage('en')"));
  return page;
}

test('#81 run: the pill of a run with no test command says "Not tested: no test command"', async (t) => {
  const page = await openPage(t);
  const pill = text(String(page.run("testedPillHtml({ tested: 'no test command', testedFailures: [] })")));
  assert.match(pill, /Not tested: no test command/i);
  assert.doesNotMatch(pill, /Not tested green|the project has no tests/i);
});
