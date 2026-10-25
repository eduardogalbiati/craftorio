// #402: scripts/test.js runs the unit files and the slow files as two node --test processes, each
// with its own coverage table; parseNodeCoverage (packages/engine/domains/evidence/coverage-summary.js) merges them: each number
// is the better of the tables', the uncovered lines from the best-covered one.
const test = require('node:test');
const assert = require('node:assert');
const { parseNodeCoverage } = require('../domains/evidence/coverage-summary');

const table = (runsJs, other, all) => [
  'ℹ start of coverage report',
  'ℹ file      | line % | branch % | funcs % | uncovered lines',
  'ℹ src       |        |          |         | ',
  `ℹ  runs.js  | ${runsJs} | 10-20`,
  ...(other ? [`ℹ  other.js | ${other} | 5`] : []),
  `ℹ all files | ${all} | `,
  'ℹ end of coverage report',
].join('\n');

test('two coverage tables merge: per file and in total, the better number of each', () => {
  const text = [
    table('70.00 |    60.00 |   90.00', null, '80.00 |    70.00 |   85.00'),
    'some spec output in between',
    table('50.00 |    65.00 |   80.00', '40.00 |    30.00 |   20.00', '60.00 |    75.00 |   70.00'),
  ].join('\n');
  const summary = parseNodeCoverage(text, { changedFiles: ['src/runs.js', 'src/other.js'] });
  assert.deepEqual(summary.totals, { lines: 80, branches: 75, functions: 85 });
  assert.deepEqual(summary.files, [
    { file: 'src/runs.js', lines: 70, branches: 65, functions: 90, uncovered: '10-20' },
    { file: 'src/other.js', lines: 40, branches: 30, functions: 20, uncovered: '5' },
  ]);
});

test('one table parses as before; the same table twice changes nothing', () => {
  const one = table('70.00 |    60.00 |   90.00', null, '80.00 |    70.00 |   85.00');
  const a = parseNodeCoverage(one, { changedFiles: ['src/runs.js'] });
  assert.deepEqual(a.totals, { lines: 80, branches: 70, functions: 85 });
  assert.deepEqual(parseNodeCoverage(`${one}\n${one}`, { changedFiles: ['src/runs.js'] }), a);
  assert.equal(parseNodeCoverage('no report'), null);
});
