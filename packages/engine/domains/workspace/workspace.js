// The app's local workspace: a single folder holding the run logs (runs/), the
// cloned repositories (repos/), the runs' git worktrees (worktrees/), the projects (projects/),
// the skills (skills/), the agents (agents/), the workflows (workflows/) and the app preferences (settings.json).
//
// Resolution order:
//   1. MULTIAGENT_WORKSPACE environment variable (tests/CI, an agent's run scratch workspace; not persisted)
//   *. simulation only (MULTIAGENT_SIMULATION_ONLY=1) without it: a scratch workspace in the OS temp
//      folder (simulationWorkspace), never the registered one, so an agent's check that missed its
//      run's scratch workspace can't write to the owner's (#120); not persisted
//   2. registered path (Windows: HKCU\Software\MultiagentOrchestrator\WorkspacePath;
//      other OSes: ~/.multiagent-orchestrator.json)
//   3. default folder ~/multiagent-workspace, if it already exists
// If none of these exist, it is up to the UI to ask the user (create the default or pick another).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { resolveCommand } = require('../../engine/providers');
const { simulationOnly } = require('../../engine/simulation');
const TimeZone = require('../analytics/time-zone');
const { DEFAULT_PLATFORM } = require('@multiagent/shared/platforms');

const DEFAULT_NAME = 'multiagent-workspace';
const REG_KEY = 'HKCU\\Software\\MultiagentOrchestrator';
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
// Preferences (settings.json in the workspace)
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  // shows the Simulation checkboxes (checked by default) and the simulation scenarios; off = real runs only
  developerMode: false,
  openRunOnStart: true,   // when a workflow starts, switch to the run screen
  confirmStop: true,      // ask for confirmation before stopping a workflow
  // desktop notifications (see packages/engine/domains/workspace/notifications.js): run status changes, CLI sessions waiting for you,
  // the Product Owner's answers (#149), the Oracle's actions under Night watch (#123)
  notifyOracle: true,
  notifyPO: true,
  notifyRuns: true,
  notifySessions: true,
  // days the notification center keeps notifications (packages/engine/domains/workspace/store.js); older ones are deleted
  notificationRetentionDays: 30,
  // Phone gates (#226, packages/engine/domains/workspace/mobile-gates.js): the gates-only page the app serves on localhost:port to
  // paired phones; publicUrl: the private address that reaches it from outside (Tailscale serve,
  // Cloudflare Tunnel with access rules), used in the gate links; '' = the localhost address
  phoneGates: { enabled: false, port: 7400, publicUrl: '' },
  lastProject: null,
  lastWorkflow: null,
  // where the Backlog screen syncs issues from by default: github | gitlab | bitbucket
  backlogPlatform: DEFAULT_PLATFORM,
  // the most issues the Backlog sends as one run (one branch, one PR/MR)
  backlogMaxGroup: 5,
  // the Backlog suggests a Backlog Refresh run when the last one is older than this (#161); 0 = off
  backlogRefreshHours: 24,
  // (#790: the default development workflow is each project's, packages/engine/domains/project/projects.js
  // projectDefaultWorkflow; an old `defaultWorkflow` here is moved to the projects once, service/areas/workspace.js)
  // Live roadmap (#164, packages/engine/domains/roadmap/live-roadmap.js): the highest complexity:n a refill picks, the most stages
  // per refill, the spend over 24 h (USD, runs and refills; 0 = no cap) past which refills stop, and
  // whether the backlog is synced before the Product Owner reads it
  liveRoadmap: { complexityCap: 2, maxStages: 3, dailyBudgetUsd: 50, refreshFirst: true },
  // several workflows at the same time (Settings › Execution); disabled = one run at a time.
  // perProject: null = no limit per project; simulations count toward the limits only if countSimulations.
  concurrentRuns: { enabled: false, max: 2, perProject: null, countSimulations: false },
  // Machine profile (#367, packages/engine/domains/machine/machine-profile.js): 'auto' sizes the concurrent runs' maximum and the
  // test workers per run from this machine; 'manual' keeps { concurrentRuns, testWorkers } as set
  machineProfile: { mode: 'auto' },
  // Memory guard (#276, packages/engine/engine/memory-guard.js): a real run's process over limitPercent of the RAM
  // is stopped; suites and new runs wait while less than floorPercent is free (0 = no hold)
  memoryGuard: { enabled: true, limitPercent: 25, floorPercent: 10 },
  // Platform triggers (#568, packages/engine/domains/triggers/triggers.js): the projects whose repository
  // `triggers:` the app polls ({ <projectId>: true }; off by default) and the poll interval (0 = off)
  triggers: { enabled: {}, intervalMinutes: 2 },
  // Main stays green (#405, packages/engine/domains/project/base-health.js): what a red test on the base files: 'off', 'issue'
  // (a bug issue only) or 'fix' (the issue and a fix item at the front of the roadmap)
  baseCheck: { onRed: 'fix' },
  // Keep awake (#162, apps/desktop/host/keep-awake.js): no sleep while runs, a roadmap or a queue have work to do
  keepAwake: false,
  // Control channel (#336, packages/engine/control): outside sessions drive this app through a loopback endpoint
  controlChannel: false,
  // Findings button (#361, packages/ui-kit/findings.js): shown in a packaged app (and in screenshot
  // captures) only when on; the app run from source always shows it
  findingsButton: false,
  // the top bar's 24/7 chip (#188, packages/ui-kit/occupancy-chip.js): the last 24 h occupancy
  showOccupancyChip: true,
  // the project city's Glow (#450, fronts/analyser/views/project/project-city.js): the bloom over the
  // lights and the vignette start on; off for slower machines (the header's switch still turns it on)
  cityGlow: true,
  // warn when an agent shows no output for this long while a command it started is waiting; 0 = off
  idleWarningMinutes: 5,
  // monthly limits per provider (see packages/engine/domains/usage/usage.js); null = no limit
  budgets: {},
  // the spending budget (#206, packages/engine/domains/usage/budget.js): US$ per local day and per Night watch night (null = no
  // cap) past which the roadmaps pause before their next start; `raised`: "Raise for today" (one day/night)
  budget: { dailyUsd: null, nightlyUsd: null, raised: null },
  // the Oracle (packages/engine/domains/oracle/oracle.js): its daily spend limit in USD (0 = no cap) and the context size
  // (tokens) past which its next turn starts a new session from a handoff note; what wakes it (#123,
  // packages/engine/domains/oracle/oracle-wake.js): wakeScope all | watched | off, wakeOn the event kinds; selfHealing (#278):
  // its watch stays on day and night, with no end time (packages/engine/domains/oracle/oracle-actions.js watchState); appUpdate
  // (#279, needs selfHealing): apply merged fixes to this app after a roadmap stage ends (packages/engine/domains/workspace/app-update.js);
  // parkAfterMinutes (#395): the watch moves on past a roadmap run waiting this long at a human gate (skip permission)
  oracle: { dailyBudgetUsd: 20, compactAtTokens: 150000, wakeScope: 'all', wakeOn: ['finished', 'gate', 'interrupted', 'invalid', 'limit', 'merge', 'stall'], selfHealing: false, appUpdate: false, parkAfterMinutes: 15 },
  // USD per 1M tokens, for CLIs that do not report cost: { model: { input, output, cache_read } }
  prices: {},
  // #262: per provider, the ordered fallback chain of an agent whose workflow declares none:
  // { <provider>: { fallbacks: ['<provider>:<model>', ...] } } (a turn out of credits moves on to the next)
  // #312: and its accounts in order, { accounts: [{ name, dir, enabled }] } (dir: the CLI's config folder);
  // a turn out of credits moves to the next account first, the fallback chain only after the last one
  providers: {},
  // #312: how long an account stays out after a usage limit whose message gives no reset time
  accountCooldownMinutes: 60,
  // #262: limits that follow the model an agent runs on: { <model id>: { timeout_factor?, max_total_cost_usd? } }
  // (the workflow's own `models` win per model)
  models: {},
  // GitHub Actions quota minutes included per month (GitHub Free: 2,000), see packages/engine/domains/usage/actions-usage.js
  actionsIncludedMinutes: 2000,
  // voice input (packages/engine/domains/chat/speech.js): the whisper.cpp CLI (a name in PATH or a path), the model (an id
  // from speech.MODELS or a path to a ggml .bin) and the spoken language ('auto' = detect)
  voiceCommand: 'whisper-cli',
  voiceModel: 'small',
  voiceLanguage: 'pt',
  // the first-run Setup (#319, packages/ui-kit/setup.js): done once Finish or Skip is pressed; a
  // settings.json written before Setup existed reads true (readSettings), so current users skip it
  setupDone: false,
  // workflow ids (file names without .yaml) the Setup's Workflows step left unpicked: not offered by
  // Start (Home's Run a workflow opens it), shown again by Workflows › Definitions › Show in Start
  hiddenWorkflows: [],
  // #474: the files not bundled with the app the owner confirmed are code they trust, "workflows/<file>"
  // → the fingerprint of the text confirmed (packages/engine/service/areas/workflows.js); an edit elsewhere asks again
  trustedFiles: {},
  // the owner's IANA time zone (#273, packages/engine/domains/analytics/time-zone.js): screens, day/week/month cuts, the agents'
  // replies and the daily resets use it; null = this computer's (readSettings fills it in, unsaved)
  timeZone: null,
  // the languages agents write in (#327, #328, packages/shared/language.js): `agents` for chat replies, prose
  // and documents ('interface' = Same as the interface), `issues` for issues, PR/MR descriptions and
  // commit messages; `interface` (#329, packages/shared/i18n.js), the app's own language, is unset until
  // chosen: the computer's language when it has a catalog, else English
  language: { agents: 'interface', issues: 'en' },
};

