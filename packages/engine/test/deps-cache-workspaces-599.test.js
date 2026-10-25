// #599: the shared dependency cache (packages/engine/engine/deps-cache.js) serves npm workspaces
// monorepos. The installed tree is shared through the cache; each worktree's workspace packages
// (`require('@scope/a')`) resolve to that worktree's own files, never another checkout's.
//
// Seams: ensureDeps / detect / unlinkDeps / linkedBy / entryUsable, and Node's own module
// resolution (require.resolve from the worktree's folders) for what a worktree loads.
//
// Assumptions:
// - `run` is injected (a fake npm, as in deps-cache.test.js): it installs like npm does on this
//   platform, a hidden lockfile, one hoisted package and one link per workspace package
//   (a junction to the absolute folder on Windows, a relative symlink elsewhere).
// - The tests assert where things resolve, not the layout of the worktree's node_modules (a
//   junction to the entry or a folder of links): the issue leaves that shape to the developer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const depsCache = require('../engine/deps-cache');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

const WORKSPACES = ['packages/*', 'apps/*'];
const PACKAGES = { 'packages/a': '@scope/a', 'packages/b': '@scope/b', 'apps/web': '@scope/web' };

// The lockfile npm writes for a workspaces project: one `link: true` entry per workspace package.
function lockText(packages = PACKAGES) {
  const lock = { name: 'mono', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'mono', version: '1.0.0', workspaces: WORKSPACES } } };
  for (const [dir, name] of Object.entries(packages)) {
    lock.packages[`node_modules/${name}`] = { resolved: dir, link: true };
    lock.packages[dir] = { name, version: '1.0.0' };
  }
  lock.packages['node_modules/hoisted'] = { version: '1.0.0' };
  return JSON.stringify(lock, null, 2);
}

// A worktree of an npm workspaces monorepo: root package.json with `workspaces`, its lockfile and
// each workspace package (index.js exports its own path).
function wsProject(dir, { packages = PACKAGES, lock = lockText(), scripts } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'mono', version: '1.0.0', private: true, workspaces: WORKSPACES, ...(scripts ? { scripts } : {}) }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), lock);
  for (const [rel, name] of Object.entries(packages)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
    fs.writeFileSync(path.join(p, 'index.js'), 'module.exports = __filename;\n');
  }
  return dir;
}

// The workspace packages of a worktree, as npm finds them from the root's `workspaces` globs.
function workspacePackages(dir) {
  const found = [];
  for (const glob of WORKSPACES) {
    const parent = path.join(dir, glob.replace(/\/\*$/, ''));
    if (!fs.existsSync(parent)) continue;
    for (const name of fs.readdirSync(parent)) {
      const pj = path.join(parent, name, 'package.json');
      if (fs.existsSync(pj)) found.push({ dir: path.join(parent, name), name: JSON.parse(fs.readFileSync(pj, 'utf8')).name });
    }
  }
  return found;
}

// A fake npm: answers --version, records the lifecycle scripts it is asked to run (`run … <name>`)
// and otherwise installs like `npm ci` in a workspaces project.
function fakeNpm() {
  const installs = [];
  const scripts = [];
  const run = async (cmd, args, opts = {}) => {
    if (args[0] === '--version') return { code: 0, output: '10.0.0', timedOut: false };
    if (args[0] === 'run') {
      scripts.push({ cwd: opts.cwd, name: args[args.length - 1] });
      return { code: 0, output: '', timedOut: false };
    }
    installs.push(opts.cwd);
    const nm = path.join(opts.cwd, 'node_modules');
    fs.mkdirSync(path.join(nm, 'hoisted'), { recursive: true });
    fs.writeFileSync(path.join(nm, 'hoisted', 'package.json'), JSON.stringify({ name: 'hoisted', version: '1.0.0', main: 'index.js' }));
    fs.writeFileSync(path.join(nm, 'hoisted', 'index.js'), 'module.exports = __filename;\n');
    fs.writeFileSync(path.join(nm, '.package-lock.json'), fs.readFileSync(path.join(opts.cwd, 'package-lock.json')));
    for (const ws of workspacePackages(opts.cwd)) {
      const link = path.join(nm, ...ws.name.split('/'));
      fs.mkdirSync(path.dirname(link), { recursive: true });
      if (process.platform === 'win32') fs.symlinkSync(ws.dir, link, 'junction');
      else fs.symlinkSync(path.relative(path.dirname(link), ws.dir), link, 'dir');
    }
    return { code: 0, output: '', timedOut: false };
  };
  return { run, installs, scriptsIn: (dir) => scripts.filter((s) => s.cwd === dir).map((s) => s.name) };
}

