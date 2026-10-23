// Dependencies installed once per lockfile content (#198). Every run used to install its project's
// dependencies several times (developer, test writer, the base check, the builder): tens of
// thousands of files written per install, scanned by the antivirus, with four runs in parallel.
// Now the engine gives each worktree its `node_modules` from a shared cache in the workspace:
//
//   <workspace>/cache/deps/<project>/<key>/node_modules   the installed tree
//                                         /entry.json     written last: the entry is complete
//                                         /links/         one file per worktree that links it
//   <workspace>/cache/deps/<project>/<key>.lock           held while one run installs that key
//
// key = sha256 of the lockfile's content + the package manager and its version + the Node version
// that runs the install + platform and arch (the Electron version of a project is in its lockfile).
// Hit: the worktree's node_modules becomes a link to the entry (a directory junction on Windows, a
// symlink elsewhere), then the project's own lifecycle scripts run there (`prepare` and the
// install ones: what they build is gitignored, so a link alone leaves it missing). Miss: the install runs in the worktree (its own lifecycle scripts see the
// whole project), then node_modules is moved into the cache and linked back. Native modules (an
// Electron app's node-pty) keep working: Node resolves a module through its real path in the entry.
// Safety: one installer per key (a lock file with pid and host; a dead holder's lock is taken over),
// the entry is complete only once entry.json is written, an entry an agent changed through the link
// (a package added: the hidden lockfile changed) or emptied (`npm ci`) is marked unusable and never
// given to a new worktree, and a worktree's link is removed (never followed) before the worktree is.
// Not cached yet (documented, agents install as before): npm/yarn/pnpm workspaces and `link:`
// dependencies (their links point into one worktree), and the other languages' lockfiles
// (poetry.lock, uv.lock, requirements*.txt, go.sum, Gemfile.lock): see NOT_CACHED.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { killTree, OWN_GROUP, resolveCommand } = require('./providers');
const { samePath: platformSamePath } = require('../platform-paths');
const { runShim } = require('../shell');

// First match wins (npm uses npm-shrinkwrap.json over package-lock.json)
const MANAGERS = [
  { lockfile: 'npm-shrinkwrap.json', manager: 'npm', args: ['ci', '--no-audit', '--no-fund'], sentinel: '.package-lock.json' },
  { lockfile: 'package-lock.json', manager: 'npm', args: ['ci', '--no-audit', '--no-fund'], sentinel: '.package-lock.json' },
  { lockfile: 'pnpm-lock.yaml', manager: 'pnpm', args: ['install', '--frozen-lockfile'], sentinel: '.modules.yaml' },
  { lockfile: 'yarn.lock', manager: 'yarn', args: ['install', '--frozen-lockfile'], sentinel: '.yarn-integrity' },
];

// Lockfiles of the other language skills: the agents install them as before
const NOT_CACHED = {
  'Gemfile.lock': 'Ruby gems are not cached yet',
  'go.sum': 'Go modules are not cached yet (Go already shares its module cache across checkouts)',
  'poetry.lock': 'Python virtual environments are not cached yet',
  'requirements.txt': 'Python virtual environments are not cached yet',
  'uv.lock': 'Python virtual environments are not cached yet',
};

const INSTALL_TIMEOUT_MS = 20 * 60e3;
const LOCK_WAIT_MS = 30 * 60e3;
const LOCK_STALE_MS = 60 * 60e3;
const MAX_AGE_DAYS = 14;
const MAX_BYTES = 20 * 1024 ** 3;

