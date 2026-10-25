// packages/engine/engine/deps-cache.js (#198): dependencies installed once per lockfile content, shared across
// worktrees from <workspace>/cache/deps/<project>/<key>/node_modules, linked into each worktree.
// `run` is injected everywhere (a fake installer): never spawns a real npm.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const depsCache = require('../engine/deps-cache');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// A folder that `detect()` reads as an npm project (package.json + package-lock.json).
function npmProject(dir, lockContent = '{}') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p"}');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), lockContent);
}

// A fake `npm ci`: answers --version, and otherwise writes the sentinel file ensureDeps looks for.
function fakeRun({ version = '1.0.0' } = {}) {
  return async (cmd, args, opts = {}) => {
    if (args[0] === '--version') return { code: 0, output: version, timedOut: false };
    const nm = path.join(opts.cwd, 'node_modules');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, '.package-lock.json'), '{}');
    return { code: 0, output: '', timedOut: false };
  };
}

// A cache entry's folder, with a complete entry.json (bypasses ensureDeps, for pruneDepsCache/cacheInfo).
function makeEntry(cacheDir, project, key, { bytes = 100, lastUsed = new Date().toISOString(), unusable = null } = {}) {
  const dir = path.join(cacheDir, project, key);
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  const meta = { key, bytes, last_used: lastUsed, sentinel: null };
  if (unusable) meta.unusable = unusable;
  fs.writeFileSync(path.join(dir, 'entry.json'), JSON.stringify(meta));
  return dir;
}

// Makes `entryDir` look linked by a (fake) worktree: a real link, recorded under entryDir/links.
function markLinked(entryDir, tmpRoot) {
  const wt = fs.mkdtempSync(path.join(tmpRoot, 'wt-'));
  const nm = path.join(wt, 'node_modules');
  fs.symlinkSync(path.join(entryDir, 'node_modules'), nm, process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(entryDir, 'links'), { recursive: true });
  fs.writeFileSync(path.join(entryDir, 'links', 'link.json'), JSON.stringify({ path: nm, at: new Date().toISOString() }));
}

// ---- cacheKey ----------------------------------------------------------------------------------

test('cacheKey: same inputs give the same key; a changed lockfile, node, managerVersion, platform or arch gives a different key', () => {
  const base = { lockText: '{"a":1}', manager: 'npm', managerVersion: '10.0.0', node: '22.0.0', platform: 'win32', arch: 'x64' };
  const k = depsCache.cacheKey(base).key;
  assert.equal(depsCache.cacheKey({ ...base }).key, k);
  assert.notEqual(depsCache.cacheKey({ ...base, lockText: '{"a":2}' }).key, k);
  assert.notEqual(depsCache.cacheKey({ ...base, node: '20.0.0' }).key, k);
  assert.notEqual(depsCache.cacheKey({ ...base, managerVersion: '9.0.0' }).key, k);
  assert.notEqual(depsCache.cacheKey({ ...base, platform: 'linux' }).key, k);
  assert.notEqual(depsCache.cacheKey({ ...base, arch: 'arm64' }).key, k);
});

// ---- ensureDeps: hit / miss / linked --------------------------------------------------------------

test('ensureDeps: a miss installs and links node_modules; a second worktree with the same lockfile gets a hit; a repeat call with `previous` returns linked', async (t) => {
  const cacheDir = tmpDir(t, 'cache-');
  const wtA = tmpDir(t, 'wtA-');
  npmProject(wtA);
  const run = fakeRun();
  const r1 = await depsCache.ensureDeps({ workDir: wtA, cacheDir, project: 'p', env: {}, run });
  assert.equal(r1.status, 'miss');
  assert.ok(depsCache.linkTarget(path.join(wtA, 'node_modules')), 'node_modules is now a link into the cache');

  const wtB = tmpDir(t, 'wtB-');
  npmProject(wtB);
  const r2 = await depsCache.ensureDeps({ workDir: wtB, cacheDir, project: 'p', env: {}, run });
  assert.equal(r2.status, 'hit');
  assert.equal(r2.key, r1.key);
  assert.equal(r2.entry, r1.entry);

  const r3 = await depsCache.ensureDeps({ workDir: wtA, cacheDir, project: 'p', env: {}, run, previous: r1 });
  assert.equal(r3.status, 'linked');
});

