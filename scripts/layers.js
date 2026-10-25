// Layering rules (issue #345): the areas of src/ and the directions they may require each other.
// From the bottom: shared (src/shared/, pure dual-load modules) requires nothing of the app; the
// low-level utilities (ENGINE_ROOT_UTILITIES) only shared; the engine those two; the domain modules
// (src/domains/<name>/, phase 1 of docs/reorganisation-study-2026-10.md; a loose file at the root of
// src/ counts as one too) the engine too; the service all of these; the desktop entry and the server what is below
// them; the renderer only shared, and nothing else requires it. The desktop entry is src/host/ (phase 1
// of docs/reorganisation-study-2026-10.md): the Electron host, required by nothing else.
// Every relative `require` of every .js file under src/ is read, lazy ones (inside a function)
// included, comments skipped. A require is allowed when AREAS lets the requiring area reach the
// required one, or when EXCEPTIONS lists it with its reason. The exceptions may only shrink: one
// that no file has any more fails ('leave-list') until it leaves the list. A require cycle fails
// too, however its requires are written. Where a new module goes: docs/agents/code-map.md
// ("Where a new module goes"). Checked by test/layers-345.test.js.
//
//   node scripts/layers.js   report, exit 1 when a require breaks the rules

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// The low-level utilities the engine may require: domain files that require nothing but each other
// and src/shared/ (area `utility`). A domain file that needs more is a domain module (area `root`).
const ENGINE_ROOT_UTILITIES = [
  'src/domains/evidence/coverage-summary.js',
  'src/domains/evidence/evidence.js',
  'src/domains/evidence/result-summary.js',
  'src/domains/local/local-preview.js',
  'src/domains/machine/install-commands.js',
  'src/domains/machine/machine-profile.js',
  'src/domains/machine/platform-paths.js',
  'src/domains/machine/shell.js',
  'src/domains/run/run-owner.js',
  'src/domains/session/app-sessions.js',
  'src/domains/session/session-cache.js',
  'src/domains/workspace/json-schema.js',
  'src/domains/workspace/state-file.js',
];

// area -> the areas it may require (its own included) and what it holds. A file's area: areaOf.
const AREAS = {
  shared: { may: ['shared'], what: 'pure modules both sides use (dual-load: require and a renderer <script>)' },
  utility: { may: ['utility', 'shared'], what: 'the low-level files of ENGINE_ROOT_UTILITIES' },
  engine: { may: ['engine', 'utility', 'shared'], what: 'the workflow engine (src/engine/)' },
  root: { may: ['root', 'engine', 'utility', 'shared'], what: 'the domain modules (src/domains/<name>/, and any loose file at the root of src/)' },
  service: { may: ['service', 'root', 'engine', 'utility', 'shared'], what: 'the app\'s operations, no Electron and no transport (src/service/)' },
  desktop: { may: ['desktop', 'server', 'service', 'root', 'engine', 'utility', 'shared'], what: 'the Electron host (src/host/: main.js, the preloads, the windows and their guards)' },
  server: { may: ['server', 'service', 'root', 'utility', 'shared'], what: 'the HTTP server and the control channel (src/server/, src/control/)' },
  renderer: { may: ['renderer', 'shared'], what: 'the UI, loaded in the browser too (src/renderer/)' },
};

// The top-level folders of src/ and their area (domains: a domain module, or a utility when
// ENGINE_ROOT_UTILITIES lists the file, see areaOf). scripts/dep-map.js reads this list too.
const FOLDERS = { control: 'server', domains: 'root', engine: 'engine', host: 'desktop', renderer: 'renderer', server: 'server', service: 'service', shared: 'shared' };

// The area of a file (path from the repository root, with /), or null when no area holds it.
function areaOf(file) {
  const parts = file.split('/');
  if (parts[0] !== 'src' || parts.length < 2) return null;
  if (parts.length === 2 || parts[1] === 'domains') return ENGINE_ROOT_UTILITIES.includes(file) ? 'utility' : 'root';
  return FOLDERS[parts[1]] || null;
}

