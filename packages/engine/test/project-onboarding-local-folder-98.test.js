// #98: "Use a local repository" imports any folder: a plain folder (no git) or a git repository without a commit
// becomes a project whose clone holds ONE commit of the folder's files (minus what its .gitignore ignores; the
// new project's .gitignore when it has none). The person's folder is never touched (the "copy" option).
// Acceptance tests, written before the code, on the onboarding's public seam
// (packages/engine/service/areas/project-onboarding.js inspectFolder, createOnboarding().start, the service's
// onboardingInspectFolder) and projects.js (FOLDER_IMPORT_LIMIT_BYTES, listProjects, readProject().folder).
//
// The contract assumed here (the developer implements exactly this):
// - inspectFolder(folder) (a path or a file:// URL) resolves { state }: 'repository' (git, >= 1 commit) |
//   'empty-repository' (git init, no commit) | 'plain' (readable directory, no git) | 'missing' | 'unreadable'
//   (exists, not a readable directory: a regular file here); never rejects. The service's
//   onboardingInspectFolder({ folder }) answers the same (it needs no open workspace).
// - start({ name, repo: <file:// URL> }) on a plain / empty-repository folder creates the project and ends
//   'ready'; the project's folder (readProject().folder, in reposDir) is a git repository with exactly one
//   commit; its tracked files are the folder's files minus its .gitignore's matches; without a .gitignore the
//   commit adds the one "Create new project" writes (project-onboarding.js GITIGNORE: node_modules/ ...).
// - createOnboarding({ folderLimitBytes }) (default projects.FOLDER_IMPORT_LIMIT_BYTES, a positive number): a
//   folder whose files exceed it is refused like a #107 refusal: no projectId, code 'folder-too-large', a reason
//   naming the limit; no project, nothing in reposDir.
// Real git on real folders in os.tmpdir() (local only); gh / glab and the push check are injected.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');

const AREA = '../service/areas/project-onboarding';
const loadArea = () => require(AREA);
const loadProjects = () => require('../domains/project/projects');

const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Owner', '-c', 'user.email=owner@example.com', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const gitFails = (cwd, args) => {
  try {
    git(cwd, args);
    return false;
  } catch {
    return true;
  }
};

function tmp(t, prefix = 'local-folder-98-') {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return dir;
}

// the person's folder `name` holding `files` ({ relative path: content })
function folderWith(t, files, name = 'notes') {
  const folder = path.join(tmp(t, 'local-folder-98-src-'), name);
  fs.mkdirSync(folder);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
    fs.writeFileSync(path.join(folder, rel), content);
  }
  return folder;
}

// every file under `dir` (relative, '/'-separated, sorted), .git included
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

const noJobs = { facts: async () => ({}), profile: async () => ({ profile: {} }), projectMap: async () => ({}) };

