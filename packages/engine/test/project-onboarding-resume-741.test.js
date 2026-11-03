// #741: an unfinished onboarding resumes at its step; one editor for a project. Acceptance tests, written
// before the code (engine side; the renderer's are fronts/build/test/projects-resume-741.test.js).
//
// API assumed (implement these names):
// - packages/engine/service/areas/project-onboarding.js createOnboarding(...) returns also
//     saveWizard(projectId, { step, picks }) -> Promise<state> | state: the wizard's step (an OnboardingModel
//       step id: start | repository | analysis | review) and its picks (an opaque object: source, repository,
//       name, workflowsMode, analysis, refactors, findings, idea) saved with the project's onboarding state,
//       on disk (a new createOnboarding over the same projectsDir reads it back);
//     finish(projectId) -> Promise<state> | state: the onboarding is finished;
//   and status(projectId).wizard = { step, picks, finished } (finished false until finish()).
// - start({ name, repo }) with the repository of an existing project:
//     its onboarding not finished -> resumes: that project's state (same projectId, its wizard { step, picks }),
//       no second project;
//     its onboarding finished -> resolves { exists: true, finished: true, projectId } (no error, no project).
// - projects.listProjects(dir) / readProject: a project with an onboarding carries
//     onboarding: { finished: boolean, step } (what the Projects card reads).
// - ctx (the area's export): onboardingSaveWizard({ projectId, step, picks }), onboardingFinish({ projectId }).
// - packages/engine/service/channels/onboarding.js:
//     { channel: 'onboarding:save-wizard', method: 'saveOnboardingWizard', params: 'data', fn: (data) => ctx.onboardingSaveWizard(data) }
//     { channel: 'onboarding:finish', method: 'finishOnboarding', params: ['projectId'], fn: (opts) => ctx.onboardingFinish(opts) }
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projects = require('../domains/project/projects');

const loadArea = () => require('../service/areas/project-onboarding');
const loadChannels = () => require('../service/channels/onboarding');

const GITHUB = 'https://github.com/acme/widgets.git';
const PICKS = {
  source: 'import', repository: GITHUB, name: 'Widgets', workflowsMode: 'manual', analysis: 'later',
  refactors: ['split-api'], findings: [0, 2], idea: 'A dark theme',
};