test('ensureDeps: a hit runs the project\'s lifecycle scripts, so prepare\'s gitignored outputs (the 3D bundle) exist in the new worktree (#451)', async (t) => {
  const cacheDir = tmpDir(t, 'cache-');
  const scripts = { postinstall: 'node postinstall.js', prepare: 'node scripts/build-3d.js' };
  const project = (dir) => {
    npmProject(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts }));
  };
  // the fake npm: an install fills node_modules; `run <script>` does what the script would build
  const install = fakeRun();
  const run = async (cmd, args, opts = {}) => {
    if (args[0] !== 'run') return install(cmd, args, opts);
    const name = args[args.length - 1];
    const out = path.join(opts.cwd, 'generated');
    fs.mkdirSync(out, { recursive: true });
    if (name === 'prepare') {
      fs.writeFileSync(path.join(out, 'run3d-scene.js'), '// bundle');
      fs.writeFileSync(path.join(out, 'project-city.js'), '// bundle');
    }
    if (name === 'postinstall') fs.writeFileSync(path.join(out, 'postinstall.txt'), 'ok');
    return { code: 0, output: '', timedOut: false };
  };

  const wtA = tmpDir(t, 'wtA-');
  project(wtA);
  assert.equal((await depsCache.ensureDeps({ workDir: wtA, cacheDir, project: 'p', env: {}, run })).status, 'miss');

  const wtB = tmpDir(t, 'wtB-');
  project(wtB);
  const r = await depsCache.ensureDeps({ workDir: wtB, cacheDir, project: 'p', env: {}, run });
  assert.equal(r.status, 'hit');
  assert.ok(depsCache.linkTarget(path.join(wtB, 'node_modules')), 'node_modules is a link into the cache');
  assert.equal(fs.existsSync(path.join(wtB, 'generated', 'run3d-scene.js')), true, 'prepare built the 3D bundle in the new worktree');
  assert.equal(fs.existsSync(path.join(wtB, 'generated', 'project-city.js')), true, 'prepare built the city bundle in the new worktree');
  assert.equal(fs.existsSync(path.join(wtB, 'generated', 'postinstall.txt')), true, 'the install lifecycle scripts ran too');
});

// An npm project with `scripts`, and a fake npm that records the scripts it is asked to run
// (`run … <name>`) per worktree; the names in `failing` exit 1.
function scriptProject(dir, scripts) {
  npmProject(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts }));
}
function recordingRun({ failing = [] } = {}) {
  const install = fakeRun();
  const ran = [];
  const run = async (cmd, args, opts = {}) => {
    if (args[0] !== 'run') return install(cmd, args, opts);
    const name = args[args.length - 1];
    ran.push({ cwd: opts.cwd, name });
    return failing.includes(name) ? { code: 1, output: `${name} broke`, timedOut: false } : { code: 0, output: '', timedOut: false };
  };
  return { run, scriptsIn: (dir) => ran.filter((r) => r.cwd === dir).map((r) => r.name) };
}

test('ensureDeps: a hit runs each lifecycle script the project has once, in install order; scripts it lacks or that are not lifecycle ones are not run (#451)', async (t) => {
  const cacheDir = tmpDir(t, 'cache-');
  const scripts = { build: 'x', test: 'x', postprepare: 'x', prepare: 'x', preprepare: 'x', postinstall: 'x' };
  const { run, scriptsIn } = recordingRun();
  const wtA = tmpDir(t, 'wtA-');
  scriptProject(wtA, scripts);
  await depsCache.ensureDeps({ workDir: wtA, cacheDir, project: 'p', env: {}, run });
  const wtB = tmpDir(t, 'wtB-');
  scriptProject(wtB, scripts);
  const r = await depsCache.ensureDeps({ workDir: wtB, cacheDir, project: 'p', env: {}, run });
  assert.equal(r.status, 'hit');
  assert.deepEqual(scriptsIn(wtB), ['postinstall', 'preprepare', 'prepare', 'postprepare']);
  assert.equal(r.scripts_failed, undefined, 'nothing failed');
});

