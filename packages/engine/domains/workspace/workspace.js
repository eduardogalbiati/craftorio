// The app's local workspace: a single folder holding the run logs (runs/), the
// cloned repositories (repos/), the runs' git worktrees (worktrees/), the projects (projects/),
// the skills (skills/), the agents (agents/), the workflows (workflows/) and the app preferences (settings.json).
//
// Resolution order:
//   1. MULTIAGENT_WORKSPACE environment variable (tests/CI, an agent's run scratch workspace; not persisted)
//   *. simulation only (MULTIAGENT_SIMULATION_ONLY=1) without it: a scratch workspace in the OS temp
//      folder (simulationWorkspace), never the registered one, so an agent's check that missed its
//      run's scratch workspace can't write to the owner's (#120); not persisted
//   2. registered path (Windows: HKCU\Software\Craftorio\WorkspacePath;
//      other OSes: ~/.multiagent-orchestrator.json)
//   3. default folder ~/multiagent-workspace, if it already exists
// If none of these exist, it is up to the UI to ask the user (create the default or pick another).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { resolveCommand } = require('../../engine/providers');
const { simulationOnly } = require('../../engine/simulation');
// the preferences (settings.json): settings.js, a low-level utility the engine may require too (#862), re-exported here
const {
  DEFAULT_SETTINGS,
  readSettings,
  savedSettings,
  writeSettings,
} = require('./settings');

const DEFAULT_NAME = 'multiagent-workspace';
const REG_KEY = 'HKCU\\Software\\Craftorio';
const REG_VALUE = 'WorkspacePath';
const ENV_VAR = 'MULTIAGENT_WORKSPACE';

const defaultWorkspace = (home = os.homedir()) => path.join(home, DEFAULT_NAME);
// Where a simulation-only process given no workspace works: { workspace, userData } (#120)
const simulationWorkspace = (tmp = os.tmpdir()) => ({
  workspace: path.join(tmp, 'multiagent-simulation', 'workspace'),
  userData: path.join(tmp, 'multiagent-simulation', 'user-data'),
});

