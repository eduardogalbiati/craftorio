// #126: "Create a fork" while the clone still runs (packages/engine/service/areas/project-onboarding.js).
// Acceptance tests, written before the code.
//
// The interface these tests assume (createOnboarding as in project-onboarding-fork-738.test.js):
// - fork(projectId) makes or reuses the owner's fork (gh repo fork / the reused fork) at once, while the clone
//   goes on: the state (status(projectId)) shows fork: { status: 'created' | 'reused', url } before the clone
//   ends; only `git remote` (origin = the fork, upstream = the original) waits for the clone.
// - a fork that fails shows fork: { status: 'failed', reason } at once, not after the clone, and the remotes
//   are left as cloned.
// fork() may resolve before or after the clone ends: the tests only read the state and the clone's remotes.
// git: the clone is held until the test releases it (then a real `git init` with origin = the repository),
// every other git call is real; gh is faked (the boundary).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const loadArea = () => require('../service/areas/project-onboarding');
const projects = require('../domains/project/projects');

const GITHUB = 'https://github.com/acme/widgets.git';
const ORIGINAL = 'https://github.com/acme/widgets';
const FORK = 'https://github.com/me/widgets';

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-126-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(read, pred, what) {
  let last;
  for (let i = 0; i < 300; i++) {
    last = await read();
    if (pred(last)) return last;
    await pause(10);
  }
  assert.fail(`${what}: still ${JSON.stringify(last)}`);
}

const realGit = (args, cwd) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

// a git whose clone waits for release(); `events` records the order of the clone's end, gh repo fork and the
// remote changes
function heldGit(events) {
  let release;
  const gate = new Promise((r) => { release = r; });
  let cloneStarted = false;
  const git = async (args, cwd) => {
    if (args[0] === 'ls-remote') return 'abc123\tHEAD\n';
    if (args[0] === 'clone') {
      cloneStarted = true;
      await gate;
      const url = args[args.length - 2];
      const dest = args[args.length - 1];
      fs.mkdirSync(dest, { recursive: true });
      realGit(['init', '-q'], dest);
      realGit(['remote', 'add', 'origin', url], dest);
      events.push('clone-done');
      return '';
    }
    if (args[0] === 'remote' && args.length > 1) events.push(`remote ${args[1]} ${args[2]}`);
    return realGit(args, cwd);
  };
  return { git, release: () => release(), started: () => cloneStarted };
}

// a fake gh: the repository's permissions, the signed-in user, the user's fork (when `forked`), repo fork
// (failing with `forkFails` when set)
function fakeGh(events, { forked = false, forkFails = null } = {}) {
  const calls = [];
  const json = (o) => ({ ok: true, out: JSON.stringify(o) });
  const forkJson = { full_name: 'me/widgets', fork: true, parent: { full_name: 'acme/widgets' }, html_url: FORK, clone_url: `${FORK}.git`, default_branch: 'main', permissions: { push: true, admin: true } };
  const platformCli = async (provider, args) => {
    const a = args.map(String);
    calls.push({ provider, args: a });
    const api = a[0] === 'api' ? a.find((x, i) => i > 0 && !x.startsWith('-')) : null;
    if (api && /^\/?repos\/acme\/widgets$/.test(api)) return json({ full_name: 'acme/widgets', fork: false, html_url: ORIGINAL, clone_url: GITHUB, default_branch: 'main', permissions: { push: false, pull: true, admin: false } });
    if (api && /^\/?user$/.test(api)) return json({ login: 'me' });
    if (api && /^\/?repos\/me\/widgets$/.test(api)) { if (forked) events.push('fork-reused'); return forked ? json(forkJson) : { ok: false, out: 'gh: Not Found (HTTP 404)' }; }
    if (a[0] === 'repo' && a[1] === 'view' && a.includes('me/widgets')) { if (forked) events.push('fork-reused'); return forked ? json(forkJson) : { ok: false, out: 'GraphQL: Could not resolve to a Repository' }; }
    if (a[0] === 'repo' && a[1] === 'fork') {
      events.push('gh-fork');
      if (forkFails) return { ok: false, out: forkFails };
      forked = true;
      return { ok: true, out: `✓ Created fork me/widgets\n${FORK}\n` };
    }
    return { ok: false, out: `unexpected gh ${a.join(' ')}` };
  };
  return { platformCli, forks: () => calls.filter((c) => c.args[0] === 'repo' && c.args[1] === 'fork').length };
}

function setup(t, opts = {}) {
  const events = [];
  const root = tmp(t);
  const projectsDir = path.join(root, 'projects');
  const held = heldGit(events);
  const gh = fakeGh(events, opts);
  const ob = loadArea().createOnboarding({
    projectsDir,
    reposDir: path.join(root, 'repos'),
    git: held.git,
    cli: async () => ({ installed: true, signedIn: true }),
    platformCli: gh.platformCli,
    jobs: {
      facts: async () => ({ commits: 3 }),
      profile: async () => ({ profile: { mode: 'remote', ci: 'pr+release', tests: 'unit' } }),
      projectMap: async () => ({ findings: [] }),
    },
    slotsDir: path.join(root, 'locks'),
  });
  // a test that fails before releasing the clone must not leave the clone (and the test process) waiting
  t.after(() => held.release());
  return { ob, projectsDir, events, gh, held };
}

