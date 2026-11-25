// #74, the details behind project-onboarding-costs-74.test.js: what Retry and a restart may pay, the analysis
// asked during the clone, the interview's free read and its estimate, and the E2E hook of the costs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const arch = require('../domains/oracle/oracle-architecture');
const projects = require('../domains/project/projects');
const seeds = require('../domains/seed/seeds');
const simulation = require('../engine/simulation');
const { createOnboarding } = require('../service/areas/project-onboarding');
const { setupWorkspace } = require('../domains/workspace/workspace');

const PROFILE = { mode: 'local', ci: 'none', tests: 'unit' };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return dir;
}

function env(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const before = process.env[name];
    process.env[name] = value;
    t.after(() => { if (before === undefined) delete process.env[name]; else process.env[name] = before; });
  }
}

async function until(ob, id, pred, what) {
  let last;
  for (let i = 0; i < 300; i++) {
    last = ob.status(id);
    if (pred(last)) return last;
    await pause(10);
  }
  assert.fail(`${what}: still ${JSON.stringify(last)}`);
}

// ---- the onboarding's jobs ---------------------------------------------------------------------

const git = async (args) => {
  if (args[0] === 'ls-remote') return 'abc123\tHEAD\n';
  if (args[0] === 'clone') fs.mkdirSync(path.join(args[2], '.git'), { recursive: true });
  return '';
};

// a profile that waits for the Oracle; `paid` counts the turns asked for (input.oracle)
function setup(t, { fail = {}, hold = null } = {}) {
  const root = tmp(t, 'costs-74-int-');
  const calls = { facts: 0, free: 0, paid: 0 };
  const once = (name) => { if (fail[name]) { fail[name] -= 1; throw new Error(`${name} failed`); } };
  const jobs = {
    facts: async () => { calls.facts += 1; once('facts'); return {}; },
    profile: async ({ oracle }) => {
      calls[oracle ? 'paid' : 'free'] += 1;
      once(oracle ? 'paid' : 'free');
      return oracle ? { profile: PROFILE, costUsd: 0.42 } : { profile: PROFILE, needsOracle: true };
    },
    projectMap: async () => { if (hold) await hold; return { cost_usd: 0.74 }; },
  };
  const ob = createOnboarding({
    projectsDir: path.join(root, 'projects'), reposDir: path.join(root, 'repos'), slotsDir: path.join(root, 'locks'),
    git, jobs, cli: async () => ({ installed: true, signedIn: true }),
  });
  return { calls, ob };
}
const start = async (ob) => (await ob.start({ name: 'Widgets', repo: 'https://github.com/acme/widgets.git' })).projectId;

test('#74 a profile that waits for the Oracle keeps git\'s profile, and says nothing cost', async (t) => {
  const { calls, ob } = setup(t);
  const id = await start(ob);
  const s = await until(ob, id, (x) => x.jobs.profile.profile, 'the free read ends');
  assert.deepEqual(s.jobs.profile, { status: 'waiting', profile: PROFILE });
  assert.deepEqual(calls, { facts: 1, free: 1, paid: 0 });
});

test('#74 Retry before the analysis is asked for never pays', async (t) => {
  const { calls, ob } = setup(t, { fail: { free: 1 } });
  const id = await start(ob);
  await until(ob, id, (x) => x.jobs.profile.status === 'failed', 'the free read fails');
  await ob.retry(id);
  await until(ob, id, (x) => x.jobs.profile.profile, 'the free read runs again');
  assert.equal(calls.paid, 0);
});

test('#74 Analyze runs a profile that failed before it, with the Oracle', async (t) => {
  const { calls, ob } = setup(t, { fail: { free: 1 } });
  const id = await start(ob);
  await until(ob, id, (x) => x.jobs.profile.status === 'failed', 'the free read fails');
  await ob.analyze(id);
  const end = await until(ob, id, (x) => x.status === 'analyzed', 'the analysis ends');
  assert.equal(end.jobs.profile.costUsd, 0.42);
  assert.equal(calls.paid, 1);
});

test('#74 Retry of a failed Oracle turn asks the Oracle again, during the analysis and after it', async (t) => {
  let release;
  const hold = new Promise((r) => { release = r; });
  t.after(() => release());
  const { calls, ob } = setup(t, { fail: { paid: 2 }, hold });
  const id = await start(ob);
  await until(ob, id, (x) => x.jobs.profile.profile, 'the free read ends');
  await ob.analyze(id);
  await until(ob, id, (x) => x.jobs.profile.status === 'failed' && x.jobs.projectMap.status === 'running', 'the turn fails');
  await ob.retry(id);
  await until(ob, id, () => calls.paid === 2, 'asked again while the map runs');
  release();
  await until(ob, id, (x) => x.status === 'analyzed' && x.jobs.profile.status === 'failed', 'the analysis ends');
  await ob.retry(id);
  await until(ob, id, (x) => x.jobs.profile.status === 'done', 'asked again after it');
  assert.equal(calls.paid, 3);
  assert.equal(calls.free, 1);
});

test('#74 Retry of failed facts keeps a paid profile', async (t) => {
  const { calls, ob } = setup(t, { fail: { facts: 1 } });
  const id = await start(ob);
  await ob.analyze(id);
  const end = await until(ob, id, (x) => x.status === 'analyzed', 'the analysis ends');
  assert.equal(end.jobs.facts.status, 'failed');
  await ob.retry(id);
  await until(ob, id, (x) => x.jobs.facts.status === 'done', 'the facts run again');
  await pause(50);
  assert.equal(calls.paid, 1);
  assert.equal(ob.status(id).jobs.profile.costUsd, 0.42);
});

