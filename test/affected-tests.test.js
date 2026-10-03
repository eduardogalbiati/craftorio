// src/engine/affected-tests.js (#212): which test files a change can break, from the import graph of a
// fixture git project (a real repo in a temp folder, so the merge-base, untracked and changed files
// come from git as they do in a run).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { affectedTests, isSlow, isTest, selectionLines } = require('../src/engine/affected-tests');

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

test('isTest and selectionLines: the test-file names and the lines a step prints', () => {
  assert.equal(isTest('test/a.test.js'), true);
  assert.equal(isTest('src/a.test.helper.js'), false);
  assert.deepEqual(selectionLines({ mode: 'all', why: 'no JS/TS test files' }), ['the whole suite: no JS/TS test files']);
  assert.deepEqual(
    selectionLines({ mode: 'affected', why: '1 test file(s) reach the 1 changed file(s)', files: ['test/leaf.test.js'], reasons: { 'test/leaf.test.js': 'imports src/leaf.js' } }),
    ['1 test file(s) reach the 1 changed file(s)', '- test/leaf.test.js: imports src/leaf.js'],
  );
});
