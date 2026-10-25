// #373, the City scene's pure helpers (fronts/analyser/city3d/scene.jsx): homeOf, the home view's
// distance for the city's bounds and the frame's aspect, and focusOf, what a hovered or pinned
// building or district lights and the arcs to what it requires and to what requires it. The scene is
// bundled in memory with esbuild (three included); React and React Three Fiber are only used while
// rendering, so they are stubbed here.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const Module = require('module');

const ROOT = path.join(__dirname, '..', '..', '..');
let cached;

async function loadScene(t) {
  if (cached) return cached;
  let esbuild;
  try { esbuild = require('esbuild'); } catch { t.skip('esbuild is not installed'); return null; }
  const out = await esbuild.build({
    entryPoints: [pageFileOf('city3d/scene.jsx')],
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: { '.jsx': 'jsx' },
    external: ['react', 'react/jsx-runtime', '@react-three/fiber'], logLevel: 'silent',
  });
  const hook = () => new Proxy(() => {}, { get: () => () => {} });
  const stubs = { react: hook(), 'react/jsx-runtime': hook(), '@react-three/fiber': hook() };
  const m = new Module(path.join(path.dirname(pageFileOf('city3d/scene.jsx')), 'scene.bundle.js'));
  m.require = (id) => stubs[id] || require(id);
  m._compile(out.outputFiles[0].text, m.id);
  cached = m.exports;
  return cached;
}

// a small city laid out by hand: two districts, three buildings
const LAYOUT = {
  districts: [{ id: 'engine', zone: 'core', x: 0, z: 0, w: 10, d: 10 }, { id: 'ui', zone: 'core', x: 12, z: 0, w: 10, d: 10 }],
  buildings: [
    { path: 'src/a.js', district: 'engine', x: 1, z: 1, w: 2, d: 2, h: 3 },
    { path: 'src/b.js', district: 'engine', x: 5, z: 5, w: 2, d: 2, h: 5 },
    { path: 'ui/c.js', district: 'ui', x: 13, z: 1, w: 2, d: 2, h: 4 },
  ],
};
const relations = (map) => (kind, id) => map[`${kind}:${id}`] || { requires: [], requiredBy: [] };

test('#373 homeOf: a bigger city gets a farther home view, in proportion', async (t) => {
  const s = await loadScene(t);
  if (!s) return;
  const small = s.homeOf({ minX: 0, maxX: 200, minZ: 0, maxZ: 200 }, 1.6);
  const big = s.homeOf({ minX: 0, maxX: 400, minZ: 0, maxZ: 400 }, 1.6);
  assert.ok(small > 0 && Number.isFinite(small));
  assert.ok(Math.abs(big / small - 2) < 1e-9, `${big} / ${small} should be 2`);
});

