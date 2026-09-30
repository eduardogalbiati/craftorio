// Local merges waiting to be pushed (software-development-local-hero, issue #89).
//
// A local workflow merges its branch into the LOCAL <base> of the project's repository and never
// pushes (see mergeLocally in src/engine/worktree.js). Its commits end with "Closes #n", so the
// issues only close on GitHub/GitLab once <base> is pushed. This module tells what is waiting
// (the commits on <base> that are not on origin/<base>, and the issues they close) and pushes it:
//   - pushBase: `git push origin <base>:<base>`; never forced, never another branch;
//   - updateAndPush: when the push is rejected (origin/<base> moved), `git pull --rebase origin
//     <base>` where <base> is checked out (a temporary worktree when it is checked out nowhere),
//     then the push. A conflict aborts the rebase: <base> is left exactly as it was, nothing is lost.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { git, identityArgs, listWorktrees, repoRoot, FETCH_TIMEOUT_MS } = require('./engine/worktree');
const { referencedIssues } = require('./backlog');

const PUSH_TIMEOUT_MS = 120e3;
const tryGit = (...a) => git(...a).catch(() => null);
const refExists = async (repo, ref) => !!(await tryGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo));
const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';

// The repository's default branch: origin/HEAD, else the branch checked out, else main.
async function defaultBase(repo) {
  const head = await tryGit(['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'], repo);
  if (head) return head.replace(/^origin\//, '');
  return (await tryGit(['symbolic-ref', '--short', '-q', 'HEAD'], repo)) || 'main';
}

/** The issues a commit message closes: "Closes #12", "Fixes #3, #4" (closing keywords only). */
const closedIssues = (message) => referencedIssues({ body: message });

/**
 * What the local <base> has that origin/<base> has not.
 * @param {{ repo: string, base?: string, fetch?: boolean }} o fetch: false reads the last fetch (no network)
 * @returns {Promise<{ repo, base, ahead, behind, commits: { sha, subject, issues }[], issues: number[],
 *   fetchError: string|null, error: string|null, checkedAt: string }>}
 */
async function localStatus({ repo, base = null, fetch = true }) {
  const root = await repoRoot(repo);
  if (!root) throw new Error(`${repo || '(no folder)'} is not a git repository.`);
  base = base || await defaultBase(root);
  const out = { repo: root, base, ahead: 0, behind: 0, commits: [], issues: [], fetchError: null, error: null, checkedAt: new Date().toISOString() };
  if (fetch) {
    await git(['fetch', 'origin', base], root, { timeout: FETCH_TIMEOUT_MS, auth: true })
      .catch((e) => { out.fetchError = firstLine(e.message); });
  }
  if (!(await refExists(root, `refs/heads/${base}`))) return { ...out, error: `The local branch ${base} does not exist.` };
  if (!(await refExists(root, `refs/remotes/origin/${base}`))) return { ...out, error: `origin/${base} not found: nothing to compare the local ${base} with.` };
  const range = `refs/remotes/origin/${base}..refs/heads/${base}`;
  const log = await git(['log', '--format=%H%x1f%s%x1f%B%x1e', range], root);
  out.commits = log.split('\x1e').map((c) => c.trim()).filter(Boolean).map((c) => {
    const [sha, subject, message] = c.split('\x1f');
    return { sha, subject, issues: closedIssues(message) };
  });
  out.ahead = out.commits.length;
  out.issues = [...new Set(out.commits.flatMap((c) => c.issues))].sort((a, b) => a - b);
  out.behind = Number(await git(['rev-list', '--count', `refs/heads/${base}..refs/remotes/origin/${base}`], root)) || 0;
  return out;
}

const REJECTED = /\[rejected\]|\[remote rejected\]|non-fast-forward|fetch first|stale info/i;

/**
 * Pushes the local <base> to origin/<base> (fetched first, to report what goes).
 * @returns {Promise<{ pushed: boolean, rejected?: boolean, error?: string, commits, issues, status }>}
 *   rejected: origin/<base> has commits the local <base> has not (see updateAndPush).
 */
async function pushBase({ repo, base = null }) {
  const before = await localStatus({ repo, base });
  const { commits, issues } = before;
  if (before.error) throw new Error(before.error);
  if (!commits.length) return { pushed: false, commits, issues, status: before };
  try {
    await git(['push', 'origin', `refs/heads/${before.base}:refs/heads/${before.base}`], before.repo, { timeout: PUSH_TIMEOUT_MS, auth: true });
  } catch (e) {
    if (!REJECTED.test(e.message)) throw e;
    return { pushed: false, rejected: true, error: e.message, commits, issues, status: await localStatus({ repo, base: before.base, fetch: false }) };
  }
  return { pushed: true, commits, issues, status: await localStatus({ repo, base: before.base, fetch: false }) };
}

/**
 * Brings the local <base> up to date with origin/<base> (`git pull --rebase`) and pushes it.
 * Runs where <base> is checked out (refused when that checkout has uncommitted changes to tracked
 * files), or in a temporary worktree when it is checked out nowhere. A conflict aborts the rebase:
 * <base> keeps every local commit, and the conflicting files are returned.
 * @returns {Promise<{ pushed: boolean, conflict?: boolean, files?: string[], checkout?: string, error?: string, commits?, issues?, status }>}
 */
async function updateAndPush({ repo, base = null }) {
  const root = await repoRoot(repo);
  if (!root) throw new Error(`${repo || '(no folder)'} is not a git repository.`);
  base = base || await defaultBase(root);
  if (!(await refExists(root, `refs/heads/${base}`))) throw new Error(`The local branch ${base} does not exist.`);
  const checkout = (await listWorktrees(root)).find((w) => w.branch === base);
  if (checkout && await tryGit(['status', '--porcelain', '--untracked-files=no'], checkout.dir)) {
    throw new Error(`${checkout.dir} has uncommitted changes on ${base}; commit or stash them, then update again.`);
  }
  let dir = checkout?.dir;
  let temp = null;
  if (!dir) {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-push-'));
    await git(['worktree', 'add', temp, base], root);
    dir = temp;
  }
  try {
    try {
      await git([...(await identityArgs(root)), 'pull', '--rebase', '--no-autostash', 'origin', base], dir, { timeout: FETCH_TIMEOUT_MS, auth: true });
    } catch (e) {
      const files = ((await tryGit(['diff', '--name-only', '--diff-filter=U'], dir)) || '').split('\n').filter(Boolean);
      await tryGit(['rebase', '--abort'], dir); // back to the local commits as they were
      if (!files.length) throw e; // not a conflict (network, auth): the caller shows the error
      return {
        pushed: false, conflict: true, files, checkout: checkout?.dir || null,
        error: `The local ${base} conflicts with origin/${base} in ${files.join(', ')}. The update was undone: the local ${base} still has every local commit.`,
        status: await localStatus({ repo: root, base, fetch: false }),
      };
    }
  } finally {
    if (temp) {
      await tryGit(['worktree', 'remove', '--force', temp], root);
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
      await tryGit(['worktree', 'prune'], root);
    }
  }
  return pushBase({ repo: root, base });
}

module.exports = { localStatus, pushBase, updateAndPush, closedIssues, defaultBase };
