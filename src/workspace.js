// The app's local workspace: a single folder holding the run logs (runs/), the
// cloned repositories (repos/), the runs' git worktrees (worktrees/), the projects (projects/),
// the skills (skills/), the agents (agents/), the workflows (workflows/) and the app preferences (settings.json).
//
// Resolution order:
//   1. MULTIAGENT_WORKSPACE environment variable (tests/CI; not persisted)
//   2. registered path (Windows: HKCU\Software\MultiagentOrchestrator\WorkspacePath;
//      other OSes: ~/.multiagent-orchestrator.json)
//   3. default folder ~/multiagent-workspace, if it already exists
// If none of these exist, it is up to the UI to ask the user (create the default or pick another).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { resolveCommand } = require('./engine/providers');

const DEFAULT_NAME = 'multiagent-workspace';
const REG_KEY = 'HKCU\\Software\\MultiagentOrchestrator';
const REG_VALUE = 'WorkspacePath';
const ENV_VAR = 'MULTIAGENT_WORKSPACE';

const defaultWorkspace = (home = os.homedir()) => path.join(home, DEFAULT_NAME);

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
 * @returns {{ dir: string|null, source: 'env'|'registry'|'default'|null, registered: string|null, fallback: string }}
 *   dir null => the UI needs to ask. `registered` holds the saved path even
 *   when it no longer exists (to warn the user).
 */
function resolveWorkspace({ store = defaultStore(), env = process.env, home = os.homedir() } = {}) {
  const fallback = defaultWorkspace(home);
  if (env[ENV_VAR]) return { dir: path.resolve(env[ENV_VAR]), source: 'env', registered: null, fallback };

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
    // user-defined agents, one JSON file each (see src/agents.js)
    agents: path.join(root, 'agents'),
    // editable workflow YAML files (bundled defaults are seeded here, see src/workflows.js)
    workflows: path.join(root, 'workflows'),
    // one git worktree per run (orchestrator.worktree), created on demand
    worktrees: path.join(root, 'worktrees'),
    // last issue sync of each project (see src/backlog.js)
    backlog: path.join(root, 'backlog'),
    settings: path.join(root, 'settings.json'),
    // titles the user gave to CLI sessions on the Sessions screen ({ "<provider>:<id>": title })
    sessionTitles: path.join(root, 'session-titles.json'),
    // the run the app has in progress, removed when it ends: found at the next start, the run died with the app
    activeRun: path.join(root, 'active-run.json'),
  };
}

// ---------------------------------------------------------------------------
// Preferences (settings.json in the workspace)
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  // shows the Simulation checkboxes (checked by default) and the simulation scenarios; off = real runs only
  developerMode: false,
  openRunOnStart: true,   // when a workflow starts, switch to the run screen
  confirmStop: true,      // ask for confirmation before stopping a workflow
  // desktop notifications (see src/notifications.js): run status changes, CLI sessions waiting for you
  notifyRuns: true,
  notifySessions: true,
  lastProject: null,
  lastWorkflow: null,
  // where the Backlog screen syncs issues from by default: github | gitlab | bitbucket
  backlogPlatform: 'github',
  // the most issues the Backlog sends as one run (one branch, one PR/MR)
  backlogMaxGroup: 5,
  // several workflows at the same time (Settings › Execution); disabled = one run at a time.
  // perProject: null = no limit per project; simulations count toward the limits only if countSimulations.
  concurrentRuns: { enabled: false, max: 2, perProject: null, countSimulations: false },
  // warn when an agent shows no output for this long while a command it started is waiting; 0 = off
  idleWarningMinutes: 5,
  // monthly limits per provider (see src/usage.js); null = no limit
  budgets: {},
  // USD per 1M tokens, for CLIs that do not report cost: { model: { input, output, cache_read } }
  prices: {},
  // GitHub Actions quota minutes included per month (GitHub Free: 2,000), see src/actions-usage.js
  actionsIncludedMinutes: 2000,
};

function readSettings(ws) {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(ws.settings, 'utf8')) }; } catch { return { ...DEFAULT_SETTINGS }; }
}

function writeSettings(ws, patch) {
  const next = { ...readSettings(ws), ...patch };
  for (const k of Object.keys(next)) if (!(k in DEFAULT_SETTINGS)) delete next[k];
  fs.writeFileSync(ws.settings, JSON.stringify(next, null, 2));
  return next;
}

// ---------------------------------------------------------------------------
// Repository cloning
// ---------------------------------------------------------------------------
// https://…, ssh://…, git@host:owner/repo(.git)
const isGitUrl = (s) => /^(https?|ssh|git):\/\/\S+$/i.test(s || '') || /^[\w.-]+@[\w.-]+:\S+$/.test(s || '');

function repoNameFromUrl(url) {
  const clean = String(url).trim().replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const parts = clean.split(/[/:]/).filter(Boolean);
  const name = parts.slice(-2).join('-') || 'repo'; // owner-repo avoids collisions between forks
  return name.replace(/[^\w.-]/g, '_');
}

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

function execGit(args, cwd) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  return new Promise((resolve, reject) => {
    execFile('git', [...gitAuthArgs(), ...args], { cwd, env, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(explainGitError(args, stderr || err.message)));
      else resolve(stdout);
    });
  });
}

module.exports = {
  DEFAULT_NAME,
  ENV_VAR,
  defaultWorkspace,
  registryStore,
  fileStore,
  defaultStore,
  resolveWorkspace,
  setupWorkspace,
  layout,
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  isGitUrl,
  repoNameFromUrl,
  cloneRepo,
  execGit,
  gitAuthArgs,
};
