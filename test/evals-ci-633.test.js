// #633 (spec R9, D15): the Full work model evaluates the project's skills and workflows, and those
// evals run in CI. Acceptance tests, written before the code.
//
// The interface assumed here:
// - package.json has an evals script: a key matching /^evals?(:|$)/ ("evals", "eval", "evals:ci", ...);
// - .github/workflows/ci.yml runs it (`npm run <that key>` appears in the file).
// Plain Node only: nothing is run, the two files are read.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVALS = /^evals?(:|$)/;
const scripts = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts || {};
const evalKeys = () => Object.keys(scripts()).filter((k) => EVALS.test(k));

test('#633 package.json has an evals script', () => {
  assert.notDeepEqual(evalKeys(), [], `the scripts: ${JSON.stringify(Object.keys(scripts()))}`);
});

test('#633 CI (.github/workflows/ci.yml) runs the evals script', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const keys = evalKeys();
  assert.equal(keys.some((k) => ci.includes(`npm run ${k}`)), true, `no "npm run <evals key>" in ci.yml (keys: ${JSON.stringify(keys)})`);
});
