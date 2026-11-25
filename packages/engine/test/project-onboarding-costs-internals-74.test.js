// #74, the details behind project-onboarding-costs-74.test.js: what Retry and a restart may pay, the analysis
// asked during the clone, the interview's free read and its estimate, and the E2E hook of the costs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const arch = require('../domains/oracle/oracle-architecture');
const oracleSeeds = require('../domains/oracle/oracle-seeds');
const projects = require('../domains/project/projects');
const seedRuns = require('../service/seed-runs');
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
  const calls = { facts: 0, free: 0, map: 0, paid: 0 };
  const once = (name) => { if (fail[name]) { fail[name] -= 1; throw new Error(`${name} failed`); } };
  const jobs = {
    facts: async () => { calls.facts += 1; once('facts'); return {}; },
    profile: async ({ oracle }) => {
      calls[oracle ? 'paid' : 'free'] += 1;
      once(oracle ? 'paid' : 'free');
      return oracle ? { profile: PROFILE, costUsd: 0.42 } : { profile: PROFILE, needsOracle: true };
    },
    projectMap: async () => { calls.map += 1; if (hold) await hold; once('map'); return { cost_usd: 0.74 }; },
  };
  const make = (more = {}) => createOnboarding({
    projectsDir: path.join(root, 'projects'), reposDir: path.join(root, 'repos'), slotsDir: path.join(root, 'locks'),
    git, jobs, cli: async () => ({ installed: true, signedIn: true }), ...more,
  });
  return { calls, make, ob: make() };
}
const start = async (ob) => (await ob.start({ name: 'Widgets', repo: 'https://github.com/acme/widgets.git' })).projectId;