test('ensureDeps: a lifecycle script that fails on a hit is never fatal: the worktree stays linked, the result names it and a warning is logged (#451)', async (t) => {
  const cacheDir = tmpDir(t, 'cache-');
  const scripts = { prepare: 'x', postprepare: 'x' };
  const { run, scriptsIn } = recordingRun({ failing: ['prepare'] });
  const wtA = tmpDir(t, 'wtA-');
  scriptProject(wtA, scripts);
  await depsCache.ensureDeps({ workDir: wtA, cacheDir, project: 'p', env: {}, run });
  const wtB = tmpDir(t, 'wtB-');
  scriptProject(wtB, scripts);
  const logs = [];
  const r = await depsCache.ensureDeps({ workDir: wtB, cacheDir, project: 'p', env: {}, run, log: (level, msg) => logs.push(`${level}: ${msg}`) });
  assert.equal(r.status, 'hit');
  assert.ok(depsCache.linkTarget(path.join(wtB, 'node_modules')), 'node_modules is still a link into the cache');
  assert.deepEqual(r.scripts_failed, ['prepare']);
  assert.deepEqual(scriptsIn(wtB), ['prepare', 'postprepare'], 'the scripts after the failed one still run');
  const warn = logs.filter((l) => l.startsWith('warn:') && l.includes('prepare'));
  assert.equal(warn.length >= 1, true, `a warning names the failed script: ${JSON.stringify(logs)}`);
  assert.match(warn[0], /prepare broke/, 'with the end of its output');
});

test('ensureDeps: a worktree already linked to the entry is not rebuilt: its lifecycle scripts do not run again (#451)', async (t) => {
  const cacheDir = tmpDir(t, 'cache-');
  const scripts = { prepare: 'x' };
  const { run, scriptsIn } = recordingRun();
  const wtA = tmpDir(t, 'wtA-');
  scriptProject(wtA, scripts);
  await depsCache.ensureDeps({ workDir: wtA, cacheDir, project: 'p', env: {}, run });
  const wtB = tmpDir(t, 'wtB-');
  scriptProject(wtB, scripts);
  assert.equal((await depsCache.ensureDeps({ workDir: wtB, cacheDir, project: 'p', env: {}, run })).status, 'hit');
  const again = await depsCache.ensureDeps({ workDir: wtB, cacheDir, project: 'p', env: {}, run });
  assert.equal(again.status, 'linked');
  assert.deepEqual(scriptsIn(wtB), ['prepare'], 'prepare ran once, on the hit');
});

test('ensureDeps: two concurrent installs of the same key install once; the one that loses the race waits and gets a hit', async (t) => {
  const cacheDir = tmpDir(t, 'cache-');
  const wtA = tmpDir(t, 'wtA-');
  const wtB = tmpDir(t, 'wtB-');
  npmProject(wtA);
  npmProject(wtB);
  let resolveInstall;
  const gate = new Promise((r) => { resolveInstall = r; });
  const run = async (cmd, args, opts = {}) => {
    if (args[0] === '--version') return { code: 0, output: '1.0.0', timedOut: false };
    await gate;
    const nm = path.join(opts.cwd, 'node_modules');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, '.package-lock.json'), '{}');
    return { code: 0, output: '', timedOut: false };
  };
  const pA = depsCache.ensureDeps({ workDir: wtA, cacheDir, project: 'p', env: {}, run });
  const pB = depsCache.ensureDeps({ workDir: wtB, cacheDir, project: 'p', env: {}, run });
  setTimeout(resolveInstall, 100);
  const [rA, rB] = await Promise.all([pA, pB]);
  assert.deepEqual([rA.status, rB.status].sort(), ['hit', 'miss']);
  const winner = rA.status === 'miss' ? rA : rB;
  const waiter = rA.status === 'miss' ? rB : rA;
  assert.equal(waiter.waited, true);
  assert.equal(waiter.key, winner.key);
  assert.equal(waiter.entry, winner.entry);
});

