// #344: code health ratchets. scripts/code-health.js measures every function under src/ and
// scripts/ (lines, cyclomatic complexity, max nesting, parameter count) with a real JS parser (a
// pinned dev dependency, never Playwright's bundle). Two ratchets, like #334's line ratchet:
// - complexity: no function above 25; the functions above it when the rule came are listed with
//   their value and may only go down, and a listed function at 25 or below must leave the list;
// - duplication: repeated blocks of 8 or more normalized lines are counted per file against a
//   committed baseline; a new duplicate fails, a fixed one must lower the baseline.
// `--hotspots` ranks files and functions by complexity x churn (git log, after #356 / ToolSeeds
// turbulence): merges and the creating commit skipped, renames followed, .git-blame-ignore-revs
// honoured, four quadrants on log1p axes split at the medians, the Danger Zone ranked first.
// The output is deterministic (sorted keys, commit timestamps) and unreadable data is "missing".
//
// Seam: scripts/code-health.js {
//   MAX_COMPLEXITY, COMPLEXITY_EXCEPTIONS ('<file>:<function name>' -> value), DUPLICATION_BASELINE
//   (file -> count of duplicated blocks), MIN_DUPLICATE_LINES,
//   analyzeSource(code, file) -> [{ name, file, line, lines, complexity, nesting, params }],
//   checkComplexity({ root, exceptions }) -> [{ file, name, kind: 'over' | 'grew' | 'leave-list', complexity, message }],
//   countDuplicates({ file: text }) -> { file: blocks } (files without a duplicate may be absent),
//   checkDuplication({ root, baseline }) -> [{ file, kind: 'new' | 'grew' | 'lower-baseline', count, message }],
//   hotspots({ root }) -> { files: [{ file, commits, complexity, worst, quadrant, score }], functions: [...], missing: [...] },
// } and the CLI: node scripts/code-health.js [--json] [--hotspots] [--root <dir>].
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const SCRIPT = path.join(root, 'scripts', 'code-health.js');
const load = () => require('../scripts/code-health.js');

function scratch(t, prefix = 'health-344-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, rel, text) {
  const file = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// The one function of a snippet (or the one with this name), as primitives.
function fn(code, name) {
  const all = load().analyzeSource(code, 'src/x.js');
  const f = name ? all.find((x) => x.name === name) : all[0];
  assert.ok(f, `function ${name || '(first)'} found`);
  return { name: f.name, complexity: f.complexity, nesting: f.nesting, params: f.params, lines: f.lines, line: f.line };
}

// A function of complexity 1 + n (n plain `if`s in a row, no nesting).
const ifs = (name, n) => `function ${name}(a) {\n${Array.from({ length: n }, (_, i) => `  if (a === ${i}) a++;`).join('\n')}\n  return a;\n}\n`;

const found = (problems) => problems.map((p) => ({ file: p.file, name: p.name, kind: p.kind })).sort((a, b) => `${a.file}:${a.name}`.localeCompare(`${b.file}:${b.name}`));

const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

// A fixture repository with fixed authors and dates (2020), so the report is reproducible.
function repo(t) {
  const dir = scratch(t, 'health-344-repo-');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'fixture@example.com']);
  git(dir, ['config', 'user.name', 'Fixture']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  let day = 1;
  const commit = (message) => {
    const date = `2020-01-${String(day++).padStart(2, '0')}T12:00:00Z`;
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--no-verify', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    return git(dir, ['rev-parse', 'HEAD']).trim();
  };
  return { dir, commit, write: (rel, text) => write(dir, rel, text) };
}

const fileRow = (report, file) => report.files.find((f) => f.file === file);

// ---------- the parser and the metric ----------

// #385: the app measures JavaScript with the same parser, so it ships as a runtime dependency
test('#344 the parser is a pinned runtime dependency and the script does not load Playwright', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const deps = pkg.dependencies || {};
  const parser = ['@babel/parser', 'acorn'].find((p) => p in deps);
  assert.ok(parser, 'package.json dependencies has @babel/parser or acorn');
  assert.match(deps[parser], /^\d+\.\d+\.\d+$/, `${parser} is pinned to an exact version`);
  assert.equal(/playwright/i.test(fs.readFileSync(SCRIPT, 'utf8')), false, 'scripts/code-health.js never imports Playwright');
});