test('#74 a profile that waits for the Oracle keeps git\'s profile, and says nothing cost', async (t) => {
  const { calls, ob } = setup(t);
  const id = await start(ob);
  const s = await until(ob, id, (x) => x.jobs.profile.profile, 'the free read ends');
  assert.deepEqual(s.jobs.profile, { status: 'waiting', profile: PROFILE });
  assert.deepEqual(calls, { facts: 1, free: 1, map: 0, paid: 0 });
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

test('#74 one Retry asks the Oracle once, when the project map and the profile\'s turn both failed and the turn fails again', async (t) => {
  const { calls, ob } = setup(t, { fail: { map: 1, paid: 9 } });
  const id = await start(ob);
  await until(ob, id, (x) => x.jobs.profile.profile, 'the free read ends');
  await ob.analyze(id);
  await until(ob, id, (x) => x.status === 'analyzed' && x.jobs.profile.status === 'failed' && x.jobs.projectMap.status === 'failed', 'both fail');
  assert.equal(calls.paid, 1);
  await ob.retry(id);
  await until(ob, id, (x) => x.status === 'analyzed' && x.jobs.projectMap.status === 'done', 'the map runs again');
  await pause(50);
  assert.equal(calls.paid, 2);
});

test('#74 after a restart a project map already saved is done with its cost, and Analyze does not pay it again', async (t) => {
  const { calls, make, ob } = setup(t);
  const id = await start(ob);
  await until(ob, id, (x) => x.jobs.profile.profile, 'the free read ends');
  const again = make({ savedMap: (p) => (p.id === id ? { costUsd: 0.74 } : null) });
  assert.deepEqual(again.status(id).jobs.projectMap, { status: 'done', costUsd: 0.74 });
  await until(again, id, (x) => x.jobs.profile.profile, 'the free read runs again');
  await again.analyze(id);
  const end = await until(again, id, (x) => x.status === 'analyzed', 'the analysis ends');
  assert.equal(end.jobs.projectMap.costUsd, 0.74);
  assert.deepEqual({ map: calls.map, paid: calls.paid }, { map: 0, paid: 1 });
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

// the jobs after a restart, the profile's paid answer already saved: the free read answers it whole, with its cost
const answeredJobs = (calls) => ({
  facts: async () => ({}),
  profile: async ({ oracle }) => { calls[oracle ? 'paid' : 'free'] += 1; return { profile: PROFILE, costUsd: 0.42 }; },
  projectMap: async () => { calls.map += 1; return { cost_usd: 0.74 }; },
});

test('#74 after a restart with the profile paid and no map, the profile says its cost and Analyze pays only the map', async (t) => {
  const { calls, make, ob } = setup(t);
  const id = await start(ob);
  await until(ob, id, (x) => x.jobs.profile.profile, 'the free read ends');
  calls.free = 0;
  const again = make({ jobs: answeredJobs(calls) });
  const before = await until(again, id, (x) => x.jobs.profile.status === 'done', 'the saved answer is read');
  assert.deepEqual([before.status, before.jobs.profile.costUsd], ['ready', 0.42]);
  assert.deepEqual(before.jobs.projectMap, { status: 'waiting' });
  await again.analyze(id);
  const end = await until(again, id, (x) => x.status === 'analyzed', 'the analysis ends');
  assert.deepEqual([end.jobs.profile.costUsd, end.jobs.projectMap.costUsd], [0.42, 0.74]);
  assert.deepEqual(calls, { facts: 1, free: 1, map: 1, paid: 0 });
});

test('#74 after a restart with both analyses saved, Analyze pays nothing', async (t) => {
  const { calls, make, ob } = setup(t);
  const id = await start(ob);
  await until(ob, id, (x) => x.jobs.profile.profile, 'the free read ends');
  const again = make({ jobs: answeredJobs(calls), savedMap: () => ({ costUsd: 0.74 }) });
  await until(again, id, (x) => x.jobs.profile.status === 'done', 'the saved answer is read');
  await again.analyze(id);
  const end = await until(again, id, (x) => x.status === 'analyzed', 'the analysis ends');
  assert.deepEqual([end.jobs.profile.costUsd, end.jobs.projectMap.costUsd], [0.42, 0.74]);
  assert.deepEqual([calls.map, calls.paid], [0, 0]);
});

test('#74 an analysis whose record says no cost is done without one, never $0', async (t) => {
  const { make, ob } = setup(t);
  const id = await start(ob);
  await until(ob, id, (x) => x.jobs.profile.profile, 'the free read ends');
  const again = make({ jobs: { ...answeredJobs({ free: 0, map: 0, paid: 0 }), profile: async () => ({ profile: PROFILE, costUsd: null }) }, savedMap: () => ({ costUsd: null }) });
  const s = await until(again, id, (x) => x.jobs.profile.status === 'done', 'the profile ends');
  assert.deepEqual(s.jobs.projectMap, { status: 'done' });
  assert.equal('costUsd' in s.jobs.profile, false);
});

test('#74 the Oracle\'s turn refused by the budget fails the profile, not the map, and Retry asks again', async (t) => {
  const { calls, make } = setup(t);
  let refused = true;
  const ob = make({ jobs: {
    ...answeredJobs(calls),
    profile: async ({ oracle }) => {
      if (!oracle) return { profile: PROFILE, needsOracle: true };
      calls.paid += 1;
      return refused ? { refused: { text: 'The Oracle\'s daily budget is spent.' } } : { profile: PROFILE, costUsd: 0.42 };
    },
  } });
  const id = await start(ob);
  await until(ob, id, (x) => x.jobs.profile.profile, 'the free read ends');
  await ob.analyze(id);
  const s = await until(ob, id, (x) => x.status === 'analyzed', 'the analysis ends');
  assert.deepEqual([s.jobs.profile.status, s.jobs.profile.code], ['failed', 'refused']);
  assert.match(s.jobs.profile.reason, /daily budget/);
  assert.equal('costUsd' in s.jobs.profile, false);
  assert.equal(s.jobs.projectMap.costUsd, 0.74);
  refused = false;
  await ob.retry(id);
  const end = await until(ob, id, (x) => x.jobs.profile.status === 'done', 'Retry asks again');
  assert.equal(end.jobs.profile.costUsd, 0.42);
  assert.deepEqual([calls.paid, calls.map], [2, 1]);
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
  return { area: require('../service/areas/workflow-interview')(ctx), oracle, project, turns, ws };
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

test('#74 the free read answers even with the Oracle\'s budget spent, its Oracle phase pending', async (t) => {
  const { area, oracle, project, turns } = await interview(t);
  oracle.budgetRefusal = () => ({ text: 'over budget' });
  const p = await project('demo');
  assert.equal((await area.workflowInterview({ projectId: p.id, free: true })).needsOracle, true);
  assert.equal((await area.workflowInterviewState({ projectId: p.id })).phases.oracle.status, 'pending');
  assert.equal((await area.workflowInterview({ projectId: p.id })).refused.text, 'over budget');
  assert.equal(turns.length, 0);
});

test('#74 the paid answer a free read gives ends its Oracle phase', async (t) => {
  const { area, project } = await interview(t);
  const p = await project('demo');
  await area.workflowInterview({ projectId: p.id });
  await area.workflowInterview({ projectId: p.id, free: true });
  assert.equal((await area.workflowInterviewState({ projectId: p.id })).phases.oracle.status, 'done');
});

test('#74 a simulated run, or one older than the import, is no paid answer', async (t) => {
  const { area, project, ws } = await interview(t);
  const simulated = await project('simulated');
  env(t, { CRAFTORIO_SIMULATION_ONLY: '1' });
  await area.workflowInterview({ projectId: simulated.id });
  process.env.CRAFTORIO_SIMULATION_ONLY = '0';
  assert.equal((await area.workflowInterview({ projectId: simulated.id, free: true })).needsOracle, true);

  const older = await project('older');
  await area.workflowInterview({ projectId: older.id });
  const root = seedRuns.seedsRoot({ ws });
  const [{ date }] = oracleSeeds.listSeedRuns(root, older.id, 'ways-of-working');
  const file = path.join(oracleSeeds.seedRunsDir(root, older.id, 'ways-of-working'), date, 'run.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), at: '2020-01-01T00:00:00.000Z' }));
  assert.equal((await area.workflowInterview({ projectId: older.id, free: true })).needsOracle, true);
});

test('#74 a turn the CLI gave no cost for says it is not known, never $0', async (t) => {
  const { area, oracle, project } = await interview(t);
  const turn = oracle.oneTurn;
  oracle.oneTurn = async (x) => ({ ...await turn(x), costUsd: undefined });
  const p = await project('demo');
  assert.equal((await area.workflowInterview({ projectId: p.id })).costUsd, null);
  assert.equal((await area.workflowInterviewEstimate({ projectId: p.id })).costUsd, null);
});

test('#74 the estimate is the project\'s own runs\', else the mean of the other projects\'', async (t) => {
  const { area, oracle, project } = await interview(t);
  const turn = oracle.oneTurn;
  const [a, b, c] = [await project('one'), await project('two'), await project('three')];
  await area.workflowInterview({ projectId: a.id }); // 0.5
  oracle.oneTurn = async (x) => ({ ...await turn(x), costUsd: 0.25 });
  await area.workflowInterview({ projectId: b.id });
  assert.deepEqual(await area.workflowInterviewEstimate({ projectId: b.id }), { costUsd: 0.25, free: false, basis: 1 });
  assert.deepEqual(await area.workflowInterviewEstimate({ projectId: c.id }), { costUsd: 0.375, free: false, basis: 2 });
});

test('#74 sinceCreated: a record before the import is not the project\'s; without a date it is', () => {
  const p = { createdAt: '2026-11-25T10:00:00.000Z' };
  assert.equal(seedRuns.sinceCreated(p, '2026-11-25T09:59:59.000Z'), false);
  assert.equal(seedRuns.sinceCreated(p, '2026-11-25T10:00:00.000Z'), true);
  assert.equal(seedRuns.sinceCreated(p, null), true);
  assert.equal(seedRuns.sinceCreated({}, '2020-01-01T00:00:00.000Z'), true);
});

test('#74 in a simulation the costs\' E2E hook is the profile\'s estimate, and the onboarding\'s profile waits as a paid one', async (t) => {
  const { area, project, ws } = await interview(t);
  env(t, { CRAFTORIO_SIMULATION_ONLY: '1', CRAFTORIO_E2E_ONBOARDING_COSTS: '{"profile":0.42,"projectMap":0.74}' });
  const p = await project('demo');
  assert.deepEqual(await area.workflowInterviewEstimate({ projectId: p.id }), { costUsd: 0.42, free: false, basis: 1 });
  projects.updateProject(ws.projects, p.id, { onboarding: { step: 'analysis', picks: {} } });
  const app = require('../service/areas/project-onboarding')({ ...area, ws, events: { emit() {} } });
  const s = await until({ status: (projectId) => app.onboardingStatus({ projectId }) }, p.id, (x) => x.jobs.profile.profile, 'the free read ends');
  assert.equal(s.jobs.profile.status, 'waiting');
  assert.equal('simulated' in s.jobs.profile, false);
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

// seeds:run always asks the Oracle for this seed without a tool: seeds:estimate may say the interview's estimate only
// while git never settles the whole profile
test('#74 git never settles the release style, so the seed\'s estimate is never free without a tool', async (t) => {
  const { area, project } = await interview(t);
  const p = await project('demo');
  execFileSync('git', ['tag', 'v1.0.0'], { cwd: p.folder });
  fs.writeFileSync(path.join(p.folder, '.gitlab-ci.yml'), 'release:\n  only: [tags]\n');
  const free = await area.workflowInterview({ projectId: p.id, free: true });
  assert.equal(free.profile.release, null);
  assert.equal((await area.workflowInterviewEstimate({ projectId: p.id })).free, false);
});

test('#74 the app reads the saved map of a resumed onboarding: the real report since the import, not a simulated or an older one', async (t) => {
  const ws = setupWorkspace(tmp(t, 'costs-74-int-map-'), { persist: false });
  const root = path.join(ws.root, 'architecture');
  const p = await projects.createProject(ws.projects, { name: 'demo', folder: repository(t) });
  projects.updateProject(ws.projects, p.id, { onboarding: { step: 'review', picks: {}, finished: true } });
  const report = { summary: 's', areas: [], findings: [] };
  const created = Date.parse(projects.readProject(ws.projects, p.id).createdAt);
  const at = (ms) => new Date(created + ms).toISOString();
  const mapNow = () => require('../service/areas/project-onboarding')({ ws, events: { emit() {} } }).onboardingStatus({ projectId: p.id }).jobs.projectMap;
  arch.saveReport(root, p.id, { date: at(-60e3), costUsd: 9, simulated: false, report });
  assert.deepEqual(mapNow(), { status: 'waiting' });
  arch.saveReport(root, p.id, { date: at(60e3), costUsd: 0.74, simulated: false, report });
  assert.deepEqual(mapNow(), { status: 'done', costUsd: 0.74 });
  arch.saveReport(root, p.id, { date: at(120e3), costUsd: 0, simulated: true, report });
  assert.deepEqual(mapNow(), { status: 'waiting' });
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
