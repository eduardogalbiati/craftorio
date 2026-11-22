// packages/engine/domains/local/local-preview.js (#70): which config a gate's "Run locally" uses, whether an install is due,
// the safe scratch workspace default, and the port check that reports a clash instead of failing silently.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const lp = require('@craftorio/engine/domains/local/local-preview');

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

// ---- #115: a repository-declared command, between the project's override and the workflow's ----

test('resolveSource: precedence is the project\'s override, then the repository\'s file, then the workflow\'s', () => {
  const wf = { orchestrator: { local_preview: { command: 'from workflow' } } };
  const repo = { command: 'from repo', from: '.multiagent/local-preview.yaml' };
  const bySource = (project, w, r) => lp.resolveSource(project, w, r)?.source || null;
  assert.deepEqual(lp.resolveSource(null, wf, repo), { config: { command: 'from repo' }, source: 'repo', from: '.multiagent/local-preview.yaml' });
  assert.equal(bySource({ localPreview: { command: 'from project' } }, wf, repo), 'project', 'the project\'s own override wins over the repository\'s file');
  assert.equal(bySource(null, wf, null), 'workflow', 'no repository file: falls back to the workflow\'s');
  assert.equal(lp.resolveSource(null, null, null), null);
});

test('readRepoConfig / writeRepoConfig: a repository can declare how it runs (#115), committed by its owner', (t) => {
  const dir = tmp(t);
  assert.equal(lp.readRepoConfig(dir), null, 'nothing declared yet');
  const file = lp.writeRepoConfig(dir, { command: 'npm start', install: 'npm ci', url: 'http://localhost:3000', cwd: 'apps/web' });
  assert.equal(file, path.join(dir, '.craftorio', 'local-preview.yaml'));
  const read = lp.readRepoConfig(dir);
  assert.equal(read.command, 'npm start');
  assert.equal(read.cwd, 'apps/web');
  assert.equal(read.from, '.craftorio/local-preview.yaml');
});

test('T2c a repository set up before the rename keeps its .multiagent/local-preview.yaml: read from there, and written back there', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, '.multiagent'));
  fs.writeFileSync(path.join(dir, '.multiagent', 'local-preview.yaml'), 'command: npm run dev\nurl: http://localhost:5173\n');
  assert.equal(lp.readRepoConfig(dir).from, '.multiagent/local-preview.yaml');
  const file = lp.writeRepoConfig(dir, { command: 'npm start', url: 'http://localhost:3000' });
  assert.equal(file, path.join(dir, '.multiagent', 'local-preview.yaml'));
  assert.equal(fs.existsSync(path.join(dir, '.craftorio')), false, 'no second folder');
});

test('T2c with both folders, .craftorio/ wins', (t) => {
  const dir = tmp(t);
  for (const [d, cmd] of [['.multiagent', 'old'], ['.craftorio', 'new']]) {
    fs.mkdirSync(path.join(dir, d));
    fs.writeFileSync(path.join(dir, d, 'local-preview.yaml'), `command: ${cmd}\n`);
  }
  assert.equal(lp.readRepoConfig(dir).command, 'new');
});

test('readRepoConfig: invalid YAML or a file without a command is reported as an error, not silently ignored or run as is', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, '.multiagent'));
  fs.writeFileSync(path.join(dir, '.multiagent', 'local-preview.yaml'), 'command: [not\n  closed');
  assert.match(lp.readRepoConfig(dir).error, /\.multiagent\/local-preview\.yaml/);

  fs.writeFileSync(path.join(dir, '.multiagent', 'local-preview.yaml'), 'url: http://localhost:3000\n');
  assert.match(lp.readRepoConfig(dir).error, /no `command`/);
});

