// The app's local workspace: a single folder holding the run logs (runs/), the
// cloned repositories (repos/), the runs' git worktrees (worktrees/), the projects (projects/),
// the skills (skills/), the agents (agents/), the workflows (workflows/) and the app preferences (settings.json).
//
// Resolution order:
//   1. CRAFTORIO_WORKSPACE environment variable (tests/CI, an agent's run scratch workspace; not persisted)
//   *. simulation only (CRAFTORIO_SIMULATION_ONLY=1) without it: a scratch workspace in the OS temp
//      folder (simulationWorkspace), never the registered one, so an agent's check that missed its
//      run's scratch workspace can't write to the owner's (#120); not persisted
//   2. registered path (Windows: HKCU\Software\Craftorio\WorkspacePath;
//      other OSes: ~/.craftorio.json)
//   3. default folder ~/craftorio-workspace, if it already exists
// T2c: what an install from before the rename to Craftorio left is still found, never moved: the
// registry key HKCU\Software\MultiagentOrchestrator, ~/.multiagent-orchestrator.json and the default
// folder ~/multiagent-workspace (registered under the new name when found).
// If none of these exist, it is up to the UI to ask the user (create the default or pick another).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { fileURLToPath } = require('url');
const { resolveCommand } = require('../../engine/providers');
const { simulationOnly } = require('../../engine/simulation');
// the preferences (settings.json): settings.js, a low-level utility the engine may require too (#862), re-exported here
const {
  DEFAULT_SETTINGS,
  readSettings,
  savedSettings,
  writeSettings,
} = require('./settings');

const DEFAULT_NAME = 'craftorio-workspace';
const LEGACY_DEFAULT_NAME = 'multiagent-workspace';
const REG_KEY = 'HKCU\\Software\\Craftorio';
const LEGACY_REG_KEY = 'HKCU\\Software\\MultiagentOrchestrator';
const REG_VALUE = 'WorkspacePath';
const ENV_VAR = 'CRAFTORIO_WORKSPACE';

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const defaultWorkspace = (home = os.homedir()) => path.join(home, DEFAULT_NAME);
// the default folder an install from before the rename created (T2c)
const legacyDefaultWorkspace = (home = os.homedir()) => path.join(home, LEGACY_DEFAULT_NAME);
// the default folder that exists, the new name first; the new one when neither does (the scripts' default)
const existingDefaultWorkspace = (home = os.homedir()) => [defaultWorkspace(home), legacyDefaultWorkspace(home)].find(isDir) || defaultWorkspace(home);
// Where a simulation-only process given no workspace works: { workspace, userData } (#120)
const simulationWorkspace = (tmp = os.tmpdir()) => ({
  workspace: path.join(tmp, 'craftorio-simulation', 'workspace'),
  userData: path.join(tmp, 'craftorio-simulation', 'user-data'),
});

