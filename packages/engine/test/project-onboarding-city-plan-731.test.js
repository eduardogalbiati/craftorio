// #731: the onboarding's "Cidade e arquitetura" analysis (the projectMap job of
// packages/engine/service/areas/project-onboarding.js) draws the project's city plan: the cartographer's turn
// (zones, districts, landmarks, ports as path rules), validated and saved (project-map.js saveMap, read back by
// oracle-architecture.js readPlan), then the Oracle's report (saveReport). After it the project's City is
// grouped by the plan (CityModel buildCity grouping 'plan') and "Analyze" is only a refresh.
// Acceptance tests, written before the code. Everything the change may create is loaded inside each test.
//
// Two seams:
// - the whole service in a simulation (test/service/helpers.js makeService, MULTIAGENT_SIMULATION_ONLY=1):
//   onboarding:start on a local git repository (a real clone, no network), onboarding:analyze, then
//   architecture:city / architecture:reports. The E2E hook MULTIAGENT_E2E_CITY_PLAN_FAIL=1
//   (features/steps/onboarding.steps.js, #731) makes the simulated city plan throw
//   "The simulated city plan failed (e2e).".
// - the area itself with a fake ctx and no simulation, the model turns mocked at their boundary.
//   ASSUMPTION: the cartographer's turn, like the Oracle's, is one turn of ctx.oracleService().oneTurn
//   ({ prompt, ... } -> { text, costUsd, tokens }); the fake routes by prompt: the Oracle's analysis prompt
//   (oracle-architecture.js analysisPrompt, "Architecture analysis of the project") gets a report, any other
//   prompt is the cartographer's and gets `{ "city_plan": <plan> }` in a ```json fence (the plan step's
//   output_schema of workflows/analyze-project.yaml).
//   ASSUMPTION (estimate): the onboarding's estimate is api.architectureEstimate, i.e.
//   arch.estimateCost(arch.listReports(...)); "covers both turns" = the saved report's cost is the
//   cartographer's plus the Oracle's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// the machine slot the paid jobs take: a folder of this file, never the machine's
process.env.MULTIAGENT_LOCKS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'city-plan-731-locks-'));

const ORACLE_PROMPT = 'Architecture analysis of the project';
const PLAN_COST = 0.3;
const ORACLE_COST = 0.5;

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return dir;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const FILES = [
  'README.md', 'package.json',
  'src/api/a1.js', 'src/api/a2.js', 'src/api/a3.js', 'src/api/a4.js',
  'src/core/c1.js', 'src/core/c2.js', 'src/core/c3.js', 'src/core/c4.js',
  'docs/d1.md', 'docs/d2.md', 'docs/d3.md',
];

// a local repository with one commit (cloned by path: real git, no network)
function repoWith(t) {
  const dir = tmp(t, 'city-plan-731-repo-');
  const git = (args, env = {}) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git(['init', '-q']);
  for (const rel of FILES) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rel.endsWith('.json') ? '{ "name": "city" }\n' : `// ${rel}\n`);
  }
  const date = '2026-01-05T12:00:00Z';
  git(['add', '-A']);
  git(['commit', '-q', '--no-verify', '-m', 'first'], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return dir;
}

// the cartographer's plan: zones, districts, a landmark and a port, every file covered
const PLAN = {
  version: 1,
  project: 'city',
  summary: 'A small fixture city.',
  ignore: [],
  zones: [
    { id: 'core', name: 'Core', kind: 'industrial', purpose: 'The code.' },
    { id: 'books', name: 'Books', kind: 'library', purpose: 'The docs.' },
  ],
  districts: [
    { id: 'api', name: 'API Gate', zone: 'core', purpose: 'The HTTP API.', include: ['/src/api/**'], exclude: [] },
    { id: 'engine', name: 'Engine Works', zone: 'core', purpose: 'The core.', include: ['/src/core/**'], exclude: [] },
    { id: 'manual', name: 'Manual Hall', zone: 'books', purpose: 'The docs.', include: ['/docs/**', '/README.md', '/package.json'], exclude: [] },
  ],
  landmarks: [{ path: 'src/core/c1.js', label: 'The engine' }],
  ports: [{ id: 'http', name: 'HTTP', via: ['src/api/a1.js'] }],
  evidence: ['package.json'],
};
// a plan the validator refuses: one district covers 4 of 13 files (coverage under 95%)
const BAD_PLAN = { ...PLAN, districts: [PLAN.districts[0]] };

const REPORT = {
  summary: 'The fixture city is small and tidy.',
  areas: [{ area: 'src', verdict: 'Fine.' }],
  findings: [],
};

