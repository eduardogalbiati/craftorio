// Affected tests (#212): the test files a change can break, without a model. The project's import
// graph is built from `require(...)`, `import ... from`, `import(...)` and `export ... from` of its
// JS/TS files (relative specifiers only: packages are not the project's). A test file is affected
// when it is changed itself or imports, directly or transitively, a file changed since the base (the
// merge-base of the base ref and HEAD, plus uncommitted and untracked files). A changed file no
// code imports (a workflow YAML, a renderer script the tests read with fs) reaches the test files
// whose code (not comments) names its path (`'views', 'run', 'run.js'`, `views/run/run.js`, or a
// basename unique in the project).
// A change to a shared root (package.json, a lockfile, the suite's runner scripts/test.js) selects
// the whole suite (`mode: 'all'`), and so does a project without a JS/TS graph (other languages).
// Slow tests (a test/slow/ folder or a `*.slow.test.js` name: whole simulated runs) never join the
// affected set; they run with the full suite only (`slow` lists those the change reaches).
// → { mode: affected | all, files, reasons: { <test file>: 'imports src/x.js' }, changed, slow, why }
// Used by the suite step's `scope: affected` and by agents' test requests (src/engine/suite-step.js,
// src/engine/workflow.js); scripts/affected-tests.js prints it.
// The same graph gives the static code → tests map (#219, `testMap` / `testMapMarkdown`: every source
// file and the tests that reach it; docs/agents/test-map.md and a step's `test_map: true`) and the
// existing tests related to new tests (#220, `relatedTests`: what the acceptance tests' sources reach),
// and whether a suite's failures are in or outside the change (#396, `classifyFailures`).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CODE = /\.(c|m)?[jt]sx?$/;
const TEST = /\.(test|spec)\.(c|m)?[jt]sx?$/;
const SLOW = /(^|\/)slow\/|\.slow\.(test|spec)\./;
const SHARED = [
  /(^|\/)package\.json$/,
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/,
  /^scripts\/test\.js$/,
  /^\.nvmrc$/,
];
const IMPORT = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;
const EXTENSIONS = ['', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.json', '/index.js', '/index.ts'];
const MAX_BYTES = 2e6;

const slash = (p) => String(p).split(path.sep).join('/').replace(/\\/g, '/');
const isTest = (f) => TEST.test(f) && !/(^|\/)(node_modules|fixtures)\//.test(f);
const isSlow = (f) => SLOW.test(f);

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, maxBuffer: 64e6 });
}
const lines = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(slash);

// The project's files (tracked and untracked, without the ignored ones).
function projectFiles(root) {
  return lines(git(root, ['ls-files', '--cached', '--others', '--exclude-standard']));
}

// The files changed since `base` (a ref or commit): committed since the merge-base, uncommitted, untracked.
function changedFiles(root, base) {
  let from = base;
  try { from = git(root, ['merge-base', base, 'HEAD']).trim() || base; } catch { /* base unrelated: diff against it */ }
  const changed = new Set(lines(git(root, ['diff', '--name-only', from])));
  for (const f of lines(git(root, ['ls-files', '--others', '--exclude-standard']))) changed.add(f);
  return [...changed].sort();
}

const read = (root, f) => {
  try {
    const p = path.join(root, f);
    return fs.statSync(p).size > MAX_BYTES ? '' : fs.readFileSync(p, 'utf8');
  } catch { return ''; }
};

// Comments name files without using them (a header that points to README.md): only code counts.
// A `//` after a quote or a colon (a URL in a string) is kept.
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

// file → the files it imports (resolved, project-relative)
function importsOf(file, text, known) {
  const out = new Set();
  for (const m of text.matchAll(IMPORT)) {
    const spec = m[1] || m[2] || m[3] || m[4];
    if (!spec || !spec.startsWith('.')) continue;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    const hit = EXTENSIONS.map((e) => base + e).find((c) => known.has(c));
    if (hit) out.add(hit);
  }
  return out;
}

