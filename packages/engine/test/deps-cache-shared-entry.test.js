// #778: two worktrees share one dependency-cache entry; one worktree's agent changes it through its
// link (a package added or removed). The other worktree is relinked to a usable generation of the
// same key the next time its dependencies are checked; the worktree that made the change keeps it.
// `run` is injected (a fake installer): never spawns a real `npm ci`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const depsCache = require('../engine/deps-cache');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    depsCache.unlinkDeps(dir);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  return dir;
}

// A folder that `detect()` reads as an npm project (package.json + package-lock.json).
function npmProject(dir, lockContent = '{}') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p"}');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), lockContent);
}

// A fake `npm ci`: answers --version (or asks the real tool when `realVersions`), and otherwise
// writes the hidden lockfile (the sentinel) and one package; counts the installs it ran.
function fakeRun({ realVersions = false } = {}) {
  const calls = { installs: 0 };
  const run = async (cmd, args, opts = {}) => {
    if (args[0] === '--version') return realVersions ? depsCache.runCommand(cmd, args, opts) : { code: 0, output: '1.0.0', timedOut: false };
    calls.installs++;
    const nm = path.join(opts.cwd, 'node_modules');
    fs.mkdirSync(path.join(nm, 'xterm'), { recursive: true });
    fs.writeFileSync(path.join(nm, '.package-lock.json'), '{}');
    fs.writeFileSync(path.join(nm, 'xterm', 'index.js'), 'module.exports = 1;');
    return { code: 0, output: '', timedOut: false };
  };
  return { run, calls };
}

const ensure = (workDir, cacheDir, run, previous = null) => depsCache.ensureDeps({ workDir, cacheDir, project: 'p', env: {}, run, previous });

// The entry folder a worktree's node_modules points into (null when it is not a link into the cache)
function linkedEntry(workDir) {
  const target = depsCache.linkTarget(path.join(workDir, 'node_modules'));
  return target ? path.resolve(path.dirname(target)) : null;
}

// Worktree A's agent adds a package through its link: a package lands in the shared tree, the
// hidden lockfile changes and one package the others need is removed
function changeThroughLink(workDir) {
  const nm = path.join(workDir, 'node_modules');
  fs.writeFileSync(path.join(nm, '.package-lock.json'), '{"changed":true}');
  fs.rmSync(path.join(nm, 'xterm'), { recursive: true, force: true });
  fs.mkdirSync(path.join(nm, 'added'), { recursive: true });
}

test('#778 A\'s agent changes the shared entry: B, linked to the same key, is relinked to a fresh install of that key; A keeps its own changed tree', async (t) => {
  const cacheDir = tmpDir(t, 'cache-778-');
  const { run, calls } = fakeRun();
  const wtA = tmpDir(t, 'wtA-778-');
  const wtB = tmpDir(t, 'wtB-778-');
  npmProject(wtA);
  npmProject(wtB);
  const rA = await ensure(wtA, cacheDir, run);
  const rB = await ensure(wtB, cacheDir, run);
  assert.equal(rA.status, 'miss');
  assert.equal(rB.status, 'hit');
  assert.equal(rB.entry, rA.entry, 'both worktrees share one entry');

  changeThroughLink(wtA);
  // A's dependency check after its agent step: the entry is marked unusable, A keeps it
  const rA2 = await ensure(wtA, cacheDir, run, rA);
  assert.equal(rA2.status, 'linked', 'the worktree that made the change keeps its tree');
  assert.equal(rA2.entry, rA.entry);
  assert.equal(depsCache.entryUsable(rA.entry), false);

  const installsBefore = calls.installs;
  const rB2 = await ensure(wtB, cacheDir, run, rB);
  assert.equal(rB2.key, rB.key, 'B\'s lockfile did not change: same key');
  assert.notEqual(rB2.entry, rB.entry, 'B no longer uses the entry A changed');
  assert.equal(['hit', 'miss'].includes(rB2.status), true, `relinked, not kept: ${rB2.status}`);
  assert.equal(calls.installs, installsBefore + 1, 'no usable generation existed: one was installed');
  assert.equal(linkedEntry(wtB), path.resolve(rB2.entry), 'B\'s node_modules points at the new generation');
  assert.equal(depsCache.entryUsable(rB2.entry), true);
  assert.equal(fs.existsSync(path.join(wtB, 'node_modules', 'xterm', 'index.js')), true, 'B builds against a complete tree');
  assert.equal(fs.readFileSync(path.join(wtB, 'node_modules', '.package-lock.json'), 'utf8'), '{}');

  // A's next check still keeps what its agent changed
  const rA3 = await ensure(wtA, cacheDir, run, rA2);
  assert.equal(rA3.entry, rA.entry);
  assert.equal(linkedEntry(wtA), path.resolve(rA.entry));
  assert.equal(fs.existsSync(path.join(wtA, 'node_modules', 'added')), true, 'A\'s added package is still there');
});