const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';
// why an entry is no longer given to new worktrees (entry.json `unusable`)
const EMPTIED = 'emptied through a worktree link';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const fileHash = (f) => { try { return sha256(fs.readFileSync(f)); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// The link at `p` → its target, null when `p` is not a link (missing or a real folder)
function linkTarget(p) {
  try {
    if (!fs.lstatSync(p).isSymbolicLink()) return null;
    return path.resolve(path.dirname(p), fs.readlinkSync(p));
  } catch { return null; }
}

function samePath(a, b) {
  const real = (p) => {
    const r = path.resolve(p);
    try { return fs.realpathSync.native(r); } catch { return r; /* missing: as given */ }
  };
  return platformSamePath(real(a), real(b));
}

/**
 * What the folder installs with: { lockfile, manager, args, sentinel } for a cached package manager,
 * { notCached: reason, lockfile } for the rest, null without a lockfile.
 */
function detect(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  const m = MANAGERS.find((x) => has(x.lockfile));
  if (m) {
    const pkg = readJson(path.join(dir, 'package.json')) || {};
    if (pkg.workspaces || has('pnpm-workspace.yaml')) return { notCached: 'a workspaces monorepo (its packages link into one worktree)', lockfile: m.lockfile, manager: m.manager };
    let text = '';
    try { text = fs.readFileSync(path.join(dir, m.lockfile), 'utf8'); } catch { /* unreadable: checked by the install */ }
    if (/"link":\s*true|\blink:/.test(text)) return { notCached: 'local `file:`/`link:` dependencies (their links point into one worktree)', lockfile: m.lockfile, manager: m.manager };
    return { ...m };
  }
  const other = Object.keys(NOT_CACHED).find(has) || (fs.existsSync(dir) && fs.readdirSync(dir).find((f) => /^requirements.*\.txt$/.test(f)));
  return other ? { notCached: NOT_CACHED[other] || NOT_CACHED['requirements.txt'], lockfile: other } : null;
}

// The install's args (`detect`'s): with `--ignore-scripts` under the project's setting (#472)
const installArgs = (d, ignoreScripts) => (ignoreScripts ? [...d.args, '--ignore-scripts'] : d.args);

// Runs `cmd args` (a .cmd shim through the shell on Windows) → { code, output, timedOut }; never rejects.
function runCommand(cmd, args, { cwd, env, timeoutMs = INSTALL_TIMEOUT_MS, signal } = {}) {
  const exe = resolveCommand(cmd);
  if (!exe) return Promise.resolve({ code: null, output: `${cmd} not found in PATH`, timedOut: false });
  const childEnv = { ...process.env, ...(env || {}) };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    let child;
    try {
      child = runShim(exe.file, args, { cwd, env: childEnv, windowsHide: true, ...OWN_GROUP });
    } catch (e) {
      resolve({ code: null, output: e.message, timedOut: false });
      return;
    }
    let output = '';
    let timedOut = false;
    const keep = (d) => { output = (output + d).slice(-4000); };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const stop = () => killTree(child);
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    const done = (code, err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      resolve({ code, output: err ? `${output}${err.message}` : output, timedOut });
    };
    child.on('error', (e) => done(null, e));
    child.on('close', (code) => done(code));
  });
}

// `<manager> --version` and `node --version`, once per process (and per runner, for the tests)
const versionCache = new WeakMap();
async function toolVersion(cmd, run = runCommand) {
  if (!versionCache.has(run)) versionCache.set(run, new Map());
  const known = versionCache.get(run);
  if (!known.has(cmd)) {
    const r = await run(cmd, ['--version'], { timeoutMs: 60e3 });
    known.set(cmd, r.code === 0 ? String(r.output).trim().split(/\r?\n/).pop().replace(/^v/, '') : 'unknown');
  }
  return known.get(cmd);
}

/** The cache key of a lockfile: what changes the installed tree. Same inputs → same key. */
function cacheKey({ lockText, manager, managerVersion, node, platform = process.platform, arch = process.arch }) {
  const facets = { lock: sha256(String(lockText)), manager, managerVersion, node, platform, arch };
  return { key: sha256(JSON.stringify(facets)).slice(0, 24), facets };
}

