// #84 A docs-only repository (README.md, LICENSE, .gitignore) is not detected as a backend: its kind is a
// new 'docs' kind or not detected (null / ''). A repository with source code detects as before.
// Detection seam: projectFacts(folder).kind (packages/engine/domains/project/project-run-defaults.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { projectFacts } = require('../domains/project/project-run-defaults');

function repo(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-kind-84-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('#84 projectFacts: a repository with only README.md, LICENSE and .gitignore is not a backend', (t) => {
  const dir = repo(t, { 'README.md': '# Notes\n', LICENSE: 'MIT\n', '.gitignore': 'node_modules\n' });
  const kind = projectFacts(dir).kind;
  assert.notEqual(kind, 'backend');
  assert.equal(kind === 'docs' || kind == null || kind === '', true, `kind: ${kind}`);
});

test('#84 projectFacts: a repository with a .js source file still detects as a backend (guard)', (t) => {
  const dir = repo(t, { 'README.md': '# Tool\n', 'index.js': 'module.exports = 1;\n', 'package.json': '{"name":"tool"}' });
  assert.equal(projectFacts(dir).kind, 'backend');
});