test('#344 the complexity limit is 25', () => {
  assert.equal(load().MAX_COMPLEXITY, 25);
});

test('#344 a function without branches has complexity 1', () => {
  assert.equal(fn('function plain(a, b) {\n  return a + b;\n}\n').complexity, 1);
});

test('#344 each branch kind counts once', () => {
  const cases = {
    if: 'function f(a) { if (a) return 1; return 2; }',
    'if/else': 'function f(a) { if (a) { return 1; } else { return 2; } }',
    ternary: 'function f(a) { return a ? 1 : 2; }',
    '&&': 'function f(a, b) { return a && b; }',
    '||': 'function f(a, b) { return a || b; }',
    '??': 'function f(a, b) { return a ?? b; }',
    catch: 'function f(a) { try { a(); } catch (e) { return e; } }',
    for: 'function f(a) { for (let i = 0; i < a; i++) a--; }',
    'for-in': 'function f(a) { for (const k in a) a[k] = 1; }',
    'for-of': 'function f(a) { for (const x of a) x(); }',
    while: 'function f(a) { while (a) a--; }',
    'do-while': 'function f(a) { do { a--; } while (a); }',
    'one case': 'function f(a) { switch (a) { case 1: return 1; default: return 2; } }',
  };
  for (const [kind, code] of Object.entries(cases)) assert.equal(fn(code).complexity, 2, kind);
});

test('#344 else if adds one per condition, cases one each, and default nothing', () => {
  assert.equal(fn('function f(a) { if (a === 1) return 1; else if (a === 2) return 2; else return 3; }').complexity, 3);
  assert.equal(fn('function f(a) { switch (a) { case 1: return 1; case 2: return 2; case 3: return 3; default: return 0; } }').complexity, 4);
  assert.equal(fn('function f(a, b, c) { return (a && b) || c; }').complexity, 3);
});

test('#344 a nested function is measured on its own and does not add to its parent', () => {
  const code = 'function outer(a) {\n  if (a) a++;\n  function inner(b) {\n    if (b) return 1;\n    return b ? 2 : 3;\n  }\n  return inner(a);\n}\n';
  assert.equal(fn(code, 'outer').complexity, 2);
  assert.equal(fn(code, 'inner').complexity, 3);
});

test('#344 max nesting, parameter count, lines and the starting line of a function', () => {
  const code = '// header\n\nfunction deep(a, b, c) {\n  if (a) {\n    for (const x of b) {\n      while (c) c--;\n    }\n  }\n  return a;\n}\n';
  const f = fn(code, 'deep');
  assert.equal(f.nesting, 3);
  assert.equal(f.params, 3);
  assert.equal(f.lines, 8);
  assert.equal(f.line, 3);
  assert.equal(fn('function flat() { return 1; }').nesting, 0);
  assert.equal(fn('function flat() { return 1; }').params, 0);
});

test('#344 arrow functions, methods and modern syntax are measured, named after their binding', () => {
  const code = [
    'const pick = (a, b) => (a ? a : b);',
    'class Box {',
    '  #size = 0;',
    '  grow(n) { return this.#size += n ?? 1; }',
    '  async load(p) { const r = await p?.then?.((x) => x); return { ...r }; }',
    '}',
    '',
  ].join('\n');
  const names = load().analyzeSource(code, 'src/x.js').map((f) => f.name);
  assert.ok(names.some((n) => /pick/.test(n)), `pick measured: ${names.join(', ')}`);
  assert.ok(names.some((n) => /grow/.test(n)), `grow measured: ${names.join(', ')}`);
  assert.ok(names.some((n) => /load/.test(n)), `load measured: ${names.join(', ')}`);
  assert.equal(fn(code, names.find((n) => /pick/.test(n))).complexity, 2);
  assert.equal(fn(code, names.find((n) => /grow/.test(n))).complexity, 2);
});

// ---------- the complexity ratchet ----------

test('#344 every function under src/ and scripts/ of this repository is within 25 or a listed exception that has not grown', () => {
  const problems = load().checkComplexity({ root });
  assert.deepEqual(problems.map((p) => p.message), []);
});