// Requires the table does not allow, each with why it stays for now. Only remove entries: a new
// direction moves the shared code down instead (docs/agents/code-map.md, "Where a new module goes").
const EXCEPTIONS = [
  { from: 'src/engine/machine-actions.js', to: 'src/domains/releases/releases.js', reason: 'the real machine adapter (#353) writes the release version (writeReleaseVersion) and pushes and tags the local base for a transition\'s `ship: { tag }` (shipRelease)' },
  { from: 'src/engine/run/costs.js', to: 'src/domains/night/night-limits.js', reason: 'the night\'s cost and run limits (#337) are checked at each turn; night-limits.js also reads the night watch\'s log and the run loader' },
  { from: 'src/engine/run/costs.js', to: 'src/domains/usage/usage.js', reason: 'the cost limits read the usage ledger of earlier runs (usage.js reads the runs list)' },
  { from: 'src/engine/run/machine-steps.js', to: 'src/domains/releases/release-city.js', reason: 'the release_version step names the release\'s previous tag (#378, release.yaml\'s previous_version) as the Release city tab does (previousTag)' },
  { from: 'src/engine/run/machine-steps.js', to: 'src/domains/releases/releases.js', reason: 'the release_version step tells a semver release name from another (releaseSemver) to pick its previous tag (#378)' },
  { from: 'src/engine/run/project-map-steps.js', to: 'src/domains/project/project-map.js', reason: 'the project map\'s machine steps (#372) read the project\'s city with its git facts (src/domains/project/architecture-facts.js readCity) and save its plan in the workspace (src/domains/oracle/oracle-architecture.js writePlan), as the Architecture tab\'s channels do' },
  { from: 'src/engine/run/refactor-proposals-steps.js', to: 'src/domains/refactor/refactor-proposals-run.js', reason: 'the Refactor proposals workflow\'s machine steps (#378) read the architecture facts and write the Refactor tab\'s proposals, ranking and issues in the workspace, as the Refactor tab\'s channels do' },
  { from: 'src/engine/run/sessions.js', to: 'src/domains/agents/skills.js', reason: 'a turn\'s prompt resolves its skills in the workspace and the project (skills.js reads the projects)' },
  { from: 'src/engine/run/sessions.js', to: 'src/domains/usage/usage.js', reason: 'totalTokens of the usage module counts a session\'s tokens' },
  { from: 'src/engine/run/setup.js', to: 'src/domains/agents/skills.js', reason: 'a run leaves out the agents\' skills that no longer exist (resolveSkill)' },
  { from: 'src/engine/run/supervision.js', to: 'src/domains/supervisor/supervisor.js', reason: 'the engine calls the AI supervisor when a step fails; supervisor.js uses the engine\'s providers' },
  { from: 'src/engine/run/turns.js', to: 'src/domains/usage/usage.js', reason: 'sessionCost of the usage module prices each turn' },
  { from: 'src/engine/workflow.js', to: 'src/domains/agents/skills.js', reason: 'the templates\' skill_dir(name) resolves a skill\'s folder (workspace first, then bundled)' },
  { from: 'src/engine/worktree.js', to: 'src/domains/workspace/workspace.js', reason: 'a lazy read of the workspace\'s git credentials (gitAuthArgs) for the worktree\'s git commands' },
];

const posix = (p) => p.split(path.sep).join('/');

function listJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : listJs(p);
    return e.isFile() && e.name.endsWith('.js') ? [p] : [];
  }).sort();
}

// The source with comments and regex literals blanked (strings and line breaks kept, so targets
// and lines survive). A / after an operator, an opening bracket or `return` starts a regex.
function withoutComments(src) {
  let out = '';
  let i = 0;
  let prev = '';
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//' || two === '/*') {
      const close = two === '//' ? src.indexOf('\n', i) : src.indexOf('*/', i + 2);
      const end = close < 0 ? src.length : close + (two === '//' ? 0 : 2);
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
      continue;
    }
    const c = src[i];
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      prev = '"';
      continue;
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$|return$/.test(prev)) {
      let j = i + 1;
      let cls = false;
      while (j < src.length && (cls || src[j] !== '/') && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        j++;
      }
      j++;
      while (/[a-z]/.test(src[j] || '')) j++;
      out += src.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      prev = '"';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = (/[\w$]/.test(c) && /[\w$]$/.test(prev) ? prev + c : c).slice(-6);
    i++;
  }
  return out;
}

