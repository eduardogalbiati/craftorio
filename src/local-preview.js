// Run locally (#70): at a gate with `local_preview: true` the owner runs the run's worktree with the
// project's command (a dev server, the app itself) before answering. The service starts it in an
// embedded terminal (src/terminals.js) and stops it when the gate is answered or the run ends; this
// module holds what does not need the service:
// - which config applies: the project's override (Projects › Local preview), else the workflow's
//   orchestrator.local_preview ({ install, command, url });
// - whether `install` must run first: dependencies missing, or the lockfile changed since the last
//   preview of that run;
// - the port of `url` already in use (reported instead of failing silently);
// - the safe default for this app: the copy runs on a scratch workspace (agents, skills, workflows
//   and settings copied, project entries pointing to empty scratch folders, never the runs or the
//   real project folders) with its own user-data folder and in simulation
//   only, so trying it can't spend on real models or touch the owner's workspace.

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const LOCKFILES = [
  'Gemfile.lock',
  'go.sum',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'poetry.lock',
  'requirements.txt',
  'uv.lock',
  'yarn.lock',
];

// What the scratch workspace copies from the real one (never runs/, repos/, worktrees/); projects
// are copied apart (scratchProjects)
const COPIED = ['agents', 'settings.json', 'skills', 'workflows'];

// A git remote (https, ssh, scp-like); anything else is a local path and is dropped
const isRemote = (repo) => /^([a-z][a-z0-9+.-]*:\/\/|[^@\s/\\]+@[^:\s]+:)/i.test(String(repo || ''));

function resolveConfig(project, wf) {
  const own = project?.localPreview;
  if (own?.command) return own;
  const lp = wf?.orchestrator?.local_preview;
  return lp?.command ? { install: lp.install || null, command: String(lp.command), url: lp.url || null } : null;
}

function lockHash(dir) {
  const h = crypto.createHash('sha256');
  let found = false;
  for (const f of LOCKFILES) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    found = true;
    h.update(f).update(fs.readFileSync(p));
  }
  return found ? h.digest('hex') : null;
}

// stateFile: where the lockfile hash of the last install is kept (in the preview's own folder, not
// the worktree). The first preview of a JS project whose node_modules exists trusts it (the
// developer installed for this branch); anything else installs once, then again on a lockfile change.
function needsInstall(dir, stateFile) {
  const hash = lockHash(dir);
  let last = null;
  try { last = JSON.parse(fs.readFileSync(stateFile, 'utf8')).lock_hash ?? null; } catch { /* first preview */ }
  const jsReady = fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'node_modules'));
  const install = last === null ? !jsReady : last !== hash;
  return { install, hash };
}

function recordInstall(stateFile, hash) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ lock_hash: hash, at: new Date().toISOString() }, null, 2));
}

function portOf(url) {
  try {
    const u = new URL(String(url));
    return Number(u.port) || (u.protocol === 'https:' ? 443 : u.protocol === 'http:' ? 80 : null);
  } catch { return null; }
}

// true when something already listens on the port (localhost)
function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(1000, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

// The project entries only (<id>.json), each pointing to an empty folder of its own in the scratch
// workspace instead of the owner's real one, so the copy can't read or write the real projects.
// Their contents are not copied (repositories can be large): a copy starts from an empty folder.
function scratchProjects(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from).filter((n) => n.endsWith('.json'))) {
    let p;
    try { p = JSON.parse(fs.readFileSync(path.join(from, f), 'utf8')); } catch { continue; }
    const folder = path.resolve(to, f.slice(0, -5));
    fs.mkdirSync(folder, { recursive: true });
    const { previousFolders, ...rest } = p;
    fs.writeFileSync(path.join(to, f), JSON.stringify({ ...rest, folder, repo: isRemote(p.repo) ? p.repo : null }, null, 2));
  }
}

// <root>/workspace: a copy of the owner's agents, skills, workflows and settings, and of the project
// entries pointing to scratch folders; <root>/user-data: the app's own data folder (sign-in, window
// state) for the copy.
function scratchWorkspace(ws, root) {
  const dir = path.join(root, 'workspace');
  for (const name of COPIED) {
    const from = path.join(ws.root, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, name), { recursive: true, force: true });
  }
  scratchProjects(path.join(ws.root, 'projects'), path.join(dir, 'projects'));
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  const userData = path.join(root, 'user-data');
  fs.mkdirSync(userData, { recursive: true });
  return { workspace: dir, userData };
}

