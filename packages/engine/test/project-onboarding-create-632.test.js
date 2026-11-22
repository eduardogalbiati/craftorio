// #632 (spec docs/work/first-project-onboarding/spec.md R4 / D5, mock-3): "Create new project" in the
// onboarding: git init, README + .gitignore, a first commit on main, an optional PRIVATE remote on GitHub /
// GitLab (gh / glab repo create --private) only when that CLI is signed in, and the three answers (where
// changes land, CI, release style) as the project's profile. Acceptance tests, written before the code.
//
// Contract (the interface these tests assume):
// - packages/shared/platforms/github.js and gitlab.js: repoCreateCommand({ name, folder }) -> { cli, args }:
//   gh repo create <name> --private --source <folder>; glab repo create <name> --private; never --public.
// - packages/engine/service/areas/project-onboarding.js createOnboarding({ ..., remote }) where
//   remote(provider, { name, folder }) -> Promise<{ ok, url?, error? }> runs gh / glab (a fake here), and the
//   returned object gains create({ name, starts, remote, answers }) -> Promise<state>:
//     name required; starts 'readme' (default) | 'empty'; remote null | { provider: 'github' | 'gitlab' };
//     answers { mode: 'local' | 'remote', ci: 'none' | 'release' | 'pr+release',
//               release: 'milestone' | 'per-merge' | 'train' | 'rc-stable' } (packages/shared/onboarding-model.js)
//   the project <projectsDir>/<slug>.json with its folder <projectsDir>/<slug>; no clone; the state
//   { projectId, status: 'ready', jobs: { profile: { status: 'done', profile: { mode, ci, release, ... } } },
//     remote?: { provider, status: 'signed-out' | 'missing' | 'failed' | ..., reason? } }.
//   The ctx module exposes onboardingCreate(data) -> onboarding().create(data).
// - packages/engine/service/channels/onboarding.js: { channel: 'onboarding:create', method: 'createOnboarding',
//   params: 'data', fn: (data) => ctx.onboardingCreate(data) }.
// git runs for real here (an isolated config: no machine or user git config, a fixed identity).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const projects = require('../domains/project/projects');
const channels = require('../service/channels/onboarding');

const loadArea = () => require('../service/areas/project-onboarding');
const github = () => require('@craftorio/shared/platforms/github');
const gitlab = () => require('@craftorio/shared/platforms/gitlab');

const ANSWERS = { mode: 'local', ci: 'release', release: 'milestone' };
const SIGNED_IN = async () => ({ installed: true, signedIn: true });

