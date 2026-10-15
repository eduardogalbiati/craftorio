// The git facts of a project's Architecture tab (#356), read-only: the default branch's current
// commit (origin's default branch, then main or master, then HEAD; never the checked-out branch),
// the files tracked there with their line counts (`git grep -c` at that commit, binary files
// skipped, so .gitignored files never count), `git log <commit> --no-merges -M --name-status`,
// .git-blame-ignore-revs and .gitattributes at that commit, and whether the clone is shallow. The
// numbers come from the pure core (src/shared/architecture-model.js buildModel), cached per commit,
// window, exclude list and mass-change toggle.
// Complexity only from a real parser or tool: JavaScript and TypeScript inside the app (#385), at
// that commit (`git cat-file --batch`), with scripts/code-health.js's core
// (src/shared/code-complexity.js), no tool to install; the other languages from lizard when the
// machine has it and the checkout is at that commit; lizard's output is checked (core
// checkComplexity) and a failed check is shown, never hidden. The model names the code languages
// not measured, the tools they need and how to install lizard (`pip install lizard`).
// The project's own quality gate (complexity, coverage, duplication in its CI or package.json) is
// listed with each input measured (its own report found), pending (configured, no report) or
// missing; missing evidence is never shown as clean.
// The project city (#371, readCity): the facts (with the test files, its campus, #372) and a city plan through the pure core
// src/shared/city-model.js, with the edges' sources read at the same commit (the tracked files, the
// relative require/import lines of JavaScript/TypeScript files in one `git grep`, the Cargo.toml
// files), cached per facts read (a refresh rebuilds it) and plan hash. Used by src/service/channels/architecture.js.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  execFile,
  spawn,
} = require('child_process');
const {
  buildModel,
  checkComplexity,
  DEFAULT_EXCLUDES,
  globRe,
  parseIgnoreRevs,
} = require('./shared/architecture-model');
const { buildCity } = require('./shared/city-model');
const {
  measures,
  measureSource,
} = require('./shared/code-complexity');
const { resolveCommand } = require('./engine/providers');

const GIT_TIMEOUT_MS = 120e3;
const TOOL_TIMEOUT_MS = 300e3;
// a larger JavaScript file is a bundle, not code written by hand
const MAX_SOURCE_BYTES = 1 << 20;
const LIZARD_INSTALL = 'pip install lizard';
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
// folder and commit -> what was read there (readsAt), shared by every model of that commit
const readsCache = new Map();
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

