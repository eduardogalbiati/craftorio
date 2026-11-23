// #30: after the clone of an imported repository, the onboarding detects a lockfile with no installed
// dependencies and offers to install them (npm ci, with --ignore-scripts under the project's "ignore
// install scripts" setting), so the first run's rule checks can run. Acceptance tests written before
// the code.
//
// Contract (the interface these tests assume), packages/engine/service/areas/project-onboarding.js:
//   createOnboarding({ ..., install }) takes a new option
//     install: async (cmd, args, { cwd }) => { code, output }: runs the dependency install (the
//       process-spawn boundary; default: the real command, like packages/engine/engine/deps-cache.js).
//   The state gets `deps`, set in the same change that makes the state `ready` after the clone:
//     { status: 'missing', lockfile: 'package-lock.json', command: 'npm ci' | 'npm ci --ignore-scripts' }
//       when the clone has a lockfile and no node_modules; `command` honours the project's
//       ignoreInstallScripts (on by default for a repository the app clones, #472);
//     no lockfile: no `deps` (or a status other than 'missing').
//   installDeps(projectId) -> Promise<state>: runs install(cmd, args, { cwd: <the clone's folder> })
//     with the command of state.deps (cmd 'npm', args ['ci'] or ['ci', '--ignore-scripts']);
//     deps.status becomes 'installed' when it exits 0, 'failed' (with a one-line `reason`) otherwise.
//     The area exposes it as onboardingInstallDeps({ projectId }).
// Fakes: git (ls-remote and clone, as project-onboarding.test.js) and install; no network, no npm.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const loadArea = () => require('../service/areas/project-onboarding');
const projects = require('../domains/project/projects');

const GITHUB = 'https://github.com/acme/widgets.git';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-deps-30-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

async function until(ob, id, pred, what) {
  let last;
  for (let i = 0; i < 300; i++) {
    last = await ob.status(id);
    if (pred(last)) return last;
    await pause(10);
  }
  assert.fail(`${what}: still ${JSON.stringify(last)}`);
}

const PKG = JSON.stringify({ name: 'widgets', version: '1.0.0', scripts: { check: 'node check.js' } });
const LOCK = JSON.stringify({ name: 'widgets', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'widgets' } } });

// a fake git whose clone writes `files` into the clone's folder (args[2]), after `gate` when given
function fakeGit(files, gate) {
  return async (args) => {
    if (args[0] === 'ls-remote') return 'abc123\tHEAD\n';
    if (args[0] === 'clone') {
      if (gate) await gate.promise;
      fs.mkdirSync(path.join(args[2], '.git'), { recursive: true });
      for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(args[2], rel), text);
    }
    return '';
  };
}

function setup(t, { files = { 'package.json': PKG, 'package-lock.json': LOCK }, gate = null, code = 0 } = {}) {
  const root = tmp(t);
  const installs = [];
  const projectsDir = path.join(root, 'projects');
  const ob = loadArea().createOnboarding({
    projectsDir,
    reposDir: path.join(root, 'repos'),
    git: fakeGit(files, gate),
    cli: async () => ({ installed: true, signedIn: true }),
    jobs: {
      facts: async () => ({ commits: 1 }),
      profile: async () => ({ profile: { merge: 'local' } }),
      projectMap: async () => ({ findings: [] }),
    },
    slotsDir: path.join(root, 'locks'),
    // no gh on the test machine: the push permission is not read
    platformCli: async () => null,
    install: async (cmd, args, opts) => {
      installs.push({ cmd, args: [...args], cwd: opts && opts.cwd });
      if (code === 0) fs.mkdirSync(path.join(opts.cwd, 'node_modules'), { recursive: true });
      return { code, output: code === 0 ? 'added 1 package' : 'npm error code E401\nnpm error Unable to authenticate' };
    },
  });
  return { ob, installs, projectsDir };
}

const ready = (x) => x.status === 'ready';

test('#30 onboarding: a clone with a lockfile and no node_modules says its dependencies are missing', async (t) => {
  const { ob } = setup(t);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  const end = await until(ob, s.projectId, ready, 'the clone ends ready');
  assert.equal(end.deps && end.deps.status, 'missing');
  assert.equal(end.deps.lockfile, 'package-lock.json');
});

test('#30 onboarding: an imported repository (ignore install scripts on by default) offers npm ci --ignore-scripts', async (t) => {
  const { ob } = setup(t);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  const end = await until(ob, s.projectId, ready, 'the clone ends ready');
  assert.equal(end.deps && end.deps.command, 'npm ci --ignore-scripts');
});

test('#30 onboarding: with the project\'s ignore install scripts setting off, the offer is plain npm ci', async (t) => {
  const gate = deferred();
  const { ob, projectsDir } = setup(t, { gate });
  t.after(() => gate.resolve());
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  projects.updateProject(projectsDir, s.projectId, { ignoreInstallScripts: false });
  gate.resolve();
  const end = await until(ob, s.projectId, ready, 'the clone ends ready');
  assert.equal(end.deps && end.deps.command, 'npm ci');
});

test('#30 onboarding: a clone without a lockfile offers no install', async (t) => {
  const { ob } = setup(t, { files: { 'README.md': '# widgets\n' } });
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  const end = await until(ob, s.projectId, ready, 'the clone ends ready');
  assert.notEqual(end.deps && end.deps.status, 'missing');
});

test('#30 onboarding: installDeps runs npm ci --ignore-scripts in the clone and ends installed', async (t) => {
  const { ob, installs, projectsDir } = setup(t);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await until(ob, s.projectId, ready, 'the clone ends ready');
  await ob.installDeps(s.projectId);
  const end = await until(ob, s.projectId, (x) => x.deps && (x.deps.status === 'installed' || x.deps.status === 'failed'), 'the install ends');
  assert.equal(end.deps.status, 'installed');
  assert.equal(installs.length, 1);
  assert.equal(installs[0].cmd, 'npm');
  assert.equal(installs[0].args.join(' '), 'ci --ignore-scripts');
  assert.equal(path.resolve(installs[0].cwd), path.resolve(projects.readProject(projectsDir, s.projectId).folder));
});

test('#30 onboarding: a failed install ends failed with a one-line reason', async (t) => {
  const { ob } = setup(t, { code: 1 });
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await until(ob, s.projectId, ready, 'the clone ends ready');
  await ob.installDeps(s.projectId);
  const end = await until(ob, s.projectId, (x) => x.deps && (x.deps.status === 'installed' || x.deps.status === 'failed'), 'the install ends');
  assert.equal(end.deps.status, 'failed');
  assert.equal(typeof end.deps.reason, 'string');
  assert.equal(end.deps.reason.length > 0, true);
  assert.equal(end.deps.reason.includes('\n'), false, end.deps.reason);
});
