// Acceptance tests for #52: more files under the type checker of #346 (packages/engine/test/typecheck-346.test.js
// keeps the ratchet of that issue). A new source file opts in, the silenced lines of the opted-in files
// are recorded and only go down, the files to check next are ranked from git, and the coverage is printed.
// Seam: scripts/typecheck.js, and scripts/check.js `runChecks` (`npm run check`):
//   UNCHECKED                                        -> sorted source paths that existed before the rule and have not opted in
//   checkRatchet({ root, checked, next, unchecked }) -> also { kind: 'new-file' } for a source file that has no // @ts-check
//                                                      and is in none of the lists, and 'leave-list' for a file of
//                                                      `unchecked` that opted in (generated, vendored and test files are out)
//   SILENCED                                         -> { '<file>': number of silenced lines } of the opted-in files
//   checkSilenced({ root, recorded })                -> [{ file, line?, kind: 'no-reason' | 'more' | 'fewer', message }]
//   nextFiles({ root })                              -> (a promise of) [{ file, fixes, changes, errors }], most valuable first:
//                                                      commits of the last 60 days, and what tsc reports with checkJs on
//   coverage({ root })                               -> { checked, total }
//   node scripts/typecheck.js                        prints `<checked> of <total>`; `--next` prints nextFiles
// A silenced line is `@ts-ignore`, `@ts-nocheck` or a cast `/** @type {any} */ (x)`; its reason is text after
// the directive (`// @ts-ignore: why`) or a `//` comment at the end of the cast's line.
// Assumptions: generated and vendored files are those under a generated/ or vendor/ folder; a commit fixes a bug
// when its subject starts with "Fix"; the files that existed before the rule are recorded by path in UNCHECKED.
// The exports are created by the change: the module is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..', '..');
const load = () => require('../../../scripts/typecheck.js');
const posix = (p) => String(p).replace(/\\/g, '/');
const found = (problems) => problems.map((p) => ({ file: posix(p.file), kind: p.kind })).sort((a, b) => a.file.localeCompare(b.file));
const DAY = 24 * 60 * 60 * 1000;
const OK = 'module.exports = 1;\n';
const CHECKED_OK = `// @ts-check\n${OK}`;
const TYPE_ERROR = "/** @type {number} */\nconst n = 'not a number';\nmodule.exports = { n };\n";