// Folder name of a project in the cache
const projectSlug = (project) => String(project || 'project').replace(/[^\w.-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 60) || 'project';

// Entries of a key, oldest first: <key> then <key>.<generation> (made when <key> became unusable)
function keyEntries(projectDir, key) {
  let names = [];
  try { names = fs.readdirSync(projectDir); } catch { return []; }
  return names.filter((n) => n === key || (n.startsWith(`${key}.`) && /^\d+$/.test(n.slice(key.length + 1))))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .map((n) => path.join(projectDir, n));
}

// entry.json of a complete entry, null when the entry is incomplete (an install that never finished)
const entryMeta = (entry) => readJson(path.join(entry, 'entry.json'));

/** Complete, not marked unusable, and its tree still there (an `npm ci` through a link empties it). */
function entryUsable(entry) {
  const meta = entryMeta(entry);
  if (!meta || meta.unusable) return false;
  // no sentinel: a lockfile without dependencies (nothing to empty)
  return fs.existsSync(path.join(entry, 'node_modules', meta.sentinel || '.'));
}

// Marks an entry so no new worktree gets it; the worktrees that link it keep it until they go.
function markUnusable(entry, why) {
  const meta = entryMeta(entry);
  if (!meta || meta.unusable) return false;
  writeJson(path.join(entry, 'entry.json'), { ...meta, unusable: why, marked_at: new Date().toISOString() });
  return true;
}

function touch(entry, nmPath) {
  const meta = entryMeta(entry);
  if (meta) writeJson(path.join(entry, 'entry.json'), { ...meta, last_used: new Date().toISOString() });
  if (!nmPath) return;
  const links = path.join(entry, 'links');
  fs.mkdirSync(links, { recursive: true });
  const id = sha256(path.resolve(nmPath).toLowerCase()).slice(0, 16);
  writeJson(path.join(links, `${id}.json`), { path: path.resolve(nmPath), at: new Date().toISOString() });
}

/** The node_modules folders that link this entry now (stale records are dropped). */
function linkedBy(entry) {
  const dir = path.join(entry, 'links');
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const f of files) {
    const rec = readJson(path.join(dir, f));
    const target = rec?.path && linkTarget(rec.path);
    if (target && samePath(target, path.join(entry, 'node_modules'))) out.push(rec.path);
    else try { fs.unlinkSync(path.join(dir, f)); } catch { /* kept for the next look */ }
  }
  return out;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * One installer per key across runs and app instances: a lock file created exclusively, holding
 * { pid, host, started }. A lock whose process is gone (same host) or older than staleMs is taken
 * over. Resolves to release(); throws after waitMs or when the signal aborts.
 */
async function acquireLock(file, { waitMs = LOCK_WAIT_MS, staleMs = LOCK_STALE_MS, signal, onWait = () => {}, pollMs = 1000 } = {}) {
  const t0 = Date.now();
  let told = false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (;;) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, host: os.hostname(), started: Date.now() }), { flag: 'wx' });
      return () => { try { fs.unlinkSync(file); } catch { /* already gone */ } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const held = readJson(file);
    const stale = !held
      ? Date.now() - (fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0) > 10e3 // unreadable for a while: a half-written lock
      : (held.host === os.hostname() && !pidAlive(held.pid)) || Date.now() - held.started > staleMs;
    if (stale) {
      try { fs.unlinkSync(file); } catch { /* another waiter took it over */ }
      continue;
    }
    if (!told) { onWait(held); told = true; }
    if (signal?.aborted) throw new Error('Cancelled');
    if (Date.now() - t0 > waitMs) throw new Error(`dependency cache: still locked by pid ${held?.pid} after ${Math.round(waitMs / 1000)} s`);
    await sleep(pollMs);
  }
}

// Total size of a folder's files, links not followed
function dirBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += fs.statSync(p).size; } catch { /* gone */ } }
    }
  }
  return total;
}

// fs.renameSync with a few tries: an antivirus scan or an indexer holds a new file for a moment (EBUSY/EPERM)
async function renameRetry(from, to, tries = 5) {
  for (let i = 1; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (i >= tries || !['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      await sleep(500 * i);
    }
  }
}

// Removes what is at node_modules: a link is unlinked (never followed), a real folder deleted.
function clearNodeModules(nm) {
  let st;
  try { st = fs.lstatSync(nm); } catch { return true; }
  if (st.isSymbolicLink()) { fs.unlinkSync(nm); return true; }
  try { fs.rmSync(nm, { recursive: true, force: true, maxRetries: 3 }); return true; } catch { return false; }
}

const lastLines = (s, n = 3) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-n).join(' | ');

// The project's own install scripts, in the order an install runs them: a hit only links
// node_modules, so what they build (gitignored outputs, e.g. a bundle `prepare` writes) is missing
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'preprepare', 'prepare', 'postprepare'];