const real = (p) => fs.realpathSync.native(p).toLowerCase();
// where `request` resolves from folder `from` (the real file), or null when it does not resolve
function resolved(request, from) {
  try { return real(require.resolve(request, { paths: [from] })); } catch { return null; }
}
function assertInside(file, dir, what) {
  assert.ok(file, `${what} resolves`);
  assert.ok(file.startsWith(real(dir) + path.sep), `${what} resolves inside ${dir}, got ${file}`);
}
// every workspace package, from the root and from inside each workspace folder, resolves into `wt`
function assertOwnPackages(wt) {
  for (const from of [wt, path.join(wt, 'packages', 'b'), path.join(wt, 'apps', 'web')]) {
    for (const name of Object.values(PACKAGES)) assertInside(resolved(name, from), wt, `${name} from ${path.relative(wt, from) || 'the root'}`);
  }
}
const ensure = (workDir, cacheDir, run, extra = {}) => depsCache.ensureDeps({ workDir, cacheDir, project: 'mono', env: {}, run, ...extra });

test('#599 detect: an npm workspaces monorepo is cached (no notCached reason)', (t) => {
  const dir = wsProject(tmpDir(t, 'ws-detect-'));
  const d = depsCache.detect(dir);
  assert.ok(d, 'the lockfile is found');
  assert.equal(d.notCached, undefined, `not excluded: ${d.notCached}`);
  assert.equal(d.manager, 'npm');
});

test('#599 a second worktree with the same lockfile gets its node_modules from the cache without an install, and its workspace packages resolve to its own files', async (t) => {
  const cacheDir = tmpDir(t, 'ws-cache-');
  const npm = fakeNpm();
  const wtA = wsProject(tmpDir(t, 'ws-wtA-'));
  const r1 = await ensure(wtA, cacheDir, npm.run);
  assert.equal(r1.status, 'miss');
  assertOwnPackages(wtA);

  const wtB = wsProject(tmpDir(t, 'ws-wtB-'));
  const r2 = await ensure(wtB, cacheDir, npm.run);
  assert.equal(r2.status, 'hit');
  assert.equal(r2.entry, r1.entry);
  assert.deepEqual(npm.installs, [wtA], 'one install, in the first worktree only');
  assertOwnPackages(wtB);
  assertOwnPackages(wtA);
});

test('#599 the hoisted packages are one tree in the cache entry, shared by the worktrees', async (t) => {
  const cacheDir = tmpDir(t, 'ws-cache-');
  const npm = fakeNpm();
  const wtA = wsProject(tmpDir(t, 'ws-wtA-'));
  const r1 = await ensure(wtA, cacheDir, npm.run);
  const wtB = wsProject(tmpDir(t, 'ws-wtB-'));
  await ensure(wtB, cacheDir, npm.run);
  const fromA = resolved('hoisted', wtA);
  const fromB = resolved('hoisted', wtB);
  assertInside(fromA, r1.entry, 'hoisted from worktree A');
  assert.equal(fromB, fromA, 'worktree B loads the same hoisted file');
});

test('#599 two worktrees of the same key set up at the same time each get their own workspace links; the entry counts both', async (t) => {
  const cacheDir = tmpDir(t, 'ws-cache-');
  const npm = fakeNpm();
  const wtA = wsProject(tmpDir(t, 'ws-wtA-'));
  const r1 = await ensure(wtA, cacheDir, npm.run);
  const wtB = wsProject(tmpDir(t, 'ws-wtB-'));
  const wtC = wsProject(tmpDir(t, 'ws-wtC-'));
  const [rB, rC] = await Promise.all([ensure(wtB, cacheDir, npm.run), ensure(wtC, cacheDir, npm.run)]);
  assert.deepEqual([rB.status, rC.status], ['hit', 'hit']);
  assert.equal(npm.installs.length, 1);
  assertOwnPackages(wtB);
  assertOwnPackages(wtC);
  assert.equal(depsCache.linkedBy(r1.entry).length, 3, 'links/ counts the three worktrees');
});

test('#599 removing a worktree removes its links and leaves the entry intact for the others and for a new worktree', async (t) => {
  const cacheDir = tmpDir(t, 'ws-cache-');
  const npm = fakeNpm();
  const wtA = wsProject(tmpDir(t, 'ws-wtA-'));
  const r1 = await ensure(wtA, cacheDir, npm.run);
  const wtB = wsProject(tmpDir(t, 'ws-wtB-'));
  await ensure(wtB, cacheDir, npm.run);

  depsCache.unlinkDeps(wtA);
  fs.rmSync(wtA, { recursive: true, force: true, maxRetries: 3 });

  assert.equal(depsCache.entryUsable(r1.entry), true, 'the entry is still usable');
  assert.ok(fs.existsSync(path.join(r1.entry, 'node_modules', 'hoisted', 'index.js')), 'the shared tree is intact');
  assert.equal(depsCache.linkedBy(r1.entry).length, 1, 'only worktree B is counted');
  assertOwnPackages(wtB);
  assert.ok(resolved('hoisted', wtB), 'worktree B still loads the hoisted packages');

  const wtC = wsProject(tmpDir(t, 'ws-wtC-'));
  const rC = await ensure(wtC, cacheDir, npm.run);
  assert.equal(rC.status, 'hit');
  assertOwnPackages(wtC);
});