test('fingerprint: the same config fingerprints the same regardless of object identity; a changed command, cwd or env changes it', () => {
  const base = { command: 'npm start', install: 'npm ci', url: 'http://localhost:3000' };
  const fp = lp.fingerprint(base);
  assert.equal(lp.fingerprint({ ...base }), fp);
  assert.notEqual(lp.fingerprint({ ...base, command: 'npm run dev' }), fp, 'a changed declared command asks again (#115)');
  assert.notEqual(lp.fingerprint({ ...base, cwd: 'apps/web' }), fp);
  assert.notEqual(lp.fingerprint({ ...base, env: { FOO: '1' } }), fp);
  assert.equal(lp.fingerprint(null), null);
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
  const base = { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1', CRAFTORIO_WORKSPACE: '/real' };
  const env = lp.previewEnv(base, { workspace: '/scratch/workspace', userData: '/scratch/user-data' });
  assert.equal(env.CRAFTORIO_SIMULATION_ONLY, '1');
  assert.equal(env.CRAFTORIO_WORKSPACE, '/scratch/workspace');
  assert.equal(env.CRAFTORIO_USER_DATA, '/scratch/user-data');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal('ELECTRON_RUN_AS_NODE' in env, false);
  assert.equal('CLAUDECODE' in env, false);

  const real = lp.previewEnv(base, { workspace: '/real', userData: null });
  assert.equal('CRAFTORIO_USER_DATA' in real, false);
  assert.equal(env.CRAFTORIO_SIMULATION_ONLY, '1', 'still simulation only even on the real workspace');
});

// ---- #119: no sign-in and the right screen in a Run App copy of this app ----------------------

test('previewEnv: CRAFTORIO_AUTH=off always, even on the real workspace (still simulation only); CRAFTORIO_START_VIEW only with a view', () => {
  const base = { PATH: '/usr/bin' };
  const scratch = lp.previewEnv(base, { workspace: '/scratch/workspace', userData: '/scratch/user-data' });
  assert.equal(scratch.CRAFTORIO_AUTH, 'off');
  assert.equal('CRAFTORIO_START_VIEW' in scratch, false, 'no view: nothing to open on');

  const real = lp.previewEnv(base, { workspace: '/real', userData: null });
  assert.equal(real.CRAFTORIO_AUTH, 'off', 'the real workspace is still simulation only: no sign-in either');

  const withView = lp.previewEnv(base, { workspace: '/scratch/workspace', userData: '/scratch/user-data' }, null, { view: 'backlog' });
  assert.equal(withView.CRAFTORIO_START_VIEW, 'backlog');
});

test('previewEnv: an extra env from the config never overrides the simulation guard', () => {
  const env = lp.previewEnv({}, { workspace: '/scratch' }, { CRAFTORIO_SIMULATION_ONLY: '0', CRAFTORIO_AUTH: 'on' });
  assert.equal(env.CRAFTORIO_SIMULATION_ONLY, '1');
  assert.equal(env.CRAFTORIO_AUTH, 'off');
});

test('startView: the most touched view under a page layer\'s views/<view>/ (the UI kit, a front, the page folder) or a layer\'s <view>*.{js,css}; null without a match', () => {
  assert.equal(lp.startView(['fronts/build/views/backlog/board.js', 'fronts/build/views/backlog/card.js', 'fronts/build/views/artifacts/list.js']), 'backlog', 'two files touch backlog, one touches artifacts');
  assert.equal(lp.startView(['apps/desktop/renderer/artifacts.js', 'packages/ui-kit/style.css']), 'artifacts');
  assert.equal(lp.startView(['packages/engine/service/index.js', 'README.md']), null, 'no renderer screen changed');
  assert.equal(lp.startView([]), null);
  assert.equal(lp.startView(undefined), null);
});

test('installState: a config with no install command reports "none" (#119 regression: a config without one must not say install will run)', (t) => {
  const dir = tmp(t);
  const stateFile = path.join(dir, '.state', 'install.json');
  const s = lp.installState(dir, stateFile, { command: 'node server.js' });
  assert.equal(s.state, 'none');
  assert.match(s.text, /No install step/);
});

test('installState: an install command on a worktree with node_modules and an unchanged lockfile is "skipped"', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"a":1}');
  const stateFile = path.join(dir, '.state', 'install.json');
  const first = lp.installState(dir, stateFile, { install: 'npm ci', command: 'npm start' });
  assert.equal(first.state, 'skipped', 'node_modules already there: trusted on the first preview');
  assert.match(first.text, /already installed/);

  lp.recordInstall(stateFile, lp.needsInstall(dir, stateFile).hash);
  const again = lp.installState(dir, stateFile, { install: 'npm ci', command: 'npm start' });
  assert.equal(again.state, 'skipped');
  assert.match(again.text, /unchanged/);
});

test('installState: an install command with no node_modules at all is "will-run"', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const stateFile = path.join(dir, '.state', 'install.json');
  const s = lp.installState(dir, stateFile, { install: 'npm ci', command: 'npm start' });
  assert.equal(s.state, 'will-run');
  assert.match(s.text, /missing/);
});

test('installState: a changed lockfile since the last recorded install is "will-run" too', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"a":1}');
  const stateFile = path.join(dir, '.state', 'install.json');
  lp.recordInstall(stateFile, lp.needsInstall(dir, stateFile).hash);
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"a":2}');
  const s = lp.installState(dir, stateFile, { install: 'npm ci', command: 'npm start' });
  assert.equal(s.state, 'will-run');
  assert.match(s.text, /lockfile changed/);
});

test('announced: the terminal\'s first line echoes the install state, then runs the real command; no note means no echo', () => {
  const line = lp.announced('npm start', 'Install skipped: dependencies already installed.');
  assert.equal(line, 'echo Run App: Install skipped: dependencies already installed. && npm start');
  assert.equal(lp.announced('npm start', ''), 'npm start');
  assert.equal(lp.announced('npm start', null), 'npm start');
});

