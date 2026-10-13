// The git facts of a project's Architecture tab (#356), read-only: the default branch's current
// commit (origin's default branch, then main or master, then HEAD; never the checked-out branch),
// the files tracked there with their line counts (`git grep -c` at that commit, binary files
// skipped, so .gitignored files never count), `git log <commit> --no-merges -M --name-status`,
// .git-blame-ignore-revs and .gitattributes at that commit, and whether the clone is shallow. The
// numbers come from the pure core (src/shared/architecture-model.js buildModel), cached per commit,
// window, exclude list and mass-change toggle.
// Complexity only from a real tool (lizard, the fallback for any language, when the machine has
// it) and only when the checkout is at that commit; its output is checked (core checkComplexity)
// and a failed check is shown, never hidden. Without a tool the model names the tools needed.
// The project's own quality gate (complexity, coverage, duplication in its CI or package.json) is
// listed with each input measured (its own report found), pending (configured, no report) or
// missing; missing evidence is never shown as clean.
// The project city (#371, readCity): the facts and a city plan through the pure core
// src/shared/city-model.js, with the edges' sources read at the same commit (the tracked files, the
// relative require/import lines of JavaScript/TypeScript files in one `git grep`, the Cargo.toml
// files), cached per facts read (a refresh rebuilds it) and plan hash. Used by src/service/channels/architecture.js.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const {
  buildModel,
  checkComplexity,
  DEFAULT_EXCLUDES,
  parseIgnoreRevs,
} = require('./shared/architecture-model');
const { buildCity } = require('./shared/city-model');
const { resolveCommand } = require('./engine/providers');

const GIT_TIMEOUT_MS = 120e3;
const TOOL_TIMEOUT_MS = 300e3;
const MAX_BUFFER = 1 << 28;
const CACHE_SIZE = 20;
const DEFAULT_BRANCHES = ['main', 'master'];
const CI_FILES = /^(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml|azure-pipelines\.yml|package\.json|Makefile)$/;
const GATE_INPUTS = {
  complexity: /code-health|complexity|lizard|radon|gocyclo/i,
  coverage: /coverage|\bc8\b|\bnyc\b|--cov\b|jacoco/i,
  duplication: /jscpd|duplicat|\bcpd\b|code-health(\.js)? --check/i,
};

const JS_SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const JS_PATHSPECS = ['*.js', '*.cjs', '*.mjs', '*.jsx', '*.ts', '*.cts', '*.mts', '*.tsx'];

const cache = new Map();
// facts model -> Map(plan key -> city): a city lives as long as the facts it was built from
// (a refresh or an uncached read gives new facts, so a new city)
const cityCache = new WeakMap();

