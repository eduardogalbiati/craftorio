// #373: the project city (data-testid project-city) in fronts/analyser/views/project/project-architecture.js.
// #730: the City tab of its own: the city shows at once, no "Facts | City" switch, no facts tables (they
// are the Health tab's, views/project/project-health.js), and it is kept while the tabs switch.
// The tab runs in a mini DOM (test/mini-dom.js) with stubbed api channels; clicks reach the tab the
// way project.js routes them (ProjectArchitecture.onClick). No WebGL here (getContext gives null)
// and no generated 3D bundle runs: only the DOM and the state are checked. The renderer's city
// scripts (any apps/desktop/renderer/**/*city*.js classic script) and the shared cores load when present.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const { createDom } = require('@craftorio/ui-kit/test/mini-dom');
const { buildModel } = require('@craftorio/shared/architecture-model');

const ROOT = path.join(__dirname, '..', '..', '..');
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
  const { buildCity } = require('@craftorio/shared/city-model');
  return { state: 'ready', ...buildCity({ plan: null, facts: factsModel() }) };
}

// every classic page script whose name names the city (no JSX, no module code), whichever layer holds it
// (scripts/source-tree.js pageFiles; the 3D sources under city3d/ are not page files)
function cityScripts() {
  const root = path.join(__dirname, '..', '..', '..');
  return require('../../../scripts/source-tree').pageFiles(root).map((x) => path.join(root, x.file)).filter((full) => {
    if (!/city/i.test(path.basename(full))) return false;
    const src = fs.readFileSync(full, 'utf8');
    return !(/^\s*(import|export)\s/m.test(src) || /\brequire\(/.test(src));
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
  withI18n(sandbox);
  vm.createContext(sandbox);
  const run = (file) => vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.relative(ROOT, file) });
  for (const name of SHARED) {
    const file = path.join(ROOT, 'packages', 'shared', name);
    if (fs.existsSync(file)) { try { run(file); } catch { /* a Node-only core: the tab does without it */ } }
  }
  for (const file of cityScripts()) run(file);
  run(pageFileOf('date-range.js'));
  run(pageFileOf('views/project/project-architecture.js'));
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


test('#373 #730 the City tab shows the project city at once: no Facts / City switch, no facts tables', async () => {
  const w = loadWindow();
  const box = await openTab(w);
  assert.equal(shown(box, 'project-city'), true, 'the city container');
  for (const gone of ['architecture-mode-facts', 'architecture-mode-city', 'architecture-hotspots', 'architecture-facts']) {
    assert.equal(has(box, gone), false, `${gone} is not on the City tab`);
  }
});

test('#373 showing the tab again keeps the same project\'s city', async () => {
  const w = loadWindow();
  const first = await openTab(w, 'p1');
  const city = q(first, 'project-city');
  first.innerHTML = '';
  const again = await openTab(w, 'p1');
  assert.equal(shown(again, 'project-city'), true, 'the city again for the same project');
  assert.equal(q(again, 'project-city'), city, 'the same city element, moved back');
});

test('#373 another project\'s City tab shows its own city', async () => {
  const w = loadWindow();
  const first = await openTab(w, 'p1');
  first.innerHTML = '';
  const other = await openTab(w, 'p2');
  assert.equal(shown(other, 'project-city'), true, 'a city for another project in the same window');
});

test('#373 without WebGL the City view says so', async () => {
  const w = loadWindow();
  const box = await openTab(w);
  const city = text(q(box, 'project-city'));
  assert.match(city, /WebGL/, `the city says WebGL is missing: ${city.slice(0, 200)}`);
});
