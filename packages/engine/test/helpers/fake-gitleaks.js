// A fake gitleaks for the secret scan's tests (#49) and the small run state they use. Nothing here needs the
// code of #49 at load.
//
// The fake reads real git commits (`git log -p -U0 <log-opts>`) for PLANTED values, honours .gitleaksignore
// (# comments, commit:file:rule:line and file:rule:line) and the `paths` allowlist of .gitleaks.toml, and writes
// the JSON report of gitleaks 8.30: the value is in Match and Secret unless --redact, and on stdout with -v.
// PLANTED values are built at run time and look like no real token, so no scanner reports these test files.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PREFIX = 'zqleak49';
const RULE = 'fake-token';
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const FILES = {
  feature: 'workflows/feature.yaml',
  fix: 'workflows/fix.yaml',
  release: 'workflows/release.yaml',
  'local hero': '.craftorio/workflows/ai-development-local-hero.yaml',
  'remote hero': '.craftorio/workflows/ai-development-remote-hero.yaml',
};

// no user git config (identity, hooks, aliases), as on CI
function plainGit() {
  const config = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-49-')), 'config');
  fs.writeFileSync(config, '');
  process.env.GIT_CONFIG_GLOBAL = config;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
}
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmp(t, name) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `secret-scan-${name}-`)));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 }); } catch { /* left in tmp */ } });
  return dir;
}
function write(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}
// commits those files; → the commit's hash
function commit(dir, message, files) {
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}
const planted = () => `${PREFIX}${crypto.randomBytes(8).toString('hex')}`;

// ---- the program -------------------------------------------------------------------------------

