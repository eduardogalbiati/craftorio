// scripts/test.js and the list of test files (#553, acceptance tests written before the code): a
// selection too long for the command line reaches the runner as a list file named by
// MULTIAGENT_TEST_FILES (one path per line). The runner runs only the listed files, as a focused run:
// it never waits for the machine-wide suite slot (#455), which another run holds here, so a runner
// that ignored the list would start the whole suite and wait (the spawn's timeout ends it).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { SUITE_SLOT_ENV } = require('../src/engine/machine-slot');

const root = path.join(__dirname, '..');
const REPORTER = 'multiagent-agent';

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-file-list-553-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return dir;
}

// another run's hold of the suite slot in <dir>/locks/suite.slot
function hold(dir) {
  const locks = path.join(dir, 'locks');
  fs.mkdirSync(locks, { recursive: true });
  const slot = path.join(locks, 'suite.slot');
  fs.writeFileSync(slot, JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'other-run-token', started: Date.now(), holder: 'run-a' }));
  return { locks, slot };
}

function agentEnv(dir, locks, extra = {}) {
  const env = { ...process.env, MULTIAGENT_AGENT_MODE: '1', MULTIAGENT_TEST_CONCURRENCY: '1', MULTIAGENT_TEST_HUMAN_LOG: path.join(dir, 'human.log'), MULTIAGENT_LOCKS_DIR: locks };
  delete env.NODE_TEST_CONTEXT;
  delete env[SUITE_SLOT_ENV];
  delete env.MULTIAGENT_TEST_FILES;
  return { ...env, ...extra };
}

const humanLog = (dir) => { try { return fs.readFileSync(path.join(dir, 'human.log'), 'utf8'); } catch { return ''; } };

test('scripts/test.js runs only the files listed in MULTIAGENT_TEST_FILES, as a focused run (#553)', { timeout: 60000 }, (t) => {
  const dir = tmpDir(t);
  const { locks, slot } = hold(dir);
  const ok = path.join(dir, 'listfx-ok.test.js');
  const bad = path.join(dir, 'listfx-bad.test.js');
  fs.writeFileSync(ok, "const test = require('node:test');\ntest('listed one', () => {});\n");
  fs.writeFileSync(bad, "const test = require('node:test');\nconst assert = require('node:assert/strict');\ntest('listed two', () => {\n  assert.equal(1, 2);\n});\n");
  const list = path.join(dir, 'files.txt');
  fs.writeFileSync(list, `${ok}\n${bad}\n`);
  const r = spawnSync(process.execPath, ['scripts/test.js'], { cwd: root, encoding: 'utf8', env: agentEnv(dir, locks, { MULTIAGENT_TEST_FILES: list }), timeout: 30000 });
  assert.equal(r.error?.code, undefined, `the run ends on its own (a whole suite would wait for the slot): ${humanLog(dir).slice(0, 300)}`);
  assert.doesNotMatch(humanLog(dir), /waiting for the suite slot/, 'a listed run never waits for the suite slot');
  const lines = r.stdout.trim().split(/\r?\n/);
  const out = JSON.parse(lines[lines.length - 1]);
  assert.equal(out.reporter, REPORTER);
  assert.equal(out.passed, 1, 'only the listed files ran');
  assert.equal(out.failed, 1);
  assert.equal(out.failures[0].test, 'listed two');
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(fs.readFileSync(slot, 'utf8')).holder, 'run-a', 'the other run keeps its slot');
});
