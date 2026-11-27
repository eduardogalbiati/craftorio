// @ts-check
// #98: importing any folder on this computer (the new-project wizard's "Use a local repository" card).
// inspectFolder answers what a folder is (repository | empty-repository | plain | missing | unreadable), for the
// wizard's step 2 and for the onboarding's start; planFolderImport decides how start imports a file:// folder (a
// plain folder or a repository without a commit gets a new repository from a copy of its files, refused over
// FOLDER_IMPORT_LIMIT_BYTES); commitFolderFiles makes that copy in <workspace>/repos: git init on main and ONE
// first commit of the folder's files, minus what its .gitignore ignores (NEW_PROJECT_GITIGNORE, the one a new
// project gets, when it has none). The person's folder is only read: git runs with --work-tree on it and its index
// and objects in the copy's .git, so nothing is written there.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath } = require('url');
const { execGit } = require('../workspace/workspace');
const { identityArgs } = require('../../engine/worktree');

// #98: a folder import over this size (its files, minus the ignored ones) is refused before anything is copied
const FOLDER_IMPORT_LIMIT_BYTES = 500 * 1024 * 1024;

// #632: the .gitignore a new project starts with (project-onboarding.js initRepository); #98: also a folder's first
// commit when the folder has none
const NEW_PROJECT_GITIGNORE = ['node_modules/', '.env', '.env.*', '!.env.example', '.DS_Store', 'Thumbs.db', 'dist/', 'build/', 'coverage/', '*.log', ''].join('\n');

const FILE_URL = /^file:\/\//i;

// a path or its file:// URL → the path; null when it is neither
function folderPath(folder) {
  const s = String(folder ?? '').trim();
  if (!s) return null;
  if (!FILE_URL.test(s)) return path.resolve(s);
  try { return fileURLToPath(s); } catch { return null; }
}

/**
 * #98: what the folder is (a path or its file:// URL); never rejects. A plain folder inside another repository is
 * plain: only the folder's own .git counts.
 * @returns {Promise<{ state: 'repository' | 'empty-repository' | 'plain' | 'missing' | 'unreadable' }>}
 */
async function inspectFolder(folder, { git = execGit } = {}) {
  const dir = folderPath(folder);
  if (!dir) return { state: 'missing' };
  try {
    if (!fs.statSync(dir).isDirectory()) return { state: 'unreadable' };
    fs.readdirSync(dir);
  } catch (e) {
    return { state: ['ENOENT', 'ENOTDIR'].includes(String(/** @type {NodeJS.ErrnoException} */ (e)?.code)) ? 'missing' : 'unreadable' };
  }
  const ok = (args) => Promise.resolve().then(() => git(args, dir)).then((s) => String(s ?? '').trim() || true, () => false);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    // a bare repository (HEAD, objects/, refs/ at its root) is cloned as before, whatever its commits
    return { state: (await ok(['--git-dir', dir, 'rev-parse', '--is-bare-repository'])) === 'true' ? 'repository' : 'plain' };
  }
  if (await ok(['rev-parse', '--verify', '-q', 'HEAD'])) return { state: 'repository' };
  // no HEAD commit: empty only when git reads the repository (an unborn branch); git missing, a dubious ownership
  // or a broken .git stays a repository, so the clone path's access check names the cause
  return { state: (await ok(['symbolic-ref', '-q', 'HEAD'])) ? 'empty-repository' : 'repository' };
}

// #98 #632: a new repository in `dir` on main (a new project's, a folder import's)
async function initOnMain(dir, { git = execGit, quiet = false } = {}) {
  await git(['init', ...(quiet ? ['-q'] : [])], dir);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], dir);
}

// #98 #632: `git commit <args>` in `dir` with the run identity (worktree.js identityArgs) and no signing
async function commitAsIdentity(dir, args, { git = execGit } = {}) {
  const identity = await identityArgs(dir, (a, d) => git(a, d).then((s) => String(s).trim() || null, () => null));
  await git([...identity, '-c', 'commit.gpgsign=false', 'commit', ...args], dir);
}

// the folder's own .gitignore, else the new project's in the git dir's info/exclude (→ whether it had one)
function excludeFor(gitDir, source) {
  if (fs.existsSync(path.join(source, '.gitignore'))) return true;
  fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true });
  fs.appendFileSync(path.join(gitDir, 'info', 'exclude'), `\n${NEW_PROJECT_GITIGNORE}`);
  return false;
}

const onSource = (gitDir, source, args) => ['--git-dir', gitDir, '--work-tree', source, ...args];

