// src/engine/suite-step.js (#177): the `type: suite` step's pure parts (parseFailures,
// detectTestCommand, isFullSuiteCommand) and runSuite with a stubbed `run`, so no real process is
// spawned. The engine's wiring of this step (mockSequences.suite, transitions, summary.suite_runs,
// full_suite: warn) is in test/engine.test.js, next to the rest of the software-development flow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectTestCommand, isFullSuiteCommand, parseFailures, runSuite, suiteMessage } = require('../src/engine/suite-step');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-step-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------
// parseFailures
// ---------------------------------------------------------------------------

test('parseFailures: node:test spec reporter reads the test, file and the first lines of the error', () => {
  const text = `✖ failing tests:

test at test/sample.test.js:12:3
✖ adds two numbers (3.1ms)
  AssertionError [ERR_ASSERTION]: simulated failure
    expected: 1
    actual: 2

ℹ pass 41
ℹ fail 1
`;
  assert.deepEqual(parseFailures(text), [
    { test: 'adds two numbers', file: 'test/sample.test.js', error: 'AssertionError [ERR_ASSERTION]: simulated failure\nexpected: 1\nactual: 2' },
  ]);
});

test('parseFailures: node:test spec reporter skips a suite whose own line only reports its subtests failing', () => {
  const text = `✖ failing tests:

test at test/sample.test.js:5:1
✖ a suite (12.1ms)
  2 subtests failed
`;
  assert.deepEqual(parseFailures(text), []);
});

test('parseFailures: node:test TAP reads the location, error and skips a subtestsFailed failureType', () => {
  const text = `TAP version 13
# Subtest: adds two numbers
not ok 1 - adds two numbers
  ---
  duration_ms: 1.2
  location: 'test/sample.test.js:12:3'
  failureType: 'testCodeFailure'
  error: 'Error: simulated failure'
  ...
not ok 2 - a suite
  ---
  failureType: 'subtestsFailed'
  ...
1..2
`;
  assert.deepEqual(parseFailures(text), [
    { test: 'adds two numbers', file: 'test/sample.test.js', error: 'Error: simulated failure' },
  ]);
});

test('parseFailures: Jest reads FAIL <file> then the "<x> individual failing test', () => {
  const text = `FAIL src/sample.test.js
  Calculator
    ● Calculator › adds two numbers

    expect(received).toBe(expected)

    Expected: 3
    Received: 2

      10 |   it('adds', () => {
`;
  const out = parseFailures(text);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { test: 'Calculator › adds two numbers', file: 'src/sample.test.js', error: 'expect(received).toBe(expected)\nExpected: 3\nReceived: 2' });
});

test('parseFailures: pytest reads "FAILED file::test - error"', () => {
  const text = 'FAILED tests/test_calc.py::test_add - AssertionError: assert 2 == 3\n';
  assert.deepEqual(parseFailures(text), [
    { test: 'test_add', file: 'tests/test_calc.py', error: 'AssertionError: assert 2 == 3' },
  ]);
});

test('parseFailures: go test reads "--- FAIL: Name" then the file:line: message', () => {
  const text = `--- FAIL: TestAdd (0.00s)
    calc_test.go:12: expected 3, got 2
FAIL
exit status 1
`;
  assert.deepEqual(parseFailures(text), [
    { test: 'TestAdd', file: 'calc_test.go', error: 'expected 3, got 2' },
  ]);
});

test('parseFailures: dotnet test reads "Failed Name [ms]" then the Error Message', () => {
  const text = `  Failed MyTests.AddTest [15 ms]
  Error Message:
   Assert.Equal() Failure
Expected: 3
Actual: 2
`;
  assert.deepEqual(parseFailures(text), [
    { test: 'MyTests.AddTest', file: '', error: 'Assert.Equal() Failure\nExpected: 3\nActual: 2' },
  ]);
});

test('parseFailures: Maven surefire reads "[ERROR] Class.method:line message"', () => {
  const text = '[ERROR]   CalculatorTest.testAdd:12 expected: <3> but was: <2>\n';
  assert.deepEqual(parseFailures(text), [
    { test: 'testAdd', file: 'CalculatorTest', error: 'expected: <3> but was: <2>' },
  ]);
});

