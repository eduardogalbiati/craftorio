// What the service's areas (packages/engine/service/areas/*.js) share without state: the bundled defaults'
// folders, small pure helpers (a session's view, why a session can't open in its CLI, folder
// matching) and the child-process calls they make (a tool's output, a git query).

const path = require('path');
const { execFileSync } = require('child_process');
const { childEnv, PLATFORM_CLIS } = require('../engine/child-env');
const {
  resolveCommand,
  withCliPath,
} = require('../engine/providers');
const { canonicalPath } = require('../engine/worktree');
const { execShim } = require('../domains/machine/shell');
const registry = require('@multiagent/shared/providers');
const sessionCache = require('../domains/session/session-cache');
const usage = require('../domains/usage/usage');
const workflows = require('../domains/workflow/workflows');
const { workerClient } = require('../domains/workspace/worker-client');

const { bundledDir } = require('../domains/workspace/app-root');

// the engine package's root (its domains/, engine/, service/ folders)
const SRC = path.join(__dirname, '..');
// Bundled defaults (read-only in the packaged app): only a seed source for the workspace copies.
const BUNDLED_WORKFLOWS_DIR = workflows.BUNDLED_WORKFLOWS_DIR;
const BUNDLED_SKILLS_DIR = bundledDir('skills');

// The arguments that reopen a CLI session of a provider type (its adapter's), or null.
const resumeArgsOf = (type) => registry.byType(type)?.resumeArgs || null;
const q = (a) => `"${String(a).replace(/"/g, '""')}"`;
const num = (v) => (v === '' || v == null || !Number.isFinite(+v) || +v <= 0 ? null : +v);

// Details for the Settings screen: path, version and (gh) authentication of each CLI. Started from
// a worker thread (#389, packages/engine/domains/machine/tool-worker.js): starting a CLI can block the starting thread for
// seconds on Windows; here, if the worker cannot start.
const toolWorker = workerClient(path.join(SRC, 'domains', 'machine', 'tool-worker.js'));
function runTool(file, args, env = {}) {
  const opts = { windowsHide: true, timeout: 15000, env: { ...process.env, ...env } };
  const here = () => new Promise((resolve) => {
    execShim(file, args, opts, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() }));
  });
  try { return toolWorker({ file, args, opts }).catch(here); } catch { return here(); }
}

const gitOut = (cwd, args) => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
};
// A session in the same shape whether it comes from the live engine or from a run on disk.
// tokens: the breakdown plus `total` (as on the Usage screen), or null when the session has none.
function sessionView(x, live) {
  return {
    id: x.id, agent: x.agent, provider: x.provider, model: x.model, status: x.status,
    providerSessionId: live ? x.providerSessionId : x.provider_session_id || null,
    cwd: x.cwd || null, turns: x.turns || 0, costUsd: live ? x.costUsd : x.cost_usd || 0,
    tokens: tokensView(x.tokens),
    // #233: the part of costUsd estimated from attempts stopped before their result; one not recorded
    ...((live ? x.estimatedUsd : x.estimated_cost_usd) ? { costEstimatedUsd: live ? x.estimatedUsd : x.estimated_cost_usd } : {}),
    ...((live ? x.costNotRecorded : x.cost_not_recorded) ? { costNotRecorded: true } : {}),
    // #369: a model Claude Code does not know: { source: 'tokens' | 'unknown', model, cli_version, cli_cost_usd }
    ...((live ? x.costEstimate : x.cost_estimate) ? { costEstimate: live ? x.costEstimate : x.cost_estimate } : {}),
    // #262: a simulated session's workflow provider, and the provider · model it fell back from ({ from, reason })
    ...(x.simulates ? { simulates: x.simulates } : {}),
    ...((live ? x.fallbackFrom : x.fallback_from) ? { fallbackFrom: live ? x.fallbackFrom : x.fallback_from } : {}),
    // #312: the name of the provider account the session runs on
    ...(x.account ? { account: x.account } : {}),
    // #320: the prompt-cache state of a snapshot and its next turn now (packages/engine/domains/session/session-cache.js)
    ...(live ? {} : cacheView(x)),
  };
}

function cacheView(x) {
  if (x.agent === 'orchestrator') return {};
  return {
    mode: x.mode || null, lastTurnAt: x.last_turn_at || null, contextTokens: x.context_tokens ?? null,
    hasNote: !!x.has_note, freshAfterIdleMs: x.fresh_after_idle_ms ?? null,
    ...(x.cache_lifetime_ms !== undefined ? { cacheLifetimeMs: x.cache_lifetime_ms } : {}),
    ...(x.start_context_tokens ? { startContextTokens: x.start_context_tokens } : {}),
    ...(x.cold_resume_usd ? { coldResumeUsd: x.cold_resume_usd } : {}),
    ...(x.rotate_pending ? { rotatePending: true } : {}),
    nextTurn: sessionCache.nextTurn(x),
  };
}

function tokensView(t) {
  if (!t || typeof t !== 'object') return null;
  const n = (v) => (Number.isFinite(+v) ? +v : 0);
  const out = { input: n(t.input), output: n(t.output), cache_read: n(t.cache_read), cache_write: n(t.cache_write), reasoning: n(t.reasoning) };
  out.total = usage.totalTokens(out);
  return out;
}