// #98: the folder's files a first commit would hold (git ls-files -o: an embedded repository is one `<dir>/` entry)
async function folderFiles(source, git) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-folder-'));
  try {
    await git(['init', '-q', tmp], tmp);
    const gitDir = path.join(tmp, '.git');
    excludeFor(gitDir, source);
    return String(await git(onSource(gitDir, source, ['ls-files', '-o', '--exclude-standard', '-z']), source)).split('\0').filter(Boolean);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// #98: what a first commit of `source` would hold: the size of its files (counted up to just over `limit`) and the
// git repositories inside it (their files would not be copied: git records them as gitlinks)
async function folderContents(source, limit, git) {
  const entries = await folderFiles(source, git);
  const nested = entries.filter((rel) => /[\\/]$/.test(rel)).map((rel) => rel.replace(/[\\/]+$/, ''));
  let bytes = 0;
  for (const rel of entries) {
    if (bytes > limit) break;
    if (/[\\/]$/.test(rel)) continue;
    try { bytes += (await fs.promises.stat(path.join(source, rel))).size; } catch { /* gone meanwhile */ }
  }
  return { bytes, nested };
}

/** #98: the size of the files a first commit of `source` would hold, counted up to just over `limit`. */
async function folderFilesSize(source, limit, { git = execGit } = {}) {
  return (await folderContents(source, limit, git)).bytes;
}

/**
 * #98: a new repository in `target` (on main) with one first commit of `source`'s files; `source` is only read.
 * `origin` (a repository without a commit that already had a platform remote): the copy's origin, so the project
 * pushes where its record says.
 */
async function commitFolderFiles(source, target, { git = execGit, origin = null } = {}) {
  fs.mkdirSync(target, { recursive: true });
  await initOnMain(target, { git, quiet: true });
  const gitDir = path.join(target, '.git');
  const ownIgnore = excludeFor(gitDir, source);
  await git(onSource(gitDir, source, ['add', '-A']), source);
  const gitlinks = String(await git(['ls-files', '-s'], target)).split('\n').filter((l) => l.startsWith('160000 ')).map((l) => l.split('\t')[1]);
  if (gitlinks.length) throw new Error(nestedMessage(gitlinks));
  if (!ownIgnore) {
    fs.writeFileSync(path.join(target, '.gitignore'), NEW_PROJECT_GITIGNORE);
    await git(['add', '.gitignore'], target);
  }
  await commitAsIdentity(target, ['-q', '--no-verify', '--allow-empty', '-m', `Initial commit from ${path.basename(source)}`], { git });
  await git(['reset', '-q', '--hard'], target);
  if (origin) await git(['remote', 'add', 'origin', origin], target);
}

const nestedMessage = (dirs) => `The folder holds other git repositories (${dirs.slice(0, 3).join(', ')}${dirs.length > 3 ? '…' : ''}): their files would not be copied into the new repository. Import each repository on its own, or move them out of the folder.`;

const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`);

/**
 * #98: how the onboarding imports `repo`: null when it is not a file:// folder to copy (a repository with a commit,
 * a missing or unreadable folder, any other URL: the clone as before); { fromFiles: true } for a plain folder or a
 * repository without a commit; { refused } (a refusal's access) when its files exceed `limit` (cause
 * folder-too-large, the limit in its message; also a file list over git's output buffer), when it holds other git
 * repositories (cause nested-repository) or when git is missing (status no-git). Never rejects for those.
 */
async function planFolderImport(repo, { git = execGit, limit = FOLDER_IMPORT_LIMIT_BYTES } = {}) {
  if (!FILE_URL.test(String(repo || '').trim())) return null;
  const { state } = await inspectFolder(repo, { git });
  if (state !== 'plain' && state !== 'empty-repository') return null;
  const tooLarge = { refused: { status: 'failed', cause: 'folder-too-large', message: `The folder's files take more than the ${sizeText(limit)} limit of a folder import. Pick a smaller folder, or add a .gitignore that leaves out the large files.` } };
  let contents;
  try {
    contents = await folderContents(/** @type {string} */ (folderPath(repo)), limit, git);
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    if (err?.code === 'ENOENT') return { refused: { status: 'no-git', message: String(err.message) } };
    if (/maxBuffer/i.test(String(err?.message))) return tooLarge;
    return { refused: { status: 'failed', cause: 'folder-unreadable', message: `The folder's files could not be listed: ${String(err?.message || err)}` } };
  }
  if (contents.nested.length) return { refused: { status: 'failed', cause: 'nested-repository', message: nestedMessage(contents.nested) } };
  return contents.bytes <= limit ? { fromFiles: true } : tooLarge;
}

module.exports = {
  commitAsIdentity,
  commitFolderFiles,
  FILE_URL,
  FOLDER_IMPORT_LIMIT_BYTES,
  folderFilesSize,
  initOnMain,
  inspectFolder,
  NEW_PROJECT_GITIGNORE,
  planFolderImport,
};
