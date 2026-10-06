// Internals of #225 / #185 the acceptance tests do not reach: the suite step's coverage command and
// saved summary, the evidence manifest's record of a screenshots step (captures), and result.md's
// sections.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { coverageCommand, saveCoverage } = require('../src/engine/suite-step');
const evidence = require('../src/evidence');
const { renderResultSummary } = require('../src/result-summary');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-int-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const REPORT = [
  'ℹ start of coverage report',
  'ℹ file      | line % | branch % | funcs % | uncovered lines',
  'ℹ src       |        |          |         | ',
  'ℹ  runs.js  |  78.10 |    70.59 |   85.71 | 12-20',
  'ℹ all files |  85.33 |    76.47 |   92.31 | ',
  'ℹ end of coverage report',
].join('\n');

test('coverageCommand: a node --test command gets --experimental-test-coverage once; others are unchanged', () => {
  assert.equal(coverageCommand('node --test test/a.test.js'), 'node --test --experimental-test-coverage test/a.test.js');
  assert.equal(coverageCommand('node --test --experimental-test-coverage x'), 'node --test --experimental-test-coverage x');
  assert.equal(coverageCommand('npm test'), 'npm test');
});

test('coverageCommand: an npm script runs its :coverage script, or its plain node --test inlined; others unchanged', (t) => {
  const dir = tmp(t);
  const pkg = (scripts) => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts }));
  pkg({ test: 'node scripts/test.js', 'test:coverage': 'node scripts/test.js --experimental-test-coverage' });
  assert.equal(coverageCommand('npm test', dir), 'npm run test:coverage');
  assert.equal(coverageCommand('npm test -- test/a.test.js', dir), 'npm run test:coverage -- test/a.test.js');
  pkg({ unit: 'node --test test/' });
  assert.equal(coverageCommand('npm run unit', dir), 'node --test --experimental-test-coverage test/');
  pkg({ test: 'jest' });
  assert.equal(coverageCommand('npm test', dir), 'npm test');
  assert.equal(coverageCommand('npm test', path.join(dir, 'missing')), 'npm test');
});

test('renderResultSummary: the suite log links relative to the run folder', (t) => {
  const run = tmp(t);
  const md = renderResultSummary(run, { status: 'completed', steps: { suite: { output: { kind: 'suite', status: 'pass', log: 'logs/suite-1.log' } } } });
  assert.match(md, /\]\(logs\/suite-1\.log\)/);
});

test('saveCoverage: writes coverage/coverage-summary.md with the changed files, returns the totals; null without a report', (t) => {
  const run = tmp(t);
  const cov = saveCoverage(REPORT, run, () => ['src/runs.js']);
  assert.deepEqual(cov, { lines: 85.33, branches: 76.47, functions: 92.31, files: 1, path: 'coverage/coverage-summary.md' });
  assert.match(fs.readFileSync(path.join(run, 'coverage', 'coverage-summary.md'), 'utf8'), /src\/runs\.js/);
  assert.equal(saveCoverage('ℹ pass 3', run, []), null);
});

test('evidence manifest: a screenshots step\'s capture is kept across rebuilds and replaced for the same round', (t) => {
  const run = tmp(t);
  const dir = evidence.roundDir(run, 'developer', 1);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '185-export-button.modified.png'), 'PNG');
  const output = { folder: 'developer', round: 1, taken: 1, screens: 1, message: 'm', new_elements: [{ name: '185-export-button', side: 'original', selector: '[data-x]' }], errors: [] };
  evidence.writeManifest(run, { capture: evidence.captureOf(output, { '185-export-button': 'New export button' }) });
  evidence.writeManifest(run, {});
  const m = evidence.readEvidence(run);
  assert.equal(m.captures.length, 1);
  assert.deepEqual(m.captures[0].new_elements, [{ name: '185-export-button', caption: 'New export button', selector: '[data-x]' }]);
  evidence.writeManifest(run, { capture: evidence.captureOf({ ...output, new_elements: [] }) });
  assert.deepEqual(evidence.readEvidence(run).captures.map((c) => c.new_elements.length), [0]);
});

test('renderResultSummary: status, issues as reported by a step, suite counts, coverage link and screenshots', (t) => {
  const run = tmp(t);
  fs.mkdirSync(path.join(run, 'coverage'));
  fs.writeFileSync(path.join(run, 'coverage', 'coverage-summary.md'), '# Coverage');
  const md = renderResultSummary(run, {
    workflow: 'software-development', status: 'success', run_id: 'r1', duration_ms: 125000,
    worktree: { branch: 'feat/x', base: 'main', commit: 'abcdef1234567890' },
    steps: {
      develop: { output: { issues: [{ issue: 'https://x/issues/225', done: true, summary: 'categories' }, { issue: 'https://x/issues/9', done: false, summary: 'needs a real run' }], commit_sha: '1234567890abc' } },
      suite: { output: { kind: 'suite', status: 'pass', passed: 412, failed: 0 } },
      shots: { output: { kind: 'screenshots', message: '2 screenshots of 2 screens taken in round 1; 1 new element (no original)' } },
    },
  });
  assert.match(md, /^# Result: software-development/);
  assert.match(md, /Status: \*\*success\*\*/);
  assert.match(md, /✓ https:\/\/x\/issues\/225: categories/);
  assert.match(md, /✗ https:\/\/x\/issues\/9: needs a real run/);
  assert.match(md, /`suite`: \*\*pass\*\* \(412 passed, 0 failed\)/);
  assert.match(md, /\[coverage\/coverage-summary\.md\]/);
  assert.match(md, /1 new element \(no original\)/);
  assert.match(md, /Branch `feat\/x`/);
});