const fence = (x) => `\`\`\`json\n${JSON.stringify(x, null, 2)}\n\`\`\``;

// the model turns, mocked at the Oracle's oneTurn: counts and answers per turn kind
function fakeTurns() {
  // oracleText: null answers the report; a string answers that text instead (no report in it: the turn fails)
  const turns = { plan: 0, oracle: 0, planAnswer: PLAN, oracleText: null };
  const oracle = {
    budgetRefusal: () => null,
    oneTurn: async ({ prompt }) => {
      if (String(prompt).includes(ORACLE_PROMPT)) {
        turns.oracle += 1;
        return { text: turns.oracleText ?? fence(REPORT), costUsd: ORACLE_COST, tokens: { input: 10, output: 10 } };
      }
      turns.plan += 1;
      return { text: fence({ city_plan: turns.planAnswer }), costUsd: PLAN_COST, tokens: { input: 10, output: 10 } };
    },
  };
  return { turns, oracle };
}

// the area with a fake ctx (no simulation: the turns are the fakes)
function areaWith(t, oracle) {
  const prev = process.env.MULTIAGENT_SIMULATION_ONLY;
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { if (prev === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = prev; });
  const { setupWorkspace } = require('../domains/workspace/workspace');
  const ws = setupWorkspace(tmp(t, 'city-plan-731-ws-'), { persist: false });
  const { EventEmitter } = require('events');
  const ctx = {
    ws,
    events: new EventEmitter(),
    oracleService: () => oracle,
    workflowInterview: async () => ({ profile: { mode: 'remote', ci: 'release', tests: 'unit' } }),
  };
  const area = require('../service/areas/project-onboarding')(ctx);
  return { area, ws, archRoot: path.join(ws.root, 'architecture') };
}

const JOBS = ['clone', 'facts', 'profile', 'projectMap', 'ranking'];
const ended = (s) => !['cloning', 'analyzing'].includes(s.status) && JOBS.every((j) => !['running', 'waiting'].includes(s.jobs?.[j]?.status));

async function until(status, pred, what, tries = 600) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await status();
    if (pred(last)) return last;
    await pause(50);
  }
  assert.fail(`${what}: still ${JSON.stringify(last)}`);
}

// imported (a real clone of the local repository), then analyzed; the chain ended
async function onboarded(area, repo) {
  const s = await area.onboardingStart({ name: 'City', repo });
  const id = s.projectId;
  const status = () => area.onboardingStatus({ projectId: id });
  await until(status, (x) => x.status === 'ready' || x.status === 'failed', 'the clone ends');
  assert.equal((await status()).status, 'ready', 'the clone is ready');
  await area.onboardingAnalyze({ projectId: id });
  const end = await until(status, (x) => x.status === 'analyzed' && ended(x), 'the analysis ends');
  return { id, end, status };
}

// the project's City as architecture:city draws it: { grouping, districts (names, sorted) }
async function cityOf(ws, archRoot, id) {
  const arch = require('../domains/oracle/oracle-architecture');
  const facts = require('../domains/project/architecture-facts');
  const projects = require('../domains/project/projects');
  const { folder } = projects.readProject(ws.projects, id);
  const { plan } = arch.readPlan(archRoot, id);
  const city = await facts.readCity(folder, { plan, exclude: [] });
  return { grouping: city.model?.grouping ?? null, districts: (city.model?.districts || []).map((d) => String(d.name)).sort().join(',') };
}

// ---- 1. the plan is drawn (mocked turns) ---------------------------------------------------------------

test('#731 the onboarding\'s city analysis saves the cartographer\'s plan and the Oracle\'s report', { timeout: 60000 }, async (t) => {
  const { turns, oracle } = fakeTurns();
  const { area, ws, archRoot } = areaWith(t, oracle);
  const { id, end } = await onboarded(area, repoWith(t));
  assert.equal(end.jobs.projectMap.status, 'done', `the projectMap job: ${JSON.stringify(end.jobs.projectMap)}`);
  assert.equal(turns.plan >= 1, true, `the cartographer's turn ran (${turns.plan})`);
  assert.equal(turns.oracle, 1, 'the Oracle\'s turn ran once');
  const arch = require('../domains/oracle/oracle-architecture');
  const saved = arch.readPlan(archRoot, id).plan;
  assert.equal(saved === null, false, 'a city plan is saved for the project (city-plan.json)');
  assert.equal(saved.districts.map((d) => d.id).sort().join(','), 'api,engine,manual');
  assert.equal(saved.landmarks.map((l) => l.path).join(','), 'src/core/c1.js');
  assert.equal(saved.ports.map((p) => p.id).join(','), 'http');
  const reports = arch.listReports(archRoot, id);
  assert.equal(reports.length, 1, 'one Oracle report is saved');
  assert.equal(reports[0].report.summary, 'The fixture city is small and tidy.');
});