// Does `text` name the project file `file`? Its path with / or as path.join arguments, or its
// basename when no other project file has it.
function names(text, file, uniqueBase) {
  const parts = file.split('/');
  const base = parts[parts.length - 1];
  if (!text.includes(base)) return false;
  const joined = text.replace(/['"`]\s*,\s*['"`]/g, '/');
  const tail = parts.slice(-2).join('/');
  if (parts.length > 1 && joined.includes(tail)) return true;
  return uniqueBase && new RegExp(`['"\`/]${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(text);
}

// The project's import graph: { files, code (its JS/TS files), texts (code without comments),
// importers (file → the files that import it), baseCount (basename → how many files have it) }.
// extra: files to know besides the project's (changed files git does not list yet).
function importGraph(root, files, extra = []) {
  const code = files.filter((f) => CODE.test(f) && !/(^|\/)node_modules\//.test(f));
  const known = new Set([...files, ...extra]);
  const texts = new Map(code.map((f) => [f, stripComments(read(root, f))]));
  const importers = new Map();
  for (const [f, text] of texts) {
    for (const dep of importsOf(f, text, known)) {
      if (!importers.has(dep)) importers.set(dep, new Set());
      importers.get(dep).add(f);
    }
  }
  const baseCount = new Map();
  for (const f of known) { const b = f.split('/').pop(); baseCount.set(b, (baseCount.get(b) || 0) + 1); }
  return { files, code, known, texts, importers, baseCount };
}

// Breadth-first from `seeds` through the files that import them → Map(file → { seed, via, named });
// each reached file keeps the seed it came from.
function reach(graph, seeds) {
  const { texts, importers, baseCount } = graph;
  const from = new Map();
  const queue = [];
  for (const f of seeds) { from.set(f, { seed: f, via: null }); queue.push(f); }
  while (queue.length) {
    const f = queue.shift();
    let next = importers.get(f) || new Set();
    // a seed nothing imports: the test files that name its path (only tests: a module that
    // names README.md may read another project's)
    if (!next.size && f === from.get(f).seed) {
      const unique = baseCount.get(f.split('/').pop()) === 1;
      next = new Set([...texts.keys()].filter((g) => g !== f && isTest(g) && names(texts.get(g), f, unique)));
    }
    for (const g of next) {
      if (from.has(g)) continue;
      const { seed, via, named } = from.get(f);
      from.set(g, { seed, via: via || (f === seed ? null : f), named: named || !importers.get(f)?.has(g) });
      queue.push(g);
    }
  }
  return from;
}

const reasonOf = (r, f) => (r.seed === f ? 'changed' : `${r.named ? 'names' : 'imports'} ${r.seed}${r.via ? ` (through ${r.via})` : ''}`);

// root: the project folder (a git checkout); base: the ref to compare with; changed: the changed
// files when already known (else from git).
function affectedTests({ root, base, changed } = {}) {
  const out = { mode: 'all', files: [], reasons: {}, changed: [], slow: [], why: '' };
  let files;
  try {
    files = projectFiles(root);
    out.changed = (changed || changedFiles(root, base)).map(slash).sort();
  } catch (e) {
    out.why = `the changed files could not be listed (${e.message.split('\n')[0]}): the whole suite`;
    return out;
  }
  const code = files.filter((f) => CODE.test(f) && !/(^|\/)node_modules\//.test(f));
  if (!code.some(isTest)) { out.why = 'no JS/TS test files: no import graph for this project, the whole suite'; return out; }
  const shared = out.changed.filter((f) => SHARED.some((re) => re.test(f)));
  if (shared.length) { out.why = `a shared root changed (${shared.join(', ')}): the whole suite`; return out; }

  const from = reach(importGraph(root, files, out.changed), out.changed);
  const reached = [...from.keys()].filter(isTest).sort();
  out.slow = reached.filter(isSlow);
  out.files = reached.filter((f) => !isSlow(f));
  for (const f of out.files) out.reasons[f] = reasonOf(from.get(f), f);
  out.mode = 'affected';
  out.why = out.files.length
    ? `${out.files.length} test file(s) reach the ${out.changed.length} changed file(s)${out.slow.length ? `; ${out.slow.length} slow file(s) left to the full suite` : ''}`
    : `no test file reaches the ${out.changed.length} changed file(s)`;
  return out;
}

// In or outside the change (#396): a failure is "in the change" when its test file is changed itself
// or reaches a changed file through the graph (slow tests too), "outside the change" otherwise;
// `class_reason` says why ("imports src/a.js", "reaches none of the 3 changed file(s)"). When it
// cannot be told (no file named, a file the project does not have, the changed files unknown, a
// shared root changed, no JS/TS graph; an absolute file path is made relative to `root` first)
// the failure counts as in the change: only failures known to be elsewhere are outside. A failure
// that already has a class keeps it. → copies of `failures` with { class, class_reason }; never throws.
const IN_CHANGE = 'in the change';
const OUTSIDE_CHANGE = 'outside the change';
function classifyFailures({ root, changed, failures = [] } = {}) {
  const inChange = (f, reason) => ({ ...f, class: IN_CHANGE, class_reason: reason });
  const all = (reason) => failures.map((f) => (f.class ? f : inChange(f, reason)));
  if (!failures.some((f) => !f.class)) return failures;
  if (!Array.isArray(changed)) return all('cannot tell: the run\'s changed files are unknown');
  const list = changed.map(slash);
  const shared = list.filter((f) => SHARED.some((re) => re.test(f)));
  if (shared.length) return all(`a shared root changed (${shared.join(', ')})`);
  let graph;
  try { graph = importGraph(root, projectFiles(root), list); } catch (e) { return all(`cannot tell: the project's files could not be listed (${e.message.split('\n')[0]})`); }
  if (!graph.code.some(isTest)) return all('cannot tell: no JS/TS import graph for this project');
  const from = reach(graph, list);
  return failures.map((f) => {
    if (f.class) return f;
    if (!f.file) return inChange(f, 'cannot tell: the failure names no test file');
    const file = slash(path.isAbsolute(f.file) ? path.relative(root, f.file) : f.file);
    const r = from.get(file);
    if (r) return inChange(f, r.seed === file ? 'the test file is changed' : reasonOf(r, file));
    if (!graph.known.has(file)) return inChange(f, `cannot tell: ${slash(f.file)} is not a file of the project`);
    return { ...f, class: OUTSIDE_CHANGE, class_reason: `reaches none of the ${list.length} changed file(s)` };
  });
}

// One line per chosen file, for a step's output or a prompt: "test/a.test.js: imports src/a.js".
function selectionLines(sel) {
  if (!sel) return [];
  if (sel.mode === 'all') return [`the whole suite: ${sel.why}`];
  return [sel.why, ...sel.files.map((f) => `- ${f}: ${sel.reasons[f]}`)];
}

// The static code → tests map (#219, TDAD-style): for every source file of the project (JS/TS, not a
// test, not under a test or fixtures folder), the test files that import it directly or
// transitively (or name its path when nothing imports it), from the same graph as affectedTests.
// → { mode: graph | none, why, sources: { <file>: { direct: [tests importing or naming it],
//     transitive: [tests reaching it through other files] } } }
const SUPPORT = /(^|\/)(test|tests|__tests__|fixtures)\//;
function testMap({ root } = {}) {
  const out = { mode: 'none', why: '', sources: {} };
  let files;
  try { files = projectFiles(root); } catch (e) { out.why = `the project's files could not be listed (${e.message.split('\n')[0]})`; return out; }
  const graph = importGraph(root, files);
  if (!graph.code.some(isTest)) { out.why = 'no JS/TS test files: no import graph for this project'; return out; }
  for (const f of graph.code.filter((x) => !isTest(x) && !SUPPORT.test(x)).sort()) {
    const from = reach(graph, [f]);
    const tests = [...from.keys()].filter(isTest).sort();
    out.sources[f] = { direct: tests.filter((t) => !from.get(t).via), transitive: tests.filter((t) => from.get(t).via) };
  }
  out.mode = 'graph';
  out.why = `${Object.keys(out.sources).length} source file(s), ${graph.code.filter(isTest).length} test file(s)`;
  return out;
}

const MAP_DIRECT = 25;
const MAP_TRANSITIVE = 8;
// The map as Markdown (docs/agents/test-map.md, a run's test-map.md): one line per source file, the
// direct tests first (the ones to run), then those reaching it through other files.
function testMapMarkdown(map, { generatedBy = 'the orchestrator' } = {}) {
  const lines = [
    '# Code → tests map',
    '',
    `Generated by ${generatedBy} from the import graph (src/engine/affected-tests.js): do not edit.`,
    'For each source file: the test files that import it (or name its path), then those reaching it through',
    'other files. Changing a file? Run its direct tests (a ```run-tests block with the files, or `affected`',
    'for every test your change reaches), not the whole suite; (slow) tests simulate whole runs and are left',
    'to the suite step.',
    '',
  ];
  if (map.mode !== 'graph') return `${[...lines, `No map: ${map.why}.`].join('\n')}\n`;
  const list = (tests, max) => {
    const shown = tests.slice(0, max).map((t) => `\`${t}\`${isSlow(t) ? ' (slow)' : ''}`);
    if (tests.length > max) shown.push(`… ${tests.length - max} more`);
    return shown.join(', ');
  };
  for (const [src, { direct, transitive }] of Object.entries(map.sources)) {
    if (!direct.length && !transitive.length) { lines.push(`- \`${src}\`: no test reaches it`); continue; }
    const parts = [direct.length ? list(direct, MAP_DIRECT) : 'no direct test'];
    if (transitive.length) parts.push(`through other files (${transitive.length}): ${list(transitive, MAP_TRANSITIVE)}`);
    lines.push(`- \`${src}\`: ${parts.join('; ')}`);
  }
  return `${lines.join('\n')}\n`;
}

// The existing tests related to given test files (#220, tests first): the source files these tests
// import directly, then every other test file that reaches those sources. What the developer of a
// tests-first run must keep green besides the new tests.
// → { mode: affected | all, files, reasons, sources, why }
function relatedTests({ root, tests = [] } = {}) {
  const out = { mode: 'all', files: [], reasons: {}, sources: [], why: '' };
  const given = tests.map(slash);
  let files;
  try { files = projectFiles(root); } catch (e) { out.why = `the project's files could not be listed (${e.message.split('\n')[0]})`; return out; }
  const graph = importGraph(root, files, given);
  if (!graph.code.some(isTest)) { out.why = 'no JS/TS test files: no import graph for this project'; return out; }
  const sources = new Set();
  for (const t of given) {
    for (const dep of importsOf(t, stripComments(read(root, t)), graph.known)) if (!isTest(dep) && !SUPPORT.test(dep)) sources.add(dep);
  }
  out.sources = [...sources].sort();
  const from = reach(graph, out.sources);
  out.files = [...from.keys()].filter((f) => isTest(f) && !isSlow(f) && !given.includes(f)).sort();
  for (const f of out.files) out.reasons[f] = reasonOf(from.get(f), f);
  out.mode = 'affected';
  out.why = out.sources.length
    ? `${out.files.length} existing test file(s) reach the ${out.sources.length} source file(s) the new tests import`
    : 'the new tests import no source file of the project';
  return out;
}

module.exports = {
  affectedTests,
  changedFiles,
  classifyFailures,
  IN_CHANGE,
  isSlow,
  isTest,
  OUTSIDE_CHANGE,
  relatedTests,
  selectionLines,
  testMap,
  testMapMarkdown,
};
