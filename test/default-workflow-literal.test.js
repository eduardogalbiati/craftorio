// #195: every fallback to a development workflow goes through src/shared/default-workflow.js
// (DefaultWorkflow.resolve), not a hard-coded 'software-development.yaml'. This walks src/ for that
// literal so a future change does not reintroduce a hard-coded default by hand; the module's own
// REMOTE constant and the Night watch demo's (unrelated: restoring one named workflow file to its
// bundled default, not picking "the" default) are the only allowed occurrences.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
const LITERAL = /['"]software-development\.yaml['"]/;
const ALLOWED = new Set([
  path.join(ROOT, 'shared', 'default-workflow.js'), // the constant itself (REMOTE)
  path.join(ROOT, 'domains', 'night', 'night-watch-demo.js'), // demo text: restoring one named file, not "the default"
]);

function jsFiles(dir) {
  return fs.readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f))
    .filter((f) => fs.statSync(f).isFile());
}

test('no literal \'software-development.yaml\' default is left in src/, outside default-workflow.js and the Night watch demo', () => {
  const offenders = [];
  for (const file of jsFiles(ROOT)) {
    if (ALLOWED.has(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, n) => { if (LITERAL.test(line)) offenders.push(`${path.relative(ROOT, file)}:${n + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(offenders, []);
});
