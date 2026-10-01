// src/local-preview.js (#70): which config a gate's "Run locally" uses, whether an install is due,
// the safe scratch workspace default, and the port check that reports a clash instead of failing silently.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const lp = require('../src/local-preview');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('resolveConfig: the project\'s own command wins over the workflow\'s; neither offers Run locally without one', () => {
  const wf = { orchestrator: { local_preview: { command: 'npm run dev', url: 'http://localhost:5173' } } };
  assert.deepEqual(lp.resolveConfig({ localPreview: { command: 'npm start' } }, wf), { command: 'npm start' });
  assert.deepEqual(lp.resolveConfig(null, wf), { install: null, command: 'npm run dev', url: 'http://localhost:5173' });
  // an empty project override (no command) still falls back to the workflow's
  assert.deepEqual(lp.resolveConfig({ localPreview: {} }, wf), { install: null, command: 'npm run dev', url: 'http://localhost:5173' });
  assert.equal(lp.resolveConfig(null, null), null);
  assert.equal(lp.resolveConfig({ localPreview: {} }, null), null);
});

test('needsInstall / recordInstall: a JS project with node_modules is trusted on the first preview, tracking the lockfile from then on; anything else installs first', (t) => {
  const dir = tmp(t);
  const stateFile = path.join(dir, '.state', 'install.json');
  assert.equal(lp.needsInstall(dir, stateFile).install, true, 'no package.json at all: nothing to trust, install');

  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"a":1}');
  const first = lp.needsInstall(dir, stateFile);
  assert.equal(first.install, false, 'node_modules already there: trusted on the first preview');
  lp.recordInstall(stateFile, first.hash);
  assert.equal(lp.needsInstall(dir, stateFile).install, false, 'nothing changed since it was recorded');

  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"a":2}');
  const changed = lp.needsInstall(dir, stateFile);
  assert.equal(changed.install, true, 'the lockfile changed since the last recorded install');
  lp.recordInstall(stateFile, changed.hash);
  assert.equal(lp.needsInstall(dir, stateFile).install, false);
});

test('commandLine: install && command only when an install is due and the config has one', () => {
  const cfg = { install: 'npm ci', command: 'npm start' };
  assert.equal(lp.commandLine(cfg, true), 'npm ci && npm start');
  assert.equal(lp.commandLine(cfg, false), 'npm start');
  assert.equal(lp.commandLine({ command: 'npm start' }, true), 'npm start', 'no install command: nothing to run first');
});

test('portOf: the explicit port, or the scheme default; null without a usable URL', () => {
  assert.equal(lp.portOf('http://localhost:5173'), 5173);
  assert.equal(lp.portOf('http://localhost'), 80);
  assert.equal(lp.portOf('https://localhost'), 443);
  assert.equal(lp.portOf('not a url'), null);
  assert.equal(lp.portOf(null), null);
});

test('portInUse: true once something listens on the port, false once it stops (reported instead of failing silently)', async () => {
  const server = net.createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  assert.equal(await lp.portInUse(port), true);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await lp.portInUse(port), false);
});

test('previewEnv: always simulation only, the target workspace/user-data, and never the app\'s own CLI markers', () => {
  const base = { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1', MULTIAGENT_WORKSPACE: '/real' };
  const env = lp.previewEnv(base, { workspace: '/scratch/workspace', userData: '/scratch/user-data' });
  assert.equal(env.MULTIAGENT_SIMULATION_ONLY, '1');
  assert.equal(env.MULTIAGENT_WORKSPACE, '/scratch/workspace');
  assert.equal(env.MULTIAGENT_USER_DATA, '/scratch/user-data');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal('ELECTRON_RUN_AS_NODE' in env, false);
  assert.equal('CLAUDECODE' in env, false);

  const real = lp.previewEnv(base, { workspace: '/real', userData: null });
  assert.equal('MULTIAGENT_USER_DATA' in real, false);
  assert.equal(env.MULTIAGENT_SIMULATION_ONLY, '1', 'still simulation only even on the real workspace');
});

// ---- suggestConfig (#108): Run App's setup prefilled from the worktree when nothing is configured ----

function writePkg(dir, pkg) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
}

test('suggestConfig: package.json with a start script and a lockfile suggests npm ci / npm start', (t) => {
  const dir = tmp(t);
  writePkg(dir, { scripts: { start: 'node server.js' } });
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  assert.deepEqual(lp.suggestConfig(dir), { install: 'npm ci', command: 'npm start', url: null, from: 'package.json (scripts.start)' });
});

test('suggestConfig: only a dev script (no start) suggests npm run dev', (t) => {
  const dir = tmp(t);
  writePkg(dir, { scripts: { dev: 'vite' }, dependencies: { vite: '^5.0.0' } });
  const s = lp.suggestConfig(dir);
  assert.equal(s.command, 'npm run dev');
  assert.equal(s.url, 'http://localhost:5173', 'a known dev-server framework suggests its default URL');
});