test('#344 the exceptions list holds only functions above 25, as "<file>:<name>" with a whole value', () => {
  const { COMPLEXITY_EXCEPTIONS } = load();
  const keys = Object.keys(COMPLEXITY_EXCEPTIONS);
  assert.ok(keys.length > 0, 'the functions above 25 today are listed');
  for (const key of keys) {
    const file = key.slice(0, key.indexOf(':'));
    assert.match(file, /^(src|scripts|packages|apps)\/.+\.js$/, `${key}: a source file (src/, a workspace, scripts/)`);
    assert.equal(fs.existsSync(path.join(root, ...file.split('/'))), true, `${key}: the file exists`);
    assert.equal(Number.isInteger(COMPLEXITY_EXCEPTIONS[key]) && COMPLEXITY_EXCEPTIONS[key] > 25, true, `${key}: a whole value above 25`);
  }
  // loadWorkflow (188 at 383469a) left the list with its rule table (#352)
  assert.ok(keys.some((k) => k.startsWith('src/engine/run/sessions.js:')), 'agentTurn (103) is listed');
});

test('#344 a new function above 25 fails, naming the function, its value and where the how-to is', (t) => {
  const dir = scratch(t);
  write(dir, 'src/a.js', ifs('tooBranchy', 25) + ifs('fine', 24));
  write(dir, 'scripts/tool.js', ifs('toolMain', 30));
  write(dir, 'test/ignored.test.js', ifs('testHelper', 40));
  const problems = load().checkComplexity({ root: dir, exceptions: {} });
  assert.deepEqual(found(problems), [
    { file: 'scripts/tool.js', name: 'toolMain', kind: 'over' },
    { file: 'src/a.js', name: 'tooBranchy', kind: 'over' },
  ]);
  const p = problems.find((x) => x.name === 'tooBranchy');
  assert.equal(p.complexity, 26);
  assert.match(p.message, /tooBranchy/);
  assert.match(p.message, /\b26\b/);
  assert.match(p.message, /docs\/agents\/testing\.md/);
});

test('#344 a listed function that grew fails; one at or below its value but above 25 passes', (t) => {
  const dir = scratch(t);
  write(dir, 'src/a.js', ifs('grown', 40) + ifs('same', 35) + ifs('smaller', 30));
  const problems = load().checkComplexity({ root: dir, exceptions: { 'src/a.js:grown': 40, 'src/a.js:same': 36, 'src/a.js:smaller': 36 } });
  assert.deepEqual(found(problems), [{ file: 'src/a.js', name: 'grown', kind: 'grew' }]);
  assert.match(problems[0].message, /grown/);
  assert.match(problems[0].message, /\b41\b/, 'the current value');
  assert.match(problems[0].message, /\b40\b/, 'the listed value');
  assert.match(problems[0].message, /docs\/agents\/testing\.md/);
});

test('#344 a listed function that drops to 25 or below, or is gone, fails until it leaves the list', (t) => {
  const dir = scratch(t);
  write(dir, 'src/a.js', ifs('fixed', 24) + ifs('atLimit', 24));
  const problems = load().checkComplexity({ root: dir, exceptions: { 'src/a.js:fixed': 40, 'src/a.js:atLimit': 30, 'src/a.js:removed': 50 } });
  assert.deepEqual(found(problems), [
    { file: 'src/a.js', name: 'atLimit', kind: 'leave-list' },
    { file: 'src/a.js', name: 'fixed', kind: 'leave-list' },
    { file: 'src/a.js', name: 'removed', kind: 'leave-list' },
  ]);
  assert.match(problems.find((p) => p.name === 'fixed').message, /list|exception/i);
});

// ---------- the duplication ratchet ----------

const block = (tag, n) => Array.from({ length: n }, (_, i) => `  total += values[${i}] * ${tag}${i};`).join('\n');

