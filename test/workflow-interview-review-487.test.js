// #487 (review round 2): the Ways of working area (src/service/areas/workflow-interview.js) beyond
// the acceptance tests: writing merges the composed entries into the repository's manifest (the other
// entries, version and requires stay), a manifest with errors is refused and nothing is written, the
// seed run shared with the Architecture tab (src/service/seed-runs.js) refuses a second run as busy
// while the first one runs and seeds:list shows it running, and in simulation the profile comes from
// the project's files (a Go project: go test, go).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { execFileSync } = require('child_process');
const { setupWorkspace } = require('../src/workspace');
const projects = require('../src/projects');
const seeds = require('../src/seeds');
const workflowInterview = require('../src/service/areas/workflow-interview');
const seedChannels = require('../src/service/channels/seeds');

const SOLO_PROFILE = { team: 'solo', merge: 'local', release: 'milestone', testCommand: 'npm test', ci: 'github-actions', languages: ['javascript'] };
const SOLO_EVIDENCE = { team: { numbers: { authors: 1, commits: 12 }, commits: ['a1b2c3d'] } };

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

// a repository with one commit, git run with no global or system config
function gitRepo(t) {
  const dir = tmp(t, 'wfi-r-487-repo-');
  const cfg = path.join(tmp(t, 'wfi-r-487-gitcfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "scripts": { "test": "node --test" } }\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  return { dir, git };
}

// a fake Oracle (src/domains/oracle/oracle.js oneTurn) answering the seed's page and model; `gate` holds the answer
function fakeOracle({ gate = null } = {}) {
  const turns = [];
  const text = `\`\`\`json\n${JSON.stringify({ html: '<h1>Ways of working</h1>', model: { profile: SOLO_PROFILE, evidence: SOLO_EVIDENCE }, report: '- solo' })}\n\`\`\`\n`;
  return { turns, budgetRefusal: () => null, oneTurn: async (args) => { turns.push(args); if (gate) await gate; return { text, costUsd: 0.05, tokens: { input: 10, output: 10 } }; } };
}

async function setup(t, { folder = null, simulated = false, gate = null } = {}) {
  simulation(t, simulated ? '1' : '0');
  const ws = setupWorkspace(tmp(t, 'wfi-r-487-ws-'), { persist: false });
  seeds.seedSeeds(seeds.BUNDLED_SEEDS_DIR, ws.seeds);
  const dir = folder || gitRepo(t).dir;
  const project = await projects.createProject(ws.projects, { name: 'demo', folder: dir });
  const oracle = fakeOracle({ gate });
  const ctx = { ws, host: { appVersion: '9.9.9', isPackaged: false }, oracleService: () => oracle, events: { emit: () => {} }, notify: () => {} };
  return { ctx, area: workflowInterview(ctx), project, dir, oracle };
}

const manifestFile = (dir) => path.join(dir, '.multiagent', 'project.yaml');
function writeManifest(dir, text) {
  fs.mkdirSync(path.dirname(manifestFile(dir)), { recursive: true });
  fs.writeFileSync(manifestFile(dir), text);
}
const settle = async (until) => { for (let i = 0; i < 200 && !until(); i++) await new Promise((r) => setTimeout(r, 5)); };

test('#487 writing keeps the repository manifest\'s other entries, version and requires', async (t) => {
  const { area, project, dir } = await setup(t);
  await area.workflowInterview({ projectId: project.id });
  writeManifest(dir, 'version: 2\nrequires: ">=1.0"\nworkflows:\n  - name: software-development\n    category: team\n');
  const out = await area.workflowCompose({ projectId: project.id, answers: {}, write: true });
  const doc = yaml.load(fs.readFileSync(manifestFile(dir), 'utf8'));
  assert.equal(doc.version, 2);
  assert.equal(doc.requires, '>=1.0');
  assert.deepEqual(doc.workflows.map((w) => w.name), ['software-development', ...out.workflows.map((w) => w.name)]);
});

test('#487 writing replaces the manifest entry of the same name, once and in its place', async (t) => {
  const { area, project, dir } = await setup(t);
  await area.workflowInterview({ projectId: project.id });
  const preview = await area.workflowCompose({ projectId: project.id, answers: {} });
  const dev = preview.workflows.find((w) => w.category === 'solo').name;
  writeManifest(dir, `version: 1\nworkflows:\n  - name: ${dev}\n    file: workflows/old-dev.yaml\n    category: solo\n  - name: software-development\n    category: team\n`);
  await area.workflowCompose({ projectId: project.id, answers: {}, write: true });
  const entries = yaml.load(fs.readFileSync(manifestFile(dir), 'utf8')).workflows;
  assert.equal(entries[0].name, dev);
  assert.equal(entries[0].file, `workflows/${dev}.yaml`);
  assert.equal(entries.filter((e) => e.name === dev).length, 1);
  assert.equal(entries[1].name, 'software-development');
});

test('#487 a repository manifest with errors is refused and nothing is written', async (t) => {
  const { area, project, dir } = await setup(t);
  await area.workflowInterview({ projectId: project.id });
  writeManifest(dir, 'version: 1\nworkflows: 5\n');
  await assert.rejects(area.workflowCompose({ projectId: project.id, answers: {}, write: true }), (e) => {
    assert.equal(e.status, 400);
    assert.match(e.message, /Fix \.multiagent\/project\.yaml first/);
    return true;
  });
  assert.equal(fs.readFileSync(manifestFile(dir), 'utf8'), 'version: 1\nworkflows: 5\n');
  assert.equal(fs.existsSync(path.join(dir, '.multiagent', 'workflows')), false);
});

test('#487 a second analysis while the first runs is refused as busy and seeds:list shows it running', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { ctx, area, project, oracle } = await setup(t, { gate });
  const list = seedChannels(ctx).find((c) => c.channel === 'seeds:list').fn;
  const row = async () => (await list({ projectId: project.id })).find((r) => r.id === 'ways-of-working');
  const first = area.workflowInterview({ projectId: project.id });
  await settle(() => oracle.turns.length === 1);
  assert.equal(oracle.turns.length, 1);
  const second = await area.workflowInterview({ projectId: project.id });
  assert.equal(second?.refused?.reason, 'busy');
  assert.equal((await row()).running === null, false);
  release();
  const out = await first;
  assert.equal(out.profile.team, 'solo');
  assert.equal((await row()).running, null);
  assert.equal(oracle.turns.length, 1);
});

test('#487 in simulation a Go project without package.json gets go test and go in its profile', async (t) => {
  const folder = tmp(t, 'wfi-r-487-go-');
  fs.writeFileSync(path.join(folder, 'go.mod'), 'module example.com/demo\n\ngo 1.22\n');
  fs.writeFileSync(path.join(folder, 'main.go'), 'package main\n\nfunc main() {}\n');
  const { area, project, oracle } = await setup(t, { folder, simulated: true });
  const out = await area.workflowInterview({ projectId: project.id });
  assert.equal(oracle.turns.length, 0);
  assert.equal(out.profile.testCommand, 'go test ./...');
  assert.deepEqual(out.profile.languages, ['go']);
  assert.equal(out.profile.team, 'solo');
  assert.equal(out.profile.merge, 'local');
  assert.equal(out.profile.release, null);
  const ids = out.questions.map((q) => q.id);
  assert.equal(ids.includes('release'), true);
  assert.equal(ids.includes('merge'), false);
  assert.equal(out.questions.find((q) => q.id === 'screenshots').default, 'off');
});
