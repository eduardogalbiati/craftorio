// scripts/test-exit.js (#451), preloaded by scripts/test.js with --require instead of
// --test-force-exit (#390): a test file's process that a leftover handle keeps alive exits about 5 s
// after its last test, with its result kept; a file with nothing left running exits on its own. Each
// fixture ends by itself after 40 s (exit code 3) whatever happens, and writes the time its last test
// ended to a mark file, so the checks measure the grace from there.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const FAILING_TEST = 'fails and leaves a timer running';

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-grace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return dir;
}

// A test file whose only test writes its end time to `<name>.mark`; `handle` leaves an interval running.
function fixture(dir, name, { handle = true, fail = false, title = 'leaves a timer running' } = {}) {
  const file = path.join(dir, `${name}.test.js`);
  const mark = path.join(dir, `${name}.mark`);
  fs.writeFileSync(file, [
    "const test = require('node:test');",
    "const fs = require('fs');",
    'setTimeout(() => process.exit(3), 40000).unref();',
    `test(${JSON.stringify(title)}, () => {`,
    handle ? '  setInterval(() => {}, 1000);' : '',
    `  fs.writeFileSync(${JSON.stringify(mark)}, String(Date.now()));`,
    fail ? "  throw new Error('expected failure');" : '',
    '});',
    '',
  ].join('\n'));
  return { file, endedAt: () => Number(fs.readFileSync(mark, 'utf8')) };
}

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

test('scripts/test.js: a file a leftover handle keeps alive exits about 5 s after its last test, and its result is kept', { timeout: 90000 }, (t) => {
  const dir = tmpDir(t);
  const pass = fixture(dir, 'gracefx-alpha');
  const fail = fixture(dir, 'gracefx-bravo', { fail: true, title: FAILING_TEST });
  const env = cleanEnv({ MULTIAGENT_TEST_CONCURRENCY: '2', MULTIAGENT_AGENT_MODE: '1', MULTIAGENT_TEST_HUMAN_LOG: path.join(dir, 'human.log') });
  const r = spawnSync(process.execPath, ['scripts/test.js', pass.file, fail.file], { cwd: root, encoding: 'utf8', env, timeout: 60000 });
  const ended = Date.now();
  assert.equal(r.error?.code, undefined, 'the run ends on its own, long before the fixtures would');
  assert.equal(r.status, 1, `the failing file's result is kept: ${r.stderr}`);
  const report = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  assert.equal(report.passed >= 1, true, 'the passing file still passes');
  const failed = (report.failures || []).filter((f) => String(f.test).includes(FAILING_TEST));
  assert.equal(failed.length, 1, `the failing test is reported by name: ${JSON.stringify(report.failures)}`);
  const grace = ended - Math.max(pass.endedAt(), fail.endedAt());
  assert.equal(grace >= 3500, true, `the processes get a grace after their last test (not --test-force-exit): ${grace} ms`);
  assert.equal(grace < 20000, true, `then exit, about 5 s later: ${grace} ms`);
});

test('scripts/test-exit.js preloaded: a passing file a handle keeps alive exits with code 0 about 5 s after its last test', { timeout: 60000 }, (t) => {
  const dir = tmpDir(t);
  const fx = fixture(dir, 'gracefx-charlie');
  const r = spawnSync(process.execPath, ['--test', '--require', path.join(root, 'scripts', 'test-exit.js'), fx.file], { cwd: dir, encoding: 'utf8', env: cleanEnv(), timeout: 30000 });
  const ended = Date.now();
  assert.equal(r.error?.code, undefined, 'the process ends long before the fixture would');
  assert.equal(r.status, 0, `the passing result is kept: ${r.stderr}`);
  const grace = ended - fx.endedAt();
  assert.equal(grace >= 3500, true, `a grace after the last test: ${grace} ms`);
  assert.equal(grace < 20000, true, `then the process exits: ${grace} ms`);
});

test('scripts/test-exit.js preloaded: a file with nothing left running exits on its own, without waiting for the grace', { timeout: 60000 }, (t) => {
  const dir = tmpDir(t);
  const fx = fixture(dir, 'gracefx-delta', { handle: false });
  const r = spawnSync(process.execPath, ['--test', '--require', path.join(root, 'scripts', 'test-exit.js'), fx.file], { cwd: dir, encoding: 'utf8', env: cleanEnv(), timeout: 30000 });
  const ended = Date.now();
  assert.equal(r.status, 0, `the file passes and its process exits normally: ${r.stderr}`);
  const after = ended - fx.endedAt();
  assert.equal(after < 3500, true, `no grace when nothing keeps the process alive: ${after} ms`);
});
