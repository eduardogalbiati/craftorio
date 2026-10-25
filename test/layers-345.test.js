// #345: layering rules enforced by a test, and the pure modules both sides use moved to packages/shared/.
// The areas of src/ have a direction: shared (pure, dual-load modules) requires nothing of the app;
// the engine requires shared and the low-level root utilities it names; the root domain modules
// require the engine and shared; the service all of these; the desktop entry and the server the
// service; the renderer only shared. The exceptions are listed with a reason and may only shrink.
// The repository has no require cycle.
// Seams: scripts/layers.js { EXCEPTIONS, checkLayers({ root, exceptions }) } (created by the change,
// loaded inside each test), which returns problems [{ file, line, kind, message }] with kind
// 'forbidden' (a direction the table does not allow), 'cycle' or 'leave-list' (a listed exception
// no file has any more); the files on disk (every require under src/, lazy ones included); the
// generated src/renderer/index.html; the HTTP server's static files; the code map (scripts/docs.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const http = require('http');

const root = path.join(__dirname, '..');
const SRC = path.join(root, 'src');
const SHARED = path.join(root, 'packages', 'shared');
const RENDERER = path.join(SRC, 'renderer');
const load = () => require('../scripts/layers.js');
const { resolvePackagePath, sourceFiles } = require('../scripts/source-tree');
const posix = (p) => p.split(path.sep).join('/');
const rel = (abs) => posix(path.relative(root, abs));
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// The pure modules the backend required from src/renderer/ at 383469a (issue #345).
const MOVED = ['backlog-archive', 'chain-model', 'default-workflow', 'display-name', 'po-calibration', 'run-progress-model', 'session-cache', 'setup-model', 'time-zone'];

function listJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['node_modules', 'test'].includes(e.name) ? [] : listJs(p);
    return e.isFile() && e.name.endsWith('.js') ? [p] : [];
  }).sort();
}