// ---------------------------------------------------------------------------
// Where the path is registered
// ---------------------------------------------------------------------------
const registryStore = {
  describe: `${REG_KEY}\\${REG_VALUE}`,
  get() {
    try {
      // chcp 65001: without it reg.exe returns accented characters in the OEM code page.
      const out = execFileSync('cmd', ['/d', '/c', `chcp 65001>nul & reg query ${REG_KEY} /v ${REG_VALUE}`],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
      const m = out.match(new RegExp(`${REG_VALUE}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, 'm'));
      return m ? m[1] : null;
    } catch {
      return null; // key does not exist yet
    }
  },
  set(dir) {
    execFileSync('reg', ['add', REG_KEY, '/v', REG_VALUE, '/t', 'REG_SZ', '/d', dir, '/f'], { windowsHide: true, stdio: 'ignore' });
  },
};

function fileStore(file = path.join(os.homedir(), '.multiagent-orchestrator.json')) {
  return {
    describe: file,
    get() {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')).workspace || null; } catch { return null; }
    },
    set(dir) {
      fs.writeFileSync(file, JSON.stringify({ workspace: dir }, null, 2));
    },
  };
}

const defaultStore = () => (process.platform === 'win32' ? registryStore : fileStore());

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/**
 * Finds the workspace without user interaction.
 * @returns {{ dir: string|null, source: 'env'|'simulation'|'registry'|'default'|null, registered: string|null, fallback: string }}
 *   dir null => the UI needs to ask. `registered` holds the saved path even
 *   when it no longer exists (to warn the user). Only 'registry' and 'default' may be persisted.
 */
function resolveWorkspace({ store = defaultStore(), env = process.env, home = os.homedir(), tmp = os.tmpdir() } = {}) {
  const fallback = defaultWorkspace(home);
  if (env[ENV_VAR]) return { dir: path.resolve(env[ENV_VAR]), source: 'env', registered: null, fallback };
  if (simulationOnly(env)) return { dir: simulationWorkspace(tmp).workspace, source: 'simulation', registered: null, fallback };

  const registered = store.get();
  if (registered && isDir(registered)) return { dir: path.resolve(registered), source: 'registry', registered, fallback };
  if (isDir(fallback)) {
    store.set(fallback); // register it for the next launches
    return { dir: fallback, source: 'default', registered, fallback };
  }
  return { dir: null, source: null, registered, fallback };
}

/** Creates the workspace structure and registers the path. */
function setupWorkspace(dir, { store = defaultStore(), persist = true } = {}) {
  const root = path.resolve(dir);
  const ws = layout(root);
  for (const d of [ws.root, ws.runs, ws.repos, ws.projects, ws.skills, ws.agents, ws.workflows]) fs.mkdirSync(d, { recursive: true });
  if (persist) store.set(root);
  return ws;
}

function layout(root) {
  return {
    root,
    runs: path.join(root, 'runs'),
    repos: path.join(root, 'repos'),
    projects: path.join(root, 'projects'),
    skills: path.join(root, 'skills'),
    // analysis seeds, one folder each with its seed.md (bundled defaults are seeded here, see packages/engine/domains/seed/seeds.js, #360)
    seeds: path.join(root, 'seeds'),
    // user-defined agents, one JSON file each (see packages/engine/domains/agents/agents.js)
    agents: path.join(root, 'agents'),
    // editable workflow YAML files (bundled defaults are seeded here, see packages/engine/domains/workflow/workflows.js)
    workflows: path.join(root, 'workflows'),
    // saved pipelines, one YAML file each (bundled defaults are seeded here, see packages/engine/domains/workflow/pipelines.js, #135)
    pipelines: path.join(root, 'pipelines'),
    // one git worktree per run (orchestrator.worktree), created on demand
    worktrees: path.join(root, 'worktrees'),
    // dependencies installed once per lockfile hash, linked into run worktrees (#198, packages/engine/engine/deps-cache.js)
    cache: path.join(root, 'cache'),
    // Run locally at a gate: per run, the scratch workspace and user data of the copy (packages/engine/domains/local/local-preview.js)
    localPreviews: path.join(root, 'local-previews'),
    // last issue sync of each project (see packages/engine/domains/backlog/backlog.js)
    backlog: path.join(root, 'backlog'),
    // each project's release history and next release notes (#260, packages/engine/domains/releases/releases.js), created on demand
    releases: path.join(root, 'releases'),
    // the supervisor's reports on the sessions of a date range (Analytics), created on demand
    reports: path.join(root, 'reports'),
    // the app-wide Supervisor chat (packages/engine/domains/supervisor/supervisor-chat.js), created on demand
    supervisor: path.join(root, 'supervisor'),
    // the Oracle (packages/engine/domains/oracle/oracle.js): its conversation, memory, handoff notes and usage, created on demand
    oracle: path.join(root, 'oracle'),
    // images pasted into the AI prompt fields (#130, packages/engine/domains/chat/pasted-images.js): pending/ until submitted
    attachments: path.join(root, 'attachments'),
    // discovery cards, private to the workspace (#256, packages/engine/domains/discovery/discovery.js): <project id>/cards/<card id>/, created on demand
    discovery: path.join(root, 'discovery'),
    // the Architecture tab's settings, city plans and reports (#356, packages/engine/domains/oracle/oracle-architecture.js), created on demand
    architecture: path.join(root, 'architecture'),
    // the Refactor tab's proposals, ranking and cadence (#357, packages/engine/domains/refactor/refactor-proposals.js), created on demand
    refactor: path.join(root, 'refactor'),
    // the Monitor's sources, error events and groups per project (#634, packages/engine/domains/monitor/monitor-store.js), created on demand
    monitor: path.join(root, 'monitor'),
    settings: path.join(root, 'settings.json'),
    // titles the user gave to CLI sessions on the Sessions screen ({ "<provider>:<id>": title })
    sessionTitles: path.join(root, 'session-titles.json'),
    // the run the app has in progress, removed when it ends: found at the next start, the run died with the app
    activeRun: path.join(root, 'active-run.json'),
    // SQLite index next to the files: runs cache, Backlog queues, pending gates, notifications (packages/engine/domains/workspace/store.js)
    index: path.join(root, 'index.db'),
  };
}

// ---------------------------------------------------------------------------
// Repository cloning
// ---------------------------------------------------------------------------
// https://…, ssh://…, git@host:owner/repo(.git)
const isGitUrl = (s) => /^(https?|ssh|git):\/\/\S+$/i.test(s || '') || /^[\w.-]+@[\w.-]+:\S+$/.test(s || '');

// the clone's folder name (owner-repo): the onboarding model's rule, shared with the wizard's step 2 (#669)
const { repoNameFromUrl } = require('@craftorio/shared/onboarding-model');

/**
 * Ensures a local copy of `url` in <workspace>/repos. If already cloned, only fetches.
 * @returns {Promise<{ dir: string, cloned: boolean }>}
 */
function cloneRepo(url, reposDir, { run = execGit } = {}) {
  const dir = path.join(reposDir, repoNameFromUrl(url));
  if (isDir(path.join(dir, '.git'))) return run(['fetch', '--all', '--prune'], dir).then(() => ({ dir, cloned: false }));
  if (isDir(dir) && fs.readdirSync(dir).length) return Promise.reject(new Error(`The folder ${dir} already exists and is not a git repository.`));
  fs.mkdirSync(reposDir, { recursive: true });
  return run(['clone', url, dir], reposDir).then(() => ({ dir, cloned: true }));
}

// The app runs without a terminal: git cannot prompt for username/password (it would fail with
// "could not read Username ... /dev/tty"). For github.com it uses the GitHub CLI as the
// credential helper (same account as `gh auth login`), without changing .gitconfig.
function gitAuthArgs() {
  const gh = resolveCommand('gh');
  if (!gh) return [];
  return ['-c', `credential.https://github.com.helper=!'${gh.file.replace(/\\/g, '/')}' auth git-credential`];
}

function explainGitError(args, stderr) {
  const msg = stderr.trim();
  if (/could not read Username|Authentication failed|terminal prompts disabled|Repository not found/i.test(msg)) {
    return `git ${args[0]} failed: no access to the repository. For private GitHub repositories, authenticate the GitHub CLI (gh auth login); on other hosts use SSH or configure a credential helper.\n${msg}`;
  }
  return `git ${args[0]} failed: ${msg}`;
}

// #639: `env` replaces process.env as the base (git ls-remote passes the allowlisted one); `timeout` in ms.
// A missing git rejects with code 'ENOENT', a git stopped by the timeout with code 'ETIMEDOUT'.
function execGit(args, cwd, { env: baseEnv = process.env, timeout = 0 } = {}) {
  const env = { ...baseEnv, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  return new Promise((resolve, reject) => {
    execFile('git', [...gitAuthArgs(), ...args], { cwd, env, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT') reject(Object.assign(new Error('git was not found: install git and make sure it is on the PATH.'), { code: 'ENOENT' }));
      else if (err?.killed && timeout) reject(Object.assign(new Error(`git ${args[0]} timed out after ${Math.round(timeout / 1000)} s.`), { code: 'ETIMEDOUT' }));
      else if (err) reject(new Error(explainGitError(args, stderr || err.message)));
      else resolve(stdout);
    });
  });
}

module.exports = {
  cloneRepo,
  DEFAULT_NAME,
  DEFAULT_SETTINGS,
  defaultStore,
  defaultWorkspace,
  ENV_VAR,
  execGit,
  fileStore,
  gitAuthArgs,
  isGitUrl,
  layout,
  readSettings,
  registryStore,
  repoNameFromUrl,
  resolveWorkspace,
  savedSettings,
  setupWorkspace,
  simulationWorkspace,
  writeSettings,
};
