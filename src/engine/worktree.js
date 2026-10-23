// One git worktree per run (orchestrator.worktree in the YAML).
//
// Every run of a workflow that declares it works in its own checkout,
// <workspace>/worktrees/<run_id>, created detached at the freshly fetched origin/<base>. Runs no
// longer share (and leak) branches, dirty files or a stale local base, and two runs of the same
// repository can go at the same time. The main checkout under <workspace>/repos is only the
// object store: nothing is ever checked out there by a run.
//
// Lifecycle (#202): the branch is the record, the folder is temporary. Created at run start;
// removed when the run succeeds (its local branch too, when it is merged into the base). A run that
// fails, is cancelled or dies keeps its branch, not its folder (retireWorktree): a detached worktree
// gets a branch (run/<run id>), uncommitted changes become a WIP commit naming the run, then the
// folder goes. "Resume from step" recreates the folder from the branch. cleanupWorktrees (at start
// and periodically) does the same for runs that ended in an earlier app session.
// Before each suite and E2E round of a local workflow (#403, syncWithBase), the branch is rebased onto
// the local base when the base moved, so a fix that landed there meanwhile reaches the run.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { unlinkDeps } = require('./deps-cache');
const { ownerAlive, readOwner } = require('../run-owner');
const { samePath: platformSamePath } = require('../platform-paths');

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
      // no stderr: say how it ended (exit code, signal or timeout), not only the command line
      if (err) reject(new Error(`git ${args[0]} failed: ${String(stderr).trim() || `${err.message.trim()} (${err.killed ? 'killed after the timeout' : `exit code ${err.code ?? '?'}${err.signal ? `, signal ${err.signal}` : ''}`})`}`));
      else resolve(String(stdout).trim());
    });
  });
}
const tryGit = (...a) => git(...a).catch(() => null);

/**
 * Canonical form of a path, for comparing (or relativizing) our paths with the ones git prints.
 * The same folder can be spelled many ways: forward slashes (git on Windows), a Windows 8.3
 * short name (os.tmpdir() on the GitHub Windows runner is C:\Users\RUNNER~1\..., git answers
 * C:/Users/runneradmin/...), a symlink or junction (macOS /var -> /private/var). realpath
 * resolves all of them. For a path that does not exist yet, the deepest existing ancestor is
 * resolved and the rest appended.
 */
