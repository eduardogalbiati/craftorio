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
// A merge-conflict resolution is not a change either (#380): a file that only combines the branch's
// and the base's versions (`combinesBothSides`), or a conflict still left to resolve (unmerged).

const fs = require('fs');
const path = require('path');
const worktree = require('./worktree');

// Read-only queries: one retry, so a transient failure (a git process that dies without a word
// while the machine is busy, seen under the full test suite on Windows) does not fail the turn.
const git = (args, cwd, opts) => worktree.git(args, cwd, opts).catch(() => worktree.git(args, cwd, opts));

// the default patterns and the glob rule are shared with the Architecture tab (#356)
const { globToRegExp, TESTS_PATHS } = require('@craftorio/shared/globs');

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

// Files with local changes (modified, deleted or untracked), relative to the repository root;
// `relative`: only those under `root`, relative to it (a project folder inside a run's worktree).
const localChanges = async (root, { relative = false, timeout } = {}) => [...new Set([
  ...lines(await git([...G, 'diff', '--name-only', ...(relative ? ['--relative'] : []), 'HEAD'], root, { timeout })),
  ...lines(await git([...G, 'ls-files', '--others', '--exclude-standard'], root, { timeout })),
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

// #525: the guard's local changes in one process (`localChanges` and the unmerged list took three):
// the files modified, deleted, untracked or unmerged, and the unmerged ones, relative to the
// repository root (porcelain paths always are; with -z never quoted). No renames: a renamed file is
// its new path plus its old one deleted, as `diff --name-only` lists them.
// #737: `head` is HEAD's commit from the same process (`# branch.oid`), null on a branch with no
// commit yet ("(initial)").
async function status(root) {
  const entries = (await git(['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--no-renames'], root)).split('\0');
  const changed = new Set();
  const unmerged = new Set();
  let head = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const oid = /^# branch\.oid ([0-9a-f]{40,64})$/.exec(e);
    if (oid) head = oid[1];
    // the path follows a fixed number of fields: 8 for `1` (changed), 9 for `2` (renamed, the old path
    // in the next entry), 10 for `u` (unmerged)
    if (e[0] === '1') changed.add(e.split(' ').slice(8).join(' '));
    else if (e[0] === '2') { changed.add(e.split(' ').slice(9).join(' ')); changed.add(entries[++i]); }
    else if (e[0] === 'u') { const f = e.split(' ').slice(10).join(' '); changed.add(f); unmerged.add(f); }
    else if (e[0] === '?') changed.add(e.slice(2));
  }
  return { changed: [...changed], unmerged, head };
}

// State of the checkout before a turn, or null when `dir` is not a git work tree: HEAD, and the
// content of the test files that already had local changes (the user's, or an earlier turn's).
// Any other git error rejects: without a snapshot the turn could not be checked.
// `repo`: `{ root, gitDir }` of an earlier snapshot of `dir` in the same run (#525: they do not change).
async function snapshot(dir, patterns = TESTS_PATHS, { repo } = {}) {
  let { root, gitDir } = repo || {};
  if (!root || !gitDir) {
    try {
      [root, gitDir] = (await git(['rev-parse', '--show-toplevel', '--absolute-git-dir'], dir)).split('\n').map((l) => l.replace(/\r$/, ''));
    } catch (e) {
      if (!insideGit(dir)) return null;
      throw e;
    }
  }
  // #737: HEAD comes with the status; rev-parse only without a commit yet, for its error
  const local = await status(root);
  const head = local.head || await git(['rev-parse', '--verify', 'HEAD'], root);
  const isTest = testMatcher(patterns);
  // inside a rebase HEAD sits on the base: keep the branch's side, the turn may finish the rebase
  const rebaseHead = await rebaseOrigHead(root, gitDir);
  return { root, gitDir, head, rebaseHead, patterns, dirty: await workingBlobs(root, local.changed.filter(isTest)) };
}

// #525: the refs of `refs` that name a commit, in their order: the full ref names in one process,
// any other revision in one each
async function existingRefs(root, refs) {
  const full = refs.filter((r) => r.startsWith('refs/'));
  const found = new Set();
  if (full.length) {
    for (const l of lines(await git(['for-each-ref', '--format=%(refname) %(objecttype) %(*objecttype)', ...full], root))) {
      // a pattern also matches the refs under it (refs/heads/main/x): only the exact name counts
      const [name, type, peeled] = l.split(' ');
      if (full.includes(name) && (type === 'commit' || peeled === 'commit')) found.add(name);
    }
  }
  for (const ref of refs.filter((r) => !r.startsWith('refs/'))) {
    if (await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root).catch(() => null)) found.add(ref);
  }
  return refs.filter((r) => found.has(r));
}

// Test files the turn changed since `snap` (sorted). `bases`: refs whose commits are not the
// agent's (the run's base branch, local and remote); the ones that do not exist are skipped.
// `existing`: those of them that exist, when already known (#525: found once per run).
/** @param {any} snap @param {{ bases?: string[], existing?: string[] }} [opts] */
async function changedTestFiles(snap, { bases = [], existing } = {}) {
  if (!snap) return [];
  const { root, head } = snap;
  const isTest = testMatcher(snap.patterns);
  const exclude = existing || await existingRefs(root, bases);
  const [log, local] = await Promise.all([
    git([...G, 'log', '--no-merges', '--name-only', '--format=', 'HEAD', `^${head}`, ...exclude.map((r) => `^${r}`), '--'], root),
    status(root),
  ]);
  const files = [...new Set([...lines(log), ...local.changed, ...Object.keys(snap.dirty)])].filter(isTest);
  // compared by content with the snapshot: a test file changed and then restored is not a change
  const now = await workingBlobs(root, files);
  const before = { ...(await commitBlobs(root, head, files.filter((f) => !(f in snap.dirty)))), ...snap.dirty };
  const changed = files.filter((f) => now[f] !== before[f]);
  const { unmerged } = local;
  const out = [];
  // inside a rebase HEAD sits on the base: the branch's side is the rebase's original head, the one
  // in progress now or, when the turn finished it (`rebase --continue`), the one at the snapshot
  const branchHead = (await rebaseOrigHead(root, snap.gitDir)) || snap.rebaseHead || head;
  for (const f of changed) {
    // #380: a conflict the turn's rebase left for someone else (git wrote the markers, not the agent)
    if (unmerged.has(f)) continue;
    if (now[f] && await combinesBothSides(root, branchHead, exclude, f)) continue;
    out.push(f);
  }
  return out.sort();
}

// The commit a rebase in progress started from, or null when no rebase is in progress. Read from the
// work tree's own git dir (#525: no `rev-parse --git-path` per marker); never cached, a turn changes it.
async function rebaseOrigHead(root, gitDir) {
  for (const dir of ['rebase-merge', 'rebase-apply']) {
    const sha = (await fs.promises.readFile(path.join(gitDir, dir, 'orig-head'), 'utf8').catch(() => '')).trim();
    if (sha && await git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], root).catch(() => null)) return sha;
  }
  return null;
}

