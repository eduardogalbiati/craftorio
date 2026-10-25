// #321: the run_analysis focuses' helpers (packages/engine/domains/oracle/oracle-run-focus.js): Bash kinds, failure causes,
// declared test names and suite log lines, and an unknown focus.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bashKind, declaredTests, failureOf, focusAnswer, suiteTimes } = require('../../domains/oracle/oracle-run-focus');

test('#321 bashKind sorts a command into git, test, read, search, node script, file ops or other', () => {
  assert.equal(bashKind('git log --oneline -5'), 'git');
  assert.equal(bashKind('node --test test/a.test.js'), 'test');
  assert.equal(bashKind('npx playwright test --list'), 'test');
  assert.equal(bashKind('cat src/a.js'), 'read via Bash');
  assert.equal(bashKind('grep -n foo src'), 'search via Bash');
  assert.equal(bashKind('node scratch/check.js'), 'node script');
  assert.equal(bashKind('mkdir -p logs'), 'file ops');
  assert.equal(bashKind('npm ls --all'), 'other');
});

test('#321 failureOf: a non-zero exit code, a refusal, a timeout, an error; a success is null', () => {
  assert.equal(failureOf({ output: 'Exit code 2\nboom', is_error: true }), 'exit code');
  assert.equal(failureOf({ output: 'Exit code 0' }), null);
  assert.equal(failureOf({ output: 'This command requires approval', is_error: true }), 'refused');
  assert.equal(failureOf({ output: 'Command timed out after 2m', is_error: true }), 'timeout');
  assert.equal(failureOf({ output: 'String to replace not found', is_error: true }), 'error');
  assert.equal(failureOf({ output: 'ok', is_error: false }), null);
  assert.equal(failureOf({ exit_code: 1, output: [] }), 'exit code');
});

test('#321 declaredTests reads literal test names, escapes undone, template names with ${} skipped', () => {
  const src = "test('a \\'quoted\\' one', () => {});\nit(\"two\", () => {});\ntest.skip(`three`, () => {});\ntest(`x ${'$'}{n}`, () => {});\n";
  assert.deepEqual(declaredTests(src), ["a 'quoted' one", 'two', 'three']);
});

test('#321 suiteTimes reads ✔ and ✖ lines with their durations, CRLF too', () => {
  const times = suiteTimes('✔ one (12.5ms)\r\n  ✖ two (3ms)\r\nℹ pass 1\r\n﹣ skipped (0ms) # SKIP\r\n');
  assert.deepEqual([...times], [['one', 12.5], ['two', 3]]);
});

test('#321 an unknown focus is refused with the list of focuses', () => {
  assert.throws(() => focusAnswer('money', []), /cache, context, cost, tests, time, tools/);
});

test('#321 a session with no turns adds no turn to the cache focus, and a run without events answers empty', () => {
  const opened = { ts: '2026-10-05T10:00:00.000Z', type: 'session.opened', session_id: 's', session: { id: 's', agent: 'developer', provider: 'claude' } };
  const { runs } = focusAnswer('cache', [{ runId: 'r', summary: null, events: [opened] }, { runId: 'empty', summary: null }]);
  assert.equal(runs[0].turns, 0);
  assert.equal(runs[0].cold.count, 0);
  assert.equal(runs[1].status, 'running');
});

test('#321 tests: names from the project checkout (the worktree is gone) are matched, with a note saying so', () => {
  const item = { runId: 'r', summary: null, events: [], logs: [{ name: 'tests-1.log', text: '✔ one (12ms)\n' }], testFiles: { 'test/a.test.js': "test('one', () => {});\n" } };
  const fromProject = focusAnswer('tests', [{ ...item, testsFrom: 'project' }]).runs[0];
  assert.deepEqual(fromProject.files.map((f) => f.file), ['test/a.test.js']);
  assert.match(fromProject.note, /worktree is gone/);
  assert.equal(focusAnswer('tests', [{ ...item, testsFrom: 'worktree' }]).runs[0].note, undefined);
});