// settings.json as saved: null when there is none, {} when it is not valid JSON
function savedSettings(ws) {
  let text;
  try { text = fs.readFileSync(ws.settings, 'utf8'); } catch { return null; }
  try { const saved = JSON.parse(text); return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}; } catch { return {}; }
}

function readSettings(ws) {
  const saved = savedSettings(ws);
  if (!saved) return { ...DEFAULT_SETTINGS, hiddenWorkflows: [], timeZone: TimeZone.systemZone() };
  // a maximum of concurrent runs raised by hand before the machine profile existed (#367) stays the
  // owner's: manual, never replaced by the machine's proposal
  const legacyMax = !saved.machineProfile && Number.isFinite(saved.concurrentRuns?.max) && saved.concurrentRuns.max !== DEFAULT_SETTINGS.concurrentRuns.max;
  const machineProfile = legacyMax ? { mode: 'manual', concurrentRuns: saved.concurrentRuns.max } : saved.machineProfile || DEFAULT_SETTINGS.machineProfile;
  // an existing settings.json without setupDone: a workspace in use before Setup existed (#319)
  return { ...DEFAULT_SETTINGS, hiddenWorkflows: [], setupDone: true, ...saved, machineProfile, timeZone: saved.timeZone || TimeZone.systemZone() };
}