test('ensureDeps: an interrupted install (an entry folder without entry.json) is never used and is replaced', async (t) => {
  const cacheDir = tmpDir(t, 'cache-');
  const wt = tmpDir(t, 'wt-');
  npmProject(wt);
  const run = fakeRun();
  const lockText = fs.readFileSync(path.join(wt, 'package-lock.json'));
  const { key } = depsCache.cacheKey({ lockText, manager: 'npm', managerVersion: '1.0.0', node: '1.0.0' });
  const crashed = path.join(cacheDir, depsCache.projectSlug('p'), key);
  fs.mkdirSync(path.join(crashed, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(crashed, 'node_modules', 'leftover.txt'), 'from a crashed install');

  const r = await depsCache.ensureDeps({ workDir: wt, cacheDir, project: 'p', env: {}, run });
  assert.equal(r.status, 'miss');
  assert.equal(r.key, key);
  assert.ok(fs.existsSync(path.join(r.entry, 'entry.json')));
});

// ---- ensureDeps: an agent changing the linked tree (taint / emptied) -----------------------------

test('ensureDeps: a change through the link (taint) marks the entry unusable; the same worktree stays linked, a new one gets a fresh generation', async (t) => {
  const cacheDir = tmpDir(t, 'cache-');
  const wtA = tmpDir(t, 'wtA-');
  npmProject(wtA);
  const run = fakeRun();
  const r1 = await depsCache.ensureDeps({ workDir: wtA, cacheDir, project: 'p', env: {}, run });
  assert.equal(r1.status, 'miss');

  // an agent added a package through the link: the hidden sentinel file changed
  fs.writeFileSync(path.join(wtA, 'node_modules', '.package-lock.json'), '{"changed":true}');

  const r2 = await depsCache.ensureDeps({ workDir: wtA, cacheDir, project: 'p', env: {}, run, previous: r1 });
  assert.equal(r2.status, 'linked', 'the same worktree keeps using what it changed');
  const meta = JSON.parse(fs.readFileSync(path.join(r1.entry, 'entry.json'), 'utf8'));
  assert.equal(meta.unusable, 'changed through a worktree link');

  const wtB = tmpDir(t, 'wtB-');
  npmProject(wtB);
  const r3 = await depsCache.ensureDeps({ workDir: wtB, cacheDir, project: 'p', env: {}, run });
  assert.equal(r3.status, 'miss');
  assert.notEqual(r3.entry, r1.entry);
  assert.match(path.basename(r3.entry), new RegExp(`^${r1.key}\\.\\d+$`));
});

test('ensureDeps: a tree emptied through the link (e.g. npm ci) is marked unusable, and the worktree reinstalls', async (t) => {
  const cacheDir = tmpDir(t, 'cache-');
  const wt = tmpDir(t, 'wt-');
  npmProject(wt);
  const run = fakeRun();
  const r1 = await depsCache.ensureDeps({ workDir: wt, cacheDir, project: 'p', env: {}, run });
  assert.equal(r1.status, 'miss');

  fs.unlinkSync(path.join(wt, 'node_modules', '.package-lock.json'));

  const r2 = await depsCache.ensureDeps({ workDir: wt, cacheDir, project: 'p', env: {}, run, previous: r1 });
  const meta = JSON.parse(fs.readFileSync(path.join(r1.entry, 'entry.json'), 'utf8'));
  assert.equal(meta.unusable, 'emptied through a worktree link');
  assert.equal(r2.status, 'miss', 'the worktree reinstalls since its own entry was emptied');
  assert.notEqual(r2.entry, r1.entry);
});

test('ensureDeps: a previous "failed" or "local" result for the same key is returned as is, not retried', async (t) => {
  const cacheDir = tmpDir(t, 'cache-');
  const wt = tmpDir(t, 'wt-');
  npmProject(wt);
  const run = fakeRun();
  const r1 = await depsCache.ensureDeps({ workDir: wt, cacheDir, project: 'p', env: {}, run });
  for (const status of ['failed', 'local']) {
    const previous = { ...r1, status, reason: 'boom' };
    const r2 = await depsCache.ensureDeps({ workDir: wt, cacheDir, project: 'p', env: {}, run, previous });
    assert.equal(r2, previous);
  }
});

// ---- detect ------------------------------------------------------------------------------------

test('detect: no lockfile gives null', (t) => {
  const dir = tmpDir(t, 'detect-none-');
  assert.equal(depsCache.detect(dir), null);
});

test('detect: a workspaces monorepo (package.json workspaces, or pnpm-workspace.yaml) is not_cached', (t) => {
  const dir1 = tmpDir(t, 'detect-ws1-');
  fs.writeFileSync(path.join(dir1, 'package.json'), JSON.stringify({ name: 'p', workspaces: ['packages/*'] }));
  fs.writeFileSync(path.join(dir1, 'package-lock.json'), '{}');
  assert.match(depsCache.detect(dir1).notCached, /workspaces monorepo/);

  const dir2 = tmpDir(t, 'detect-ws2-');
  fs.writeFileSync(path.join(dir2, 'package.json'), '{"name":"p"}');
  fs.writeFileSync(path.join(dir2, 'pnpm-lock.yaml'), 'lockfileVersion: 6\n');
  fs.writeFileSync(path.join(dir2, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  assert.match(depsCache.detect(dir2).notCached, /workspaces monorepo/);
});

test('detect: local file:/link: dependencies in the lockfile are not_cached (their links point into one worktree)', (t) => {
  const dir = tmpDir(t, 'detect-link-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p"}');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/x': { link: true } } }));
  assert.match(depsCache.detect(dir).notCached, /file:.*link:.*dependencies/);
});

test('detect: other languages\' lockfiles are not_cached, each with its own reason', (t) => {
  const cases = [
    ['poetry.lock', /Python virtual environments/],
    ['go.sum', /Go modules/],
    ['Gemfile.lock', /Ruby gems/],
    ['uv.lock', /Python virtual environments/],
    ['requirements-dev.txt', /Python virtual environments/],
  ];
  for (const [file, reason] of cases) {
    const dir = tmpDir(t, 'detect-other-');
    fs.writeFileSync(path.join(dir, file), '');
    assert.match(depsCache.detect(dir).notCached, reason, file);
  }
});

// ---- acquireLock --------------------------------------------------------------------------------

test('acquireLock: a lock held by a dead pid on the same host is taken over; waitMs elapsed throws', async (t) => {
  const dir = tmpDir(t, 'lock-');
  const file = path.join(dir, 'x.lock');
  fs.writeFileSync(file, JSON.stringify({ pid: 999999, host: os.hostname(), started: Date.now() }));
  const release = await depsCache.acquireLock(file, { waitMs: 5000 });
  assert.equal(typeof release, 'function');
  release();

  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, host: os.hostname(), started: Date.now() }));
  await assert.rejects(depsCache.acquireLock(file, { waitMs: 300, pollMs: 50 }), /still locked by pid/);
});