test('#344 a block of 8 or more lines repeated in two places counts once per file; 7 lines do not count', () => {
  const { countDuplicates, MIN_DUPLICATE_LINES } = load();
  assert.equal(MIN_DUPLICATE_LINES, 8);
  const counts = countDuplicates({
    'src/a.js': `function a(values) {\n  let total = 0;\n${block('w', 10)}\n  return total;\n}\n`,
    'src/b.js': `function b(values) {\n  let sum = 1;\n${block('w', 10)}\n  return -sum;\n}\n`,
    'src/c.js': `function c(values) {\n  let total = 0;\n${block('k', 7)}\n  return total;\n}\n`,
    'src/d.js': `function d(values) {\n  let other = 2;\n${block('k', 7)}\n  return other;\n}\n`,
  });
  assert.equal(counts['src/a.js'], 1);
  assert.equal(counts['src/b.js'], 1);
  assert.equal(counts['src/c.js'] || 0, 0);
  assert.equal(counts['src/d.js'] || 0, 0);
});

test('#344 duplicate blocks are normalized: indentation and line endings do not hide a copy', () => {
  const lines = block('z', 9).split('\n');
  const counts = load().countDuplicates({
    'src/a.js': `function a(values) {\n${lines.join('\n')}\n}\n`,
    'src/b.js': `class B {\r\n  m(values) {\r\n${lines.map((l) => `      ${l.trim()}`).join('\r\n')}\r\n  }\r\n}\r\n`,
  });
  assert.equal(counts['src/a.js'], 1);
  assert.equal(counts['src/b.js'], 1);
});

test('#344 this repository has no duplicated block beyond its committed baseline', () => {
  const { checkDuplication, DUPLICATION_BASELINE } = load();
  assert.equal(typeof DUPLICATION_BASELINE, 'object');
  for (const [file, n] of Object.entries(DUPLICATION_BASELINE)) assert.equal(Number.isInteger(n) && n > 0, true, `${file}: a positive count`);
  assert.deepEqual(checkDuplication({ root }).map((p) => p.message), []);
});

test('#344 a new duplicate fails; a file that has fewer duplicates than its baseline must lower it', (t) => {
  const dir = scratch(t);
  write(dir, 'src/a.js', `function a(values) {\n  let total = 0;\n${block('w', 9)}\n  return total;\n}\n`);
  write(dir, 'src/b.js', `function b(values) {\n  let sum = 0;\n${block('w', 9)}\n  return sum;\n}\n`);
  write(dir, 'src/c.js', 'const c = 1;\n');
  const { checkDuplication } = load();
  const fresh = checkDuplication({ root: dir, baseline: { 'src/a.js': 1 } });
  assert.deepEqual(fresh.map((p) => p.file), ['src/b.js']);
  assert.match(fresh[0].message, /src\/b\.js/);
  assert.match(fresh[0].message, /dupli/i);
  const fixed = checkDuplication({ root: dir, baseline: { 'src/a.js': 1, 'src/b.js': 1, 'src/c.js': 2 } });
  assert.deepEqual(fixed.map((p) => ({ file: p.file, kind: p.kind })), [{ file: 'src/c.js', kind: 'lower-baseline' }]);
  assert.deepEqual(checkDuplication({ root: dir, baseline: { 'src/a.js': 1, 'src/b.js': 1 } }), []);
});

// ---------- the CLI report ----------

test('#344 the CLI prints the distribution and the top functions; --json prints every function', (t) => {
  const dir = scratch(t);
  write(dir, 'src/a.js', ifs('worstOne', 12) + ifs('middle', 5) + 'function tiny() { return 1; }\n');
  const text = execFileSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' });
  assert.match(text, /median/i);
  assert.match(text, /p90/i);
  assert.match(text, /top/i);
  assert.match(text, /worstOne/);
  const json = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--json', '--root', dir], { encoding: 'utf8' }));
  const all = JSON.stringify(json);
  for (const name of ['worstOne', 'middle', 'tiny']) assert.ok(all.includes(`"${name}"`), `${name} in --json`);
  for (const key of ['complexity', 'nesting', 'params', 'lines']) assert.ok(all.includes(`"${key}"`), `${key} in --json`);
});

// ---------- hotspots ----------

