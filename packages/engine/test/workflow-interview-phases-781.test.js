// #781 acceptance, written before the code: the phases of the Ways of working interview, what the wizard's
// activity lines read (packages/engine/service/areas/workflow-interview.js). Same setup as
// workflow-interview-last-733.test.js: a git repository, the bundled seeds, the Oracle's turn faked at its
// boundary (ctx.oracleService()); no model turn as in workflow-interview-free-profile-640.test.js (simulation).
//
// The contract assumed here: area.workflowInterviewState({ projectId }) keeps { running, error } (#733) and adds
//   phases: {
//     git:    { status, found: { commits, merges, tags, authors } },   // found once done
//     files:  { status, found: { languages: [...], testCommand, ci } },
//     oracle: { status, since, reading },
//   } | null/absent when no interview ran on this project in this engine
// status: pending | running | done | failed | not-needed (not-needed: oracle only).
// - while the free profile is read, BEFORE the seed starts (`running` still null): phases.git.status === 'running'
//   (the state is set synchronously when workflowInterview starts);
// - while the Oracle's turn runs: git and files done with `found`, oracle running with `since` (ISO) and `reading`
//   (the running seed's `last`, as soon as there is one);
// - no model turn (simulation, or no field left open): oracle 'not-needed', and the Oracle is never called;
// - after the interview ends the phases stay (all ended) until the next interview; a second one starts them over.
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
const EVIDENCE = { release: { numbers: { tags: 1, milestones: 1 }, commits: ['e4f5a6b'] } };

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function simulation(t, value) {
  const before = process.env.CRAFTORIO_SIMULATION_ONLY;
  process.env.CRAFTORIO_SIMULATION_ONLY = value;
  t.after(() => { if (before === undefined) delete process.env.CRAFTORIO_SIMULATION_ONLY; else process.env.CRAFTORIO_SIMULATION_ONLY = before; });
}