// The environment of the preview: always simulation only; the scratch workspace unless the owner
// chose the real one (with a warning in the UI).
function previewEnv(base, { workspace, userData }) {
  const env = { ...base, MULTIAGENT_SIMULATION_ONLY: '1', MULTIAGENT_WORKSPACE: workspace };
  if (userData) env.MULTIAGENT_USER_DATA = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  return env;
}

// One command line for the shell: `install && command` when the install is due
function commandLine(config, install) {
  return install && config.install ? `${config.install} && ${config.command}` : config.command;
}

// Default dev-server URLs of known JS frameworks (a dependency of package.json)
const FRAMEWORK_URLS = [
  ['next', 'http://localhost:3000'],
  ['nuxt', 'http://localhost:3000'],
  ['@angular/core', 'http://localhost:4200'],
  ['react-scripts', 'http://localhost:3000'],
  ['@sveltejs/kit', 'http://localhost:5173'],
  ['vite', 'http://localhost:5173'],
];

// A run command found in the README's code blocks (`npm start`, `python manage.py runserver`…)
const README_RUN = /^\s*(?:\$\s*)?((?:npm (?:start|run (?:dev|start|serve))|yarn (?:start|dev)|pnpm (?:start|dev)|python3? (?:manage\.py runserver|-m \S+|app\.py|main\.py)|flask run|uvicorn \S+|go run \S+|dotnet run|cargo run|mvn spring-boot:run|\.\/gradlew bootRun)[^\r\n]*)$/m;

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

// Run App's setup, prefilled from the worktree when no Local preview is configured (#108):
// package.json's `start`/`dev` script (with `npm ci` when there is a lockfile), else the README's
// run instructions, else a known project kind. { install, command, url, from } or null.
function suggestConfig(dir) {
  if (!dir) return null;
  let pkg = null;
  try { pkg = JSON.parse(readText(path.join(dir, 'package.json')) || 'null'); } catch { /* not JSON */ }
  const scripts = pkg?.scripts || {};
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (pkg && (scripts.start || scripts.dev)) {
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
    const install = pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : pm === 'yarn' ? 'yarn install --frozen-lockfile'
      : has('package-lock.json') || has('npm-shrinkwrap.json') ? 'npm ci' : 'npm install';
    const script = scripts.start ? 'start' : 'dev';
    const command = pm === 'npm' ? (script === 'start' ? 'npm start' : 'npm run dev') : `${pm} ${script}`;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    // an Electron app opens its own window: no URL
    const url = deps.electron ? null : (FRAMEWORK_URLS.find(([name]) => deps[name]) || [])[1] || null;
    return { install, command, url, from: `package.json (scripts.${script})` };
  }
  const readme = ['README.md', 'readme.md', 'README'].map((f) => readText(path.join(dir, f))).find((t) => t != null);
  const blocks = readme ? [...readme.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n') : '';
  const fromReadme = blocks.match(README_RUN)?.[1]?.trim();
  if (fromReadme) return { install: null, command: fromReadme, url: null, from: 'README' };
  if (has('manage.py')) return { install: has('requirements.txt') ? 'pip install -r requirements.txt' : null, command: 'python manage.py runserver', url: 'http://localhost:8000', from: 'Django (manage.py)' };
  if (has('go.mod')) return { install: null, command: 'go run .', url: null, from: 'Go (go.mod)' };
  if (has('Cargo.toml')) return { install: null, command: 'cargo run', url: null, from: 'Rust (Cargo.toml)' };
  if (fs.readdirSync(dir).some((f) => f.endsWith('.csproj'))) return { install: null, command: 'dotnet run', url: null, from: '.NET (*.csproj)' };
  return null;
}

module.exports = {
  commandLine,
  needsInstall,
  portInUse,
  portOf,
  previewEnv,
  recordInstall,
  resolveConfig,
  scratchProjects,
  scratchWorkspace,
  suggestConfig,
};