test('#373 homeOf: a tiny city keeps a minimum distance, a wide frame never needs a farther view', async (t) => {
  const s = await loadScene(t);
  if (!s) return;
  const none = s.homeOf({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, 1.6);
  const tiny = s.homeOf({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, 1.6);
  assert.ok(none > 0);
  assert.equal(none, tiny, 'both at the minimum');
  const b = { minX: -150, maxX: 150, minZ: -80, maxZ: 80 };
  assert.ok(s.homeOf(b, 2.5) <= s.homeOf(b, 1), 'a wider frame fits the city from as close or closer');
  assert.ok(Number.isFinite(s.homeOf(b, 0)), 'no aspect yet (a zero-size canvas) still gives a distance');
});

test('#373 focusOf: nothing hovered, or an unknown building, lights nothing', async (t) => {
  const s = await loadScene(t);
  if (!s) return;
  assert.equal(s.focusOf(LAYOUT, null, relations({})), null);
  assert.equal(s.focusOf(LAYOUT, { kind: 'building', id: 'no/such.js' }, relations({})), null);
});

test('#373 focusOf: a building lights itself and its relations, with an arc each way', async (t) => {
  const s = await loadScene(t);
  if (!s) return;
  const rel = relations({ 'building:src/a.js': { requires: ['src/b.js', 'gone/x.js'], requiredBy: ['ui/c.js'] } });
  const f = s.focusOf(LAYOUT, { kind: 'building', id: 'src/a.js' }, rel);
  assert.deepEqual([...f.lit].sort(), [0, 1, 2]);
  assert.ok(f.requires.length > 0, 'an arc to what it requires');
  assert.ok(f.requiredBy.length > 0, 'an arc from what requires it');
  const alone = s.focusOf(LAYOUT, { kind: 'building', id: 'ui/c.js' }, relations({}));
  assert.deepEqual([...alone.lit], [2], 'a building with no relations lights only itself');
  assert.equal(alone.requires.length, 0);
  assert.equal(alone.requiredBy.length, 0);
});

test('#373 focusOf: a district with edges lights the buildings of the districts it relates to; without edges, nothing', async (t) => {
  const s = await loadScene(t);
  if (!s) return;
  const f = s.focusOf(LAYOUT, { kind: 'district', id: 'engine' }, relations({ 'district:engine': { requires: ['ui'], requiredBy: [] } }));
  assert.deepEqual([...f.lit].sort(), [0, 1, 2]);
  assert.ok(f.requires.length > 0);
  assert.equal(f.requiredBy.length, 0);
  assert.equal(s.focusOf(LAYOUT, { kind: 'district', id: 'engine' }, relations({})), null, 'no district edges (a language without them): no focus');
});

// #449, the v2 buildings in the scene: buildingsOf gives each file its building (city-buildings.js),
// a complex measured against its own district's median footprint
const lot = (o) => ({ complexity: 200, functions: 60, lines: 900, quadrant: null, test: false, worst: null, churn: 0, ...o });
const V2 = {
  districts: [{ id: 'engine', zone: 'core', x: 0, z: 0, w: 60, d: 60 }, { id: 'ui', zone: 'core', x: 70, z: 0, w: 60, d: 60 }],
  buildings: [
    lot({ path: 'src/big.js', district: 'engine', x: 0, z: 0, w: 12, d: 12, h: 10 }),
    lot({ path: 'src/s1.js', district: 'engine', x: 20, z: 0, w: 6, d: 6, h: 8, complexity: 60, functions: 20 }),
    lot({ path: 'src/s2.js', district: 'engine', x: 30, z: 0, w: 6, d: 6, h: 8, complexity: 60, functions: 20 }),
    lot({ path: 'ui/big.js', district: 'ui', x: 70, z: 0, w: 12, d: 12, h: 10 }),
    lot({ path: 'ui/peer.js', district: 'ui', x: 90, z: 0, w: 12, d: 12, h: 10 }),
  ],
};

test('#449 buildingsOf: one building per file, in order, the same list for the same layout; none without a layout', async (t) => {
  const s = await loadScene(t);
  if (!s) return;
  const list = s.buildingsOf(V2);
  assert.equal(list.length, V2.buildings.length);
  for (const x of list) assert.ok(x.parts.length > 0 && Number.isFinite(x.top), 'parts and a top');
  assert.equal(s.buildingsOf(V2) === list, true, 'computed once per layout');
  assert.deepEqual(s.buildingsOf(null), []);
});

test('#449 buildingsOf: a footprint three times its district\'s median is a complex; among peers of its size it is not', async (t) => {
  const s = await loadScene(t);
  if (!s) return;
  const kinds = s.buildingsOf(V2).map((x) => x.kind);
  assert.equal(kinds[0], 'complex', 'src/big.js among 6 × 6 neighbours');
  assert.notEqual(kinds[3], 'complex', 'ui/big.js among 12 × 12 neighbours');
  assert.deepEqual([kinds[1], kinds[2]], ['block', 'block']);
});

test('#449 focusOf: given the buildings\' tops, the arcs leave from the roofs and the lit roofs are named', async (t) => {
  const s = await loadScene(t);
  if (!s) return;
  const rel = relations({ 'building:src/a.js': { requires: ['src/b.js'], requiredBy: ['ui/c.js'] } });
  const high = (f) => Math.max(...f.requires.filter((_, k) => k % 3 === 1));
  const plain = s.focusOf(LAYOUT, { kind: 'building', id: 'src/a.js' }, rel);
  const topped = s.focusOf(LAYOUT, { kind: 'building', id: 'src/a.js' }, rel, [30, 40, 35]);
  assert.ok(high(topped) > high(plain), `an arc between taller roofs rises higher: ${high(topped)} vs ${high(plain)}`);
  assert.deepEqual({ centre: [...topped.roofs.centre], to: [...topped.roofs.to], from: [...topped.roofs.from] }, { centre: [0], to: [1], from: [2] });
});