function writeSettings(ws, patch) {
  if (patch?.timeZone && TimeZone.zoneOf(patch.timeZone) !== patch.timeZone) throw new Error(`Unknown time zone: ${patch.timeZone} (an IANA name, e.g. America/Sao_Paulo).`);
  const saved = savedSettings(ws);
  const next = { ...readSettings(ws), ...patch };
  for (const k of Object.keys(next)) if (!(k in DEFAULT_SETTINGS)) delete next[k];
  // a maximum of concurrent runs written without the machine profile's mode is the owner's (#367)
  if (Number.isFinite(patch?.concurrentRuns?.max) && !('machineProfile' in patch)) {
    next.machineProfile = { ...next.machineProfile, mode: 'manual', concurrentRuns: patch.concurrentRuns.max };
  }
  // the computer's zone is not saved until one is chosen (#273): the workspace follows the computer
  if (!(patch && patch.timeZone) && !(saved && saved.timeZone)) next.timeZone = null;
  // setupDone is written once known (#319: the Setup saves false when it opens, true at Finish or
  // Skip); a first write without it (a seeded or scripted workspace) leaves it out, so it reads as set up
  if (!(saved && 'setupDone' in saved) && !(patch && 'setupDone' in patch)) delete next.setupDone;
  fs.writeFileSync(ws.settings, JSON.stringify(next, null, 2));
  return { setupDone: true, ...next };
}

// ---------------------------------------------------------------------------
// Repository cloning
// ---------------------------------------------------------------------------
// https://…, ssh://…, git@host:owner/repo(.git)
const isGitUrl = (s) => /^(https?|ssh|git):\/\/\S+$/i.test(s || '') || /^[\w.-]+@[\w.-]+:\S+$/.test(s || '');

// the clone's folder name (owner-repo): the onboarding model's rule, shared with the wizard's step 2 (#669)
const { repoNameFromUrl } = require('@multiagent/shared/onboarding-model');

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
