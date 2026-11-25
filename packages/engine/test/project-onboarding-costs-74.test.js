// #74: an import never spends before it is asked to. The Oracle's turn that completes the Ways of working
// profile (seed ways-of-working, packages/engine/service/areas/workflow-interview.js) used to run right after
// the clone, before any price was shown and whatever the wizard's Skip said.
// Acceptance tests, written before the code.
//
// Seam: the onboarding area (packages/engine/service/areas/project-onboarding.js) with the real
// workflow-interview area in its ctx, no simulation, real git on a local repository; the model is mocked at its
// boundary, ctx.oracleService().oneTurn, which routes by prompt: the seed's, the Oracle's report, else the
// cartographer's plan (as in project-onboarding-city-plan-731.test.js).
//
// Contract:
// - no model turn before onboarding:analyze, also after a restart (restore). What the profile job shows
//   until then (git's free profile, or waiting) is the developer's choice;
// - onboarding:analyze asks the profile's turn once when git leaves a field open (release here: no tag);
// - a done job says what it cost in the onboarding's state, from its record: jobs.profile.costUsd and
//   jobs.projectMap.costUsd (the cartographer's turn plus the Oracle's), what the wizard's review reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');

// the machine slot the paid jobs take: a folder of this file, never the machine's
process.env.CRAFTORIO_LOCKS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'costs-74-locks-'));
test.after(() => fs.rmSync(process.env.CRAFTORIO_LOCKS_DIR, { recursive: true, force: true }));

const PROFILE_COST = 0.4159;
const PLAN_COST = 0.3;
const REPORT_COST = 0.5;
const QUIET_MS = 1000;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return dir;
}

function simulation(t, value) {
  const before = process.env.CRAFTORIO_SIMULATION_ONLY;
  process.env.CRAFTORIO_SIMULATION_ONLY = value;
  t.after(() => { if (before === undefined) delete process.env.CRAFTORIO_SIMULATION_ONLY; else process.env.CRAFTORIO_SIMULATION_ONLY = before; });
}

// one commit, one author, no tag: git leaves the release style open
const FILES = ['README.md', 'package.json', 'src/api/a1.js', 'src/api/a2.js', 'src/api/a3.js', 'src/core/c1.js', 'src/core/c2.js', 'src/core/c3.js', 'docs/d1.md', 'docs/d2.md', 'docs/d3.md'];
function repoWith(t) {
  const dir = tmp(t, 'costs-74-repo-');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  for (const rel of FILES) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rel.endsWith('.json') ? '{ "name": "costs", "scripts": { "test": "npm run unit" } }\n' : `// ${rel}\n`);
  }
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', 'first');
  return dir;
}

const PLAN = {
  version: 1,
  project: 'costs',
  summary: 'A small fixture city.',
  ignore: [],
  zones: [{ id: 'core', name: 'Core', kind: 'industrial', purpose: 'The code.' }, { id: 'books', name: 'Books', kind: 'library', purpose: 'The docs.' }],
  districts: [
    { id: 'api', name: 'API Gate', zone: 'core', purpose: 'The HTTP API.', include: ['/src/api/**'], exclude: [] },
    { id: 'engine', name: 'Engine Works', zone: 'core', purpose: 'The core.', include: ['/src/core/**'], exclude: [] },
    { id: 'manual', name: 'Manual Hall', zone: 'books', purpose: 'The docs.', include: ['/docs/**', '/README.md', '/package.json'], exclude: [] },
  ],
  landmarks: [{ path: 'src/core/c1.js', label: 'The engine' }],
  ports: [],
  evidence: ['package.json'],
};
const REPORT = { summary: 'The fixture city is small and tidy.', areas: [{ area: 'src', verdict: 'Fine.' }], findings: [] };
const SEED_ANSWER = { html: '<h1>Ways of working</h1>', model: { profile: { release: 'milestone' }, evidence: {} }, report: '- release' };

const fence = (x) => `\`\`\`json\n${JSON.stringify(x, null, 2)}\n\`\`\``;

function fakeOracle() {
  const turns = []; // 'profile' | 'report' | 'plan', in order
  const answer = (kind, body, costUsd) => {
    turns.push(kind);
    return { text: fence(body), costUsd, tokens: { input: 10, output: 10 } };
  };
  const oracle = {
    budgetRefusal: () => null,
    oneTurn: async ({ prompt }) => {
      const text = String(prompt);
      if (text.includes('analysis seed "ways-of-working"')) return answer('profile', SEED_ANSWER, PROFILE_COST);
      if (text.includes('Architecture analysis of the project')) return answer('report', REPORT, REPORT_COST);
      return answer('plan', { city_plan: PLAN }, PLAN_COST);
    },
  };
  return { turns, oracle };
}

function workspaceOf(t) {
  const { setupWorkspace } = require('../domains/workspace/workspace');
  const seeds = require('../domains/seed/seeds');
  const ws = setupWorkspace(tmp(t, 'costs-74-ws-'), { persist: false });
  seeds.seedSeeds(seeds.BUNDLED_SEEDS_DIR, ws.seeds);
  return ws;
}

