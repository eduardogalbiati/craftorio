// scripts/test.js (#705): when a group's child runner dies before writing its agent report, the
// '(the test runner)' failure says which group died and how: it names the group's files and its exit
// status, and its error is never the "== Slowest test files ==" listing printed just before.
// Runs the script in agent mode on two fixture files in a temp folder, one per group (#402): a unit
// file that kills its group's runner (its parent process) and a slow file that passes, so the
// slowest-files listing is printed after the dead group and before the report is built.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const KILLER = 'runner-killer-705';
const SURVIVOR = 'runner-survivor-705';

function fixtures(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-dead-group-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const killer = path.join(dir, `${KILLER}.test.js`);
  const survivor = path.join(dir, `${SURVIVOR}.slow.test.js`);
  // the test file's parent is its group's child runner (`scripts/test.js --child`): it dies with no report
  fs.writeFileSync(killer, "const test = require('node:test');\ntest('kills its runner', () => { process.kill(process.ppid, 'SIGKILL'); setTimeout(() => process.exit(0), 200); });\n");
  fs.writeFileSync(survivor, "const test = require('node:test');\ntest('passes', () => {});\n");
  return { dir, killer, survivor };
}

test('a group runner that dies without its report fails with its files and exit status, not the slowest files', (t) => {
  const { dir, killer, survivor } = fixtures(t);
  const log = path.join(dir, 'human.log');
  const env = { ...process.env, MULTIAGENT_AGENT_MODE: '1', MULTIAGENT_TEST_HUMAN_LOG: log, MULTIAGENT_TEST_CONCURRENCY: '2' };
  delete env.NODE_TEST_CONTEXT;
  delete env.MULTIAGENT_TEST_TIMEOUT_MS;
  const r = spawnSync(process.execPath, ['scripts/test.js', killer, survivor], { cwd: root, encoding: 'utf8', env, timeout: 60000 });
  const human = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  assert.equal(r.status, 1, `the run fails\nstderr: ${r.stderr}\nhuman log:\n${human.slice(-1500)}`);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `stdout is one JSON line: ${r.stdout}`);
  const report = JSON.parse(lines[0]);
  // the setup really reproduces the issue: the other group's slowest-files listing is in the human log
  assert.match(human, /== Slowest test files/, 'the slowest files were printed');
  const dead = report.failures.find((f) => f.test === '(the test runner)');
  assert.ok(dead, `a '(the test runner)' failure: ${JSON.stringify(report.failures)}`);
  const said = `${dead.file}\n${dead.error}`;
  assert.ok(said.includes(KILLER), `the failure names the dead group's file ${KILLER}: ${JSON.stringify(dead)}`);
  assert.ok(!said.includes(SURVIVOR), `the failure does not name the other group's file: ${JSON.stringify(dead)}`);
  assert.match(said, /\b(exit|status|code)\b\D{0,20}(\d+|SIG[A-Z]+)|SIG[A-Z]+/i, `the failure gives the exit status or signal: ${JSON.stringify(dead)}`);
  assert.ok(!/Slowest/i.test(dead.error), `the error is not the slowest-files listing: ${JSON.stringify(dead.error)}`);
  for (const l of String(dead.error).split(/\r?\n/)) assert.doesNotMatch(l, /^\s*\d+\.\d s\s/, `the error has no slowest-files line: ${JSON.stringify(dead.error)}`);
});