test('suggestConfig: yarn.lock / pnpm-lock.yaml pick the matching package manager', (t) => {
  const yarnDir = tmp(t);
  writePkg(yarnDir, { scripts: { start: 'node server.js' } });
  fs.writeFileSync(path.join(yarnDir, 'yarn.lock'), '');
  assert.deepEqual(lp.suggestConfig(yarnDir), { install: 'yarn install --frozen-lockfile', command: 'yarn start', url: null, from: 'package.json (scripts.start)' });

  const pnpmDir = tmp(t);
  writePkg(pnpmDir, { scripts: { start: 'node server.js' } });
  fs.writeFileSync(path.join(pnpmDir, 'pnpm-lock.yaml'), '');
  assert.deepEqual(lp.suggestConfig(pnpmDir), { install: 'pnpm install --frozen-lockfile', command: 'pnpm start', url: null, from: 'package.json (scripts.start)' });
});

test('suggestConfig: no lockfile at all suggests npm install', (t) => {
  const dir = tmp(t);
  writePkg(dir, { scripts: { start: 'node server.js' } });
  assert.equal(lp.suggestConfig(dir).install, 'npm install');
});

test('suggestConfig: an Electron app opens its own window, so no URL is suggested even with a dev script', (t) => {
  const dir = tmp(t);
  writePkg(dir, { scripts: { start: 'electron .' }, dependencies: { electron: '^30.0.0', vite: '^5.0.0' } });
  assert.equal(lp.suggestConfig(dir).url, null);
});

test('suggestConfig: no package.json falls back to a run command found in the README\'s code blocks', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'README.md'), '# Demo\n\nRun it:\n\n```\ngo run .\n```\n');
  assert.deepEqual(lp.suggestConfig(dir), { install: null, command: 'go run .', url: null, from: 'README' });
});

test('suggestConfig: a Django project (manage.py) without a package.json or README command', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'manage.py'), '');
  assert.deepEqual(lp.suggestConfig(dir), { install: null, command: 'python manage.py runserver', url: 'http://localhost:8000', from: 'Django (manage.py)' });
});

test('suggestConfig: an empty directory suggests nothing', (t) => {
  assert.equal(lp.suggestConfig(tmp(t)), null);
});

test('suggestConfig: this repository suggests npm ci / npm start with no URL', () => {
  assert.deepEqual(lp.suggestConfig(path.join(__dirname, '..')), { install: 'npm ci', command: 'npm start', url: null, from: 'package.json (scripts.start)' });
});

test('scratchWorkspace: copies agents/skills/workflows/settings, points projects at empty scratch folders, never the real runs or a local repo path', (t) => {
  const wsRoot = tmp(t);
  fs.mkdirSync(path.join(wsRoot, 'agents'));
  fs.writeFileSync(path.join(wsRoot, 'agents', 'a.json'), '{}');
  fs.writeFileSync(path.join(wsRoot, 'settings.json'), '{}');
  fs.mkdirSync(path.join(wsRoot, 'skills'));
  fs.mkdirSync(path.join(wsRoot, 'workflows'));
  fs.mkdirSync(path.join(wsRoot, 'runs'));
  fs.writeFileSync(path.join(wsRoot, 'runs', 'secret.txt'), 'do not copy');
  fs.mkdirSync(path.join(wsRoot, 'projects'));
  fs.writeFileSync(path.join(wsRoot, 'projects', 'p1.json'), JSON.stringify({ name: 'demo', folder: '/real/repo', repo: '/real/repo', previousFolders: ['/old'] }));
  fs.writeFileSync(path.join(wsRoot, 'projects', 'p2.json'), JSON.stringify({ name: 'remote', folder: '/real/remote', repo: 'https://github.com/o/r.git' }));

  const root = tmp(t);
  const target = lp.scratchWorkspace({ root: wsRoot }, root);
  assert.equal(fs.existsSync(path.join(target.workspace, 'agents', 'a.json')), true);
  assert.equal(fs.existsSync(path.join(target.workspace, 'settings.json')), true);
  assert.ok(fs.existsSync(target.userData));
  assert.equal(fs.existsSync(path.join(target.workspace, 'runs')), true);
  assert.deepEqual(fs.readdirSync(path.join(target.workspace, 'runs')), [], 'the real runs are never copied');

  const p1 = JSON.parse(fs.readFileSync(path.join(target.workspace, 'projects', 'p1.json'), 'utf8'));
  assert.equal(p1.repo, null, 'a local repo path is dropped: the scratch copy cannot reach it');
  assert.ok(p1.folder.startsWith(path.resolve(target.workspace, 'projects')), 'points at an empty scratch folder of its own');
  assert.equal(fs.existsSync(p1.folder), true);
  assert.equal('previousFolders' in p1, false);

  const p2 = JSON.parse(fs.readFileSync(path.join(target.workspace, 'projects', 'p2.json'), 'utf8'));
  assert.equal(p2.repo, 'https://github.com/o/r.git', 'a remote is kept: the scratch copy can clone it itself');
});
