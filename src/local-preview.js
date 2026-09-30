// Run locally (#70): at a gate with `local_preview: true` the owner runs the run's worktree with the
// project's command (a dev server, the app itself) before answering. The service starts it in an
// embedded terminal (src/terminals.js) and stops it when the gate is answered or the run ends; this
// module holds what does not need the service:
// - which config applies: the project's override (Projects › Local preview), else the workflow's
//   orchestrator.local_preview ({ install, command, url });
// - whether `install` must run first: dependencies missing, or the lockfile changed since the last
//   preview of that run;
// - the port of `url` already in use (reported instead of failing silently);
// - the safe default for this app: the copy runs on a scratch workspace (projects, agents, skills,
//   workflows and settings copied, never the runs) with its own user-data folder and in simulation
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

// What the scratch workspace copies from the real one (never runs/, repos/, worktrees/)
const COPIED = ['agents', 'projects', 'settings.json', 'skills', 'workflows'];

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

// <root>/workspace: a copy of the owner's projects, agents, skills, workflows and settings;
// <root>/user-data: the app's own data folder (sign-in, window state) for the copy.
function scratchWorkspace(ws, root) {
  const dir = path.join(root, 'workspace');
  for (const name of COPIED) {
    const from = path.join(ws.root, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, name), { recursive: true, force: true });
  }
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

module.exports = {
  commandLine,
  needsInstall,
  portInUse,
  portOf,
  previewEnv,
  recordInstall,
  resolveConfig,
  scratchWorkspace,
};
