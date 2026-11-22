// packages/engine/engine/agent-test-report.js (#219): the failures-only JSON report of `node --test`, the
// agent-mode detection and the parsing of a suite's output. The reporter runs on real fixture
// test files in a temp folder (node --test --test-reporter), so the events are the runner's own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { isAgentMode, parseAgentReport, REPORTER } = require('../engine/agent-test-report');

const root = path.join(__dirname, '..', '..', '..');
// relative to the root (cwd): an absolute Windows path is read as a URL by --test-reporter
const reporterPath = './scripts/test-reporter-agent.js';
const slash = (p) => p.split(path.sep).join('/');

// A temp folder holding the given test files; returns the folder.
function fixtures(t, files) {
  // realpath: macOS's tmpdir is a link (/var → /private/var) and the reporter names files by their real path
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-report-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

// Runs the files with the agent reporter and returns the parsed report and the raw stdout.
// NODE_TEST_CONTEXT (set by the outer runner) would make the child a test file, not a runner.
function report(t, files, names) {
  const dir = fixtures(t, files);
  const args = ['--test', `--test-reporter=${reporterPath}`, ...names.map((n) => path.join(dir, n))];
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env });
  return { report: parseAgentReport(r.stdout), stdout: r.stdout, status: r.status, dir };
}

test('the agent reporter: a passing suite gives counts only, no failures, and one JSON line', (t) => {
  const { report: r, stdout } = report(t, {
    'pass.test.js': "const test = require('node:test');\ntest('one', () => {});\ntest('two', () => {});\n",
    'more.test.js': "const test = require('node:test');\ntest('three', () => {});\n",
  }, ['pass.test.js', 'more.test.js']);
  assert.equal(r.reporter, REPORTER);
  assert.equal(r.passed, 3);
  assert.equal(r.failed, 0);
  assert.deepEqual(r.failures, []);
  assert.equal(stdout.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).length, 1);
  assert.ok(!/✔|ℹ|TAP/.test(stdout), 'no human-readable text in the JSON report');
});

test('the agent reporter: per-file counts name the file of each passing test', (t) => {
  const { report: r, dir } = report(t, {
    'two.test.js': "const test = require('node:test');\ntest('a', () => {});\ntest('b', () => {});\n",
    'one.test.js': "const test = require('node:test');\ntest('c', () => {});\n",
  }, ['two.test.js', 'one.test.js']);
  assert.deepEqual(r.files, {
    [slash(path.join(dir, 'one.test.js'))]: { passed: 1, failed: 0 },
    [slash(path.join(dir, 'two.test.js'))]: { passed: 2, failed: 0 },
  });
});

test('the agent reporter: a failing assert gives the test, the file, the assert line, 3 error lines and expected/actual', (t) => {
  const { report: r, dir } = report(t, {
    'fail.test.js': [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "test('passes', () => {});",
      "test('fails on an assert', () => {",
      '  assert.deepEqual({ a: 1, b: 2, c: 3 }, { a: 1, b: 2, c: 4 });',
      '});',
      '',
    ].join('\n'),
  }, ['fail.test.js']);
  assert.equal(r.passed, 1);
  assert.equal(r.failed, 1);
  assert.equal(r.failures.length, 1);
  const [f] = r.failures;
  assert.equal(f.kind, 'test');
  assert.equal(f.test, 'fails on an assert');
  assert.equal(f.file, slash(path.join(dir, 'fail.test.js')));
  assert.equal(f.line, 5, 'the line of the failing assert, in the test file');
  assert.ok(f.error.split('\n').length <= 3, `at most 3 error lines, got: ${JSON.stringify(f.error)}`);
  assert.match(f.error, /^Expected values to be strictly deep-equal/);
  assert.ok(!/\bat \w/.test(f.error), 'no stack trace in the error');
  assert.ok('expected' in f && 'actual' in f, 'a comparison failure carries expected and actual');
});

test('the agent reporter: a strictEqual failure gives its expected and actual values as text', (t) => {
  const { report: r } = report(t, {
    'eq.test.js': "const test = require('node:test');\nconst assert = require('node:assert/strict');\ntest('sums', () => {\n  assert.strictEqual(1 + 1, 3);\n});\n",
  }, ['eq.test.js']);
  assert.equal(r.failures[0].line, 4);
  assert.equal(r.failures[0].expected, '3');
  assert.equal(r.failures[0].actual, '2');
});