function run(file, args, cwd, timeout = GIT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, timeout, windowsHide: true, maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(file)} ${args[0]} failed: ${String(stderr || err.message).trim()}`));
      else resolve(String(stdout));
    });
  });
}
const git = (cwd, args) => run('git', ['-c', 'core.quotepath=off', ...args], cwd);
const tryGit = (cwd, args) => git(cwd, args).catch(() => null);

// The default branch: { branch, ref }, or null (no commit at all)
async function defaultBranch(folder) {
  const origin = (await tryGit(folder, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']) || '').trim();
  const names = [...new Set([origin.replace(/^refs\/remotes\/origin\//, ''), ...DEFAULT_BRANCHES].filter(Boolean))];
  for (const name of names) {
    if (await tryGit(folder, ['rev-parse', '--verify', '-q', `refs/heads/${name}^{commit}`])) return { branch: name, ref: `refs/heads/${name}` };
    if (await tryGit(folder, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${name}^{commit}`])) return { branch: name, ref: `refs/remotes/origin/${name}` };
  }
  const current = (await tryGit(folder, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim();
  return (await tryGit(folder, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'])) ? { branch: current || 'HEAD', ref: 'HEAD' } : null;
}

// [{ path, lines }] of the text files at `commit`
async function filesAt(folder, commit) {
  const out = await tryGit(folder, ['grep', '-I', '-c', '-e', '', commit, '--']);
  const files = [];
  for (const line of String(out || '').split('\n')) {
    const rest = line.slice(commit.length + 1);
    const at = rest.lastIndexOf(':');
    if (at > 0) files.push({ path: rest.slice(0, at), lines: Number(rest.slice(at + 1)) || 0 });
  }
  return files;
}

const showAt = (folder, commit, file) => tryGit(folder, ['show', `${commit}:${file}`]).then((t) => t || '');

// One CSV line of lizard (quoted fields with "" escapes)
function csvFields(line) {
  const out = [];
  const re = /("((?:[^"]|"")*)"|[^,]*)(,|$)/g;
  let m;
  while ((m = re.exec(line)) && m[0] !== '') {
    out.push(m[2] !== undefined ? m[2].replace(/""/g, '"') : m[1]);
    if (!m[3]) break;
  }
  return out;
}

// lizard --csv: NLOC, CCN, token, PARAM, length, location, file, function, long name, start, end
function parseLizard(text) {
  const functions = [];
  for (const line of text.split(/\r?\n/)) {
    const c = csvFields(line);
    if (c.length < 10 || !/^\d+$/.test(c[1])) continue;
    functions.push({ file: c[6].replace(/\\/g, '/').replace(/^\.\//, ''), name: c[7], line: Number(c[c.length - 2]) || 0, complexity: Number(c[1]), length: Number(c[4]) || 0 });
  }
  return functions;
}

// { tool, metric, functions, check } measured at the checkout, or { status, reason } (missing / failed)
async function measureComplexity(folder, commit) {
  const lizard = resolveCommand('lizard');
  if (!lizard) return { status: 'missing', reason: 'lizard is not installed (pip install lizard)' };
  const checkedOut = (await tryGit(folder, ['rev-parse', 'HEAD']) || '').trim();
  if (checkedOut !== commit) return { status: 'missing', reason: 'the checkout is not at the default branch\'s commit: complexity is measured on the files on disk' };
  const skip = [...DEFAULT_EXCLUDES.build, ...DEFAULT_EXCLUDES.vendored].filter((p) => p.endsWith('/')).flatMap((p) => ['-x', `./${p}*`]);
  try {
    const functions = parseLizard(await run(lizard.file, ['--csv', ...skip, '.'], folder, TOOL_TIMEOUT_MS));
    const check = checkComplexity(functions);
    if (!check.ok) return { status: 'failed', reason: `lizard's output failed its check: ${check.problems.join('; ')}` };
    return { tool: 'lizard', metric: 'cyclomatic', functions, check };
  } catch (e) {
    return { status: 'failed', reason: e.message };
  }
}

// The project's own gate: [{ name, state, source, value }]
async function qualityGate(folder, commit, files) {
  const sources = files.map((f) => f.path).filter((p) => CI_FILES.test(p)).sort();
  const texts = await Promise.all(sources.map(async (p) => [p, await showAt(folder, commit, p)]));
  const has = (p) => files.some((f) => f.path === p);
  const inputs = [];
  for (const [name, re] of Object.entries(GATE_INPUTS)) {
    const where = texts.filter(([, t]) => re.test(t)).map(([p]) => p);
    if (name !== 'coverage' && has('scripts/code-health.js')) where.push('node scripts/code-health.js --check');
    let value = null;
    if (name === 'coverage') {
      try {
        const summary = JSON.parse(fs.readFileSync(path.join(folder, 'coverage', 'coverage-summary.json'), 'utf8'));
        value = summary.total && summary.total.lines ? `${summary.total.lines.pct}% of lines` : null;
      } catch { /* no report */ }
    }
    inputs.push({ name, state: value ? 'measured' : where.length ? 'pending' : 'missing', source: [...new Set(where)].join(', ') || null, value });
  }
  return inputs;
}

/**
 * The facts of the repository in `folder`: { state: 'ok' | 'not-git' | 'no-commits', model, gate }.
 * opts: { since, until, exclude: [pattern], includeMass }.
 */
async function readFacts(folder, opts = {}) {
  // the folder's own repository (.git: a folder, or a file in a worktree), never an enclosing one
  if (!folder || !fs.existsSync(path.join(folder, '.git'))) return { state: 'not-git', model: null, gate: [] };
  const target = await defaultBranch(folder);
  if (!target) return { state: 'no-commits', model: null, gate: [] };
  const commit = (await git(folder, ['rev-parse', `${target.ref}^{commit}`])).trim();
  const window = { since: opts.since || null, until: opts.until || null };
  const exclude = (opts.exclude || []).map(String).filter(Boolean);
  const includeMass = opts.includeMass !== false;
  const key = JSON.stringify([path.resolve(folder), commit, window, exclude, includeMass]);
  // Refresh reads again what the commit does not fix (a tool installed since, the checkout moved)
  if (opts.refresh) cache.delete(key);
  if (!cache.has(key)) {
    const [date, shallow, log, files, revs, attributes] = await Promise.all([
      git(folder, ['show', '-s', '--format=%cI', commit]),
      tryGit(folder, ['rev-parse', '--is-shallow-repository']),
      git(folder, ['log', commit, '--no-merges', '-M', '--name-status', '--format=%x01%H %cI']),
      filesAt(folder, commit),
      showAt(folder, commit, '.git-blame-ignore-revs'),
      showAt(folder, commit, '.gitattributes'),
    ]);
    const [complexity, gate] = await Promise.all([measureComplexity(folder, commit), qualityGate(folder, commit, files)]);
    const model = buildModel({
      head: { commit, date: date.trim() }, branch: target.branch, shallow: String(shallow).trim() === 'true',
      window, files, log, ignoreRevs: parseIgnoreRevs(revs), attributes, exclude, includeMass, complexity,
    });
    // no file read (git grep failed or timed out): shown, never kept for the commit
    if (!files.length) return { state: model.commits ? 'ok' : 'no-commits', model, gate };
    cache.set(key, { model, gate });
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  }
  const { model, gate } = cache.get(key);
  return { state: model.commits ? 'ok' : 'no-commits', model, gate };
}

// What the city's edges are read from at `commit`, in one pass each: { tracked: [path], imports:
// [{ from, text }] (the JavaScript/TypeScript lines that name a relative path, one `git grep`),
// manifests: { path: Cargo.toml text } }
async function citySources(folder, commit) {
  const tracked = String(await tryGit(folder, ['ls-tree', '-r', '--name-only', '-z', commit]) || '').split('\0').filter(Boolean).sort();
  const imports = [];
  if (tracked.some((p) => JS_SOURCE.test(p))) {
    const out = await tryGit(folder, ['grep', '-I', '-z', '-E', '-e', '[\'"]\\.\\.?/', commit, '--', ...JS_PATHSPECS]);
    for (const line of String(out || '').split('\n')) {
      const at = line.indexOf('\0');
      if (at < 0) continue;
      const from = line.slice(0, at).slice(commit.length + 1);
      if (JS_SOURCE.test(from)) imports.push({ from, text: line.slice(at + 1) });
    }
  }
  const cargo = tracked.filter((p) => p === 'Cargo.toml' || p.endsWith('/Cargo.toml'));
  const manifests = Object.fromEntries(await Promise.all(cargo.map(async (p) => [p, await showAt(folder, commit, p)])));
  return { imports, manifests, tracked };
}

/**
 * The project city (#371) of the repository in `folder`: { state, model, validation }, from the
 * facts (readFacts, with the project's exclusions) and the plan (null: folder districts), cached
 * per facts read and plan. opts: { exclude: [pattern], plan, planError (why the saved plan could
 * not be read) }.
 */
async function readCity(folder, opts = {}) {
  const exclude = (opts.exclude || []).map(String).filter(Boolean);
  const { state, model } = await readFacts(folder, { exclude });
  if (state !== 'ok') return { state, model: null, validation: null };
  const commit = model.head.commit;
  const plan = opts.plan || null;
  const planError = opts.planError || null;
  const planHash = plan ? crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex') : null;
  const key = JSON.stringify([planHash, planError]);
  if (!cityCache.has(model)) cityCache.set(model, new Map());
  const cities = cityCache.get(model);
  if (!cities.has(key)) {
    const sources = await citySources(folder, commit);
    cities.set(key, buildCity({ plan, facts: model, tracked: sources.tracked, sources, planError: planError || undefined }));
    if (cities.size > CACHE_SIZE) cities.delete(cities.keys().next().value);
  }
  return { state, ...cities.get(key) };
}

module.exports = {
  parseLizard,
  readCity,
  readFacts,
};
