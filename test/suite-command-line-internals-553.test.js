// #553 internals: the npm script a suite command runs (npmScriptOf, shared by coverageCommand and
// takesFileList) and a list round whose own counts show the runner ignored the list (ignoredList).

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ignoredList, listIgnored, npmScriptOf, takesFileList } = require('../src/engine/suite-command-line');

function project(scripts, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdline-553-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts }));
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
  return dir;
}

test('npmScriptOf reads the script, its coverage variant and the args', () => {
  const dir = project({ test: 'node run.js', 'test:coverage': 'node run.js --cov' });
  assert.deepStrictEqual(npmScriptOf('npm test -- a.test.js', dir), { name: 'test', rest: ' -- a.test.js', args: 'a.test.js', scripts: { test: 'node run.js', 'test:coverage': 'node run.js --cov' }, coverageName: 'test:coverage', script: 'node run.js' });
  assert.strictEqual(npmScriptOf('npm test', dir, { coverage: true }).script, 'node run.js --cov');
  assert.strictEqual(npmScriptOf('node --test', dir), null);
  assert.strictEqual(npmScriptOf('npm test', null), null);
  assert.strictEqual(npmScriptOf('npm test', path.join(dir, 'missing')).scripts, null);
});

test('takesFileList refuses a command with files already on it', () => {
  const dir = project({ test: 'node run.js' }, { 'run.js': '// reads MULTIAGENT_TEST_FILES\n' });
  assert.strictEqual(takesFileList('npm test', dir), true);
  assert.strictEqual(takesFileList('npm test -- a.test.js', dir), false);
});

test('ignoredList: files outside the list, or as many tests as the whole suite', () => {
  const files = ['test/a.test.js', 'test/b.test.js'];
  assert.strictEqual(ignoredList({ file_counts: { 'test/a.test.js': {}, 'test\\b.test.js': {} }, passed: 4, failed: 0 }, { files, wholeTests: 100 }), null);
  assert.match(ignoredList({ file_counts: { 'test/a.test.js': {}, 'test/c.test.js': {} } }, { files }), /1 test file outside the list \(test\/c\.test\.js\)/);
  assert.match(ignoredList({ passed: 98, failed: 2 }, { files, wholeTests: 100 }), /100 tests, as many as the run's whole suite \(100\)/);
  assert.strictEqual(ignoredList({ passed: 98, failed: 2 }, { files }), null);
});

test('listIgnored reports a list round that ran the whole suite as a whole run', () => {
  const files = ['test/a.test.js'];
  const logs = [];
  const out = { scope: 'files', passed: 100, failed: 0, selection: { files, why: 'since round 1' } };
  const why = listIgnored(out, { list: true, files, wholeTests: 100, log: (level, m) => logs.push(level), tooLong: null });
  assert.match(why, /ignored the list of MULTIAGENT_TEST_FILES/);
  assert.strictEqual(out.scope, 'full');
  assert.strictEqual(out.list_ignored, true);
  assert.match(out.selection.why, /^since round 1; .*so the whole suite ran$/);
  assert.deepStrictEqual(logs, ['warn']);
  const kept = { scope: 'files', passed: 100, failed: 0 };
  assert.strictEqual(listIgnored(kept, { list: false, files, wholeTests: 100, log: () => {}, tooLong: 'x' }), 'x');
  assert.strictEqual(kept.scope, 'files');
});
