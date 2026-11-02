// #738: importing a repository the owner cannot push to (packages/engine/service/areas/project-onboarding.js).
// Acceptance tests, written before the code.
//
// The interface these tests assume (createOnboarding's options as in project-onboarding.test.js, plus):
// - platformCli: async (provider, args, { cwd }) → { ok, out }: the gh / glab process, the boundary these
//   tests replace (default: the machine's gh / glab). The access check asks it for the repository's
//   permissions (`gh api repos/<owner>/<repo>`, the REST JSON answer, no --jq).
// - the state gains access: { push: boolean } once read; without push: fork: { status: 'suggested',
//   repo: '<owner>/<repo>' } and the profile job's profile says mode 'fork' (external contribution); with
//   push: no `fork` in the state.
// - fork(projectId) → Promise<state>: "Create a fork": reuses the owner's fork of the repository when it
//   exists (`gh api repos/<login>/<repo>` answers fork: true with that parent; the login from `gh api user`),
//   else runs `gh repo fork <owner>/<repo>` (never --remote: the remotes are set with git); then, in the
//   project's clone, origin = the fork and upstream = the original. State: fork: { status: 'created' |
//   'reused', url }.
// - workLocally(projectId) → Promise<state>: "Work locally": fork: { status: 'declined' }, profile mode local.
// git: the clone is faked (a real `git init` with origin = the repository), every other git call is real.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-738-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(ob, id, pred, what) {
  let last;
  for (let i = 0; i < 300; i++) {
    last = await ob.status(id);
    if (pred(last)) return last;
    await pause(10);
  }
  assert.fail(`${what}: still ${JSON.stringify(last)}`);
}

const realGit = (args, cwd) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

// ls-remote answers reachable, clone makes a real repository with origin = the URL, the rest is real git
const git = async (args, cwd) => {
  if (args[0] === 'ls-remote') return 'abc123\tHEAD\n';
  if (args[0] === 'clone') {
    const [, url, dest] = args;
    fs.mkdirSync(dest, { recursive: true });
    realGit(['init', '-q'], dest);
    realGit(['remote', 'add', 'origin', url], dest);
    return '';
  }
  return realGit(args, cwd);
};

// a fake gh: the repository's permissions, the signed-in user, the user's fork (when `forked`), repo fork
function fakeGh({ push, forked = false }) {
  const calls = [];
  const json = (o) => ({ ok: true, out: JSON.stringify(o) });
  const forkJson = { full_name: 'me/widgets', fork: true, parent: { full_name: 'acme/widgets' }, html_url: FORK, clone_url: `${FORK}.git`, default_branch: 'main', permissions: { push: true, admin: true } };
  const platformCli = async (provider, args) => {
    calls.push({ provider, args: args.map(String) });
    const a = args.map(String);
    const api = a[0] === 'api' ? a.find((x, i) => i > 0 && !x.startsWith('-')) : null;
    if (api && /^\/?repos\/acme\/widgets$/.test(api)) return json({ full_name: 'acme/widgets', fork: false, html_url: ORIGINAL, clone_url: GITHUB, default_branch: 'main', permissions: { push, pull: true, admin: false } });
    if (api && /^\/?user$/.test(api)) return json({ login: 'me' });
    if (api && /^\/?repos\/me\/widgets$/.test(api)) return forked ? json(forkJson) : { ok: false, out: 'gh: Not Found (HTTP 404)' };
    if (a[0] === 'repo' && a[1] === 'view' && a.includes('me/widgets')) return forked ? json(forkJson) : { ok: false, out: 'GraphQL: Could not resolve to a Repository' };
    if (a[0] === 'repo' && a[1] === 'fork') { forked = true; return { ok: true, out: `✓ Created fork me/widgets\n${FORK}\n` }; }
    return { ok: false, out: `unexpected gh ${a.join(' ')}` };
  };
  return { platformCli, calls, forks: () => calls.filter((c) => c.args[0] === 'repo' && c.args[1] === 'fork').length };
}

function setup(t, gh) {
  const root = tmp(t);
  const projectsDir = path.join(root, 'projects');
  const ob = loadArea().createOnboarding({
    projectsDir,
    reposDir: path.join(root, 'repos'),
    git,
    cli: async () => ({ installed: true, signedIn: true }),
    platformCli: gh.platformCli,
    jobs: {
      facts: async () => ({ commits: 3 }),
      profile: async () => ({ profile: { mode: 'remote', ci: 'pr+release', tests: 'unit' } }),
      projectMap: async () => ({ findings: [] }),
    },
    slotsDir: path.join(root, 'locks'),
  });
  return { ob, projectsDir };
}

