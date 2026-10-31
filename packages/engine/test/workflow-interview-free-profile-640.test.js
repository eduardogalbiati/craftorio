// #640 (onboarding step 3): the Ways of working profile from git is always computed for free; the model
// is asked only for the fields it leaves null, and never under MULTIAGENT_SIMULATION_ONLY=1.
// Acceptance tests, written before the code.
//
// Spec (the interface these tests assume): require('../service/areas/workflow-interview')(ctx)
//   .workflowInterview({ projectId }) -> { profile, evidence, questions }, as in #487
//   (workflow-interview-487.test.js). The fields git settles (team, merge, testCommand, ... from the
//   history and the files) keep git's value; the Oracle's answer (ctx.oracleService(), the fake below)
//   only fills the fields git left null (release here: one commit, no tag).
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

// what the model would answer: every field disagrees with this repository's git history but release
const MODEL_PROFILE = { team: 'team', merge: 'pr', release: 'milestone', testCommand: 'make test', ci: 'github-actions', languages: ['go'] };
const MODEL_EVIDENCE = {
  team: { numbers: { authors: 5, commits: 900 }, commits: ['a1b2c3d'] },
  merge: { numbers: { mergeCommits: 40 }, commits: ['a1b2c3d'] },
  release: { numbers: { tags: 6, milestones: 6 }, commits: ['e4f5a6b'] },
};

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function simulation(t, value) {
  const before = process.env.MULTIAGENT_SIMULATION_ONLY;
  process.env.MULTIAGENT_SIMULATION_ONLY = value;
  t.after(() => { if (before === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = before; });
}

// a repository with one author, one commit, no merge, no tag, and an npm test script
function gitRepo(t) {
  const dir = tmp(t, 'wfi-640-repo-');
  const cfg = path.join(tmp(t, 'wfi-640-gitcfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "scripts": { "test": "npm run unit" } }\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  return dir;
}

function fakeOracle(profile, evidence) {
  const turns = [];
  const text = `\`\`\`json\n${JSON.stringify({ html: '<h1>Ways of working</h1>', model: { profile, evidence }, report: '- team' })}\n\`\`\`\n`;
  return { turns, budgetRefusal: () => null, oneTurn: async (args) => { turns.push(args); return { text, costUsd: 0.05, tokens: { input: 10, output: 10 } }; } };
}

async function setup(t) {
  const ws = setupWorkspace(tmp(t, 'wfi-640-ws-'), { persist: false });
  seeds.seedSeeds(seeds.BUNDLED_SEEDS_DIR, ws.seeds);
  const project = await projects.createProject(ws.projects, { name: 'demo', folder: gitRepo(t) });
  const oracle = fakeOracle(MODEL_PROFILE, MODEL_EVIDENCE);
  const ctx = { ws, host: { appVersion: '9.9.9', isPackaged: false }, oracleService: () => oracle, events: { emit: () => {} }, notify: () => {} };
  return { area: loadArea()(ctx), project, oracle };
}

test('#640 the fields git settles keep git\'s value whatever the model answers', async (t) => {
  simulation(t, '0');
  const { area, project } = await setup(t);
  const out = await area.workflowInterview({ projectId: project.id });
  assert.equal(out.profile.team, 'solo', 'one author in the history');
  assert.equal(out.profile.merge, 'local', 'no merge commit in the history');
  assert.equal(out.profile.testCommand, 'npm test', 'the package.json test script');
});

test('#640 the model fills the fields git leaves null', async (t) => {
  simulation(t, '0');
  const { area, project } = await setup(t);
  const out = await area.workflowInterview({ projectId: project.id });
  assert.equal(out.profile.release, 'milestone');
});

test('#640 under MULTIAGENT_SIMULATION_ONLY=1 the free profile comes back and no model is called', async (t) => {
  simulation(t, '1');
  const { area, project, oracle } = await setup(t);
  const out = await area.workflowInterview({ projectId: project.id });
  assert.equal(oracle.turns.length, 0, 'no Oracle turn');
  assert.equal(out.profile.team, 'solo');
  assert.equal(out.profile.testCommand, 'npm test');
  assert.equal(out.profile.release, null, 'left open: nothing fills it without a model');
});