// Runs the worktree's lifecycle scripts after a hit → the names that failed (logged, never fatal)
async function runLifecycle(workDir, d, { env, signal, log, run }) {
  const scripts = readJson(path.join(workDir, 'package.json'))?.scripts || {};
  const failed = [];
  for (const name of LIFECYCLE.filter((n) => typeof scripts[n] === 'string')) {
    // npm: each one once, without its own pre/post (they are in the list)
    const args = d.manager === 'npm' ? ['run', '--ignore-scripts', name] : ['run', name];
    const r = await run(d.manager, args, { cwd: workDir, env, signal });
    if (r.code !== 0) {
      failed.push(name);
      log('warn', `dependency cache: ${d.manager} run ${name} exited ${r.code ?? '?'} in ${workDir}: ${lastLines(r.output)}`);
    }
  }
  return failed;
}

/**
 * Gives `workDir` its dependencies from the cache (install once per key). Idempotent: a worktree
 * already linked to a usable entry of its current key costs a lockfile hash. `previous`: the last
 * result for this folder; its entry is marked unusable when an agent changed it through the link.
 * @returns {Promise<object>} { status, lockfile, manager, key, entry, seconds, reason, waited }
 *   status: none (no lockfile) · not_cached · linked (already) · hit · miss (installed now) ·
 *   local (installed in the worktree, could not go to the cache) · failed (the install failed)
 */
