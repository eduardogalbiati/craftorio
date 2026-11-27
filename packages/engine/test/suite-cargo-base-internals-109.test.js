// #109 internals of the cargo base check: the base's result is cached per commit + test name, and a
// test name cargo cannot take as a filter (a doctest) runs the whole `cargo test` on the base.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkOnBase } = require('../engine/suite-step');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

const failedLog = (name) => `running 1 test\ntest ${name} ... FAILED\n\nfailures:\n\n---- ${name} stdout ----\nthread panicked\n\nfailures:\n    ${name}\n\ntest result: FAILED. 0 passed; 1 failed\n`;

function setup(t, name) {
  const baseDir = tmp(t, 'cargo109i-base-');
  const runDir = tmp(t, 'cargo109i-run-');
  const calls = [];
  const run = async ({ command, logFile }) => {
    calls.push(String(command));
    fs.appendFileSync(logFile, failedLog(name));
    return { code: 101, timedOut: false };
  };
  const opts = { command: 'cargo test', base: async () => ({ dir: baseDir, commit: 'abc1234def' }), run, runDir, logFile: path.join(runDir, 'logs', 'suite-1-base.log'), cacheDir: path.join(runDir, 'cache') };
  return { calls, opts };
}

test('#109 a cargo test red on the base is cached by commit + name: the next check does not run it again', async (t) => {
  const s = setup(t, 'tests::legacy');
  const failures = [{ test: 'tests::legacy', file: '', error: '' }];
  const first = await checkOnBase({ ...s.opts, failures });
  assert.deepEqual(first.onBase.map((f) => f.test), ['tests::legacy']);
  assert.deepEqual(s.calls, ['cargo test --no-fail-fast -- tests::legacy']);
  const second = await checkOnBase({ ...s.opts, failures });
  assert.equal(s.calls.length, 1, 'served from the cache');
  assert.deepEqual(second.info.cached, ['tests::legacy']);
  assert.deepEqual(second.onBase.map((f) => f.test), ['tests::legacy']);
});

test('#109 a doctest name is not a cargo filter: the whole cargo test runs on the base', async (t) => {
  const name = 'src/lib.rs - add (line 3)';
  const s = setup(t, name);
  const { onBase, info } = await checkOnBase({ ...s.opts, cacheDir: null, failures: [{ test: name, file: '', error: '' }] });
  assert.equal(info.status, 'done');
  assert.deepEqual(s.calls, ['cargo test --no-fail-fast']);
  assert.deepEqual(onBase.map((f) => f.test), [name]);
});

test('#109 every cargo round runs with --no-fail-fast, once', async (t) => {
  const { runSuite } = require('../engine/suite-step');
  const cwd = tmp(t, 'cargo109i-cwd-');
  const runDir = tmp(t, 'cargo109i-round-');
  const calls = [];
  const run = async ({ command, logFile }) => {
    calls.push(String(command));
    fs.appendFileSync(logFile, 'running 1 test\ntest tests::adds ... ok\n\ntest result: ok. 1 passed; 0 failed\n');
    return { code: 0, timedOut: false };
  };
  await runSuite({ command: 'cargo test', cwd, runDir, round: 1, run, timeoutMs: 30e3 });
  await runSuite({ command: 'cargo test --no-fail-fast --workspace', cwd, runDir, round: 2, run, timeoutMs: 30e3 });
  assert.deepEqual(calls, ['cargo test --no-fail-fast', 'cargo test --no-fail-fast --workspace']);
});

test('#109 the same test name in two binaries: one red on the base, the other the change\'s', async (t) => {
  const { parseFailures } = require('../engine/suite-step');
  const block = (name) => `running 1 test\ntest ${name} ... FAILED\n\nfailures:\n\n---- ${name} stdout ----\nthread panicked\n\nfailures:\n    ${name}\n\ntest result: FAILED. 0 passed; 1 failed\n`;
  const branch = [
    '     Running unittests src/lib.rs (target/debug/deps/a-0123456789abcdef)', block('tests::parses'),
    '     Running unittests src/lib.rs (target\\debug\\deps\\b-fedcba9876543210.exe)', block('tests::parses'),
  ].join('\n');
  const failures = parseFailures(branch);
  assert.deepEqual(failures.map((f) => f.bin), ['a src/lib.rs', 'b src/lib.rs']);
  const baseDir = tmp(t, 'cargo109i-ws-');
  const runDir = tmp(t, 'cargo109i-wsrun-');
  const run = async ({ logFile }) => {
    fs.appendFileSync(logFile, ['     Running unittests src/lib.rs (target/debug/deps/a-99999999aaaaaaaa)', block('tests::parses')].join('\n'));
    return { code: 101, timedOut: false };
  };
  const opts = { command: 'cargo test', base: async () => ({ dir: baseDir, commit: 'abc1234def' }), run, runDir, logFile: path.join(runDir, 'logs', 'suite-1-base.log'), cacheDir: path.join(runDir, 'cache') };
  const first = await checkOnBase({ ...opts, failures });
  assert.deepEqual(first.onBase.map((f) => f.bin), ['a src/lib.rs']);
  const second = await checkOnBase({ ...opts, failures });
  assert.deepEqual(second.onBase.map((f) => f.bin), ['a src/lib.rs'], 'the cache keeps the binary');
});