test('parseFailures: the same test reported twice is kept once; at most 30 failures', () => {
  const text = `FAILED tests/test_calc.py::test_add - AssertionError: assert 2 == 3
FAILED tests/test_calc.py::test_add - AssertionError: assert 2 == 3
`;
  assert.equal(parseFailures(text).length, 1);

  const many = Array.from({ length: 35 }, (_, i) => `FAILED tests/test_calc.py::test_${i} - boom`).join('\n');
  assert.equal(parseFailures(many).length, 30);
});

test('parseFailures: an absolute path under cwd is made relative (forward slashes)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-step-cwd-'));
  try {
    const abs = path.join(dir, 'test', 'a.test.js');
    const text = `✖ failing tests:

test at ${abs}:12:3
✖ a failing test (1ms)
  Error: boom
`;
    const out = parseFailures(text, { cwd: dir });
    assert.equal(out[0].file, 'test/a.test.js');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseFailures: text with no recognizable failure gives an empty list', () => {
  assert.deepEqual(parseFailures('all good, nothing to see here\n'), []);
  assert.deepEqual(parseFailures(''), []);
});

// ---------------------------------------------------------------------------
// detectTestCommand
// ---------------------------------------------------------------------------

function projectDir(t, files) {
  const dir = tmp(t);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

test('detectTestCommand: package.json with a real test script -> npm test', (t) => {
  const dir = projectDir(t, { 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) });
  assert.equal(detectTestCommand(dir), 'npm test');
});

test('detectTestCommand: npm init\'s placeholder test script is not a suite; falls through to the next signal', (t) => {
  const dir = projectDir(t, { 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) });
  assert.equal(detectTestCommand(dir), null);
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module x\n');
  assert.equal(detectTestCommand(dir), 'go test ./...');
});

test('detectTestCommand: go.mod -> go test ./...', (t) => {
  const dir = projectDir(t, { 'go.mod': 'module x\n' });
  assert.equal(detectTestCommand(dir), 'go test ./...');
});

test('detectTestCommand: pom.xml picks the Maven wrapper when present, else plain mvn (mvnw.cmd wins on Windows)', (t) => {
  const dir = projectDir(t, { 'pom.xml': '<project/>' });
  assert.equal(detectTestCommand(dir), 'mvn -B test');
  fs.writeFileSync(path.join(dir, 'mvnw'), '#!/bin/sh\n');
  assert.equal(detectTestCommand(dir), './mvnw -B test');
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'mvnw.cmd'), '@echo off\n');
    assert.equal(detectTestCommand(dir), 'mvnw.cmd -B test');
  }
});

test('detectTestCommand: build.gradle picks the Gradle wrapper when present, else plain gradle (gradlew.bat wins on Windows)', (t) => {
  const dir = projectDir(t, { 'build.gradle': '' });
  assert.equal(detectTestCommand(dir), 'gradle test');
  fs.writeFileSync(path.join(dir, 'gradlew'), '#!/bin/sh\n');
  assert.equal(detectTestCommand(dir), './gradlew test');
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'gradlew.bat'), '@echo off\n');
    assert.equal(detectTestCommand(dir), 'gradlew.bat test');
  }
});

test('detectTestCommand: a .csproj or .sln file -> dotnet test', (t) => {
  const dir = projectDir(t, { 'App.csproj': '<Project/>' });
  assert.equal(detectTestCommand(dir), 'dotnet test');
  const dir2 = projectDir(t, { 'App.sln': '' });
  assert.equal(detectTestCommand(dir2), 'dotnet test');
});

test('detectTestCommand: pyproject.toml -> python -m pytest', (t) => {
  const dir = projectDir(t, { 'pyproject.toml': '[tool.pytest]\n' });
  assert.equal(detectTestCommand(dir), 'python -m pytest');
});

