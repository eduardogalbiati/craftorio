// #450, the City life and Glow switches of the project city (acceptance tests, written before the
// code): the per-mode defaults and their memory (src/renderer/city3d/store.js, pure exports), the
// flags reaching the scene's state (src/renderer/city3d/main.jsx's handle: mount / update / stats),
// the header's two switches in the Architecture tab's city (src/renderer/views/project/project-city.js,
// a mini DOM without WebGL, then with a fake WebGL and a fake ProjectCityScene that records what the
// view hands the scene), and their labels in en.json and pt-BR.json.
// The city3d modules are bundled in memory with esbuild (three included); React, React DOM, React
// Three Fiber and any postprocessing package are only used while rendering, so they are stubbed.
// Every module that #450 changes is loaded inside the tests, so this file loads before the code exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const CITY3D = path.join(ROOT, 'src', 'renderer', 'city3d');
const MODES = { explore: true, live: true, replay: false, issue: false, stage: false, release: false };

// ---------- the city3d bundle (store.js, main.jsx) ----------

const noop = () => {};
const proxy = (extra = {}) => new Proxy(() => {}, { get: (_t, k) => (k in extra ? extra[k] : () => {}) });
function stubFor(id) {
  if (id === 'react-dom/client') return proxy({ createRoot: () => ({ render: noop, unmount: noop }) });
  if (id === 'react') return proxy({ Component: class {}, useSyncExternalStore: (_s, get) => get() });
  return proxy();
}

