// The harness of #440/#441's tests (test/project-city-modes-440.test.js, test/project-city-panels-441.test.js):
// one app window in a mini DOM (test/mini-dom.js) without WebGL, the Architecture tab
// (views/project/project-architecture.js) with every renderer city script (any classic
// src/renderer/**/*city*.js) and the shared cores, the app's api faked at its boundary, the tab on its
// City view. The city's modes are opened through the entry points the app's screens call
// (ProjectCityImpact.showIssue / showStage, ProjectCityRelease.showRelease, ProjectCityAgents.replay).
// setInterval is a fake registry (tick() runs every interval still set) so a test can tell whether a
// poll is left running; ProjectCity.overlay is wrapped to know the layers set on the city.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('./mini-dom');
const { buildModel } = require('@multiagent/shared/architecture-model');
const { buildCity } = require('@multiagent/shared/city-model');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const SHARED = ['globs.js', 'json-schema.js', 'architecture-model.js', 'architecture-facts-view.js', 'city-model.js', 'city-layout.js',
  'city-agents.js', 'city-connections.js', 'city-impact.js', 'city-release.js', 'roadmap-model.js'];

const hash = '44'.repeat(20);
const FILES = [
  { path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 },
  { path: 'src/engine/gates.js', lines: 30 }, { path: 'docs/a.md', lines: 5 },
];
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});
// a plan with problems (a district naming an unknown zone, a district with no file): Explore lists them
const PLAN = {
  version: 1, project: 'fixture-app', zones: [{ id: 'core', name: 'Core', kind: 'industrial' }],
  districts: [{ id: 'engine', name: 'Engine', zone: 'core', include: ['src/engine/**'] }, { id: 'lost', name: 'Lost', zone: 'nowhere', include: ['nothing/**'] }],
};
// run.js requires queue.js and gates.js; queue.js requires gates.js: Most connected has rows and a search
const IMPORTS = [
  { from: 'src/engine/run.js', text: "require('./queue'); require('./gates');" },
  { from: 'src/engine/queue.js', text: "require('./gates')" },
];
const cityAnswer = () => ({ state: 'ok', ...buildCity({ plan: PLAN, facts: facts(), sources: { imports: IMPORTS, manifests: {} } }) });

// the issue cites run.js and queue.js (the legend's "Cited in the issue"); no run yet
const ISSUE = { number: 375, title: 'Preview the impact', body: 'Change `src/engine/run.js:12` and src/engine/queue.js.', runs: [] };
const STAGE = {
  name: 'Engine fixes',
  items: [
    { id: 'a', number: 1, title: 'First item', body: 'Edit `src/engine/run.js` and `src/engine/gates.js`' },
    { id: 'b', number: 2, title: 'Second item', body: 'Edit `src/engine/run.js` and `docs/a.md`' },
  ],
};
// 1.1.1 → 1.1.2 on the same plan (its base city has the plan's problems too)
const RELEASE = () => ({
  state: 'ok', from: '1.1.1', to: '1.1.2', tags: ['1.1.2', '1.1.1', '1.1.0'], plan: PLAN,
  base: buildCity({ plan: PLAN, facts: facts(), sources: { imports: IMPORTS, manifests: {} } }),
  changes: [
    { status: 'removed', path: 'docs/a.md', lines: 5 },
    { status: 'added', path: 'src/engine/new.js', lines: 5 },
    { status: 'changed', path: 'src/engine/run.js', lines: 10 },
  ],
  commits: [
    { commit: 'a'.repeat(40), subject: 'Add the new module (#12)', issues: [12], files: ['src/engine/new.js'] },
    { commit: 'b'.repeat(40), subject: 'Remove a doc and edit run (#13)', issues: [13], files: ['docs/a.md', 'src/engine/run.js'] },
  ],
});
const at = (s) => new Date(Date.parse('2026-10-13T10:00:00.000Z') + s * 1000).toISOString();
const BUSY = (agent = 'developer') => ({
  projectId: 'p1',
  runs: [{ id: 'run-1', colour: '#e4572e', agents: [{ session_id: 's-dev', agent, step: 'implement', path: 'src/engine/run.js', kind: 'change', ts: at(5) }], trail: ['src/engine/run.js'], dirty: [] }],
  collisions: [],
});
const REPLAY = {
  runId: 'run-20261013-abcdef12',
  touches: [
    { session_id: 's1', agent: 'developer', step: 'implement', path: 'src/engine/run.js', kind: 'change', ts: at(0) },
    { session_id: 's1', agent: 'developer', step: 'implement', path: 'src/engine/queue.js', kind: 'change', ts: at(30) },
  ],
};

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

