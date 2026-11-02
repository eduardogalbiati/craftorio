// #730: the onboarding's analysis keeps the Oracle's findings in its report and sends none anywhere on its
// own: no finding becomes a Refactor proposal (no refactor-proposals-run.js addFindings), and the Product
// Owner's `ranking` job is gone from the onboarding's jobs (the wizard's review lists the findings, each
// with Create issue / Create issue and prioritize). Acceptance tests, written before the code, with the two
// seams of project-onboarding-city-plan-731.test.js:
// - the area (packages/engine/service/areas/project-onboarding.js) with a fake ctx and no simulation, the
//   model turns mocked at their boundary (ctx.oracleService().oneTurn: the Oracle's analysis prompt gets a
//   report with two findings, any other prompt is the cartographer's and gets the city plan);
// - the whole service in a simulation (test/service/helpers.js makeService).
// Observable state only: onboarding:status's jobs, the saved reports (oracle-architecture.js listReports),
// the project's Refactor store (refactor-proposals.js listProposals / readRanking, refactor:proposals).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// the machine slot the paid jobs take: a folder of this file, never the machine's
process.env.MULTIAGENT_LOCKS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'findings-730-locks-'));

const ORACLE_PROMPT = 'Architecture analysis of the project';

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return dir;
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const FILES = ['README.md', 'package.json', 'src/api/a1.js', 'src/api/a2.js', 'src/core/c1.js', 'src/core/c2.js', 'docs/d1.md'];

function repoWith(t) {
  const dir = tmp(t, 'findings-730-repo-');
  const git = (args, env = {}) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git(['init', '-q']);
  for (const rel of FILES) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rel.endsWith('.json') ? '{ "name": "health" }\n' : `// ${rel}\n`);
  }
  const date = '2026-01-05T12:00:00Z';
  git(['add', '-A']);
  git(['commit', '-q', '--no-verify', '-m', 'first'], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return dir;
}

const PLAN = {
  version: 1, project: 'health', summary: 'A small fixture.', ignore: [],
  zones: [{ id: 'core', name: 'Core', kind: 'industrial', purpose: 'The code.' }, { id: 'books', name: 'Books', kind: 'library', purpose: 'The docs.' }],
  districts: [
    { id: 'api', name: 'API Gate', zone: 'core', purpose: 'The API.', include: ['/src/api/**'], exclude: [] },
    { id: 'engine', name: 'Engine Works', zone: 'core', purpose: 'The core.', include: ['/src/core/**'], exclude: [] },
    { id: 'manual', name: 'Manual Hall', zone: 'books', purpose: 'The docs.', include: ['/docs/**', '/README.md', '/package.json'], exclude: [] },
  ],
  landmarks: [{ path: 'src/core/c1.js', label: 'The engine' }],
  ports: [{ id: 'http', name: 'HTTP', via: ['src/api/a1.js'] }],
  evidence: ['package.json'],
};
const REPORT = {
  summary: 'The fixture is small; the core repeats a rule.',
  areas: [{ area: 'src', verdict: 'Fine.' }],
  findings: [
    { kind: 'duplicated-rule', title: 'The core repeats the rule.', severity: 'high', files: [{ path: 'src/core/c1.js' }, { path: 'src/core/c2.js' }], evidence: 'Both files apply the same rule.', refactor: 'Keep one copy.' },
    { kind: 'god-file', title: 'The API gate does too much.', severity: 'medium', files: [{ path: 'src/api/a1.js' }], evidence: 'It handles every route.', refactor: 'Split the routes.' },
  ],
};
const fence = (x) => `\`\`\`json\n${JSON.stringify(x, null, 2)}\n\`\`\``;

function fakeOracle() {
  const turns = { plan: 0, oracle: 0, other: 0 };
  const oracle = {
    budgetRefusal: () => null,
    oneTurn: async ({ prompt }) => {
      if (String(prompt).includes(ORACLE_PROMPT)) {
        turns.oracle += 1;
        return { text: fence(REPORT), costUsd: 0.5, tokens: { input: 10, output: 10 } };
      }
      turns.plan += 1;
      return { text: fence({ city_plan: PLAN }), costUsd: 0.3, tokens: { input: 10, output: 10 } };
    },
  };
  return { turns, oracle };
}

