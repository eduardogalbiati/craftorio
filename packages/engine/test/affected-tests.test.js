// packages/engine/engine/affected-tests.js (#212): which test files a change can break, from the import graph of a
// fixture git project (a real repo in a temp folder, so the merge-base, untracked and changed files
// come from git as they do in a run).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { affectedTests, isSlow, isTest, selectionLines } = require('../engine/affected-tests');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function write(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
}

// A git project on `main` with one commit holding `files`.
function repo(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-tests-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

const project = {
  'package.json': '{"name":"fx"}\n',
  'src/leaf.js': 'exports.leaf = 1;\n',
  'src/other.js': 'exports.other = 1;\n',
  'src/shared.js': 'exports.shared = 1;\n',
  'src/mid.js': "const s = require('./shared');\nmodule.exports = s;\n",
  'test/leaf.test.js': "const { leaf } = require('../src/leaf');\n",
  'test/other.test.js': "require('../src/other');\n",
  'test/direct.test.js': "require('../src/shared');\n",
  'test/chain.test.js': "require('../src/mid');\n",
};

test('affectedTests: a leaf module change selects only the test that imports it', (t) => {
  const dir = repo(t, project);
  write(dir, { 'src/leaf.js': 'exports.leaf = 2;\n' });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.equal(sel.mode, 'affected');
  assert.deepEqual(sel.changed, ['src/leaf.js']);
  assert.deepEqual(sel.files, ['test/leaf.test.js']);
  assert.deepEqual(sel.reasons, { 'test/leaf.test.js': 'imports src/leaf.js' });
  assert.deepEqual(sel.slow, []);
});

test('affectedTests: a shared module change selects its direct and transitive importers; the transitive one says "through"', (t) => {
  const dir = repo(t, project);
  write(dir, { 'src/shared.js': 'exports.shared = 2;\n' });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.files, ['test/chain.test.js', 'test/direct.test.js']);
  assert.equal(sel.reasons['test/direct.test.js'], 'imports src/shared.js');
  assert.equal(sel.reasons['test/chain.test.js'], 'imports src/shared.js (through src/mid.js)');
});

test('affectedTests: package.json changed selects every test (mode all, with the reason)', (t) => {
  const dir = repo(t, project);
  write(dir, { 'package.json': '{"name":"fx","version":"2"}\n' });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.equal(sel.mode, 'all');
  assert.deepEqual(sel.files, []);
  assert.match(sel.why, /a shared root changed \(package\.json\)/);
});

test('affectedTests: a changed test file is selected itself, with the reason "changed"', (t) => {
  const dir = repo(t, project);
  write(dir, { 'test/other.test.js': "require('../src/other');\n// edited\n" });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.files, ['test/other.test.js']);
  assert.equal(sel.reasons['test/other.test.js'], 'changed');
});

test('affectedTests: slow tests (test/slow/ and *.slow.test.js) stay out of files and are listed in slow', (t) => {
  const dir = repo(t, {
    ...project,
    'test/slow/big.test.js': "require('../../src/leaf');\n",
    'test/leaf-run.slow.test.js': "require('../src/leaf');\n",
  });
  write(dir, { 'src/leaf.js': 'exports.leaf = 2;\n' });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.files, ['test/leaf.test.js']);
  assert.deepEqual(sel.slow, ['test/leaf-run.slow.test.js', 'test/slow/big.test.js']);
  assert.equal(isSlow('test/slow/big.test.js'), true);
  assert.equal(isSlow('test/leaf-run.slow.test.js'), true);
  assert.equal(isSlow('test/leaf.test.js'), false);
});

test('affectedTests: a changed YAML that a test names by path.join arguments selects that test', (t) => {
  const dir = repo(t, {
    ...project,
    'workflows/flow.yaml': 'name: flow\n',
    'test/flow.test.js': "const file = path.join(root, 'workflows', 'flow.yaml');\n",
  });
  write(dir, { 'workflows/flow.yaml': 'name: flow 2\n' });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.files, ['test/flow.test.js']);
  assert.equal(sel.reasons['test/flow.test.js'], 'names workflows/flow.yaml');
});