test('#599 the key includes the set of workspace packages: a package added or renamed is a new entry', async (t) => {
  const cacheDir = tmpDir(t, 'ws-cache-');
  const npm = fakeNpm();
  const lock = lockText();
  const wtA = wsProject(tmpDir(t, 'ws-wtA-'), { lock });
  const r1 = await ensure(wtA, cacheDir, npm.run);

  const added = wsProject(tmpDir(t, 'ws-added-'), { lock, packages: { ...PACKAGES, 'packages/c': '@scope/c' } });
  const r2 = await ensure(added, cacheDir, npm.run);
  assert.notEqual(r2.key, r1.key, 'an added package changes the key');
  assert.equal(r2.status, 'miss');

  const renamed = wsProject(tmpDir(t, 'ws-renamed-'), { lock, packages: { ...PACKAGES, 'packages/b': '@scope/b2' } });
  const r3 = await ensure(renamed, cacheDir, npm.run);
  assert.notEqual(r3.key, r1.key, 'a renamed package changes the key');
  assert.notEqual(r3.key, r2.key);
});

test('#599 an npm ci through a worktree (its node_modules emptied) never leaves another worktree with an empty tree', async (t) => {
  const cacheDir = tmpDir(t, 'ws-cache-');
  const npm = fakeNpm();
  const wtA = wsProject(tmpDir(t, 'ws-wtA-'));
  await ensure(wtA, cacheDir, npm.run);
  const wtB = wsProject(tmpDir(t, 'ws-wtB-'));
  const rB = await ensure(wtB, cacheDir, npm.run);
  assert.equal(rB.status, 'hit');

  // npm ci first empties node_modules (through whatever node_modules is)
  for (const name of fs.readdirSync(path.join(wtB, 'node_modules'))) fs.rmSync(path.join(wtB, 'node_modules', name), { recursive: true, force: true });

  await ensure(wtB, cacheDir, npm.run, { previous: rB });
  assert.ok(resolved('hoisted', wtB), 'worktree B has its dependencies again');
  assertOwnPackages(wtB);

  const wtC = wsProject(tmpDir(t, 'ws-wtC-'));
  await ensure(wtC, cacheDir, npm.run);
  assert.ok(resolved('hoisted', wtC), 'a new worktree gets a full tree');
  assertOwnPackages(wtC);
});

test('#599 a package added through a worktree marks the entry unusable: a new worktree does not see it', async (t) => {
  const cacheDir = tmpDir(t, 'ws-cache-');
  const npm = fakeNpm();
  const wtA = wsProject(tmpDir(t, 'ws-wtA-'));
  await ensure(wtA, cacheDir, npm.run);
  const wtB = wsProject(tmpDir(t, 'ws-wtB-'));
  const rB = await ensure(wtB, cacheDir, npm.run);

  // `npm install extra` in worktree B: a new package and npm's hidden lockfile rewritten
  const nmB = path.join(wtB, 'node_modules');
  fs.mkdirSync(path.join(nmB, 'extra'), { recursive: true });
  fs.writeFileSync(path.join(nmB, 'extra', 'package.json'), JSON.stringify({ name: 'extra', version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(nmB, 'extra', 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(nmB, '.package-lock.json'), '{"changed":true}');

  await ensure(wtB, cacheDir, npm.run, { previous: rB });
  const wtC = wsProject(tmpDir(t, 'ws-wtC-'));
  await ensure(wtC, cacheDir, npm.run);
  assert.equal(resolved('extra', wtC), null, 'the new worktree does not load the package worktree B added');
  assert.ok(resolved('hoisted', wtC));
  assertOwnPackages(wtC);
});

test('#599 a hit on a workspaces project runs its lifecycle scripts in the new worktree', async (t) => {
  const cacheDir = tmpDir(t, 'ws-cache-');
  const npm = fakeNpm();
  const scripts = { prepare: 'node build.js', test: 'x' };
  const wtA = wsProject(tmpDir(t, 'ws-wtA-'), { scripts });
  await ensure(wtA, cacheDir, npm.run);
  const wtB = wsProject(tmpDir(t, 'ws-wtB-'), { scripts });
  const r = await ensure(wtB, cacheDir, npm.run);
  assert.equal(r.status, 'hit');
  assert.deepEqual(npm.scriptsIn(wtB), ['prepare']);
});

test('#599 a workspaces project with a link: dependency stays not cached', (t) => {
  const dir = wsProject(tmpDir(t, 'ws-linkdep-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'mono', version: '1.0.0', workspaces: WORKSPACES, dependencies: { outside: 'link:../outside' } }));
  const d = depsCache.detect(dir);
  assert.ok(d && d.notCached, 'a link: dependency is not cached');
});