function areaWith(t, oracle) {
  const prev = process.env.MULTIAGENT_SIMULATION_ONLY;
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { if (prev === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = prev; });
  const { setupWorkspace } = require('../domains/workspace/workspace');
  const ws = setupWorkspace(tmp(t, 'findings-730-ws-'), { persist: false });
  const { EventEmitter } = require('events');
  const ctx = {
    ws,
    events: new EventEmitter(),
    oracleService: () => oracle,
    workflowInterview: async () => ({ profile: { mode: 'remote', ci: 'release', tests: 'unit' } }),
  };
  const area = require('../service/areas/project-onboarding')(ctx);
  return { area, ws, archRoot: path.join(ws.root, 'architecture'), refactorRoot: path.join(ws.root, 'refactor') };
}

// every job the state lists has ended (whatever jobs it lists)
const ended = (s) => !['cloning', 'analyzing'].includes(s.status) && Object.values(s.jobs || {}).every((j) => !['running', 'waiting'].includes(j?.status));

async function until(status, pred, what, tries = 600) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await status();
    if (pred(last)) return last;
    await pause(50);
  }
  assert.fail(`${what}: still ${JSON.stringify(last)}`);
}

async function onboarded(start, analyze, statusOf, repo) {
  const s = await start({ name: 'Health', repo });
  const id = s.projectId;
  const status = () => statusOf({ projectId: id });
  await until(status, (x) => x.status === 'ready' || x.status === 'failed', 'the clone ends');
  assert.equal((await status()).status, 'ready', 'the clone is ready');
  await analyze({ projectId: id });
  const end = await until(status, (x) => x.status === 'analyzed' && ended(x), 'the analysis ends');
  return { id, end, start: s };
}

test('#730 the onboarding\'s jobs have no ranking job (clone, facts, profile, projectMap)', { timeout: 60000 }, async (t) => {
  const { oracle } = fakeOracle();
  const { area } = areaWith(t, oracle);
  const { end, start } = await onboarded(area.onboardingStart, area.onboardingAnalyze, area.onboardingStatus, repoWith(t));
  assert.deepEqual(Object.keys(start.jobs || {}).sort(), ['clone', 'facts', 'profile', 'projectMap'], 'the jobs listed at the start');
  assert.deepEqual(Object.keys(end.jobs).sort(), ['clone', 'facts', 'profile', 'projectMap'], 'the jobs at the end');
  assert.equal(end.jobs.projectMap.status, 'done', `the projectMap job: ${JSON.stringify(end.jobs.projectMap)}`);
});

test('#730 the onboarding keeps the Oracle\'s findings in its report and makes no Refactor proposal nor ranking', { timeout: 60000 }, async (t) => {
  const { turns, oracle } = fakeOracle();
  const { area, archRoot, refactorRoot } = areaWith(t, oracle);
  const { id } = await onboarded(area.onboardingStart, area.onboardingAnalyze, area.onboardingStatus, repoWith(t));
  const arch = require('../domains/oracle/oracle-architecture');
  const reports = arch.listReports(archRoot, id);
  assert.equal(reports.length, 1, 'the Oracle\'s report is saved');
  assert.deepEqual(reports[0].report.findings.map((f) => f.title), ['The core repeats the rule.', 'The API gate does too much.']);
  const proposals = require('../domains/refactor/refactor-proposals');
  assert.equal(proposals.listProposals(refactorRoot, id).length, 0, 'no finding became a Refactor proposal');
  assert.equal(proposals.readRanking(refactorRoot, id) ?? null, null, 'no Product Owner ranking saved');
  assert.deepEqual([turns.plan, turns.oracle], [1, 1], 'only the cartographer\'s and the Oracle\'s turns');
});

test('#730 (service, simulated) after the onboarding refactor:proposals is empty and the status lists no ranking job', { timeout: 90000 }, async (t) => {
  const { makeService } = require('./service/helpers');
  const { api } = makeService(t);
  const { id, end } = await onboarded(api['onboarding:start'], api['onboarding:analyze'], api['onboarding:status'], repoWith(t));
  assert.equal(end.jobs.projectMap.status, 'done', `the projectMap job: ${JSON.stringify(end.jobs.projectMap)}`);
  assert.equal('ranking' in end.jobs, false, `jobs: ${Object.keys(end.jobs).join(', ')}`);
  const reports = await api['architecture:reports']({ projectId: id });
  assert.equal(reports.length, 1, 'the Oracle\'s (simulated) report');
  assert.deepEqual(await api['refactor:proposals']({ projectId: id }), [], 'no proposal made from the findings');
});
