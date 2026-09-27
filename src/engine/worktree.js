// One git worktree per run (orchestrator.worktree in the YAML).
//
// Every run of a workflow that declares it works in its own checkout,
// <workspace>/worktrees/<run_id>, created detached at the freshly fetched origin/<base>. Runs no
// longer share (and leak) branches, dirty files or a stale local base, and two runs of the same
// repository can go at the same time. The main checkout under <workspace>/repos is only the
// object store: nothing is ever checked out there by a run.
//
// Lifecycle: created at run start; removed when the run succeeds (its local branch too, when it
// is merged into the base); kept when the run fails, is cancelled or dies, so "resume from step"
// can continue in the same folder (recreated from the run's branch if it was deleted).

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const FETCH_TIMEOUT_MS = 60e3;
const GIT_TIMEOUT_MS = 120e3;

// Credential helper args for private GitHub repositories over https (gh auth), as for cloning.
function authArgs() {
  try { return require('../workspace').gitAuthArgs(); } catch { return []; }
}

function git(args, cwd, { timeout = GIT_TIMEOUT_MS, auth = false } = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  return new Promise((resolve, reject) => {
    execFile('git', [...(auth ? authArgs() : []), ...args], { cwd, env, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]} failed: ${String(stderr || err.message).trim()}`));
      else resolve(String(stdout).trim());
    });
  });
}
const tryGit = (...a) => git(...a).catch(() => null);

// Paths from git use forward slashes; Windows paths are case-insensitive.
const samePath = (a, b) => {
  const n = (p) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

/** Top-level folder of the repository that contains `dir`, or null if it is not in a git repository. */
async function repoRoot(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const top = await tryGit(['rev-parse', '--show-toplevel'], dir);
  return top ? path.resolve(top) : null;
}

/** Registered worktrees of `repo`: [{ dir, branch|null, head }]. */
async function listWorktrees(repo) {
  const out = await tryGit(['worktree', 'list', '--porcelain'], repo);
  if (!out) return [];
  return out.split(/\n\s*\n/).map((block) => {
    const get = (k) => block.split('\n').find((l) => l.startsWith(`${k} `))?.slice(k.length + 1) || null;
    const ref = get('branch');
    return { dir: path.resolve(get('worktree') || ''), head: get('HEAD'), branch: ref ? ref.replace(/^refs\/heads\//, '') : null };
  });
}

const isWorktree = async (repo, dir) => fs.existsSync(dir) && (await listWorktrees(repo)).some((w) => samePath(w.dir, dir));
const refExists = async (repo, ref) => !!(await tryGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo));

/**
 * Fetches origin/<base> (a missing remote or no network only warns) and picks the start point:
 * origin/<base>, else the local <base>, else the repository's HEAD.
 */
async function baseRef(repo, base, log = () => {}) {
  if (base) {
    try {
      await git(['fetch', 'origin', base], repo, { timeout: FETCH_TIMEOUT_MS, auth: true });
    } catch (e) {
      log('warn', `worktree: could not fetch origin/${base}, using what is available locally (${e.message.split('\n')[0]})`);
    }
    if (await refExists(repo, `origin/${base}`)) return `origin/${base}`;
    if (await refExists(repo, base)) {
      log('warn', `worktree: origin/${base} not found, starting from the local ${base}`);
      return base;
    }
    log('warn', `worktree: base "${base}" not found, starting from the repository's HEAD`);
  }
  return 'HEAD';
}

/**
 * Creates (or, when resuming, reuses/recreates) the run's worktree.
 * @param {object} o
 * @param {string} o.repo    repository folder (a subfolder of a repository also works)
 * @param {string} o.base    base branch (fetched from origin)
 * @param {string} o.dir     worktree folder, e.g. <workspace>/worktrees/<run_id>
 * @param {string} [o.branch] resume: the previous run's branch, used if the folder has to be recreated
 * @param {Function} [o.log] (level, message)
 * @returns {Promise<object|null>} { dir, workDir, repo, base, ref, commit, reused, recreated } or
 *   null when `repo` is not a git repository (the caller then works in the repository folder).
 */
async function prepareWorktree({ repo, base, dir, branch = null, log = () => {} }) {
  const root = await repoRoot(repo);
  if (!root) return null;
  dir = path.resolve(dir);
  // repo_path may point to a subfolder of the repository: keep the same subfolder in the worktree
  const workDir = (d) => path.join(d, path.relative(root, path.resolve(repo)));
  await tryGit(['worktree', 'prune'], root); // forget worktrees whose folder is gone
  const info = { dir, workDir: workDir(dir), repo: root, base: base || null, reused: false, recreated: false };

  if (await isWorktree(root, dir)) {
    info.reused = true;
    info.ref = (await listWorktrees(root)).find((w) => samePath(w.dir, dir))?.branch || null;
  } else {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`worktree: ${dir} exists and is not a worktree of ${root}.`);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    if (branch && await refExists(root, `refs/heads/${branch}`)) {
      // resume: back to the previous run's branch; detached if it is checked out somewhere else
      const other = (await listWorktrees(root)).find((w) => w.branch === branch);
      await git(['worktree', 'add', ...(other ? ['--detach'] : []), dir, branch], root);
      if (other) log('warn', `worktree: branch ${branch} is checked out at ${other.dir}; the recreated worktree is detached at it`);
      info.ref = branch;
      info.recreated = true;
    } else {
      info.ref = await baseRef(root, base, log);
      await git(['worktree', 'add', '--detach', dir, info.ref], root);
      info.recreated = !!branch;
    }
  }
  info.commit = await tryGit(['rev-parse', 'HEAD'], dir);
  return info;
}

