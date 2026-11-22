// Shared by test/worktree.test.js and test/slow/worktree-engine.slow.test.js (#305): throwaway
// repositories in os.tmpdir() with a local bare repository as `origin` (no network), spelled in
// every way this machine has, and an empty git config. Registers no test (test/test-suite-layout-305-306.test.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.05';
// No user git config (identity, hooks, aliases), as on CI: a local user.name must not hide a
// production git call that needs one.
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

// identity and default branch fixed here: nothing depends on the machine's git setup
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function commit(cwd, file, text, msg = file) {
  fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}

/** Windows 8.3 short name of an existing folder, or null (other OS, or 8.3 names disabled on the volume). */
function shortPath(dir) {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('cmd.exe', ['/d', '/s', '/c', `for %I in ("${dir}") do @echo %~sI`], { windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out && out.toLowerCase() !== dir.toLowerCase() && fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * A folder in os.tmpdir() spelled in a non-canonical way:
 * 'link' = through a symlink/junction, 'short' = 8.3 short name (Windows; null when unavailable),
 * 'canonical' = the real path.
 */
function scratch(t, spelling = 'link') {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 }));
  const real = path.join(base, 'fixture-with-a-long-name');
  fs.mkdirSync(real);
  if (spelling === 'canonical') return real;
  if (spelling === 'short') return shortPath(real);
  const link = path.join(base, 'linked');
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  return link;
}

// origin (bare) + repo (the workspace clone) + other (someone else pushing to origin)
function fixture(t, spelling = 'link') {
  const tmp = scratch(t, spelling);
  if (!tmp) return null;
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  const other = path.join(tmp, 'other');
  git(tmp, 'init', '-q', '--bare', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'checkout', '-q', '-b', 'main');
  commit(repo, 'a.txt', 'a\n', 'init');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(tmp, 'clone', '-q', '-b', 'main', origin, other);
  return { tmp, origin, repo, other, worktrees: path.join(tmp, 'worktrees') };
}

// Path tests run with every spelling this machine has (8.3 names only on Windows volumes that keep them).
const SPELLINGS = ['canonical', 'link', 'short'];
// null (and the test skipped) when this machine has no such spelling
const spelled = (t, spelling) => {
  const f = fixture(t, spelling);
  if (!f) t.skip(`no ${spelling} path spelling on this machine`);
  return f;
};

const logger = () => {
  const lines = [];
  const log = (level, message) => lines.push(`${level}: ${message}`);
  return { lines, log };
};

// The run folder of an ended run, as a previous app session left it. summary: null = no summary
// (interrupted); owner: an owner.json; events: extra events after workflow.started.
function endedRun(runsDir, name, { summary = null, owner = null, events = [] } = {}) {
  const runDir = path.join(runsDir, name);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), [{ ts: new Date().toISOString(), type: 'workflow.started', workflow: 'fixture' }, ...events].map((e) => JSON.stringify(e)).join('\n') + '\n');
  if (summary) fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ run_id: name, ...summary }));
  if (owner) fs.writeFileSync(path.join(runDir, 'owner.json'), JSON.stringify(owner));
  return runDir;
}

const runEvents = (runDir) => fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// a folder (and its worktree's git index, when it has one) last used `days` ago
function age(dir, days, runDir) {
  const when = (Date.now() - days * 864e5) / 1000;
  if (runDir) fs.utimesSync(path.join(runDir, 'events.jsonl'), when, when);
  try {
    const index = path.resolve(dir, git(dir, 'rev-parse', '--git-path', 'index'));
    fs.utimesSync(index, when, when);
  } catch { /* not a worktree */ }
  fs.utimesSync(dir, when, when);
}

module.exports = {
  age,
  commit,
  endedRun,
  fixture,
  git,
  logger,
  runEvents,
  scratch,
  shortPath,
  spelled,
  SPELLINGS,
};