test('#74 an analysis asked during the clone is said as wanted until it starts, and pays the profile once', async (t) => {
  const { calls, ob } = setup(t);
  const id = await start(ob);
  const asked = await ob.analyze(id);
  if (asked.status === 'cloning') assert.equal(asked.wanted, true);
  const end = await until(ob, id, (x) => x.status === 'analyzed', 'the analysis ends');
  assert.equal('wanted' in end, false);
  assert.equal(calls.paid, 1);
});

// ---- the interview ------------------------------------------------------------------------------

function repository(t) {
  const dir = tmp(t, 'costs-74-int-repo-');
  const run = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, stdio: 'pipe' });
  run('init', '-q');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "scripts": { "test": "npm run unit" } }\n');
  run('add', '.');
  run('commit', '-q', '--no-verify', '-m', 'first');
  return dir;
}

async function interview(t) {
  env(t, { CRAFTORIO_SIMULATION_ONLY: '0' });
  const ws = setupWorkspace(tmp(t, 'costs-74-int-ws-'), { persist: false });
  seeds.seedSeeds(seeds.BUNDLED_SEEDS_DIR, ws.seeds);
  const turns = [];
  const text = `\`\`\`json\n${JSON.stringify({ html: '<h1>x</h1>', model: { profile: { release: 'milestone' }, evidence: {} }, report: '' })}\n\`\`\``;
  const oracle = { budgetRefusal: () => null, oneTurn: async (x) => { turns.push(x); return { text, costUsd: 0.5, tokens: {} }; } };
  const ctx = { ws, host: {}, oracleService: () => oracle, events: { emit: () => {} }, notify: () => {} };
  const project = async (name) => projects.createProject(ws.projects, { name, folder: repository(t) });
  return { area: require('../service/areas/workflow-interview')(ctx), project, turns, ws };
}

test('#74 the free read saves no run and calls no model; after a real one it answers it with its cost', async (t) => {
  const { area, project, turns } = await interview(t);
  const p = await project('demo');
  const free = await area.workflowInterview({ projectId: p.id, free: true });
  assert.equal(free.needsOracle, true);
  assert.equal(free.profile.release, null);
  assert.equal(await area.workflowInterviewLast({ projectId: p.id }), null);
  const paid = await area.workflowInterview({ projectId: p.id });
  assert.equal(paid.costUsd, 0.5);
  const again = await area.workflowInterview({ projectId: p.id, free: true });
  assert.equal(again.needsOracle, undefined);
  assert.equal(again.profile.release, 'milestone');
  assert.equal(again.costUsd, 0.5);
  assert.equal(turns.length, 1);
});

test('#74 the estimate: not known with no past run, then the other projects\' runs, then its own; free with a tool', async (t) => {
  const { area, project, ws } = await interview(t);
  const [a, b] = [await project('one'), await project('two')];
  assert.deepEqual(await area.workflowInterviewEstimate({ projectId: b.id }), { costUsd: null, free: false, basis: 0 });
  await area.workflowInterview({ projectId: a.id });
  assert.deepEqual(await area.workflowInterviewEstimate({ projectId: b.id }), { costUsd: 0.5, free: false, basis: 1 });
  projects.updateProject(ws.projects, b.id, { seedTools: { 'ways-of-working': 'node x.js' } });
  assert.equal((await area.workflowInterviewEstimate({ projectId: b.id })).free, true);
});

test('#74 the estimate is free in a simulation', async (t) => {
  const { area, project } = await interview(t);
  const p = await project('demo');
  env(t, { CRAFTORIO_SIMULATION_ONLY: '1' });
  assert.deepEqual(await area.workflowInterviewEstimate({ projectId: p.id }), { costUsd: 0, free: true, basis: 0 });
});

test('#74 estimateFromOthers prefers the project\'s own records and leaves simulated ones out', (t) => {
  const root = tmp(t, 'costs-74-int-arch-');
  for (const id of ['a', 'b', 'c']) fs.mkdirSync(path.join(root, id));
  const date = '2026-11-25T10:00:00Z';
  const saved = { a: [{ costUsd: 1, date }], b: [{ costUsd: 3, date }], c: [{ costUsd: 9, date, simulated: true }] };
  const listOf = (id) => saved[id] || [];
  assert.deepEqual(arch.estimateFromOthers(root, 'a', listOf), { usd: 1, basis: 1 });
  assert.deepEqual(arch.estimateFromOthers(root, 'c', listOf), { usd: 2, basis: 2 });
  assert.equal(arch.estimateFromOthers(path.join(root, 'none'), 'x', listOf), null);
});

test('#74 the costs\' E2E hook only in a simulation, and only as JSON', () => {
  const on = { CRAFTORIO_SIMULATION_ONLY: '1', CRAFTORIO_E2E_ONBOARDING_COSTS: '{"profile":0.42}' };
  assert.deepEqual(simulation.e2eOnboardingCosts(on), { profile: 0.42 });
  assert.equal(simulation.e2eOnboardingCosts({ ...on, CRAFTORIO_SIMULATION_ONLY: '0' }), null);
  assert.equal(simulation.e2eOnboardingCosts({ ...on, CRAFTORIO_E2E_ONBOARDING_COSTS: 'x' }), null);
});
