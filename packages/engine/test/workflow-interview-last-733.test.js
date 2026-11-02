// #733 acceptance, written before the code: the Ways of working interview's last analysis read without
// running it, and the running interview's state (packages/engine/service/areas/workflow-interview.js,
// channels in packages/engine/service/channels/workflows.js). Same setup as workflow-interview-487.test.js:
// a git repository, the bundled seeds, the Oracle's turn faked at its boundary (ctx.oracleService()).
//
// The contract assumed here (new seams of #733):
//   area.workflowInterviewLast({ projectId }) → null when the project was never analyzed, else
//     { profile, evidence, questions, simulated, date, costUsd } of the last saved ways-of-working run
//     (no seed run, no Oracle turn);
//   area.workflowInterviewState({ projectId }) → { running: { since, items, last } | null, error }
//     (seed-runs.js runState of the ways-of-working seed);
//   channels workflows:interviewLast and workflows:interviewState (api.workflowInterviewLast /
//     api.workflowInterviewState), both { projectId }.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { setupWorkspace } = require('../domains/workspace/workspace');
const projects = require('../domains/project/projects');
const seeds = require('../domains/seed/seeds');

const loadArea = () => require('../service/areas/workflow-interview');

const PROFILE = { mode: 'local', release: 'milestone', testCommand: 'npm test', ci: 'release', tests: 'unit', languages: ['javascript'] };
const EVIDENCE = {
  mode: { numbers: { authors: 1, mergeCommits: 0 }, commits: ['a1b2c3d'] },
  release: { numbers: { tags: 6, milestones: 6 }, commits: ['e4f5a6b'] },
};

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function simulationOff(t) {
  const before = process.env.MULTIAGENT_SIMULATION_ONLY;
  process.env.MULTIAGENT_SIMULATION_ONLY = '0';
  t.after(() => { if (before === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = before; });
}

function gitRepo(t) {
  const dir = tmp(t, 'wfi-733-repo-');
  const cfg = path.join(tmp(t, 'wfi-733-gitcfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "scripts": { "test": "node --test" } }\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  return { dir };
}

// a fake Oracle answering the seed's page and model; `gate`: a promise its turn waits for
function fakeOracle({ gate = null } = {}) {
  const turns = [];
  const text = `\`\`\`json\n${JSON.stringify({ html: '<h1>Ways of working</h1>', model: { profile: PROFILE, evidence: EVIDENCE }, report: '- solo' })}\n\`\`\`\n`;
  return {
    turns,
    budgetRefusal: () => null,
    oneTurn: async (args) => { turns.push(args); if (gate) await gate; return { text, costUsd: 0.05, tokens: { input: 10, output: 10 } }; },
  };
}

async function setup(t, oracleOpts) {
  simulationOff(t);
  const ws = setupWorkspace(tmp(t, 'wfi-733-ws-'), { persist: false });
  seeds.seedSeeds(seeds.BUNDLED_SEEDS_DIR, ws.seeds);
  const repo = gitRepo(t);
  const project = await projects.createProject(ws.projects, { name: 'demo', folder: repo.dir });
  const oracle = fakeOracle(oracleOpts);
  const ctx = { ws, host: { appVersion: '9.9.9', isPackaged: false }, oracleService: () => oracle, events: { emit: () => {} }, notify: () => {} };
  return { area: loadArea()(ctx), project, oracle };
}

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

test('#733 the last interview answers the saved run\'s profile, evidence and open questions', async (t) => {
  const { area, project } = await setup(t);
  const ran = await area.workflowInterview({ projectId: project.id });
  assert.equal(typeof area.workflowInterviewLast, 'function', 'area.workflowInterviewLast');
  const last = await area.workflowInterviewLast({ projectId: project.id });
  assert.equal(last.profile.release, 'milestone');
  assert.equal(last.profile.testCommand, 'npm test');
  assert.equal(last.evidence.release.numbers.tags, 6);
  assert.deepEqual(last.questions.map((q) => q.id).sort(), ran.questions.map((q) => q.id).sort());
});

test('#733 the last interview carries the run\'s date and cost', async (t) => {
  const { area, project } = await setup(t);
  await area.workflowInterview({ projectId: project.id });
  assert.equal(typeof area.workflowInterviewLast, 'function', 'area.workflowInterviewLast');
  const last = await area.workflowInterviewLast({ projectId: project.id });
  assert.equal(Number.isNaN(Date.parse(String(last.date))), false, `a date: ${last.date}`);
  assert.equal(last.costUsd, 0.05);
});

test('#733 reading the last interview runs no Oracle turn', async (t) => {
  const { area, project, oracle } = await setup(t);
  await area.workflowInterview({ projectId: project.id });
  assert.equal(typeof area.workflowInterviewLast, 'function', 'area.workflowInterviewLast');
  await area.workflowInterviewLast({ projectId: project.id });
  await area.workflowInterviewLast({ projectId: project.id });
  assert.equal(oracle.turns.length, 1, 'only the interview\'s own turn');
});

test('#733 a project never analyzed has no last interview, and none is run', async (t) => {
  const { area, project, oracle } = await setup(t);
  assert.equal(typeof area.workflowInterviewLast, 'function', 'area.workflowInterviewLast');
  const last = await area.workflowInterviewLast({ projectId: project.id });
  assert.equal(last == null, true);
  assert.equal(oracle.turns.length, 0);
});

test('#733 the interview\'s state says running while the analysis runs, and idle after', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { area, project } = await setup(t, { gate });
  assert.equal(typeof area.workflowInterviewState, 'function', 'area.workflowInterviewState');
  const run = area.workflowInterview({ projectId: project.id });
  let during;
  try {
    await settle();
    for (let i = 0; i < 100 && !(await area.workflowInterviewState({ projectId: project.id }))?.running; i++) await new Promise((r) => setTimeout(r, 20));
    during = await area.workflowInterviewState({ projectId: project.id });
  } finally {
    release();
    await run;
  }
  assert.equal(typeof during?.running?.since, 'string', 'running: { since, items, last }');
  const after = await area.workflowInterviewState({ projectId: project.id });
  assert.equal(after.running, null);
});

test('#733 the service registers workflows:interviewLast and workflows:interviewState', (t) => {
  const { makeService } = require('./service/helpers');
  const { api } = makeService(t);
  assert.equal(typeof api['workflows:interviewLast'], 'function');
  assert.equal(typeof api['workflows:interviewState'], 'function');
});