test('the agent reporter: a test file that cannot run (a syntax error) is one failure of kind file, with the error', (t) => {
  const { report: r, dir } = report(t, {
    'broken.test.js': "const test = require('node:test');\ntest('ok', () => {});\nfunction broke( {\n",
    'fine.test.js': "const test = require('node:test');\ntest('ok', () => {});\n",
  }, ['broken.test.js', 'fine.test.js']);
  assert.equal(r.passed, 1);
  assert.equal(r.failed, 1);
  assert.equal(r.failures.length, 1);
  const [f] = r.failures;
  assert.equal(f.kind, 'file');
  assert.equal(f.file, slash(path.join(dir, 'broken.test.js')));
  assert.match(f.error, /SyntaxError/, 'the stderr says why the file could not run');
  assert.equal(r.files[slash(path.join(dir, 'broken.test.js'))].failed, 1);
});

test('the agent reporter: a skipped test counts as skipped, not as passed or failed', (t) => {
  const { report: r } = report(t, {
    'skip.test.js': "const test = require('node:test');\ntest('runs', () => {});\ntest('skipped', { skip: true }, () => {});\n",
  }, ['skip.test.js']);
  assert.equal(r.passed, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.failed, 0);
});

test('isAgentMode: CRAFTORIO_AGENT_MODE=1 is an agent and =0 is a human, whatever else is set', () => {
  assert.equal(isAgentMode({ CRAFTORIO_AGENT_MODE: '1' }, { isTTY: true }), true);
  assert.equal(isAgentMode({ CRAFTORIO_AGENT_MODE: 'true', CI: '1' }), true);
  assert.equal(isAgentMode({ CRAFTORIO_AGENT_MODE: '0', CRAFTORIO_SIMULATION_ONLY: '1' }), false);
  assert.equal(isAgentMode({ CRAFTORIO_AGENT_MODE: 'off', CLAUDECODE: '1' }, { isTTY: false }), false);
});

test('isAgentMode: a terminal or CI stays human, without an explicit setting', () => {
  assert.equal(isAgentMode({ CI: 'true', CRAFTORIO_SIMULATION_ONLY: '1' }), false);
  assert.equal(isAgentMode({ CLAUDECODE: '1' }, { isTTY: true }), false);
  assert.equal(isAgentMode({}, { isTTY: false }), false);
});

test('isAgentMode: the orchestrator variable or an agent CLI marker means an agent', () => {
  assert.equal(isAgentMode({ CRAFTORIO_SIMULATION_ONLY: '1' }, { isTTY: false }), true);
  assert.equal(isAgentMode({ CLAUDECODE: '1' }, { isTTY: false }), true);
  assert.equal(isAgentMode({ CODEX_SANDBOX: 'seatbelt' }, { isTTY: false }), true);
  assert.equal(isAgentMode({ CRAFTORIO_SIMULATION_ONLY: '' }, { isTTY: false }), false, 'an empty variable is not set');
});

test('parseAgentReport: finds the JSON line among the npm noise of a suite output', () => {
  const json = JSON.stringify({ reporter: REPORTER, passed: 2, failed: 0, failures: [] });
  const text = `\n> multiagent@1.0.0 test\n> node scripts/test.js\n== Unit tests ==\n${json}\n`;
  assert.deepEqual(parseAgentReport(text), { reporter: REPORTER, passed: 2, failed: 0, failures: [] });
});

test('parseAgentReport: returns null when there is no agent report in the output', () => {
  assert.equal(parseAgentReport('ℹ tests 3\nℹ pass 3\n'), null);
  assert.equal(parseAgentReport('{"reporter":"other","failures":[]}'), null);
  assert.equal(parseAgentReport('{"reporter":"multiagent-agent","failures":'), null, 'a truncated line is not a report');
  assert.equal(parseAgentReport(''), null);
  assert.equal(parseAgentReport(undefined), null);
});

test('scripts/test.js in agent mode with a focused file list: stdout is one JSON line, the human log exists', (t) => {
  const dir = fixtures(t, {
    'ok.test.js': "const test = require('node:test');\ntest('one', () => {});\n",
    'bad.test.js': "const test = require('node:test');\nconst assert = require('node:assert/strict');\ntest('two', () => {\n  assert.equal(1, 2);\n});\n",
  });
  const log = path.join(dir, 'human.log');
  const env = { ...process.env, CRAFTORIO_AGENT_MODE: '1', CRAFTORIO_TEST_HUMAN_LOG: log };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['scripts/test.js', path.join(dir, 'ok.test.js'), path.join(dir, 'bad.test.js')], { cwd: root, encoding: 'utf8', env });
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, 'stdout is one JSON line only');
  const out = JSON.parse(lines[0]);
  assert.equal(out.reporter, REPORTER);
  assert.equal(out.passed, 1);
  assert.equal(out.failed, 1);
  assert.equal(out.failures.length, 1);
  assert.equal(out.failures[0].test, 'two');
  assert.equal(out.failures[0].line, 4);
  assert.equal(r.status, 1);
  assert.ok(fs.existsSync(log), 'the human-readable report is written to the log');
  assert.ok(fs.readFileSync(log, 'utf8').includes('two'), 'the log is the human report of the run, with the failing test');
});