function canonicalPath(p) {
  const abs = path.resolve(String(p));
  const rest = [];
  for (let cur = abs; ;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs; // nothing exists (e.g. another drive): as given
      rest.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * True when `a` and `b` are the same folder (see canonicalPath), with the app's one rule for case
 * (src/platform-paths.js: case-insensitive on Windows and macOS). On a case-sensitive macOS volume
 * two folders that differ only by case would compare equal; run folders never do.
 */
const samePath = (a, b) => platformSamePath(canonicalPath(a), canonicalPath(b));

/** True when `file` is `root` or inside it, both compared as canonical paths (links resolved, see canonicalPath). */
function isUnder(root, file) {
  const rel = path.relative(canonicalPath(root), canonicalPath(file));
  return !path.isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..';
}

/** Top-level folder (canonical) of the repository that contains `dir`, or null if it is not in a git repository. */
async function repoRoot(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const top = await tryGit(['rev-parse', '--show-toplevel'], dir);
  return top ? canonicalPath(top) : null;
}

/** Registered worktrees of `repo`: [{ dir, branch|null, head }]. */
async function listWorktrees(repo) {
  const out = await tryGit(['worktree', 'list', '--porcelain'], repo);
  if (!out) return [];
  return out.split(/\n\s*\n/).map((block) => {
    const get = (k) => block.split('\n').find((l) => l.startsWith(`${k} `))?.slice(k.length + 1) || null;
    const ref = get('branch');
    return { dir: canonicalPath(get('worktree') || ''), head: get('HEAD'), branch: ref ? ref.replace(/^refs\/heads\//, '') : null };
  });
}

const isWorktree = async (repo, dir) => fs.existsSync(dir) && (await listWorktrees(repo)).some((w) => samePath(w.dir, dir));
const refExists = async (repo, ref) => !!(await tryGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo));

/**
 * Fetches origin/<base> (a missing remote or no network only warns) and picks the start point:
 * origin/<base>, else the local <base>, else the repository's HEAD.
 */
async function baseRef(repo, base, log = () => {}, { remote = true } = {}) {
  // local workflows (orchestrator.worktree.remote: false) start from the local branch: it may
  // hold local merges that were never pushed, and nothing is fetched
  if (base && !remote) {
    if (await refExists(repo, `refs/heads/${base}`)) return base;
    log('warn', `worktree: local branch "${base}" not found, starting from the repository's HEAD`);
    return 'HEAD';
  }
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
 * @param {boolean} [o.remote] false: start from the local base, without fetching origin
 * @returns {Promise<object|null>} { dir, workDir, repo, base, remote, ref, commit, reused, recreated } or
 *   null when `repo` is not a git repository (the caller then works in the repository folder).
 */
async function prepareWorktree({ repo, base, dir, branch = null, log = () => {}, remote = true }) {
  const root = await repoRoot(repo);
  if (!root) return null;
  // canonical on both sides: a relative path between a short (8.3) or symlinked spelling and
  // git's long one would climb out of the repository
  dir = canonicalPath(dir);
  // repo_path may point to a subfolder of the repository: keep the same subfolder in the worktree
  const workDir = (d) => path.join(d, path.relative(root, canonicalPath(repo)));
  await tryGit(['worktree', 'prune'], root); // forget worktrees whose folder is gone
  const info = { dir, workDir: workDir(dir), repo: root, base: base || null, remote, reused: false, recreated: false };

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
      info.ref = await baseRef(root, base, log, { remote });
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
  // throwaway commit (no ref points at it): its own identity, so a machine without
  // user.name/user.email configured (e.g. CI) can still run the check
  const squash = await tryGit(['-c', 'user.name=multiagent', '-c', 'user.email=multiagent@localhost', 'commit-tree', `${branch}^{tree}`, '-p', mb, '-m', 'squash check'], repo);
  const cherry = squash && await tryGit(['cherry', base, squash], repo);
  return !!cherry && cherry.startsWith('-');
}

/**
 * Removes the worktree (uncommitted changes included) and deletes its local branch if it is
 * merged into origin/<base> (fetched first) or the local <base>. An unmerged branch is kept.
 * @returns {Promise<{ removed: boolean, branch: string|null, branchDeleted: boolean }>}
 */
async function removeWorktree({ repo, dir, base, log = () => {}, remote = true }) {
  dir = canonicalPath(dir); // the spelling git registered the worktree with
  const branch = fs.existsSync(dir) ? await currentBranch(dir) : null;
  // the shared dependency cache (#198): its links go first, so no delete below ever follows one
  unlinkDeps(dir);
  await git(['worktree', 'remove', '--force', dir], repo).catch((e) => {
    // not registered any more (or locked by a process): delete the folder itself
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* in use: kept */ }
    log('warn', `worktree: ${e.message.split('\n')[0]}`);
  });
  await tryGit(['worktree', 'prune'], repo);
  let branchDeleted = false;
  if (branch) {
    // local workflows merge into the local base (see mergeLocally): compare with it, not origin
    if (base && remote) await tryGit(['fetch', 'origin', base], repo, { timeout: FETCH_TIMEOUT_MS, auth: true });
    const into = base && remote && (await refExists(repo, `origin/${base}`)) ? `origin/${base}` : base;
    if (into && await isMerged(repo, branch, into)) {
      branchDeleted = !!(await tryGit(['branch', '-D', branch], repo));
    } else {
      log('info', `worktree: branch ${branch} is not merged into ${into || 'the base'}; kept`);
    }
  }
  return { removed: !fs.existsSync(dir), branch, branchDeleted };
}

// The subject of the commit that keeps an ended run's uncommitted work (a resume restores it).
const WIP_SUBJECT = 'WIP: uncommitted work of run';
const wipMessage = (runId) => `${WIP_SUBJECT} ${runId}\n\nSaved by the orchestrator when the run ended without success, before its worktree folder was removed. Resume from step restores it as uncommitted work.`;

/**
 * Keeps an ended run's work on its branch (#202): a detached worktree gets a branch first
 * (run/<run id>), then any uncommitted change becomes one WIP commit naming the run.
 * @returns {Promise<{ branch: string, wipCommit: string|null }>}
 */
async function saveWork({ dir, runId }) {
  let branch = await currentBranch(dir);
  if (!branch) {
    branch = `run/${runId}`;
    if (await refExists(dir, `refs/heads/${branch}`)) branch = `${branch}-${Date.now().toString(36)}`;
    await git(['switch', '-q', '-c', branch], dir);
  }
  unlinkDeps(dir); // the shared dependency cache's links are never committed
  if (!(await git(['status', '--porcelain'], dir))) return { branch, wipCommit: null };
  await git(['add', '-A'], dir);
  await git([...(await identityArgs(dir)), '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', wipMessage(runId)], dir);
  return { branch, wipCommit: await git(['rev-parse', 'HEAD'], dir) };
}

/**
 * An ended run without success (#202): its work goes to its branch (saveWork), then its folder is
 * removed; the branch is never deleted. A folder that cannot be committed is kept (nothing is lost).
 * @returns {Promise<{ removed: boolean, branch: string, wipCommit: string|null }>}
 */
async function retireWorktree({ repo, dir, runId, log = () => {} }) {
  dir = canonicalPath(dir);
  const { branch, wipCommit } = await saveWork({ dir, runId });
  if (wipCommit) log('info', `worktree: uncommitted work saved as ${wipCommit.slice(0, 8)} on ${branch}`);
  const r = await removeWorktree({ repo, dir, log });
  return { removed: r.removed, branch, wipCommit };
}

/**
 * Resume (#202): a worktree recreated from a branch whose tip is a WIP commit gets that work back
 * as uncommitted (staged) changes. true when it did.
 */
async function restoreWork(dir) {
  const subject = await tryGit(['log', '-1', '--format=%s'], dir);
  if (!subject || !subject.startsWith(`${WIP_SUBJECT} `)) return false;
  return (await tryGit(['reset', '-q', '--soft', 'HEAD~1'], dir)) !== null;
}

/**
 * The run's checkout of the base (#198), for the test writer's pre-existing-failure check:
 * <worktreesDir>/<run_id>-base, detached at the current base (refreshed when reused, since the
 * local base moves with local merges). Never a branch; removed with the run's worktree.
 * @returns {Promise<object|null>} as prepareWorktree; null when `repo` is not a git repository
 */
async function prepareBaseWorktree({ repo, base, dir, log = () => {}, remote = true }) {
  const info = await prepareWorktree({ repo, base, dir, log, remote });
  if (info?.reused) {
    info.ref = await baseRef(info.repo, base, log, { remote });
    await git(['checkout', '--detach', '--force', info.ref], info.dir);
    info.commit = await tryGit(['rev-parse', 'HEAD'], info.dir);
  }
  return info;
}

// Committer identity for the rebase below: the user's own when git has one, otherwise a fixed
// one (a machine or CI with no user.name/email must not make the merge fail).
async function identityArgs(repo) {
  const email = await tryGit(['config', 'user.email'], repo);
  return email ? [] : ['-c', 'user.name=Multiagent Orchestrator', '-c', 'user.email=orchestrator@localhost'];
}

// A rebase stopped half-way (a conflict) leaves one of these folders in the worktree's git dir
async function rebaseInProgress(dir) {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const p = await tryGit(['rev-parse', '--git-path', name], dir);
    if (p && fs.existsSync(path.resolve(dir, p))) return true;
  }
  return false;
}

// Rebases the worktree's HEAD onto <ref> (mergeLocally, syncWithBase #403). A failure lists the
// unmerged files (none: not a conflict) and aborts a rebase left in progress → { ok, files, error
// (git's first line), aborted (false: the worktree is still mid-rebase) }
async function rebaseOnto(dir, ref, root) {
  try {
    await git([...(await identityArgs(root)), 'rebase', ref], dir);
    return { ok: true, files: [], error: null, aborted: true };
  } catch (e) {
    const files = String(await tryGit(['diff', '--name-only', '--diff-filter=U'], dir) || '').split('\n').filter(Boolean);
    if (await rebaseInProgress(dir)) await tryGit(['rebase', '--abort'], dir);
    return { ok: false, files, error: String(e.message).split('\n')[0], aborted: !(await rebaseInProgress(dir)) };
  }
}

/**
 * Merges the run's branch into the local base branch, without GitHub/GitLab and without pushing
 * (orchestrator.worktree.remote: false + a transition with `merge: local`).
 *   1. the run's worktree must be on a branch with everything committed;
 *   2. the branch is rebased onto the local base when the base moved (another local merge); a
 *      conflict aborts the rebase and fails with the conflicting files, leaving the branch as it was;
 *   3. the base is fast-forwarded to the branch: with `git merge --ff-only` in the worktree where
 *      the base is checked out (refused when that checkout has uncommitted changes to tracked
 *      files), or by moving the ref (compare-and-swap) when it is checked out nowhere.
 * History stays linear and nothing else is touched: no push, no fetch.
 * @returns {Promise<{ branch, base, commit, checkout, rebased }>}
 */
async function mergeLocally({ repo, dir, base, log = () => {} }) {
  const root = await repoRoot(repo);
  if (!root) throw new Error(`local merge: ${repo} is not a git repository.`);
  if (!base || !(await refExists(root, `refs/heads/${base}`))) throw new Error(`local merge: the local branch "${base}" does not exist.`);
  const branch = await currentBranch(dir);
  if (!branch) throw new Error('local merge: the run\'s worktree is not on a branch (detached HEAD): nothing to merge.');
  if (branch === base) throw new Error(`local merge: the run's worktree is on ${base} itself.`);
  if (await tryGit(['status', '--porcelain', '--untracked-files=no'], dir)) {
    throw new Error(`local merge: the run's worktree has uncommitted changes on ${branch}; commit them first.`);
  }
  let rebased = false;
  if (!(await git(['merge-base', '--is-ancestor', base, branch], root).then(() => true, () => false))) {
    log('info', `local merge: ${base} moved since ${branch} started; rebasing ${branch} onto it`);
    const r = await rebaseOnto(dir, base, root);
    if (!r.ok) {
      const list = r.files;
      throw new Error(`local merge: ${branch} conflicts with the local ${base}${list.length ? ` in ${list.join(', ')}` : ''}. The branch was left as it was; resolve the conflict on it and merge again.`);
    }
    rebased = true;
  }
  const commit = await git(['rev-parse', `refs/heads/${branch}`], root);
  const checkout = (await listWorktrees(root)).find((w) => w.branch === base);
  if (checkout) {
    if (await tryGit(['status', '--porcelain', '--untracked-files=no'], checkout.dir)) {
      throw new Error(`local merge: ${checkout.dir} has uncommitted changes on ${base}; commit or stash them, then merge again.`);
    }
    await git(['merge', '--ff-only', branch], checkout.dir);
  } else {
    const old = await git(['rev-parse', `refs/heads/${base}`], root);
    await git(['update-ref', `refs/heads/${base}`, commit, old], root);
  }
  log('info', `local merge: ${base} fast-forwarded to ${branch} (${commit.slice(0, 8)})${checkout ? ` in ${checkout.dir}` : ''}; nothing pushed`);
  return { branch, base, commit, checkout: checkout?.dir || null, rebased };
}

/**
 * Brings the local base into the run's branch before a suite or E2E round (#403): when the local
 * <base> moved past the branch's fork point, the worktree's HEAD (its branch, or the detached HEAD)
 * is rebased onto it, as mergeLocally does at the end. A conflict aborts the rebase and leaves the
 * branch as it was; uncommitted changes to tracked files or a rebase that fails for another reason (a
 * locked file, a hook) skip it; a rebase that cannot be aborted is `blocked` (a half-rebased tree is
 * never tested). The base is never modified, nothing is fetched or pushed.
 * @returns {Promise<object|null>} null without a git repository or a local base; else { moved,
 *   conflict, files, skipped, blocked, base, base_commit (the base commit the HEAD now sits on), from, to,
 *   count, commits: ['<sha> <subject>', ...] (the base commits brought in, or that did not apply) }
 */
async function syncWithBase({ repo, dir, base }) {
  const root = await repoRoot(repo);
  const ref = `refs/heads/${base}`;
  if (!root || !base || !(await refExists(root, ref))) return null;
  const from = await git(['rev-parse', 'HEAD'], dir);
  const tip = await git(['rev-parse', ref], root);
  const result = { moved: false, conflict: false, files: [], skipped: null, blocked: null, base, base_commit: tip, from, to: from, count: 0, commits: [] };
  if ((await currentBranch(dir)) === base) return result;
  if (await git(['merge-base', '--is-ancestor', ref, 'HEAD'], dir).then(() => true, () => false)) return result;
  result.base_commit = await tryGit(['merge-base', ref, 'HEAD'], dir);
  result.count = Number(await tryGit(['rev-list', '--count', `HEAD..${ref}`], dir)) || 0;
  result.commits = String(await tryGit(['log', '--max-count=10', '--format=%h %s', `HEAD..${ref}`], dir) || '').split('\n').filter(Boolean);
  if (await tryGit(['status', '--porcelain', '--untracked-files=no'], dir)) {
    result.skipped = 'the worktree has uncommitted changes';
    return result;
  }
  const r = await rebaseOnto(dir, ref, root);
  if (!r.ok) {
    if (!r.aborted) result.blocked = `the rebase onto ${base} failed (${r.error}) and could not be aborted: the worktree ${dir} is mid-rebase; run \`git rebase --abort\` there, then resume`;
    else if (r.files.length) { result.conflict = true; result.files = r.files; }
    else result.skipped = `the rebase failed: ${r.error}`;
    return result;
  }
  result.moved = true;
  result.base_commit = tip;
  result.to = await git(['rev-parse', 'HEAD'], dir);
  return result;
}

// The run's scratch workspace (<run>/scratch, #120) goes with its worktree; the run's logs/ and
// evidence/ (its screenshots, #146) stay. A folder still locked (a program left running) is left for the
// next cleanup. true when it was removed.
function removeScratch(runDir) {
  const dir = path.join(runDir, 'scratch');
  if (!fs.existsSync(dir)) return false;
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); return true; } catch { return false; }
}