/* c8 ignore start: the source of the fake program */
function program(settings) {
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const VALUES = { s: 'source', source: 'source', 'log-opts': 'log', r: 'report', 'report-path': 'report', f: 'format', 'report-format': 'format', 'exit-code': 'exit', c: 'config', config: 'config', i: 'ignore', 'gitleaks-ignore-path': 'ignore' };
  const SKIPPED = ['b', 'baseline-path', 'l', 'log-level', 'max-archive-depth', 'max-decode-depth', 'max-target-megabytes', 'platform', 'timeout', 'enable-rule', 'report-template'];
  const opts = { words: [], redact: false, verbose: false };
  const args = process.argv.slice(2);
  fs.appendFileSync(settings.log, `${JSON.stringify(args)}\n`);
  for (let i = 0; i < args.length; i++) {
    const m = /^--?([^=]+)(?:=([\s\S]*))?$/.exec(args[i]);
    if (!args[i].startsWith('-') || args[i] === '-' || !m) { opts.words.push(args[i]); continue; }
    const [, name, inline] = m;
    if (VALUES[name] || SKIPPED.includes(name)) opts[VALUES[name] || name] = inline ?? args[++i];
    else if (name === 'redact') opts.redact = inline !== '0';
    else if (name === 'v' || name === 'verbose') opts.verbose = inline !== 'false';
    else if (name === 'version') opts.words.unshift('version');
  }
  const [command, target] = opts.words;
  if (command === 'version') { console.log('8.30.1'); process.exit(0); }
  if (command !== 'git' && command !== 'detect') { console.error(`Error: unknown command "${command}" for "gitleaks"`); process.exit(126); }
  const report = (text) => { if (opts.report === '-') process.stdout.write(text); else if (opts.report) fs.writeFileSync(opts.report, text); };
  if (settings.mode === 'error') { console.error('FTL unable to load gitleaks config'); process.exit(1); }
  if (settings.mode === 'partial') { report('[]\n'); console.error('ERR failed to scan Git repository\nWRN partial scan completed in 1ms'); process.exit(1); }
  if (settings.mode === 'garbled') { report('{ not json'); process.exit(1); }

  const source = path.resolve(opts.source || target || '.');
  const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
  const given = path.resolve(opts.ignore || '.');
  const ignored = new Set([given, path.join(given, '.gitleaksignore'), path.join(source, '.gitleaksignore')]
    .flatMap((f) => read(f).split(/\r?\n/)).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  const allowed = [...read(opts.config || path.join(source, '.gitleaks.toml')).matchAll(/'''([\s\S]+?)'''/g)].map((m) => new RegExp(m[1]));

  const range = opts.log ? opts.log.trim().split(/\s+/).map((w) => w.replace(/^["']|["']$/g, '')) : ['--full-history', '--all'];
  let text;
  try {
    text = execFileSync('git', ['-C', source, 'log', '-p', '-U0', '--no-color', '--no-ext-diff', ...range], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (e) { report('[]\n'); console.error(`ERR [git] ${e.message.split('\n')[0]}\nWRN partial scan completed in 1ms`); process.exit(1); }

  const found = [];
  let sha = '';
  let file = '';
  let line = 0;
  for (const l of text.split('\n')) {
    const at = /^commit ([0-9a-f]{40})/.exec(l);
    const hunk = /^@@ -\S+ \+(\d+)/.exec(l);
    if (at) { sha = at[1]; file = ''; } else if (l.startsWith('+++ ')) file = l.slice(4).replace(/^b\//, '').trim();
    else if (hunk) line = Number(hunk[1]);
    else if (l.startsWith('+') && file) {
      for (const m of l.matchAll(new RegExp(settings.pattern, 'g'))) {
        const short = `${file}:${settings.rule}:${line}`;
        const fingerprint = `${sha}:${short}`;
        if (ignored.has(short) || ignored.has(fingerprint) || allowed.some((re) => re.test(file))) continue;
        const shown = (v) => (opts.redact ? 'REDACTED' : v);
        found.push({
          RuleID: settings.rule, Description: 'A planted test value.', StartLine: line, EndLine: line, StartColumn: 2, EndColumn: 30,
          Match: shown(l.slice(1)), Secret: shown(m[0]), File: file, SymlinkFile: '', Commit: sha, Entropy: 3.5,
          Author: 't', Email: 't@t', Date: '2026-11-24T00:00:00Z', Message: 'm', Tags: [], Fingerprint: fingerprint,
        });
      }
      line++;
    }
  }
  if (opts.verbose) for (const f of found) console.log(`Finding: ${f.Match}\nSecret: ${f.Secret}\nFile: ${f.File}\nLine: ${f.StartLine}\nCommit: ${f.Commit}`);
  report(`${JSON.stringify(found, null, 1)}\n`);
  console.error(found.length ? `WRN leaks found: ${found.length}` : 'INF no leaks found');
  process.exit(found.length ? Number(opts.exit ?? 1) : 0);
}
/* c8 ignore stop */

// ---- the machine: with gitleaks, or without it --------------------------------------------------

function setEnv(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const before = process.env[key];
    const put = (v) => { if (v === undefined) delete process.env[key]; else process.env[key] = v; };
    put(value);
    t.after(() => put(before));
  }
}
// the login shell's PATH is merged once, at the first lookup, and would go before the test's
const mergeLoginPath = () => require('../../engine/providers').resolveCommand('git');

// the fake gitleaks first on PATH; mode: scan | error (no report) | partial (an error after an empty report) |
// garbled (a report that is not JSON). → calls(): the arguments of each call, version probes left out
function installGitleaks(t, { mode = 'scan' } = {}) {
  mergeLoginPath();
  const bin = tmp(t, 'bin');
  const log = path.join(bin, 'calls.log');
  fs.writeFileSync(log, '');
  const settings = { log, mode, rule: RULE, pattern: `${PREFIX}[0-9a-f]{16}` };
  fs.writeFileSync(path.join(bin, 'gitleaks'), `#!/usr/bin/env node\n(${program.toString()})(${JSON.stringify(settings)});\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'gitleaks.cmd'), '@echo off\r\nnode "%~dp0gitleaks" %*\r\n');
  setEnv(t, { PATH: `${bin}${path.delimiter}${process.env.PATH}`, CRAFTORIO_E2E_CLI_MISSING: undefined });
  return { calls: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((a) => !/version/.test(a[0] || '')) };
}

// a machine without gitleaks, whatever this one has
function removeGitleaks(t) {
  mergeLoginPath();
  const dirs = process.env.PATH.split(path.delimiter).filter(Boolean);
  if (process.platform === 'win32') {
    const has = (d) => { try { return fs.readdirSync(d).some((n) => /^gitleaks\b/i.test(n)); } catch { return false; } };
    setEnv(t, { PATH: dirs.filter((d) => !has(d)).join(path.delimiter), CRAFTORIO_E2E_CLI_MISSING: 'gitleaks' });
    return;
  }
  // only what the engine needs, and a home with no ~/.local/bin
  const bin = tmp(t, 'few');
  for (const name of ['git', 'node', 'sh', 'bash', 'env', 'npm', 'uname', 'sed', 'basename', 'dirname']) {
    const dir = dirs.find((d) => fs.existsSync(path.join(d, name)));
    if (dir) fs.symlinkSync(path.join(dir, name), path.join(bin, name));
  }
  setEnv(t, { PATH: bin, HOME: tmp(t, 'home'), CRAFTORIO_E2E_CLI_MISSING: 'gitleaks' });
}

// ---- workflows and runs -------------------------------------------------------------------------

const load = (name) => require('../../engine/workflow').loadWorkflow(path.join(ROOT, ...FILES[name].split('/')));
const defaults = (wf) => Object.fromEntries(Object.entries(wf.inputs || {}).map(([k, v]) => [k, v && v.default !== undefined ? v.default : '']));
function scanStep(wf, name) {
  const steps = wf.steps.filter((s) => s.type === 'secret_scan');
  if (steps.length !== 1) throw new Error(`${FILES[name]} has ${steps.length} \`type: secret_scan\` steps, expected 1`);
  return steps[0];
}
// the input that turns the scan off: → { name, def, off }
function offInput(wf, name) {
  const entry = Object.entries(wf.inputs || {}).find(([k]) => /secret/.test(k));
  if (!entry) throw new Error(`${FILES[name]} has no input to turn the secret scan off`);
  return { name: entry[0], def: entry[1], off: entry[1].type === 'boolean' ? false : 'off' };
}

// a repository on main pushed to its origin, and the run's worktree on a branch; → { repo, dir, origin }
function project(t, base = {}) {
  const repo = tmp(t, 'repo');
  const origin = tmp(t, 'origin');
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'init', '-q', '-b', 'main');
  commit(repo, 'base', { 'src/app.txt': 'the app\n', ...base });
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  const dir = path.join(tmp(t, 'worktrees'), 'run-49');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature-49', dir, 'main');
  return { repo, dir, origin };
}

// the secret_scan step of a bundled workflow in that worktree; → { wf, step, out, ctx, events, runDir }
async function scan(t, name, where, { inputs = {}, steps = {}, remote = name === 'remote hero' } = {}) {
  const { WorkflowRun } = require('../../engine/workflow');
  const wf = load(name);
  const step = scanStep(wf, name);
  if (typeof WorkflowRun.prototype.runSecretScanStep !== 'function') throw new Error('WorkflowRun has no runSecretScanStep (type: secret_scan)');
  const runDir = path.join(tmp(t, 'runs'), 'run-49');
  fs.mkdirSync(path.join(runDir, 'logs'), { recursive: true });
  const events = [];
  const { dir, repo } = where;
  const ctx = {
    worktree_dir: dir, run_dir: runDir, run_id: 'run-49', vars: {}, previous_step: 'develop', trail: [], steps,
    inputs: { ...defaults(wf), task: 'Add the widgets', repo_path: repo, base_branch: 'main', ...inputs },
  };
  const state = Object.assign(Object.create(WorkflowRun.prototype), {
    mock: false, machine: { simulated: false }, runDir, runId: 'run-49', worktreesDir: null, inputs: ctx.inputs, wf, ctx, abort: new AbortController(),
    worktree: { dir, workDir: dir, repo, base: 'main', branch: 'feature-49', remote },
    emitEvent: (type, data) => events.push({ type, ...data }),
  });
  const out = await state.runSecretScanStep(step, { visits: 1 });
  return { wf, step, out, ctx, events, runDir };
}

// every text a run leaves in a folder
function textIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile()).map((e) => fs.readFileSync(path.join(e.parentPath || e.path, e.name), 'utf8')).join('\n');
}

module.exports = {
  FILES,
  ROOT,
  RULE,
  commit,
  defaults,
  git,
  installGitleaks,
  load,
  offInput,
  plainGit,
  planted,
  project,
  removeGitleaks,
  scan,
  scanStep,
  textIn,
  tmp,
};