test('detectTestCommand: an empty folder, or none, gives null', (t) => {
  const dir = tmp(t);
  assert.equal(detectTestCommand(dir), null);
  assert.equal(detectTestCommand(path.join(dir, 'does-not-exist')), null);
  assert.equal(detectTestCommand(null), null);
});

// ---------------------------------------------------------------------------
// isFullSuiteCommand
// ---------------------------------------------------------------------------

test('isFullSuiteCommand: recognizes the whole-suite command of every supported toolchain', () => {
  for (const cmd of ['npm test', 'npm run test', 'pytest', 'python -m pytest -q', 'go test ./...', 'dotnet test', './mvnw -B test', './gradlew test', 'npm test 2>&1 | tail -40']) {
    assert.equal(isFullSuiteCommand(cmd), true, cmd);
  }
  assert.equal(isFullSuiteCommand('go test ./pkg/...', 'go test ./pkg/...'), true, 'matches the suite\'s own command verbatim');
});

test('isFullSuiteCommand: a focused run (a file, a filter or a pattern) is not the whole suite', () => {
  for (const cmd of ['node --test test/x.test.js', 'npx jest path -t x', 'go test ./pkg -run X', 'dotnet test --filter X']) {
    assert.equal(isFullSuiteCommand(cmd), false, cmd);
  }
  assert.equal(isFullSuiteCommand(''), false);
  assert.equal(isFullSuiteCommand(null), false);
});

// ---------------------------------------------------------------------------
// runSuite: mock mode (nothing is run)
// ---------------------------------------------------------------------------

test('runSuite (mock, pass): writes the log, no failures', async (t) => {
  const runDir = tmp(t);
  const out = await runSuite({ command: 'npm test', cwd: '/x', runDir, round: 1, mock: true, mockResult: 'pass' });
  assert.equal(out.status, 'pass');
  assert.deepEqual(out.failures, []);
  assert.match(out.message, /The suite passed in round 1/);
  const log = fs.readFileSync(path.join(runDir, 'logs', 'suite-1.log'), 'utf8');
  assert.match(log, /\$ npm test {3}\(simulated: nothing was run\)/);
});

test('runSuite (mock, fail): one simulated failure', async (t) => {
  const runDir = tmp(t);
  const out = await runSuite({ command: 'npm test', cwd: '/x', runDir, round: 2, mock: true, mockResult: 'fail' });
  assert.equal(out.status, 'fail');
  assert.equal(out.failures.length, 1);
  assert.match(out.message, /The suite failed in round 2/);
});

test('runSuite (mock, preexisting): only pre-existing failures -> status pass, output.preexisting filled', async (t) => {
  const runDir = tmp(t);
  const preexisting = [{ test: 'legacy failure', file: 'test/old.test.js', reason: 'fails on main too' }];
  const out = await runSuite({ command: 'npm test', cwd: '/x', runDir, round: 1, mock: true, mockResult: 'preexisting', preexisting });
  assert.equal(out.status, 'pass');
  assert.deepEqual(out.failures, []);
  assert.equal(out.preexisting.length, 1);
  assert.equal(out.preexisting[0].test, 'legacy failure');
  assert.match(out.message, /pre-existing failure/);
});

test('runSuite (mock, blocked): no command could run', async (t) => {
  const runDir = tmp(t);
  const out = await runSuite({ command: 'npm test', cwd: '/x', runDir, round: 1, mock: true, mockResult: 'blocked' });
  assert.equal(out.status, 'blocked');
  assert.match(out.message, /The suite could not run/);
});

// ---------------------------------------------------------------------------
// runSuite: non-mock, with a stubbed `run` (never spawns a real process)
// ---------------------------------------------------------------------------

test('runSuite: exit 0 -> pass, without reading the log', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t);
  const run = async () => ({ code: 0, timedOut: false, error: null });
  const out = await runSuite({ command: 'npm test', cwd, runDir, round: 1, run });
  assert.equal(out.status, 'pass');
  assert.equal(out.exit_code, 0);
});