test('affectedTests: a mention of a changed file in a comment does not select the test', (t) => {
  const dir = repo(t, {
    ...project,
    'workflows/flow.yaml': 'name: flow\n',
    'test/comment.test.js': "// the flow lives in workflows/flow.yaml, read elsewhere\nrequire('../src/other');\n",
  });
  write(dir, { 'workflows/flow.yaml': 'name: flow 2\n' });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.files, []);
  assert.equal(sel.mode, 'affected');
});

// #695: a path a test reads from disk is a dependency of that test (a file it reads, a directory it
// lists), resolved from string literals and path.join of literals relative to the repository root.
test('#695 affectedTests: a folder added under a views directory a test lists selects that test', (t) => {
  const dir = repo(t, {
    ...project,
    'fronts/plan/views/home/home.js': "registerView({ id: 'home' });\n",
    'apps/desktop/test/view-folders.test.js': [
      "const fs = require('fs');",
      "const path = require('path');",
      "const ROOT = path.join(__dirname, '..', '..', '..');",
      "const ids = fs.readdirSync(path.join(ROOT, 'fronts', 'plan', 'views'));",
      '',
    ].join('\n'),
  });
  write(dir, { 'fronts/plan/views/docs/docs.js': "registerView({ id: 'docs' });\n" });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.equal(sel.mode, 'affected');
  assert.deepEqual(sel.files, ['apps/desktop/test/view-folders.test.js']);
});

test('#695 affectedTests: a changed docs/work document selects the test that reads it', (t) => {
  const dir = repo(t, {
    ...project,
    'docs/work/onboarding/spec.md': '# Spec\n',
    'test/spec-reader.test.js': [
      "const fs = require('fs');",
      "const path = require('path');",
      "const ROOT = path.join(__dirname, '..');",
      "const spec = fs.readFileSync(path.join(ROOT, 'docs', 'work', 'onboarding', 'spec.md'), 'utf8');",
      '',
    ].join('\n'),
  });
  write(dir, { 'docs/work/onboarding/spec.md': '# Spec\n\n## A new section\n' });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.files, ['test/spec-reader.test.js']);
});

test('#695 affectedTests: a test reading a module\'s text from disk is selected when that module changes, besides its importers', (t) => {
  const dir = repo(t, {
    ...project,
    'test/source-text.test.js': "const fs = require('fs');\nconst path = require('path');\nconst src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared.js'), 'utf8');\n",
  });
  write(dir, { 'src/shared.js': 'exports.shared = 2;\n' });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.files, ['test/chain.test.js', 'test/direct.test.js', 'test/source-text.test.js']);
});

test('#695 affectedTests: a test whose reads cannot be resolved keeps the import-only selection', (t) => {
  const dir = repo(t, {
    ...project,
    'fronts/plan/views/home/home.js': "registerView({ id: 'home' });\n",
    'test/dynamic.test.js': "const fs = require('fs');\nconst where = process.env.VIEWS_DIR;\nconst ids = fs.readdirSync(where);\nrequire('../src/other');\n",
  });
  write(dir, { 'fronts/plan/views/docs/docs.js': "registerView({ id: 'docs' });\n" });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.equal(sel.mode, 'affected');
  assert.deepEqual(sel.files, []);
});

test('#695 affectedTests (this repository): a new screen folder under fronts/plan/views/ selects apps/desktop/test/view-folders.test.js', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const sel = affectedTests({ root, base: 'HEAD', changed: ['fronts/plan/views/newscreen/newscreen.js'] });
  assert.equal(sel.mode, 'affected');
  assert.equal(sel.files.includes('apps/desktop/test/view-folders.test.js'), true, sel.files.join(', '));
});

test('affectedTests: a project with no *.test.js files gives mode all (no import graph)', (t) => {
  const dir = repo(t, { 'src/a.js': 'exports.a = 1;\n' });
  write(dir, { 'src/a.js': 'exports.a = 2;\n' });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.equal(sel.mode, 'all');
  assert.match(sel.why, /no JS\/TS test files/);
});