// The run's temp folder (<run>/tmp, TMP/TEMP/TMPDIR of its processes, #414) goes when the run ends,
// like its scratch workspace. A folder still locked is left for the next cleanup. true when removed.
function removeRunTmp(runDir) {
  const dir = path.join(runDir, 'tmp');
  if (!fs.existsSync(dir)) return false;
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); return true; } catch { return false; }
}

// A folder younger than this that git does not know may be a worktree being created right now.
const ORPHAN_AGE_MS = 3600e3;
// How long the scratch workspace of an ended run without a worktree folder stays (#201).
const SCRATCH_DAYS = 3;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

// A human gate asked and never answered (approval.requested without approval.resolved).
function openGate(runDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'); } catch { return false; }
  const open = new Set();
  for (const line of text.split('\n')) {
    if (!line.includes('"approval.')) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'approval.requested') open.add(ev.approval_id);
      else if (ev.type === 'approval.resolved') open.delete(ev.approval_id);
    } catch { /* a line being written */ }
  }
  return open.size > 0;
}

// What the cleanup may do with a run folder: { exists, live, endedAt, status }. live: no summary.json and
// either an owner process alive (this one or another app process, #112) or a human gate waiting; or a
// run that ended paused (#368): Resume continues in its folder, so it stays as it is.
function runState(runDir) {
  if (!fs.existsSync(runDir)) return { exists: false, live: false, endedAt: 0 };
  const summary = readJson(path.join(runDir, 'summary.json'));
  const endedAt = Date.parse(summary?.finished_at || '') || mtime(path.join(runDir, 'events.jsonl'));
  if (summary) return { exists: true, live: summary.status === 'paused', endedAt, status: summary.status || null };
  return { exists: true, live: ownerAlive(readOwner(runDir)) || openGate(runDir), endedAt, status: null };
}