/** Branch checked out in the worktree (null when detached). */
const currentBranch = (dir) => tryGit(['symbolic-ref', '--short', '-q', 'HEAD'], dir);

/**
 * True when `branch` is in `base`: an ancestor (merge / rebase / fast-forward) or its whole diff
 * is already there as one commit (squash merge: `git cherry` against a synthetic squash commit).
 */
async function isMerged(repo, branch, base) {
  if (!(await refExists(repo, branch)) || !(await refExists(repo, base))) return false;
  if (await git(['merge-base', '--is-ancestor', branch, base], repo).then(() => true, () => false)) return true;
  const mb = await tryGit(['merge-base', base, branch], repo);
  if (!mb) return false;
  const squash = await tryGit(['commit-tree', `${branch}^{tree}`, '-p', mb, '-m', 'squash check'], repo);
  const cherry = squash && await tryGit(['cherry', base, squash], repo);
  return !!cherry && cherry.startsWith('-');
}

/**
 * Removes the worktree (uncommitted changes included) and deletes its local branch if it is
 * merged into origin/<base> (fetched first) or the local <base>. An unmerged branch is kept.
 * @returns {Promise<{ removed: boolean, branch: string|null, branchDeleted: boolean }>}
 */
async function removeWorktree({ repo, dir, base, log = () => {} }) {
  const branch = fs.existsSync(dir) ? await currentBranch(dir) : null;
  await git(['worktree', 'remove', '--force', dir], repo).catch((e) => {
    // not registered any more (or locked by a process): delete the folder itself
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* in use: kept */ }
    log('warn', `worktree: ${e.message.split('\n')[0]}`);
  });
  await tryGit(['worktree', 'prune'], repo);
  let branchDeleted = false;
  if (branch) {
    if (base) await tryGit(['fetch', 'origin', base], repo, { timeout: FETCH_TIMEOUT_MS, auth: true });
    const into = base && (await refExists(repo, `origin/${base}`)) ? `origin/${base}` : base;
    if (into && await isMerged(repo, branch, into)) {
      branchDeleted = !!(await tryGit(['branch', '-D', branch], repo));
    } else {
      log('info', `worktree: branch ${branch} is not merged into ${into || 'the base'}; kept`);
    }
  }
  return { removed: !fs.existsSync(dir), branch, branchDeleted };
}

/**
 * Orphan cleanup for <workspace>/worktrees (at app start). Never touches `active` folders
 * (runs in progress). Removes a worktree when its run succeeded (a removal that failed) or when
 * neither the run nor the worktree changed for `maxAgeDays`; failed runs are kept until then
 * so they can be resumed. Folders that are no longer worktrees are deleted.
 * @returns {Promise<string[]>} removed folders
 */
async function cleanupWorktrees({ worktreesDir, runsDir, active = [], maxAgeDays = 14, log = () => {} }) {
  let names = [];
  try { names = fs.readdirSync(worktreesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  const removed = [];
  const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  for (const name of names) {
    const dir = path.join(worktreesDir, name);
    if (active.some((a) => a && samePath(a, dir))) continue;
    const common = await tryGit(['rev-parse', '--git-common-dir'], dir);
    const repo = common && path.dirname(path.resolve(dir, common));
    let status = null;
    try { status = JSON.parse(fs.readFileSync(path.join(runsDir, name, 'summary.json'), 'utf8')).status; } catch { /* running, interrupted or gone */ }
    const index = repo && await tryGit(['rev-parse', '--git-path', 'index'], dir);
    const lastUsed = Math.max(mtime(path.join(runsDir, name, 'events.jsonl')), index ? mtime(path.resolve(dir, index)) : 0, mtime(dir));
    const stale = Date.now() - lastUsed > maxAgeDays * 864e5;
    if (!repo || !(await isWorktree(repo, dir))) {
      if (!stale) continue; // may be a worktree being created right now
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } else if (status === 'success' || stale) {
      await removeWorktree({ repo, dir, log });
    } else continue;
    removed.push(dir);
    log('info', `worktree: removed orphan ${dir}`);
  }
  return removed;
}

module.exports = { prepareWorktree, removeWorktree, cleanupWorktrees, listWorktrees, isMerged, repoRoot, currentBranch, samePath };