test('#344 churn skips merges and the creating commit, follows renames and honours .git-blame-ignore-revs', (t) => {
  const r = repo(t);
  r.write('src/hot.js', ifs('hot', 10));
  r.write('src/old-name.js', ifs('moved', 3));
  r.commit('create');
  for (let i = 1; i <= 3; i++) { r.write('src/hot.js', ifs('hot', 10) + `// edit ${i}\n`); r.commit(`edit hot ${i}`); }
  git(r.dir, ['mv', 'src/old-name.js', 'src/new-name.js']);
  r.write('src/new-name.js', ifs('moved', 3) + '// renamed\n');
  r.commit('rename with a small edit');
  r.write('src/new-name.js', ifs('moved', 3) + '// renamed\n// after rename\n');
  r.commit('edit after rename');
  git(r.dir, ['switch', '-q', '-c', 'side']);
  r.write('src/hot.js', ifs('hot', 10) + '// side\n');
  r.commit('side edit');
  git(r.dir, ['switch', '-q', 'main']);
  git(r.dir, ['merge', '-q', '--no-ff', '-m', 'merge side', 'side'], { GIT_AUTHOR_DATE: '2020-02-01T12:00:00Z', GIT_COMMITTER_DATE: '2020-02-01T12:00:00Z' });
  r.write('src/hot.js', ifs('hot', 10).replace(/\n/g, '\n\n'));
  const reformat = r.commit('reformat');
  r.write('.git-blame-ignore-revs', `# mass reformat\n${reformat}\n`);
  r.commit('ignore reformat');

  const report = load().hotspots({ root: r.dir });
  assert.equal(fileRow(report, 'src/hot.js').commits, 4, '3 edits + the side edit; not the creation, the merge or the ignored reformat');
  assert.equal(fileRow(report, 'src/new-name.js').commits, 2, 'the renaming commit and the edit after it; the creation under the old name is followed and skipped');
});

test('#344 each file has its total complexity and its worst function', (t) => {
  const r = repo(t);
  r.write('src/a.js', ifs('big', 9) + ifs('small', 2));
  r.commit('create');
  const row = fileRow(load().hotspots({ root: r.dir }), 'src/a.js');
  assert.equal(row.complexity, 13);
  assert.equal(row.worst, 10);
});

test('#344 the hotspot report places files in the four quadrants and ranks the Danger Zone first, the hottest on top', (t) => {
  const r = repo(t);
  // [ifs (complexity - 1), edits]: churn median 5, complexity median 17, nobody on a median
  const files = { 'src/danger.js': [30, 8], 'src/hotter.js': [40, 10], 'src/cowboy.js': [30, 1], 'src/fertile.js': [1, 8], 'src/calm.js': [1, 1], 'src/quiet.js': [2, 2] };
  for (const [file, [n]] of Object.entries(files)) r.write(file, ifs(path.basename(file, '.js'), n));
  r.commit('create');
  for (let i = 1; i <= 10; i++) {
    for (const [file, [n, edits]] of Object.entries(files)) if (i <= edits) r.write(file, ifs(path.basename(file, '.js'), n) + `// edit ${i}\n`);
    r.commit(`edit ${i}`);
  }
  const report = load().hotspots({ root: r.dir });
  const quadrant = (file) => fileRow(report, file).quadrant;
  assert.equal(quadrant('src/hotter.js'), 'Danger Zone');
  assert.equal(quadrant('src/danger.js'), 'Danger Zone');
  assert.equal(quadrant('src/calm.js'), 'Healthy Closure');
  const names = new Set(['Danger Zone', 'Cowboy Code', 'Fertile Ground', 'Healthy Closure']);
  for (const f of report.files) assert.ok(names.has(f.quadrant), `${f.file}: ${f.quadrant}`);
  assert.notEqual(quadrant('src/cowboy.js'), quadrant('src/fertile.js'), 'complex-but-quiet and simple-but-busy are different quadrants');
  assert.deepEqual(report.files.slice(0, 2).map((f) => f.file), ['src/hotter.js', 'src/danger.js']);
  assert.ok(fileRow(report, 'src/hotter.js').score > fileRow(report, 'src/danger.js').score);
  assert.ok(Array.isArray(report.functions) && report.functions.length > 0, 'functions are ranked too');
});