function setup(t, extra = {}) {
  const root = tmp(t);
  const projectsDir = path.join(root, 'projects');
  const reposDir = path.join(root, 'repos');
  const ob = loadArea().createOnboarding({
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

// start's answer, or a failed test when it rejects or never answers
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
    await pause(50);
  }
  return assert.fail(`the clone never ended: ${JSON.stringify(last)}`);
}

// imports `folder` by its file:// URL; → { state (once the clone ended), folder (the project's folder) }
async function imported(t, folder, extra = {}) {
  const { ob, projectsDir, reposDir } = setup(t, extra);
  const s = await started(ob, { name: 'Notes', repo: pathToFileURL(folder).href });
  assert.equal(s?.code, undefined, `start refused the folder: ${JSON.stringify({ status: s?.status, code: s?.code, reason: s?.reason })}`);
  assert.ok(s?.projectId, `start created a project: ${JSON.stringify(s)}`);
  const state = await settled(ob, s.projectId);
  assert.equal(state.status, 'ready', `the import is ready: ${JSON.stringify({ status: state.status, code: state.code, reason: state.reason })}`);
  const clone = loadProjects().readProject(projectsDir, s.projectId).folder;
  return { state, clone, reposDir };
}

const tracked = (dir) => git(dir, ['ls-files']).split('\n').filter(Boolean).sort().join('\n');

// ---------------------------------------------------------------------------------------------------- inspectFolder

test('#98 inspectFolder: a git repository with a commit is a repository', async (t) => {
  const folder = folderWith(t, { 'a.txt': 'a\n' });
  git(folder, ['init', '-q']);
  git(folder, ['add', '.']);
  git(folder, ['commit', '-q', '-m', 'first']);
  const answer = await loadArea().inspectFolder(folder);
  assert.equal(answer?.state, 'repository');
});

test('#98 inspectFolder: a git repository without a commit is an empty repository', async (t) => {
  const folder = folderWith(t, { 'a.txt': 'a\n' });
  git(folder, ['init', '-q']);
  const answer = await loadArea().inspectFolder(folder);
  assert.equal(answer?.state, 'empty-repository');
});

test('#98 inspectFolder: a folder without git is plain', async (t) => {
  const folder = folderWith(t, { 'a.txt': 'a\n' });
  const answer = await loadArea().inspectFolder(folder);
  assert.equal(answer?.state, 'plain');
});

test('#98 inspectFolder: a path that does not exist is missing (resolves, never rejects)', async (t) => {
  const answer = await loadArea().inspectFolder(path.join(tmp(t), 'nowhere'));
  assert.equal(answer?.state, 'missing');
});

test('#98 inspectFolder: a regular file is unreadable (resolves, never rejects)', async (t) => {
  const file = path.join(tmp(t), 'file.txt');
  fs.writeFileSync(file, 'not a folder\n');
  const answer = await loadArea().inspectFolder(file);
  assert.equal(answer?.state, 'unreadable');
});

test('#98 inspectFolder: a file:// URL is read as its folder (plain, empty repository)', async (t) => {
  const plain = folderWith(t, { 'a.txt': 'a\n' });
  const empty = folderWith(t, { 'b.txt': 'b\n' }, 'empty');
  git(empty, ['init', '-q']);
  const { inspectFolder } = loadArea();
  assert.equal((await inspectFolder(pathToFileURL(plain).href))?.state, 'plain');
  assert.equal((await inspectFolder(pathToFileURL(empty).href))?.state, 'empty-repository');
});

test('#98 the service\'s onboardingInspectFolder answers as inspectFolder (plain, missing)', async (t) => {
  const service = loadArea()({});
  assert.equal(typeof service.onboardingInspectFolder, 'function', 'the service method onboardingInspectFolder');
  const plain = folderWith(t, { 'a.txt': 'a\n' });
  assert.equal((await service.onboardingInspectFolder({ folder: plain }))?.state, 'plain');
  assert.equal((await service.onboardingInspectFolder({ folder: path.join(tmp(t), 'nowhere') }))?.state, 'missing');
});

// ---------------------------------------------------------------------------------------------- importing a folder

const IGNORING = { '.gitignore': 'dist/\nsecret.log\n', 'src/a.js': 'module.exports = 1;\n', 'dist/out.js': 'built\n', 'secret.log': 'token\n' };

test('#98 a plain folder imports: the project is ready and its folder is a git repository with exactly one commit', { timeout: 60000 }, async (t) => {
  const { clone, reposDir } = await imported(t, folderWith(t, IGNORING));
  assert.equal(path.dirname(path.resolve(clone)), path.resolve(reposDir), `the project's folder is in reposDir: ${clone}`);
  assert.equal(git(clone, ['rev-list', '--count', 'HEAD']), '1', 'one commit');
});

test('#98 a plain folder imports: the commit tracks its files minus what its .gitignore ignores', { timeout: 60000 }, async (t) => {
  const { clone } = await imported(t, folderWith(t, IGNORING));
  assert.equal(tracked(clone), ['.gitignore', 'src/a.js'].join('\n'));
});

test('#98 a plain folder without .gitignore: the commit adds the new project\'s .gitignore and leaves node_modules out', { timeout: 60000 }, async (t) => {
  const { clone } = await imported(t, folderWith(t, { 'index.js': 'console.log(1);\n', 'node_modules/x/index.js': 'x\n' }));
  assert.equal(tracked(clone), ['.gitignore', 'index.js'].join('\n'));
  const ignore = git(clone, ['show', 'HEAD:.gitignore']);
  assert.match(ignore, /node_modules/, `the committed .gitignore: ${ignore}`);
});

test('#98 a plain folder imports without being touched: no .git, the same files', { timeout: 60000 }, async (t) => {
  const folder = folderWith(t, IGNORING);
  const before = fileList(folder);
  await imported(t, folder);
  assert.equal(fs.existsSync(path.join(folder, '.git')), false, 'the person\'s folder has no .git');
  assert.equal(fileList(folder), before, 'the person\'s files');
});

test('#98 an empty git repository imports: the project\'s folder has exactly one commit of its files', { timeout: 60000 }, async (t) => {
  const folder = folderWith(t, IGNORING);
  git(folder, ['init', '-q']);
  const { clone } = await imported(t, folder);
  assert.equal(git(clone, ['rev-list', '--count', 'HEAD']), '1', 'one commit');
  assert.equal(tracked(clone), ['.gitignore', 'src/a.js'].join('\n'));
});

test('#98 an empty git repository imports without being touched: its own git still has no commit', { timeout: 60000 }, async (t) => {
  const folder = folderWith(t, IGNORING);
  git(folder, ['init', '-q']);
  const before = fileList(folder);
  await imported(t, folder);
  assert.equal(gitFails(folder, ['rev-parse', '--verify', '-q', 'HEAD']), true, 'the person\'s repository has no commit');
  assert.equal(fileList(folder), before, 'the person\'s files (and .git) as they were');
});

test('#98 a git repository with a commit still imports as a clone (the same HEAD)', { timeout: 60000 }, async (t) => {
  const folder = folderWith(t, { 'a.txt': 'a\n' });
  git(folder, ['init', '-q']);
  git(folder, ['add', '.']);
  git(folder, ['commit', '-q', '-m', 'first']);
  const { clone } = await imported(t, folder);
  assert.equal(git(clone, ['rev-parse', 'HEAD']), git(folder, ['rev-parse', 'HEAD']));
});

// ------------------------------------------------------------------------------------------------------ size limit

test('#98 FOLDER_IMPORT_LIMIT_BYTES is a positive number', () => {
  const limit = loadProjects().FOLDER_IMPORT_LIMIT_BYTES;
  assert.equal(typeof limit, 'number');
  assert.equal(limit > 0, true, `the limit: ${limit}`);
});

test('#98 a plain folder over folderLimitBytes is refused with folder-too-large and a reason naming the limit', { timeout: 60000 }, async (t) => {
  const { ob } = setup(t, { folderLimitBytes: 1000 });
  const folder = folderWith(t, { 'big.bin': 'x'.repeat(5000) });
  const s = await started(ob, { name: 'Notes', repo: pathToFileURL(folder).href });
  assert.equal(s?.projectId ?? null, null, `no project id: ${JSON.stringify(s)}`);
  assert.notEqual(s?.status, 'ready');
  assert.equal(s?.code, 'folder-too-large', `the cause: ${JSON.stringify(s)}`);
  assert.match(String(s?.reason), /limit|1[\s,.]?000|1(\.0)?\s?KB/i, `the reason: ${s?.reason}`);
});

test('#98 a plain folder over folderLimitBytes creates no project and nothing in reposDir', { timeout: 60000 }, async (t) => {
  const { ob, projectsDir, reposDir } = setup(t, { folderLimitBytes: 1000 });
  const folder = folderWith(t, { 'big.bin': 'x'.repeat(5000) });
  await started(ob, { name: 'Notes', repo: pathToFileURL(folder).href });
  assert.equal(loadProjects().listProjects(projectsDir).length, 0, 'the project list');
  assert.equal(fs.existsSync(reposDir) ? fs.readdirSync(reposDir).length : 0, 0, 'folders in reposDir');
});
