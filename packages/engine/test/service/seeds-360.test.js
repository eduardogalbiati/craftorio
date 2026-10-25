// #360: the analysis seeds' service channels, through makeService on a git fixture repository.
// The workspace gets the bundled seeds when the service starts; seeds:list lists them (never run, no
// tool), seeds:run (mock, simulation) saves a simulated result under
// <workspace>/architecture/<projectId>/seeds/<seedId>/ that seeds:history and seeds:result read back;
// a new commit makes the seed stale (commitsSince); seeds:setTool records a command that makes the
// estimate free; seeds:makeTool files nothing in simulation (a preview); an unknown seed is rejected.
// Every seeds:* channel declares schema.params/result. The channels are created by the change: each
// test calls them through the service (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService } = require('./helpers');

const CHANNELS = [
  'seeds:estimate',
  'seeds:history',
  'seeds:list',
  'seeds:makeTool',
  'seeds:result',
  'seeds:run',
  'seeds:setTool',
];

const BUNDLED = [
  'churn-complexity',
  'dependency-map',
  'pipeline-anatomy',
  'quality-gate-report',
  'ways-of-working',
];

const SEED = 'churn-complexity';

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// A fixture repo: two commits on main, fixed dates 2026-01-0N; commit() adds one more.
function fixtureRepo(t) {
  const dir = tmp(t, 'seeds360-repo-');
  let day = 1;
  const git = (args, env = {}) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const write = (rel, text) => {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const commit = (message) => {
    const date = `2026-01-${String(day++).padStart(2, '0')}T12:00:00Z`;
    git(['add', '-A']);
    git(['commit', '-q', '--no-verify', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-q']);
  write('src/app.js', 'const a = 1;\nmodule.exports = a;\n');
  write('src/util.js', 'module.exports = 2;\n');
  commit('first');
  write('src/app.js', 'const a = 2;\nmodule.exports = a;\n');
  const main = commit('second');
  return { dir, git, write, commit, main };
}

async function setup(t) {
  const { service, api } = makeService(t);
  const repo = fixtureRepo(t);
  const project = await api['projects:create']({ name: 'seeds', folder: repo.dir });
  return { service, api, repo, projectId: project.id };
}

async function call(api, channel, args) {
  assert.equal(typeof api[channel], 'function', `${channel} is a channel of the service`);
  return api[channel](args);
}

const rowOf = (list, id) => list.find((r) => r.id === id);

// ---------- schemas ----------

test('#360 every seeds:* channel of the contract declares schema.params and schema.result', (t) => {
  const { service } = makeService(t);
  const schemaOf = new Map(service.manifest.filter((e) => e.channel).map((e) => [e.channel, e.schema]));
  const missing = CHANNELS.filter((c) => !schemaOf.has(c));
  assert.deepEqual(missing, [], 'channels not served');
  const without = CHANNELS.filter((c) => { const s = schemaOf.get(c); return !(s && s.params && s.result); });
  assert.deepEqual(without, [], 'channels without schema.params/result');
});

// ---------- bundled seeds ----------

test('#360 the workspace gets the bundled seeds when the service starts', (t) => {
  const { service } = makeService(t);
  const file = path.join(service.workspace().root, 'seeds', SEED, 'seed.md');
  assert.equal(fs.existsSync(file), true, `${file} exists`);
});

test('#360 seeds:list lists the bundled seeds, never run and without a tool', async (t) => {
  const { api, projectId } = await setup(t);
  const list = await call(api, 'seeds:list', { projectId });
  assert.deepEqual(list.map((r) => r.id).sort(), BUNDLED);
  for (const id of BUNDLED) {
    const r = rowOf(list, id);
    assert.equal(r.lastRun, null, `${id} never run`);
    assert.equal(r.tool, null, `${id} has no tool`);
    assert.equal(typeof r.name, 'string', `${id} name`);
    assert.equal(typeof r.summary, 'string', `${id} summary`);
  }
});

// ---------- run, history, result ----------

test('#360 seeds:run in simulation saves a simulated result that seeds:history, seeds:result and seeds:list read back', async (t) => {
  const { service, api, projectId } = await setup(t);
  const out = await call(api, 'seeds:run', { projectId, seedId: SEED, mock: true });
  assert.equal(out.simulated, true);
  assert.equal(typeof out.date, 'string');
  assert.ok(out.date.length > 0, 'a run date');

  const history = await call(api, 'seeds:history', { projectId, seedId: SEED });
  assert.equal(history.length, 1);
  assert.equal(history[0].date, out.date);
  assert.equal(history[0].simulated, true);

  const result = await call(api, 'seeds:result', { projectId, seedId: SEED, date: out.date });
  assert.equal(typeof result.html, 'string');
  assert.ok(result.html.length > 0, 'html not empty');
  assert.equal(typeof result.model, 'object');
  assert.notEqual(result.model, null);

  const list = await call(api, 'seeds:list', { projectId });
  const r = rowOf(list, SEED);
  assert.ok(r.lastRun, 'lastRun after a run');
  assert.equal(r.lastRun.date, out.date);

  const root = service.workspace().root;
  const dir = path.join(root, 'architecture', projectId, 'seeds', SEED);
  assert.equal(fs.existsSync(dir), true, `${dir} exists`);
  const projectDir = path.join(root, 'projects', projectId);
  const underProject = fs.existsSync(projectDir) && fs.readdirSync(projectDir, { recursive: true }).some((f) => String(f).includes('seeds'));
  assert.equal(underProject, false, 'nothing about seeds under the project\'s own folder');
});

test('#360 after one new commit in the project\'s repo, seeds:list reports commitsSince 1', async (t) => {
  const { api, repo, projectId } = await setup(t);
  await call(api, 'seeds:run', { projectId, seedId: SEED, mock: true });
  repo.write('src/util.js', 'module.exports = 3;\n');
  repo.commit('third');
  const list = await call(api, 'seeds:list', { projectId });
  assert.equal(rowOf(list, SEED).commitsSince, 1);
});

// ---------- tools ----------

test('#360 seeds:setTool records a command: listed as the tool, the estimate free; null clears it', async (t) => {
  const { api, projectId } = await setup(t);
  const command = 'node tools/churn.js';
  await call(api, 'seeds:setTool', { projectId, seedId: SEED, command });
  const list = await call(api, 'seeds:list', { projectId });
  assert.equal(rowOf(list, SEED).tool, command);
  const estimate = await call(api, 'seeds:estimate', { projectId, seedId: SEED });
  assert.equal(estimate.free, true);
  assert.equal(estimate.costUsd, 0);

  await call(api, 'seeds:setTool', { projectId, seedId: SEED, command: null });
  const cleared = await call(api, 'seeds:list', { projectId });
  assert.equal(rowOf(cleared, SEED).tool, null);
});

test('#360 seeds:makeTool in simulation files nothing: a preview with a title and no url', async (t) => {
  const { api, projectId } = await setup(t);
  const out = await call(api, 'seeds:makeTool', { projectId, seedId: SEED });
  assert.equal(out.preview, true);
  assert.equal(out.url, null);
  assert.equal(typeof out.title, 'string');
  assert.ok(out.title.trim().length > 0, 'title not empty');
});

// ---------- errors ----------

test('#360 seeds:run rejects an unknown seed id', async (t) => {
  const { api, projectId } = await setup(t);
  assert.equal(typeof api['seeds:run'], 'function', 'seeds:run is a channel');
  await assert.rejects(async () => api['seeds:run']({ projectId, seedId: 'no-such-seed', mock: true }));
});
