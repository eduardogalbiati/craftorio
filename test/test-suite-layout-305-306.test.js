// The test suite's own layout (#305, #306): a helper under test/ registers no test when it is
// required (a test there would run again in every file importing it), the whole simulated runs
// live in test/slow/ in files of one theme, a split keeps every title of the original files
// (test/fixtures/suite-split-titles-305.json, taken before the split), and the test writer's
// skill points at the rules in docs/agents/testing.md.
// The helpers are loaded in a child process where node:test's test/describe/it/suite only record
// where they were called, so a helper's registrations are found whatever its code looks like.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const testDir = path.join(root, 'test');
// the engine package's tests (phase 2 of the reorganisation study): the slow runs, engine-helpers.js, the fixtures
const engineTestDir = path.join(root, 'packages', 'engine', 'test');
const slash = (p) => p.split(path.sep).join('/');
const rel = (f) => slash(path.relative(root, f));

// Every .js/.cjs/.mjs file under test/ and under every workspace's test/ (scripts/source-tree.js),
// recursively, except fixtures/ folders (inputs, never run).
const testDirs = () => [testDir, ...require('../scripts/source-tree').workspaces(root).map((w) => path.join(root, ...w.dir.split('/'), 'test'))].filter((d) => fs.existsSync(d));
function jsFiles(dir) {
  if (dir === undefined) return testDirs().flatMap((d) => jsFiles(d)).sort();
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'fixtures' ? [] : jsFiles(full);
    return /\.(c|m)?js$/.test(e.name) ? [full] : [];
  }).sort();
}
const testFiles = () => jsFiles().filter((f) => f.endsWith('.test.js'));
const helperFiles = () => jsFiles().filter((f) => !f.endsWith('.test.js'));

// Requires each file in a child process with node:test's registering functions replaced by
// recorders; returns [{ file, line, fn }] for each registration made while loading, and
// [{ file, error }] for a file that could not be loaded.
const PROBE = `
const Module = require('module');
const files = JSON.parse(process.argv[1]);
const real = require('node:test');
const calls = [];
const recorder = (fn) => {
  const r = function () { calls.push({ fn, stack: new Error().stack }); return Promise.resolve(); };
  r.skip = r; r.only = r; r.todo = r;
  return r;
};
const fake = recorder('test');
for (const k of Object.keys(real)) fake[k] = real[k];
for (const k of ['test', 'describe', 'it', 'suite']) fake[k] = k === 'test' ? fake : recorder(k);
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'node:test' || request === 'test') return fake;
  return load.call(this, request, ...rest);
};
const out = { calls: [], errors: [] };
for (const file of files) {
  const before = calls.length;
  try { require(file); } catch (e) { out.errors.push({ file, error: String(e && e.message || e).split('\\n')[0] }); }
  for (const c of calls.slice(before)) {
    const frame = c.stack.split('\\n').find((l) => l.includes(file));
    const m = frame && frame.match(/:(\\d+):\\d+\\)?\\s*$/);
    out.calls.push({ file, fn: c.fn, line: m ? Number(m[1]) : null });
  }
}
process.stdout.write('@@PROBE@@' + JSON.stringify(out) + '\\n');
process.exit(0);
`;
function loadTimeRegistrations(files) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['-e', PROBE, JSON.stringify(files)], { cwd: root, encoding: 'utf8', env, timeout: 120000 });
  const line = (r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('@@PROBE@@'));
  assert.ok(line, `the probe ran (exit ${r.status}): ${(r.stderr || '').slice(0, 500)}`);
  return JSON.parse(line.slice('@@PROBE@@'.length));
}

