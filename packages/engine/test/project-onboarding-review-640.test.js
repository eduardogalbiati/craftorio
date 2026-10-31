// #640 review fixes: a project removed while its onboarding runs, a refused profile job and its Retry,
// a repository folder already cloned imported again without network, the analysis slot's hold limit and
// settings.js's toolSignIn (the gh / glab check the onboarding shares with the Settings tab).
// The onboarding is createOnboarding of packages/engine/service/areas/project-onboarding.js, with the fake
// git, CLI check and analyses of project-onboarding.test.js: no network, no model.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const projects = require('../domains/project/projects');
const slots = require('../engine/machine-slot');
const { createOnboarding, SLOT } = require('../service/areas/project-onboarding');

const GITHUB = 'https://github.com/acme/widgets.git';
const JOBS = ['clone', 'facts', 'profile', 'projectMap', 'ranking'];

function tmp(t, prefix = 'onboarding-review-640-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = (s) => JOBS.every((j) => s.jobs?.[j]?.status !== 'running');

async function until(ob, id, pred, what) {
  let last;
  for (let i = 0; i < 300; i++) {
    last = await ob.status(id);
    if (pred(last)) return last;
    await pause(10);
  }
  assert.fail(`${what}: still ${JSON.stringify(last)}`);
}

// the onboarding no longer knows the project: status throws "No onboarding runs"
async function forgotten(ob, id) {
  for (let i = 0; i < 300; i++) {
    try { await ob.status(id); } catch (e) { return e; }
    await pause(10);
  }
  assert.fail(`the onboarding still has a state for ${id}`);
}

// rejections no one handled while the test ran
function unhandled(t) {
  const seen = [];
  const on = (e) => seen.push(String(e?.message || e));
  process.on('unhandledRejection', on);
  t.after(() => process.off('unhandledRejection', on));
  return seen;
}

const cloneOk = (args) => { fs.mkdirSync(path.join(args[2], '.git'), { recursive: true }); return ''; };

function fakeGit(access = {}) {
  const calls = [];
  const git = async (args, cwd) => {
    calls.push(args);
    if (args[0] === 'ls-remote') {
      if (access.lsRemote instanceof Error) throw access.lsRemote;
      return 'abc123\tHEAD\n';
    }
    if (args[0] === 'clone') return access.clone ? access.clone(args, cwd) : cloneOk(args);
    return '';
  };
  return { git, clones: () => calls.filter((a) => a[0] === 'clone').length };
}

function fakeJobs(overrides = {}) {
  const calls = { facts: 0, profile: 0, projectMap: 0, ranking: 0 };
  const job = (name, result) => async (input) => {
    calls[name] += 1;
    return overrides[name] ? overrides[name](input, calls[name]) : result;
  };
  return {
    calls,
    jobs: {
      facts: job('facts', { commits: 3 }),
      profile: job('profile', { profile: { merge: 'local' } }),
      projectMap: job('projectMap', { findings: [] }),
      ranking: job('ranking', { list: [] }),
    },
  };
}

function setup(t, { access = {}, fake = fakeJobs() } = {}) {
  const root = tmp(t);
  const { git, clones } = fakeGit(access);
  const projectsDir = path.join(root, 'projects');
  const reposDir = path.join(root, 'repos');
  const ob = createOnboarding({ projectsDir, reposDir, git, cli: async () => ({ installed: true, signedIn: true }), jobs: fake.jobs, slotsDir: path.join(root, 'locks'), pollMs: 20 });
  return { ob, clones, projectsDir, reposDir, fake };
}

// ---- a project removed while its onboarding runs -------------------------------------------------

test('#640 a project removed during its clone loses its onboarding state, with no unhandled rejection', async (t) => {
  const seen = unhandled(t);
  const gate = deferred();
  const { ob, projectsDir } = setup(t, { access: { clone: async (args) => { await gate.promise; return cloneOk(args); } } });
  t.after(() => gate.resolve());
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  assert.equal(s.status, 'cloning');
  projects.removeProject(projectsDir, s.projectId);
  gate.resolve();
  const err = await forgotten(ob, s.projectId);
  assert.match(err.message, /No onboarding runs/);
  await pause(50);
  assert.deepEqual(seen, []);
});

test('#640 a project removed while its analysis runs ends no job running, with no unhandled rejection', async (t) => {
  const seen = unhandled(t);
  const mapGate = deferred();
  const fake = fakeJobs({ projectMap: async () => { await mapGate.promise; return { findings: [] }; } });
  const { ob, projectsDir } = setup(t, { fake });
  t.after(() => mapGate.resolve());
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await until(ob, s.projectId, (x) => x.status === 'ready' && idle(x), 'the clone ends ready');
  await ob.analyze(s.projectId);
  await until(ob, s.projectId, (x) => x.jobs.projectMap.status === 'running', 'the project map runs');
  projects.removeProject(projectsDir, s.projectId);
  mapGate.resolve();
  // the state is either dropped or settled: never a job left running
  for (let i = 0; i < 300; i++) {
    let st;
    try { st = await ob.status(s.projectId); } catch { break; }
    if (idle(st) && st.status !== 'analyzing') break;
    await pause(10);
  }
  let end = null;
  try { end = await ob.status(s.projectId); } catch { /* dropped */ }
  if (end) assert.equal(idle(end) && end.status !== 'analyzing', true, JSON.stringify(end));
  await pause(50);
  assert.deepEqual(seen, []);
});

// ---- a refused profile -----------------------------------------------------------------------

test('#640 a refused profile job ends failed with the refusal\'s text, and Retry runs it again', async (t) => {
  const fake = fakeJobs({ profile: (input, n) => (n === 1 ? { refused: { text: 'The Ways of working analysis already runs on this project.' } } : { profile: { merge: 'local' } }) });
  const { ob } = setup(t, { fake });
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  const failed = await until(ob, s.projectId, (x) => x.jobs.profile.status === 'failed' && idle(x), 'the profile ends failed');
  assert.equal(failed.status, 'ready', 'a refused free job does not fail the project');
  assert.match(failed.jobs.profile.error, /already runs on this project/);
  await ob.retry(s.projectId);
  const end = await until(ob, s.projectId, (x) => x.jobs.profile.status === 'done' && idle(x), 'the retry runs the profile again');
  assert.equal(fake.calls.profile, 2);
  assert.equal(end.status, 'ready');
});

// ---- a repository folder already cloned ----------------------------------------------------------

test('#640 importing again a repository already cloned in repos/ ends ready without network or a new clone, and Retry keeps it', async (t) => {
  const access = { lsRemote: Object.assign(new Error('fatal: unable to access: Could not resolve host: github.com'), {}) };
  const { ob, clones, reposDir } = setup(t, { access });
  const folder = path.join(reposDir, 'acme-widgets');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), 'kept\n');
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  const ready = await until(ob, s.projectId, (x) => x.status !== 'cloning' && idle(x), 'the import settles');
  assert.equal(ready.status, 'ready', JSON.stringify(ready));
  assert.equal(clones(), 0, 'no clone of a folder that already is one');
  await ob.retry(s.projectId);
  await pause(100);
  const after = await until(ob, s.projectId, (x) => idle(x), 'the retry settles');
  assert.equal(after.status, 'ready');
  assert.equal(clones(), 0);
  assert.equal(fs.existsSync(path.join(folder, 'README.md')), true, 'the clone kept its files (no retryClone)');
});

