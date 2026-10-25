// #488: the Builder (src/domains/workflow/workflow-builder.js), the composition (workflow-compose.js) and the field
// rules (src/engine/run/field-rules.js) load in a browser page without Node, so a static public page
// can reuse them. Acceptance tests, written before the code.
//
// The page is a vm context with a window and no require / module / exports / process / Buffer /
// __dirname. Each file is loaded as a <script> would load it, after the files it names in
// require('./...') (followed recursively, deepest first, each once: the script tags such a page
// would list). A package require ('js-yaml') is the page's js-yaml browser build, the global `jsyaml`
// (node_modules/js-yaml/dist/js-yaml.js). The renderer's shared modules already work this way
// (src/shared/providers/index.js: window.Providers in a browser, module.exports in Node).
// Assumption: each file then exposes its API as one window global (any name) holding its functions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const JS_YAML_BROWSER = path.join(ROOT, 'node_modules', 'js-yaml', 'dist', 'js-yaml.js');

// workflow-compose.js: wherever the change puts it under src/ (the pure core of src/shared/ first: the
// Node wrapper of src/domains/workflow/ requires the engine, which no browser page loads)
function findCompose(dir = SRC) {
  if (dir === SRC) { const shared = findCompose(path.join(SRC, 'shared')); if (shared) return shared; }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const hit = findCompose(full); if (hit) return hit; }
    else if (entry.name === 'workflow-compose.js') return full;
  }
  return null;
}

const REQUIRE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
function resolveLocal(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}
// the file and the local files it requires, deepest first
function scriptsFor(file, seen = new Set(), out = []) {
  if (seen.has(file)) return out;
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const [, spec] of src.matchAll(REQUIRE)) {
    if (!spec.startsWith('.')) continue;
    const dep = resolveLocal(file, spec);
    if (dep && dep.endsWith('.js')) scriptsFor(dep, seen, out);
  }
  out.push(file);
  return out;
}

function browserPage() {
  const window = { console: { log() {}, info() {}, warn() {}, error() {}, debug() {} }, setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone, navigator: { language: 'en-US', userAgent: 'browser' }, location: { href: 'https://example.com/', search: '', hash: '' }, document: { currentScript: null, querySelector: () => null } };
  window.window = window;
  window.self = window;
  window.globalThis = window;
  const ctx = vm.createContext(window);
  return { window, ctx };
}

// load `target` and its local requires into a fresh page; returns { error, added: new globals }
function loadInPage(target) {
  const { window, ctx } = browserPage();
  const before = new Set(Object.keys(window));
  if (fs.existsSync(JS_YAML_BROWSER)) vm.runInContext(fs.readFileSync(JS_YAML_BROWSER, 'utf8'), ctx, { filename: 'js-yaml.js' });
  const files = scriptsFor(target);
  for (const file of files) {
    try {
      vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: path.relative(ROOT, file) });
    } catch (e) {
      return { error: `${path.relative(ROOT, file)}: ${e && e.message}`, window, added: [], files };
    }
  }
  const added = Object.keys(window).filter((k) => !before.has(k) && k !== 'jsyaml');
  return { error: null, window, added, files };
}
// the new global holding every one of `names` as a function, or null
function apiWith(page, names) {
  const key = page.added.find((k) => { const v = page.window[k]; return v && typeof v === 'object' && names.every((n) => typeof v[n] === 'function'); });
  return key ? page.window[key] : null;
}

test('#488 the page has no Node globals (guards the harness: CommonJS code cannot run here)', () => {
  const { ctx } = browserPage();
  assert.equal(vm.runInContext('typeof require + typeof module + typeof exports + typeof process + typeof Buffer', ctx), 'undefinedundefinedundefinedundefinedundefined');
});

test('#488 the field rules (src/engine/run/field-rules.js) load in a browser page and expose their API', () => {
  const page = loadInPage(path.join(SRC, 'engine', 'run', 'field-rules.js'));
  assert.equal(page.error, null, page.error);
  const api = apiWith(page, ['checkField', 'runChecks', 'parseDuration']);
  assert.equal(api !== null, true, `a window global with checkField, runChecks, parseDuration (new globals: ${page.added.join(', ')})`);
  assert.equal(api.parseDuration('5m'), 300000);
});

test('#488 the Builder (src/domains/workflow/workflow-builder.js) loads in a browser page and exposes its API', () => {
  const page = loadInPage(path.join(SRC, 'domains', 'workflow', 'workflow-builder.js'));
  assert.equal(page.error, null, page.error);
  const api = apiWith(page, ['toYaml', 'fromWorkflow', 'describeWorkflow', 'validateSpec', 'fileNameFor']);
  assert.equal(api !== null, true, `a window global with the builder's functions (new globals: ${page.added.join(', ')})`);
  assert.equal(api.fileNameFor('My Shared Flow'), 'my-shared-flow.yaml');
});

test('#488 workflow-compose.js exists and loads in a browser page, exposing its functions', () => {
  const file = findCompose();
  assert.equal(file !== null, true, 'workflow-compose.js under src/');
  const page = loadInPage(file);
  assert.equal(page.error, null, page.error);
  const exposed = page.added.filter((k) => { const v = page.window[k]; return v && typeof v === 'object' && Object.values(v).some((f) => typeof f === 'function'); });
  assert.equal(exposed.length >= 1, true, `a window global with its functions (new globals: ${page.added.join(', ')})`);
});

// (fs / path in a Node-only branch is fine, as src/shared/i18n.js does: only process spawning is checked)
test('#488 nothing the Builder, the composition or the field rules load can spawn a process', () => {
  const targets = [path.join(SRC, 'domains', 'workflow', 'workflow-builder.js'), path.join(SRC, 'engine', 'run', 'field-rules.js'), findCompose()].filter(Boolean);
  const offenders = [];
  for (const target of targets) {
    for (const file of scriptsFor(target)) {
      const src = fs.readFileSync(file, 'utf8');
      if (/require\(\s*['"](node:)?(child_process|worker_threads|cluster)['"]\s*\)/.test(src)) offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual([...new Set(offenders)], []);
});
