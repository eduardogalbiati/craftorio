// packages/engine/engine/suite-step.js (#219, #220): the suite's readers prefer the agent reporter's JSON line
// (parseFailures, parseCounts), and redCheck sorts the test files of a tests-first run into red,
// green, partly green and broken. Pure functions: the outputs are literals, no process is spawned.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCounts, parseFailures, redCheck } = require('../engine/suite-step');

const agentLine = (report) => JSON.stringify({ reporter: 'craftorio-agent', passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0, duration_ms: 1, failures: [], ...report });

test('parseFailures: the agent JSON line gives each failure with its line, kind and expected/actual', () => {
  const text = [
    '> multiagent@1.0.0 test',
    '> node scripts/test.js',
    agentLine({
      failed: 2,
      failures: [
        { test: 'adds', file: 'test/math.test.js', line: 12, error: 'Expected values to be strictly equal:', kind: 'test', expected: '3', actual: '2' },
        { test: 'test/broken.test.js', file: 'test/broken.test.js', line: 1, error: 'SyntaxError: Unexpected end of input', kind: 'file' },
      ],
    }),
  ].join('\n');
  assert.deepEqual(parseFailures(text), [
    { test: 'adds', file: 'test/math.test.js', error: 'Expected values to be strictly equal:\nexpected: 3, actual: 2', line: 12, kind: 'test' },
    { test: 'test/broken.test.js', file: 'test/broken.test.js', error: 'SyntaxError: Unexpected end of input', line: 1, kind: 'file' },
  ]);
});

test('parseFailures: the JSON wins over a text report in the same output', () => {
  const text = [
    '✖ failing tests:',
    'test at test/other.test.js:3:1',
    '✖ scraped from the text (2ms)',
    agentLine({ failures: [{ test: 'from the json', file: 'test/a.test.js', line: 7, error: 'boom', kind: 'test' }] }),
  ].join('\n');
  const [f] = parseFailures(text);
  assert.equal(f.test, 'from the json');
  assert.equal(f.line, 7);
});

test('parseCounts: the agent JSON gives the passed and failed counts, whatever the npm lines say', () => {
  const text = `ℹ pass 99\nℹ fail 99\n${agentLine({ passed: 184, failed: 1 })}\n`;
  assert.deepEqual(parseCounts(text), { passed: 184, failed: 1 });
});

test('redCheck: in simulation, a pass result is all green, broken is all broken, anything else is all red', () => {
  const files = ['test/a.test.js', 'test/b.test.js'];
  assert.deepEqual(redCheck(null, files, { mock: true, mockResult: 'pass' }), { red: [], green: files, partly_green: [], broken: [] });
  assert.deepEqual(redCheck(null, files, { mock: true, mockResult: 'fail' }), { red: files, green: [], partly_green: [], broken: [] });
  const broken = redCheck(null, files, { mock: true, mockResult: 'broken' });
  assert.deepEqual(broken.broken.map((b) => b.file), files);
  assert.match(broken.broken[0].error, /SyntaxError/);
});

test('redCheck: a file with no failure is green; one with a failing test is red', () => {
  const output = { failures: [{ test: 'new behaviour', file: 'test/new.test.js', error: 'expected 1', kind: 'test' }] };
  const r = redCheck(output, ['test/new.test.js', 'test/old.test.js']);
  assert.deepEqual(r.red, ['test/new.test.js']);
  assert.deepEqual(r.green, ['test/old.test.js']);
  assert.deepEqual(r.partly_green, []);
  assert.deepEqual(r.broken, []);
});

test('redCheck: a red file with some passing tests (its file_counts) is also partly green, with the counts', () => {
  const output = {
    failures: [{ test: 'the red one', file: 'test/mixed.test.js', error: 'expected 1', kind: 'test' }],
    file_counts: { 'test/mixed.test.js': { passed: 2, failed: 1 } },
  };
  const r = redCheck(output, ['test/mixed.test.js']);
  assert.deepEqual(r.red, ['test/mixed.test.js']);
  assert.deepEqual(r.partly_green, [{ file: 'test/mixed.test.js', passed: 2, failed: 1 }]);
});

test('redCheck: a test file that cannot run is broken, with its error, and the others are sorted by their own result', () => {
  const output = {
    failures: [
      { test: 'test/broken.test.js', file: 'test/broken.test.js', error: 'SyntaxError: Unexpected end of input\nat broken.test.js:4', kind: 'file' },
      { test: 'the red one', file: 'test/red.test.js', error: 'expected 1', kind: 'test' },
    ],
  };
  const r = redCheck(output, ['test/broken.test.js', 'test/red.test.js', 'test/green.test.js']);
  assert.deepEqual(r.broken, [{ file: 'test/broken.test.js', error: 'SyntaxError: Unexpected end of input' }]);
  assert.deepEqual(r.red, ['test/red.test.js']);
  assert.deepEqual(r.green, ['test/green.test.js']);
});

test('redCheck: a run whose output could not be read leaves every file broken, not green', () => {
  const output = { failures: [{ test: '(the test runner)', file: '', error: 'exit 1', kind: 'file' }] };
  const r = redCheck(output, ['test/a.test.js', 'test/b.test.js']);
  assert.deepEqual(r.broken.map((b) => b.file), ['test/a.test.js', 'test/b.test.js']);
  assert.deepEqual(r.green, []);
  assert.deepEqual(r.red, []);
});

test('redCheck: a passing run with no failure reports every file green', () => {
  const r = redCheck({ failures: [] }, ['test/a.test.js']);
  assert.deepEqual(r, { red: [], green: ['test/a.test.js'], partly_green: [], broken: [] });
});
