// scripts/test.js (#390): every test gets a timeout, so a hung test fails with its name instead of
// running (and holding the run's worktree) forever. The timeout is set by MULTIAGENT_TEST_TIMEOUT_MS
// here so the check takes seconds; the hung fixture ends by itself after 40 s whatever happens.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const HUNG_TEST = 'waits for a reply that never comes';

function fixtures(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-timeout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  fs.writeFileSync(path.join(dir, 'okfx-alpha.test.js'), "const test = require('node:test');\ntest('instant', () => {});\n");
  fs.writeFileSync(path.join(dir, 'hungfx-bravo.test.js'), [
    "const test = require('node:test');",
    'setTimeout(() => process.exit(3), 40000);',
    `test(${JSON.stringify(HUNG_TEST)}, () => new Promise(() => { setInterval(() => {}, 1000); }));`,
    '',
  ].join('\n'));
  return { dir, files: ['okfx-alpha', 'hungfx-bravo'].map((n) => path.join(dir, `${n}.test.js`)) };
}

test('a hung test fails on its timeout with its name and file, and the run ends', { timeout: 60000 }, (t) => {
  const { dir, files } = fixtures(t);
  const env = { ...process.env, MULTIAGENT_TEST_CONCURRENCY: '2', MULTIAGENT_AGENT_MODE: '1', MULTIAGENT_TEST_HUMAN_LOG: path.join(dir, 'human.log'), MULTIAGENT_TEST_TIMEOUT_MS: '2000' };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['scripts/test.js', ...files], { cwd: root, encoding: 'utf8', env, timeout: 30000 });
  assert.equal(r.error?.code, undefined, 'the run ends on its own, long before the hung test would');
  assert.equal(r.status, 1, 'the run fails');
  const report = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  assert.equal(report.passed >= 1, true, 'the other file still passes');
  const hung = (report.failures || []).filter((f) => String(f.test).includes(HUNG_TEST));
  assert.equal(hung.length >= 1, true, `the hung test is reported by name: ${JSON.stringify(report.failures)}`);
  assert.match(String(hung[0].file), /hungfx-bravo/, 'with its file');
});