function tmp(t, prefix = 'onboarding-741-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// a fake git (no network): ls-remote answers, clone makes the folder a repository
function fakeGit() {
  const calls = [];
  const git = async (args) => {
    calls.push(args);
    if (args[0] === 'ls-remote') return 'abc123\tHEAD\n';
    if (args[0] === 'clone') { fs.mkdirSync(path.join(args[2], '.git'), { recursive: true }); return ''; }
    return '';
  };
  return { git };
}

const fakeJobs = () => ({
  facts: async () => ({ commits: 3, authors: 1 }),
  profile: async () => ({ profile: { merge: 'local' } }),
  projectMap: async () => ({ findings: [] }),
  ranking: async () => ({ list: [] }),
});

function make(root, git) {
  return loadArea().createOnboarding({
    projectsDir: path.join(root, 'projects'),
    reposDir: path.join(root, 'repos'),
    git,
    cli: async () => ({ installed: true, signedIn: true }),
    jobs: fakeJobs(),
    slotsDir: path.join(root, 'locks'),
    emit: () => {},
  });
}

function setup(t) {
  const root = tmp(t);
  const fake = fakeGit();
  return { root, fake, ob: make(root, fake.git), projectsDir: path.join(root, 'projects') };
}

async function ready(ob, id) {
  let last;
  for (let i = 0; i < 300; i++) {
    last = await ob.status(id);
    if (last.status === 'ready') return last;
    await pause(10);
  }
  assert.fail(`the clone never ended ready: ${JSON.stringify(last)}`);
}

// an imported project, ready, its wizard saved at the analysis step (step 3) with PICKS
async function savedAtAnalysis(t) {
  const env = setup(t);
  const s = await env.ob.start({ name: 'Widgets', repo: GITHUB });
  await ready(env.ob, s.projectId);
  assert.equal(typeof env.ob.saveWizard, 'function', 'onboarding.saveWizard');
  await env.ob.saveWizard(s.projectId, { step: 'analysis', picks: { ...PICKS } });
  return { ...env, projectId: s.projectId };
}

// ---- saving the wizard ----------------------------------------------------------------------------

test('#741 saveWizard keeps the step and the picks in the onboarding state, not finished', async (t) => {
  const { ob, projectId } = await savedAtAnalysis(t);
  const s = await ob.status(projectId);
  assert.deepEqual({ step: s.wizard?.step, picks: s.wizard?.picks, finished: s.wizard?.finished }, { step: 'analysis', picks: PICKS, finished: false });
});

test('#741 the saved wizard survives a new onboarding over the same workspace (the app restarted)', async (t) => {
  const { root, fake, projectId } = await savedAtAnalysis(t);
  const again = make(root, fake.git);
  const s = await again.status(projectId);
  assert.deepEqual({ step: s.wizard?.step, picks: s.wizard?.picks }, { step: 'analysis', picks: PICKS });
});

test('#741 finish marks the onboarding finished', async (t) => {
  const { ob, projectId } = await savedAtAnalysis(t);
  assert.equal(typeof ob.finish, 'function', 'onboarding.finish');
  await ob.finish(projectId);
  assert.equal((await ob.status(projectId)).wizard?.finished, true);
});

test('#741 the project list says the onboarding is not finished, with its step', async (t) => {
  const { projectsDir, projectId } = await savedAtAnalysis(t);
  const p = projects.listProjects(projectsDir).find((x) => x.id === projectId);
  assert.deepEqual({ finished: p?.onboarding?.finished, step: p?.onboarding?.step }, { finished: false, step: 'analysis' });
});

test('#741 the project list says the onboarding is finished after finish', async (t) => {
  const { ob, projectsDir, projectId } = await savedAtAnalysis(t);
  assert.equal(typeof ob.finish, 'function', 'onboarding.finish');
  await ob.finish(projectId);
  assert.equal(projects.listProjects(projectsDir).find((x) => x.id === projectId)?.onboarding?.finished, true);
});

// ---- New project with the same repository ---------------------------------------------------------

test('#741 start with the repository of an unfinished onboarding resumes that project: same id, no second project', async (t) => {
  const { ob, projectsDir, projectId } = await savedAtAnalysis(t);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  assert.equal(s.projectId, projectId);
  assert.deepEqual(projects.listProjects(projectsDir).map((p) => p.id), [projectId]);
});

test('#741 start with the repository of an unfinished onboarding answers its saved step and picks', async (t) => {
  const { ob, projectId } = await savedAtAnalysis(t);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  assert.equal(s.projectId, projectId);
  assert.deepEqual({ step: s.wizard?.step, picks: s.wizard?.picks }, { step: 'analysis', picks: PICKS });
});

test('#741 start with the repository of a finished onboarding says it exists and offers it: { exists, finished, projectId }', async (t) => {
  const { ob, projectId } = await savedAtAnalysis(t);
  assert.equal(typeof ob.finish, 'function', 'onboarding.finish');
  await ob.finish(projectId);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  assert.deepEqual({ exists: s?.exists, finished: s?.finished, projectId: s?.projectId }, { exists: true, finished: true, projectId });
});

test('#741 start with the repository of a finished onboarding makes no second project', async (t) => {
  const { ob, projectsDir, projectId } = await savedAtAnalysis(t);
  assert.equal(typeof ob.finish, 'function', 'onboarding.finish');
  await ob.finish(projectId);
  await ob.start({ name: 'Widgets', repo: GITHUB }).catch(() => null);
  assert.deepEqual(projects.listProjects(projectsDir).map((p) => p.id), [projectId]);
});

// ---- the service: ctx and channels ----------------------------------------------------------------

test('#741 ctx.onboardingSaveWizard / onboardingFinish save the wizard of a project of the open workspace', async (t) => {
  const root = tmp(t, 'onboarding-741-ws-');
  const ws = { root, projects: path.join(root, 'projects'), repos: path.join(root, 'repos'), agents: path.join(root, 'agents'), backlog: path.join(root, 'backlog') };
  const helpers = loadArea()({ ws, events: { emit() {} } });
  assert.equal(typeof helpers.onboardingSaveWizard, 'function', 'ctx.onboardingSaveWizard');
  assert.equal(typeof helpers.onboardingFinish, 'function', 'ctx.onboardingFinish');
  const { projectId } = await helpers.onboardingCreate({ name: 'Field Notes', starts: 'empty', remote: null, answers: { mode: 'local', ci: 'release', release: 'milestone' } });
  await helpers.onboardingSaveWizard({ projectId, step: 'review', picks: { idea: 'notes' } });
  assert.equal((await helpers.onboardingStatus({ projectId })).wizard?.step, 'review');
  await helpers.onboardingFinish({ projectId });
  assert.equal((await helpers.onboardingStatus({ projectId })).wizard?.finished, true);
});

test('#741 channel onboarding:save-wizard is saveOnboardingWizard(data), calling ctx.onboardingSaveWizard with the data', async () => {
  const received = [];
  const ctx = { onboardingSaveWizard: async (data) => { received.push(data); return { projectId: 'p1' }; } };
  const entry = loadChannels()(ctx).find((e) => e.channel === 'onboarding:save-wizard');
  assert.equal(entry === undefined, false, 'an onboarding:save-wizard entry');
  assert.deepEqual({ method: entry.method, params: entry.params }, { method: 'saveOnboardingWizard', params: 'data' });
  const data = { projectId: 'p1', step: 'analysis', picks: { ...PICKS } };
  await entry.fn(data);
  assert.deepEqual(received, [data]);
});

test('#741 channel onboarding:finish is finishOnboarding(projectId), calling ctx.onboardingFinish', async () => {
  const received = [];
  const ctx = { onboardingFinish: async (opts) => { received.push(opts); return { projectId: 'p1' }; } };
  const entry = loadChannels()(ctx).find((e) => e.channel === 'onboarding:finish');
  assert.equal(entry === undefined, false, 'an onboarding:finish entry');
  assert.deepEqual({ method: entry.method, params: entry.params }, { method: 'finishOnboarding', params: ['projectId'] });
  await entry.fn({ projectId: 'p1' });
  assert.deepEqual(received, [{ projectId: 'p1' }]);
});
