// A TypeScript project compiled by tsc (`"test": "tsc -p . && node --test dist/test"`): the suite ran
// `npm test -- test/release.test.ts`, the file reached only `node --test`, which ran the .ts source
// (ERR_MODULE_NOT_FOUND, exploratory run 20261126-093311-93fd1414). A package script that chains
// commands cannot take single test files: the whole suite runs (packages/engine/engine/suite-step.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { filteredCommand } = require('../engine/suite-step');

function project(t, scripts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-chain-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts }));
  return dir;
}

test('a test script that compiles first (tsc && node --test dist) cannot take single files: null', (t) => {
  const dir = project(t, { test: 'tsc -p . && node --test dist/test', unit: 'npm run build; jest', built: 'npm run build:ts && mocha dist' });
  assert.equal(filteredCommand('npm test', ['test/release.test.ts'], dir), null);
  assert.equal(filteredCommand('npm t', ['test/release.test.ts'], dir), null);
  assert.equal(filteredCommand('npm run unit', ['a.test.js'], dir), null);
  assert.equal(filteredCommand('pnpm built', ['a.test.js'], dir), null);
});

test('a single-command script, or a chain that compiles nothing (bddgen && playwright, #324), still takes the files, and without a checkout nothing changes', (t) => {
  const dir = project(t, { test: 'node --test', 'test:e2e': 'bddgen && playwright test' });
  assert.equal(filteredCommand('npm test', ['test/a.test.js'], dir), 'npm test -- test/a.test.js');
  assert.equal(filteredCommand('npm run test:e2e', ['features/a.feature'], dir), 'npm run test:e2e -- features/a.feature');
  assert.equal(filteredCommand('npm test', ['test/a.test.js']), 'npm test -- test/a.test.js', 'no cwd: as before');
  assert.equal(filteredCommand('npm test', ['test/a.test.js'], path.join(dir, 'missing')), 'npm test -- test/a.test.js', 'no package.json: as before');
});