function resolveLocal(fromAbs, target) {
  const base = path.resolve(path.dirname(fromAbs), target);
  for (const p of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

// Every relative require of a .js file under <root>/src: [{ from, to, line }], paths from root.
function requireGraph(root) {
  const edges = [];
  for (const abs of listJs(path.join(root, 'src'))) {
    const code = withoutComments(fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'));
    for (const m of code.matchAll(/\brequire\(\s*(['"])(\.[^'"]*)\1\s*\)/g)) {
      const to = resolveLocal(abs, m[2]);
      if (!to || !to.endsWith('.js')) continue;
      edges.push({ from: posix(path.relative(root, abs)), to: posix(path.relative(root, to)), line: code.slice(0, m.index).split('\n').length });
    }
  }
  return edges;
}

function allowed(from, to) {
  const area = areaOf(from);
  const target = areaOf(to);
  return !!area && !!target && AREAS[area].may.includes(target);
}

// Why a require breaks the table, in words.
function rule(from, to) {
  const area = areaOf(from);
  const target = areaOf(to);
  if (!area || !target) return `${!area ? from : to} is in no area: add its folder to AREAS of scripts/layers.js`;
  return `the ${area} area may require only ${AREAS[area].may.join(', ')}, not the ${target} area (scripts/layers.js; move the shared code down, or list the exception with its reason)`;
}

// Strongly connected components of two files or more (or a file requiring itself), sorted.
function cycles(edges) {
  const deps = {};
  for (const e of edges) (deps[e.from] ||= []).push(e.to);
  const index = {};
  const low = {};
  const stack = [];
  const onStack = new Set();
  const found = [];
  let next = 0;
  const visit = (f) => {
    index[f] = low[f] = next++;
    stack.push(f);
    onStack.add(f);
    for (const d of deps[f] || []) {
      if (!(d in index)) { visit(d); low[f] = Math.min(low[f], low[d]); } else if (onStack.has(d)) low[f] = Math.min(low[f], index[d]);
    }
    if (low[f] !== index[f]) return;
    const comp = [];
    let x;
    do { x = stack.pop(); onStack.delete(x); comp.push(x); } while (x !== f);
    if (comp.length > 1 || (deps[f] || []).includes(f)) found.push(comp.sort());
  };
  for (const f of Object.keys(deps).sort()) if (!(f in index)) visit(f);
  return found;
}

// Problems [{ file, line, kind, message }], kind 'forbidden', 'cycle' or 'leave-list'; [] when clean.
function checkLayers({ root = ROOT, exceptions = EXCEPTIONS } = {}) {
  const edges = requireGraph(root);
  const problems = [];
  const listed = (e) => exceptions.some((x) => x.from === e.from && x.to === e.to);
  for (const e of edges) {
    if (allowed(e.from, e.to) || listed(e)) continue;
    problems.push({ file: e.from, line: e.line, kind: 'forbidden', message: `${e.from}:${e.line} requires ${e.to}: ${rule(e.from, e.to)}` });
  }
  for (const x of exceptions) {
    const still = edges.some((e) => e.from === x.from && e.to === x.to);
    if (still && !allowed(x.from, x.to)) continue;
    problems.push({
      file: x.from,
      line: 0,
      kind: 'leave-list',
      message: `${x.from} -> ${x.to} is listed in EXCEPTIONS of scripts/layers.js but ${still ? 'the table allows it now' : 'no such require is left'}: remove it from the list`,
    });
  }
  for (const comp of cycles(edges)) {
    const edge = edges.find((e) => e.from === comp[0] && comp.includes(e.to));
    problems.push({
      file: comp[0],
      line: edge ? edge.line : 0,
      kind: 'cycle',
      message: `require cycle between ${comp.join(', ')} (lazy requires included): move what both use into a lower module`,
    });
  }
  return problems;
}

module.exports = {
  areaOf,
  AREAS,
  checkLayers,
  ENGINE_ROOT_UTILITIES,
  EXCEPTIONS,
  FOLDERS,
  requireGraph,
};

if (require.main === module) {
  const problems = checkLayers();
  for (const p of problems) console.log(`${p.kind}: ${p.message}`);
  if (problems.length) process.exit(1);
  console.log('layers: ok');
}
