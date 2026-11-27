// #98 review round 1, the cases the reviewer listed: a folder import (packages/engine/domains/project/folder-import.js
// planFolderImport, inspectFolder, commitFolderFiles; the onboarding's start in
// packages/engine/service/areas/project-onboarding.js; projects.js retryClone) refuses what it cannot copy without
// rejecting and without leaving a project behind, keeps a repository without a commit's origin (no credentials),
// gives a second folder of the same name its own <name>-2 folder, and retries a failed copy.
// Real git on real folders in os.tmpdir(); a failing git is injected only where git itself must fail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');

const folderImport = require('../domains/project/folder-import');
const projects = require('../domains/project/projects');
const { createOnboarding } = require('../service/areas/project-onboarding');

const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Owner', '-c', 'user.email=owner@example.com', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmp(t, prefix = 'folder-edges-98-') {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return dir;
}

function folderWith(t, files, name = 'notes') {
  const folder = path.join(tmp(t, 'folder-edges-98-src-'), name);
  fs.mkdirSync(folder);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
    fs.writeFileSync(path.join(folder, rel), content);
  }
  return folder;
}

function fileList(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort().join('\n');
}

// a git repository with one commit in `dir` (a repository nested in the person's folder)
function committedRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
  fs.writeFileSync(path.join(dir, 'theme.css'), 'body {}');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'one']);
}

// a git that fails every call with `error` (git missing, an output too large, any other failure)
const failingGit = (error) => async () => { throw error; };
const errno = (message, code) => Object.assign(new Error(message), { code });

const noJobs = { facts: async () => ({}), profile: async () => ({ profile: {} }), projectMap: async () => ({}) };

function setup(t, extra = {}) {
  const root = tmp(t);
  const projectsDir = path.join(root, 'projects');
  const reposDir = path.join(root, 'repos');
  const ob = createOnboarding({
    projectsDir,
    reposDir,
    cli: async () => ({ installed: true, signedIn: true }),
    jobs: noJobs,
    slotsDir: path.join(root, 'locks'),
    platformCli: async () => ({ ok: false, out: 'not called in a test' }),
    pushCheck: async () => ({ ok: true }),
    ...extra,
  });
  return { ob, projectsDir, reposDir };
}

