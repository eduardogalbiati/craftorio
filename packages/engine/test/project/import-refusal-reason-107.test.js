// #107 (review rounds 2 and 3): a refused import's cause by the kind of URL (projects.checkAccess, the isGitUrl
// rule of packages/shared/onboarding-model.js), its reason (git's own fatal: / remote: / error: line, never the hint
// lines under it) and the gh / glab check answered with the refusal (start's `cli`), on the onboarding's public seam
// (packages/engine/service/areas/project-onboarding.js createOnboarding().start). Remote URLs use a fake git (the
// system boundary): no network. A folder on this computer runs the real git, locally.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { createOnboarding } = require('../../service/areas/project-onboarding');
const projects = require('../../domains/project/projects');

// what git prints for an SSH URL whose path names no repository, hint lines included
const SSH_STDERR = [
  "fatal: 'acme/nope.git' does not appear to be a git repository",
  'fatal: Could not read from remote repository.',
  '',
  'Please make sure you have the correct access rights',
  'and the repository exists.',
].join('\n');
const HINTS = /Please make sure|and the repository exists/i;
const GIT_LINE = /^(fatal|remote|error):/i;

function tmp(t, prefix = 'import-refusal-107-') {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

// git whose ls-remote fails with `stderr` (as execGit reports it); every other command fails too
const failingGit = (stderr) => async (args) => { throw new Error(`git ${args[0]} failed: ${stderr}`); };

function setup(t, { git, cli = async () => ({ installed: true, signedIn: true }) } = {}) {
  const root = tmp(t);
  const projectsDir = path.join(root, 'projects');
  const reposDir = path.join(root, 'repos');
  const ob = createOnboarding({
    projectsDir,
    reposDir,
    ...(git ? { git } : {}),
    cli,
    jobs: { facts: async () => ({}), profile: async () => ({ profile: {} }), projectMap: async () => ({}) },
    slotsDir: path.join(root, 'locks'),
    platformCli: async () => ({ ok: false, out: 'not called in a test' }),
    pushCheck: async () => ({ ok: true }),
  });
  return { ob, projectsDir, reposDir };
}

function plainFolder(t) {
  const folder = path.join(tmp(t, 'import-refusal-107-folder-'), 'notes');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'README.md'), '# notes\n');
  return folder;
}

const entries = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

// ---- checkAccess: the cause by the kind of URL ------------------------------------------------------------------

test('#107 checkAccess: an SSH URL git says "does not appear to be a git repository" for is repo-not-found', async () => {
  for (const repo of ['git@github.com:acme/nope.git', 'ssh://git@github.com/acme/nope.git']) {
    const r = await projects.checkAccess(repo, { git: failingGit(SSH_STDERR) });
    assert.equal(r.status, 'no-access', repo);
    assert.equal(r.cause, 'repo-not-found', repo);
  }
});

test('#107 checkAccess: a local path, with or without file://, git says is not a repository is not-a-git-repo', async () => {
  const stderr = "fatal: '/home/ana/notes' does not appear to be a git repository\nfatal: Could not read from remote repository.";
  for (const repo of ['/home/ana/notes', 'C:\\Users\\ana\\notes', 'file:///home/ana/notes']) {
    const r = await projects.checkAccess(repo, { git: failingGit(stderr) });
    assert.equal(r.cause, 'not-a-git-repo', repo);
  }
});

test('#107 checkAccess: a refused HTTPS URL is repo-no-access, "Repository not found" is repo-not-found', async () => {
  const denied = await projects.checkAccess('https://github.com/acme/private.git', { git: failingGit('remote: Invalid username or password.\nfatal: Authentication failed for \'https://github.com/acme/private.git/\'') });
  assert.equal(denied.cause, 'repo-no-access');
  const missing = await projects.checkAccess('https://github.com/acme/nope.git', { git: failingGit('remote: Repository not found.\nfatal: repository \'https://github.com/acme/nope.git/\' not found') });
  assert.equal(missing.cause, 'repo-not-found');
});