test('#731 after the onboarding the project\'s City is grouped by the plan\'s districts', { timeout: 60000 }, async (t) => {
  const { oracle } = fakeTurns();
  const { area, ws, archRoot } = areaWith(t, oracle);
  const { id } = await onboarded(area, repoWith(t));
  const city = await cityOf(ws, archRoot, id);
  assert.equal(city.grouping, 'plan');
  assert.equal(city.districts, 'API Gate,Engine Works,Manual Hall');
});

// ---- 1. its estimate covers both turns -----------------------------------------------------------------

test('#731 the city analysis\'s estimate (architectureEstimate) covers the cartographer\'s turn and the Oracle\'s', { timeout: 60000 }, async (t) => {
  const { oracle } = fakeTurns();
  const { area, archRoot } = areaWith(t, oracle);
  const { id } = await onboarded(area, repoWith(t));
  const arch = require('../domains/oracle/oracle-architecture');
  const estimate = arch.estimateCost(arch.listReports(archRoot, id));
  assert.equal(estimate === null, false, 'an estimate after a real (mocked) analysis');
  assert.equal(Math.round(estimate.usd * 100) / 100, 0.8, `the plan's $0.30 plus the Oracle's $0.50: ${estimate.usd}`);
});

// ---- 4. a failed plan says why, and Retry does not pay a done Oracle report again -----------------------

test('#731 a plan the validator refuses fails the job with a reason, and Retry draws it without paying the Oracle twice', { timeout: 90000 }, async (t) => {
  const { turns, oracle } = fakeTurns();
  turns.planAnswer = BAD_PLAN;
  const { area, ws, archRoot } = areaWith(t, oracle);
  const { id, end, status } = await onboarded(area, repoWith(t));
  const job = end.jobs.projectMap;
  assert.equal(job.status, 'failed', `the projectMap job: ${JSON.stringify(job)}`);
  assert.equal(typeof job.reason, 'string', 'jobs.projectMap.reason');
  assert.equal(job.reason.trim().length > 0 && job.reason.length <= 160, true, `a short reason: "${job.reason}"`);
  assert.equal(typeof job.code, 'string', 'jobs.projectMap.code');
  assert.equal(String(job.error || '').length > 0, true, 'the full error');
  assert.equal(end.jobs.ranking.status, 'skipped', 'no ranking without the map');
  const arch = require('../domains/oracle/oracle-architecture');
  assert.equal(arch.readPlan(archRoot, id).plan, null, 'no plan saved');
  assert.equal(turns.plan >= 1, true, 'the cartographer was asked');
  const oracleBefore = turns.oracle;
  assert.equal(oracleBefore <= 1, true, `the Oracle ran at most once (${oracleBefore})`);

  turns.planAnswer = PLAN; // the cartographer answers a valid plan now
  await area.onboardingRetry({ projectId: id });
  const after = await until(status, (x) => ended(x) && x.jobs.projectMap.status !== 'failed', 'the retry ends with the map done');
  assert.equal(after.jobs.projectMap.status, 'done');
  assert.equal(turns.oracle, 1, 'the Oracle\'s report is paid once over the failed run and its Retry');
  assert.equal(arch.listReports(archRoot, id).length, 1, 'one report saved');
  assert.equal((await cityOf(ws, archRoot, id)).grouping, 'plan');
});

