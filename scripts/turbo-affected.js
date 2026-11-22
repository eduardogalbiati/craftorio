// The tests of the workspaces a change reaches, through Turborepo (T5 of the Craftorio migration).
// Turborepo's own selection cannot be used here: --affected marks every package whenever one the root
// package.json depends on changes, and a `...<name>` filter climbs from the dependents to the root,
// which every package depends on (the root names the desktop app, the engine and shared, which the
// packager's prune needs). So the selection is made here: the files changed since the base (committed
// and not) map to their workspaces, their dependents are read from the workspaces' package.json
// (dependencies and devDependencies, the root left out), and Turborepo runs `test` in exactly those,
// each from its cache when its inputs did not change. A change outside every workspace (the root's
// scripts, workflows, content, package.json, turbo.json) runs every workspace's tests and the root's own
// (test:root).
//
//   node scripts/turbo-affected.js [--base <ref>] [--dry]   (base: TURBO_SCM_BASE, else the merge
//                                                            base with origin/main, else main)
//   changedWorkspaces(files, workspaces)  → { all: bool, names: [package names] }
//   withDependents(names, workspaces)     → [those names and every workspace depending on them]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { runShim } = require('@craftorio/engine/domains/machine/shell');
const { workspaces } = require('./source-tree');

const ROOT = path.join(__dirname, '..');
const TURBO = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'turbo.cmd' : 'turbo');

function changedWorkspaces(files, list) {
  const names = new Set();
  for (const f of files) {
    const w = list.find((x) => f === x.dir || f.startsWith(`${x.dir}/`));
    if (!w) return { all: true, names: [] };
    names.add(w.name);
  }
  return { all: false, names: [...names].sort() };
}

// list: [{ name, deps: [internal package names] }]
function withDependents(names, list) {
  const out = new Set(names);
  let grew = true;
  while (grew) {
    grew = false;
    for (const w of list) {
      if (!out.has(w.name) && w.deps.some((d) => out.has(d))) { out.add(w.name); grew = true; }
    }
  }
  return [...out].sort();
}

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
function baseRef(argv) {
  const at = argv.indexOf('--base');
  if (at >= 0 && argv[at + 1]) return argv[at + 1];
  if (process.env.TURBO_SCM_BASE) return process.env.TURBO_SCM_BASE;
  for (const ref of ['origin/main', 'main']) {
    try { return git(['merge-base', ref, 'HEAD']); } catch { /* the next one */ }
  }
  return 'HEAD';
}
function changedFiles(base) {
  const lines = [git(['diff', '--name-only', `${base}`]), git(['ls-files', '--others', '--exclude-standard'])].join('\n');
  return [...new Set(lines.split('\n').map((l) => l.trim()).filter(Boolean))];
}
function workspaceList() {
  const all = workspaces(ROOT).map((w) => ({ ...w, pkg: JSON.parse(fs.readFileSync(path.join(ROOT, w.dir, 'package.json'), 'utf8')) }));
  const names = new Set(all.map((w) => w.pkg.name));
  return all.map((w) => ({ dir: w.dir, name: w.pkg.name, deps: Object.keys({ ...w.pkg.dependencies, ...w.pkg.devDependencies }).filter((d) => names.has(d)) }));
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const base = baseRef(argv);
  const files = changedFiles(base);
  const list = workspaceList();
  const { all, names } = changedWorkspaces(files, list);
  const run = all ? [] : withDependents(names, list);
  console.log(`affected since ${base.slice(0, 12)}: ${files.length} file(s); ${all ? 'a change outside the workspaces: every workspace and the root' : run.length ? `${names.join(', ')}${run.length > names.length ? ` (with their dependents: ${run.filter((n) => !names.includes(n)).join(', ')})` : ''}` : 'nothing'}`);
  if (!all && !run.length) process.exit(0);
  const dry = argv.includes('--dry');
  const args = ['run', ...(all ? ['test', 'test:root'] : ['test']), '--concurrency=2', '--ui=stream', ...run.flatMap((n) => ['--filter', n]), ...(dry ? ['--dry=json'] : [])];
  const child = runShim(TURBO, args, { cwd: ROOT, stdio: dry ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  let out = '';
  if (dry) child.stdout.on('data', (d) => { out += d; });
  child.on('error', (e) => { console.error(`turbo: ${e.message}`); process.exit(1); });
  child.on('exit', (code) => {
    if (dry && code === 0) console.log(`would run: ${JSON.parse(out).tasks.map((x) => x.taskId).join(', ')}`);
    process.exit(code ?? 1);
  });
}

module.exports = { changedWorkspaces, withDependents };