// ---- the analysis slot's hold limit --------------------------------------------------------------

// a slot file written by this (live) process, taken `ageMin` minutes ago
function heldSince(dir, ageMin) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(slots.slotFile(SLOT, dir), JSON.stringify({ pid: process.pid, host: os.hostname(), token: crypto.randomBytes(8).toString('hex'), started: Date.now() - ageMin * 60e3, holder: 'a long analysis' }));
}

test('#640 the onboarding\'s slot is the analysis slot, held up to 45 minutes', (t) => {
  assert.equal(SLOT, 'analysis');
  const dir = tmp(t);
  heldSince(dir, 30);
  assert.equal(slots.slotHolder(SLOT, { dir }) !== null, true, 'a 30-minute analysis still holds the slot (past the 15-minute default)');
  heldSince(dir, 50);
  assert.equal(slots.slotHolder(SLOT, { dir }), null, 'a 50-minute holder is taken as hung');
});

// ---- toolSignIn ------------------------------------------------------------------------------

test('#640 toolSignIn answers a CLI that is not installed as not installed and not signed in', async () => {
  const { toolSignIn } = require('../service/areas/settings');
  assert.deepEqual(await toolSignIn('no-such-cli-640'), { installed: false, signedIn: false });
});

test('#640 toolSignIn answers an installed CLI with no sign-in probe as installed and not signed in', async () => {
  const { toolSignIn } = require('../service/areas/settings');
  assert.deepEqual(await toolSignIn('git'), { installed: true, signedIn: false });
});
