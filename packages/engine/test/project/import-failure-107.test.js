// #107: importing a repository that cannot be imported says why and leaves no broken project behind.
// Acceptance tests, written before the code, on the onboarding's public seam
// (packages/engine/service/areas/project-onboarding.js createOnboarding().start, the wizard's onboarding:start)
// and the project list (packages/engine/domains/project/projects.js listProjects).
//
// The contract assumed here (the developer implements exactly this):
// - start({ name, repo }) for a repository that cannot be imported RESOLVES (never rejects: the answer travels
//   over IPC / HTTP as data) to a state { status: 'failed', code, reason } where `code` names the cause:
//     'repo-not-found'  the URL names no repository (git: "remote: Repository not found." / "... not found");
//     'repo-no-access'  a private repository the owner cannot read (git: "Authentication failed", HTTP 403);
//     'not-a-git-repo'  a folder on this computer that is not a git repository (real git: "does not appear to be
//                       a git repository");
//   and no project id is kept (`projectId` absent or null): nothing was created.
// - after such a failure the project list (projects.listProjects(<workspace>/projects)) holds no project and
//   <workspace>/repos/ holds no folder (missing or empty); git clone was never run.
// - the wizard words each code in the interface language (i18n keys in project-wizard-import-failure-107.test.js).
// The remote cases use a fake git (the system boundary, as project-onboarding.test.js): no network. The folder case
// runs the real git on a real folder in os.tmpdir() (local only).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const loadArea = () => require('../../service/areas/project-onboarding');
const projects = require('../../domains/project/projects');

const NOT_FOUND = 'https://github.com/acme/nao-existe-xyz.git';
const PRIVATE = 'https://github.com/acme/private-tool.git';

function tmp(t, prefix = 'import-failure-107-') {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

// a fake git whose ls-remote fails with `stderr` as execGit reports it; clone is recorded (it must never run)
function fakeGit(stderr) {
  const calls = [];
  const git = async (args, cwd) => {
    calls.push(args);
    if (args[0] === 'ls-remote' || args[0] === 'clone') throw new Error(`git ${args[0]} failed: ${stderr}`);
    if (args[0] === 'remote') throw new Error('git remote failed: fatal: not a git repository');
    return '';
  };
  return { git, clones: () => calls.filter((a) => a[0] === 'clone').length };
}

const noJobs = { facts: async () => ({}), profile: async () => ({ profile: {} }), projectMap: async () => ({}) };

function setup(t, git) {
  const root = tmp(t);
  const projectsDir = path.join(root, 'projects');
  const reposDir = path.join(root, 'repos');
  const ob = loadArea().createOnboarding({
    projectsDir,
    reposDir,
    ...(git ? { git } : {}),
    cli: async () => ({ installed: true, signedIn: true }),
    jobs: noJobs,
    slotsDir: path.join(root, 'locks'),
    platformCli: async () => ({ ok: false, out: 'not called in a test' }),
    pushCheck: async () => ({ ok: true }),
  });
  return { ob, projectsDir, reposDir };
}

// start's answer, or a failed test when it rejects or never answers
async function started(ob, data) {
  let timer;
  const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('onboarding start never answered')), 15000); });
  try {
    return await Promise.race([ob.start(data), late]);
  } catch (e) {
    assert.fail(`start rejected instead of answering a failed state: ${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
}

const entries = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
const projectNames = (dir) => projects.listProjects(dir).map((p) => `${p.id} (${p.name})`);

// the person's folder: a real folder with a file and no .git
function plainFolder(t) {
  const folder = path.join(tmp(t, 'import-failure-107-folder-'), 'notes');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'README.md'), '# notes\n');
  return folder;
}

const CASES = [
  {
    title: 'a URL that does not exist',
    code: 'repo-not-found',
    stderr: "remote: Repository not found.\nfatal: repository 'https://github.com/acme/nao-existe-xyz.git/' not found",
    data: () => ({ name: 'Nao Existe Xyz', repo: NOT_FOUND }),
  },
  {
    title: 'a private repository without access',
    code: 'repo-no-access',
    stderr: "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/acme/private-tool.git/' (The requested URL returned error: 403)",
    data: () => ({ name: 'Private Tool', repo: PRIVATE }),
  },
];

for (const c of CASES) {
  test(`#107 ${c.title}: start answers failed with code ${c.code}`, { timeout: 30000 }, async (t) => {
    const { git } = fakeGit(c.stderr);
    const { ob } = setup(t, git);
    const s = await started(ob, c.data());
    assert.equal(s?.status, 'failed', `the state: ${JSON.stringify(s)}`);
    assert.equal(s.code, c.code, `the cause: ${JSON.stringify(s)}`);
    assert.equal(s.projectId ?? null, null, 'no project id: nothing was created');
  });

  test(`#107 ${c.title}: no project in the list, no folder in repos/, no clone`, { timeout: 30000 }, async (t) => {
    const { git, clones } = fakeGit(c.stderr);
    const { ob, projectsDir, reposDir } = setup(t, git);
    await started(ob, c.data());
    assert.deepEqual(projectNames(projectsDir), [], 'the project list after the failed import');
    assert.deepEqual(entries(reposDir), [], '<workspace>/repos/ after the failed import');
    assert.equal(clones(), 0, 'git clone never ran');
  });
}

test('#107 a folder that is not a git repository: start answers failed with code not-a-git-repo', { timeout: 30000 }, async (t) => {
  const { ob } = setup(t, null); // the real git, on a local folder only
  const s = await started(ob, { name: 'Notes', repo: pathToFileURL(plainFolder(t)).href });
  assert.equal(s?.status, 'failed', `the state: ${JSON.stringify(s)}`);
  assert.equal(s.code, 'not-a-git-repo', `the cause (never "no access"): ${JSON.stringify(s)}`);
  assert.equal(s.projectId ?? null, null, 'no project id: nothing was created');
});

test('#107 a folder that is not a git repository: no project in the list, no folder in repos/', { timeout: 30000 }, async (t) => {
  const { ob, projectsDir, reposDir } = setup(t, null);
  const folder = plainFolder(t);
  await started(ob, { name: 'Notes', repo: pathToFileURL(folder).href });
  assert.deepEqual(projectNames(projectsDir), [], 'the project list after the failed import');
  assert.deepEqual(entries(reposDir), [], '<workspace>/repos/ after the failed import');
  assert.deepEqual(entries(folder), ['README.md'], 'the person\'s folder is left as it was');
});
