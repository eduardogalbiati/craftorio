// #346: type checking with checkJs and JSDoc types, file by file, with a ratchet. `typescript` is a
// dev dependency; jsconfig.json keeps checkJs off and files opt in with `// @ts-check`;
// `npm run typecheck` runs `tsc --noEmit -p jsconfig.json`. The core shapes are JSDoc typedefs in
// src/shared/types.js. The ratchet: every opted-in file passes the checker (this test, so `npm test`
// runs it on every OS), CHECKED records the files that opted in (one can't opt out), NEXT is the
// owner's list of files to check next and shrinks as they opt in.
// Seam: scripts/typecheck.js { CHECKED, NEXT, findOptedIn, checkRatchet, typecheck }:
//   findOptedIn({ root })                  -> sorted 'src/...' paths (with /) that carry // @ts-check
//   checkRatchet({ root, checked, next })  -> [{ file, kind: 'opted-out' | 'unlisted' | 'leave-list', message }]
//   typecheck({ root })                    -> (a promise of) [{ file, line, message }] from tsc on root/jsconfig.json
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const load = () => require('../scripts/typecheck.js');
const posix = (p) => String(p).replace(/\\/g, '/');
const read = (rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
const hasTsCheck = (text) => /^\s*\/\/\s*@ts-check\b/m.test(text);
const FIRST_FILES = ['src/domains/roadmap/roadmap.js', 'src/domains/run/run-costs.js', 'src/domains/usage/cost-estimate.js'];
const runFiles = () => fs.readdirSync(path.join(root, 'src', 'engine', 'run')).filter((f) => f.endsWith('.js')).map((f) => `src/engine/run/${f}`);
const found = (problems) => problems.map((p) => ({ file: posix(p.file), kind: p.kind })).sort((a, b) => a.file.localeCompare(b.file));
const errorFiles = (errors) => [...new Set(errors.map((e) => posix(e.file).replace(/^.*?(?=src\/)/, '')))].sort();

// A scratch project: its jsconfig.json extends this repository's, so the scratch files are checked
// with the same options; { 'src/a.js': text } written as files.
function project(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typecheck-346-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const jsconfig = {
    extends: posix(path.join(root, 'jsconfig.json')),
    compilerOptions: { typeRoots: [posix(path.join(root, 'node_modules', '@types'))] },
    include: ['src/**/*.js'],
  };
  fs.writeFileSync(path.join(dir, 'jsconfig.json'), JSON.stringify(jsconfig, null, 2));
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return dir;
}

const TYPES = posix(path.join(root, 'src', 'shared', 'types.js'));
const CORE_TYPES = ['RunSummary', 'RunEvent', 'RoadmapItem', 'RoadmapStage', 'Roadmap', 'Workflow', 'WorkflowStep', 'SessionRecord'];

test('#346 typescript is a dev dependency and `npm run typecheck` runs tsc --noEmit -p jsconfig.json', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(typeof (pkg.devDependencies || {}).typescript, 'string', 'typescript in devDependencies');
  assert.equal(Object.hasOwn(pkg.dependencies || {}, 'typescript'), false, 'not a runtime dependency');
  assert.equal((pkg.scripts || {}).typecheck, 'tsc --noEmit -p jsconfig.json');
});

test('#346 jsconfig.json checks JavaScript only where a file opts in (checkJs off by default)', () => {
  const ts = require('typescript');
  const parsed = ts.parseConfigFileTextToJson('jsconfig.json', read('jsconfig.json'));
  assert.equal(parsed.error, undefined, 'jsconfig.json parses');
  const options = parsed.config.compilerOptions || {};
  assert.notEqual(options.checkJs, true, 'checkJs is not on for every file');
});

