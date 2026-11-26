// #85 the base check is off by default: acceptance tests written before the code.
//
// - DEFAULT_SETTINGS.baseCheck is { onRed: 'off' }; a workspace that never saved baseCheck reads 'off'.
// - With nothing saved, a merge (afterBaseMerge) and a stage end (afterStageEnded) start no base check:
//   no suite, no base worktree (<workspace>/worktrees/base-check-<project>), no issue, no fix stage.
// - A saved 'fix' (or 'issue') is kept, no migration: the merge starts the check; a saved 'off' starts none.
//
// Seams: packages/engine/domains/workspace/settings.js (DEFAULT_SETTINGS, readSettings, writeSettings),
// the service area packages/engine/service/areas/base-health.js on a real git repository, as
// test/service/base-health-rerun-613.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService } = require('./helpers');
const { SUITE_SLOT_ENV } = require('../../engine/machine-slot');

const loadSettings = () => require('../../domains/workspace/settings');
const loadArea = () => require('../../service/areas/base-health');

let saved;
test.beforeEach(() => { saved = { locks: process.env.CRAFTORIO_LOCKS_DIR, inherit: process.env[SUITE_SLOT_ENV] }; delete process.env[SUITE_SLOT_ENV]; });
test.afterEach(() => {
  for (const [k, v] of [['CRAFTORIO_LOCKS_DIR', saved.locks], [SUITE_SLOT_ENV, saved.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// a git repository on main with one green node:test file
function greenProject(t) {
  const dir = tmp(t, 'bh85-repo-');
  const cfg = path.join(tmp(t, 'bh85-gitcfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bh85', private: true, scripts: { test: 'node --test' } }, null, 2));
  fs.writeFileSync(path.join(dir, 'test', 'ok.test.js'), "const test = require('node:test');\ntest('ok always passes', () => {});\n");
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  return dir;
}

// the service with a git project; `onRed` saved in settings.json, or (undefined) baseCheck taken out of it
async function setup(t, onRed) {
  const { service, api } = makeService(t);
  process.env.CRAFTORIO_LOCKS_DIR = tmp(t, 'bh85-locks-');
  const project = await api['projects:create']({ name: 'bh85', folder: greenProject(t) });
  const ws = service.workspace();
  if (onRed) api['settings:set']({ baseCheck: { onRed } });
  else {
    const file = loadSettings().savedSettings(ws);
    if (file && 'baseCheck' in file) { delete file.baseCheck; fs.writeFileSync(ws.settings, JSON.stringify(file, null, 2)); }
  }
  const area = loadArea()({ ws, active: new Map(), isReleaseRun: () => false, notify: () => {}, events: { emit: () => {} } });
  return { ws, project, area };
}

// a started check (a promise) is awaited, so none outlives the test
async function settle(started) {
  if (started && typeof started.then === 'function') return started.then((r) => r?.status ?? 'ended', (e) => `threw: ${e.message}`);
  return started ?? null;
}

test('#85 DEFAULT_SETTINGS.baseCheck is { onRed: \'off\' }', () => {
  assert.deepEqual({ ...loadSettings().DEFAULT_SETTINGS.baseCheck }, { onRed: 'off' });
});

test('#85 a workspace without settings.json reads baseCheck.onRed \'off\'', (t) => {
  const dir = tmp(t, 'bh85-ws-');
  assert.equal(loadSettings().readSettings({ settings: path.join(dir, 'settings.json') }).baseCheck?.onRed, 'off');
});

test('#85 a saved \'fix\' or \'issue\' is kept: no migration to the new default', (t) => {
  const s = loadSettings();
  for (const onRed of ['fix', 'issue']) {
    const file = path.join(tmp(t, 'bh85-ws-'), 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ baseCheck: { onRed } }));
    assert.equal(s.readSettings({ settings: file }).baseCheck?.onRed, onRed);
  }
});

test('#85 nothing saved: a merge starts no base check and leaves no base worktree', async (t) => {
  const { ws, project, area } = await setup(t, undefined);
  const outcome = await settle(area.afterBaseMerge({ projectId: project.id, runId: 'run-85', mock: false }, { base: 'main', tested: 'merge' }));
  assert.equal(outcome, null, 'no check started');
  assert.equal(fs.existsSync(path.join(ws.root, 'worktrees', `base-check-${project.id}`)), false, 'no base worktree');
});

test('#85 nothing saved: a roadmap stage end starts no base check', async (t) => {
  const { project, area } = await setup(t, undefined);
  const outcome = await settle(area.afterStageEnded(project.id, { base: 'main' }));
  assert.equal(outcome, null, 'no check started');
});

test('#85 a saved \'fix\': a merge still starts the base check', async (t) => {
  const { project, area } = await setup(t, 'fix');
  const outcome = await settle(area.afterBaseMerge({ projectId: project.id, runId: 'run-85', mock: false }, { base: 'main', tested: 'merge' }));
  assert.equal(outcome, 'green');
});

test('#85 a saved \'off\': a merge starts no base check', async (t) => {
  const { project, area } = await setup(t, 'off');
  const outcome = await settle(area.afterBaseMerge({ projectId: project.id, runId: 'run-85', mock: false }, { base: 'main', tested: 'merge' }));
  assert.equal(outcome, null);
});