// Every object in a JSON value has its keys in sorted order.
function keysSorted(value, where = '$') {
  if (Array.isArray(value)) return value.forEach((v, i) => keysSorted(v, `${where}[${i}]`));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    assert.deepEqual(keys, [...keys].sort(), `keys sorted at ${where}`);
    for (const k of keys) keysSorted(value[k], `${where}.${k}`);
  }
}

test('#344 --hotspots --json is deterministic: same output twice, sorted keys, timestamps from the commits', (t) => {
  const r = repo(t);
  r.write('src/a.js', ifs('alpha', 6));
  r.write('src/b.js', ifs('beta', 2));
  r.commit('create');
  r.write('src/a.js', ifs('alpha', 7));
  r.commit('edit');
  const run = () => execFileSync(process.execPath, [SCRIPT, '--hotspots', '--json', '--root', r.dir], { encoding: 'utf8' });
  const first = run();
  const second = run();
  assert.equal(first, second);
  keysSorted(JSON.parse(first));
  assert.ok(first.includes('2020-01-0'), 'a timestamp from the fixture commits');
  assert.equal(first.includes(new Date().toISOString().slice(0, 10)), false, 'no timestamp from the clock');
});

test('#344 the plain --hotspots report is stable between runs', (t) => {
  const r = repo(t);
  r.write('src/a.js', ifs('alpha', 6));
  r.write('src/b.js', ifs('beta', 6));
  r.commit('create');
  r.write('src/a.js', ifs('alpha', 7));
  r.write('src/b.js', ifs('beta', 7));
  r.commit('edit both');
  const run = () => execFileSync(process.execPath, [SCRIPT, '--hotspots', '--root', r.dir], { encoding: 'utf8' });
  const out = run();
  assert.equal(run(), out);
  assert.match(out, /src\/a\.js/);
});

test('#344 a shallow clone reports churn as missing, never as zero', (t) => {
  const r = repo(t);
  r.write('src/a.js', ifs('alpha', 6));
  r.commit('create');
  for (let i = 1; i <= 3; i++) { r.write('src/a.js', ifs('alpha', 6) + `// ${i}\n`); r.commit(`edit ${i}`); }
  const shallow = path.join(scratch(t, 'health-344-shallow-'), 'clone');
  const src = r.dir.replace(/\\/g, '/');
  git(r.dir, ['clone', '-q', '--depth', '1', `file://${src.startsWith('/') ? '' : '/'}${src}`, shallow]);
  const report = load().hotspots({ root: shallow });
  assert.ok(Array.isArray(report.missing) && report.missing.length > 0, 'the missing data is named');
  assert.equal(fileRow(report, 'src/a.js').commits, null, 'commits unknown, not 0');
});

// ---------- follow-ups after the implementation (test step) ----------

test('#344 logical assignments and optional chaining are not branches', () => {
  assert.equal(fn('function f(a, b) { a.x ||= 1; a.y &&= 2; a.z ??= 3; return b?.c?.(); }').complexity, 1);
});

test('#344 callbacks passed to the same call in one function get distinct names', () => {
  const code = "function register(bus) {\n  bus.on('a', () => 1);\n  bus.on('b', () => 2);\n  bus.on('c', function () { return 3; });\n}\n";
  const names = load().analyzeSource(code, 'src/x.js').map((f) => f.name);
  assert.equal(names.length, 4, names.join(', '));
  assert.equal(new Set(names).size, 4, `names are unique: ${names.join(', ')}`);
  for (const n of names.filter((x) => x !== 'register')) assert.match(n, /register/, `${n}: named after its enclosing function`);
});

test('#344 a file without functions has total complexity 0 and worst 0', (t) => {
  const r = repo(t);
  r.write('src/data.js', "module.exports = { a: 1, b: 'two' };\n");
  r.write('src/a.js', ifs('alpha', 2));
  r.commit('create');
  const row = fileRow(load().hotspots({ root: r.dir }), 'src/data.js');
  assert.equal(row.complexity, 0);
  assert.equal(row.worst, 0);
});

test('#344 a folder that is not a git repository reports churn as missing, never as zero', (t) => {
  const dir = scratch(t);
  write(dir, 'src/a.js', ifs('alpha', 3));
  const report = load().hotspots({ root: dir });
  assert.ok(report.missing.length > 0, 'the missing churn is named');
  assert.equal(fileRow(report, 'src/a.js').commits, null);
  assert.equal(fileRow(report, 'src/a.js').complexity, 4, 'complexity is still measured');
});