test('announced: strips characters an echo in cmd.exe or /bin/sh could not pass through safely', () => {
  const line = lp.announced('npm start', 'Install will run: a "weird" note & more; `rm -rf /`');
  assert.match(line, /^echo Run App: /);
  assert.equal(line.endsWith(' && npm start'), true);
  const note = line.slice('echo Run App: '.length, -' && npm start'.length);
  assert.doesNotMatch(note, /["&;`]/, 'the note itself carries none of the characters the shell would need escaped');
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

test('suggestConfig: Docker Compose suggests `docker compose up`, with the URL from the first published port (#115)', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services:\n  web:\n    ports:\n      - "8080:80"\n');
  assert.deepEqual(lp.suggestConfig(dir), { install: null, command: 'docker compose up', url: 'http://localhost:8080', from: 'docker-compose.yml' });
});

test('suggestConfig: Docker Compose without a published port suggests the command with no URL', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'compose.yaml'), 'services:\n  worker:\n    image: alpine\n');
  assert.deepEqual(lp.suggestConfig(dir), { install: null, command: 'docker compose up', url: null, from: 'compose.yaml' });
});

test('suggestConfig: a dev container\'s postStartCommand, with its forwarded ports as the URL (#115)', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, '.devcontainer'));
  fs.writeFileSync(path.join(dir, '.devcontainer', 'devcontainer.json'), JSON.stringify({ postCreateCommand: 'npm ci', postStartCommand: 'npm start', forwardPorts: [3000] }));
  assert.deepEqual(lp.suggestConfig(dir), { install: 'npm ci', command: 'npm start', url: 'http://localhost:3000', from: '.devcontainer/devcontainer.json (postStartCommand)' });
});

test('suggestConfig: a Procfile\'s web process (#115)', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'Procfile'), 'web: node server.js\nworker: node worker.js\n');
  assert.deepEqual(lp.suggestConfig(dir), { install: null, command: 'node server.js', url: null, from: 'Procfile (web)' });
});

test('suggestConfig: a Makefile\'s run/dev/start target (#115)', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'Makefile'), 'build:\n\techo building\n\nrun:\n\tnode server.js\n');
  assert.deepEqual(lp.suggestConfig(dir), { install: null, command: 'make run', url: null, from: 'Makefile (run)' });
});

test('suggestConfig: a monorepo\'s apps (package.json workspaces), each its own cwd; several apps are offered, not guessed (#115)', (t) => {
  const dir = tmp(t);
  writePkg(dir, { workspaces: ['apps/*'] });
  fs.mkdirSync(path.join(dir, 'apps', 'web'), { recursive: true });
  writePkg(path.join(dir, 'apps', 'web'), { scripts: { start: 'node server.js' } });
  fs.mkdirSync(path.join(dir, 'apps', 'api'), { recursive: true });
  writePkg(path.join(dir, 'apps', 'api'), { scripts: { start: 'node api.js' } });
  const s = lp.suggestConfig(dir);
  assert.equal(s.cwd, 'apps/api', 'the first app, sorted');
  assert.equal(s.apps.length, 2, 'more than one app: offered to pick from, not guessed');
  assert.deepEqual(s.apps.map((a) => a.cwd), ['apps/api', 'apps/web']);
});

test('suggestConfig: this repository suggests npm ci / npm start with no URL', () => {
  assert.deepEqual(lp.suggestConfig(path.join(__dirname, '..', '..', '..', '..')), { install: 'npm ci', command: 'npm start', url: null, from: 'package.json (scripts.start)' });
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

// ---- worktreeAppScratch (#112): an app started by hand from a run's worktree --------------------

test('worktreeAppScratch: an app folder under <workspace>/worktrees/<id> gets a scratch copy of its owner workspace', (t) => {
  const ws = tmp(t);
  fs.mkdirSync(path.join(ws, 'runs'));
  const appDir = path.join(ws, 'worktrees', '20260101-000000-abcd1234');
  fs.mkdirSync(appDir, { recursive: true });

  const scratch = lp.worktreeAppScratch(appDir);
  assert.equal(scratch.owner, ws);
  assert.ok(fs.existsSync(scratch.workspace));
  assert.ok(fs.existsSync(scratch.userData));
  assert.ok(scratch.workspace.includes('20260101-000000-abcd1234'), 'one scratch copy per worktree: Run locally keeps its own');
});

test('worktreeAppScratch: a folder not two levels under "worktrees", or whose owner is not a workspace, is null', (t) => {
  const ws = tmp(t);
  fs.mkdirSync(path.join(ws, 'runs'));
  assert.equal(lp.worktreeAppScratch(ws), null, 'the workspace root itself');
  assert.equal(lp.worktreeAppScratch(path.join(ws, 'worktrees')), null, 'only one level deep: no run id folder');
  assert.equal(lp.worktreeAppScratch(path.join(ws, 'projects', 'demo')), null, 'a project folder, not a worktree');

  const noOwner = tmp(t); // "worktrees/<id>" under a folder with no runs dir: not a real workspace
  assert.equal(lp.worktreeAppScratch(path.join(noOwner, 'worktrees', 'abcd1234')), null);

  // the check is case-insensitive (Windows paths)
  const upper = path.join(ws, 'Worktrees', 'abcd1234');
  fs.mkdirSync(upper, { recursive: true });
  assert.equal(lp.worktreeAppScratch(upper).owner, ws);
});
