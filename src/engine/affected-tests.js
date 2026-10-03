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

  const known = new Set([...files, ...out.changed]);
  const texts = new Map(code.map((f) => [f, stripComments(read(root, f))]));
  // reverse graph: file → the files that import it
  const importers = new Map();
  for (const [f, text] of texts) {
    for (const dep of importsOf(f, text, known)) {
      if (!importers.has(dep)) importers.set(dep, new Set());
      importers.get(dep).add(f);
    }
  }
  const baseCount = new Map();
  for (const f of known) { const b = f.split('/').pop(); baseCount.set(b, (baseCount.get(b) || 0) + 1); }

  // breadth-first from the changed files; each reached file keeps the changed file it came from
  const from = new Map();
  const queue = [];
  for (const f of out.changed) { from.set(f, { seed: f, via: null }); queue.push(f); }
  while (queue.length) {
    const f = queue.shift();
    let next = importers.get(f) || new Set();
    // a changed file nothing imports: the test files that name its path (only tests: a module that
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
  const reached = [...from.keys()].filter(isTest).sort();
  out.slow = reached.filter(isSlow);
  out.files = reached.filter((f) => !isSlow(f));
  for (const f of out.files) {
    const r = from.get(f);
    out.reasons[f] = r.seed === f ? 'changed' : `${r.named ? 'names' : 'imports'} ${r.seed}${r.via ? ` (through ${r.via})` : ''}`;
  }
  out.mode = 'affected';
  out.why = out.files.length
    ? `${out.files.length} test file(s) reach the ${out.changed.length} changed file(s)${out.slow.length ? `; ${out.slow.length} slow file(s) left to the full suite` : ''}`
    : `no test file reaches the ${out.changed.length} changed file(s)`;
  return out;
}

// One line per chosen file, for a step's output or a prompt: "test/a.test.js: imports src/a.js".
function selectionLines(sel) {
  if (!sel) return [];
  if (sel.mode === 'all') return [`the whole suite: ${sel.why}`];
  return [sel.why, ...sel.files.map((f) => `- ${f}: ${sel.reasons[f]}`)];
}

module.exports = {
  affectedTests,
  changedFiles,
  isSlow,
  isTest,
  selectionLines,
};
