// packages/engine/engine/affected-tests.js (#219, #212): the static code → tests map (testMap, testMapMarkdown) and
// the existing tests related to new tests (relatedTests), on a fixture git project in a temp folder.
// Expected values are literals written from the fixture, not computed from the module.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { relatedTests, testMap, testMapMarkdown } = require('../engine/affected-tests');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// A git project on `main` holding `files` in one commit; returns its folder.
function repo(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-map-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

// src/leaf.js: reached by test/leaf.test.js directly.
// src/shared.js: reached directly by test/shared.test.js, and through src/mid.js by test/mid.test.js.
// src/orphan.js: nothing reaches it.
const project = {
  'package.json': '{"name":"fx"}\n',
  'src/leaf.js': 'exports.leaf = 1;\n',
  'src/shared.js': 'exports.shared = 1;\n',
  'src/mid.js': "const s = require('./shared');\nmodule.exports = s;\n",
  'src/orphan.js': 'exports.orphan = 1;\n',
  'test/leaf.test.js': "const { leaf } = require('../src/leaf');\n",
  'test/shared.test.js': "require('../src/shared');\n",
  'test/mid.test.js': "require('../src/mid');\n",
};

test('testMap: a source file lists the tests importing it directly, and the tests reaching it through other files', (t) => {
  const map = testMap({ root: repo(t, project) });
  assert.equal(map.mode, 'graph');
  assert.equal(map.why, '4 source file(s), 3 test file(s)');
  assert.deepEqual(map.sources['src/leaf.js'], { direct: ['test/leaf.test.js'], transitive: [] });
  assert.deepEqual(map.sources['src/shared.js'], { direct: ['test/shared.test.js'], transitive: ['test/mid.test.js'] });
  assert.deepEqual(map.sources['src/mid.js'], { direct: ['test/mid.test.js'], transitive: [] });
});

test('testMap: a source file no test reaches has no direct and no transitive test', (t) => {
  const map = testMap({ root: repo(t, project) });
  assert.deepEqual(map.sources['src/orphan.js'], { direct: [], transitive: [] });
});

test('testMap: a project with no JS test file gives no map, with the reason', (t) => {
  const map = testMap({ root: repo(t, { 'src/a.js': 'exports.a = 1;\n' }) });
  assert.equal(map.mode, 'none');
  assert.match(map.why, /no JS\/TS test files/);
  assert.deepEqual(map.sources, {});
});

test('testMapMarkdown: one line per source file, direct tests first, the transitive ones after "through other files"', (t) => {
  const md = testMapMarkdown(testMap({ root: repo(t, project) }));
  assert.match(md, /^# Code → tests map/);
  assert.match(md, /do not edit/);
  assert.ok(md.includes('- `src/leaf.js`: `test/leaf.test.js`\n'), md);
  assert.ok(md.includes('- `src/shared.js`: `test/shared.test.js`; through other files (1): `test/mid.test.js`\n'), md);
  assert.ok(md.includes('- `src/orphan.js`: no test reaches it\n'), md);
});

test('testMapMarkdown: a map without a graph says why there is none', () => {
  const md = testMapMarkdown({ mode: 'none', why: 'no JS/TS test files: no import graph for this project', sources: {} });
  assert.ok(md.endsWith('No map: no JS/TS test files: no import graph for this project.\n'), md);
});

test('relatedTests: the new test imports a source, so the existing tests reaching that source are related, with the reason', (t) => {
  const root = repo(t, project);
  fs.writeFileSync(path.join(root, 'test/new.test.js'), "require('../src/shared');\n");
  const r = relatedTests({ root, tests: ['test/new.test.js'] });
  assert.equal(r.mode, 'affected');
  assert.deepEqual(r.sources, ['src/shared.js']);
  assert.deepEqual(r.files, ['test/mid.test.js', 'test/shared.test.js']);
  assert.equal(r.reasons['test/shared.test.js'], 'imports src/shared.js');
  assert.match(r.reasons['test/mid.test.js'], /^imports src\/shared\.js \(through src\/mid\.js\)$/);
  assert.equal(r.why, '2 existing test file(s) reach the 1 source file(s) the new tests import');
});

test('relatedTests: a new test that imports no project source relates no existing test', (t) => {
  const root = repo(t, project);
  fs.writeFileSync(path.join(root, 'test/pure.test.js'), "const test = require('node:test');\n");
  const r = relatedTests({ root, tests: ['test/pure.test.js'] });
  assert.equal(r.mode, 'affected');
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.files, []);
  assert.equal(r.why, 'the new tests import no source file of the project');
});
