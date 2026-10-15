// #402: a hung unit test fails in about a minute, by name, instead of timing out the whole suite
// round. The default per-test budget is short for test/*.test.js and longer for the slow files
// (test/slow/ or *.slow.test.js); MULTIAGENT_TEST_TIMEOUT_MS still overrides it. The agent report
// names a timed-out test with its file and "timed out after N s", and the round's other files still
// report. The suite step's timeout stays a backstop: always above the largest per-test budget.
// Seams: src/engine/test-timeouts.js's testTimeoutMs(file, env) (created by the change: loaded
// inside each test), scripts/test.js run as a process in agent mode, suite-step.js's suiteTimeout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const budgets = () => require('../src/engine/test-timeouts');
const UNIT = 'test/engine-suite-step.test.js';
const SLOW_FILES = ['test/slow/engine-run-split-250.slow.test.js', 'test/slow/worktree-engine.slow.test.js', 'test/x-run.slow.test.js'];
// the suite step's backstop must leave at least this much above the largest per-test budget
const MARGIN_MS = 60 * 1000;

test('#402 a unit test file gets a short default budget, well under the suite step\'s 10 minutes', () => {
  const ms = budgets().testTimeoutMs(UNIT, {});
  assert.equal(Number.isFinite(ms) && ms > 0, true, `a budget in ms: ${ms}`);
  assert.equal(ms <= 90 * 1000, true, `at most 90 s: ${ms}`);
});

test('#402 a slow file (test/slow/ or *.slow.test.js) gets a longer budget than a unit file, still under 10 minutes', () => {
  const { testTimeoutMs } = budgets();
  const unit = testTimeoutMs(UNIT, {});
  for (const file of SLOW_FILES) {
    const ms = testTimeoutMs(file, {});
    assert.equal(ms > unit, true, `${file}: ${ms} > ${unit}`);
    assert.equal(ms < 10 * 60 * 1000, true, `${file}: ${ms} under 10 min`);
  }
  // a Windows spelling of the same file gets the same budget
  assert.equal(testTimeoutMs('test\\slow\\worktree-engine.slow.test.js', {}), testTimeoutMs('test/slow/worktree-engine.slow.test.js', {}));
});

test('#402 MULTIAGENT_TEST_TIMEOUT_MS overrides the budget of every file; blank or invalid keeps the default', () => {
  const { testTimeoutMs } = budgets();
  for (const file of [UNIT, ...SLOW_FILES]) assert.equal(testTimeoutMs(file, { MULTIAGENT_TEST_TIMEOUT_MS: '2000' }), 2000, file);
  assert.equal(testTimeoutMs(UNIT, { MULTIAGENT_TEST_TIMEOUT_MS: ' ' }), testTimeoutMs(UNIT, {}));
  assert.equal(testTimeoutMs(UNIT, { MULTIAGENT_TEST_TIMEOUT_MS: 'abc' }), testTimeoutMs(UNIT, {}));
  assert.equal(testTimeoutMs(UNIT, { MULTIAGENT_TEST_TIMEOUT_MS: '-5' }), testTimeoutMs(UNIT, {}));
});

test('#402 the suite step\'s timeout is never under the largest per-test budget plus a margin', () => {
  const { testTimeoutMs } = budgets();
  const { suiteTimeout } = require('../src/engine/suite-step');
  const largest = Math.max(testTimeoutMs(UNIT, {}), ...SLOW_FILES.map((f) => testTimeoutMs(f, {})));
  const cases = [
    ['no history', suiteTimeout([])],
    ['a short history', suiteTimeout([1000, 2000, 3000])],
    ['a short fallback and minimum', suiteTimeout([], 1000, 1000)],
    ['a short history and minimum', suiteTimeout([1000], 1000, 1000)],
  ];
  for (const [what, ms] of cases) assert.equal(ms >= largest + MARGIN_MS, true, `${what}: ${ms} >= ${largest} + ${MARGIN_MS}`);
});

const HUNG_TEST = 'waits for a reply that never comes';
const FAILING_TEST = 'compares two different numbers';

test('#402 a hung test is reported by name and file, "timed out after N s", and the round\'s other files still report', { timeout: 60000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-budget-402-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  fs.writeFileSync(path.join(dir, 'okfx-alpha.test.js'), "const test = require('node:test');\ntest('instant', () => {});\n");
  fs.writeFileSync(path.join(dir, 'redfx-charlie.test.js'), `const test = require('node:test');\nconst assert = require('node:assert/strict');\ntest(${JSON.stringify(FAILING_TEST)}, () => assert.equal(1, 2));\n`);
  fs.writeFileSync(path.join(dir, 'hungfx-bravo.test.js'), [
    "const test = require('node:test');",
    'setTimeout(() => process.exit(3), 40000);',
    `test(${JSON.stringify(HUNG_TEST)}, () => new Promise(() => { setInterval(() => {}, 1000); }));`,
    '',
  ].join('\n'));
  const files = ['okfx-alpha', 'hungfx-bravo', 'redfx-charlie'].map((n) => path.join(dir, `${n}.test.js`));
  const env = { ...process.env, MULTIAGENT_TEST_CONCURRENCY: '3', MULTIAGENT_AGENT_MODE: '1', MULTIAGENT_TEST_HUMAN_LOG: path.join(dir, 'human.log'), MULTIAGENT_TEST_TIMEOUT_MS: '2000' };
  delete env.NODE_TEST_CONTEXT;
  const started = Date.now();
  const r = spawnSync(process.execPath, ['scripts/test.js', ...files], { cwd: root, encoding: 'utf8', env, timeout: 35000 });
  assert.equal(r.error?.code, undefined, 'the round ends on its own, long before the hung test would');
  assert.equal(Date.now() - started < 30000, true, 'within its budget plus the normal round time');
  assert.equal(r.status, 1, 'the round fails');
  const report = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  const failures = report.failures || [];
  const hung = failures.filter((f) => String(f.test).includes(HUNG_TEST));
  assert.equal(hung.length, 1, `the hung test is one named failure: ${JSON.stringify(failures)}`);
  assert.match(String(hung[0].file), /hungfx-bravo\.test\.js$/, 'with its file');
  assert.match(String(hung[0].error), /timed out after 2 s/, 'and how long it ran');
  const red = failures.filter((f) => String(f.test).includes(FAILING_TEST));
  assert.equal(red.length, 1, 'a plain failure of another file is still reported');
  assert.match(String(red[0].file), /redfx-charlie\.test\.js$/);
  assert.equal(report.passed >= 1, true, 'the passing file still reports');
});
