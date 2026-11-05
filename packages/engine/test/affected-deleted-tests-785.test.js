// #785: a change that deletes a test file on purpose. The deleted path stays in `changed`, but it is
// never selected: the runner would fail on the missing file (MODULE_NOT_FOUND) and turn the suite red.
// Seam: affectedTests of packages/engine/engine/affected-tests.js on a real fixture git project.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { affectedTests } = require('../engine/affected-tests');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-deleted-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const files = {
    'package.json': '{"name":"fx"}\n',
    'src/a.js': 'exports.a = 1;\n',
    'test/a.test.js': "require('../src/a');\n",
    'test/gone.test.js': "require('../src/a');\n",
    'test/slow/gone.test.js': "require('../../src/a');\n",
  };
  git(dir, 'init', '-q');
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

test('affectedTests: a deleted test file is changed but not selected, fast or slow', (t) => {
  const dir = repo(t);
  fs.rmSync(path.join(dir, 'test/gone.test.js'));
  fs.rmSync(path.join(dir, 'test/slow/gone.test.js'));
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.equal(sel.mode, 'affected');
  assert.deepEqual(sel.changed, ['test/gone.test.js', 'test/slow/gone.test.js']);
  assert.deepEqual(sel.files, []);
  assert.deepEqual(sel.slow, []);
  assert.deepEqual(sel.reasons, {});
});

test('affectedTests: a deletion committed on the branch is left out too, the tests that remain stay', (t) => {
  const dir = repo(t);
  git(dir, 'switch', '-q', '-c', 'work');
  fs.rmSync(path.join(dir, 'test/gone.test.js'));
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'exports.a = 2;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'drop a test');
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.files, ['test/a.test.js']);
  assert.deepEqual(sel.slow, ['test/slow/gone.test.js']);
});

test('affectedTests: the tests importing a deleted source stay selected', (t) => {
  const dir = repo(t);
  fs.rmSync(path.join(dir, 'src/a.js'));
  const sel = affectedTests({ root: dir, base: 'main' });
  assert.deepEqual(sel.files, ['test/a.test.js', 'test/gone.test.js']);
  assert.equal(sel.reasons['test/a.test.js'], 'imports src/a.js');
});
