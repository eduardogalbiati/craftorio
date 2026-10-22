// #450, the project city's street life: props.js (propsOf, carsOf, lawnsOf, lifeCount: the same city
// for the same layout, the lawns' trees lower than the district's lowest building, nothing counted with
// City life off), the sky's and the stars' shaders converting to the output's colour space
// (geometry.js), and main.jsx's pause while the element is off screen or the window is hidden (a fake
// IntersectionObserver and document; React's root is a stub that keeps the element it is given, so
// the test reads the store App renders from).
// The city3d modules are bundled in memory with esbuild (three included), as in city-life-450.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const CITY3D = path.join(ROOT, 'src', 'renderer', 'city3d');

const noop = () => {};
const proxy = (extra = {}) => new Proxy(() => {}, { get: (_t, k) => (k in extra ? extra[k] : () => {}) });
const rendered = []; // what main.jsx hands React's root, per mount
function stubFor(id) {
  if (id === 'react-dom/client') return proxy({ createRoot: () => ({ render: (el) => rendered.push(el), unmount: noop }) });
  if (id === 'react/jsx-runtime') { const jsx = (type, props) => ({ type, props }); return proxy({ jsx, jsxs: jsx, Fragment: 'fragment' }); }
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
  globalThis.window ||= {};
  globalThis.window.Run3DTheme ||= require('../src/renderer/run3d-theme.js');
  globalThis.t ||= require('../src/shared/i18n.js').t;
  const m = new Module(path.join(CITY3D, `${file}.bundle.js`));
  m.require = (id) => (/^(react|react-dom|@react-three|postprocessing)(\/|$)/.test(id) ? stubFor(id) : require(id));
  m._compile(out.outputFiles[0].text, m.id);
  bundles.set(file, m.exports);
  return m.exports;
}

// a city laid out by hand: one zone with two avenues, one district whose buildings leave a lawn in front
const layout = () => ({
  scale: 1, avenueWidth: 16,
  zones: [{ id: 'core', x: -10, z: -10, w: 100, d: 100, cell: { x: -10, z: -10, w: 100, d: 100 } }],
  districts: [{ id: 'engine', zone: 'core', x: 0, z: 0, w: 60, d: 60, cell: { x: -3, z: -3, w: 66, d: 66 } }],
  buildings: [
    { path: 'src/a.js', district: 'engine', x: 2, z: 2, w: 6, d: 6, h: 4, complexity: 10, functions: 2, lines: 50, test: false },
    { path: 'src/b.js', district: 'engine', x: 12, z: 2, w: 6, d: 12, h: 10, complexity: 60, functions: 20, lines: 300, test: false },
  ],
  avenues: [{ axis: 'x', x: -10, z: -18, length: 100 }, { axis: 'z', x: -18, z: -10, length: 100 }],
  landmarks: [], ports: [],
});

test('#450 props.js: the same layout always gives the same props and cars', async (t) => {
  const p = await bundle(t, 'props.js');
  if (!p) return;
  const a = layout(), b = layout();
  assert.ok(p.propsOf(a).length > 0, 'the city has props');
  assert.ok(p.carsOf(a).length > 0, 'the avenues have cars');
  assert.equal(JSON.stringify(p.propsOf(b)), JSON.stringify(p.propsOf(a)), 'props: the same for an equal layout');
  assert.equal(JSON.stringify(p.carsOf(b)), JSON.stringify(p.carsOf(a)), 'cars: the same for an equal layout');
  assert.equal(JSON.stringify(p.lawnsOf(b)), JSON.stringify(p.lawnsOf(a)), 'lawns: the same for an equal layout');
});

test('#450 props.js: a lawn lies in front of the buildings, and its trees stay lower than the district\'s lowest building', async (t) => {
  const p = await bundle(t, 'props.js');
  if (!p) return;
  const L = layout();
  const [lawn] = p.lawnsOf(L);
  assert.equal(lawn === null || lawn === undefined, false, 'the district has a lawn');
  assert.ok(lawn.z >= 14, `the lawn (z ${lawn.z}) starts south of the buildings (their front at z 14)`);
  const inLawn = (q) => q.x >= lawn.x && q.x <= lawn.x + lawn.w && q.z >= lawn.z && q.z <= lawn.z + lawn.d;
  const crowns = p.propsOf(L).filter((q) => q.role === 'leaf' && inLawn(q));
  assert.ok(crowns.length > 0, 'the lawn has trees');
  const roof = p.PLATE_TOP + 4; // the lowest building, 4 high, stands on the plate
  for (const c of crowns) assert.ok(c.y + c.h < roof, `a lawn tree's top (${(c.y + c.h).toFixed(2)}) is below the lowest roof (${roof})`);
  assert.equal(p.propsOf(L).filter((q) => q.role === 'bench' && inLawn(q)).length, 1, 'one bench on the lawn');
});