// the areas of one app process on the workspace
function appOn(ws, oracle) {
  const ctx = { ws, events: new EventEmitter(), host: { appVersion: '9.9.9', isPackaged: false }, oracleService: () => oracle, notify: () => {} };
  Object.assign(ctx, require('../service/areas/workflow-interview')(ctx));
  Object.assign(ctx, require('../service/areas/project-onboarding')(ctx));
  return ctx;
}

async function until(status, pred, what, tries = 600) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await status();
    if (pred(last)) return last;
    await pause(50);
  }
  assert.fail(`${what}: still ${JSON.stringify(last)}`);
}

// the free part ended (the facts done, the profile not running), then a quiet time in which a turn would start
async function freePartEnded(app, projectId) {
  const status = () => app.onboardingStatus({ projectId });
  await until(status, (s) => s.status === 'ready' && s.jobs.facts.status === 'done' && s.jobs.profile.status !== 'running', 'the free part ends');
  await pause(QUIET_MS);
  return status();
}

async function imported(app, t) {
  const { projectId } = await app.onboardingStart({ name: 'Costs', repo: repoWith(t) });
  await freePartEnded(app, projectId);
  return projectId;
}

async function analyzed(app, projectId) {
  await app.onboardingAnalyze({ projectId });
  const end = await until(() => app.onboardingStatus({ projectId }), (s) => s.status === 'analyzed' && ['profile', 'projectMap'].every((j) => !['waiting', 'running'].includes(s.jobs[j].status)), 'the analysis ends');
  assert.equal(end.jobs.profile.status, 'done', `the profile job: ${JSON.stringify(end.jobs.profile)}`);
  assert.equal(end.jobs.projectMap.status, 'done', `the projectMap job: ${JSON.stringify(end.jobs.projectMap)}`);
  return end;
}

const cents = (n) => Math.round(Number(n) * 100) / 100;

// ---- nothing is paid before it is asked for ----------------------------------------------------------------

test('#74 an imported repository asks no model before Analyze, though git leaves the profile open', { timeout: 60000 }, async (t) => {
  simulation(t, '0');
  const { turns, oracle } = fakeOracle();
  await imported(appOn(workspaceOf(t), oracle), t);
  assert.deepEqual(turns, [], 'no model turn after the clone');
});

test('#74 skipping the analyses asks no model, also when the app restarts and restores the onboarding', { timeout: 60000 }, async (t) => {
  simulation(t, '0');
  const { turns, oracle } = fakeOracle();
  const ws = workspaceOf(t);
  const app = appOn(ws, oracle);
  const projectId = await imported(app, t);
  await app.onboardingSaveWizard({ projectId, step: 'review', picks: { analyzeLater: true } });
  const restarted = appOn(ws, oracle);
  await freePartEnded(restarted, projectId);
  assert.deepEqual(turns, [], 'no model turn, before or after the restart');
});

// ---- Analyze runs it, once, and says what it cost ----------------------------------------------------------

test('#74 Analyze asks the Oracle once for the fields git left open, and the profile keeps its answer', { timeout: 90000 }, async (t) => {
  simulation(t, '0');
  const { turns, oracle } = fakeOracle();
  const app = appOn(workspaceOf(t), oracle);
  const projectId = await imported(app, t);
  const before = turns.length;
  const end = await analyzed(app, projectId);
  assert.deepEqual(turns.slice(before).filter((k) => k === 'profile'), ['profile'], 'the profile\'s turn runs after Analyze, once');
  assert.equal(turns.filter((k) => k === 'report').length, 1, 'the report is asked once');
  assert.equal(end.jobs.profile.profile.release, 'milestone', 'the Oracle\'s answer for the open field');
});

test('#74 the state says what each done analysis cost, from its record', { timeout: 90000 }, async (t) => {
  simulation(t, '0');
  const { oracle } = fakeOracle();
  const app = appOn(workspaceOf(t), oracle);
  const projectId = await imported(app, t);
  const end = await analyzed(app, projectId);
  const last = await app.workflowInterviewLast({ projectId });
  assert.equal(cents(last.costUsd), 0.42, 'the record of the profile\'s turn');
  assert.equal(cents(end.jobs.profile.costUsd), 0.42, `jobs.profile: ${JSON.stringify(end.jobs.profile)}`);
  assert.equal(cents(end.jobs.projectMap.costUsd), 0.8, `the plan's turn plus the report's: ${JSON.stringify(end.jobs.projectMap)}`);
});

test('#74 with no model turn (simulated) the analyses end done and cost nothing', { timeout: 60000 }, async (t) => {
  simulation(t, '1');
  const { turns, oracle } = fakeOracle();
  const app = appOn(workspaceOf(t), oracle);
  const projectId = await imported(app, t);
  const end = await analyzed(app, projectId);
  assert.deepEqual(turns, []);
  assert.equal(Number(end.jobs.profile.costUsd || 0), 0);
  assert.equal(Number(end.jobs.projectMap.costUsd || 0), 0);
});
