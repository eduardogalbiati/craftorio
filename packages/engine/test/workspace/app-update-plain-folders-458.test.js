// #458: Self-healing's source lookup (packages/engine/domains/workspace/app-update.js findSource, behind the app-update:state channel)
// costs no git process for a workspace project whose folder is not a git checkout (a plain folder, as
// every project the contract fixtures create). It ran several synchronous git commands per project,
// blocking the server: after the contract suite's first pass (dozens of plain projects) one
// app-update:state call took up to 84 s and #339's repeatable test timed out.
// Processes are counted at the system boundary (child_process, wrapped before the module loads), by
// the folder they run in; the app folder and a real clone still find the source as before (#279).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const { execFileSync } = childProcess;
const MODULE = require.resolve('../../domains/workspace/app-update');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// git with an isolated config, for the fixture and for the module under test
function gitEnv(t) {
  const cfg = path.join(tmp(t, 'appupd-458-cfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const prev = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = cfg;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(() => {
    if (prev.g === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = prev.g;
    if (prev.s === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = prev.s;
  });
  return (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

// an upstream, the app folder cloned from it, and a project clone one commit ahead
function appAndClone(t) {
  const git = gitEnv(t);
  const root = tmp(t, 'appupd-458-');
  const upstream = path.join(root, 'upstream');
  fs.mkdirSync(upstream);
  git(upstream, 'init', '-q');
  fs.writeFileSync(path.join(upstream, 'a.txt'), 'a\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-q', '-m', 'initial');
  const appDir = path.join(root, 'app');
  const cloneDir = path.join(root, 'clone');
  git(root, 'clone', '-q', upstream, appDir);
  git(root, 'clone', '-q', upstream, cloneDir);
  fs.writeFileSync(path.join(cloneDir, 'fix.txt'), 'fix\n');
  git(cloneDir, 'add', '.');
  git(cloneDir, 'commit', '-q', '-m', 'fix 1');
  return { root, appDir, cloneDir };
}

// packages/engine/domains/workspace/app-update.js loaded fresh with every child_process function wrapped: `cwds` gets the folder of
// each process it starts (the module's own cache is reset after the test)
function loadCounting(t) {
  const cwds = [];
  for (const name of ['execFileSync', 'execFile', 'execSync', 'exec', 'spawnSync', 'spawn']) {
    const original = childProcess[name];
    t.mock.method(childProcess, name, function (...args) {
      const opts = args.find((a, i) => i > 0 && a && typeof a === 'object' && !Array.isArray(a));
      cwds.push(path.resolve(String(opts?.cwd || process.cwd())));
      return original.apply(this, args);
    });
  }
  delete require.cache[MODULE];
  t.after(() => { delete require.cache[MODULE]; });
  return { appUpdate: require(MODULE), cwds };
}

const inside = (dir, parent) => {
  const rel = path.relative(parent, dir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

test('#458 findSource starts no git process in a project folder that is not a git checkout', (t) => {
  const r = appAndClone(t);
  const plainRoot = tmp(t, 'appupd-458-plain-');
  const plain = Array.from({ length: 12 }, (_, i) => {
    const dir = path.join(plainRoot, `contract-project-${i}`);
    fs.mkdirSync(dir);
    return { id: `plain-${i}`, name: `Contract project ${i}`, dir };
  });
  const { appUpdate, cwds } = loadCounting(t);
  const s = appUpdate.findSource({ appDir: r.appDir, isPackaged: false, projects: plain });
  assert.equal(s.ok, false);
  assert.match(s.reason, /no project of this workspace is this app's repository/);
  const inPlain = cwds.filter((d) => inside(d, plainRoot)).length;
  assert.equal(inPlain, 0, `git ran ${inPlain} time(s) in plain project folders`);
});

test('#458 findSource skips the plain folders and still finds the clone listed after them', (t) => {
  const r = appAndClone(t);
  const plainRoot = tmp(t, 'appupd-458-plain-');
  const plain = Array.from({ length: 5 }, (_, i) => {
    const dir = path.join(plainRoot, `p${i}`);
    fs.mkdirSync(dir);
    return { id: `plain-${i}`, name: `Plain ${i}`, dir };
  });
  const { appUpdate, cwds } = loadCounting(t);
  const s = appUpdate.findSource({ appDir: r.appDir, isPackaged: false, projects: [...plain, { id: 'p1', name: 'craftorio', dir: r.cloneDir }] });
  assert.equal(s.ok, true);
  assert.equal(s.project.id, 'p1');
  assert.equal(s.behind, 1);
  assert.equal(cwds.filter((d) => inside(d, plainRoot)).length, 0);
});

// #458's choice: a project folder is the root of its repository (as projects.js isGit says); a folder
// inside a clone, without its own .git, is no longer a source, and costs no git process either
test('#458 findSource: a project folder inside a clone (not its root) is not the source', (t) => {
  const r = appAndClone(t);
  const sub = path.join(r.cloneDir, 'packages', 'app');
  fs.mkdirSync(sub, { recursive: true });
  const { appUpdate, cwds } = loadCounting(t);
  const s = appUpdate.findSource({ appDir: r.appDir, isPackaged: false, projects: [{ id: 'sub', name: 'Sub', dir: sub }] });
  assert.equal(s.ok, false);
  assert.match(s.reason, /no project of this workspace is this app's repository/);
  assert.equal(cwds.filter((d) => inside(d, sub)).length, 0);
});
