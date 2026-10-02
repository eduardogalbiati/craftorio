// Test files an agent may not change (`edits_tests: false` on an agent, e.g. the developer of
// software-development: only the test writer writes tests).
//
//   tests_paths: ["**/test/**", "*.test.*"]   # workflow level; default: TESTS_PATHS
//
// Patterns are globs over the repository-relative path, with forward slashes: `*` and `?` stay
// within one folder, `**` crosses folders, and a pattern without a slash matches the file name at
// any depth (as in .gitignore). Case-sensitive.
//
// The engine takes a snapshot before the agent's turn (`snapshot`) and, after it, lists the test
// files the turn changed (`changedTestFiles`): files touched by the turn's new commits (merge
// commits and anything already on the base excluded, so updating the branch with the base is not a
// change of the agent's own) and local changes, kept only when their content differs from the
// snapshot (a change the agent reverted, or a file that was already dirty and stayed so, is fine).

const fs = require('fs');
const path = require('path');
const { git } = require('./worktree');

const TESTS_PATHS = [
  // folders
  '**/test/**', '**/tests/**', '**/__tests__/**', '**/spec/**', '**/testdata/**',
  // JavaScript / TypeScript
  '*.test.*', '*.spec.*',
  // Python
  'test_*.py', '*_test.py', 'conftest.py',
  // Go
  '*_test.go',
  // Java / Kotlin (Maven and Gradle layout)
  '**/src/test/**', '*Test.java', '*Tests.java', '*Test.kt', '*Tests.kt',
  // C# / .NET
  '*Tests.cs', '*Test.cs', '**/*.Tests/**', '**/*.Test/**',
  // end-to-end / BDD (#143): feature files and their step definitions (e2e-test-writer-<language>)
  '*.feature', '**/e2e/**', '**/cypress/**', '**/features/steps/**', '**/features/step_definitions/**',
  '**/StepDefinitions/**', '**/*.E2E/**',
];

function globToRegExp(pattern) {
  let p = String(pattern).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const anywhere = !p.includes('/') || p.startsWith('**/');
  if (p.startsWith('**/')) p = p.slice(3);
  if (p.startsWith('/')) p = p.slice(1);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      i++;
      if (p[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${anywhere ? '(?:.*/)?' : ''}${re}$`);
}

// patterns → (file) => true when it is a test file
function testMatcher(patterns = TESTS_PATHS) {
  const res = [patterns].flat().filter((p) => String(p || '').trim()).map(globToRegExp);
  return (file) => {
    const f = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
    return res.some((re) => re.test(f));
  };
}

// loadWorkflow: `tests_paths` is a non-empty list of globs
function validateTestsPaths(v) {
  if (v === undefined) return;
  if (!Array.isArray(v) || !v.length || v.some((p) => typeof p !== 'string' || !p.trim())) {
    throw new Error('tests_paths must be a non-empty list of glob patterns (e.g. "**/test/**", "*.test.*").');
  }
}

const lines = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);
const G = ['-c', 'core.quotepath=off'];

// Files with local changes (modified, deleted or untracked), relative to the repository root.
const localChanges = async (root) => [...new Set([
  ...lines(await git([...G, 'diff', '--name-only', 'HEAD'], root)),
  ...lines(await git([...G, 'ls-files', '--others', '--exclude-standard'], root)),
])];

// file → blob id of its content in the working tree (null when it does not exist)
async function workingBlobs(root, files) {
  const present = files.filter((f) => fs.existsSync(path.join(root, f)));
  const ids = present.length ? lines(await git(['hash-object', '--', ...present], root)) : [];
  const out = Object.fromEntries(files.map((f) => [f, null]));
  present.forEach((f, i) => { out[f] = ids[i]; });
  return out;
}

// file → blob id at `commit` (null when it is not there)
async function commitBlobs(root, commit, files) {
  const out = Object.fromEntries(files.map((f) => [f, null]));
  if (!files.length) return out;
  for (const l of lines(await git([...G, 'ls-tree', '-r', '--full-tree', commit, '--', ...files], root))) {
    const m = /^\S+ blob (\S+)\t(.+)$/.exec(l);
    if (m && m[2] in out) out[m[2]] = m[1];
  }
  return out;
}

// true when `dir` or a parent has a `.git` (folder or worktree file); git's own error text is localized
function insideGit(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

// State of the checkout before a turn, or null when `dir` is not a git work tree: HEAD, and the
// content of the test files that already had local changes (the user's, or an earlier turn's).
// Any other git error rejects: without a snapshot the turn could not be checked.
async function snapshot(dir, patterns = TESTS_PATHS) {
  let root;
  try {
    root = await git(['rev-parse', '--show-toplevel'], dir);
  } catch (e) {
    if (!insideGit(dir)) return null;
    throw e;
  }
  const head = await git(['rev-parse', '--verify', 'HEAD'], root);
  const isTest = testMatcher(patterns);
  return { root, head, patterns, dirty: await workingBlobs(root, (await localChanges(root)).filter(isTest)) };
}

// Test files the turn changed since `snap` (sorted). `bases`: refs whose commits are not the
// agent's (the run's base branch, local and remote); the ones that do not exist are skipped.
async function changedTestFiles(snap, { bases = [] } = {}) {
  if (!snap) return [];
  const { root, head } = snap;
  const isTest = testMatcher(snap.patterns);
  const exclude = [];
  for (const ref of bases) {
    if (await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root).catch(() => null)) exclude.push(`^${ref}`);
  }
  const committed = lines(await git([...G, 'log', '--no-merges', '--name-only', '--format=', 'HEAD', `^${head}`, ...exclude, '--'], root));
  const files = [...new Set([...committed, ...(await localChanges(root)), ...Object.keys(snap.dirty)])].filter(isTest);
  // compared by content with the snapshot: a test file changed and then restored is not a change
  const now = await workingBlobs(root, files);
  const before = { ...(await commitBlobs(root, head, files.filter((f) => !(f in snap.dirty)))), ...snap.dirty };
  return files.filter((f) => now[f] !== before[f]).sort();
}

module.exports = {
  changedTestFiles,
  globToRegExp,
  snapshot,
  testMatcher,
  TESTS_PATHS,
  validateTestsPaths,
};