async function started(ob, data) {
  let timer;
  const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('onboarding start never answered')), 20000); });
  try {
    return await Promise.race([ob.start(data), late]);
  } catch (e) {
    return assert.fail(`start rejected instead of answering: ${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function settled(ob, id) {
  let last;
  for (let i = 0; i < 400; i++) {
    last = await ob.status(id);
    if (last?.status !== 'cloning') return last;
    await pause(25);
  }
  return last;
}

async function projectSettled(projectsDir, id) {
  let p;
  for (let i = 0; i < 400; i++) {
    p = projects.readProject(projectsDir, id);
    if (p.status !== 'cloning') return p;
    await pause(25);
  }
  return p;
}

const entries = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

// ---------- planFolderImport when git fails to list the folder's files ----------

test('#98 planFolderImport: git missing (ENOENT) is a no-git refusal, never a rejection', async (t) => {
  const folder = folderWith(t, { 'a.txt': 'a' });
  const plan = await folderImport.planFolderImport(pathToFileURL(folder).href, { git: failingGit(errno('spawn git ENOENT', 'ENOENT')) });
  assert.equal(plan?.refused?.status, 'no-git', JSON.stringify(plan));
});

test('#98 planFolderImport: a file list over git\'s output buffer is folder-too-large', async (t) => {
  const folder = folderWith(t, { 'a.txt': 'a' });
  const plan = await folderImport.planFolderImport(pathToFileURL(folder).href, { git: failingGit(new Error('stdout maxBuffer length exceeded')) });
  assert.equal(plan?.refused?.cause, 'folder-too-large', JSON.stringify(plan));
});

test('#98 planFolderImport: another listing failure is folder-unreadable, with git\'s message', async (t) => {
  const folder = folderWith(t, { 'a.txt': 'a' });
  const plan = await folderImport.planFolderImport(pathToFileURL(folder).href, { git: failingGit(new Error('fatal: weird failure xyz')) });
  assert.equal(plan?.refused?.cause, 'folder-unreadable', JSON.stringify(plan));
  assert.match(plan.refused.message, /weird failure xyz/);
});

test('#98 start: a plain folder git cannot list answers a refusal (no-git, folder-unreadable) and creates nothing', async (t) => {
  for (const [error, code] of [[errno('spawn git ENOENT', 'ENOENT'), 'no-git'], [new Error('fatal: weird failure xyz'), 'folder-unreadable']]) {
    const folder = folderWith(t, { 'a.txt': 'a' });
    const { ob, projectsDir, reposDir } = setup(t, { git: failingGit(error) });
    const s = await started(ob, { name: 'Notes', repo: pathToFileURL(folder).href });
    assert.equal(s?.status, 'failed', JSON.stringify(s));
    assert.equal(s.code, code, JSON.stringify(s));
    assert.equal(s.projectId ?? null, null, 'no project id');
    assert.equal(typeof s.reason, 'string');
    assert.equal(projects.listProjects(projectsDir).length, 0);
    assert.deepEqual(entries(reposDir), []);
  }
});

// ---------- a folder holding another git repository ----------

test('#98 planFolderImport: a nested repository without a commit is refused with nested-repository too', async (t) => {
  const folder = folderWith(t, { 'index.html': '<p>hi</p>' });
  const inner = path.join(folder, 'vendor', 'lib');
  fs.mkdirSync(inner, { recursive: true });
  git(inner, ['init', '-q']);
  fs.writeFileSync(path.join(inner, 'lib.js'), 'x');
  const plan = await folderImport.planFolderImport(pathToFileURL(folder).href);
  assert.equal(plan?.refused?.cause, 'nested-repository', JSON.stringify(plan));
  assert.match(plan.refused.message, /vendor[\\/]lib/);
});

test('#98 start: a folder holding another repository answers nested-repository, no project, nothing in repos/, the folder untouched', async (t) => {
  const folder = folderWith(t, { 'index.html': '<p>hi</p>' });
  committedRepo(path.join(folder, 'themes', 'theme'));
  const before = fileList(folder);
  const { ob, projectsDir, reposDir } = setup(t);
  const s = await started(ob, { name: 'Site', repo: pathToFileURL(folder).href });
  assert.equal(s?.status, 'failed', JSON.stringify(s));
  assert.equal(s.code, 'nested-repository', JSON.stringify(s));
  assert.equal(s.projectId ?? null, null);
  assert.match(String(s.reason), /themes[\\/]theme/);
  assert.equal(projects.listProjects(projectsDir).length, 0);
  assert.deepEqual(entries(reposDir), []);
  assert.equal(fileList(folder), before);
});

test('#98 commitFolderFiles fails when a nested repository would enter the commit as a gitlink, the source untouched', async (t) => {
  const folder = folderWith(t, { 'index.html': '<p>hi</p>' });
  committedRepo(path.join(folder, 'themes', 'theme'));
  const before = fileList(folder);
  const target = path.join(tmp(t), 'copy');
  await assert.rejects(folderImport.commitFolderFiles(folder, target), /other git repositories/);
  assert.equal(fileList(folder), before);
});

// ---------- inspectFolder edges ----------

test('#98 inspectFolder: a bare repository without a commit is a repository (cloned as before)', async (t) => {
  const bare = path.join(tmp(t), 'empty.git');
  fs.mkdirSync(bare);
  git(bare, ['init', '-q', '--bare']);
  assert.equal((await folderImport.inspectFolder(bare)).state, 'repository');
});

test('#98 inspectFolder: a plain folder inside another repository is plain (only its own .git counts)', async (t) => {
  const outer = tmp(t);
  git(outer, ['init', '-q']);
  fs.writeFileSync(path.join(outer, 'top.txt'), 'x');
  git(outer, ['add', '.']);
  git(outer, ['commit', '-q', '-m', 'outer']);
  const inner = path.join(outer, 'docs');
  fs.mkdirSync(inner);
  fs.writeFileSync(path.join(inner, 'a.md'), '# a');
  assert.equal((await folderImport.inspectFolder(inner)).state, 'plain');
});

// ---------- a repository without a commit that has an origin ----------

test('#98 start: a repository without a commit keeps its platform origin, without credentials, in the record and the copy', async (t) => {
  const folder = folderWith(t, { 'README.md': '# notes\n' });
  git(folder, ['init', '-q']);
  git(folder, ['remote', 'add', 'origin', 'https://someone:secret-token@github.com/acme/notes.git']);
  const { ob, projectsDir } = setup(t);
  const s = await started(ob, { name: 'Notes', repo: pathToFileURL(folder).href });
  assert.equal(s?.code ?? null, null, JSON.stringify(s));
  const done = await settled(ob, s.projectId);
  assert.equal(done?.status, 'ready', JSON.stringify(done));
  const p = projects.readProject(projectsDir, s.projectId);
  assert.equal(p.repo, 'https://github.com/acme/notes.git');
  assert.equal(git(p.folder, ['remote', 'get-url', 'origin']), 'https://github.com/acme/notes.git');
  assert.equal(git(p.folder, ['rev-list', '--count', 'HEAD']), '1');
  assert.equal(git(folder, ['remote', 'get-url', 'origin']), 'https://someone:secret-token@github.com/acme/notes.git', 'the person\'s folder keeps its own remote');
});

// ---------- two folders of the same name ----------

test('#98 start: a second plain folder with the same name gets its own <name>-2 folder in repos/', async (t) => {
  const first = folderWith(t, { 'a.txt': 'first' }, 'notes');
  const second = folderWith(t, { 'b.txt': 'second' }, 'notes');
  const { ob, projectsDir, reposDir } = setup(t);
  const a = await started(ob, { name: 'Notes A', repo: pathToFileURL(first).href });
  assert.equal((await settled(ob, a.projectId))?.status, 'ready');
  const b = await started(ob, { name: 'Notes B', repo: pathToFileURL(second).href });
  assert.equal(b?.code ?? null, null, JSON.stringify(b));
  assert.notEqual(b.projectId, a.projectId);
  assert.equal((await settled(ob, b.projectId))?.status, 'ready');
  const pa = projects.readProject(projectsDir, a.projectId);
  const pb = projects.readProject(projectsDir, b.projectId);
  assert.equal(path.basename(pa.folder), 'notes');
  assert.equal(path.basename(pb.folder), 'notes-2');
  assert.equal(path.dirname(pb.folder), reposDir);
  assert.equal(git(pb.folder, ['ls-files']).split('\n').includes('b.txt'), true);
  assert.equal(git(pb.folder, ['ls-files']).split('\n').includes('a.txt'), false);
});

// ---------- retrying a failed copy ----------

test('#98 retryClone of a failed folder copy makes the repository again from the folder\'s files', async (t) => {
  const folder = folderWith(t, { 'index.html': '<p>hi</p>' });
  const nested = path.join(folder, 'themes', 'theme');
  committedRepo(nested);
  const root = tmp(t);
  const projectsDir = path.join(root, 'projects');
  const reposDir = path.join(root, 'repos');
  const p = await projects.createProject(projectsDir, { name: 'Site', repo: pathToFileURL(folder).href }, { reposDir, fromFiles: true });
  const failed = await projectSettled(projectsDir, p.id);
  assert.equal(failed.status, 'failed', 'the copy fails on the nested repository');
  assert.match(String(failed.cloneError), /other git repositories/);
  fs.rmSync(path.join(nested, '.git'), { recursive: true, force: true });
  await projects.retryClone(projectsDir, p.id);
  const done = await projectSettled(projectsDir, p.id);
  assert.equal(done.status, 'ready', JSON.stringify(done.cloneError));
  assert.equal(git(done.folder, ['rev-list', '--count', 'HEAD']), '1');
  assert.equal(git(done.folder, ['ls-files']).split('\n').includes('themes/theme/theme.css'), true);
});