// { path: text } of `paths` at `commit`, in one `git cat-file --batch`; a missing or too large
// file is left out (and so not measured)
function readBlobs(folder, commit, paths) {
  if (!paths.length) return Promise.resolve({});
  return new Promise((resolve) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd: folder, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    const timer = setTimeout(() => child.kill(), GIT_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', () => resolve({}));
    child.on('close', () => {
      clearTimeout(timer);
      resolve(parseBlobs(Buffer.concat(chunks), paths));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(paths.map((p) => `${commit}:${p}\n`).join(''));
  });
}

// `git cat-file --batch` output: per path `<sha> blob <size>\n<bytes>\n` or `<name> missing\n`
function parseBlobs(buffer, paths) {
  const texts = {};
  let at = 0;
  for (const p of paths) {
    const eol = buffer.indexOf(10, at);
    if (eol < 0) break;
    const [, type, size] = buffer.toString('utf8', at, eol).split(' ');
    at = eol + 1;
    if (type !== 'blob') continue;
    if (Number(size) <= MAX_SOURCE_BYTES) texts[p] = buffer.toString('utf8', at, at + Number(size));
    at += Number(size) + 1;
  }
  return texts;
}

// JavaScript and TypeScript measured inside the app at `commit` (#385), with code-health.js's core:
// { functions, files (the paths measured, with or without a function) }; a file that does not
// parse is not measured
async function measureInApp(folder, commit, files) {
  const skipped = [...DEFAULT_EXCLUDES.build, ...DEFAULT_EXCLUDES.vendored].map(globRe);
  const paths = files.map((f) => f.path).filter((p) => measures(p) && !skipped.some((re) => re.test(p)));
  const functions = [];
  const measured = [];
  for (const [file, text] of Object.entries(await readBlobs(folder, commit, paths))) {
    try {
      for (const f of measureSource(text, { file })) functions.push({ file, name: f.name, line: f.line, complexity: f.complexity, length: f.lines });
      measured.push(file);
    } catch { /* not measured */ }
  }
  return { functions, files: measured };
}

// The app's own measure (JavaScript, TypeScript) and lizard's for the other languages: { tool,
// metric, functions, files, check, reason, install } (reason / install: why lizard did not measure
// the other languages, and how to install it), or lizard's own result when the app measured nothing
async function measureComplexity(folder, commit, files) {
  const [own, lizard] = await Promise.all([measureInApp(folder, commit, files), measureLizard(folder, commit)]);
  if (!own.files.length) return lizard;
  const others = lizard.functions ? lizard.functions.filter((f) => !measures(f.file)) : [];
  const functions = [...own.functions, ...others];
  const tool = lizard.functions ? 'the app (JavaScript, TypeScript) and lizard' : 'the app (JavaScript, TypeScript)';
  return { tool, metric: 'cyclomatic', functions, files: own.files, check: checkComplexity(functions), reason: lizard.reason || null, install: lizard.install || null };
}

// lizard's { tool, metric, functions, check } measured at the checkout, or { status, reason,
// install } (missing / failed)
async function measureLizard(folder, commit) {
  const lizard = resolveCommand('lizard');
  if (!lizard) return { status: 'missing', reason: 'lizard is not installed', install: LIZARD_INSTALL };
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
 * opts: { since, until, exclude: [pattern], includeMass, includeTests (the city's: the test files
 * kept), refresh }.
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
  const includeTests = !!opts.includeTests;
  const commitKey = JSON.stringify([path.resolve(folder), commit]);
  const key = JSON.stringify([path.resolve(folder), commit, window, exclude, includeMass, includeTests]);
  // Refresh reads again what the commit does not fix (a tool installed since, the checkout moved):
  // every model of that commit, the city's (with the tests) included
  if (opts.refresh) {
    readsCache.delete(commitKey);
    for (const k of [...cache.keys()]) if (k.startsWith(`${commitKey.slice(0, -1)},`)) cache.delete(k);
  }
  if (!cache.has(key)) {
    const reads = await readsAt(folder, commit, commitKey);
    const model = buildModel({ ...reads.sources, head: { commit, date: reads.date }, branch: target.branch, window, exclude, includeMass, includeTests });
    // no file read (git grep failed or timed out): shown, never kept for the commit
    if (!reads.sources.files.length) return { state: model.commits ? 'ok' : 'no-commits', model, gate: reads.gate };
    cache.set(key, { model, gate: reads.gate });
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  }
  const { model, gate } = cache.get(key);
  return { state: model.commits ? 'ok' : 'no-commits', model, gate };
}

// The git reads and the complexity tool's of one commit, once for all its models (the hotspots'
// windows and the city's, #372): { date, gate, sources: buildModel's inputs read at the commit }
async function readsAt(folder, commit, commitKey) {
  if (readsCache.has(commitKey)) return readsCache.get(commitKey);
  const [date, shallow, log, files, revs, attributes] = await Promise.all([
    git(folder, ['show', '-s', '--format=%cI', commit]),
    tryGit(folder, ['rev-parse', '--is-shallow-repository']),
    git(folder, ['log', commit, '--no-merges', '-M', '--name-status', '--format=%x01%H %cI']),
    filesAt(folder, commit),
    showAt(folder, commit, '.git-blame-ignore-revs'),
    showAt(folder, commit, '.gitattributes'),
  ]);
  const [complexity, gate] = await Promise.all([measureComplexity(folder, commit, files), qualityGate(folder, commit, files)]);
  const reads = { date: date.trim(), gate, sources: { shallow: String(shallow).trim() === 'true', files, log, ignoreRevs: parseIgnoreRevs(revs), attributes, complexity } };
  if (files.length) {
    readsCache.set(commitKey, reads);
    if (readsCache.size > CACHE_SIZE) readsCache.delete(readsCache.keys().next().value);
  }
  return reads;
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
  // the city draws the tests (its campus, #372), which the hotspots leave out
  const { state, model } = await readFacts(folder, { exclude, includeTests: true });
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