async function ensureDeps({ workDir, cacheDir, project, env, signal, previous = null, log = () => {}, run = runCommand, waitMs = LOCK_WAIT_MS, ignoreScripts = false }) {
  const t0 = Date.now();
  const d = workDir && fs.existsSync(workDir) ? detect(workDir) : null;
  if (!d) return { status: 'none' };
  if (d.notCached) return { status: 'not_cached', lockfile: d.lockfile, manager: d.manager || null, reason: d.notCached };
  const base = { lockfile: d.lockfile, manager: d.manager };
  const nm = path.join(workDir, 'node_modules');

  // an entry this folder linked and an agent changed since: a package added or removed through
  // the link (its hidden lockfile changed), or the tree emptied by an `npm ci`
  if (previous?.entry && fs.existsSync(previous.entry)) {
    const meta = entryMeta(previous.entry);
    const sentinel = meta?.sentinel && path.join(previous.entry, 'node_modules', meta.sentinel);
    if (sentinel && !meta.unusable) {
      if (!fs.existsSync(sentinel)) {
        markUnusable(previous.entry, EMPTIED);
        log('warn', `dependency cache: ${path.basename(previous.entry)} was emptied through ${nm}; it is never given to a new worktree`);
      } else if (meta.sentinel_sha256 && fileHash(sentinel) !== meta.sentinel_sha256) {
        markUnusable(previous.entry, 'changed through a worktree link');
        log('info', `dependency cache: ${path.basename(previous.entry)} was changed through ${nm} (a package added or removed); new worktrees get a fresh install`);
      }
    }
  }

  let lockText;
  try { lockText = fs.readFileSync(path.join(workDir, d.lockfile)); } catch (e) { return { status: 'failed', ...base, reason: `cannot read ${d.lockfile}: ${e.message}` }; }
  const [managerVersion, node] = [await toolVersion(d.manager, run), await toolVersion('node', run)];
  const { key, facets } = cacheKey({ lockText, manager: d.manager, managerVersion, node });
  // the same lockfile already failed, or stayed in the worktree: not retried until it changes
  if (previous?.key === key && ['failed', 'local'].includes(previous.status)) return previous;
  const projectDir = path.join(cacheDir, projectSlug(project));
  const usable = () => keyEntries(projectDir, key).find(entryUsable);

  const link = async (entry, status, extra = {}) => {
    const target = path.join(entry, 'node_modules');
    const current = linkTarget(nm);
    if (current && samePath(current, target)) {
      touch(entry, nm);
      return { status: status === 'hit' ? 'linked' : status, ...base, key, entry, seconds: (Date.now() - t0) / 1000, ...extra };
    }
    if (!clearNodeModules(nm)) return null; // a real folder locked by a program: left alone
    fs.symlinkSync(target, nm, LINK_TYPE);
    touch(entry, nm);
    // #472: the project's "install without scripts" setting runs none of its lifecycle scripts
    const failed = ignoreScripts ? [] : await runLifecycle(workDir, d, { env, signal, log, run });
    return { status, ...base, key, entry, seconds: (Date.now() - t0) / 1000, ...extra, ...(failed.length ? { scripts_failed: failed } : {}) };
  };

  // this folder's own entry, changed by its agent (a package added without a lockfile change):
  // it keeps it; only an emptied one is replaced
  const own = previous?.entry && previous.key === key && entryMeta(previous.entry);
  const current = linkTarget(nm);
  if (own && own.unusable !== EMPTIED && current && samePath(current, path.join(previous.entry, 'node_modules'))) {
    touch(previous.entry, nm);
    return { ...previous, status: 'linked', seconds: (Date.now() - t0) / 1000 };
  }

  let entry = usable();
  if (entry) return (await link(entry, 'hit')) || { status: 'local', ...base, key, reason: `${nm} is a folder in use: kept` };

  let waited = false;
  const release = await acquireLock(path.join(projectDir, `${key}.lock`), {
    waitMs, signal,
    onWait: (held) => { waited = true; log('info', `dependency cache: another run is installing ${key} (pid ${held?.pid}); waiting`); },
  });
  try {
    entry = usable(); // installed by the run we waited for
    if (entry) return (await link(entry, 'hit', { waited })) || { status: 'local', ...base, key, reason: `${nm} is a folder in use: kept` };

    // an incomplete entry (no entry.json: a crash or a cancel) is ours to replace; an unusable
    // one may still be linked by other worktrees: the new install gets the next generation
    const entries = keyEntries(projectDir, key);
    for (const e of entries) if (!entryMeta(e)) fs.rmSync(e, { recursive: true, force: true, maxRetries: 3 });
    const taken = keyEntries(projectDir, key);
    entry = taken.length ? path.join(projectDir, `${key}.${Date.now()}`) : path.join(projectDir, key);

    if (!clearNodeModules(nm)) return { status: 'failed', ...base, key, reason: `${nm} is in use by a program and could not be replaced` };
    const args = installArgs(d, ignoreScripts);
    log('info', `dependency cache: installing ${d.lockfile} (${d.manager} ${args.join(' ')}) for key ${key}`);
    const r = await run(d.manager, args, { cwd: workDir, env, signal });
    if (r.code !== 0) {
      const reason = r.timedOut ? 'the install timed out' : `${d.manager} ${d.args[0]} exited ${r.code ?? '?'}: ${lastLines(r.output)}`;
      return { status: 'failed', ...base, key, reason, seconds: (Date.now() - t0) / 1000 };
    }
    // into the cache: node_modules moves (same volume: a rename), entry.json is written last; a
    // lockfile without dependencies may leave no node_modules: an empty one is cached
    fs.mkdirSync(nm, { recursive: true });
    const sentinel = fs.existsSync(path.join(nm, d.sentinel)) ? d.sentinel : null;
    fs.mkdirSync(entry, { recursive: true });
    try {
      await renameRetry(nm, path.join(entry, 'node_modules'));
    } catch (e) {
      fs.rmSync(entry, { recursive: true, force: true, maxRetries: 3 });
      return { status: 'local', ...base, key, reason: `installed in the worktree; could not move it into the cache (${e.code || e.message})`, seconds: (Date.now() - t0) / 1000 };
    }
    try {
      fs.symlinkSync(path.join(entry, 'node_modules'), nm, LINK_TYPE);
    } catch (e) {
      await renameRetry(path.join(entry, 'node_modules'), nm).catch(() => {});
      fs.rmSync(entry, { recursive: true, force: true, maxRetries: 3 });
      return { status: 'local', ...base, key, reason: `installed in the worktree; could not link the cache (${e.code || e.message})`, seconds: (Date.now() - t0) / 1000 };
    }
    const seconds = (Date.now() - t0) / 1000;
    const now = new Date().toISOString();
    writeJson(path.join(entry, 'entry.json'), {
      key, ...facets, lockfile: d.lockfile, project: projectSlug(project), sentinel,
      sentinel_sha256: sentinel ? fileHash(path.join(entry, 'node_modules', sentinel)) : null,
      bytes: dirBytes(path.join(entry, 'node_modules')), install_seconds: seconds, created_at: now, last_used: now,
    });
    touch(entry, nm);
    return { status: 'miss', ...base, key, entry, seconds, waited };
  } finally {
    release();
  }
}

