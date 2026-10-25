// #195: every fallback to a development workflow goes through packages/shared/default-workflow.js
// (DefaultWorkflow.resolve), not a hard-coded 'software-development.yaml'. This walks every source file
// (scripts/source-tree.js) for that
// literal so a future change does not reintroduce a hard-coded default by hand; the module's own
// REMOTE constant and the Night watch demo's (unrelated: restoring one named workflow file to its
// bundled default, not picking "the" default) are the only allowed occurrences.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { sourceFiles } = require('../../../scripts/source-tree');

const ROOT = path.join(__dirname, '..', '..', '..');
const LITERAL = /['"]software-development\.yaml['"]/;
const ALLOWED = new Set([
  path.join(__dirname, '..', 'default-workflow.js'), // the constant itself (REMOTE)
  path.join(ROOT, 'src', 'domains', 'night', 'night-watch-demo.js'), // demo text: restoring one named file, not "the default"
]);

const jsFiles = (root) => sourceFiles(root).map((f) => path.join(root, ...f.split('/')));

test('no literal \'software-development.yaml\' default is left in the sources, outside default-workflow.js and the Night watch demo', () => {
  const offenders = [];
  for (const file of jsFiles(ROOT)) {
    if (ALLOWED.has(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, n) => { if (LITERAL.test(line)) offenders.push(`${path.relative(ROOT, file)}:${n + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(offenders, []);
});
