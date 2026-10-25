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
const { SUITE_SLOT_ENV } = require('../engine/machine-slot');

const root = path.join(__dirname, '..', '..', '..');
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

// #597: no test file on the child's command line, whatever the number of files. A Windows command
// line holds 32,767 characters (CreateProcess); these lists are longer, so a runner that still put
// the files in the child's arguments dies with spawn ENAMETOOLONG there.
const WINDOWS_COMMAND_LINE = 32767;
const PASSING = "const test = require('node:test');\ntest('passes', () => {});\n";

// test files in <dir> until the paths, as `shown` gives them, take more than `chars` characters;
// each path stays under Windows' MAX_PATH
function longFileList(dir, suffix, chars, shown = (f) => f) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  let total = 0;
  for (let i = 0; total <= chars; i++) {
    const head = `f${i}-`;
    const pad = Math.max(8, Math.min(150, 235 - dir.length - 1 - head.length - suffix.length));
    const file = path.join(dir, `${head}${'x'.repeat(pad)}${suffix}`);
    fs.writeFileSync(file, PASSING);
    files.push(file);
    total += shown(file).length + 1;
  }
  return { files, total };
}

test('#597 the whole suite of a workspace starts with more test files than a Windows command line holds, in both time-budget groups', { timeout: 300000 }, (t) => {
  const dir = tmpDir(t);
  const locks = path.join(dir, 'locks');
  const ws = path.join(dir, 'ws');
  const shown = (f) => path.relative(root, f);
  // a fast group (test/) and a slow group (*.slow.test.js), each past the limit on its own
  const fast = longFileList(path.join(ws, 'test'), '.test.js', WINDOWS_COMMAND_LINE + 2000, shown);
  const slow = longFileList(path.join(ws, 'test', 'more'), '.slow.test.js', WINDOWS_COMMAND_LINE + 2000, shown);
  assert.ok(fast.total > WINDOWS_COMMAND_LINE && slow.total > WINDOWS_COMMAND_LINE, 'each group is longer than a Windows command line');
  const r = spawnSync(process.execPath, ['scripts/test.js', '--workspace', ws], { cwd: root, encoding: 'utf8', env: agentEnv(dir, locks, { MULTIAGENT_TEST_CONCURRENCY: '2' }), timeout: 280000 });
  assert.equal(r.error?.code, undefined, `the run ends on its own: ${humanLog(dir).slice(0, 300)}`);
  assert.doesNotMatch(`${r.stderr}\n${humanLog(dir)}`, /ENAMETOOLONG/, 'no file list on the command line');
  const lines = r.stdout.trim().split(/\r?\n/);
  const out = JSON.parse(lines[lines.length - 1]);
  assert.equal(out.reporter, REPORTER);
  assert.equal(out.failed, 0, humanLog(dir).slice(0, 500));
  assert.equal(out.passed, fast.files.length + slow.files.length, 'every file of both groups ran');
  assert.equal(r.status, 0);
});

test('#597 a MULTIAGENT_TEST_FILES list longer than a Windows command line starts, and the tests never inherit the list', { timeout: 300000 }, (t) => {
  const dir = tmpDir(t);
  const { locks } = hold(dir);
  const { files, total } = longFileList(path.join(dir, 'sel'), '.test.js', WINDOWS_COMMAND_LINE + 2000);
  assert.ok(total > WINDOWS_COMMAND_LINE, 'the list is longer than a Windows command line');
  const inherits = path.join(dir, 'sel', 'inherits.test.js');
  fs.writeFileSync(inherits, "const test = require('node:test');\nconst assert = require('node:assert/strict');\ntest('the list is not inherited', () => {\n  assert.equal(process.env.MULTIAGENT_TEST_FILES, undefined);\n});\n");
  const list = path.join(dir, 'files.txt');
  fs.writeFileSync(list, [...files, inherits].join('\n'));
  const r = spawnSync(process.execPath, ['scripts/test.js'], { cwd: root, encoding: 'utf8', env: agentEnv(dir, locks, { MULTIAGENT_TEST_FILES: list, MULTIAGENT_TEST_CONCURRENCY: '2' }), timeout: 280000 });
  assert.equal(r.error?.code, undefined, `the run ends on its own (a whole suite would wait for the slot): ${humanLog(dir).slice(0, 300)}`);
  assert.doesNotMatch(`${r.stderr}\n${humanLog(dir)}`, /ENAMETOOLONG/, 'no file list on the command line');
  const lines = r.stdout.trim().split(/\r?\n/);
  const out = JSON.parse(lines[lines.length - 1]);
  assert.equal(out.reporter, REPORTER);
  assert.equal(out.failed, 0, JSON.stringify(out.failures || []).slice(0, 500));
  assert.equal(out.passed, files.length + 1, 'every listed file ran, and only those');
  assert.equal(r.status, 0);
});

test('#597 a selection on the command line runs only the named files, as before', { timeout: 60000 }, (t) => {
  const dir = tmpDir(t);
  const { locks } = hold(dir);
  const a = path.join(dir, 'cli-a.test.js');
  const b = path.join(dir, 'cli-b.test.js');
  fs.writeFileSync(a, PASSING);
  fs.writeFileSync(b, PASSING);
  const r = spawnSync(process.execPath, ['scripts/test.js', a, b], { cwd: root, encoding: 'utf8', env: agentEnv(dir, locks), timeout: 30000 });
  assert.equal(r.error?.code, undefined, `the run ends on its own: ${humanLog(dir).slice(0, 300)}`);
  const lines = r.stdout.trim().split(/\r?\n/);
  const out = JSON.parse(lines[lines.length - 1]);
  assert.equal(out.passed, 2);
  assert.equal(out.failed, 0);
  assert.equal(r.status, 0);
});