// ---- unlinkDeps ---------------------------------------------------------------------------------

test('unlinkDeps: removes links at the root and in a subfolder, never the cache files they point to', (t) => {
  const cacheEntry = tmpDir(t, 'cache-entry-');
  fs.mkdirSync(path.join(cacheEntry, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(cacheEntry, 'node_modules', 'x.txt'), 'kept');

  const wt = tmpDir(t, 'wt-');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(path.join(cacheEntry, 'node_modules'), path.join(wt, 'node_modules'), linkType);
  fs.mkdirSync(path.join(wt, 'app'));
  fs.symlinkSync(path.join(cacheEntry, 'node_modules'), path.join(wt, 'app', 'node_modules'), linkType);

  const removed = depsCache.unlinkDeps(wt);
  assert.equal(removed.length, 2);
  assert.ok(!fs.existsSync(path.join(wt, 'node_modules')));
  assert.ok(!fs.existsSync(path.join(wt, 'app', 'node_modules')));
  assert.ok(fs.existsSync(path.join(cacheEntry, 'node_modules', 'x.txt')), 'the cache entry itself is untouched');
});

// ---- pruneDepsCache / cacheInfo -------------------------------------------------------------------

test('pruneDepsCache: keeps linked entries; removes unusable, incomplete (after a day) and stale entries; honors the size cap', (t) => {
  const cacheDir = tmpDir(t, 'prune-');
  const project = 'p';
  const now = Date.now();
  const day = 864e5;

  const linked = makeEntry(cacheDir, project, 'linked', { bytes: 100, lastUsed: new Date(now - 30 * day).toISOString() });
  markLinked(linked, cacheDir);
  makeEntry(cacheDir, project, 'unusable', { bytes: 100, lastUsed: new Date(now).toISOString(), unusable: 'emptied through a worktree link' });

  const incompleteOld = path.join(cacheDir, project, 'incomplete-old');
  fs.mkdirSync(path.join(incompleteOld, 'node_modules'), { recursive: true });
  const old = new Date(now - 2 * day);
  fs.utimesSync(incompleteOld, old, old);

  const incompleteFresh = path.join(cacheDir, project, 'incomplete-fresh');
  fs.mkdirSync(path.join(incompleteFresh, 'node_modules'), { recursive: true });

  makeEntry(cacheDir, project, 'stale', { bytes: 100, lastUsed: new Date(now - 20 * day).toISOString() });
  const fresh = makeEntry(cacheDir, project, 'fresh', { bytes: 100, lastUsed: new Date(now - 1 * day).toISOString() });

  const r = depsCache.pruneDepsCache({ cacheDir, maxAgeDays: 14, maxBytes: 1e9, now });
  assert.deepEqual(new Set(r.removed.map((d) => path.basename(d))), new Set(['unusable', 'incomplete-old', 'stale']));
  assert.ok(fs.existsSync(linked), 'a linked entry is kept whatever its age');
  assert.ok(fs.existsSync(incompleteFresh), 'an incomplete entry younger than a day is kept (it may still be installing)');
  assert.ok(fs.existsSync(fresh));

  // over the size cap: the least recently used of what is left (and usable) goes
  const r2 = depsCache.pruneDepsCache({ cacheDir, maxAgeDays: 14, maxBytes: 50, now });
  assert.ok(r2.removed.includes(fresh), 'fresh is the only unlinked, usable entry left, over the cap');
  assert.ok(fs.existsSync(linked), 'still kept: it is linked');
});

test('pruneDepsCache: maxAgeDays 0 removes every unlinked entry (Settings > Clear dependency cache)', (t) => {
  const cacheDir = tmpDir(t, 'prune-clear-');
  const a = makeEntry(cacheDir, 'p', 'a', { lastUsed: new Date().toISOString() });
  const b = makeEntry(cacheDir, 'p', 'b', { lastUsed: new Date().toISOString() });
  markLinked(b, cacheDir);
  const r = depsCache.pruneDepsCache({ cacheDir, maxAgeDays: 0 });
  assert.deepEqual(r.removed, [a]);
  assert.ok(fs.existsSync(b), 'a linked entry survives even "clear cache"');
});

test('cacheInfo: sums entry.json bytes and counts linked entries', (t) => {
  const cacheDir = tmpDir(t, 'info-');
  makeEntry(cacheDir, 'p', 'a', { bytes: 100 });
  const b = makeEntry(cacheDir, 'p', 'b', { bytes: 250 });
  markLinked(b, cacheDir);
  const info = depsCache.cacheInfo(cacheDir);
  assert.equal(info.entries, 2);
  assert.equal(info.bytes, 350);
  assert.equal(info.linked, 1);
});