// Why "Open in CLI" is not possible for a session ('' = possible).
function cliReason(sess, providers, running) {
  if (sess.agent === 'orchestrator') return 'The orchestrator is the app itself: only its live log can be opened.';
  if (sess.provider === 'mock') return 'Simulated sessions have no CLI conversation.';
  if (!sess.providerSessionId) return 'No provider conversation yet: the first turn has not finished.';
  if (running && (sess.status === 'active' || sess.status === 'retrying')) return 'The agent is in the middle of a turn.';
  const cfg = providers[sess.provider];
  if (!cfg || !resumeArgsOf(cfg.type)) return `Provider "${sess.provider}" cannot be opened interactively.`;
  if (!resolveCommand(cfg.command)) return `Command "${cfg.command}" is not installed.`;
  return '';
}

// Whether a folder is (inside) another, compared canonically (8.3 names, symlinks), memoized.
function folderMatcher() {
  const memo = new Map();
  const canon = (p) => {
    if (!memo.has(p)) memo.set(p, canonicalPath(p).toLowerCase());
    return memo.get(p);
  };
  return (dir, root) => {
    if (!dir || !root) return false;
    const a = canon(dir), b = canon(root);
    return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
  };
}

// #333: the input guards of the channels. A client (the desktop app over IPC, any machine with the
// token over `npm run serve`) sends anything: a channel checks what it receives where it receives
// it. A refusal is an Error with status 400 naming the parameter (the server answers it as a 4xx),
// never a TypeError from deep inside an area.
const MAX_ID = 200;
const clientError = (message) => Object.assign(new Error(message), { status: 400 });
// A value in an error message: short, on one line.
const shown = (v) => {
  const s = typeof v === 'string' ? JSON.stringify(v.length > 60 ? `${v.slice(0, 60)}…` : v) : Array.isArray(v) ? 'a list' : v === null ? 'null' : typeof v;
  return s.replace(/[\r\n]/g, ' ');
};
const missing = (v) => (v == null || v === '' ? 'Missing' : 'Invalid');

// An id is a file name inside its folder: a non-empty string without a separator, `.`/`..` or NUL,
// so a path built from it never leaves the folder. Returns it unchanged.
function requireId(value, what) {
  if (typeof value !== 'string' || !value) throw clientError(`${missing(value)} ${what}: expected a name, got ${shown(value)}.`);
  if (value.length > MAX_ID) throw clientError(`Invalid ${what}: longer than ${MAX_ID} characters.`);
  if (value === '.' || value === '..' || /[\\/\0]/.test(value) || path.isAbsolute(value) || path.basename(value) !== value) {
    throw clientError(`Invalid ${what}: ${shown(value)} is not a name inside its folder.`);
  }
  return value;
}

// A string of at most `max` characters. Returns it unchanged.
function requireText(value, what, max) {
  if (typeof value !== 'string') throw clientError(`${missing(value)} ${what}: expected text, got ${shown(value)}.`);
  if (value.length > max) throw clientError(`Invalid ${what}: longer than ${max} characters (${value.length}).`);
  return value;
}

// The one argument of a channel that takes an options object (`params: 'opts'`): none is {},
// anything but an object is refused.
function requireObject(value, what) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw clientError(`Invalid ${what}: expected an object, got ${shown(value)}.`);
  return value;
}

// The params that always name a folder or a file of the workspace (runs/<runId>/,
// projects/<projectId>.json, discovery/<projectId>/cards/<cardId>/): when given, each is an id.
const ID_PARAMS = {
  cardId: 'card id',
  projectId: 'project id',
  runId: 'run id',
};

// The argument of a channel whose manifest entry names its params (an array): an object, as the
// clients build it from the positional arguments (apps/desktop/host/preload.js payload). None at all is the
// object of a call without arguments; null, a list or a scalar is refused before the channel runs,
// and so is an ID_PARAMS value that is not a file name (none, null or '' is left to the channel:
// several take "no run" or "no project").
function requireArgs(arg, params) {
  if (!Array.isArray(params)) return arg;
  if (arg === undefined) return {};
  if (arg === null || typeof arg !== 'object' || Array.isArray(arg)) {
    throw clientError(`Invalid argument: expected an object with ${params.map((p) => p.replace(/^\.\.\./, '')).join(', ')}, got ${shown(arg)}.`);
  }
  for (const p of params) {
    if (Object.hasOwn(ID_PARAMS, p) && arg[p] != null && arg[p] !== '') requireId(arg[p], ID_PARAMS[p]);
  }
  return arg;
}

// The environment of a CLI or a shell started from the app (not nested in Claude Code, not as node),
// with the folders the CLI lookup searches on its PATH (#397). #470 (SEC-5): the allowlisted
// environment (packages/engine/engine/child-env.js) with the gh / glab tokens, so a user's gh still works there;
// the allowlist already leaves out CLAUDECODE and ELECTRON_RUN_AS_NODE.
const cliEnv = (platform = process.platform) => withCliPath(childEnv(process.env, { platforms: PLATFORM_CLIS }), platform);

module.exports = {
  BUNDLED_SKILLS_DIR,
  BUNDLED_WORKFLOWS_DIR,
  clientError,
  cliEnv,
  cliReason,
  folderMatcher,
  gitOut,
  num,
  q,
  requireArgs,
  requireId,
  requireObject,
  requireText,
  resumeArgsOf,
  runTool,
  sessionView,
  SRC,
  tokensView,
};
