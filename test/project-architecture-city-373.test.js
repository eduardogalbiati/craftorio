// #373: the Architecture tab (src/renderer/views/project/project-architecture.js) gets a City view
// next to the facts: a "Facts | City" switch (data-testid architecture-mode-facts / -city), City
// shows the project city (data-testid project-city), Facts brings the facts tables back, and the
// choice is remembered per window (showing the tab again keeps it).
// The tab runs in a mini DOM (test/mini-dom.js) with stubbed api channels; clicks reach the tab the
// way project.js routes them (ProjectArchitecture.onClick). No WebGL here (getContext gives null)
// and no generated 3D bundle runs: only the DOM and the state are checked. The renderer's city
// scripts (any src/renderer/**/*city*.js classic script) and the shared cores load when present.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDom } = require('./mini-dom');
const { buildModel } = require('../src/shared/architecture-model');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const SHARED = ['globs.js', 'json-schema.js', 'architecture-model.js', 'architecture-facts-view.js', 'city-model.js', 'city-layout.js'];

// ---------- fixture facts and city ----------

const hash = (n) => String(n).padStart(2, '0').repeat(20);
const FILES = [
  { path: 'src/engine/run.js', lines: 100 },
  { path: 'src/engine/queue.js', lines: 40 },
  { path: 'src/engine/gates.js', lines: 30 },
  { path: 'docs/a.md', lines: 5 },
];
const LOG = `\x01${hash(1)} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`;

function factsModel() {
  return buildModel({
    head: { commit: hash(1), date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false,
    window: { since: null, until: null }, files: FILES.map((f) => ({ ...f })), log: LOG, ignoreRevs: [],
    attributes: '', exclude: [], includeMass: true, complexity: null,
  });
}

function cityAnswer() {
  const { buildCity } = require('../src/shared/city-model');
  return { state: 'ready', ...buildCity({ plan: null, facts: factsModel() }) };
}

// every classic script under src/renderer whose name names the city (no JSX, no module code)
function cityScripts(dir = RENDERER) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'run3d' ? [] : cityScripts(full);
    if (!/city/i.test(e.name) || !e.name.endsWith('.js')) return [];
    const src = fs.readFileSync(full, 'utf8');
    return /^\s*(import|export)\s/m.test(src) || /\brequire\(/.test(src) ? [] : [full];
  });
}

// one window: the tab loaded once, shown into boxes the test creates
function loadWindow() {
  const store = new Map();
  const storage = () => ({
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  });
  const known = {
    architectureFacts: async () => ({ state: 'ready', model: factsModel(), exclude: [], gate: [] }),
    architectureReport: async () => ({ report: null, findings: [], gone: [], runsSince: 0 }),
    listArchitectureReports: async () => [],
    architectureEstimate: async () => ({ estimate: null }),
    architectureCity: async () => cityAnswer(),
  };
  const api = new Proxy(known, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise,
    requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    devicePixelRatio: 1, innerWidth: 1400, innerHeight: 900,
    localStorage: storage(), sessionStorage: storage(),
    api,
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
    fmtNum: (n) => String(n),
    fmtUsd: (n) => `US$ ${n}`,
    showToast: () => {},
  };
  const dom = createDom({ window: sandbox });
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = dom.document;
  Object.assign(sandbox, dom.classes);
  dom.classes.Element.prototype.getContext = () => null; // no WebGL
  vm.createContext(sandbox);
  const run = (file) => vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.relative(ROOT, file) });
  for (const name of SHARED) {
    const file = path.join(ROOT, 'src', 'shared', name);
    if (fs.existsSync(file)) { try { run(file); } catch { /* a Node-only core: the tab does without it */ } }
  }
  for (const file of cityScripts()) run(file);
  run(path.join(RENDERER, 'date-range.js'));
  run(path.join(RENDERER, 'views', 'project', 'project-architecture.js'));
  dom.document.addEventListener('click', (e) => sandbox.ProjectArchitecture.onClick(e));
  const newBox = () => {
    const box = dom.document.createElement('div');
    dom.document.body.appendChild(box);
    return box;
  };
  return { sandbox, dom, document: dom.document, newBox, PA: sandbox.ProjectArchitecture };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (box, id) => box.querySelector(`[data-testid="${id}"]`);