/**
 * Removes the dependency links under a worktree (its root and subfolders up to `depth`) before the
 * worktree is deleted, so no recursive delete ever follows one into the cache.
 */
function unlinkDeps(dir, depth = 2) {
  const removed = [];
  const walk = (d, level) => {
    const nm = path.join(d, 'node_modules');
    if (linkTarget(nm)) { try { fs.unlinkSync(nm); removed.push(nm); } catch { /* in use */ } }
    if (level >= depth) return;
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(path.join(d, e.name), level + 1);
  };
  walk(dir, 0);
  return removed;
}

// Every entry of the cache: { dir, project, key, meta, linked, bytes, lastUsed, locked }
function listEntries(cacheDir) {
  const out = [];
  let projects = [];
  try { projects = fs.readdirSync(cacheDir, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return []; }
  for (const p of projects) {
    const projectDir = path.join(cacheDir, p.name);
    for (const e of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const dir = path.join(projectDir, e.name);
      const meta = entryMeta(dir);
      const key = e.name.split('.')[0];
      let mtime = 0;
      try { mtime = fs.statSync(dir).mtimeMs; } catch { /* gone */ }
      out.push({
        dir, project: p.name, key, meta, linked: linkedBy(dir), bytes: meta?.bytes || 0,
        lastUsed: meta?.last_used ? Date.parse(meta.last_used) : mtime, locked: fs.existsSync(path.join(projectDir, `${key}.lock`)),
      });
    }
  }
  return out;
}

/** Size of the cache for Settings: { dir, entries, bytes, linked } */
function cacheInfo(cacheDir) {
  const list = listEntries(cacheDir);
  return { dir: cacheDir, entries: list.length, bytes: list.reduce((a, e) => a + e.bytes, 0), linked: list.filter((e) => e.linked.length).length };
}

/**
 * Removes the entries no worktree links and no install holds: unusable or incomplete ones (an
 * incomplete one after a day), those not used for maxAgeDays, then the least recently used until
 * the cache is under maxBytes. maxAgeDays 0: every unlinked entry (Settings › Clear dependency cache).
 * A folder still locked by a program (EBUSY) stays for the next time.
 * @returns {{ removed: string[], freedBytes: number, kept: number }}
 */
function pruneDepsCache({ cacheDir, maxAgeDays = MAX_AGE_DAYS, maxBytes = MAX_BYTES, now = Date.now(), log = () => {} }) {
  const list = listEntries(cacheDir);
  const removed = [];
  let freed = 0;
  const drop = (e, why) => {
    try { fs.rmSync(e.dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* in use */ }
    if (fs.existsSync(e.dir)) return false;
    removed.push(e.dir);
    freed += e.bytes;
    log('info', `dependency cache: removed ${e.project}/${path.basename(e.dir)} (${why})`);
    return true;
  };
  const free = list.filter((e) => !e.linked.length && !e.locked);
  const left = [];
  for (const e of free) {
    const age = now - e.lastUsed;
    if (!e.meta) { if (maxAgeDays === 0 || age > 864e5) drop(e, 'incomplete'); else left.push(e); }
    else if (e.meta.unusable) drop(e, e.meta.unusable);
    else if (age >= maxAgeDays * 864e5) drop(e, maxAgeDays ? `not used for ${maxAgeDays} days` : 'cleared');
    else left.push(e);
  }
  let total = list.filter((e) => !removed.includes(e.dir)).reduce((a, e) => a + e.bytes, 0);
  for (const e of left.filter((x) => x.meta).sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (total <= maxBytes) break;
    if (drop(e, 'over the size cap')) total -= e.bytes;
  }
  return { removed, freedBytes: freed, kept: list.length - removed.length };
}

module.exports = {
  acquireLock,
  cacheInfo,
  cacheKey,
  clearNodeModules,
  detect,
  ensureDeps,
  entryUsable,
  installArgs,
  keyEntries,
  linkedBy,
  linkTarget,
  listEntries,
  MANAGERS,
  markUnusable,
  MAX_AGE_DAYS,
  MAX_BYTES,
  NOT_CACHED,
  projectSlug,
  pruneDepsCache,
  runCommand,
  unlinkDeps,
};
