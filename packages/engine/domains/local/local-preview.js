// Run locally (#70): at a gate with `local_preview: true` the owner runs the run's worktree with the
// project's command (a dev server, the app itself) before answering. The service starts it in an
// embedded terminal (packages/engine/domains/machine/terminals.js) and stops it when the gate is answered or the run ends; this
// module holds what does not need the service:
// - which config applies: the project's override (Projects › Local preview), else the repository's
//   .craftorio/local-preview.yaml, else the workflow's orchestrator.local_preview
//   ({ install, command, url, cwd, env }), else a suggestion detected from the folder (#115);
// - the fingerprint of a config the owner confirmed (a changed declared command asks again);
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
const yaml = require('js-yaml');

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

// The file a repository declares how it runs with (#115), committed by its owner
const { projectDirName, projectFiles } = require('@craftorio/shared/project-dir');
// T2c: .craftorio/ first, then .multiagent/ (a repository set up before the rename to Craftorio)
const REPO_FILES = [...projectFiles('local-preview.yaml'), ...projectFiles('local-preview.yml')];

// { install, command, url, cwd, env } with empty fields dropped; null without a command. cwd: a
// folder of the repository (a monorepo's app); env: extra variables (strings).
function cleanConfig(v) {
  const str = (x) => String(x ?? '').trim() || null;
  const command = str(v?.command);
  if (!command) return null;
  const out = { install: str(v.install), command, url: str(v.url) };
  const cwd = str(v.cwd);
  if (cwd && cwd !== '.') out.cwd = cwd.replace(/\\/g, '/');
  const env = v.env && typeof v.env === 'object' && !Array.isArray(v.env)
    ? Object.fromEntries(Object.entries(v.env).filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)).map(([k, x]) => [k, String(x ?? '')])) : {};
  if (Object.keys(env).length) out.env = env;
  return out;
}

// .craftorio/local-preview.yaml in the folder: the declared config with `from`, { error } when the
// file is not valid, null when there is none.
function readRepoConfig(dir) {
  if (!dir) return null;
  for (const rel of REPO_FILES) {
    const text = readText(path.join(dir, rel));
    if (text == null) continue;
    let doc;
    try { doc = yaml.load(text); } catch (e) { return { error: `${rel}: ${e.reason || e.message}` }; }
    const cfg = cleanConfig(doc);
    return cfg ? { ...cfg, from: rel } : { error: `${rel}: no \`command\`.` };
  }
  return null;
}