// ---------------------------------------------------------------------------
// Where the path is registered
// ---------------------------------------------------------------------------
const registryStore = {
  describe: `${REG_KEY}\\${REG_VALUE}`,
  get() {
    for (const key of [REG_KEY, LEGACY_REG_KEY]) {
      try {
        // chcp 65001: without it reg.exe returns accented characters in the OEM code page.
        const out = execFileSync('cmd', ['/d', '/c', `chcp 65001>nul & reg query ${key} /v ${REG_VALUE}`],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
        const m = out.match(new RegExp(`${REG_VALUE}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, 'm'));
        if (m) return m[1];
      } catch { /* key does not exist (yet): the old one, then none */ }
    }
    return null;
  },
  set(dir) {
    execFileSync('reg', ['add', REG_KEY, '/v', REG_VALUE, '/t', 'REG_SZ', '/d', dir, '/f'], { windowsHide: true, stdio: 'ignore' });
  },
};

const STORE_FILE = () => path.join(os.homedir(), '.craftorio.json');
const LEGACY_STORE_FILE = () => path.join(os.homedir(), '.multiagent-orchestrator.json');
// legacy: the file read when `file` has no path, the old default's (only with the default file)
function fileStore(file = STORE_FILE(), legacy = file === STORE_FILE() ? LEGACY_STORE_FILE() : null) {
  return {
    describe: file,
    get() {
      for (const f of [file, legacy].filter(Boolean)) {
        try { return JSON.parse(fs.readFileSync(f, 'utf8')).workspace || null; } catch { /* the old file, then none */ }
      }
      return null;
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
  for (const dir of [fallback, legacyDefaultWorkspace(home)]) {
    if (!isDir(dir)) continue;
    store.set(dir); // register it for the next launches
    return { dir, source: 'default', registered, fallback };
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

// the clone's folder name (owner-repo; #84: a local path's own name): the onboarding model's rule, shared with the wizard's step 2 (#669)
const { repoNameFromUrl } = require('@craftorio/shared/onboarding-model');
const Platforms = require('@craftorio/shared/platforms');

// #741 #84: one key for the URLs of the same repository (https or ssh, case, a trailing slash or .git
// aside, the registry's Platforms.parseRepoUrl); a local path or file:// URL is its resolved folder
function repoKey(url) {
  const parsed = Platforms.parseRepoUrl(url);
  if (parsed) return `${parsed.host}/${parsed.path.toLowerCase()}`;
  let s = String(url || '').trim();
  if (/^file:\/\//i.test(s)) { try { s = fileURLToPath(s); } catch { /* compared as typed */ } }
  s = s.replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  return s ? path.resolve(s).toLowerCase() : '';
}
const sameRepo = (a, b) => !!repoKey(a) && repoKey(a) === repoKey(b);

// #84: a clone's origin URL, read from its .git/config ('' when none can be read)
function originOf(dir) {
  try {
    const section = /\[remote "origin"\]([^[]*)/.exec(fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8'));
    return (section && /^\s*url\s*=\s*(.+?)\s*$/m.exec(section[1])?.[1]) || '';
  } catch { return ''; }
}

/**
 * #84: the folder of `url`'s clone in reposDir: <name> (repoNameFromUrl), or its clone already there; a folder
 * taken by something else (not git and not empty, or a clone whose origin is another repository) gives the
 * first free sibling <name>-2, <name>-3…; a clone whose origin can't be read counts as the same repository.
 * @returns {{ dir: string, existing: boolean }}
 */
function cloneFolder(url, reposDir) {
  const base = path.join(reposDir, repoNameFromUrl(url));
  for (let i = 1; ; i++) {
    const dir = i === 1 ? base : `${base}-${i}`;
    if (isDir(path.join(dir, '.git'))) {
      const origin = originOf(dir);
      if (!origin || sameRepo(origin, url)) return { dir, existing: true };
    } else if (!isDir(dir) || !fs.readdirSync(dir).length) return { dir, existing: false };
  }
}

// #79: the platform of a repository URL (its host), GitHub's when the host names none
const platformOfUrl = (url) => Platforms.platformOfRepoUrl(url) || Platforms.platformOrDefault();

// #79: the platform CLI's command that makes git use its login over HTTPS (`gh auth setup-git`), '' when it has none
function setupGitText(platform) {
  const c = platform.setupGitCommand?.();
  return c ? `${c.cli} ${c.args.join(' ')}` : '';
}

// #79: what to do when git has no credentials for an HTTPS remote
function httpsFix(platform) {
  const command = setupGitText(platform);
  return command
    ? `Run \`${command}\` so git pushes with the ${platform.cli} login, or set the remote to its SSH URL.`
    : `Configure a git credential helper for ${platform.host}, or set the remote to its SSH URL.`;
}

// #79: the platform CLI's git protocol for a host (`gh config get git_protocol`): 'ssh' | 'https', null when
// unknown (no CLI, it failed, a simulated run reads nothing from the machine)
function readGitProtocol(url) {
  const parsed = Platforms.parseRepoUrl(url);
  const platform = Platforms.platformOfRepoUrl(url);
  const r = platform?.protocolCommand && !simulationOnly() ? resolveCommand(platform.cli) : null;
  if (!r || !parsed) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(r.file, platform.protocolCommand(parsed.host).args, { timeout: 15000, windowsHide: true }, (err, stdout) => {
      const v = String(stdout || '').trim().toLowerCase();
      resolve(!err && (v === 'ssh' || v === 'https') ? v : null);
    });
  });
}

// #79: git's credential helper for an HTTPS URL's host (`git config --get-urlmatch credential.helper`), null when
// none is configured (a simulated run reads nothing from the machine)
function readCredentialHelper(url) {
  const parsed = Platforms.parseRepoUrl(url);
  if (!parsed || simulationOnly()) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('git', ['config', '--get-urlmatch', 'credential.helper', `https://${parsed.host}`], { timeout: 15000, windowsHide: true }, (err, stdout) => {
      resolve(!err && String(stdout || '').trim() ? String(stdout).trim() : null);
    });
  });
}

/**
 * #79: the URL to clone so runs can push: an HTTPS URL is cloned over SSH when the platform CLI's protocol is ssh
 * (git@host:path.git), as given with a credential helper; without one it is cloned as given but never silently:
 * { push: false, fix } names the command to run. An SSH URL, a local path or an unknown protocol: as given.
 * ghProtocol / credentialHelper: injected, else read from the machine (readGitProtocol / readCredentialHelper).
 * @returns {Promise<{ url: string, push?: false, fix?: string }>}
 */
async function pushableUrl(url, { ghProtocol, credentialHelper } = {}) {
  const parsed = /^https?:\/\//i.test(String(url || '').trim()) ? Platforms.parseRepoUrl(url) : null;
  if (!parsed) return { url };
  const protocol = ghProtocol === undefined ? await readGitProtocol(url) : ghProtocol;
  if (protocol === 'ssh') return { url: `git@${parsed.host}:${parsed.path}.git` };
  if (protocol !== 'https') return { url };
  const helper = credentialHelper === undefined ? await readCredentialHelper(url) : credentialHelper;
  return helper ? { url } : { url, push: false, fix: httpsFix(platformOfUrl(url)) };
}

/**
 * Ensures a local copy of `url` in <workspace>/repos. If already cloned, only fetches. #84: a folder taken by
 * something else clones into a free sibling (cloneFolder). #79: cloned with the URL that can push (pushableUrl);
 * `push: false` and its `fix` when it cannot.
 * @returns {Promise<{ dir: string, cloned: boolean, push?: false, fix?: string }>}
 */
async function cloneRepo(url, reposDir, { run = execGit, ghProtocol, credentialHelper } = {}) {
  const { dir, existing } = cloneFolder(url, reposDir);
  if (existing) return run(['fetch', '--all', '--prune'], dir).then(() => ({ dir, cloned: false }));
  fs.mkdirSync(reposDir, { recursive: true });
  const { url: cloneUrl, ...access } = await pushableUrl(url, { ghProtocol, credentialHelper });
  await run(['clone', cloneUrl, dir], reposDir);
  return { dir, cloned: true, ...access };
}

// #79: what to do about a refused push → { fix, setupGit? }: git's credentials over HTTPS (setupGit: the platform
// CLI's command that sets them, when it has one), the SSH key, else the account's rights
function pushFix(reason, origin) {
  const platform = platformOfUrl(origin);
  const command = setupGitText(platform);
  if (/could not read Username|terminal prompts disabled|Authentication failed|could not read Password/i.test(reason)) {
    return { fix: httpsFix(platform), ...(command ? { setupGit: { platform: platform.id, command } } : {}) };
  }
  if (/Permission denied \(publickey|Host key verification failed|no such identity/i.test(reason)) {
    const host = Platforms.parseRepoUrl(origin)?.host || platform.host;
    return { fix: `git's SSH key is not accepted by ${host}: add your SSH key to your account (test it with \`ssh -T git@${host}\`), or set the remote to its HTTPS URL${command ? ` and run \`${command}\`` : ''}.` };
  }
  return { fix: 'Check that your account may push to this repository (or fork it) and that the remote is reachable.' };
}

/**
 * #79: whether the clone in `dir` can push: `git push --dry-run <remote>` to a branch name nobody uses, without the
 * app's credential helper (gitAuthArgs), as the runs' agents push. Never rejects.
 * @returns {Promise<{ ok: boolean, reason?: string, fix?: string, setupGit?: { platform: string, command: string } }>}
 */
async function checkPushAccess(dir, { run = (args, cwd) => execGit(args, cwd, { auth: false, timeout: 60000 }), remote = 'origin' } = {}) {
  const origin = await Promise.resolve().then(() => run(['remote', 'get-url', remote], dir)).then((s) => String(s || '').trim(), () => '');
  try {
    await run(['push', '--dry-run', '--no-verify', remote, 'HEAD:refs/heads/craftorio-push-check'], dir);
    return { ok: true };
  } catch (e) {
    const reason = String(e?.message || e).trim();
    return { ok: false, reason, ...pushFix(reason, origin) };
  }
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
// #79: `auth` false leaves out the app's credential helper (gitAuthArgs): git as the runs' agents run it.
function execGit(args, cwd, { env: baseEnv = process.env, timeout = 0, auth = true } = {}) {
  const env = { ...baseEnv, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  return new Promise((resolve, reject) => {
    execFile('git', [...(auth ? gitAuthArgs() : []), ...args], { cwd, env, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT') reject(Object.assign(new Error('git was not found: install git and make sure it is on the PATH.'), { code: 'ENOENT' }));
      else if (err?.killed && timeout) reject(Object.assign(new Error(`git ${args[0]} timed out after ${Math.round(timeout / 1000)} s.`), { code: 'ETIMEDOUT' }));
      else if (err) reject(new Error(explainGitError(args, stderr || err.message)));
      else resolve(stdout);
    });
  });
}

module.exports = {
  checkPushAccess,
  cloneFolder,
  cloneRepo,
  DEFAULT_NAME,
  DEFAULT_SETTINGS,
  defaultStore,
  defaultWorkspace,
  ENV_VAR,
  execGit,
  existingDefaultWorkspace,
  fileStore,
  gitAuthArgs,
  isGitUrl,
  layout,
  LEGACY_DEFAULT_NAME,
  legacyDefaultWorkspace,
  pushableUrl,
  readSettings,
  registryStore,
  repoNameFromUrl,
  resolveWorkspace,
  sameRepo,
  savedSettings,
  setupWorkspace,
  simulationWorkspace,
  writeSettings,
};
