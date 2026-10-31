// #640 (onboarding step 3): the onboarding jobs chain of a new project and its channels. Acceptance
// tests, written before the code.
//
// Spec (the interface these tests assume):
//   packages/engine/service/areas/project-onboarding.js, besides its area export (ctx) => helpers, exports
//   createOnboarding({ projectsDir, reposDir, git, cli, jobs, slotsDir, emit }) -> {
//       start({ name, repo }) -> Promise<state>: checks access (git ls-remote), creates the project and
//         starts its clone (step 2, #639); returns at once, never waiting for the clone
//       status(projectId) -> state (or a Promise of it): the same state the events push
//       analyze(projectId) -> Promise<state>: asks for the paid part (project map, then the ranking);
//         returns at once; nothing paid runs without it ("analyze later" = never calling it)
//       retry(projectId) -> Promise<state>: runs again what failed (the access check and the clone, the CLI check)
//     }
//     and SLOT: the name of the machine-wide slot (packages/engine/engine/machine-slot.js) its heavy jobs take.
//   Options:
//     git: (args, cwd) => Promise<stdout>, the git of step 2 (ls-remote and clone), a fake here: no network
//     cli: async (provider: 'github' | 'gitlab') => { installed: boolean, signedIn: boolean }: gh / glab
//     jobs: { facts, profile, projectMap, ranking }: async (input) => result, the analyses, fakes here;
//       the chain is clone -> facts -> (profile in parallel with projectMap) -> ranking after projectMap
//     slotsDir: the machine slots' folder; emit(event, payload): the service's events
//   state: {
//     projectId,
//     status: 'cloning' | 'ready' | 'analyzing' | 'analyzed' | 'failed',
//     code?: 'no-access' | 'clone-failed' (when failed), reason?: a readable sentence (when failed),
//     jobs: { clone, facts, profile, projectMap, ranking }: each { status: 'waiting' | 'running' | 'done' | 'failed' | 'skipped' },
//     cli: { provider, status: 'ok' | 'missing' | 'signed-out', reason? } for a GitHub or GitLab repository
//       (spec R3: with no CLI the import goes on, with a warning about issues and PRs)
//   }
//   Each change of state is emitted as emit('onboarding:changed', state).
//   Channels (packages/engine/service/channels/onboarding.js): onboarding:start, onboarding:status,
//   onboarding:analyze, onboarding:retry, and the pushed event onboarding:changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const loadArea = () => require('../service/areas/project-onboarding');
const slots = require('../engine/machine-slot');

const GITHUB = 'https://github.com/acme/widgets.git';
const GITLAB = 'https://gitlab.com/acme/widgets.git';
const JOBS = ['clone', 'facts', 'profile', 'projectMap', 'ranking'];

