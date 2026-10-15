// #373, the City scene's pure helpers (src/renderer/city3d/scene.jsx): homeOf, the home view's
// distance for the city's bounds and the frame's aspect, and focusOf, what a hovered or pinned
// building or district lights and the arcs to what it requires and to what requires it. The scene is
// bundled in memory with esbuild (three included); React and React Three Fiber are only used while
// rendering, so they are stubbed here.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
let cached;

async function loadScene(t) {
  if (cached) return cached;
  let esbuild;
  try { esbuild = require('esbuild'); } catch { t.skip('esbuild is not installed'); return null; }
  const out = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'renderer', 'city3d', 'scene.jsx')],
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: { '.jsx': 'jsx' },
    external: ['react', 'react/jsx-runtime', '@react-three/fiber'], logLevel: 'silent',
  });
  const hook = () => new Proxy(() => {}, { get: () => () => {} });
  const stubs = { react: hook(), 'react/jsx-runtime': hook(), '@react-three/fiber': hook() };
  const m = new Module(path.join(ROOT, 'src', 'renderer', 'city3d', 'scene.bundle.js'));
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