// The worktree folders live runs work in (their worktree.ready events), whatever the folder's name:
// a resumed run reuses the folder named after the run it resumes, whose own run folder has ended
// (claimed from its workflow.started already, before its worktree.ready).
function liveWorktrees(runsDir, worktreesDir) {
  return worktreeRuns(runsDir, worktreesDir, { liveOnly: true }).flatMap((r) => r.dirs);
}

// #406: the worktree folders each run works or worked in, [{ runId, dirs, live }] (live as in
// liveWorktrees). A run without summary.json from its events, an ended one from its summary. `since`:
// only the runs whose id (it starts with the run's start time) is not older; `liveOnly`: live runs only.
// An ended run's dirs are cached by its summary.json path and mtime (the stray check reads them every minute).
const endedDirs = new Map();
function worktreeRuns(runsDir, worktreesDir, { since = '', liveOnly = false } = {}) {
  let names = [];
  try { names = fs.readdirSync(runsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name >= since).map((d) => d.name); } catch { names = []; }
  const resumedDir = (from) => from?.run_id && path.join(worktreesDir, String(from.run_id));
  const runs = [];
  for (const name of names) {
    const runDir = path.join(runsDir, name);
    const summaryFile = path.join(runDir, 'summary.json');
    if (fs.existsSync(summaryFile)) {
      if (liveOnly) continue;
      const at = mtime(summaryFile);
      let cached = endedDirs.get(summaryFile);
      if (!cached || cached.at !== at) {
        const summary = readJson(summaryFile);
        // the engine's summary has no resumed_from: a resumed run's worktree.dir is the reused folder
        cached = { at, dirs: [summary?.worktree?.dir, summary?.worktree?.work_dir].filter(Boolean) };
        endedDirs.set(summaryFile, cached);
      }
      runs.push({ runId: name, live: false, dirs: cached.dirs });
      continue;
    }
    const live = runState(runDir).live;
    if (liveOnly && !live) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'); } catch { continue; }
    const dirs = [];
    for (const line of text.split('\n')) {
      if (!line.includes('"worktree.ready"') && !line.includes('"resumed_from"')) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'worktree.ready') dirs.push(ev.dir, ev.work_dir);
        else if (ev.type === 'workflow.started') dirs.push(resumedDir(ev.resumed_from));
      } catch { /* a line being written */ }
    }
    runs.push({ runId: name, live, dirs: dirs.filter(Boolean) });
  }
  return runs;
}