test('#344 an abbreviated hash in .git-blame-ignore-revs is honoured', (t) => {
  const r = repo(t);
  r.write('src/a.js', ifs('alpha', 2));
  r.commit('create');
  r.write('src/a.js', ifs('alpha', 2) + '// real edit\n');
  r.commit('edit');
  r.write('src/a.js', ifs('alpha', 2).replace(/\n/g, '\n\n') + '// real edit\n');
  const reformat = r.commit('reformat');
  r.write('.git-blame-ignore-revs', `${reformat.slice(0, 10)}\n`);
  r.commit('ignore reformat');
  assert.equal(fileRow(load().hotspots({ root: r.dir }), 'src/a.js').commits, 1);
});

test('#344 churn follows a file through two renames', (t) => {
  const r = repo(t);
  const body = ifs('moved', 4);
  r.write('src/one.js', body);
  r.commit('create');
  r.write('src/one.js', body + '// 1\n');
  r.commit('edit one');
  git(r.dir, ['mv', 'src/one.js', 'src/two.js']);
  r.commit('rename to two');
  r.write('src/two.js', body + '// 1\n// 2\n');
  r.commit('edit two');
  git(r.dir, ['mv', 'src/two.js', 'src/three.js']);
  r.commit('rename to three');
  r.write('src/three.js', body + '// 1\n// 2\n// 3\n');
  r.commit('edit three');
  const report = load().hotspots({ root: r.dir });
  assert.equal(report.files.some((f) => f.file === 'src/one.js' || f.file === 'src/two.js'), false, 'only the current name is listed');
  const commits = fileRow(report, 'src/three.js').commits;
  assert.ok(commits >= 3 && commits <= 5, `the three edits are counted (renames may count too), not the creation: ${commits}`);
});

test('#344 --check exits 1 and names an over-limit function; --duplicates lists both places of a copy', (t) => {
  const dir = scratch(t);
  const copy = Array.from({ length: 9 }, (_, i) => `  total += values[${i}] * q${i};`).join('\n');
  write(dir, 'src/a.js', ifs('wayTooBranchy', 30) + `function a(values) {\n  let total = 0;\n${copy}\n  return total;\n}\n`);
  write(dir, 'src/b.js', `function b(values) {\n  let sum = 0;\n${copy}\n  return sum;\n}\n`);
  let status = 0;
  let out = '';
  try {
    execFileSync(process.execPath, [SCRIPT, '--check', '--root', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    status = err.status;
    out = String(err.stdout);
  }
  assert.equal(status, 1);
  assert.match(out, /wayTooBranchy/);
  assert.match(out, /\b31\b/);
  const dups = execFileSync(process.execPath, [SCRIPT, '--duplicates', '--root', dir], { encoding: 'utf8' });
  assert.match(dups, /src\/a\.js/);
  assert.match(dups, /src\/b\.js/);
});

// ---------- repository files and docs ----------

test('#344 .git-blame-ignore-revs lists past mass changes as full commit hashes', () => {
  const file = path.join(root, '.git-blame-ignore-revs');
  assert.equal(fs.existsSync(file), true);
  const revs = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.ok(revs.length > 0, 'at least one mass change listed');
  for (const rev of revs) assert.match(rev, /^[0-9a-f]{40}$/);
});

test('#344 the line ratchet of #334 stays alongside, at 1,000 lines', () => {
  assert.equal(require('../scripts/file-size-ratchet.js').MAX_LINES, 1000);
});

test('#344 docs/agents/testing.md gives the limits, how to read the report and how to split a function', () => {
  const doc = fs.readFileSync(path.join(root, 'docs', 'agents', 'testing.md'), 'utf8');
  assert.match(doc, /code-health/);
  assert.match(doc, /\b25\b/);
  assert.match(doc, /--hotspots/);
  assert.match(doc, /Danger Zone/);
  assert.match(doc, /dupli/i);
  assert.match(doc, /split (a|the|one) function|splitting a function/i);
});
