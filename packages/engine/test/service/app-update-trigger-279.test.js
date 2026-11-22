// #279 at the service seam, after review: where the update applies (app-update:state, the Settings
// row), the Undo's channel (app-update:back), and the roadmap's trigger (#285: one trigger, a stage
// that ended; a stored appUpdateWhen 'marked' is ignored): a real item that merged and ended its stage
// starts the cycle and nothing more starts.
// The app folder and the project's clone are temporary git repositories (host.appDir), the restart
// is injected (host.relaunch); no model is ever called (the roadmap's workflow has no agent step).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const roadmapModel = require('../../domains/roadmap/roadmap');
const { makeService, roadmapIssue, until } = require('./helpers');

// a workflow with no agent: even a real (not mock) start can never call a model
const NO_AGENT_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-no-agent
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, required: true }
  issue: { type: string, default: "" }
agents: {}
steps:
  - id: review
    type: human_approval
    message: "Accept?"
`;

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The app folder and the workspace project's clone of the same upstream; the clone's main is
// `ahead` commits ahead. git (the test's and the service's) runs with an isolated config.
function appAndClone(t, { ahead = 3 } = {}) {
  const cfg = path.join(tmp(t, 'appupd-svc-cfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const prev = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = cfg;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(() => {
    if (prev.g === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = prev.g;
    if (prev.s === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = prev.s;
  });
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const commit = (dir, file, text, subject) => { fs.writeFileSync(path.join(dir, file), text); git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', subject); };
  const root = tmp(t, 'appupd-svc-');
  const upstream = path.join(root, 'upstream');
  fs.mkdirSync(upstream);
  git(upstream, 'init', '-q');
  commit(upstream, 'package-lock.json', '{"lockfileVersion":3}\n', 'initial');
  const appDir = path.join(root, 'app');
  const cloneDir = path.join(root, 'clone');
  git(root, 'clone', '-q', upstream, appDir);
  git(root, 'clone', '-q', upstream, cloneDir);
  const from = git(appDir, 'rev-parse', 'HEAD');
  for (let i = 1; i <= ahead; i++) commit(cloneDir, `fix${i}.txt`, `${i}\n`, `fix ${i}`);
  return { git, appDir, cloneDir, from, to: git(cloneDir, 'rev-parse', 'HEAD') };
}

test('#279 app-update:state: a project cloned from the app repository applies, with its name, short commit and how far behind the app is', async (t) => {
  const r = appAndClone(t, { ahead: 3 });
  const { api } = makeService(t, { appDir: r.appDir });
  await api['projects:create']({ name: 'craftorio', folder: r.cloneDir });
  const s = await api['app-update:state']({ fresh: true });
  assert.equal(s.applies, true);
  assert.equal(s.project.name, 'craftorio');
  assert.equal(s.behind, 3);
  assert.ok(r.to.startsWith(s.short) && s.short.length >= 7);
});

test('#279 app-update:state: no matching project, or a packaged app, does not apply and says why', async (t) => {
  const r = appAndClone(t);
  const { api } = makeService(t, { appDir: r.appDir });
  const none = await api['app-update:state']({ fresh: true });
  assert.equal(none.applies, false);
  assert.match(none.reason, /no project of this workspace is this app's repository/);

  const packaged = makeService(t, { appDir: r.appDir, isPackaged: true });
  await packaged.api['projects:create']({ name: 'craftorio', folder: r.cloneDir });
  const p = await packaged.api['app-update:state']({ fresh: true });
  assert.equal(p.applies, false);
  assert.match(p.reason, /packaged app updates with a new install/);
});

test('#279 app-update:back: refuses a value that is not a commit hash, a packaged app, and any update in simulation-only mode', async (t) => {
  const r = appAndClone(t);
  let relaunched = 0;
  const { api } = makeService(t, { appDir: r.appDir, relaunch: () => { relaunched++; } });
  await assert.rejects(async () => api['app-update:back']({ to: 'main; rm -rf /' }), /which commit/i);
  await assert.rejects(async () => api['app-update:back']({ to: '' }), /which commit/i);
  await assert.rejects(async () => api['app-update:back']({ to: r.from }), /simulation/i);

  const packaged = makeService(t, { appDir: r.appDir, isPackaged: true, relaunch: () => { relaunched++; } });
  await assert.rejects(async () => packaged.api['app-update:back']({ to: r.from }), /packaged app updates with a new install/i);
  assert.equal(relaunched, 0);
  assert.equal(r.git(r.appDir, 'rev-parse', 'HEAD'), r.from);
});

test('#279 #285 trigger: a real item that merged and ended its stage pauses the roadmap, updates the app and restarts, although the stored setting says "marked"; the next stage does not start', async (t) => {
  const r = appAndClone(t, { ahead: 2 });
  let relaunched = 0;
  const { service, api } = makeService(t, {
    appDir: r.appDir,
    relaunch: () => { relaunched++; process.env.CRAFTORIO_SIMULATION_ONLY = '1'; },
  });
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-no-agent.yaml'), NO_AGENT_WORKFLOW);
  const p = await api['projects:create']({ name: 'craftorio', folder: r.cloneDir });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [roadmapIssue(1), roadmapIssue(2)] }));
  const prev = api['settings:get']();
  api['settings:set']({ oracle: { ...prev.oracle, selfHealing: true, appUpdate: true, appUpdateWhen: 'marked' } });

  // stage 1: a real item (no mark: #285 removed it) whose run succeeded and merged, ending the stage;
  // the setting stored before #285 still says 'marked' and is ignored
  roadmapModel.saveStages(ws.backlog, p.id, [
    { items: [{ workflow: 'fixture-no-agent.yaml', number: 1, mock: false }] },
    { items: [{ workflow: 'fixture-no-agent.yaml', number: 2, mock: false }] },
  ], { issues: [roadmapIssue(1), roadmapIssue(2)] });
  roadmapModel.setState(ws.backlog, p.id, 'running', { simulated: false });
  const item1 = roadmapModel.readRoadmap(ws.backlog, p.id).stages[0].items[0];
  roadmapModel.markStarted(ws.backlog, p.id, item1.id, { runId: 'run-merged' });
  const runDir = path.join(ws.runs, 'run-merged');
  fs.mkdirSync(runDir, { recursive: true });
  // a finished run that counts as merged (a mock run's summary: merged by definition)
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    run_id: 'run-merged', workflow: 'fixture-no-agent', project_id: p.id, status: 'success', mock: true,
    started_at: '2026-10-04T10:00:00Z', finished_at: '2026-10-04T10:05:00Z',
    issues: [{ number: 1, url: roadmapIssue(1).url, title: roadmapIssue(1).title }], inputs: {}, sessions: [],
  }));
  await new Promise((resolve) => setTimeout(resolve, 50)); // the start-up dispatch of makeService is over

  // the update is real work (it is refused in simulation-only mode): the guard is lifted only for the
  // dispatch that triggers it and put back right after (and by the injected restart); the roadmap's
  // workflow has no agent, so even a regression that started stage 2 could not call a model
  delete process.env.CRAFTORIO_SIMULATION_ONLY;
  t.after(() => { process.env.CRAFTORIO_SIMULATION_ONLY = '1'; });
  try {
    await api['roadmap:start']({ projectId: p.id, simulated: false });
  } finally {
    process.env.CRAFTORIO_SIMULATION_ONLY = '1';
  }

  await until(() => relaunched === 1);
  assert.equal(r.git(r.appDir, 'rev-parse', 'HEAD'), r.to);
  const stored = roadmapModel.readRoadmap(ws.backlog, p.id);
  assert.equal(stored.state, 'paused');
  assert.equal(stored.error, 'Updating the app');
  assert.equal(stored.stages[1].items[0].runId || null, null); // stage 2 never started
  assert.deepEqual(api['runs:active'](), []);
  const intent = JSON.parse(fs.readFileSync(path.join(ws.oracle, 'app-update.json'), 'utf8'));
  assert.deepEqual(intent.roadmaps, [p.id]);
  const notes = api['notifications:list']({}).items.map((n) => `${n.title || ''} ${n.body || ''}`);
  assert.ok(notes.some((n) => n.includes(`Updating the app: ${r.from.slice(0, 7)} → ${r.to.slice(0, 7)}, 2 commits`)), notes.join(' | '));
});

test('#279 #285 trigger: with the switch off, a real item that merged and ended the last stage starts no update', async (t) => {
  const r = appAndClone(t, { ahead: 2 });
  let relaunched = 0;
  const { service, api } = makeService(t, { appDir: r.appDir, relaunch: () => { relaunched++; } });
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-no-agent.yaml'), NO_AGENT_WORKFLOW);
  const p = await api['projects:create']({ name: 'craftorio', folder: r.cloneDir });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [roadmapIssue(1)] }));
  const prev = api['settings:get']();
  api['settings:set']({ oracle: { ...prev.oracle, selfHealing: true, appUpdate: false } });
  roadmapModel.saveStages(ws.backlog, p.id, [{ items: [{ workflow: 'fixture-no-agent.yaml', number: 1, mock: false }] }], { issues: [roadmapIssue(1)] });
  roadmapModel.setState(ws.backlog, p.id, 'running', { simulated: false });
  const item1 = roadmapModel.readRoadmap(ws.backlog, p.id).stages[0].items[0];
  roadmapModel.markStarted(ws.backlog, p.id, item1.id, { runId: 'run-merged' });
  const runDir = path.join(ws.runs, 'run-merged');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    run_id: 'run-merged', workflow: 'fixture-no-agent', project_id: p.id, status: 'success', mock: true,
    started_at: '2026-10-04T10:00:00Z', finished_at: '2026-10-04T10:05:00Z',
    issues: [{ number: 1, url: roadmapIssue(1).url, title: roadmapIssue(1).title }], inputs: {}, sessions: [],
  }));
  await new Promise((resolve) => setTimeout(resolve, 50));

  delete process.env.CRAFTORIO_SIMULATION_ONLY;
  t.after(() => { process.env.CRAFTORIO_SIMULATION_ONLY = '1'; });
  try {
    await api['roadmap:start']({ projectId: p.id, simulated: false });
  } finally {
    process.env.CRAFTORIO_SIMULATION_ONLY = '1';
  }
  await until(() => roadmapModel.readRoadmap(ws.backlog, p.id).state === 'done');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(relaunched, 0);
  assert.equal(r.git(r.appDir, 'rev-parse', 'HEAD'), r.from);
  assert.equal(fs.existsSync(path.join(ws.oracle, 'app-update.json')), false);
});