// The source with comments blanked (strings kept, so require targets survive). Lines are kept.
function withoutComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '//') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; out += ' '.repeat(end - i); i = end; continue; }
    if (two === '/*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; out += src.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

function resolveLocal(fromFile, target) {
  const pkgPath = target.startsWith('.') ? null : resolvePackagePath(root, target);
  if (!target.startsWith('.') && !pkgPath) return null;
  const base = pkgPath ? path.join(root, pkgPath) : path.resolve(path.dirname(fromFile), target);
  for (const p of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

// Every require of every source file (src/ and the workspaces; lazy ones included) that names another
// file of the repository, relative or through a workspace package: [{ from, to, line }].
function requireGraph() {
  const edges = [];
  for (const file of sourceFiles(root).map((f) => path.join(root, f))) {
    const code = withoutComments(read(file));
    for (const m of code.matchAll(/\brequire\(\s*(['"])([^'"]*)\1\s*\)/g)) {
      const to = resolveLocal(file, m[2]);
      if (to && to.endsWith('.js')) edges.push({ from: rel(file), to: rel(to), line: code.slice(0, m.index).split('\n').length });
    }
  }
  return edges;
}

// A scratch tree { 'src/a.js': text } for the checker's fixtures.
function tree(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-345-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    const abs = path.join(dir, ...file.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  return dir;
}
const found = (problems) => problems.map((p) => `${p.kind} ${p.file}`).sort();

test('#345 nothing outside src/renderer/ requires a file of src/renderer/', () => {
  const back = requireGraph().filter((e) => !e.from.startsWith('src/renderer/') && e.to.startsWith('src/renderer/'))
    .map((e) => `${e.from}:${e.line} -> ${e.to}`);
  assert.deepEqual(back, []);
});

test('#345 the require graph under src/ has no cycle, lazy requires included', () => {
  const deps = {};
  for (const e of requireGraph()) (deps[e.from] ||= new Set()).add(e.to);
  // Tarjan's strongly connected components: a component of two files or more (or a self-require) is a cycle
  const index = {};
  const low = {};
  const stack = [];
  const onStack = new Set();
  const cycles = [];
  let next = 0;
  const visit = (f) => {
    index[f] = low[f] = next++;
    stack.push(f); onStack.add(f);
    for (const d of deps[f] || []) {
      if (!(d in index)) { visit(d); low[f] = Math.min(low[f], low[d]); } else if (onStack.has(d)) low[f] = Math.min(low[f], index[d]);
    }
    if (low[f] === index[f]) {
      const comp = [];
      let x;
      do { x = stack.pop(); onStack.delete(x); comp.push(x); } while (x !== f);
      if (comp.length > 1 || (deps[f] && deps[f].has(f))) cycles.push(comp.sort().join(' <-> '));
    }
  };
  for (const f of Object.keys(deps).sort()) if (!(f in index)) visit(f);
  assert.deepEqual(cycles, []);
});

test('#345 the shared pure modules live under packages/shared/ and no longer under src/renderer/', () => {
  const shared = listJs(SHARED).map((f) => path.basename(f, '.js'));
  assert.deepEqual(MOVED.filter((m) => !shared.includes(m)), [], 'modules missing from packages/shared/');
  const left = listJs(RENDERER).map(rel).filter((f) => MOVED.includes(path.basename(f, '.js')));
  assert.deepEqual(left, [], 'moved modules still in src/renderer/');
});

test('#345 every packages/shared/ module loads with require and as a browser <script> in the order index.html lists them', () => {
  const files = listJs(SHARED);
  assert.ok(files.length >= MOVED.length, 'packages/shared/ holds the moved modules');
  for (const f of files) {
    const mod = require(f);
    assert.equal(mod !== null && ['object', 'function'].includes(typeof mod) && Object.keys(mod).length > 0, true, `${rel(f)} exports something with require`);
  }
  const html = read(path.join(RENDERER, 'index.html'));
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => rel(path.resolve(RENDERER, m[1])));
  const sharedRel = files.map(rel);
  assert.deepEqual(sharedRel.filter((f) => !scripts.includes(f)), [], 'packages/shared/ modules missing from index.html');
  const ctx = vm.createContext({});
  vm.runInContext('globalThis.window = globalThis;', ctx);
  const added = {};
  for (const f of scripts.filter((s) => sharedRel.includes(s))) {
    const before = new Set(vm.runInContext('Object.keys(globalThis)', ctx));
    vm.runInContext(read(path.join(root, f)), ctx, { filename: f });
    added[f] = Array.from(vm.runInContext('Object.keys(globalThis)', ctx)).filter((k) => !before.has(k)).length;
  }
  assert.deepEqual(Object.entries(added).filter(([, n]) => n === 0).map(([f]) => f), [], 'shared modules that define no window global as a <script>');
});

test('#345 every <script src> of src/renderer/index.html names an existing file, and the generated lists are up to date', () => {
  const html = read(path.join(RENDERER, 'index.html'));
  const missing = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])
    .filter((s) => !/^[a-z]+:/i.test(s) && !fs.existsSync(path.resolve(RENDERER, s)));
  assert.deepEqual(missing, []);
  // the other pages (the engine connection page, src/renderer/connection/) write their script paths by hand
  const pages = fs.readdirSync(RENDERER, { recursive: true }).filter((f) => f.endsWith('.html') && f !== 'index.html' && !f.includes('node_modules'));
  assert.ok(pages.length >= 1, 'the renderer has other pages');
  for (const page of pages) {
    const text = read(path.join(RENDERER, page));
    const lost = [...text.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)].map((m) => m[1])
      .filter((s) => !/^[a-z]+:/i.test(s) && !fs.existsSync(path.resolve(RENDERER, path.dirname(page), s)));
    assert.deepEqual(lost, [], `${page}: script or style files that do not exist`);
  }
  const { renderIndexHtml } = require('../scripts/docs.js');
  assert.equal(renderIndexHtml(html, root) === html, true, 'index.html matches npm run docs');
});

test('#345 the browser server serves the packages/shared/ modules', async (t) => {
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  const { setupWorkspace } = require('@multiagent/engine/domains/workspace/workspace');
  const { createService } = require('@multiagent/engine/service');
  const { createServer } = require('@multiagent/engine/server');
  const TOKEN = 'test-token-0123456789abcdef';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-345-ws-'));
  const service = createService({ host: { trashItem: async () => {}, appVersion: '1.2.3', isPackaged: false } });
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  const server = createServer({ service, auth: null, token: TOKEN });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    service.shutdown();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const get = (p) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: p, headers: { Authorization: `Bearer ${TOKEN}` } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end();
  });
  const file = listJs(SHARED).find((f) => path.basename(f) === 'display-name.js');
  assert.equal(Boolean(file), true, 'packages/shared/ has display-name.js');
  assert.equal(await get(`/${rel(file)}`), 200);
  assert.equal(await get('/packages/shared/../main.js'), 404);
});

test('#345 the layering check passes on this repository', () => {
  const { checkLayers } = load();
  assert.deepEqual(checkLayers({ root }).map((p) => p.message), []);
});

test('#345 every listed exception names its two files and a reason, and none is about src/renderer/', () => {
  const { EXCEPTIONS } = load();
  assert.equal(Array.isArray(EXCEPTIONS), true);
  const bad = EXCEPTIONS.filter((e) => typeof e.from !== 'string' || typeof e.to !== 'string' || typeof e.reason !== 'string' || !e.reason.trim()
    || !fs.existsSync(path.join(root, e.from)) || !fs.existsSync(path.join(root, e.to)));
  assert.deepEqual(bad.map((e) => `${e.from} -> ${e.to}`), []);
  assert.deepEqual(EXCEPTIONS.filter((e) => e.to.startsWith('src/renderer/')).map((e) => e.from), [], 'the backend never requires the UI folder, not even as an exception');
});

test('#345 the allowed directions pass: shared, engine, root, service, desktop, server and renderer requiring what they may', (t) => {
  const { checkLayers } = load();
  const dir = tree(t, {
    'packages/shared/zz-s1.js': "const fs = require('fs');\nconst yaml = require('js-yaml');\nconst s2 = require('./zz-s2');\nmodule.exports = { fs, yaml, s2 };\n",
    'packages/shared/zz-s2.js': 'module.exports = { two: 2 };\n',
    'src/engine/zz-e.js': "// require('../renderer/zz-r') in a comment is not a require\nconst s = require('../../packages/shared/zz-s1');\nmodule.exports = { s };\n",
    'src/zz-domain.js': "const e = require('./engine/zz-e');\nfunction later() { return require('../packages/shared/zz-s2'); }\nmodule.exports = { e, later };\n",
    'src/service/zz-svc.js': "const d = require('../zz-domain');\nconst e = require('../engine/zz-e');\nconst s = require('../../packages/shared/zz-s1');\nmodule.exports = { d, e, s };\n",
    'src/host/main.js': "const svc = require('../service/zz-svc');\nmodule.exports = { svc };\n",
    'src/server/zz-srv.js': "const svc = require('../service/zz-svc');\nmodule.exports = { svc };\n",
    'src/renderer/zz-r.js': "(function () { const s = typeof require === 'function' ? require('../../packages/shared/zz-s2') : null; return s; })();\n",
  });
  assert.deepEqual(checkLayers({ root: dir, exceptions: [] }).map((p) => p.message), []);
});

test('#345 a forbidden direction fails, naming the file, the line and the rule (lazy requires included)', (t) => {
  const { checkLayers } = load();
  const dir = tree(t, {
    'packages/shared/zz-s.js': "// a pure module\n\nconst e = require('../../src/engine/zz-e');\nmodule.exports = { e };\n",
    'src/engine/zz-e.js': 'module.exports = {};\n',
    'src/engine/zz-up.js': "const x = 1;\n\nfunction later() {\n  return require('../zz-domain');\n}\nmodule.exports = { x, later };\n",
    'src/engine/zz-ui.js': "const r = require('../renderer/zz-r');\nmodule.exports = { r };\n",
    'src/zz-domain.js': "const svc = require('./service/zz-svc');\nmodule.exports = { svc };\n",
    'src/service/zz-svc.js': 'module.exports = {};\n',
    'src/renderer/zz-r.js': "const e = typeof require === 'function' ? require('../engine/zz-e') : null;\n",
  });
  const problems = checkLayers({ root: dir, exceptions: [] });
  assert.deepEqual(found(problems), [
    'forbidden packages/shared/zz-s.js',
    'forbidden src/engine/zz-ui.js',
    'forbidden src/engine/zz-up.js',
    'forbidden src/renderer/zz-r.js',
    'forbidden src/zz-domain.js',
  ]);
  const shared = problems.find((p) => p.file === 'packages/shared/zz-s.js');
  assert.equal(shared.line, 3);
  assert.match(shared.message, /packages\/shared\/zz-s\.js/);
  assert.match(shared.message, /\b3\b/);
  assert.match(shared.message, /src\/engine\/zz-e\.js/);
  const lazy = problems.find((p) => p.file === 'src/engine/zz-up.js');
  assert.equal(lazy.line, 4);
  assert.match(lazy.message, /src\/zz-domain\.js/);
});

test('#345 a listed exception allows its one require, and a listed exception no file has any more fails until it leaves the list', (t) => {
  const { checkLayers } = load();
  const dir = tree(t, {
    'src/engine/zz-up.js': "const d = require('../zz-domain');\nmodule.exports = { d };\n",
    'src/zz-domain.js': 'module.exports = {};\n',
    'src/zz-other.js': 'module.exports = {};\n',
  });
  const listed = { from: 'src/engine/zz-up.js', to: 'src/zz-domain.js', reason: 'fixture: the engine still reads the domain module' };
  assert.deepEqual(checkLayers({ root: dir, exceptions: [listed] }).map((p) => p.message), []);
  const stale = { from: 'src/engine/zz-up.js', to: 'src/zz-other.js', reason: 'fixture: removed since' };
  const problems = checkLayers({ root: dir, exceptions: [listed, stale] });
  assert.deepEqual(found(problems), ['leave-list src/engine/zz-up.js']);
  assert.match(problems[0].message, /src\/zz-other\.js/);
});

test('#345 a require cycle fails, naming its files, even when one side requires lazily', (t) => {
  const { checkLayers } = load();
  const dir = tree(t, {
    'src/zz-a.js': "const b = require('./zz-b');\nmodule.exports = { b };\n",
    'src/zz-b.js': "function a() { return require('./zz-a'); }\nmodule.exports = { a };\n",
    'src/zz-c.js': "const a = require('./zz-a');\nmodule.exports = { a };\n",
  });
  const problems = checkLayers({ root: dir, exceptions: [] });
  assert.deepEqual([...new Set(problems.map((p) => p.kind))], ['cycle']);
  for (const p of problems) {
    assert.match(p.message, /src\/zz-a\.js/);
    assert.match(p.message, /src\/zz-b\.js/);
    assert.doesNotMatch(p.message, /zz-c/);
  }
});

test('#345 the docs say where a new module goes: the code map and renderer.md name packages/shared/ and the layering check', () => {
  const { codeMap } = require('../scripts/docs.js');
  const map = codeMap(root);
  assert.match(map, /packages\/shared\//);
  assert.match(map, /scripts\/layers\.js|layers/);
  const doc = read(path.join(root, 'docs', 'agents', 'renderer.md'));
  assert.match(doc, /packages\/shared\//);
});