// Records a worktree the cleanup removed in its run (events.jsonl, and summary.json when there).
function recordRemoved(runDir, { dir, branch, wipCommit }) {
  try {
    fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), type: 'worktree.removed', dir, removed: true, branch, branch_deleted: false, wip_commit: wipCommit, by: 'cleanup' }) + '\n');
    const file = path.join(runDir, 'summary.json');
    const summary = readJson(file);
    if (summary?.worktree) fs.writeFileSync(file, JSON.stringify({ ...summary, worktree: { ...summary.worktree, branch, removed: true } }, null, 2));
  } catch { /* the run folder went away */ }
}

/**
 * Cleanup of <workspace>/worktrees and of the runs' scratch workspaces, at app start and then
 * periodically (#202, #201). Never touches `active` folders (runs of this process: a list, or a
 * function re-read before each folder since a run may start during the pass), nor the folder of a
 * run live in another app process or waiting at a human gate (by name, or named in its
 * worktree.ready: a resumed run works in the folder of the run it resumes). The worktree of any other run (succeeded,
 * failed, cancelled, interrupted) goes, its work kept on its branch (retireWorktree); the branch is
 * never deleted here. Folders git does not know (e.g. shots-*) go once older than an hour. A folder
 * a process still holds (EBUSY) stays for the next cleanup. The scratch and the temp folder (#414)
 * of an ended run go with its worktree, or `scratchDays` after the run ended without a worktree folder.
 * @returns {Promise<string[]>} removed folders
 */