test('#346 a type error fails only in a file that opted in with // @ts-check', async (t) => {
  const { typecheck } = load();
  const bad = "/** @type {number} */\nconst n = 'not a number';\nmodule.exports = { n };\n";
  const dir = project(t, { 'src/checked.js': `// @ts-check\n${bad}`, 'src/loose.js': bad, 'src/fine.js': '// @ts-check\n/** @type {number} */\nconst n = 1;\nmodule.exports = { n };\n' });
  const errors = await typecheck({ root: dir });
  assert.deepEqual(errorFiles(errors), ['src/checked.js']);
  const err = errors.find((e) => posix(e.file).endsWith('src/checked.js'));
  assert.equal(err.line, 3);
  assert.equal(typeof err.message, 'string');
  assert.ok(err.message.length > 0);
});

test('#346 every file of this repository that opted in passes the checker', async () => {
  const { typecheck } = load();
  const errors = await typecheck({ root });
  assert.deepEqual(errors.map((e) => `${posix(e.file)}:${e.line} ${e.message}`), []);
});

test('#346 the first files checked carry // @ts-check and are recorded in CHECKED', () => {
  const { CHECKED, findOptedIn } = load();
  const first = [...FIRST_FILES, ...runFiles()].sort();
  assert.ok(first.length > FIRST_FILES.length, 'src/engine/run/ has .js files');
  for (const file of first) assert.equal(hasTsCheck(read(file)), true, `${file} carries // @ts-check`);
  const optedIn = findOptedIn({ root });
  for (const file of first) {
    assert.ok(optedIn.includes(file), `findOptedIn lists ${file}`);
    assert.ok(CHECKED.includes(file), `CHECKED lists ${file}`);
  }
});

test('#346 CHECKED and NEXT are sorted lists of existing src/ files, and no file is in both', () => {
  const { CHECKED, NEXT } = load();
  for (const [name, list] of [['CHECKED', CHECKED], ['NEXT', NEXT]]) {
    assert.equal(Array.isArray(list), true, `${name} is an array`);
    assert.deepEqual([...list], [...list].sort(), `${name} is sorted`);
    assert.equal(new Set(list).size, list.length, `${name} has no duplicates`);
    for (const file of list) assert.ok(fs.existsSync(path.join(root, ...file.split('/'))), `${name}: ${file} exists`);
  }
  assert.deepEqual(NEXT.filter((f) => CHECKED.includes(f)), []);
});

test('#346 the ratchet holds on this repository: CHECKED is exactly the opted-in files, none of NEXT opted in', () => {
  const { CHECKED, NEXT, findOptedIn, checkRatchet } = load();
  assert.deepEqual(checkRatchet({ root }).map((p) => p.message), []);
  assert.deepEqual([...findOptedIn({ root })], [...CHECKED]);
  for (const file of NEXT) assert.equal(hasTsCheck(read(file)), false, `${file} in NEXT has not opted in yet`);
});

test('#346 findOptedIn lists the files with // @ts-check in their leading comments, LF or CRLF', (t) => {
  const { findOptedIn } = load();
  const dir = project(t, {
    'src/a.js': '// @ts-check\nmodule.exports = 1;\n',
    'src/deep/b.js': '// b: the header comment of the code map.\r\n// @ts-check\r\nmodule.exports = 2;\r\n',
    'src/c.js': 'module.exports = 3;\n',
    'src/d.js': '// @ts-nocheck\nmodule.exports = 4;\n',
  });
  assert.deepEqual([...findOptedIn({ root: dir })], ['src/a.js', 'src/deep/b.js']);
});

test('#346 a file in CHECKED that dropped // @ts-check fails: an opted-in file cannot opt out', (t) => {
  const { checkRatchet } = load();
  const dir = project(t, { 'src/kept.js': '// @ts-check\nmodule.exports = 1;\n', 'src/dropped.js': 'module.exports = 2;\n' });
  const problems = checkRatchet({ root: dir, checked: ['src/dropped.js', 'src/kept.js'], next: [] });
  assert.deepEqual(found(problems), [{ file: 'src/dropped.js', kind: 'opted-out' }]);
  assert.match(problems[0].message, /src\/dropped\.js/);
  assert.match(problems[0].message, /@ts-check/);
});