// ---- start: git's own line as the reason, never the hint lines ---------------------------------------------------

test('#107 start: an SSH URL with no repository answers repo-not-found with a fatal: line as the reason, no hint line', { timeout: 30000 }, async (t) => {
  const { ob, projectsDir, reposDir } = setup(t, { git: failingGit(SSH_STDERR) });
  const s = await ob.start({ name: 'Nope', repo: 'git@github.com:acme/nope.git' });
  assert.equal(s.status, 'failed');
  assert.equal(s.code, 'repo-not-found');
  assert.match(String(s.reason), GIT_LINE, `the reason: ${s.reason}`);
  assert.doesNotMatch(String(s.reason), HINTS, `the reason: ${s.reason}`);
  assert.deepEqual(projects.listProjects(projectsDir).map((p) => p.id), []);
  assert.deepEqual(entries(reposDir), []);
});

for (const [title, repoOf] of [['file:// URL', (f) => pathToFileURL(f).href], ['plain path', (f) => f]]) {
  test(`#107 start (real git): a folder without git by its ${title} answers not-a-git-repo, git's fatal: line, no hint line`, { timeout: 30000 }, async (t) => {
    const { ob, projectsDir } = setup(t);
    const s = await ob.start({ name: 'Notes', repo: repoOf(plainFolder(t)) });
    assert.equal(s.status, 'failed', JSON.stringify(s));
    assert.equal(s.code, 'not-a-git-repo', JSON.stringify(s));
    assert.match(String(s.reason), GIT_LINE, `the reason: ${s.reason}`);
    assert.doesNotMatch(String(s.reason), HINTS, `the reason: ${s.reason}`);
    assert.deepEqual(projects.listProjects(projectsDir).map((p) => p.id), []);
  });
}

// ---- start: the refusal carries gh / glab of the URL's provider -------------------------------------------------

test('#107 start: a refused GitHub import answers cli for github, missing when gh is not installed', { timeout: 30000 }, async (t) => {
  const { ob } = setup(t, { git: failingGit('remote: Repository not found.\nfatal: repository not found'), cli: async () => ({ installed: false }) });
  const s = await ob.start({ name: 'Nope', repo: 'https://github.com/acme/nope.git' });
  assert.equal(s.code, 'repo-not-found');
  assert.equal(s.cli?.provider, 'github', JSON.stringify(s.cli));
  assert.equal(s.cli?.status, 'missing');
});

test('#107 start: a refused GitHub import answers cli signed-out when gh is not signed in', { timeout: 30000 }, async (t) => {
  const { ob } = setup(t, { git: failingGit('fatal: Authentication failed (The requested URL returned error: 403)'), cli: async () => ({ installed: true, signedIn: false }) });
  const s = await ob.start({ name: 'Private', repo: 'https://github.com/acme/private.git' });
  assert.equal(s.code, 'repo-no-access');
  assert.equal(s.cli?.provider, 'github');
  assert.equal(s.cli?.status, 'signed-out');
});

test('#107 start: a refused local folder answers no cli (no provider)', { timeout: 30000 }, async (t) => {
  const { ob } = setup(t);
  const s = await ob.start({ name: 'Notes', repo: plainFolder(t) });
  assert.equal(s.code, 'not-a-git-repo');
  assert.equal(s.cli ?? null, null);
});

// ---- start: no network creates nothing either --------------------------------------------------------------------

test('#107 start: an unreachable host answers no-network and creates nothing', { timeout: 30000 }, async (t) => {
  const { ob, projectsDir, reposDir } = setup(t, { git: failingGit("fatal: unable to access 'https://github.com/acme/x.git/': Could not resolve host: github.com") });
  const s = await ob.start({ name: 'X', repo: 'https://github.com/acme/x.git' });
  assert.equal(s.status, 'failed');
  assert.equal(s.code, 'no-network');
  assert.equal(s.projectId ?? null, null);
  assert.deepEqual(projects.listProjects(projectsDir).map((p) => p.id), []);
  assert.deepEqual(entries(reposDir), []);
});