function tmp(t, prefix = 'onboarding-640-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// a call that must return at once: fails the test instead of hanging when it waits for a job
function soon(promise, what) {
  let timer;
  const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} waited for a job instead of returning at once`)), 2000); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// the state once `pred` holds; fails with the last state after 3 s
async function until(ob, id, pred, what) {
  let last;
  for (let i = 0; i < 300; i++) {
    last = await ob.status(id);
    if (pred(last)) return last;
    await pause(10);
  }
  assert.fail(`${what}: still ${JSON.stringify(last)}`);
}

const running = (s) => JOBS.filter((j) => s.jobs?.[j]?.status === 'running');
const idle = (s) => running(s).length === 0;

// a fake git: ls-remote answers access.lsRemote (a string, or an Error); clone runs access.clone(args)
function fakeGit(access = {}) {
  const calls = [];
  const git = async (args, cwd) => {
    calls.push(args);
    if (args[0] === 'ls-remote') {
      if (access.lsRemote instanceof Error) throw access.lsRemote;
      return access.lsRemote ?? 'abc123\tHEAD\n';
    }
    if (args[0] === 'clone') return access.clone ? access.clone(args, cwd) : cloneOk(args);
    return '';
  };
  return { git, calls, clones: () => calls.filter((a) => a[0] === 'clone').length };
}

const cloneOk = (args) => { fs.mkdirSync(path.join(args[2], '.git'), { recursive: true }); return ''; };

// fake analyses: each records its start and end in `log`; `gates[name]` (a deferred) holds it until resolved
function fakeJobs({ gates = {}, fail = {} } = {}) {
  const log = [];
  const calls = { facts: 0, profile: 0, projectMap: 0, ranking: 0 };
  const job = (name, result) => async () => {
    calls[name] += 1;
    log.push(`${name}:start`);
    if (gates[name]) await gates[name].promise;
    log.push(`${name}:end`);
    if (fail[name]) throw new Error(fail[name]);
    return result;
  };
  return {
    log,
    calls,
    jobs: {
      facts: job('facts', { commits: 3, authors: 1 }),
      profile: job('profile', { profile: { merge: 'local' } }),
      projectMap: job('projectMap', { findings: [] }),
      ranking: job('ranking', { list: [] }),
    },
  };
}

function setup(t, { access = {}, cli = async () => ({ installed: true, signedIn: true }), jobs = fakeJobs() } = {}) {
  const root = tmp(t);
  const { git, calls, clones } = fakeGit(access);
  const events = [];
  const slotsDir = path.join(root, 'locks');
  const ob = loadArea().createOnboarding({
    projectsDir: path.join(root, 'projects'),
    reposDir: path.join(root, 'repos'),
    git,
    cli,
    jobs: jobs.jobs,
    slotsDir,
    emit: (event, payload) => events.push({ event, payload: JSON.parse(JSON.stringify(payload)) }),
  });
  return { ob, calls, clones, events, slotsDir, fake: jobs };
}

// ---- the chain in order ------------------------------------------------------------------------

test('#640 start returns at once with the project cloning', async (t) => {
  const gate = deferred();
  const { ob } = setup(t, { access: { clone: async (args) => { await gate.promise; return cloneOk(args); } } });
  t.after(() => gate.resolve());
  const s = await soon(ob.start({ name: 'Widgets', repo: GITHUB }), 'onboarding start');
  assert.equal(typeof s.projectId, 'string');
  assert.equal(s.status, 'cloning');
  gate.resolve();
  await until(ob, s.projectId, (x) => x.status === 'ready' && idle(x), 'the clone ends ready');
});

test('#640 no analysis starts before the clone is ready (a slow fake clone)', async (t) => {
  const gate = deferred();
  const fake = fakeJobs();
  const { ob } = setup(t, { jobs: fake, access: { clone: async (args) => { await gate.promise; return cloneOk(args); } } });
  t.after(() => gate.resolve());
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await soon(ob.analyze(s.projectId), 'onboarding analyze');
  await pause(150);
  assert.deepEqual(fake.log, [], 'nothing ran while the clone was still running');
  assert.equal((await ob.status(s.projectId)).status, 'cloning');
  gate.resolve();
  const end = await until(ob, s.projectId, (x) => x.status === 'analyzed' && idle(x), 'the analysis ends');
  assert.equal(fake.calls.projectMap, 1);
  assert.equal(fake.calls.ranking, 1);
  assert.equal(end.jobs.ranking.status, 'done');
});

test('#640 the facts come first, the profile and the project map run in parallel, the ranking after the map', async (t) => {
  const profileGate = deferred();
  const fake = fakeJobs({ gates: { profile: profileGate } });
  const { ob } = setup(t, { jobs: fake });
  t.after(() => profileGate.resolve());
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await ob.analyze(s.projectId);
  // the project map starts and ends while the profile is still running
  for (let i = 0; i < 300 && !fake.log.includes('projectMap:end'); i++) await pause(10);
  assert.equal(fake.log.includes('projectMap:end'), true, `the project map ran while the profile was held: ${fake.log.join(', ')}`);
  assert.equal(fake.log.includes('profile:end'), false);
  profileGate.resolve();
  await until(ob, s.projectId, (x) => x.status === 'analyzed' && idle(x), 'the analysis ends');
  const at = (e) => fake.log.indexOf(e);
  assert.ok(at('facts:end') < at('profile:start'), `facts before the profile: ${fake.log.join(', ')}`);
  assert.ok(at('facts:end') < at('projectMap:start'), `facts before the project map: ${fake.log.join(', ')}`);
  assert.ok(at('projectMap:end') < at('ranking:start'), `the ranking after the project map: ${fake.log.join(', ')}`);
});

// ---- analysis only on the click ------------------------------------------------------------------

test('#640 "analyze later": without analyze the project ends ready and nothing paid runs', async (t) => {
  const fake = fakeJobs();
  const { ob } = setup(t, { jobs: fake });
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await until(ob, s.projectId, (x) => x.status === 'ready' && idle(x), 'the clone ends ready');
  await pause(150);
  const end = await ob.status(s.projectId);
  assert.equal(end.status, 'ready');
  assert.equal(fake.calls.projectMap, 0, 'the project map never ran');
  assert.equal(fake.calls.ranking, 0, 'the ranking never ran');
});

test('#640 analyze on a ready project runs the project map and the ranking once and ends analyzed', async (t) => {
  const fake = fakeJobs();
  const { ob } = setup(t, { jobs: fake });
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await until(ob, s.projectId, (x) => x.status === 'ready' && idle(x), 'the clone ends ready');
  await soon(ob.analyze(s.projectId), 'onboarding analyze');
  const end = await until(ob, s.projectId, (x) => x.status === 'analyzed' && idle(x), 'the analysis ends');
  assert.equal(fake.calls.projectMap, 1);
  assert.equal(fake.calls.ranking, 1);
  assert.equal(end.jobs.projectMap.status, 'done');
  assert.equal(end.jobs.ranking.status, 'done');
});

// ---- slots and events ----------------------------------------------------------------------------

test('#640 the project map holds the machine-wide slot while it runs and frees it after', async (t) => {
  const mapGate = deferred();
  const fake = fakeJobs({ gates: { projectMap: mapGate } });
  const { ob, slotsDir } = setup(t, { jobs: fake });
  t.after(() => mapGate.resolve());
  const { SLOT } = loadArea();
  assert.equal(typeof SLOT, 'string');
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await ob.analyze(s.projectId);
  for (let i = 0; i < 300 && !fake.log.includes('projectMap:start'); i++) await pause(10);
  assert.equal(slots.slotHolder(SLOT, { dir: slotsDir }) !== null, true, 'the slot is held while the project map runs');
  mapGate.resolve();
  await until(ob, s.projectId, (x) => x.status === 'analyzed' && idle(x), 'the analysis ends');
  assert.equal(slots.slotHolder(SLOT, { dir: slotsDir }), null, 'the slot is free once the chain ended');
});

test('#640 the project map waits while another run holds the machine-wide slot', async (t) => {
  const fake = fakeJobs();
  const { ob, slotsDir } = setup(t, { jobs: fake });
  const { SLOT } = loadArea();
  const other = await slots.acquireSlot(SLOT, { dir: slotsDir, holder: 'another run' });
  t.after(() => other.release());
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await ob.analyze(s.projectId);
  await pause(300);
  assert.equal(fake.calls.projectMap, 0, 'the project map did not start while the slot was held');
  other.release();
  await until(ob, s.projectId, (x) => x.status === 'analyzed' && idle(x), 'the analysis ends once the slot is free');
  assert.equal(fake.calls.projectMap, 1);
});

test('#640 each change of state is pushed as onboarding:changed, and status returns the last one', async (t) => {
  const { ob, events } = setup(t);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await until(ob, s.projectId, (x) => x.status === 'ready' && idle(x), 'the clone ends ready');
  await ob.analyze(s.projectId);
  const end = await until(ob, s.projectId, (x) => x.status === 'analyzed' && idle(x), 'the analysis ends');
  const mine = events.filter((e) => e.event === 'onboarding:changed' && e.payload.projectId === s.projectId);
  const seen = mine.map((e) => e.payload.status).filter((st, i, all) => st !== all[i - 1]);
  assert.deepEqual(seen, ['cloning', 'ready', 'analyzing', 'analyzed']);
  assert.deepEqual(mine.at(-1).payload, JSON.parse(JSON.stringify(end)));
});

// ---- error paths and Retry ---------------------------------------------------------------------

test('#640 no access: the project ends failed with a readable reason, nothing is cloned, and Retry clones it', async (t) => {
  const access = { lsRemote: new Error("remote: Repository not found.\nfatal: repository 'https://github.com/acme/widgets.git/' not found") };
  const { ob, clones } = setup(t, { access });
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  const failed = await until(ob, s.projectId, (x) => x.status === 'failed' && idle(x), 'the access check ends failed');
  assert.equal(failed.code, 'no-access');
  assert.equal(typeof failed.reason, 'string');
  assert.ok(failed.reason.trim().length > 0, 'a reason the wizard can show');
  assert.equal(clones(), 0, 'no clone without access');
  delete access.lsRemote; // the owner signed in
  await soon(ob.retry(s.projectId), 'onboarding retry');
  await until(ob, s.projectId, (x) => x.status === 'ready' && idle(x), 'the retry ends ready');
  assert.equal(clones(), 1);
});

test('#640 a failed clone ends failed with its reason, leaves no job running, and Retry clones again', async (t) => {
  let fails = true;
  const access = { clone: async (args) => { if (fails) throw new Error('fatal: early EOF'); return cloneOk(args); } };
  const fake = fakeJobs();
  const { ob, clones } = setup(t, { access, jobs: fake });
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await ob.analyze(s.projectId);
  const failed = await until(ob, s.projectId, (x) => x.status === 'failed' && idle(x), 'the clone ends failed');
  assert.equal(failed.code, 'clone-failed');
  assert.match(failed.reason, /early EOF/);
  await pause(100);
  assert.deepEqual(fake.log, [], 'no analysis ran on a failed clone');
  fails = false;
  await soon(ob.retry(s.projectId), 'onboarding retry');
  await until(ob, s.projectId, (x) => !['cloning', 'failed'].includes(x.status) && idle(x), 'the retry ends past the clone');
  assert.equal(clones(), 2);
});

test('#640 no gh installed: the import goes on, and the state says why issues and PRs are unavailable', async (t) => {
  const cli = async () => ({ installed: false, signedIn: false });
  const { ob } = setup(t, { cli });
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  const end = await until(ob, s.projectId, (x) => x.status === 'ready' && idle(x), 'the clone ends ready');
  assert.equal(end.cli.provider, 'github');
  assert.equal(end.cli.status, 'missing');
  assert.match(end.cli.reason, /\bgh\b/);
});

test('#640 glab not signed in: the state says so, and Retry checks the CLI again', async (t) => {
  let signedIn = false;
  const providers = [];
  const cli = async (provider) => { providers.push(provider); return { installed: true, signedIn }; };
  const { ob } = setup(t, { cli });
  const s = await ob.start({ name: 'Widgets', repo: GITLAB });
  const before = await until(ob, s.projectId, (x) => x.status === 'ready' && idle(x), 'the clone ends ready');
  assert.equal(before.cli.provider, 'gitlab');
  assert.equal(before.cli.status, 'signed-out');
  assert.match(before.cli.reason, /\bglab\b/);
  assert.equal(providers.includes('gitlab'), true);
  signedIn = true;
  await ob.retry(s.projectId);
  const after = await until(ob, s.projectId, (x) => x.cli?.status === 'ok' && idle(x), 'the retry sees glab signed in');
  assert.equal(after.status, 'ready');
});

// ---- the channels --------------------------------------------------------------------------------

test('#640 the service registers the onboarding channels and pushes onboarding:changed', (t) => {
  const { makeService } = require('./service/helpers');
  const { service, api } = makeService(t);
  for (const ch of ['onboarding:start', 'onboarding:status', 'onboarding:analyze', 'onboarding:retry']) {
    assert.equal(typeof api[ch], 'function', ch);
  }
  assert.equal(service.manifest.some((e) => e.event === 'onboarding:changed'), true, 'the manifest declares the event');
  const { PUSHED_EVENTS } = require('../service/manifest');
  assert.equal(PUSHED_EVENTS.includes('onboarding:changed'), true, 'the event reaches the windows');
});