// the review of #731: the plan is saved, then the Oracle's report fails; its Retry reuses the drawn plan
// (and its cost) instead of paying the cartographer again. Two failed Oracle turns, then one that answers.
test('#731 a Retry after a saved plan and a failed Oracle report reuses the plan: the cartographer is paid once, its cost goes into the report', { timeout: 120000 }, async (t) => {
  const { turns, oracle } = fakeTurns();
  turns.oracleText = 'I could not write the report this time.';
  const { area, ws, archRoot } = areaWith(t, oracle);
  const { id, end, status } = await onboarded(area, repoWith(t));
  const arch = require('../domains/oracle/oracle-architecture');
  assert.equal(end.jobs.projectMap.status, 'failed', `the projectMap job: ${JSON.stringify(end.jobs.projectMap)}`);
  assert.equal(String(end.jobs.projectMap.reason || '').length > 0, true, 'the failed report says why');
  assert.equal(turns.plan, 1, 'the cartographer drew the plan once');
  assert.equal(turns.oracle, 1, 'the Oracle was asked once');
  assert.equal(arch.readPlan(archRoot, id).plan === null, false, 'the plan was saved before the Oracle failed');
  assert.equal(arch.listReports(archRoot, id).length, 0, 'no report saved');

  // a first Retry: the Oracle fails again, the plan drawn is reused
  await area.onboardingRetry({ projectId: id });
  await pause(100);
  const again = await until(status, (x) => turns.oracle >= 2 && ended(x), 'the first retry ends');
  assert.equal(again.jobs.projectMap.status, 'failed');
  assert.equal(turns.oracle, 2, 'the Oracle was asked again');
  assert.equal(turns.plan, 1, 'the cartographer is not paid again on the Retry');

  // a second Retry: the Oracle answers; the plan is still the first one, and its cost is in the report
  turns.oracleText = null;
  await area.onboardingRetry({ projectId: id });
  const after = await until(status, (x) => ended(x) && x.jobs.projectMap.status === 'done', 'the second retry ends with the map done');
  assert.equal(after.jobs.projectMap.status, 'done');
  assert.equal(turns.plan, 1, 'one cartographer turn over the run and its two Retries');
  assert.equal(turns.oracle, 3);
  const reports = arch.listReports(archRoot, id);
  assert.equal(reports.length, 1, 'one report saved');
  const estimate = arch.estimateCost(reports);
  assert.equal(Math.round(estimate.usd * 100) / 100, 0.8, `the plan's $0.30 (once) plus the Oracle's $0.50: ${estimate.usd}`);
  assert.equal((await cityOf(ws, archRoot, id)).districts, 'API Gate,Engine Works,Manual Hall');
});

// ---- 2. the whole service, simulated: the City is ready after the onboarding ----------------------------

async function serviceOnboarded(t, api, repo) {
  const s = await api['onboarding:start']({ name: 'City', repo });
  const id = s.projectId;
  const status = () => api['onboarding:status']({ projectId: id });
  await until(status, (x) => x.status === 'ready' || x.status === 'failed', 'the clone ends');
  assert.equal((await status()).status, 'ready', 'the clone is ready');
  await api['onboarding:analyze']({ projectId: id });
  const end = await until(status, (x) => x.status === 'analyzed' && ended(x), 'the analysis ends');
  return { id, end, status };
}

test('#731 (service, simulated) after the onboarding architecture:city is grouped by a plan, no refresh advised, a report is listed', { timeout: 90000 }, async (t) => {
  const { makeService } = require('./service/helpers');
  const { api } = makeService(t);
  const { id, end } = await serviceOnboarded(t, api, repoWith(t));
  assert.equal(end.jobs.projectMap.status, 'done', `the projectMap job: ${JSON.stringify(end.jobs.projectMap)}`);
  const city = await api['architecture:city']({ projectId: id });
  assert.equal(city.state, 'ok');
  assert.equal(city.model?.grouping, 'plan', 'the City shows the plan\'s districts, not the folders');
  assert.equal(city.refresh?.suggested, false, 'the fresh plan covers the files: "Analyze" is not advised as a refresh yet');
  const reports = await api['architecture:reports']({ projectId: id });
  assert.equal(reports.length, 1, 'the Oracle\'s (simulated) report');
});

test('#731 (service, simulated) a failed city plan fails the job with its reason; Retry fails it again and the Oracle\'s report is not paid twice', { timeout: 90000 }, async (t) => {
  const { makeService } = require('./service/helpers');
  const { api } = makeService(t);
  process.env.MULTIAGENT_E2E_CITY_PLAN_FAIL = '1';
  t.after(() => { delete process.env.MULTIAGENT_E2E_CITY_PLAN_FAIL; });
  const { id, end, status } = await serviceOnboarded(t, api, repoWith(t));
  const job = end.jobs.projectMap;
  assert.equal(job.status, 'failed', `the projectMap job: ${JSON.stringify(job)}`);
  assert.equal(job.reason, 'The simulated city plan failed (e2e).');
  const city = await api['architecture:city']({ projectId: id });
  assert.equal(city.model?.grouping, 'folders', 'no plan saved');
  const reportsBefore = (await api['architecture:reports']({ projectId: id })).length;
  await api['onboarding:retry']({ projectId: id });
  await pause(200);
  const after = await until(status, (x) => ended(x), 'the retry ends');
  assert.equal(after.jobs.projectMap.status, 'failed');
  assert.equal(after.jobs.projectMap.reason, 'The simulated city plan failed (e2e).');
  const reportsAfter = (await api['architecture:reports']({ projectId: id })).length;
  assert.equal(reportsAfter <= 1, true, `at most one Oracle report over the run and its Retry (before ${reportsBefore}, after ${reportsAfter})`);
});