// empty lines are ignored: a trailing newline added or dropped by one side is not a test line
const splitLines = (text) => String(text).split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
const blobLines = async (root, blob) => (blob ? splitLines(await git(['cat-file', '-p', blob], root)) : []);

// #380: true when the file in the working tree only combines the branch's version (at `head`) with a
// base's version, as a merge or rebase resolution does: the file changed on both sides since their
// merge base, every line of the result comes from one side, every line either side added is kept and
// every line both sides kept is kept (so neither a new test line nor a dropped one passes). Checked
// against each base ref in turn. Duplicated and moved lines are not seen (a set comparison).
async function combinesBothSides(root, head, bases, file) {
  const result = new Set(splitLines(await fs.promises.readFile(path.join(root, file), 'utf8')));
  for (const base of bases) {
    const fork = await git(['merge-base', head, base], root).catch(() => null);
    if (!fork) continue;
    const [mine, theirs, old] = await Promise.all([head, base, fork].map((c) => commitBlobs(root, c, [file]).then((b) => b[file])));
    if (mine === old || theirs === old) continue; // not changed on both sides: nothing to combine
    const [m, t, o] = await Promise.all([mine, theirs, old].map((b) => blobLines(root, b)));
    const sides = new Set([...m, ...t]);
    const kept = new Set(o);
    const [myLines, theirLines] = [new Set(m), new Set(t)];
    const required = [...sides].filter((l) => !kept.has(l) || (myLines.has(l) && theirLines.has(l)));
    if ([...result].every((l) => sides.has(l)) && required.every((l) => result.has(l))) return true;
  }
  return false;
}

module.exports = {
  changedTestFiles,
  existingRefs,
  globToRegExp,
  localChanges,
  snapshot,
  testMatcher,
  TESTS_PATHS,
  validateTestsPaths,
};