function loadWindow({ agents = () => ({ projectId: 'p1', runs: [], collisions: [] }) } = {}) {
  const calls = { agents: [], release: [], impact: [], overlay: [], openCity: [] };
  const store = new Map([['multiagent.architecture.view', 'city']]); // the tab opens on its City view
  const storage = () => ({
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  });
  // the fake interval registry
  const intervals = new Map();
  let nextId = 1;
  const fakeSetInterval = (fn, ms) => { const id = nextId++; intervals.set(id, { fn, ms }); return { id, unref() {}, ref() {}, [Symbol.toPrimitive]: () => id }; };
  const fakeClearInterval = (h) => { if (h == null) return; intervals.delete(typeof h === 'object' ? h.id : Number(h)); };
  const known = {
    architectureFacts: async () => ({ state: 'ready', model: facts(), exclude: [], gate: [] }),
    architectureReport: async () => ({ report: null, findings: [], gone: [], runsSince: 0 }),
    listArchitectureReports: async () => [],
    architectureEstimate: async () => ({ estimate: null }),
    architectureCity: async () => cityAnswer(),
    architectureAgents: async (arg) => {
      calls.agents.push(JSON.parse(JSON.stringify(arg)));
      if (arg && arg.runId) return { projectId: 'p1', runs: [], collisions: [], replay: JSON.parse(JSON.stringify(REPLAY)) };
      return JSON.parse(JSON.stringify(agents(arg)));
    },
    architectureImpact: async (arg) => { calls.impact.push(JSON.parse(JSON.stringify(arg))); return { plan: null, history: {}, error: null }; },
    architectureRelease: async (arg) => { calls.release.push(JSON.parse(JSON.stringify(arg))); return JSON.parse(JSON.stringify(RELEASE())); },
    productOwnerHistory: async () => [],
    getBacklog: async () => ({ issues: [] }),
    runDiff: async () => ({ files: [] }),
    captureWindow: async () => null,
  };
  const api = new Proxy(known, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval: fakeSetInterval, clearInterval: fakeClearInterval, queueMicrotask, Promise,
    requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    devicePixelRatio: 1, innerWidth: 1400, innerHeight: 900,
    localStorage: storage(), sessionStorage: storage(),
    api,
    state: { projects: [{ id: 'p1', name: 'fixture-app' }], settings: {} },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
    fmtNum: (n) => String(n),
    fmtUsd: (n) => `US$ ${n}`,
    showToast: () => {},
    showRun: () => {},
    openProjectView: (id) => { calls.openCity.push(String(id)); },
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
  run(path.join(RENDERER, 'select.js'));
  for (const file of cityScripts()) run(file);
  run(path.join(RENDERER, 'date-range.js'));
  run(path.join(RENDERER, 'views', 'project', 'project-architecture.js'));
  // the layers set on the city, by name (the modules call ProjectCity.overlay at call time)
  const overlay = sandbox.ProjectCity.overlay;
  sandbox.ProjectCity.overlay = (name, spec) => { calls.overlay.push({ name: String(name), on: !!spec }); return overlay(name, spec); };
  dom.document.addEventListener('click', (e) => sandbox.ProjectArchitecture.onClick(e));
  return {
    w: sandbox, dom, calls, intervals,
    /** Runs every interval still set (a poll's or a replay's tick), as time passing would. */
    tick() { for (const [id, { fn }] of [...intervals]) if (intervals.has(id)) { try { fn(); } catch { /* a callback's own error */ } } },
  };
}

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el?.querySelector(`[data-testid="${id}"]`) || null;
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
// visible: in the DOM and no ancestor (up to `root`) hidden by the attribute or the class
function visible(root, el) {
  if (!el) return false;
  for (let cur = el; cur && cur !== root.parentNode; cur = cur.parentNode) {
    if (cur.hasAttribute?.('hidden') || cur.classList?.contains('hidden')) return false;
  }
  return true;
}
const shownId = (root, id) => [...root.querySelectorAll(`[data-testid="${id}"]`)].some((el) => visible(root, el));
const panel = (root, name) => [...root.querySelectorAll(`[data-city-panel="${name}"]`)].find((el) => visible(root, el)) || null;
const shownPanel = (root, name) => !!panel(root, name);
const toggleOf = (p) => p?.querySelector('[data-testid="city-panel-toggle"]') || null;
// a minimized panel: its chevron says so and its body is hidden (the attribute, the class, or the panel's `min` class)
function bodyShown(root, p) {
  const body = p?.querySelector('[data-city-panel-body]');
  if (!body) return false;
  return visible(root, body) && !p.classList.contains('min');
}
// the layers on the city now (last call per name)
function layersOn(calls) {
  const last = new Map();
  for (const c of calls.overlay) last.set(c.name, c.on);
  return [...last].filter(([, on]) => on).map(([n]) => n).sort();
}
// Live's toggle: a checkbox (checked) or a button (aria-pressed)
const isOn = (el) => !!el && (el.checked === true || el.getAttribute?.('aria-pressed') === 'true');

/** The window, the tab on project p1's City view, the city element. */
async function openCity(opts) {
  const h = loadWindow(opts);
  const box = h.dom.document.createElement('div');
  h.dom.document.body.appendChild(box);
  h.w.ProjectArchitecture.show('p1', box);
  await settle();
  const root = q(box, 'project-city');
  return { ...h, box, root };
}

const mode = (root) => String(root?.getAttribute('data-city-mode') ?? '');
const title = (root) => text(q(root, 'city-mode-title'));
// the legend's text (its rows), '' when there is none
const legendText = (root) => text(q(root, 'project-city-legend'));

module.exports = {
  ISSUE, STAGE, REPLAY, BUSY, facts, cityAnswer,
  loadWindow, openCity, settle, q, text, visible, shownId, panel, shownPanel, toggleOf, bodyShown, layersOn, isOn, mode, title, legendText,
};