async function cleanupWorktrees({ worktreesDir, runsDir, active = [], scratchDays = SCRATCH_DAYS, log = () => {} }) {
  let names = [];
  try { names = fs.readdirSync(worktreesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { names = []; }
  const removed = [];
  for (const name of names) {
    const dir = path.join(worktreesDir, name);
    const inUse = [...(typeof active === 'function' ? active() : active), ...liveWorktrees(runsDir, worktreesDir)];
    if (inUse.some((a) => a && samePath(a, dir))) continue;
    // <run_id>-base: the run's checkout of the base (#198), gone once its run is not live
    const baseOf = name.endsWith('-base') ? name.slice(0, -5) : null;
    const runDir = path.join(runsDir, baseOf || name);
    const run = runState(runDir);
    if (run.live) continue;
    const common = await tryGit(['rev-parse', '--git-common-dir'], dir);
    const repo = common && canonicalPath(path.dirname(path.resolve(dir, common)));
    const young = Date.now() - Math.max(mtime(path.join(runDir, 'events.jsonl')), mtime(dir)) < ORPHAN_AGE_MS;
    try {
      if (!repo || !(await isWorktree(repo, dir))) {
        if (young) continue; // may be a worktree being created right now
        unlinkDeps(dir);
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      } else if (baseOf || run.status === 'success') {
        // a base checkout, or a succeeded run whose removal failed: nothing of its own to keep
        await removeWorktree({ repo, dir, log });
      } else {
        if (!run.exists && young) continue; // no run folder yet: may be a run starting
        const r = await retireWorktree({ repo, dir, runId: name, log });
        if (r.removed && run.exists) recordRemoved(runDir, { dir: canonicalPath(dir), branch: r.branch, wipCommit: r.wipCommit });
      }
    } catch (e) {
      log('warn', `worktree: could not clean up ${dir}: ${e.message.split('\n')[0]}`);
    }
    if (fs.existsSync(dir)) continue; // locked by a process: the worktree and its scratch stay for the next cleanup
    if (!baseOf) {
      removeScratch(runDir);
      removeRunTmp(runDir);
    }
    removed.push(dir);
    log('info', `worktree: removed ${dir}`);
  }
  removeEndedRunFolders({ worktreesDir, runsDir, scratchDays, log });
  return removed;
}

// #201, #414: the scratch workspace and the temp folder of an ended run whose worktree folder is
// already gone, `scratchDays` after it ended (a live run or one waiting at a gate keeps them).
function removeEndedRunFolders({ worktreesDir, runsDir, scratchDays, log }) {
  let runNames = [];
  try { runNames = fs.readdirSync(runsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { runNames = []; }
  for (const name of runNames) {
    const runDir = path.join(runsDir, name);
    const left = ['scratch', 'tmp'].some((d) => fs.existsSync(path.join(runDir, d)));
    if (!left || fs.existsSync(path.join(worktreesDir, name))) continue;
    const run = runState(runDir);
    if (run.live || Date.now() - run.endedAt < scratchDays * 864e5) continue;
    if (removeScratch(runDir)) log('info', `worktree: removed the scratch workspace of ended run ${name}`);
    if (removeRunTmp(runDir)) log('info', `worktree: removed the temp folder of ended run ${name}`);
  }
}

module.exports = {
  prepareWorktree, removeWorktree, mergeLocally, cleanupWorktrees, listWorktrees, isMerged, repoRoot, currentBranch, samePath, canonicalPath,
  git, identityArgs, FETCH_TIMEOUT_MS,
  isUnder,
  prepareBaseWorktree,
  removeRunTmp,
  removeScratch,
  restoreWork,
  retireWorktree,
  syncWithBase,
  worktreeRuns,
};
