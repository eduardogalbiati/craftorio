// What the service's areas (src/service/areas/*.js) share without state: the bundled defaults'
// folders, small pure helpers (a session's view, why a session can't open in its CLI, folder
// matching) and the child-process calls they make (a tool's output, a git query).

const path = require('path');
const { execFileSync } = require('child_process');
const { resolveCommand } = require('../engine/providers');
const { canonicalPath } = require('../engine/worktree');
const { execShim } = require('../shell');
const sessionCache = require('../session-cache');
const usage = require('../usage');
const workflows = require('../workflows');

const SRC = path.join(__dirname, '..');
const ROOT = path.join(SRC, '..');
// Bundled defaults (read-only in the packaged app): only a seed source for the workspace copies.
const BUNDLED_WORKFLOWS_DIR = workflows.BUNDLED_WORKFLOWS_DIR;
const BUNDLED_SKILLS_DIR = path.join(ROOT, 'skills');

const RESUME_ARGS = { 'claude-code': (id) => ['--resume', id], 'codex-cli': (id) => ['resume', id], 'grok-cli': (id) => ['--resume', id] };
const q = (a) => `"${String(a).replace(/"/g, '""')}"`;
const num = (v) => (v === '' || v == null || !Number.isFinite(+v) || +v <= 0 ? null : +v);

// Details for the Settings screen: path, version and (gh) authentication of each CLI.
function runTool(file, args) {
  return new Promise((resolve) => {
    execShim(file, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() }));
  });
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
    // #262: a simulated session's workflow provider, and the provider · model it fell back from ({ from, reason })
    ...(x.simulates ? { simulates: x.simulates } : {}),
    ...((live ? x.fallbackFrom : x.fallback_from) ? { fallbackFrom: live ? x.fallbackFrom : x.fallback_from } : {}),
    // #320: the prompt-cache state of a snapshot and its next turn now (src/session-cache.js)
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
  if (!cfg || !RESUME_ARGS[cfg.type]) return `Provider "${sess.provider}" cannot be opened interactively.`;
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

// The environment of a CLI or a shell started from the app (not nested in Claude Code, not as node).
const cliEnv = () => {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};

module.exports = {
  BUNDLED_SKILLS_DIR,
  BUNDLED_WORKFLOWS_DIR,
  cliEnv,
  cliReason,
  folderMatcher,
  gitOut,
  num,
  q,
  RESUME_ARGS,
  runTool,
  sessionView,
  SRC,
  tokensView,
};