// three commits (one a merge), one tag, one author, an npm test script, no CI
function gitRepo(t) {
  const dir = tmp(t, 'wfi-781-repo-');
  const cfg = path.join(tmp(t, 'wfi-781-gitcfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "scripts": { "test": "node --test" } }\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  git('tag', 'v1');
  git('checkout', '-q', '-b', 'side');
  fs.writeFileSync(path.join(dir, 'a.js'), 'module.exports = 1;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'side');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  return dir;
}

// a fake Oracle answering the seed's page and model. gate: a promise its turn waits for; item: what the turn
// streams first; fails: the turn throws
function fakeOracle({ gate = null, item = null, fails = false } = {}) {
  const turns = [];
  const text = `\`\`\`json\n${JSON.stringify({ html: '<h1>Ways of working</h1>', model: { profile: PROFILE, evidence: EVIDENCE }, report: '- solo' })}\n\`\`\`\n`;
  return {
    turns,
    budgetRefusal: () => null,
    oneTurn: async (args) => {
      turns.push(args);
      if (item) args.onItem?.(item);
      if (gate) await gate;
      if (fails) throw new Error('the model call failed');
      return { text, costUsd: 0.05, tokens: { input: 10, output: 10 } };
    },
  };
}

async function setup(t, oracleOpts) {
  const ws = setupWorkspace(tmp(t, 'wfi-781-ws-'), { persist: false });
  seeds.seedSeeds(seeds.BUNDLED_SEEDS_DIR, ws.seeds);
  const project = await projects.createProject(ws.projects, { name: 'demo', folder: gitRepo(t) });
  const oracle = fakeOracle(oracleOpts);
  const ctx = { ws, host: { appVersion: '9.9.9', isPackaged: false }, oracleService: () => oracle, events: { emit: () => {} }, notify: () => {} };
  const area = loadArea()(ctx);
  return { area, project, oracle, state: () => area.workflowInterviewState({ projectId: project.id }) };
}

function gated() {
  let release;
  const gate = new Promise((r) => { release = r; });
  return { gate, release };
}

// waits for the Oracle's turn to start
async function turnStarted(oracle) {
  for (let i = 0; i < 500 && !oracle.turns.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(oracle.turns.length, 1, 'the Oracle\'s turn started');
}

const GIT_FOUND = { commits: 3, merges: 1, tags: 1, authors: 1 };
const FILES_FOUND = { languages: ['js'], testCommand: 'npm test', ci: 'none' };
const statuses = (s) => ['git', 'files', 'oracle'].map((id) => s?.phases?.[id]?.status ?? null);

test('#781 a project with no interview in this engine has no phases', async (t) => {
  simulation(t, '0');
  const { state } = await setup(t);
  assert.equal((await state()).phases == null, true);
});

test('#781 while the free profile is read, before the seed starts, git is running and the Oracle pending', async (t) => {
  simulation(t, '0');
  const { area, project, state } = await setup(t);
  const run = area.workflowInterview({ projectId: project.id });
  const early = await state();
  await run;
  assert.equal(early.running, null, 'the seed did not start yet');
  assert.equal(early.phases?.git?.status, 'running');
  assert.equal(early.phases?.oracle?.status, 'pending');
});

test('#781 while the Oracle\'s turn runs, git and files are done with what they found', async (t) => {
  simulation(t, '0');
  const { gate, release } = gated();
  const { area, project, oracle, state } = await setup(t, { gate });
  const run = area.workflowInterview({ projectId: project.id });
  let during;
  try {
    await turnStarted(oracle);
    during = await state();
  } finally {
    release();
    await run;
  }
  assert.equal(during.phases?.git?.status, 'done');
  assert.deepEqual(during.phases?.git?.found, GIT_FOUND);
  assert.equal(during.phases?.files?.status, 'done');
  assert.deepEqual(during.phases?.files?.found, FILES_FOUND);
});

test('#781 while the Oracle\'s turn runs, its phase is running with `since` and what it reads', async (t) => {
  simulation(t, '0');
  const { gate, release } = gated();
  const { area, project, oracle, state } = await setup(t, { gate, item: { kind: 'text', text: 'Reading the tags' } });
  const run = area.workflowInterview({ projectId: project.id });
  let during;
  try {
    await turnStarted(oracle);
    during = await state();
  } finally {
    release();
    await run;
  }
  assert.equal(during.phases?.oracle?.status, 'running');
  assert.match(String(during.phases?.oracle?.since), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
  assert.equal(during.phases?.oracle?.reading, 'Reading the tags');
});

test('#781 under simulation the Oracle is not needed and never called', async (t) => {
  simulation(t, '1');
  const { area, project, oracle, state } = await setup(t);
  await area.workflowInterview({ projectId: project.id });
  assert.deepEqual(statuses(await state()), ['done', 'done', 'not-needed']);
  assert.equal(oracle.turns.length, 0);
});

test('#781 after the interview the phases stay, all ended, with what they found', async (t) => {
  simulation(t, '0');
  const { area, project, state } = await setup(t);
  await area.workflowInterview({ projectId: project.id });
  const after = await state();
  assert.equal(after.running, null);
  assert.deepEqual(statuses(after), ['done', 'done', 'done']);
  assert.deepEqual(after.phases?.git?.found, GIT_FOUND);
  assert.deepEqual(after.phases?.files?.found, FILES_FOUND);
});

test('#781 a second interview starts the phases over', async (t) => {
  simulation(t, '0');
  const { area, project, state } = await setup(t);
  await area.workflowInterview({ projectId: project.id });
  const again = area.workflowInterview({ projectId: project.id });
  const early = await state();
  await again;
  assert.equal(early.phases?.git?.status, 'running');
  assert.equal(early.phases?.oracle?.status, 'pending');
});

test('#781 an Oracle\'s turn that fails leaves its phase failed, git and files done', async (t) => {
  simulation(t, '0');
  const { area, project, state } = await setup(t, { fails: true });
  await assert.rejects(area.workflowInterview({ projectId: project.id }), /the model call failed/);
  assert.deepEqual(statuses(await state()), ['done', 'done', 'failed']);
});