test('runSuite: exit 1 with parseable output -> fail, with the failing tests', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t);
  const run = async ({ logFile }) => {
    fs.appendFileSync(logFile, 'FAILED tests/test_calc.py::test_add - AssertionError: assert 2 == 3\n');
    return { code: 1, timedOut: false, error: null };
  };
  const out = await runSuite({ command: 'pytest', cwd, runDir, round: 1, run });
  assert.equal(out.status, 'fail');
  assert.deepEqual(out.failures, [{ test: 'test_add', file: 'tests/test_calc.py', error: 'AssertionError: assert 2 == 3' }]);
});

test('runSuite: a failure matching a pre-existing one is moved out; no new failures -> pass', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t);
  const run = async ({ logFile }) => {
    fs.appendFileSync(logFile, 'FAILED tests/test_old.py::test_legacy - boom\n');
    return { code: 1, timedOut: false, error: null };
  };
  const preexisting = [{ test: 'test_legacy', file: 'tests/test_old.py', reason: 'fails on main too' }];
  const out = await runSuite({ command: 'pytest', cwd, runDir, round: 1, run, preexisting });
  assert.equal(out.status, 'pass');
  assert.deepEqual(out.failures, []);
  assert.equal(out.preexisting.length, 1);
});

test('runSuite: a non-zero exit with unparseable output -> one "(unrecognized failure)" entry', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t);
  const run = async ({ logFile }) => {
    fs.appendFileSync(logFile, 'segmentation fault\n');
    return { code: 139, timedOut: false, error: null };
  };
  const out = await runSuite({ command: 'npm test', cwd, runDir, round: 1, run });
  assert.equal(out.status, 'fail');
  assert.equal(out.failures.length, 1);
  assert.equal(out.failures[0].test, '(unrecognized failure)');
  assert.match(out.failures[0].error, /139/);
});

test('runSuite: a timeout -> one "(the whole suite)" failure, timed_out: true', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t);
  const run = async () => ({ code: null, timedOut: true, error: null });
  const out = await runSuite({ command: 'npm test', cwd, runDir, round: 1, run });
  assert.equal(out.status, 'fail');
  assert.equal(out.timed_out, true);
  assert.equal(out.failures[0].test, '(the whole suite)');
});

test('runSuite: no worktree (cwd missing) -> blocked, never spawns the command', async (t) => {
  const runDir = tmp(t);
  let called = false;
  const run = async () => { called = true; return { code: 0, timedOut: false, error: null }; };
  const out = await runSuite({ command: 'npm test', cwd: path.join(runDir, 'does-not-exist'), runDir, round: 1, run });
  assert.equal(out.status, 'blocked');
  assert.match(out.reason, /no worktree/);
  assert.equal(called, false);
});

test('runSuite: no command found -> blocked', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t); // empty: detectTestCommand finds nothing
  const out = await runSuite({ command: '', cwd, runDir, round: 1 });
  assert.equal(out.status, 'blocked');
  assert.match(out.reason, /no test command/);
});

test('runSuite: no run folder -> blocked', async () => {
  const out = await runSuite({ command: 'npm test', cwd: '/x', runDir: null, round: 1, run: async () => ({ code: 0, timedOut: false, error: null }) });
  assert.equal(out.status, 'blocked');
  assert.match(out.reason, /no folder/);
});

// ---------------------------------------------------------------------------
// suiteMessage
// ---------------------------------------------------------------------------

test('suiteMessage: lists the failures and the pre-existing ones apart; empty for a non-suite output', () => {
  const out = {
    kind: 'suite', message: 'The suite failed in round 1 (`npm test`): 1 failing test.',
    failures: [{ test: 'adds', file: 'a.test.js', error: 'boom' }],
    preexisting: [{ test: 'legacy', file: 'old.test.js' }],
  };
  const msg = suiteMessage(out);
  assert.match(msg, /^The suite failed in round 1/);
  assert.match(msg, /- adds \(a\.test\.js\): boom/);
  assert.match(msg, /Also failing on the base \(reported, not chased\):/);
  assert.match(msg, /- legacy \(old\.test\.js\)/);
  assert.equal(suiteMessage({ kind: 'screenshots' }), '');
  assert.equal(suiteMessage(null), '');
});
