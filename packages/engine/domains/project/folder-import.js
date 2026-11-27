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
  if (!fs.existsSync(path.join(dir, '.git'))) return { state: 'plain' };
  const head = await Promise.resolve().then(() => git(['rev-parse', '--verify', '-q', 'HEAD'], dir)).then(() => true, () => false);
  return { state: head ? 'repository' : 'empty-repository' };
}

// the folder's own .gitignore, else the new project's in the git dir's info/exclude (→ whether it had one)
function excludeFor(gitDir, source) {
  if (fs.existsSync(path.join(source, '.gitignore'))) return true;
  fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true });
  fs.appendFileSync(path.join(gitDir, 'info', 'exclude'), `\n${NEW_PROJECT_GITIGNORE}`);
  return false;
}

const onSource = (gitDir, source, args) => ['--git-dir', gitDir, '--work-tree', source, ...args];

/** #98: the size of the files a first commit of `source` would hold, counted up to just over `limit`. */
async function folderFilesSize(source, limit, { git = execGit } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-folder-'));
  try {
    await git(['init', '-q', tmp], tmp);
    const gitDir = path.join(tmp, '.git');
    excludeFor(gitDir, source);
    const out = String(await git(onSource(gitDir, source, ['ls-files', '-o', '--exclude-standard', '-z']), source));
    let bytes = 0;
    for (const rel of out.split('\0').filter(Boolean)) {
      try { bytes += fs.statSync(path.join(source, rel)).size; } catch { /* gone meanwhile */ }
      if (bytes > limit) break;
    }
    return bytes;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** #98: a new repository in `target` (on main) with one first commit of `source`'s files; `source` is only read. */
async function commitFolderFiles(source, target, { git = execGit } = {}) {
  fs.mkdirSync(target, { recursive: true });
  await git(['init', '-q'], target);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], target);
  const gitDir = path.join(target, '.git');
  const ownIgnore = excludeFor(gitDir, source);
  await git(onSource(gitDir, source, ['add', '-A']), source);
  if (!ownIgnore) {
    fs.writeFileSync(path.join(target, '.gitignore'), NEW_PROJECT_GITIGNORE);
    await git(['add', '.gitignore'], target);
  }
  const identity = await identityArgs(target, (args, dir) => git(args, dir).then((s) => String(s).trim() || null, () => null));
  await git([...identity, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '--allow-empty', '-m', `Initial commit from ${path.basename(source)}`], target);
  await git(['reset', '-q', '--hard'], target);
}

const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`);

/**
 * #98: how the onboarding imports `repo`: null when it is not a file:// folder to copy (a repository with a commit,
 * a missing or unreadable folder, any other URL: the clone as before); { fromFiles: true } for a plain folder or a
 * repository without a commit; { refused } (a refusal's access: cause folder-too-large, the limit in its message)
 * when its files exceed `limit`.
 */
async function planFolderImport(repo, { git = execGit, limit = FOLDER_IMPORT_LIMIT_BYTES } = {}) {
  if (!FILE_URL.test(String(repo || '').trim())) return null;
  const { state } = await inspectFolder(repo, { git });
  if (state !== 'plain' && state !== 'empty-repository') return null;
  const bytes = await folderFilesSize(/** @type {string} */ (folderPath(repo)), limit, { git });
  if (bytes <= limit) return { fromFiles: true };
  return { refused: { status: 'failed', cause: 'folder-too-large', message: `The folder's files take more than ${sizeText(limit)}, over the ${sizeText(limit)} limit of a folder import. Pick a smaller folder, or add a .gitignore that leaves out the large files.` } };
}

module.exports = {
  commitFolderFiles,
  FOLDER_IMPORT_LIMIT_BYTES,
  folderFilesSize,
  inspectFolder,
  NEW_PROJECT_GITIGNORE,
  planFolderImport,
};
