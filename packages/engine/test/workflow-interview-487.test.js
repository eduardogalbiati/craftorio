// #487: the workflow interview service area (packages/engine/service/areas/workflow-interview.js) and its
// channels (packages/engine/service/channels/workflows.js). Acceptance tests, written before the code.
//
// Spec (the interface these tests assume):
//   require('../service/areas/workflow-interview')(ctx) -> {
//     workflowInterview({ projectId }) -> Promise<{ profile, evidence, questions }>: runs the
//       ways-of-working seed on the project (packages/engine/domains/oracle/oracle-seeds.js runSeed, one Oracle turn through
//       ctx.oracleService() -> { oneTurn, budgetRefusal }, the boundary stubbed here; the seed read
//       from ctx.ws.seeds) and answers the seed's model.profile / model.evidence with
//       packages/engine/domains/workflow/workflow-compose.js openQuestions(profile) as `questions`.
//     workflowCompose({ projectId, answers, write }) -> Promise<{ workflows: [{ name, path, yaml }],
//       manifest: { path, yaml } }>: composeWorkflowSet over the project's latest interview profile
//       (its last ways-of-working run) and the answers. Without `write: true` nothing is written;
//       with it, each file is written under the project's folder (.multiagent/workflows/<name>.yaml,
//       .multiagent/project.yaml) and nothing is committed.
//   }
//   ctx: { ws, host, oracleService, events, notify } as the service gives its areas.
//   Channels: workflows:interview ({ projectId }) and workflows:compose ({ projectId, answers, write }).
//   MULTIAGENT_SIMULATION_ONLY is off in the area tests so the stubbed Oracle answers (no real model:
//   the Oracle is the fake below).
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

const SOLO_PROFILE = { mode: 'local', release: 'milestone', testCommand: 'npm test', ci: 'release', tests: 'unit', languages: ['javascript'] };
const SOLO_EVIDENCE = {
  mode: { numbers: { authors: 1, mergeCommits: 0, pullRequests: 0 }, commits: ['a1b2c3d'] },
  release: { numbers: { tags: 6, milestones: 6 }, commits: ['e4f5a6b'] },
  testCommand: { numbers: { scripts: 1 }, commits: [] },
  ci: { numbers: { workflows: 1 }, commits: [] },
  tests: { numbers: { unit: 40, e2e: 0 }, commits: [] },
  languages: { numbers: { javascript: 240 }, commits: [] },
};
const NO_RELEASE_PROFILE = { ...SOLO_PROFILE, release: null };
const NO_RELEASE_EVIDENCE = { ...SOLO_EVIDENCE, release: { numbers: { tags: 0, milestones: 0 }, commits: [] } };

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

// a repository with one commit, git run with no global or system config
function gitRepo(t) {
  const dir = tmp(t, 'wfi-487-repo-');
  const cfg = path.join(tmp(t, 'wfi-487-gitcfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "scripts": { "test": "node --test" } }\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  return { dir, git };
}

// a fake { oneTurn, budgetRefusal } of packages/engine/domains/oracle/oracle.js answering the seed's page and model
function fakeOracle(profile, evidence) {
  const turns = [];
  const text = `\`\`\`json\n${JSON.stringify({ html: '<h1>Ways of working</h1>', model: { profile, evidence }, report: '- solo' })}\n\`\`\`\n`;
  return { turns, budgetRefusal: () => null, oneTurn: async (args) => { turns.push(args); return { text, costUsd: 0.05, tokens: { input: 10, output: 10 } }; } };
}

async function setup(t, { profile = SOLO_PROFILE, evidence = SOLO_EVIDENCE } = {}) {
  simulationOff(t);
  const ws = setupWorkspace(tmp(t, 'wfi-487-ws-'), { persist: false });
  seeds.seedSeeds(seeds.BUNDLED_SEEDS_DIR, ws.seeds);
  const repo = gitRepo(t);
  const project = await projects.createProject(ws.projects, { name: 'demo', folder: repo.dir });
  const oracle = fakeOracle(profile, evidence);
  const ctx = { ws, host: { appVersion: '9.9.9', isPackaged: false }, oracleService: () => oracle, events: { emit: () => {} }, notify: () => {} };
  return { area: loadArea()(ctx), project, repo, oracle };
}

const questionIds = (out) => out.questions.map((q) => q.id).sort();

test('#487 the interview answers the profile the ways-of-working seed found', async (t) => {
  const { area, project } = await setup(t);
  const out = await area.workflowInterview({ projectId: project.id });
  assert.equal(out.profile.mode, 'local');
  assert.equal(out.profile.release, 'milestone');
  assert.equal(out.profile.testCommand, 'npm test');
  assert.equal(out.evidence.mode.numbers.authors, 1);
});

test('#487 the interview runs the ways-of-working seed in one Oracle turn', async (t) => {
  const { area, project, oracle } = await setup(t);
  await area.workflowInterview({ projectId: project.id });
  assert.equal(oracle.turns.length, 1);
  assert.equal(String(oracle.turns[0].prompt).includes('"ways-of-working"'), true);
});

test('#487 a solo profile with full evidence leaves only validate, budget, review and screenshots open', async (t) => {
  const { area, project } = await setup(t);
  assert.deepEqual(questionIds(await area.workflowInterview({ projectId: project.id })), ['budget', 'review', 'screenshots', 'validate']);
});

test('#487 a profile without release information asks the release style', async (t) => {
  const { area, project } = await setup(t, { profile: NO_RELEASE_PROFILE, evidence: NO_RELEASE_EVIDENCE });
  assert.equal(questionIds(await area.workflowInterview({ projectId: project.id })).includes('release'), true);
});

test('#487 compose without write returns the files and writes nothing into the project folder', async (t) => {
  const { area, project, repo } = await setup(t);
  await area.workflowInterview({ projectId: project.id });
  const out = await area.workflowCompose({ projectId: project.id, answers: { validate: true } });
  assert.equal(out.workflows.length >= 3, true);
  assert.equal(out.manifest.path, '.multiagent/project.yaml');
  assert.equal(fs.existsSync(path.join(repo.dir, '.multiagent')), false);
});

test('#487 compose with write writes the workflows and the manifest under the project\'s .multiagent', async (t) => {
  const { area, project, repo } = await setup(t);
  await area.workflowInterview({ projectId: project.id });
  const out = await area.workflowCompose({ projectId: project.id, answers: {}, write: true });
  for (const f of [...out.workflows, out.manifest]) {
    const file = path.join(repo.dir, ...f.path.split('/'));
    assert.equal(fs.existsSync(file), true, f.path);
    assert.equal(fs.readFileSync(file, 'utf8'), f.yaml, f.path);
  }
  assert.equal(fs.existsSync(path.join(repo.dir, '.multiagent', 'project.yaml')), true);
});

test('#487 compose with write commits nothing: the files stay untracked', async (t) => {
  const { area, project, repo } = await setup(t);
  await area.workflowInterview({ projectId: project.id });
  const head = repo.git('rev-parse', 'HEAD');
  await area.workflowCompose({ projectId: project.id, answers: {}, write: true });
  assert.equal(repo.git('rev-parse', 'HEAD'), head);
  assert.equal(repo.git('status', '--porcelain', '--', '.multiagent'), '?? .multiagent/');
});

test('#487 the service registers workflows:interview and workflows:compose', (t) => {
  const { makeService } = require('./service/helpers');
  const { api } = makeService(t);
  assert.equal(typeof api['workflows:interview'], 'function');
  assert.equal(typeof api['workflows:compose'], 'function');
});