test('#778 A\'s agent changes the shared entry and its lockfile (A moves to a new key): B is relinked to the usable generation already installed, without a new install', async (t) => {
  const cacheDir = tmpDir(t, 'cache-778-');
  const { run, calls } = fakeRun();
  const wtA = tmpDir(t, 'wtA-778-');
  const wtB = tmpDir(t, 'wtB-778-');
  npmProject(wtA);
  npmProject(wtB);
  const rA = await ensure(wtA, cacheDir, run);
  const rB = await ensure(wtB, cacheDir, run);
  assert.equal(rB.entry, rA.entry);

  // the #751 case: package.json and the lockfile change with the shared tree
  changeThroughLink(wtA);
  fs.writeFileSync(path.join(wtA, 'package-lock.json'), '{"added":true}');
  const rA2 = await ensure(wtA, cacheDir, run, rA);
  assert.notEqual(rA2.key, rA.key, 'A moved to its new key');
  assert.equal(depsCache.entryUsable(rA.entry), false, 'the shared entry is marked unusable');

  // a third worktree of the old key gets a fresh generation (as the engine did for #697's key)
  const wtC = tmpDir(t, 'wtC-778-');
  npmProject(wtC);
  const rC = await ensure(wtC, cacheDir, run);
  assert.equal(rC.status, 'miss');
  assert.notEqual(rC.entry, rA.entry);

  const installsBefore = calls.installs;
  const rB2 = await ensure(wtB, cacheDir, run, rB);
  assert.equal(rB2.status, 'hit', `B is relinked to the existing generation: ${rB2.status} ${rB2.reason || ''}`);
  assert.equal(rB2.entry, rC.entry);
  assert.equal(calls.installs, installsBefore, 'no install: a usable generation of the key existed');
  assert.equal(linkedEntry(wtB), path.resolve(rC.entry));
  assert.equal(fs.existsSync(path.join(wtB, 'node_modules', 'xterm', 'index.js')), true, 'the module A removed is back for B');

  // checked again: B stays on the new generation
  const rB3 = await ensure(wtB, cacheDir, run, rB2);
  assert.equal(rB3.entry, rC.entry);
  assert.equal(rB3.status, 'linked');
});

test('#778 a run\'s dependency check relinks its worktree off an entry another worktree changed, and records deps.ready with a reason naming that worktree', { timeout: 120000 }, async (t) => {
  const { methods } = require('../engine/run/checkout');
  const ws = tmpDir(t, 'ws-778-');
  const cacheDir = path.join(ws, 'cache', 'deps');
  // the run's own key uses the real npm/node versions: the fake installer answers them for real
  const { run } = fakeRun({ realVersions: true });
  const wtA = tmpDir(t, 'wtA-778-');
  const wtB = tmpDir(t, 'wtB-778-');
  npmProject(wtA);
  npmProject(wtB);
  const rA = await depsCache.ensureDeps({ workDir: wtA, cacheDir, project: 'p', env: process.env, run });
  assert.equal(rA.status, 'miss', rA.reason || '');
  const rB = await depsCache.ensureDeps({ workDir: wtB, cacheDir, project: 'p', env: process.env, run });
  assert.equal(rB.entry, rA.entry);

  changeThroughLink(wtA);
  await depsCache.ensureDeps({ workDir: wtA, cacheDir, project: 'p', env: process.env, run, previous: rA });
  assert.equal(depsCache.entryUsable(rA.entry), false);
  // a usable generation exists (installed for another worktree), so the run's check never installs
  const wtC = tmpDir(t, 'wtC-778-');
  npmProject(wtC);
  const rC = await depsCache.ensureDeps({ workDir: wtC, cacheDir, project: 'p', env: process.env, run });
  assert.equal(rC.status, 'miss');

  const events = [];
  const fakeWorkflow = {
    machine: { simulated: false }, runDir: path.join(ws, 'runs', 'r-697'), projectId: 'p', abort: new AbortController(), ctx: { worktree_dir: wtB },
    deps: { worktree: rB },
    emitEvent: (type, ev) => events.push({ type, ...ev }),
  };
  const r = await methods.prepareDeps.call(fakeWorkflow, 'worktree', wtB, 'step build');
  assert.equal(r.entry, rC.entry, `relinked to the usable generation: ${r.status} ${r.reason || ''}`);
  assert.equal(linkedEntry(wtB), path.resolve(rC.entry));
  const ready = events.filter((e) => e.type === 'deps.ready');
  assert.equal(ready.length, 1, JSON.stringify(events.map((e) => e.type)));
  assert.equal(ready[0].entry, rC.entry);
  assert.equal(typeof ready[0].reason, 'string', 'the relink says why');
  assert.equal(ready[0].reason.includes(path.basename(wtA)), true, `the reason names the worktree that changed the entry: ${ready[0].reason}`);
});