test('#450 props.js lifeCount: 0 with City life off; on, one per prop part, car and lamp pool', async (t) => {
  const p = await bundle(t, 'props.js');
  if (!p) return;
  const L = layout();
  assert.equal(p.lifeCount(L, false), 0);
  assert.equal(p.lifeCount(null, true), 0, 'no layout, nothing');
  const props = p.propsOf(L), pools = props.filter((q) => q.role === 'lamp').length;
  assert.ok(pools > 0, 'the city has lamps');
  assert.equal(p.lifeCount(L, true), props.length + p.carsOf(L).length + pools);
});

test('#450 geometry.js: the sky dome and the stars convert to the output\'s colour space', async (t) => {
  const g = await bundle(t, 'geometry.js');
  if (!g) return;
  assert.equal(g.skyMaterial().fragmentShader.includes('#include <colorspace_fragment>'), true, 'the sky');
  const [geo, mat] = g.stars(8, { uTime: { value: 0 } });
  assert.equal(mat.fragmentShader.includes('#include <colorspace_fragment>'), true, 'the stars');
  assert.equal(geo.getAttribute('position').count, 8);
});

test('#450 main.jsx: stats().props counts the life props, 0 once City life is switched off', async (t) => {
  if (!(await bundle(t, 'main.jsx'))) return;
  const h = globalThis.window.ProjectCityScene.mount({}, { layout: layout(), paint: { colours: ['#888888', '#888888'], greyed: [false, false] }, theme: 'dark' });
  assert.ok(h.stats().props > 0, 'City life on: props shown');
  h.update({ cityLife: false });
  assert.equal(h.stats().props, 0);
  h.update({ cityLife: true });
  assert.ok(h.stats().props > 0, 'back on');
  h.unmount();
});

test('#450 main.jsx: City life pauses while the element is off screen or the window hidden, and unmount lets both go', async (t) => {
  if (!(await bundle(t, 'main.jsx'))) return;
  const observers = [], listeners = new Map();
  class FakeObserver {
    constructor(cb) { this.cb = cb; this.watched = []; this.connected = true; observers.push(this); }
    observe(el) { this.watched.push(el); }
    disconnect() { this.connected = false; }
  }
  const page = {
    hidden: false,
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)),
  };
  const saved = { io: globalThis.IntersectionObserver, doc: globalThis.document };
  globalThis.IntersectionObserver = FakeObserver;
  globalThis.document = page;
  t.after(() => { globalThis.IntersectionObserver = saved.io; globalThis.document = saved.doc; });

  const el = { id: 'stage' };
  const before = rendered.length;
  const h = globalThis.window.ProjectCityScene.mount(el, { layout: layout(), paint: { colours: [], greyed: [] }, theme: 'dark' });
  const store = rendered.slice(before).map((e) => e?.props?.store).find(Boolean);
  assert.equal(typeof store?.get, 'function', 'the scene renders from a store');
  assert.equal(observers.length, 1, 'one observer');
  assert.equal(observers[0].watched.length === 1 && observers[0].watched[0] === el, true, 'it watches the element');
  assert.equal(store.get().paused, false, 'on screen: not paused');

  const seen = (on) => observers[0].cb([{ isIntersecting: on }]);
  const shown = (hidden) => { page.hidden = hidden; for (const fn of listeners.get('visibilitychange') || []) fn(); };
  seen(false);
  assert.equal(store.get().paused, true, 'off screen: paused');
  seen(true);
  assert.equal(store.get().paused, false, 'back on screen');
  shown(true);
  assert.equal(store.get().paused, true, 'the window hidden: paused');
  seen(false); shown(false);
  assert.equal(store.get().paused, true, 'visible window, element still off screen: paused');
  seen(true);
  assert.equal(store.get().paused, false);

  h.unmount();
  assert.equal(observers[0].connected, false, 'unmount disconnects the observer');
  assert.equal((listeners.get('visibilitychange') || []).length, 0, 'unmount removes the visibilitychange listener');
});