test('#346 a file that opted in but is not in CHECKED fails until it is recorded', (t) => {
  const { checkRatchet } = load();
  const dir = project(t, { 'src/new.js': '// @ts-check\nmodule.exports = 1;\n' });
  const problems = checkRatchet({ root: dir, checked: [], next: [] });
  assert.deepEqual(found(problems), [{ file: 'src/new.js', kind: 'unlisted' }]);
  assert.match(problems[0].message, /CHECKED/);
});

test('#346 a file of NEXT that opted in fails until it leaves NEXT: the list only shrinks', (t) => {
  const { checkRatchet } = load();
  const dir = project(t, { 'src/done.js': '// @ts-check\nmodule.exports = 1;\n', 'src/todo.js': 'module.exports = 2;\n' });
  const problems = checkRatchet({ root: dir, checked: ['src/done.js'], next: ['src/done.js', 'src/todo.js'] });
  assert.deepEqual(found(problems), [{ file: 'src/done.js', kind: 'leave-list' }]);
  assert.match(problems[0].message, /NEXT/);
  assert.deepEqual(checkRatchet({ root: dir, checked: ['src/done.js'], next: ['src/todo.js'] }), []);
});

test('#346 a file listed in both CHECKED and NEXT that dropped // @ts-check is reported once, as opted out', (t) => {
  const { checkRatchet } = load();
  const dir = project(t, { 'src/both.js': 'module.exports = 1;\n' });
  assert.deepEqual(found(checkRatchet({ root: dir, checked: ['src/both.js'], next: ['src/both.js'] })), [{ file: 'src/both.js', kind: 'opted-out' }]);
});

test('#346 src/shared/types.js defines the core shapes as JSDoc typedefs another checked file can import', async (t) => {
  const { typecheck } = load();
  const text = read('src/shared/types.js');
  for (const name of CORE_TYPES) assert.match(text, new RegExp(`@typedef\\s*\\{[\\s\\S]*?\\}\\s*${name}\\b|@typedef\\s+${name}\\b`), `@typedef ${name}`);
  const uses = CORE_TYPES.map((name) => `/** @param {import('${TYPES}').${name}} x */\nfunction use${name}(x) { return x; }`).join('\n');
  const dir = project(t, {
    'src/uses.js': `// @ts-check\n${uses}\nmodule.exports = { ${CORE_TYPES.map((n) => `use${n}`).join(', ')} };\n`,
    'src/missing.js': `// @ts-check\n/** @param {import('${TYPES}').NoSuchType346} x */\nfunction f(x) { return x; }\nmodule.exports = { f };\n`,
  });
  assert.deepEqual(errorFiles(await typecheck({ root: dir })), ['src/missing.js'], 'the core types resolve; an unknown one does not');
});

test('#346 RunEvent is a union by `type`: an event with an unknown type is a type error', async (t) => {
  const { typecheck } = load();
  const dir = project(t, {
    'src/read.js': `// @ts-check\n/** @param {import('${TYPES}').RunEvent} e */\nfunction kind(e) { return e.type; }\nmodule.exports = { kind };\n`,
    'src/write.js': `// @ts-check\n/** @type {import('${TYPES}').RunEvent} */\nconst e = { type: 'no-such-event-346' };\nmodule.exports = { e };\n`,
  });
  assert.deepEqual(errorFiles(await typecheck({ root: dir })), ['src/write.js']);
});

test('#346 docs/agents/testing.md says how to opt a file in, where the types live and how the ratchet works', () => {
  const doc = read('docs/agents/testing.md');
  assert.match(doc, /\/\/ @ts-check/);
  assert.match(doc, /src\/shared\/types\.js/);
  assert.match(doc, /npm run typecheck/);
  assert.match(doc, /scripts\/typecheck\.js/);
  assert.match(doc, /\bNEXT\b/);
  assert.match(doc, /#346/);
});
