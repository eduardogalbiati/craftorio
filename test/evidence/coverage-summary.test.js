// #225 The suite step saves a short coverage summary (totals and the changed files' coverage) as a
// `tests` artifact. This file tests the pure parser and its render.
//
// Interface under test (new module, loaded inside each test):
//   src/domains/evidence/coverage-summary.js
//   - parseNodeCoverage(text, { changedFiles = [] } = {}) → null when the text has no coverage
//     report, else { totals: { lines, branches, functions }, files: [{ file, lines, branches,
//     functions, uncovered }] }
//       text: the output of `node --test --experimental-test-coverage` (spec reporter lines start
//       with "ℹ ", TAP lines with "# "): the table `file | line % | branch % | funcs % | uncovered
//       lines`, with folders as rows of their own and files indented under them (Node 22+), and
//       the `all files` row (the totals);
//       numbers are percentages as numbers (85.33); `file` is the path rebuilt from the tree, with
//       forward slashes (src/lib/paths.js); `uncovered` is the column's text as printed;
//       files: only those of changedFiles (forward or back slashes), in changedFiles' order; a
//       changed file absent from the report is left out.
//   - renderCoverageSummary(summary) → markdown: the totals and one row per changed file.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../src/domains/evidence/coverage-summary');

const REPORT = [
  'ℹ tests 412',
  'ℹ pass 412',
  'ℹ fail 0',
  'ℹ start of coverage report',
  'ℹ ---------------------------------------------------------------------',
  'ℹ file               | line % | branch % | funcs % | uncovered lines',
  'ℹ ---------------------------------------------------------------------',
  'ℹ src                |        |          |         | ',
  'ℹ  evidence.js       |  92.46 |    81.82 |  100.00 | 45-48 120',
  'ℹ  lib               |        |          |         | ',
  'ℹ   paths.js         |  60.00 |    50.00 |   50.00 | 3-6',
  'ℹ  runs.js           |  78.10 |    70.59 |   85.71 | 12-20 300-310',
  'ℹ test               |        |          |         | ',
  'ℹ  evidence.test.js  | 100.00 |   100.00 |  100.00 | ',
  'ℹ ---------------------------------------------------------------------',
  'ℹ all files          |  85.33 |    76.47 |   92.31 | ',
  'ℹ ---------------------------------------------------------------------',
  'ℹ end of coverage report',
].join('\n');

test('parseNodeCoverage: the totals come from the "all files" row', () => {
  const s = load().parseNodeCoverage(REPORT);
  assert.deepEqual(s.totals, { lines: 85.33, branches: 76.47, functions: 92.31 });
});

test('parseNodeCoverage: the changed files are found in the folder tree, with their path rebuilt and their coverage', () => {
  const s = load().parseNodeCoverage(REPORT, { changedFiles: ['src/runs.js', 'src/lib/paths.js'] });
  assert.deepEqual(s.files, [
    { file: 'src/runs.js', lines: 78.1, branches: 70.59, functions: 85.71, uncovered: '12-20 300-310' },
    { file: 'src/lib/paths.js', lines: 60, branches: 50, functions: 50, uncovered: '3-6' },
  ]);
});

test('parseNodeCoverage: changed files given with backslashes match; one missing from the report is left out', () => {
  const s = load().parseNodeCoverage(REPORT, { changedFiles: ['src\\evidence.js', 'src/not-loaded.js'] });
  assert.deepEqual(s.files.map((f) => f.file), ['src/evidence.js']);
});

test('parseNodeCoverage: the TAP reporter\'s "# " prefix parses the same', () => {
  const tap = REPORT.replace(/^ℹ /gm, '# ');
  const s = load().parseNodeCoverage(tap, { changedFiles: ['src/runs.js'] });
  assert.deepEqual(s.totals, { lines: 85.33, branches: 76.47, functions: 92.31 });
  assert.equal(s.files[0].lines, 78.1);
});

test('parseNodeCoverage: output without a coverage report gives null', () => {
  assert.equal(load().parseNodeCoverage('ℹ tests 3\nℹ pass 3\nℹ fail 0\n'), null);
});

test('renderCoverageSummary: markdown with the totals and a row per changed file', () => {
  const { parseNodeCoverage, renderCoverageSummary } = load();
  const md = renderCoverageSummary(parseNodeCoverage(REPORT, { changedFiles: ['src/runs.js'] }));
  assert.match(md, /85\.33/);
  assert.match(md, /76\.47/);
  assert.match(md, /92\.31/);
  assert.match(md, /src\/runs\.js/);
  assert.match(md, /78\.1/);
  assert.doesNotMatch(md, /evidence\.js/);
});
