// The source tree of the repository, as the layout-bound tooling sees it (phase 2 of
// docs/reorganisation-study-2026-10.md): the npm workspaces (`packages/*`, `apps/*`, from the root
// package.json), the folders their sources live in, and the files of each. Everything that scans
// "every source file" (the code map, the ratchets, the layering check, the list linter, the
// literal checks in the tests) asks this module instead of naming `src/` itself, so a new workspace
// is learnt here once. Tests (`<workspace>/test/`) and node_modules are never sources.
//
//   workspaces(root)        [{ dir: 'packages/shared', name: '@multiagent/shared' }, …], from the
//                           root package.json's `workspaces` globs (one level: `packages/*`)
//   sourceDirs(root)        the folders holding app sources: `src` while it exists, then every
//                           workspace folder (paths from root, with /)
//   sourceFiles(root, opts) every .js file of sourceDirs (and `scripts/` with { scripts: true }),
//                           paths from root with /, sorted; { match } picks another extension
//   packageOf(root, file)   the workspace a path belongs to, or null (the root)
//   resolvePackagePath(root, spec)  '@multiagent/shared/i18n' → 'packages/shared/i18n' (no extension
//                           resolution), or null when `spec` names no workspace

const fs = require('fs');
const path = require('path');

const posix = (p) => p.split(path.sep).join('/');
const cache = new Map();

function workspaces(root) {
  if (cache.has(root)) return cache.get(root);
  let globs = [];
  try { globs = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).workspaces || []; } catch { /* no root package.json: no workspaces */ }
  const out = [];
  for (const glob of globs) {
    const m = /^([^*]+)\/\*$/.exec(glob);
    const dirs = m
      ? (fs.existsSync(path.join(root, m[1])) ? fs.readdirSync(path.join(root, m[1]), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `${m[1]}/${e.name}`) : [])
      : [glob.replace(/\/$/, '')];
    for (const dir of dirs) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
        if (pkg.name) out.push({ dir: posix(dir), name: pkg.name });
      } catch { /* a folder without a package.json is not a workspace */ }
    }
  }
  out.sort((a, b) => a.dir.localeCompare(b.dir));
  cache.set(root, out);
  return out;
}

// the workspace folders a checkout may hold even without manifests (a test's temporary tree)
const WORKSPACE_PARENTS = ['apps', 'packages'];

function sourceDirs(root) {
  const dirs = new Set(fs.existsSync(path.join(root, 'src')) ? ['src'] : []);
  for (const w of workspaces(root)) dirs.add(w.dir);
  for (const parent of WORKSPACE_PARENTS) {
    if (!fs.existsSync(path.join(root, parent))) continue;
    for (const e of fs.readdirSync(path.join(root, parent), { withFileTypes: true })) if (e.isDirectory()) dirs.add(`${parent}/${e.name}`);
  }
  return [...dirs];
}

// the folders of a workspace that hold no sources
const NOT_SOURCE = new Set(['node_modules', 'test']);

function listFiles(root, dir, match) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return NOT_SOURCE.has(e.name) ? [] : listFiles(root, rel, match);
    return e.isFile() && match.test(e.name) ? [rel] : [];
  });
}

function sourceFiles(root, { scripts = false, match = /\.js$/ } = {}) {
  const dirs = [...sourceDirs(root), ...(scripts ? ['scripts'] : [])];
  return dirs.flatMap((d) => listFiles(root, d, match)).sort();
}

function packageOf(root, file) {
  const f = posix(file);
  return workspaces(root).find((w) => f === w.dir || f.startsWith(`${w.dir}/`)) || null;
}

function resolvePackagePath(root, spec) {
  const w = workspaces(root).find((x) => spec === x.name || spec.startsWith(`${x.name}/`));
  if (!w) return null;
  return spec === w.name ? w.dir : `${w.dir}${spec.slice(w.name.length)}`;
}

module.exports = {
  listFiles,
  packageOf,
  resolvePackagePath,
  sourceDirs,
  sourceFiles,
  workspaces,
};