function tempFiles(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-layout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

test('the helper guard finds a test registered at load (in a loop too) with its line, and ignores one inside a function', (t) => {
  const dir = tempFiles(t, {
    'registers.js': "const test = require('node:test');\nconst x = 1;\nfor (const n of [1, 2]) {\n  test(`case ${n}`, () => {});\n}\n",
    'describes.js': "const { describe } = require('node:test');\n\ndescribe('group', () => {});\n",
    'clean.js': "const test = require('node:test');\nfunction register() {\n  test('later', () => {});\n}\nmodule.exports = { register };\n",
  });
  const files = ['registers.js', 'describes.js', 'clean.js'].map((f) => path.join(dir, f));
  const { calls, errors } = loadTimeRegistrations(files);
  assert.deepEqual(errors.map((e) => e.error), []);
  const found = calls.map((c) => `${path.basename(c.file)}:${c.line}:${c.fn}`);
  assert.deepEqual(found, ['registers.js:4:test', 'registers.js:4:test', 'describes.js:3:describe']);
});

test('no file under test/ other than *.test.js registers a test or a suite when it is loaded', () => {
  const files = helperFiles();
  assert.ok(files.some((f) => rel(f) === 'packages/engine/test/engine-helpers.js'), 'packages/engine/test/engine-helpers.js is scanned');
  const { calls, errors } = loadTimeRegistrations(files);
  assert.deepEqual(errors.map((e) => `${rel(e.file)}: ${e.error}`), [], 'every helper loads on its own');
  const where = calls.map((c) => `${rel(c.file)}:${c.line} calls ${c.fn}() at load; move it to a *.test.js file`);
  assert.deepEqual(where, [], `helpers register tests:\n${where.join('\n')}`);
});

test('the unit_tests x e2e_tests matrix of software-development runs once, from a slow test file', () => {
  const matrix = 'x e2e_tests=';
  const holders = testFiles().filter((f) => f !== __filename && fs.readFileSync(f, 'utf8').includes(matrix)).map(rel);
  assert.equal(holders.length, 1, `one test file holds the matrix, found: ${holders.join(', ') || 'none'}`);
  assert.match(holders[0], /^packages\/engine\/test\/slow\/[^/]+\.slow\.test\.js$/, 'the matrix (nine whole simulated runs) is a slow file');
  assert.equal(fs.readFileSync(path.join(engineTestDir, 'engine-helpers.js'), 'utf8').includes(matrix), false, 'test/engine-helpers.js no longer holds it');
});

test('the software-development whole runs are split by theme into at least four slow files', () => {
  const parts = fs.readdirSync(path.join(engineTestDir, 'slow')).filter((f) => /^engine-software-development.*\.slow\.test\.js$/.test(f));
  assert.ok(parts.length >= 4, `test/slow/engine-software-development*.slow.test.js: ${parts.length} file(s): ${parts.join(', ')}`);
});

test('test/worktree.test.js and test/merge-recovery.test.js are each split in two files or more', () => {
  const names = testFiles().map((f) => path.basename(f));
  const worktree = names.filter((n) => /^worktree.*\.test\.js$/.test(n));
  const merge = names.filter((n) => /^merge-recovery.*\.test\.js$/.test(n));
  assert.ok(worktree.length >= 2, `worktree*.test.js: ${worktree.join(', ')}`);
  assert.ok(merge.length >= 2, `merge-recovery*.test.js: ${merge.join(', ')}`);
});

test('every test title of the split files (and the matrix) still exists, in exactly one test file', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(engineTestDir, 'fixtures', 'suite-split-titles-305.json'), 'utf8'));
  const sources = testFiles().map((f) => ({ file: rel(f), text: fs.readFileSync(f, 'utf8') }));
  const problems = [];
  let count = 0;
  for (const [origin, titles] of Object.entries(snapshot)) {
    for (const title of titles) {
      count++;
      const holders = sources.filter((s) => s.text.includes(title)).map((s) => s.file);
      if (holders.length !== 1) problems.push(`${origin}: "${title.slice(0, 90)}" in ${holders.length} test file(s) ${holders.join(', ')}`);
    }
  }
  assert.equal(count, 79, 'the snapshot holds the 31 + 27 + 20 titles and the matrix');
  assert.deepEqual(problems, []);
});

test('a non-slow test file never starts a whole run with the engine helpers', () => {
  const runners = /\b(runSoftwareDevelopment|runWriterReviewer|arenaRun|backlogRefreshRun|runWith|runsWith|runLoopBlocked|runConditionalAction|retro)\s*\(/;
  const offenders = testFiles()
    .filter((f) => !slash(f).includes('/test/slow/'))
    .filter((f) => {
      const text = fs.readFileSync(f, 'utf8');
      return /require\(['"]\.\.?\/(\.\.\/)?engine-helpers['"]\)/.test(text) && runners.test(text);
    })
    .map(rel);
  assert.deepEqual(offenders, []);
});

test("the JS test writer's skills point at docs/agents/testing.md for when a change needs a whole-run test", () => {
  const skills = ['unit-test-writer-js', 'testing-principles'].map((s) => fs.readFileSync(path.join(root, 'skills', s, 'SKILL.md'), 'utf8'));
  assert.ok(skills.some((text) => text.includes('docs/agents/testing.md')), 'skills/unit-test-writer-js or skills/testing-principles mentions docs/agents/testing.md');
});