function write(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// A scratch project whose jsconfig.json extends this repository's; { 'src/a.js': text } written as files.
function project(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typecheck-52-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  const jsconfig = {
    extends: posix(path.join(root, 'jsconfig.json')),
    compilerOptions: { typeRoots: [posix(path.join(root, 'node_modules', '@types'))] },
    include: ['src/**/*.js'],
  };
  write(dir, { 'jsconfig.json': JSON.stringify(jsconfig, null, 2), ...files });
  return dir;
}

// One commit of everything in `dir`, `daysAgo` days before now.
function commit(dir, subject, daysAgo) {
  const date = new Date(Date.now() - daysAgo * DAY).toISOString();
  const git = (...args) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  if (!fs.existsSync(path.join(dir, '.git'))) git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', subject);
}

// The lines `npm run check` gives for a project: the typecheck rule, and any rule #52 adds.
const OTHER_RULES = ['lint:lists', 'layers', 'file-size', 'code-health', 'decisions', 'docs', 'oracle-capabilities', 'workflows', 'test-fixtures'];
async function checkLines(dir) {
  const { RULES, runChecks } = require('../../../scripts/check');
  return runChecks(dir, RULES.filter(([name]) => !OTHER_RULES.includes(name)));
}

// ---- new files ----

test('#52 a new source file without // @ts-check fails the ratchet; one recorded as older, or with it, does not', (t) => {
  const { checkRatchet } = load();
  const dir = project(t, { 'src/new.js': OK, 'src/old.js': OK, 'src/todo.js': OK, 'packages/a/new-too.js': OK, 'src/checked.js': CHECKED_OK });
  const problems = checkRatchet({ root: dir, checked: ['src/checked.js'], next: ['src/todo.js'], unchecked: ['src/old.js'] });
  assert.deepEqual(found(problems), [{ file: 'packages/a/new-too.js', kind: 'new-file' }, { file: 'src/new.js', kind: 'new-file' }]);
  for (const p of problems) {
    assert.ok(p.message.includes(p.file), p.message);
    assert.match(p.message, /\/\/ @ts-check/);
  }
});

test('#52 generated, vendored and test files are out of the rule for new files', (t) => {
  const { checkRatchet } = load();
  const dir = project(t, { 'packages/a/generated/bundle.js': OK, 'packages/a/vendor/lib.js': OK, 'packages/a/test/a.test.js': OK, 'packages/a/mine.js': OK });
  assert.deepEqual(found(checkRatchet({ root: dir, checked: [], next: [], unchecked: [] })), [{ file: 'packages/a/mine.js', kind: 'new-file' }]);
});

test('#52 a file recorded as unchecked that opted in fails until it leaves the record', (t) => {
  const { checkRatchet } = load();
  const dir = project(t, { 'src/done.js': CHECKED_OK });
  const problems = checkRatchet({ root: dir, checked: ['src/done.js'], next: [], unchecked: ['src/done.js'] });
  assert.deepEqual(found(problems), [{ file: 'src/done.js', kind: 'leave-list' }]);
  assert.match(problems[0].message, /UNCHECKED/);
});

test('#52 UNCHECKED is a sorted list of existing files, none of them in CHECKED', () => {
  const { CHECKED, UNCHECKED } = load();
  assert.equal(Array.isArray(UNCHECKED), true, 'UNCHECKED is an array');
  assert.deepEqual([...UNCHECKED], [...UNCHECKED].sort(), 'UNCHECKED is sorted');
  assert.equal(new Set(UNCHECKED).size, UNCHECKED.length, 'no duplicates');
  assert.deepEqual(UNCHECKED.filter((f) => !fs.existsSync(path.join(root, ...f.split('/')))), []);
  assert.deepEqual(UNCHECKED.filter((f) => CHECKED.includes(f)), []);
});

test('#52 npm run check says which new file does not start with // @ts-check', async (t) => {
  const dir = project(t, { 'src/zz-new-52.js': OK, 'src/zz-typed-52.js': CHECKED_OK });
  const lines = await checkLines(dir);
  const hits = lines.filter((l) => l.includes('src/zz-new-52.js'));
  assert.equal(hits.length, 1, `one line names the new file, got ${hits.length}`);
  assert.match(hits[0], /\/\/ @ts-check/);
});

// ---- next files ----

test('#52 nextFiles ranks the unchecked files by the fixes and changes of the last 60 days, with the errors tsc reports on each', async (t) => {
  const { nextFiles } = load();
  const dir = project(t, { 'src/buggy.js': TYPE_ERROR, 'src/busy.js': OK, 'src/quiet.js': OK, 'src/checked.js': CHECKED_OK });
  commit(dir, 'Start', 120);
  for (let i = 0; i < 6; i++) {
    write(dir, { 'src/quiet.js': `${OK}// old ${i}\n` });
    commit(dir, `Fix the quiet file, long ago (${i})`, 110 - i);
  }
  for (let i = 0; i < 4; i++) {
    write(dir, { 'src/buggy.js': `${TYPE_ERROR}// ${i}\n`, 'src/checked.js': `${CHECKED_OK}// ${i}\n` });
    commit(dir, i < 3 ? `Fix a crash on an empty list (#${i + 1})` : 'A new column in the list', 30 - i);
  }
  for (let i = 0; i < 2; i++) {
    write(dir, { 'src/busy.js': `${OK}// ${i}\n` });
    commit(dir, `Another option for the panel (${i})`, 20 - i);
  }
  const rows = (await nextFiles({ root: dir })).map(({ file, fixes, changes, errors }) => ({ file: posix(file), fixes, changes, errors }));
  assert.deepEqual(rows, [
    { file: 'src/buggy.js', fixes: 3, changes: 4, errors: 1 },
    { file: 'src/busy.js', fixes: 0, changes: 2, errors: 0 },
    { file: 'src/quiet.js', fixes: 0, changes: 0, errors: 0 },
  ]);
});

test('#52 the first 20 of the next files opted in: 48 files or more are checked (28 before)', () => {
  const { CHECKED, findOptedIn } = load();
  assert.ok(CHECKED.length >= 48, `CHECKED has ${CHECKED.length} files`);
  assert.equal(findOptedIn({ root }).length, CHECKED.length);
});

// ---- no silencing ----

const silenced = (problems) => problems.map((p) => `${posix(p.file)} ${p.kind}`).sort();

test('#52 an opted-in file that silences the checker without a reason on the line is reported with its line', (t) => {
  const { checkSilenced } = load();
  const dir = project(t, {
    'src/cast.js': '// @ts-check\nconst x = /** @type {any} */ (globalThis);\nmodule.exports = { x };\n',
    'src/ignore.js': '// @ts-check\nconst y = 1;\n// @ts-ignore\ny.z = 2;\nmodule.exports = { y };\n',
    'src/nocheck.js': `// @ts-check\n// @ts-nocheck\n${OK}`,
  });
  const problems = checkSilenced({ root: dir, recorded: { 'src/cast.js': 1, 'src/ignore.js': 1, 'src/nocheck.js': 1 } });
  assert.deepEqual(problems.map((p) => `${posix(p.file)}:${p.line} ${p.kind}`).sort(), ['src/cast.js:2 no-reason', 'src/ignore.js:3 no-reason', 'src/nocheck.js:2 no-reason']);
  for (const p of problems) assert.match(p.message, /reason/i);
});

test('#52 silenced lines with their reason and in the record pass; an any that is not a cast, or a file that did not opt in, does not count', (t) => {
  const { checkSilenced } = load();
  const dir = project(t, {
    'src/cast.js': '// @ts-check\nconst x = /** @type {any} */ (globalThis); // the host page defines its own globals\nmodule.exports = { x };\n',
    'src/ignore.js': '// @ts-check\nconst y = 1;\n// @ts-ignore: the type of the library lacks this field\ny.z = 2;\nmodule.exports = { y };\n',
    'src/param.js': '// @ts-check\nconst f = (/** @type {any} */ a) => a;\nmodule.exports = { f };\n',
    'src/loose.js': '// @ts-ignore\nmodule.exports = /** @type {any} */ (1);\n',
  });
  assert.deepEqual(silenced(checkSilenced({ root: dir, recorded: { 'src/cast.js': 1, 'src/ignore.js': 1 } })), []);
});

test('#52 a silenced line above the record fails, even with its reason', (t) => {
  const { checkSilenced } = load();
  const dir = project(t, {
    'src/a.js': '// @ts-check\nconst x = /** @type {any} */ (1); // a reason\nconst y = /** @type {any} */ (2); // another reason\nmodule.exports = { x, y };\n',
    'src/b.js': '// @ts-check\nconst x = /** @type {any} */ (1); // a reason\nmodule.exports = { x };\n',
  });
  assert.deepEqual(silenced(checkSilenced({ root: dir, recorded: { 'src/a.js': 1 } })), ['src/a.js more', 'src/b.js more']);
});

test('#52 the record only goes down: a file with fewer silenced lines than recorded fails until the record is lowered', (t) => {
  const { checkSilenced } = load();
  const dir = project(t, { 'src/a.js': '// @ts-check\nconst x = /** @type {any} */ (1); // a reason\nmodule.exports = { x };\n', 'src/clean.js': CHECKED_OK });
  const problems = checkSilenced({ root: dir, recorded: { 'src/a.js': 2, 'src/clean.js': 1 } });
  assert.deepEqual(silenced(problems), ['src/a.js fewer', 'src/clean.js fewer']);
  for (const p of problems) assert.match(p.message, /SILENCED/);
});

test('#52 the silenced lines of this repository match the record, each with its reason', () => {
  const { checkSilenced, CHECKED, SILENCED } = load();
  assert.equal(typeof checkSilenced, 'function', 'checkSilenced is exported');
  assert.deepEqual(checkSilenced({ root }).map((p) => p.message), []);
  assert.deepEqual(Object.keys(SILENCED).filter((f) => !CHECKED.includes(f)), [], 'only opted-in files are recorded');
});

test('#52 npm run check names a silenced line that has no reason', async (t) => {
  const dir = project(t, { 'src/zz-silent-52.js': '// @ts-check\nconst y = 1;\n// @ts-ignore\ny.z = 2;\nmodule.exports = { y };\n' });
  const lines = await checkLines(dir);
  assert.equal(lines.some((l) => l.includes('src/zz-silent-52.js') && /reason/i.test(l)), true, lines.filter((l) => l.includes('zz-silent-52')).join('\n'));
});

// ---- coverage ----

test('#52 coverage counts the checked files of the sources: generated, vendored and test files are out', (t) => {
  const { coverage } = load();
  const dir = project(t, {
    'src/a.js': CHECKED_OK,
    'src/b.js': OK,
    'packages/a/c.js': OK,
    'packages/a/generated/bundle.js': OK,
    'packages/a/test/a.test.js': OK,
    'packages/a/vendor/lib.js': OK,
  });
  const { checked, total } = coverage({ root: dir });
  assert.deepEqual({ checked, total }, { checked: 1, total: 3 });
});

test('#52 node scripts/typecheck.js prints the checked files of the total', { timeout: 120000 }, () => {
  const { findOptedIn } = load();
  const { sourceFiles } = require('../../../scripts/source-tree');
  const r = spawnSync(process.execPath, ['scripts/typecheck.js'], { cwd: root, encoding: 'utf8', timeout: 110000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`.slice(-2000));
  const m = /\b(\d+) of (\d+)\b/.exec(r.stdout);
  assert.equal(m === null, false, `no "<checked> of <total>" in: ${r.stdout.slice(-500)}`);
  const checked = findOptedIn({ root }).length;
  assert.equal(Number(m[1]), checked);
  assert.ok(Number(m[2]) > checked && Number(m[2]) <= sourceFiles(root).length, `total ${m[2]}`);
});

// ---- docs ----

test('#52 docs/agents/testing says how a new file opts in, how a silenced line is recorded and where the next files are', () => {
  const dir = path.join(root, 'docs', 'agents', 'testing');
  const doc = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.match(doc, /#52\b/);
  assert.match(doc, /\bUNCHECKED\b/);
  assert.match(doc, /\bSILENCED\b/);
  assert.match(doc, /@ts-ignore/);
  assert.match(doc, /typecheck\.js --next/);
});
