// #738: the push permission and the fork on GitLab (glab), packages/engine/service/areas/project-onboarding.js:
// `glab api projects/<encoded path>` (access_level >= 30 = push), `glab api user`, an existing fork reused
// (forked_from_project), else `glab repo fork <path> --clone=false`. The developer's own tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { createOnboarding } = require('../service/areas/project-onboarding');
const projects = require('../domains/project/projects');

const REPO = 'https://gitlab.com/acme/tools/widgets.git';
const FORK = 'https://gitlab.com/me/widgets';

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-gl-738-'));
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
const git = async (args, cwd) => {
  if (args[0] === 'ls-remote') return 'abc123\tHEAD\n';
  if (args[0] === 'clone') {
    fs.mkdirSync(args[2], { recursive: true });
    realGit(['init', '-q'], args[2]);
    realGit(['remote', 'add', 'origin', args[1]], args[2]);
    return '';
  }
  return realGit(args, cwd);
};

function fakeGlab({ level, groupLevel = null, forked = false }) {
  const calls = [];
  const json = (o) => ({ ok: true, out: JSON.stringify(o) });
  const forkJson = () => ({ path_with_namespace: 'me/widgets', web_url: FORK, forked_from_project: { path_with_namespace: 'acme/tools/widgets' } });
  const platformCli = async (provider, args) => {
    const a = args.map(String);
    calls.push({ provider, args: a });
    if (a[0] === 'api' && a[1] === 'projects/acme%2Ftools%2Fwidgets') {
      return json({ path_with_namespace: 'acme/tools/widgets', permissions: { project_access: level == null ? null : { access_level: level }, group_access: groupLevel == null ? null : { access_level: groupLevel } } });
    }
    if (a[0] === 'api' && a[1] === 'user') return json({ username: 'me' });
    if (a[0] === 'api' && a[1] === 'projects/me%2Fwidgets') return forked ? json(forkJson()) : { ok: false, out: '404 Project Not Found' };
    if (a[0] === 'repo' && a[1] === 'fork') { forked = true; return { ok: true, out: '✓ Created fork me/widgets' }; }
    return { ok: false, out: `unexpected glab ${a.join(' ')}` };
  };
  return { platformCli, calls, forks: () => calls.filter((c) => c.args[0] === 'repo' && c.args[1] === 'fork') };
}

function setup(t, glab) {
  const root = tmp(t);
  const projectsDir = path.join(root, 'projects');
  const ob = createOnboarding({
    projectsDir,
    reposDir: path.join(root, 'repos'),
    git,
    cli: async () => ({ installed: true, signedIn: true }),
    platformCli: glab.platformCli,
    jobs: {
      facts: async () => ({ commits: 3 }),
      profile: async () => ({ profile: { mode: 'remote', ci: 'pr+release', tests: 'unit' } }),
      projectMap: async () => ({ findings: [] }),
    },
    slotsDir: path.join(root, 'locks'),
  });
  return { ob, projectsDir };
}

test('#738 GitLab: Reporter access (20) means no push and a fork suggestion with the full project path', async (t) => {
  const glab = fakeGlab({ level: 20 });
  const { ob } = setup(t, glab);
  const s = await ob.start({ name: 'Widgets', repo: REPO });
  const done = await until(ob, s.projectId, (x) => x.fork, 'the fork suggestion');
  assert.equal(done.access.push, false);
  assert.equal(done.fork.repo, 'acme/tools/widgets');
  assert.equal(glab.calls.every((c) => c.provider === 'gitlab'), true);
});

test('#738 GitLab: Developer access through the group (30) means push, no suggestion', async (t) => {
  const glab = fakeGlab({ level: null, groupLevel: 30 });
  const { ob } = setup(t, glab);
  const s = await ob.start({ name: 'Widgets', repo: REPO });
  const done = await until(ob, s.projectId, (x) => x.access, 'the access');
  assert.equal(done.access.push, true);
  assert.equal(done.fork ?? null, null);
});

test('#738 GitLab: Create a fork runs glab repo fork, then origin = the fork and upstream = the original', async (t) => {
  const glab = fakeGlab({ level: 10 });
  const { ob, projectsDir } = setup(t, glab);
  const s = await ob.start({ name: 'Widgets', repo: REPO });
  await until(ob, s.projectId, (x) => x.status === 'ready' && x.fork?.status === 'suggested', 'ready with the suggestion');
  const after = await ob.fork(s.projectId);
  assert.equal(after.fork.status, 'created', JSON.stringify(after.fork));
  assert.deepEqual(glab.forks().map((c) => c.args), [['repo', 'fork', 'acme/tools/widgets', '--clone=false']]);
  const { folder } = projects.readProject(projectsDir, s.projectId);
  assert.equal(realGit(['remote', 'get-url', 'origin'], folder).trim(), `${FORK}.git`);
  assert.equal(realGit(['remote', 'get-url', 'upstream'], folder).trim(), REPO);
});

test('#738 GitLab: an existing fork of the project is reused, never forked again', async (t) => {
  const glab = fakeGlab({ level: 10, forked: true });
  const { ob } = setup(t, glab);
  const s = await ob.start({ name: 'Widgets', repo: REPO });
  await until(ob, s.projectId, (x) => x.status === 'ready' && x.fork?.status === 'suggested', 'ready with the suggestion');
  const after = await ob.fork(s.projectId);
  assert.equal(after.fork.status, 'reused');
  assert.equal(after.fork.url, FORK);
  assert.equal(glab.forks().length, 0);
});