function writeRepoConfig(dir, config) {
  const cfg = cleanConfig(config);
  if (!cfg) throw new Error('No command to write.');
  const file = path.join(dir, projectDirName((name) => fs.existsSync(path.join(dir, name))), 'local-preview.yaml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = '# How this repository runs locally (Run App in the Craftorio).\n';
  fs.writeFileSync(file, header + yaml.dump(cfg, { lineWidth: -1 }));
  return file;
}

// Which config applies, in order: the project's override (Projects › Local preview), the
// repository's .craftorio/local-preview.yaml, the workflow's orchestrator.local_preview.
// { config, source: 'project' | 'repo' | 'workflow', from } or null.
function resolveSource(project, wf, repo = null) {
  // stored cleaned already (packages/engine/domains/project/projects.js)
  const own = project?.localPreview?.command ? project.localPreview : null;
  if (own) return { config: own, source: 'project', from: 'Projects › Local preview' };
  if (repo?.command) {
    const { from, ...config } = repo;
    return { config, source: 'repo', from };
  }
  const lp = cleanConfig(wf?.orchestrator?.local_preview);
  return lp ? { config: lp, source: 'workflow', from: 'the workflow (orchestrator.local_preview)' } : null;
}

function resolveConfig(project, wf, repo = null) {
  return resolveSource(project, wf, repo)?.config || null;
}

// What the owner confirmed running (#115): a declared command that changes asks again.
function fingerprint(config) {
  const c = cleanConfig(config);
  if (!c) return null;
  const env = Object.entries(c.env || {}).sort(([a], [b]) => a.localeCompare(b));
  return crypto.createHash('sha256').update(JSON.stringify([c.install, c.command, c.url, c.cwd || null, env])).digest('hex').slice(0, 16);
}

// The folder a config runs in: its cwd inside the run's folder, never outside it
function runFolder(dir, config) {
  if (!config?.cwd) return dir;
  const full = path.resolve(dir, config.cwd);
  const rel = path.relative(dir, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`cwd is outside the project: ${config.cwd}`);
  return full;
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
// A null stateFile (a one-off preview, #649) is always that first preview.
// reason: why it runs or not (installState says it to the owner).
function needsInstall(dir, stateFile) {
  const hash = lockHash(dir);
  let last = null;
  try { last = JSON.parse(fs.readFileSync(stateFile, 'utf8')).lock_hash ?? null; } catch { /* first preview */ }
  const js = fs.existsSync(path.join(dir, 'package.json'));
  const jsReady = js && fs.existsSync(path.join(dir, 'node_modules'));
  const install = last === null ? !jsReady : last !== hash;
  const reason = last === null ? (jsReady ? 'installed' : js ? 'missing' : 'first') : install ? 'lockfile' : 'unchanged';
  return { install, hash, reason };
}

// What the install step does for this worktree (#119), for the gate's setup and the terminal's
// first line: { state: 'none' | 'skipped' | 'will-run', text }.
const INSTALL_REASONS = {
  installed: 'dependencies already installed',
  missing: 'node_modules missing',
  first: 'first preview of this run',
  lockfile: 'lockfile changed since the last install',
  unchanged: 'lockfile unchanged since the last install',
};
function installState(dir, stateFile, config) {
  if (!config?.install) return { state: 'none', text: 'No install step.' };
  const { install, reason } = needsInstall(dir, stateFile);
  return install
    ? { state: 'will-run', text: `Install will run: ${INSTALL_REASONS[reason]}.` }
    : { state: 'skipped', text: `Install skipped: ${INSTALL_REASONS[reason]}.` };
}

// The app's screens a Run App copy can open on (#119), from the files the run changed: the most
// touched of a page layer's views/<view>/… and <view>[-part].{js,css} (the UI kit, a front, the page folder); null for none. The layers are
// scripts/source-tree.js's (pageDirs); the engine cannot require scripts/, so the rule is spelled here too.
const START_VIEWS = [
  'agents',
  'analytics',
  'arena',
  'artifacts',
  'backlog',
  'dashboard',
  'duo',
  'projects',
  'sessions',
  'settings',
  'skills',
  'usage',
  'workflows',
];
function startView(files) {
  const counts = new Map();
  for (const f of files || []) {
    // a screen's folder in any page layer (the UI kit, a front, an app's page folder: phase 3 of the
    // reorganisation study), or a root module of a layer named after the screen
    const m = String(f).replace(/\\/g, '/').match(/^(?:packages\/ui-kit|fronts\/[^/]+|apps\/[^/]+\/renderer)\/(?:views\/([^/]+)\/|([a-z]+)[^/]*\.(?:js|css|html)$)/);
    const view = m && (m[1] || m[2]);
    if (START_VIEWS.includes(view)) counts.set(view, (counts.get(view) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
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

// The scratch workspace of an app started by hand from a run's worktree (#112): when the app's own
// folder is <workspace>/worktrees/<id>, it gets <workspace>/local-previews/app-<id>/{workspace,
// user-data}, as Run locally does, instead of opening the owner's workspace. null otherwise.
function worktreeAppScratch(appDir) {
  const parts = path.resolve(appDir).split(path.sep);
  const at = parts.length - 2;
  if (at < 1 || parts[at].toLowerCase() !== 'worktrees') return null;
  const root = parts.slice(0, at).join(path.sep) || path.sep;
  if (!fs.existsSync(path.join(root, 'runs'))) return null;
  return { owner: root, ...scratchWorkspace({ root }, path.join(root, 'local-previews', `app-${parts[at + 1]}`)) };
}

// The environment of the preview: always simulation only; the scratch workspace unless the owner
// chose the real one (with a warning in the UI). When the command starts this app: no sign-in
// (CRAFTORIO_AUTH=off, as the screenshot and smoke scripts; a copy in simulation only has nothing
// to sign in for), and the screen the change is about (CRAFTORIO_START_VIEW). Both are this app's
// own variables: other projects' commands ignore them.
// extra: the config's own env (it never overrides the simulation guard).
function previewEnv(base, { workspace, userData }, extra = null, { view = null } = {}) {
  const env = { ...base, ...extra, CRAFTORIO_SIMULATION_ONLY: '1', CRAFTORIO_WORKSPACE: workspace, CRAFTORIO_AUTH: 'off' };
  if (userData) env.CRAFTORIO_USER_DATA = userData;
  if (view) env.CRAFTORIO_START_VIEW = view;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  return env;
}

// One command line for the shell: `install && command` when the install is due
function commandLine(config, install) {
  return install && config.install ? `${config.install} && ${config.command}` : config.command;
}

// The line the terminal runs: a first line saying whether the install runs (installState's text,
// #119), then the command line. Plain words only, so the same echo works in cmd.exe and /bin/sh.
function announced(line, note) {
  const say = String(note || '').replace(/[^\w .,:/-]/g, '').trim();
  return say ? `echo Run App: ${say} && ${line}` : line;
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

const readPkg = (dir) => { try { return JSON.parse(readText(path.join(dir, 'package.json')) || 'null'); } catch { return null; } };

// A package.json with a `start`/`dev` script; root: the folder holding the lockfile (a monorepo's
// root), rel: the app's folder relative to it ('' for the root itself).
function packageSuggestion(root, rel = '') {
  const pkg = readPkg(path.join(root, rel));
  const scripts = pkg?.scripts || {};
  if (!pkg || !(scripts.start || scripts.dev)) return null;
  const has = (f) => fs.existsSync(path.join(root, f));
  const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
  const install = pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : pm === 'yarn' ? 'yarn install --frozen-lockfile'
    : has('package-lock.json') || has('npm-shrinkwrap.json') ? 'npm ci' : 'npm install';
  const script = scripts.start ? 'start' : 'dev';
  const command = pm === 'npm' ? (script === 'start' ? 'npm start' : 'npm run dev') : `${pm} ${script}`;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  // an Electron app opens its own window: no URL
  const url = deps.electron ? null : (FRAMEWORK_URLS.find(([name]) => deps[name]) || [])[1] || null;
  return { install, command, url, ...(rel ? { cwd: rel } : {}), from: `${rel ? `${rel}/` : ''}package.json (scripts.${script})` };
}

// A monorepo's apps: the package.json workspaces (`dir/*` or a folder), else apps/*, packages/* and
// the direct sub-folders, each with a start/dev script. [{ cwd, install, command, url, from }]
function monorepoApps(dir, pkg) {
  const subdirs = (rel) => { try { return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules').map((d) => (rel ? `${rel}/${d.name}` : d.name)); } catch { return []; } };
  const ws = Array.isArray(pkg?.workspaces) ? pkg.workspaces : Array.isArray(pkg?.workspaces?.packages) ? pkg.workspaces.packages : null;
  const globs = ws || ['apps/*', 'packages/*', '*'];
  const folders = globs.flatMap((g) => {
    const clean = String(g).replace(/\\/g, '/').replace(/\/+$/, '');
    if (clean === '*') return subdirs('');
    if (clean.endsWith('/*')) return subdirs(clean.slice(0, -2));
    return clean.includes('*') ? [] : [clean];
  });
  return [...new Set(folders)].sort().map((rel) => packageSuggestion(dir, rel)).filter(Boolean);
}

// The first published port of a compose file's services ("8080:80", "127.0.0.1:8080:80", { published })
function composePort(doc) {
  for (const svc of Object.values(doc?.services || {})) {
    for (const p of svc?.ports || []) {
      if (p && typeof p === 'object' && p.published) return String(p.published).split('-')[0];
      const parts = String(p).split('/')[0].split(':');
      if (parts.length >= 2) return parts[parts.length - 2].split('-')[0];
    }
  }
  return null;
}

// devcontainer.json is JSON with comments and trailing commas
function readJsonc(file) {
  const text = readText(file);
  if (text == null) return null;
  try { return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1').replace(/,(\s*[}\]])/g, '$1')); } catch { return null; }
}

const commandText = (c) => (Array.isArray(c) ? c.join(' ') : c && typeof c === 'object' ? Object.values(c).map(commandText)[0] : c ? String(c) : null);

// Run App's setup, prefilled from the worktree when no Local preview is configured (#108, #115), the
// first that applies: package.json's `start`/`dev` script (with `npm ci` when there is a lockfile);
// a monorepo's apps (`apps`: the owner picks one, stored as `cwd`); Docker Compose; a dev container's
// postStartCommand; a Procfile's `web:`; a Makefile's run/dev/start target; the README's run
// instructions; a known project kind. { install, command, url, cwd?, from, apps? } or null.
function suggestConfig(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const has = (f) => fs.existsSync(path.join(dir, f));
  const own = packageSuggestion(dir);
  if (own) return own;
  const pkg = readPkg(dir);
  const apps = pkg || has('pnpm-workspace.yaml') ? monorepoApps(dir, pkg) : [];
  if (apps.length) return { ...apps[0], ...(apps.length > 1 ? { apps } : {}) };
  const compose = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].find(has);
  if (compose) {
    let doc = null;
    try { doc = yaml.load(readText(path.join(dir, compose))); } catch { /* not YAML */ }
    const port = composePort(doc);
    return { install: null, command: 'docker compose up', url: port ? `http://localhost:${port}` : null, from: compose };
  }
  const dc = readJsonc(path.join(dir, '.devcontainer', 'devcontainer.json'));
  const dcCommand = commandText(dc?.postStartCommand);
  if (dcCommand) {
    const port = (dc.forwardPorts || []).map((p) => String(p).split(':').pop())[0];
    return { install: commandText(dc.postCreateCommand), command: dcCommand, url: port ? `http://localhost:${port}` : null, from: '.devcontainer/devcontainer.json (postStartCommand)' };
  }
  const web = (readText(path.join(dir, 'Procfile')) || '').match(/^web:\s*(.+)$/m)?.[1]?.trim();
  if (web) return { install: null, command: web, url: null, from: 'Procfile (web)' };
  const makefile = readText(path.join(dir, 'Makefile'));
  const target = makefile && ['run', 'dev', 'start'].find((t) => new RegExp(`^${t}\\s*:(?!=)`, 'm').test(makefile));
  if (target) return { install: null, command: `make ${target}`, url: null, from: `Makefile (${target})` };
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
  announced,
  cleanConfig,
  commandLine,
  fingerprint,
  installState,
  needsInstall,
  portInUse,
  portOf,
  previewEnv,
  readRepoConfig,
  recordInstall,
  resolveConfig,
  resolveSource,
  runFolder,
  scratchProjects,
  scratchWorkspace,
  startView,
  suggestConfig,
  worktreeAppScratch,
  writeRepoConfig,
};