const bundles = new Map();
async function bundle(t, file) {
  if (bundles.has(file)) return bundles.get(file);
  let esbuild;
  try { esbuild = require('esbuild'); } catch { t.skip('esbuild is not installed'); return null; }
  const out = await esbuild.build({
    entryPoints: [path.join(CITY3D, file)],
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: { '.jsx': 'jsx' },
    external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@react-three/*', 'postprocessing'], logLevel: 'silent',
  });
  // main.jsx defines window.ProjectCityScene and reads the catalog's t at call time
  globalThis.window ||= {};
  globalThis.window.Run3DTheme ||= require('../src/renderer/run3d-theme.js'); // theme.js reads it (the app loads it first)
  globalThis.t ||= require('@multiagent/shared/i18n.js').t;
  const m = new Module(path.join(CITY3D, `${file}.bundle.js`));
  m.require = (id) => (/^(react|react-dom|@react-three|postprocessing)(\/|$)/.test(id) ? stubFor(id) : require(id));
  m._compile(out.outputFiles[0].text, m.id);
  bundles.set(file, m.exports);
  return m.exports;
}

async function sceneApi(t) {
  if (!(await bundle(t, 'main.jsx'))) return null;
  return globalThis.window.ProjectCityScene;
}

// a small city laid out by hand (the shape test/city-scene-helpers-373.test.js uses)
const lot = (o) => ({ complexity: 60, functions: 20, lines: 300, quadrant: null, test: false, worst: null, churn: 0, ...o });
const LAYOUT = {
  districts: [{ id: 'engine', zone: 'core', x: 0, z: 0, w: 40, d: 40 }],
  buildings: [
    lot({ path: 'src/a.js', district: 'engine', x: 0, z: 0, w: 6, d: 6, h: 8 }),
    lot({ path: 'src/b.js', district: 'engine', x: 10, z: 0, w: 6, d: 6, h: 5 }),
  ],
  landmarks: [], ports: [], zones: [],
};
const mountScene = (S, extra = {}) => S.mount({}, { layout: LAYOUT, paint: { colours: ['#888888', '#888888'], greyed: [false, false] }, theme: 'dark', ...extra });

// ---------- the project city view (mini DOM) ----------

const { createDom } = require('./mini-dom');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');

const hash = '11'.repeat(20);
const FILES = [{ path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 }, { path: 'docs/a.md', lines: 5 }];

function facts() {
  const { buildModel } = require('@multiagent/shared/architecture-model');
  return buildModel({
    head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
    files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
    ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
  });
}

// webgl: a fake context, and a fake ProjectCityScene recording mount's options and update's patches
function loadView({ webgl = false } = {}) {
  const { buildCity } = require('@multiagent/shared/city-model');
  const answer = { state: 'ok', ...buildCity({ plan: null, facts: facts() }) };
  const scene = { mounts: [], updates: [] };
  const sandbox = {
    console, setTimeout, clearTimeout, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    api: { architectureCity: async () => answer },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = webgl ? () => ({ getExtension: () => null }) : () => null;
  if (webgl) {
    sandbox.ProjectCityScene = {
      mount(_el, opts) {
        scene.mounts.push({ cityLife: opts.cityLife, glow: opts.glow });
        return { update: (p) => scene.updates.push(JSON.parse(JSON.stringify({ ...p, layout: p.layout ? 'new' : undefined }))), pin: noop, flyTo: noop, home: noop, zoom: noop, stats: () => null, unmount: noop };
      },
    };
  }
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox);
  }
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'project', f), 'utf8'), sandbox, { filename: f });
  }
  return { w: sandbox, scene };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el.querySelector(`[data-testid="${id}"]`);

async function openView(opts) {
  const { w, scene } = loadView(opts);
  const city = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app' });
  w.document.body.appendChild(city.el);
  city.update({ facts: { state: 'ok', model: facts() } });
  await settle();
  return { w, city, scene };
}

const pressed = (city, id) => q(city.el, id)?.getAttribute('aria-pressed') ?? 'missing';
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
const LABELS = ['project_city.city_life', 'project_city.glow'];

// ---------- store.js: the defaults and their memory ----------

test('#450 cityLifeDefault: on in Explore and Live, off in Replay, Issue, Stage and Release; on in the Architecture tab\'s city (no mode)', async (t) => {
  const s = await bundle(t, 'store.js');
  if (!s) return;
  assert.equal(typeof s.cityLifeDefault, 'function', 'store.js exports cityLifeDefault(mode)');
  const got = Object.fromEntries(Object.keys(MODES).map((m) => [m, s.cityLifeDefault(m)]));
  assert.deepEqual(got, MODES);
  assert.equal(s.cityLifeDefault(undefined), true, 'no mode: the Architecture tab\'s city');
  assert.equal(s.cityLifeDefault('architecture'), true);
});

test('#450 cityLifeOf / rememberCityLife: a switch is remembered for its mode only, the others keep their default', async (t) => {
  const s = await bundle(t, 'store.js');
  if (!s) return;
  assert.equal(typeof s.cityLifeOf, 'function', 'store.js exports cityLifeOf(remembered, mode)');
  assert.equal(typeof s.rememberCityLife, 'function', 'store.js exports rememberCityLife(remembered, mode, on)');
  const none = {};
  for (const [m, on] of Object.entries(MODES)) assert.equal(s.cityLifeOf(none, m), on, `nothing remembered: ${m} has its default`);
  const a = s.rememberCityLife(none, 'replay', true);
  assert.equal(s.cityLifeOf(a, 'replay'), true, 'replay switched on');
  assert.equal(s.cityLifeOf(a, 'issue'), false, 'issue keeps its default');
  assert.equal(s.cityLifeOf(a, 'explore'), true, 'explore keeps its default');
  const b = s.rememberCityLife(a, 'explore', false);
  assert.equal(s.cityLifeOf(b, 'explore'), false, 'explore switched off');
  assert.equal(s.cityLifeOf(b, 'replay'), true, 'replay still remembered');
  assert.equal(s.cityLifeOf(none, 'replay'), false, 'the earlier memory is not changed');
});

// ---------- main.jsx: the flags reach the scene's state ----------

test('#450 scene handle: City life and Glow are on by default; mount takes them, stats() reports them', async (t) => {
  const S = await sceneApi(t);
  if (!S) return;
  const on = mountScene(S).stats();
  assert.deepEqual({ cityLife: on.cityLife, glow: on.glow }, { cityLife: true, glow: true });
  const off = mountScene(S, { cityLife: false, glow: false }).stats();
  assert.deepEqual({ cityLife: off.cityLife, glow: off.glow }, { cityLife: false, glow: false });
});

test('#450 scene handle: update({ cityLife }) and update({ glow }) switch the flags, the city keeps its buildings', async (t) => {
  const S = await sceneApi(t);
  if (!S) return;
  const h = mountScene(S);
  const before = h.stats().buildings.map((b) => `${b.path}:${b.archetype}`).join('|');
  h.update({ cityLife: false });
  assert.equal(h.stats().cityLife, false);
  assert.equal(h.stats().glow, true, 'Glow is its own switch');
  h.update({ glow: false });
  assert.equal(h.stats().glow, false);
  h.update({ cityLife: true });
  assert.equal(h.stats().cityLife, true);
  assert.equal(h.stats().buildings.map((b) => `${b.path}:${b.archetype}`).join('|'), before, 'the same buildings (no new layout)');
});

// ---------- project-city.js: the header's switches ----------

test('#450 header: City life and Glow switches, pressed by default in the Architecture tab\'s city, a click unpresses them', async () => {
  const { w, city } = await openView();
  assert.ok(q(city.el, 'project-city-header'), 'the header is drawn');
  assert.equal(pressed(city, 'project-city-life'), 'true', 'City life on by default');
  assert.equal(pressed(city, 'project-city-glow'), 'true', 'Glow on by default');
  assert.equal(q(city.el, 'project-city-life').getAttribute('aria-label'), w.t('project_city.city_life'));
  q(city.el, 'project-city-life').click();
  assert.equal(pressed(city, 'project-city-life'), 'false');
  assert.equal(pressed(city, 'project-city-glow'), 'true', 'City life does not switch Glow');
  q(city.el, 'project-city-glow').click();
  assert.equal(pressed(city, 'project-city-glow'), 'false');
  city.destroy();
});

test('#450 header: the switch\'s flag reaches the scene, as an update, without a new mount or a new layout', async () => {
  const { city, scene } = await openView({ webgl: true });
  assert.equal(scene.mounts.length, 1, 'the scene is mounted once');
  assert.deepEqual(scene.mounts[0], { cityLife: true, glow: true }, 'mounted with City life and Glow on');
  scene.updates.length = 0;
  q(city.el, 'project-city-life').click();
  assert.deepEqual(scene.updates.map((u) => u.cityLife).filter((v) => v !== undefined), [false], 'update({ cityLife: false })');
  q(city.el, 'project-city-glow').click();
  assert.deepEqual(scene.updates.map((u) => u.glow).filter((v) => v !== undefined), [false], 'update({ glow: false })');
  assert.equal(scene.updates.some((u) => u.layout), false, 'no new layout: the city is not rebuilt');
  assert.equal(scene.mounts.length, 1, 'no second mount');
  city.destroy();
});

test('#450 i18n: the switches\' labels exist in en.json and pt-BR.json, and the header shows them in Portuguese', async () => {
  const en = catalog('en'), pt = catalog('pt-BR');
  for (const k of LABELS) {
    assert.equal(typeof en[k] === 'string' && en[k].trim() !== '', true, `en.json ${k}`);
    assert.equal(typeof pt[k] === 'string' && pt[k].trim() !== '', true, `pt-BR.json ${k}`);
  }
  const I18n = require('@multiagent/shared/i18n.js');
  const was = I18n.getLanguage();
  I18n.setLanguage('pt-BR');
  try {
    const { city } = await openView();
    assert.equal(q(city.el, 'project-city-life')?.getAttribute('aria-label') ?? 'missing', pt['project_city.city_life']);
    assert.equal(q(city.el, 'project-city-glow')?.getAttribute('aria-label') ?? 'missing', pt['project_city.glow']);
    city.destroy();
  } finally {
    I18n.setLanguage(was);
  }
});
