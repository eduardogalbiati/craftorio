// #98 review round 1 (developer's own tests): folder-import.js edges. A bare repository is a repository (cloned as
// before); a repository git cannot read stays a repository; a folder holding another git repository is refused
// (nested-repository) before anything is copied; a repository without a commit keeps its origin in the copy;
// workspace.js cloneFolder's fresh option skips a clone of the same repository.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const folderImport = require('../domains/project/folder-import');
const { cloneFolder } = require('../domains/workspace/workspace');

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-import-98-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const commitIn = (dir) => {
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  git(['add', '.'], dir);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'one'], dir);
};

test('#98 a bare repository is a repository (cloned as before), not a plain folder', async (t) => {
  const root = tmp(t);
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  git(['init', '-q'], work);
  commitIn(work);
  const bare = path.join(root, 'bare.git');
  git(['clone', '-q', '--bare', work, bare], root);
  assert.equal((await folderImport.inspectFolder(bare)).state, 'repository');
  assert.equal(await folderImport.planFolderImport(pathToFileURL(bare).href), null);
});

test('#98 a repository whose HEAD git cannot read (git fails) stays a repository, not an empty one', async (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, '.git'));
  const failing = () => Promise.reject(new Error('fatal: detected dubious ownership'));
  assert.equal((await folderImport.inspectFolder(dir, { git: failing })).state, 'repository');
});

test('#98 a plain folder holding another git repository is refused with nested-repository', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'index.html'), '<p>hi</p>');
  const inner = path.join(dir, 'themes', 'theme');
  fs.mkdirSync(inner, { recursive: true });
  git(['init', '-q'], inner);
  commitIn(inner);
  const plan = await folderImport.planFolderImport(pathToFileURL(dir).href);
  assert.equal(plan?.refused?.cause, 'nested-repository', JSON.stringify(plan));
  assert.match(plan.refused.message, /themes[\\/]theme/);
});

test('#98 the copy of a repository without a commit gets the given origin', async (t) => {
  const root = tmp(t);
  const source = path.join(root, 'src');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'notes.md'), '# notes');
  const target = path.join(root, 'copy');
  await folderImport.commitFolderFiles(source, target, { origin: 'https://github.com/acme/notes.git' });
  assert.equal(git(['remote', 'get-url', 'origin'], target).trim(), 'https://github.com/acme/notes.git');
  assert.equal(git(['rev-list', '--count', 'HEAD'], target).trim(), '1');
});

test('#98 cloneFolder fresh skips a clone of the same repository and takes the next empty sibling', (t) => {
  const reposDir = tmp(t);
  const url = pathToFileURL(path.join(reposDir, '..', 'notes')).href;
  const taken = path.join(reposDir, 'notes');
  fs.mkdirSync(path.join(taken, '.git'), { recursive: true });
  assert.equal(cloneFolder(url, reposDir).dir, taken);
  assert.equal(cloneFolder(url, reposDir, { fresh: true }).dir, `${taken}-2`);
});