function tmp(t, prefix = 'onboarding-632-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

// git with no system / global config of this machine and a fixed identity
function gitEnv(root) {
  const config = path.join(root, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: config,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
}

// the area's git: (args, cwd) => Promise<stdout>, real git, recording each call's args
function realGit(root) {
  const env = gitEnv(root);
  const calls = [];
  const git = (args, cwd) => new Promise((resolve, reject) => {
    calls.push([...args]);
    execFile('git', ['-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8', windowsHide: true }, (e, out, err) => {
      if (e) { e.message = `${e.message}\n${err || ''}`; reject(e); } else resolve(out);
    });
  });
  return { git, calls, env };
}

// reads a folder with git (sync): its stdout trimmed, or null when git fails
function inspect(env, folder, args) {
  try {
    return execFileSync('git', args, { cwd: folder, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch { return null; }
}

function fakeJobs() {
  const calls = { facts: 0, profile: 0, projectMap: 0, ranking: 0 };
  const job = (name, result) => async () => { calls[name] += 1; return result; };
  return {
    calls,
    jobs: {
      facts: job('facts', { commits: 0, authors: 0 }),
      profile: job('profile', { profile: { merge: 'local' } }),
      projectMap: job('projectMap', { findings: [] }),
      ranking: job('ranking', { list: [] }),
    },
  };
}

// a fake remote (the system boundary that runs gh / glab repo create): records each call and, when given
// `env`, the number of commits of the folder at that moment
function fakeRemote(answer = { ok: true, url: 'https://github.com/eduardo/field-notes' }, env = null) {
  const calls = [];
  const remote = async (provider, opts) => {
    calls.push({ provider, name: opts?.name, folder: opts?.folder, commits: env ? inspect(env, opts?.folder, ['rev-list', '--count', 'HEAD']) : null });
    return typeof answer === 'function' ? answer(provider, opts) : answer;
  };
  return { remote, calls };
}

function setup(t, { cli = SIGNED_IN, remote = fakeRemote() } = {}) {
  const root = tmp(t);
  const { git, calls, env } = realGit(root);
  const projectsDir = path.join(root, 'projects');
  const events = [];
  const ob = loadArea().createOnboarding({
    projectsDir,
    reposDir: path.join(root, 'repos'),
    git,
    cli,
    jobs: fakeJobs().jobs,
    slotsDir: path.join(root, 'locks'),
    emit: (event, payload) => events.push({ event, payload: JSON.parse(JSON.stringify(payload)) }),
    remote: remote.remote,
  });
  return { ob, root, projectsDir, gitCalls: calls, env, remote, events };
}

const create = (ob, over = {}) => ob.create({ name: 'Field Notes', starts: 'readme', remote: null, answers: { ...ANSWERS }, ...over });
const folderOf = (projectsDir, id) => projects.readProject(projectsDir, id).folder;

// ---- the platform adapters ------------------------------------------------------------------------

test('#632 repoCreateCommand (github): gh repo create <name> --private', () => {
  const { cli, args } = github().repoCreateCommand({ name: 'field-notes', folder: 'C:/ws/projects/field-notes' });
  assert.equal(cli, 'gh');
  assert.deepEqual(args.slice(0, 3), ['repo', 'create', 'field-notes']);
  assert.equal(args.includes('--private'), true, `the args: ${JSON.stringify(args)}`);
});

test('#632 repoCreateCommand (github): the local folder is the source (--source <folder>)', () => {
  const folder = 'C:/ws/projects/field-notes';
  const { args } = github().repoCreateCommand({ name: 'field-notes', folder });
  const i = args.indexOf('--source');
  const given = i >= 0 ? args[i + 1] : (args.find((a) => String(a).startsWith('--source=')) || '').slice('--source='.length);
  assert.equal(given, folder, `the args: ${JSON.stringify(args)}`);
});

test('#632 repoCreateCommand (gitlab): glab repo create <name> --private', () => {
  const { cli, args } = gitlab().repoCreateCommand({ name: 'field-notes', folder: 'C:/ws/projects/field-notes' });
  assert.equal(cli, 'glab');
  assert.deepEqual(args.slice(0, 3), ['repo', 'create', 'field-notes']);
  assert.equal(args.includes('--private'), true, `the args: ${JSON.stringify(args)}`);
});

test('#632 repoCreateCommand never asks for a public repository (neither gh nor glab)', () => {
  for (const platform of [github(), gitlab()]) {
    const { args } = platform.repoCreateCommand({ name: 'field-notes', folder: 'C:/ws/projects/field-notes' });
    assert.equal(args.some((a) => /public/i.test(String(a))), false, `the args: ${JSON.stringify(args)}`);
  }
});

// ---- create: the local repository -----------------------------------------------------------------

test('#632 create: the project "Field Notes" is field-notes, its folder <projectsDir>/field-notes', async (t) => {
  const { ob, projectsDir } = setup(t);
  const s = await create(ob);
  assert.equal(s.projectId, 'field-notes');
  assert.equal(path.resolve(folderOf(projectsDir, 'field-notes')), path.resolve(projectsDir, 'field-notes'));
});

test('#632 create (README and .gitignore): the folder is a git repository on branch main', async (t) => {
  const { ob, projectsDir, env } = setup(t);
  await create(ob);
  assert.equal(inspect(env, folderOf(projectsDir, 'field-notes'), ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
});

test('#632 create (README and .gitignore): exactly one commit', async (t) => {
  const { ob, projectsDir, env } = setup(t);
  await create(ob);
  assert.equal(inspect(env, folderOf(projectsDir, 'field-notes'), ['rev-list', '--count', 'HEAD']), '1');
});

test('#632 create (README and .gitignore): the commit holds README.md and .gitignore, nothing else', async (t) => {
  const { ob, projectsDir, env } = setup(t);
  await create(ob);
  const files = (inspect(env, folderOf(projectsDir, 'field-notes'), ['ls-tree', '-r', '--name-only', 'HEAD']) || '').split(/\r?\n/).filter(Boolean).sort();
  assert.deepEqual(files, ['.gitignore', 'README.md']);
});

test('#632 create: with no `starts` the project starts with README and .gitignore (one commit)', async (t) => {
  const { ob, projectsDir, env } = setup(t);
  await ob.create({ name: 'Field Notes', remote: null, answers: { ...ANSWERS } });
  const folder = folderOf(projectsDir, 'field-notes');
  assert.equal(inspect(env, folder, ['rev-list', '--count', 'HEAD']), '1');
  assert.equal(fs.existsSync(path.join(folder, 'README.md')), true);
});

test('#632 create (Empty): git init only, HEAD is refs/heads/main', async (t) => {
  const { ob, projectsDir, env } = setup(t);
  await create(ob, { starts: 'empty' });
  assert.equal(inspect(env, folderOf(projectsDir, 'field-notes'), ['symbolic-ref', 'HEAD']), 'refs/heads/main');
});

test('#632 create (Empty): no commit and no README.md', async (t) => {
  const { ob, projectsDir, env } = setup(t);
  await create(ob, { starts: 'empty' });
  const folder = folderOf(projectsDir, 'field-notes');
  assert.equal(inspect(env, folder, ['rev-parse', '--verify', '--quiet', 'HEAD']), null, 'HEAD names no commit');
  assert.equal(fs.existsSync(path.join(folder, 'README.md')), false);
});

test('#632 create: nothing is cloned (no git clone, no ls-remote)', async (t) => {
  const { ob, gitCalls } = setup(t);
  await create(ob);
  assert.deepEqual(gitCalls.filter((a) => a[0] === 'clone' || a[0] === 'ls-remote').map((a) => a[0]), []);
});

test('#632 create: a missing or blank name is refused and no project is made', async (t) => {
  const { ob, projectsDir } = setup(t);
  assert.equal(typeof ob.create, 'function', 'onboarding.create');
  for (const name of [undefined, '', '   ']) {
    await assert.rejects(async () => ob.create({ name, starts: 'readme', remote: null, answers: { ...ANSWERS } }), `the name ${JSON.stringify(name)}`);
  }
  assert.deepEqual(projects.listProjects(projectsDir).map((p) => p.id), []);
});

for (const [key, bad] of [['mode', 'cloud'], ['ci', 'nightly'], ['release', 'weekly']]) {
  test(`#632 create: an answer outside its values is refused (${key}: '${bad}')`, async (t) => {
    const { ob } = setup(t);
    assert.equal(typeof ob.create, 'function', 'onboarding.create');
    await assert.rejects(async () => create(ob, { answers: { ...ANSWERS, [key]: bad } }));
  });
}

// ---- create: the onboarding state ------------------------------------------------------------------

test('#632 create resolves to the onboarding state, ready, with no clone', async (t) => {
  const { ob } = setup(t);
  const s = await create(ob);
  assert.equal(s.projectId, 'field-notes');
  assert.equal(s.status, 'ready');
});

test('#632 create: the profile job is done and carries the three answers', async (t) => {
  const { ob } = setup(t);
  const s = await create(ob, { answers: { mode: 'remote', ci: 'pr+release', release: 'train' } });
  assert.equal(s.jobs?.profile?.status, 'done');
  const p = s.jobs?.profile?.profile || {};
  assert.deepEqual({ mode: p.mode, ci: p.ci, release: p.release }, { mode: 'remote', ci: 'pr+release', release: 'train' });
});

test('#632 status(projectId) answers the created project\'s state afterwards', async (t) => {
  const { ob } = setup(t);
  await create(ob);
  const s = await ob.status('field-notes');
  assert.equal(s.status, 'ready');
  const p = s.jobs?.profile?.profile || {};
  assert.deepEqual({ mode: p.mode, ci: p.ci, release: p.release }, { mode: 'local', ci: 'release', release: 'milestone' });
});

// ---- create: the private remote -------------------------------------------------------------------

test('#632 remote (gh signed in): the remote is created once, for field-notes from its folder', async (t) => {
  const { ob, projectsDir, remote } = setup(t);
  await create(ob, { remote: { provider: 'github' } });
  assert.equal(remote.calls.length, 1);
  const [c] = remote.calls;
  assert.deepEqual({ provider: c.provider, name: c.name }, { provider: 'github', name: 'field-notes' });
  assert.equal(path.resolve(String(c.folder)), path.resolve(folderOf(projectsDir, 'field-notes')));
});

test('#632 remote (gh signed in): it is created after the first commit', async (t) => {
  const root = tmp(t, 'onboarding-632-env-');
  const remote = fakeRemote({ ok: true, url: 'https://github.com/eduardo/field-notes' }, gitEnv(root));
  const { ob } = setup(t, { remote });
  await create(ob, { remote: { provider: 'github' } });
  assert.deepEqual(remote.calls.map((c) => c.commits), ['1']);
});

test('#632 remote (gh signed in): the project\'s repo becomes the created repository\'s url', async (t) => {
  const { ob, projectsDir } = setup(t);
  await create(ob, { remote: { provider: 'github' } });
  assert.equal(projects.readProject(projectsDir, 'field-notes').repo, 'https://github.com/eduardo/field-notes');
});

test('#632 remote (glab signed in): GitLab is asked with its own provider', async (t) => {
  const { ob, remote } = setup(t, { remote: fakeRemote({ ok: true, url: 'https://gitlab.com/eduardo/field-notes' }) });
  await create(ob, { remote: { provider: 'gitlab' } });
  assert.deepEqual(remote.calls.map((c) => c.provider), ['gitlab']);
});

for (const [found, status] of [[{ installed: true, signedIn: false }, 'signed-out'], [{ installed: false, signedIn: false }, 'missing']]) {
  test(`#632 remote (gh ${status}): no remote is created`, async (t) => {
    const { ob, remote } = setup(t, { cli: async () => ({ ...found }) });
    await create(ob, { remote: { provider: 'github' } });
    assert.equal(remote.calls.length, 0);
  });

  test(`#632 remote (gh ${status}): the local repository is still created with its first commit`, async (t) => {
    const { ob, projectsDir, env } = setup(t, { cli: async () => ({ ...found }) });
    await create(ob, { remote: { provider: 'github' } });
    assert.equal(inspect(env, folderOf(projectsDir, 'field-notes'), ['rev-list', '--count', 'HEAD']), '1');
  });

  test(`#632 remote (gh ${status}): the state says remote ${status}`, async (t) => {
    const { ob } = setup(t, { cli: async () => ({ ...found }) });
    const s = await create(ob, { remote: { provider: 'github' } });
    assert.deepEqual({ provider: s.remote?.provider, status: s.remote?.status }, { provider: 'github', status });
  });
}

test('#632 remote null: no remote is created and the project has no repo', async (t) => {
  const { ob, projectsDir, remote } = setup(t);
  await create(ob, { remote: null });
  assert.equal(remote.calls.length, 0);
  assert.equal(!projects.readProject(projectsDir, 'field-notes').repo, true);
});

test('#632 remote failing: the local project stays created', async (t) => {
  const { ob, projectsDir, env } = setup(t, { remote: fakeRemote({ ok: false, error: 'boom' }) });
  await create(ob, { remote: { provider: 'github' } });
  assert.equal(inspect(env, folderOf(projectsDir, 'field-notes'), ['rev-list', '--count', 'HEAD']), '1');
});

test('#632 remote failing: the state says remote failed with the reason', async (t) => {
  const { ob } = setup(t, { remote: fakeRemote({ ok: false, error: 'boom' }) });
  const s = await create(ob, { remote: { provider: 'github' } });
  assert.equal(s.remote?.status, 'failed');
  assert.match(String(s.remote?.reason || ''), /boom/);
});

// ---- the service: ctx and channel -----------------------------------------------------------------

test('#632 ctx.onboardingCreate creates the project in the open workspace', async (t) => {
  const root = tmp(t, 'onboarding-632-ws-');
  const ws = { root, projects: path.join(root, 'projects'), repos: path.join(root, 'repos'), agents: path.join(root, 'agents'), backlog: path.join(root, 'backlog') };
  const helpers = loadArea()({ ws, events: { emit() {} } });
  assert.equal(typeof helpers.onboardingCreate, 'function', 'ctx.onboardingCreate');
  const s = await helpers.onboardingCreate({ name: 'Field Notes', starts: 'empty', remote: null, answers: { ...ANSWERS } });
  assert.equal(s.projectId, 'field-notes');
  assert.equal(fs.existsSync(path.join(ws.projects, 'field-notes', '.git')), true);
});

test('#632 channel onboarding:create is createOnboarding(data), calling ctx.onboardingCreate with the data', async () => {
  const received = [];
  const ctx = { onboardingCreate: async (data) => { received.push(data); return { projectId: 'field-notes', status: 'ready' }; } };
  const entry = channels(ctx).find((e) => e.channel === 'onboarding:create');
  assert.equal(entry === undefined, false, 'an onboarding:create entry');
  assert.equal(entry.method, 'createOnboarding');
  assert.equal(entry.params, 'data');
  const data = { name: 'Field Notes', starts: 'readme', remote: { provider: 'github' }, answers: { ...ANSWERS } };
  const out = await entry.fn(data);
  assert.equal(out.projectId, 'field-notes');
  assert.deepEqual(received, [data]);
});

// ---- review fixes (66bba2e6) ------------------------------------------------------------------------

test('#632 createProject with fresh refuses a non-empty folder and writes no project', async (t) => {
  const root = tmp(t);
  const projectsDir = path.join(root, 'projects');
  const folder = path.join(projectsDir, 'field-notes');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'mine');
  const { git } = realGit(root);
  await assert.rejects(projects.createProject(projectsDir, { name: 'Field Notes' }, { git, fresh: true }), /not empty/);
  assert.equal(fs.existsSync(path.join(projectsDir, 'field-notes.json')), false);
  assert.deepEqual(projects.listProjects(projectsDir).map((p) => p.id), []);
  assert.deepEqual(fs.readdirSync(folder), ['notes.txt']);
});

test('#632 create() into a non-empty <projects>/<slug> is a client error and leaves the folder as it was', async (t) => {
  const { ob, projectsDir } = setup(t);
  const folder = path.join(projectsDir, 'field-notes');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'mine');
  await assert.rejects(create(ob), (e) => e.status === 400 && /not empty/.test(e.message));
  assert.deepEqual(projects.listProjects(projectsDir).map((p) => p.id), []);
  assert.deepEqual(fs.readdirSync(folder), ['notes.txt']);
  assert.equal(fs.existsSync(path.join(folder, '.git')), false);
});

// the area with a real git that fails on the git command `failOn` (init, commit)
function setupFailing(t, failOn) {
  const root = tmp(t);
  const real = realGit(root);
  const git = (args, cwd) => (args.includes(failOn) ? Promise.reject(new Error(`git ${failOn} failed`)) : real.git(args, cwd));
  const projectsDir = path.join(root, 'projects');
  const remote = fakeRemote();
  const ob = loadArea().createOnboarding({
    projectsDir, reposDir: path.join(root, 'repos'), git, cli: SIGNED_IN, jobs: fakeJobs().jobs,
    slotsDir: path.join(root, 'locks'), emit: () => {}, remote: remote.remote,
  });
  return { ob, projectsDir, remote };
}

for (const failOn of ['init', 'commit']) {
  test(`#632 a failing git ${failOn} removes the new project and its folder and creates no remote`, async (t) => {
    const { ob, projectsDir, remote } = setupFailing(t, failOn);
    await assert.rejects(create(ob, { remote: { provider: 'github' } }), (e) => e.status === 400 && /could not be created/.test(e.message) && e.message.includes(`git ${failOn} failed`));
    assert.deepEqual(projects.listProjects(projectsDir).map((p) => p.id), []);
    assert.equal(fs.existsSync(path.join(projectsDir, 'field-notes.json')), false);
    assert.equal(fs.existsSync(path.join(projectsDir, 'field-notes')), false);
    assert.equal(remote.calls.length, 0);
  });
}

test('#632 after a failed create the same name can be created again', async (t) => {
  const root = tmp(t);
  const real = realGit(root);
  let fail = true;
  const git = (args, cwd) => (fail && args.includes('commit') ? Promise.reject(new Error('git commit failed')) : real.git(args, cwd));
  const projectsDir = path.join(root, 'projects');
  const ob = loadArea().createOnboarding({
    projectsDir, reposDir: path.join(root, 'repos'), git, cli: SIGNED_IN, jobs: fakeJobs().jobs,
    slotsDir: path.join(root, 'locks'), emit: () => {}, remote: fakeRemote().remote,
  });
  await assert.rejects(create(ob));
  fail = false;
  const state = await create(ob);
  assert.equal(state.projectId, 'field-notes');
});

test('#632 the created project skips the facts job (an empty repository) and carries its name', async (t) => {
  const { ob } = setup(t);
  const state = await create(ob);
  assert.equal(state.jobs.facts.status, 'skipped');
  assert.equal(state.jobs.clone.status, 'skipped');
  assert.equal(state.name, 'Field Notes');
});

test('#632 the ready state is pushed with its name before the remote is created, then creating, then created', async (t) => {
  let seen = null;
  const { ob, events } = setup(t, {
    remote: fakeRemote(() => { seen = events.map((e) => e.payload.remote?.status || e.payload.status); return { ok: true, url: 'https://github.com/eduardo/field-notes' }; }),
  });
  await create(ob, { remote: { provider: 'github' } });
  const changed = events.filter((e) => e.event === 'onboarding:changed').map((e) => e.payload);
  assert.equal(changed[0].status, 'ready');
  assert.equal(changed[0].name, 'Field Notes');
  assert.equal(changed[0].remote === undefined, true);
  assert.deepEqual(seen, ['ready', 'creating'], 'while the remote runs, the wizard was told: ready, then creating');
  assert.equal(changed.at(-1).remote.status, 'created');
  assert.equal(changed.at(-1).remote.url, 'https://github.com/eduardo/field-notes');
});

test('#632 a signed-out CLI explains why no repository was created, naming its login command', async (t) => {
  const { ob } = setup(t, { cli: async () => ({ installed: true, signedIn: false }) });
  const state = await create(ob, { remote: { provider: 'github' } });
  assert.equal(state.remote.status, 'signed-out');
  assert.match(state.remote.reason, /not signed in/);
  assert.match(state.remote.reason, /gh auth login/);
});

test('#632 a missing CLI explains that it is not installed', async (t) => {
  const { ob } = setup(t, { cli: async () => ({ installed: false, signedIn: false }) });
  const state = await create(ob, { remote: { provider: 'gitlab' } });
  assert.equal(state.remote.status, 'missing');
  assert.match(state.remote.reason, /glab\) is not installed/);
});

test('#632 machineRemote in a simulated run creates nothing and answers ok: false', async (t) => {
  const before = process.env.MULTIAGENT_SIMULATION_ONLY;
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  t.after(() => { if (before === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = before; });
  const folder = tmp(t);
  for (const provider of ['github', 'gitlab']) {
    const out = await loadArea().machineRemote(provider, { name: 'field-notes', folder });
    assert.equal(out.ok, false);
    assert.match(out.error, /Simulation only/);
    assert.equal(out.url === undefined, true);
  }
  assert.deepEqual(fs.readdirSync(folder), []);
});
