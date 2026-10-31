// #639 (onboarding step 2): the clone of a project's repository is a background job.
// packages/engine/domains/project/projects.js:
//   checkAccess(repo, { git }) -> { status: 'reachable' | 'no-access' | 'no-network', message? } (git ls-remote)
//   createProject(dir, { name, repo }, { git, reposDir }) returns at once with status 'cloning'; the clone ends
//     in 'ready' or 'failed' (with cloneError, the reason); a project on a local folder is 'ready' at once
//   readProject / listProjects: no status field (projects made before #639) reads 'ready'; a 'cloning' record
//     no job of this process is running (the app closed during the clone) reads 'failed'
//   retryClone(dir, id, { git }) on a 'failed' project removes the partial folder and goes back to 'cloning'
// The git is a fake (args, cwd) => Promise<stdout>: no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = '../domains/project/projects';
const load = () => require(MODULE);

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-job-639-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// a call that must return at once: fails the test instead of hanging when it waits for the clone
function soon(promise, what) {
  let timer;
  const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} waited for the clone instead of returning at once`)), 2000); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// the project once its clone job ended (status no longer 'cloning')
const { cloned: settled } = require('./project/clone-wait');

// a fake git: ls-remote answers `lsRemote` (a string, or an Error to reject with); clone runs `clone(args)`
function fakeGit({ lsRemote = 'abc123\tHEAD\n', clone } = {}) {
  const calls = [];
  const git = async (args, cwd) => {
    calls.push(args);
    if (args[0] === 'ls-remote') {
      if (lsRemote instanceof Error) throw lsRemote;
      return lsRemote;
    }
    if (args[0] === 'clone') return clone ? clone(args, cwd) : (fs.mkdirSync(path.join(args[2], '.git'), { recursive: true }), '');
    return '';
  };
  return { git, calls };
}

const cloneOk = (args) => { fs.mkdirSync(path.join(args[2], '.git'), { recursive: true }); return ''; };

// ---- checkAccess --------------------------------------------------------------------------------

test('#639 checkAccess runs git ls-remote on the repository and answers reachable', async () => {
  const { checkAccess } = load();
  for (const repo of ['https://github.com/acme/widgets.git', 'git@gitlab.com:acme/widgets.git']) {
    const { git, calls } = fakeGit();
    const out = await checkAccess(repo, { git });
    assert.equal(out.status, 'reachable', repo);
    const call = calls.find((a) => a[0] === 'ls-remote');
    assert.ok(call, `git ls-remote was run for ${repo}`);
    assert.ok(call.includes(repo), `ls-remote was given the URL ${repo}`);
    assert.equal(calls.some((a) => a[0] === 'clone'), false, 'the access check never clones');
  }
});

test('#639 checkAccess answers no-access for a GitHub or GitLab repository that is private or not found', async () => {
  const { checkAccess } = load();
  const errors = {
    'https://github.com/acme/secret.git': "remote: Repository not found.\nfatal: repository 'https://github.com/acme/secret.git/' not found",
    'https://github.com/acme/private.git': "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    'https://gitlab.com/acme/secret.git': "remote: The project you were looking for could not be found or you don't have permission to view it.\nfatal: repository 'https://gitlab.com/acme/secret.git/' not found",
    'https://gitlab.com/acme/private.git': "remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://gitlab.com/acme/private.git/'",
    'git@github.com:acme/secret.git': 'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
  };
  for (const [repo, stderr] of Object.entries(errors)) {
    const { git } = fakeGit({ lsRemote: new Error(stderr) });
    const out = await checkAccess(repo, { git });
    assert.equal(out.status, 'no-access', repo);
  }
});

test('#639 checkAccess answers no-network when the host cannot be reached', async () => {
  const { checkAccess } = load();
  const errors = {
    'https://github.com/acme/widgets.git': "fatal: unable to access 'https://github.com/acme/widgets.git/': Could not resolve host: github.com",
    'https://gitlab.com/acme/widgets.git': "fatal: unable to access 'https://gitlab.com/acme/widgets.git/': Failed to connect to gitlab.com port 443 after 21045 ms: Couldn't connect to server",
    'git@github.com:acme/widgets.git': 'ssh: Could not resolve hostname github.com: No such host is known.\nfatal: Could not read from remote repository.',
  };
  for (const [repo, stderr] of Object.entries(errors)) {
    const { git } = fakeGit({ lsRemote: new Error(stderr) });
    const out = await checkAccess(repo, { git });
    assert.equal(out.status, 'no-network', repo);
  }
});

// ---- the clone as a job -------------------------------------------------------------------------

test('#639 a project from a repository is created at once as cloning and ends ready when the clone succeeds', async (t) => {
  const projects = load();
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  const gate = deferred();
  const { git, calls } = fakeGit({ clone: async (args) => { await gate.promise; return cloneOk(args); } });

  const p = await soon(projects.createProject(dir, { name: 'Widgets', repo: 'https://github.com/acme/widgets.git' }, { git, reposDir: path.join(root, 'repos') }), 'createProject');
  assert.equal(p.status, 'cloning');
  assert.equal(projects.readProject(dir, p.id).status, 'cloning', 'the record says cloning while the clone runs');
  assert.equal(projects.listProjects(dir).find((x) => x.id === p.id)?.status, 'cloning');

  gate.resolve();
  const done = await settled(projects, dir, p.id);
  assert.equal(done.status, 'ready');
  assert.equal(done.isGit, true);
  assert.equal(done.folder, path.join(root, 'repos', 'acme-widgets'));
  assert.ok(calls.some((a) => a[0] === 'clone' && a.includes('https://github.com/acme/widgets.git')), 'the repository was cloned');
});

test('#639 a failing clone ends the project in failed with the reason', async (t) => {
  const projects = load();
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  const { git } = fakeGit({ clone: async () => { throw new Error('fatal: early EOF while receiving pack'); } });

  const p = await soon(projects.createProject(dir, { name: 'Broken', repo: 'https://gitlab.com/acme/broken.git' }, { git, reposDir: path.join(root, 'repos') }), 'createProject');
  const done = await settled(projects, dir, p.id);
  assert.equal(done.status, 'failed');
  assert.match(String(done.cloneError), /early EOF/, 'the reason of the failure is kept on the project');
});

test('#639 a project on a local folder is ready at once, with no clone', async (t) => {
  const projects = load();
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  const folder = path.join(root, 'mine');
  fs.mkdirSync(folder);
  const { git, calls } = fakeGit();

  const p = await projects.createProject(dir, { name: 'Mine', folder }, { git });
  assert.equal(p.status, 'ready');
  assert.equal(projects.readProject(dir, p.id).status, 'ready');
  assert.equal(calls.some((a) => a[0] === 'clone'), false);
});

test('#639 a project from a repository whose folder already is a git checkout is ready at once, with no clone', async (t) => {
  const projects = load();
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  const folder = path.join(root, 'checkout');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  const { git, calls } = fakeGit();

  const p = await projects.createProject(dir, { name: 'Checkout', folder, repo: 'https://github.com/acme/checkout.git' }, { git });
  assert.equal(p.status, 'ready');
  assert.equal(calls.some((a) => a[0] === 'clone'), false);
});

test('#639 a project saved before the change (no status field) reads as ready', (t) => {
  const projects = load();
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  const folder = path.join(root, 'old');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ name: 'Old', description: '', folder, repo: 'https://github.com/acme/old.git', createdAt: '2026-01-01T00:00:00.000Z' }, null, 2));

  assert.equal(projects.readProject(dir, 'old').status, 'ready');
  assert.equal(projects.listProjects(dir).find((x) => x.id === 'old')?.status, 'ready');
  // the Edit dialog's update keeps working on it
  assert.equal(projects.updateProject(dir, 'old', { description: 'edited' }).description, 'edited');
});

// ---- never half-created -------------------------------------------------------------------------

test('#639 a clone interrupted by the app closing reads as failed on the next start, never ready', async (t) => {
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  // the clone never ends in this "process": the app closes during it
  const { git } = fakeGit({ clone: () => new Promise(() => {}) });
  const p = await soon(load().createProject(dir, { name: 'Interrupted', repo: 'https://github.com/acme/big.git' }, { git, reposDir: path.join(root, 'repos') }), 'createProject');
  assert.equal(p.status, 'cloning');
  // a partial folder, as an interrupted clone leaves it
  fs.mkdirSync(path.join(p.folder, '.git'), { recursive: true });

  // the next start: a fresh copy of the module, with no clone job running
  delete require.cache[require.resolve(MODULE)];
  t.after(() => { delete require.cache[require.resolve(MODULE)]; });
  const restarted = require(MODULE);
  const read = restarted.readProject(dir, p.id);
  assert.equal(read.status, 'failed');
  assert.equal(restarted.listProjects(dir).find((x) => x.id === p.id)?.status, 'failed');
});

test('#639 a cloning record left by a previous process reads as failed', (t) => {
  const projects = load();
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'left.json'), JSON.stringify({ name: 'Left', description: '', folder: path.join(root, 'repos', 'acme-left'), repo: 'https://github.com/acme/left.git', status: 'cloning', createdAt: '2026-10-31T10:00:00.000Z' }, null, 2));

  assert.equal(projects.readProject(dir, 'left').status, 'failed');
  assert.equal(projects.listProjects(dir).find((x) => x.id === 'left')?.status, 'failed');
});

// ---- Retry --------------------------------------------------------------------------------------

test('#639 Retry on a failed project removes the partial folder, goes back to cloning and ends ready', async (t) => {
  const projects = load();
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  let attempt = 0;
  const leftovers = [];
  const gate = deferred();
  const { git } = fakeGit({
    clone: async (args) => {
      attempt++;
      const folder = args[2];
      if (attempt === 1) {
        // the first clone leaves a partial folder behind and fails
        fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
        fs.writeFileSync(path.join(folder, 'half.txt'), 'partial');
        throw new Error('fatal: the remote end hung up unexpectedly');
      }
      leftovers.push(fs.existsSync(path.join(folder, 'half.txt')));
      await gate.promise;
      return cloneOk(args);
    },
  });

  const p = await soon(projects.createProject(dir, { name: 'Flaky', repo: 'https://github.com/acme/flaky.git' }, { git, reposDir: path.join(root, 'repos') }), 'createProject');
  assert.equal((await settled(projects, dir, p.id)).status, 'failed');

  assert.equal(typeof projects.retryClone, 'function', 'projects.js exports retryClone');
  const retried = await soon(projects.retryClone(dir, p.id, { git }), 'retryClone');
  assert.equal(retried.status, 'cloning');
  assert.equal(projects.readProject(dir, p.id).status, 'cloning');

  gate.resolve();
  const done = await settled(projects, dir, p.id);
  assert.equal(done.status, 'ready');
  assert.equal(done.isGit, true);
  assert.equal(done.cloneError ?? null, null, 'the reason of the earlier failure is cleared');
  assert.deepEqual(leftovers, [false], 'the partial folder was removed before cloning again');
  assert.equal(fs.existsSync(path.join(done.folder, 'half.txt')), false);
});

test('#639 Retry is refused for a project that is ready', async (t) => {
  const projects = load();
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  const { git } = fakeGit();
  const p = await projects.createProject(dir, { name: 'Done', repo: 'https://github.com/acme/done.git' }, { git, reposDir: path.join(root, 'repos') });
  assert.equal((await settled(projects, dir, p.id)).status, 'ready');

  assert.equal(typeof projects.retryClone, 'function', 'projects.js exports retryClone');
  await assert.rejects(async () => projects.retryClone(dir, p.id, { git }));
  assert.equal(projects.readProject(dir, p.id).status, 'ready');
});

// ---- edits while the clone runs (review) --------------------------------------------------------

// collects the unhandled rejections raised while a test runs
function watchRejections(t) {
  const seen = [];
  const onRejection = (e) => seen.push(String(e?.message || e));
  process.on('unhandledRejection', onRejection);
  t.after(() => process.off('unhandledRejection', onRejection));
  return seen;
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

test('#639 a project removed while its clone runs stays removed when the clone ends, with no unhandled error', async (t) => {
  const projects = load();
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  const rejections = watchRejections(t);
  for (const outcome of ['succeeds', 'fails']) {
    const gate = deferred();
    const { git } = fakeGit({ clone: async (args) => { await gate.promise; if (outcome === 'fails') throw new Error('fatal: early EOF'); return cloneOk(args); } });
    const p = await soon(projects.createProject(dir, { name: `Gone ${outcome}`, repo: 'https://github.com/acme/gone.git' }, { git, reposDir: path.join(root, `repos-${outcome}`) }), 'createProject');
    assert.equal(projects.removeProject(dir, p.id), true);

    gate.resolve();
    await tick();
    assert.equal(fs.existsSync(path.join(dir, `${p.id}.json`)), false, `the clone that ${outcome} does not bring the record back`);
    assert.equal(projects.listProjects(dir).some((x) => x.id === p.id), false);
  }
  assert.deepEqual(rejections, []);
});

test('#639 an edit while the clone runs keeps the project cloning, and the clone\'s end keeps the edit', async (t) => {
  const projects = load();
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  const gate = deferred();
  const { git } = fakeGit({ clone: async (args) => { await gate.promise; return cloneOk(args); } });
  const p = await soon(projects.createProject(dir, { name: 'Moving', repo: 'https://github.com/acme/moving.git' }, { git, reposDir: path.join(root, 'repos') }), 'createProject');
  const cloneFolder = p.folder;

  const own = path.join(root, 'own-checkout');
  fs.mkdirSync(own);
  const edited = projects.updateProject(dir, p.id, { folder: own, description: 'edited while cloning' });
  assert.equal(edited.status, 'cloning', 'a folder change does not end a clone that still runs');
  assert.equal(projects.readProject(dir, p.id).status, 'cloning');

  gate.resolve();
  const done = await settled(projects, dir, p.id);
  assert.equal(done.status, 'ready');
  assert.equal(done.folder, path.resolve(own), 'the folder the owner chose is kept');
  assert.equal(done.description, 'edited while cloning');
  assert.deepEqual(done.previousFolders, [cloneFolder]);
  assert.equal(done.cloneError ?? null, null);
});