const has = (box, id) => q(box, id) != null;
// shown: present and with no hidden ancestor (the hidden attribute or class) inside the box
function shown(box, id) {
  let el = q(box, id);
  if (!el) return false;
  for (; el && el !== box; el = el.parentNode) {
    if (el.hasAttribute?.('hidden') || el.classList?.contains('hidden')) return false;
  }
  return true;
}
const click = (w, el) => el.dispatchEvent(new w.dom.classes.MouseEvent('click', { bubbles: true, cancelable: true }));
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function openTab(w, id = 'p1', box = w.newBox()) {
  w.PA.show(id, box);
  await settle();
  return box;
}

async function chooseCity(w, box) {
  const btn = q(box, 'architecture-mode-city');
  assert.ok(btn, 'a City button');
  click(w, btn);
  await settle();
}

test('#373 the Architecture tab shows a "Facts | City" switch, Facts first', async () => {
  const w = loadWindow();
  const box = await openTab(w);
  assert.equal(has(box, 'architecture-mode-facts'), true, 'a Facts button');
  assert.equal(has(box, 'architecture-mode-city'), true, 'a City button');
  assert.equal(text(q(box, 'architecture-mode-facts')), 'Facts');
  assert.equal(text(q(box, 'architecture-mode-city')), 'City');
  assert.equal(shown(box, 'architecture-hotspots'), true, 'the facts tables on first open');
  assert.equal(shown(box, 'project-city'), false, 'no city on first open');
});

test('#373 choosing City shows the project city in place of the facts tables', async () => {
  const w = loadWindow();
  const box = await openTab(w);
  await chooseCity(w, box);
  assert.equal(shown(box, 'project-city'), true, 'the city container');
  assert.equal(shown(box, 'architecture-hotspots'), false, 'the facts tables give way to the city');
  assert.equal(has(box, 'architecture-mode-facts'), true, 'the switch stays to go back');
});

test('#373 choosing Facts again brings the facts tables back', async () => {
  const w = loadWindow();
  const box = await openTab(w);
  await chooseCity(w, box);
  click(w, q(box, 'architecture-mode-facts'));
  await settle();
  assert.equal(shown(box, 'architecture-hotspots'), true, 'the facts tables');
  assert.equal(shown(box, 'project-city'), false, 'no city');
});

test('#373 the choice is remembered in the window: showing the tab again keeps City', async () => {
  const w = loadWindow();
  const first = await openTab(w, 'p1');
  await chooseCity(w, first);
  first.innerHTML = '';
  const again = await openTab(w, 'p1');
  assert.equal(shown(again, 'project-city'), true, 'City again for the same project');
  assert.equal(shown(again, 'architecture-hotspots'), false);
});

test('#373 the choice is per window: another project\'s Architecture tab opens in City too', async () => {
  const w = loadWindow();
  const first = await openTab(w, 'p1');
  await chooseCity(w, first);
  first.innerHTML = '';
  const other = await openTab(w, 'p2');
  assert.equal(shown(other, 'project-city'), true, 'City for another project in the same window');
});

test('#373 a new window starts on Facts', async () => {
  const w1 = loadWindow();
  await chooseCity(w1, await openTab(w1));
  const w2 = loadWindow();
  const box = await openTab(w2);
  assert.equal(shown(box, 'architecture-hotspots'), true);
  assert.equal(shown(box, 'project-city'), false);
});

test('#373 without WebGL the City view says so and points to the facts', async () => {
  const w = loadWindow();
  const box = await openTab(w);
  await chooseCity(w, box);
  const city = text(q(box, 'project-city'));
  assert.match(city, /WebGL/, `the city says WebGL is missing: ${city.slice(0, 200)}`);
  assert.match(city, /Facts/, 'and points to the facts');
});