test('affectedTests: untracked files count as changed (a new module and its new test)', (t) => {
  const dir = repo(t, project);
  write(dir, {
    'src/new-leaf.js': 'exports.n = 1;\n',
    'test/new-leaf.test.js': "require('../src/new-leaf');\n",
  });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.changed, ['src/new-leaf.js', 'test/new-leaf.test.js']);
  assert.equal(sel.reasons['test/new-leaf.test.js'], 'changed');
  assert.deepEqual(sel.files, ['test/new-leaf.test.js']);
});

test('affectedTests: the merge-base is the comparison point when the base moved on', (t) => {
  const dir = repo(t, project);
  git(dir, 'checkout', '-q', '-b', 'feature');
  git(dir, 'checkout', '-q', 'main');
  write(dir, { 'src/leaf.js': 'exports.leaf = 2;\n' });
  git(dir, 'commit', '-q', '-am', 'main moved');
  git(dir, 'checkout', '-q', 'feature');
  write(dir, { 'src/other.js': 'exports.other = 2;\n' });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.changed, ['src/other.js']);
  assert.deepEqual(sel.files, ['test/other.test.js']);
});

// #703: a run deletes a test file on purpose. The runner must not get it, and the output must not list
// it; a deleted source still leads to the tests that used it. The deletions are committed on a branch,
// as in a run.
function branchThatDeletes(t, files, deleted, changes = {}) {
  const dir = repo(t, files);
  git(dir, 'checkout', '-q', '-b', 'work');
  for (const file of deleted) fs.rmSync(path.join(dir, file));
  write(dir, changes);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'delete');
  return dir;
}

test('#703 affectedTests: a branch that deletes test/x.test.js and changes src/a.js selects the tests of src/a.js, and the output does not list the deleted file', (t) => {
  const dir = branchThatDeletes(t, {
    ...project,
    'src/a.js': 'exports.a = 1;\n',
    'test/a.test.js': "require('../src/a');\n",
    'test/x.test.js': "require('../src/a');\n",
  }, ['test/x.test.js'], { 'src/a.js': 'exports.a = 2;\n' });
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.equal(sel.mode, 'affected');
  assert.deepEqual(sel.files, ['test/a.test.js']);
  assert.deepEqual(sel.reasons, { 'test/a.test.js': 'imports src/a.js' });
  assert.deepEqual(selectionLines(sel), ['1 test file(s) reach the 2 changed file(s)', '- test/a.test.js: imports src/a.js']);
});

test('#703 affectedTests: a branch that deletes src/b.js still selects the test that imported it', (t) => {
  const dir = branchThatDeletes(t, {
    ...project,
    'src/b.js': 'exports.b = 1;\n',
    'test/b.test.js': "require('../src/b');\n",
  }, ['src/b.js']);
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.files, ['test/b.test.js']);
  assert.equal(sel.reasons['test/b.test.js'], 'imports src/b.js');
});

test('#703 affectedTests: a branch that deletes a file no code imports still selects the test that names it', (t) => {
  const dir = branchThatDeletes(t, {
    ...project,
    'workflows/flow.yaml': 'name: flow\n',
    'test/flow.test.js': "const file = path.join(root, 'workflows', 'flow.yaml');\n",
  }, ['workflows/flow.yaml']);
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.files, ['test/flow.test.js']);
  assert.equal(sel.reasons['test/flow.test.js'], 'names workflows/flow.yaml');
});

test('isTest and selectionLines: the test-file names and the lines a step prints', () => {
  assert.equal(isTest('test/a.test.js'), true);
  assert.equal(isTest('src/a.test.helper.js'), false);
  assert.deepEqual(selectionLines({ mode: 'all', why: 'no JS/TS test files' }), ['the whole suite: no JS/TS test files']);
  assert.deepEqual(
    selectionLines({ mode: 'affected', why: '1 test file(s) reach the 1 changed file(s)', files: ['test/leaf.test.js'], reasons: { 'test/leaf.test.js': 'imports src/leaf.js' } }),
    ['1 test file(s) reach the 1 changed file(s)', '- test/leaf.test.js: imports src/leaf.js'],
  );
});