const remoteUrl = (folder, name) => realGit(['remote', 'get-url', name], folder).trim().replace(/\.git$/, '');

// the import started, the fork suggested, the clone still held
async function suggestedWhileCloning(ctx) {
  const s = await ctx.ob.start({ name: 'Widgets', repo: GITHUB });
  await until(() => ctx.ob.status(s.projectId), (x) => x?.fork?.status === 'suggested', 'the fork suggestion while the clone runs');
  await until(async () => ctx.held.started(), Boolean, 'the clone started');
  assert.equal(ctx.events.includes('clone-done'), false, 'the clone is still running');
  return s.projectId;
}

test('#126 Create a fork while the clone runs: gh repo fork runs and the state shows the fork before the clone ends', async (t) => {
  const ctx = setup(t);
  const id = await suggestedWhileCloning(ctx);
  const forking = Promise.resolve(ctx.ob.fork(id)).catch((e) => e);
  const shown = await until(() => ctx.ob.status(id), (x) => x?.fork?.status === 'created', 'the fork shown while the clone runs');
  assert.equal(ctx.gh.forks(), 1);
  assert.equal(String(shown.fork.url).replace(/\.git$/, ''), FORK);
  assert.equal(ctx.events.includes('clone-done'), false, 'the fork came before the clone ended');
  assert.equal(ctx.events.some((e) => e.startsWith('remote ')), false, 'no remote changed before the clone ended');
  ctx.held.release();
  await forking;
  const { folder } = projects.readProject(ctx.projectsDir, id);
  await until(async () => (fs.existsSync(folder) ? remoteUrl(folder, 'origin') : null), (u) => u === FORK, 'origin is the fork once the clone ends');
  assert.equal(remoteUrl(folder, 'upstream'), ORIGINAL);
  assert.equal(ctx.gh.forks(), 1, 'the fork is not made a second time after the clone');
});

test('#126 the remotes change only after the clone ends, the fork command before it', async (t) => {
  const ctx = setup(t);
  const id = await suggestedWhileCloning(ctx);
  const forking = Promise.resolve(ctx.ob.fork(id)).catch((e) => e);
  await until(async () => ctx.events.includes('gh-fork'), Boolean, 'gh repo fork while the clone runs');
  ctx.held.release();
  await forking;
  const { folder } = projects.readProject(ctx.projectsDir, id);
  await until(async () => (fs.existsSync(folder) ? remoteUrl(folder, 'origin') : null), (u) => u === FORK, 'origin is the fork');
  const at = (pred) => ctx.events.findIndex(pred);
  const cloneDone = at((e) => e === 'clone-done');
  assert.ok(at((e) => e === 'gh-fork') < cloneDone, ctx.events.join(', '));
  assert.ok(at((e) => e.startsWith('remote ')) > cloneDone, ctx.events.join(', '));
});

test('#126 the owner\'s existing fork is reused at once, while the clone runs, with no gh repo fork', async (t) => {
  const ctx = setup(t, { forked: true });
  const id = await suggestedWhileCloning(ctx);
  const forking = Promise.resolve(ctx.ob.fork(id)).catch((e) => e);
  const shown = await until(() => ctx.ob.status(id), (x) => x?.fork?.status === 'reused', 'the reused fork shown while the clone runs');
  assert.equal(String(shown.fork.url).replace(/\.git$/, ''), FORK);
  assert.equal(ctx.events.includes('clone-done'), false, 'the fork was reused before the clone ended');
  ctx.held.release();
  await forking;
  const { folder } = projects.readProject(ctx.projectsDir, id);
  await until(async () => (fs.existsSync(folder) ? remoteUrl(folder, 'origin') : null), (u) => u === FORK, 'origin is the reused fork');
  assert.equal(remoteUrl(folder, 'upstream'), ORIGINAL);
  assert.equal(ctx.gh.forks(), 0);
});

test('#126 a fork that fails shows its reason at once, before the clone ends, and the remotes stay as cloned', async (t) => {
  const ctx = setup(t, { forkFails: 'HTTP 403: forking is disabled for this repository' });
  const id = await suggestedWhileCloning(ctx);
  const forking = Promise.resolve(ctx.ob.fork(id)).catch((e) => e);
  const failed = await until(() => ctx.ob.status(id), (x) => x?.fork?.status === 'failed', 'the failure shown while the clone runs');
  assert.equal(String(failed.fork.reason).includes('HTTP 403: forking is disabled'), true, JSON.stringify(failed.fork));
  assert.equal(ctx.events.includes('clone-done'), false, 'the failure came before the clone ended');
  ctx.held.release();
  await forking;
  const { folder } = projects.readProject(ctx.projectsDir, id);
  await until(() => ctx.ob.status(id), (x) => x?.jobs?.clone?.status === 'done' || x?.status === 'ready' || x?.status === 'analyzing', 'the clone ends');
  assert.equal(remoteUrl(folder, 'origin'), ORIGINAL);
  assert.equal(ctx.events.some((e) => e.startsWith('remote ')), false, 'no remote changed after a failed fork');
  assert.equal((await ctx.ob.status(id)).fork.status, 'failed', 'the owner can still try again or work locally');
});