const remoteUrl = (folder, name) => realGit(['remote', 'get-url', name], folder).trim().replace(/\.git$/, '');
const profileDone = (s) => s.jobs?.profile?.status === 'done';

test('#738 the access check reads the push permission through gh api repos/<owner>/<repo>', async (t) => {
  const gh = fakeGh({ push: false });
  const { ob } = setup(t, gh);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await until(ob, s.projectId, (x) => x.access && typeof x.access.push === 'boolean', 'the push permission is read');
  assert.equal(gh.calls.some((c) => c.provider === 'github' && c.args[0] === 'api' && c.args.some((x) => /^\/?repos\/acme\/widgets$/.test(x))), true, JSON.stringify(gh.calls));
});

test('#738 no push permission: the state suggests a fork and the profile says mode fork; nothing is forked yet', async (t) => {
  const gh = fakeGh({ push: false });
  const { ob } = setup(t, gh);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  const done = await until(ob, s.projectId, (x) => profileDone(x) && x.fork, 'the profile and the fork suggestion');
  assert.equal(done.access.push, false);
  assert.equal(done.fork.status, 'suggested');
  assert.equal(done.fork.repo, 'acme/widgets');
  assert.equal(done.jobs.profile.profile.mode, 'fork');
  assert.equal(gh.forks(), 0, 'no fork before the owner asks for one');
});

test('#738 guard: with push permission there is no fork suggestion and the profile keeps its mode', async (t) => {
  const gh = fakeGh({ push: true });
  const { ob } = setup(t, gh);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  const done = await until(ob, s.projectId, (x) => profileDone(x) && x.access, 'the profile and the access');
  assert.equal(done.access.push, true);
  assert.equal(done.fork ?? null, null);
  assert.equal(done.jobs.profile.profile.mode, 'remote');
});

test('#738 Create a fork: runs gh repo fork once, then origin is the fork and upstream the original', async (t) => {
  const gh = fakeGh({ push: false });
  const { ob, projectsDir } = setup(t, gh);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await until(ob, s.projectId, (x) => x.status === 'ready' && x.fork?.status === 'suggested', 'ready with the suggestion');
  const after = await ob.fork(s.projectId);
  assert.equal(gh.forks(), 1);
  const forkCall = gh.calls.find((c) => c.args[0] === 'repo' && c.args[1] === 'fork');
  assert.equal(forkCall.args.includes('acme/widgets') || forkCall.args.some((x) => /acme\/widgets/.test(x)), true, JSON.stringify(forkCall));
  assert.equal(after.fork.status, 'created');
  const { folder } = projects.readProject(projectsDir, s.projectId);
  assert.equal(remoteUrl(folder, 'origin'), FORK);
  assert.equal(remoteUrl(folder, 'upstream'), ORIGINAL);
});

test('#738 Create a fork with the owner\'s fork already there: it is reused, no second fork', async (t) => {
  const gh = fakeGh({ push: false, forked: true });
  const { ob, projectsDir } = setup(t, gh);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await until(ob, s.projectId, (x) => x.status === 'ready' && x.fork?.status === 'suggested', 'ready with the suggestion');
  const after = await ob.fork(s.projectId);
  assert.equal(gh.forks(), 0, 'gh repo fork never ran');
  assert.equal(after.fork.status, 'reused');
  const { folder } = projects.readProject(projectsDir, s.projectId);
  assert.equal(remoteUrl(folder, 'origin'), FORK);
  assert.equal(remoteUrl(folder, 'upstream'), ORIGINAL);
});

test('#738 Work locally: no fork, origin stays the original, the profile mode is local', async (t) => {
  const gh = fakeGh({ push: false });
  const { ob, projectsDir } = setup(t, gh);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await until(ob, s.projectId, (x) => profileDone(x) && x.fork?.status === 'suggested', 'the profile and the suggestion');
  const after = await ob.workLocally(s.projectId);
  assert.equal(after.fork.status, 'declined');
  assert.equal(after.jobs.profile.profile.mode, 'local');
  assert.equal(gh.forks(), 0);
  const { folder } = projects.readProject(projectsDir, s.projectId);
  assert.equal(remoteUrl(folder, 'origin'), ORIGINAL);
});
