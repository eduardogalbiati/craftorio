// #849, the City's first camera frames the whole city (fronts/analyser/city3d/scene.jsx): cityFrame(layout,
// aspect) is the home camera { target, position, distance } (a 30° perspective looking from position at
// target), the city's ground bounds and the tallest building's top in view with a margin, also before the
// canvas has a size (aspect 0: a 1.6 frame); zoomDistance(distance, direction, homeDistance) is the next
// distance for a HUD zoom click, a fixed share of the distance per click, out past the home view too.
// The layouts come from the real layout (packages/shared/city-layout.js layoutCity on buildCity's model);
// the scene is bundled in memory with esbuild, React and React Three Fiber stubbed (as #373's test does).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const THREE = require('three');
const { buildModel } = require('@multiagent/shared/architecture-model');
const { buildCity } = require('@multiagent/shared/city-model');
const L = require('@multiagent/shared/city-layout');

// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
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

async function sceneWith(t, ...names) {
  const s = await loadScene(t);
  if (!s) return null;
  for (const n of names) assert.equal(typeof s[n], 'function', `scene.jsx exports ${n} (#849)`);
  return s;
}

// ---------- fixtures: real layouts ----------

const PLATE_TOP = 0.95; // fronts/analyser/city3d/props.js: the buildings stand on the district plates
const FOV = 30;
const EDGE = 0.95; // the margin: every framed point inside 95% of the frame
const hash = '22'.repeat(20);

// files [{ path, lines }] → the laid-out city; the .js files are measured (a function per ~15 lines, complexity 2
// each), an .html file is not (its height comes from its lines at the measured complexity per line)
function cityOf(files, plan) {
  const functions = files.filter((f) => f.path.endsWith('.js')).flatMap((f) => Array.from({ length: Math.max(1, Math.round(f.lines / 15)) }, (_, k) => ({ file: f.path, name: `fn${k}`, line: 1 + k, complexity: 2, length: 10 })));
  const facts = buildModel({
    head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
    files: files.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${files.map((f) => `A\t${f.path}`).join('\n')}\n`,
    ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: { tool: 'lizard', metric: 'cyclomatic', functions },
  });
  return L.layoutCity(buildCity({ plan, facts }).model);
}

// (a) one 3,000-line app/index.html among 40 small files (20–150 lines) in four folders
const SMALL = [20, 35, 50, 70, 90, 110, 130, 150];
const FOLDERS_A = ['app', 'src/components', 'src/lib', 'scripts'];
const DOMINANT_FILES = [
  { path: 'app/index.html', lines: 3000 },
  ...Array.from({ length: 40 }, (_, i) => ({ path: `${FOLDERS_A[i % 4]}/f${String(i).padStart(2, '0')}.js`, lines: SMALL[i % SMALL.length] })),
];
const DOMINANT_PLAN = {
  version: 1, project: 'dominant',
  zones: [{ id: 'web', name: 'Web', kind: 'commercial' }, { id: 'core', name: 'Core', kind: 'industrial' }],
  districts: [
    { id: 'app', name: 'App', zone: 'web', include: ['app/**'] },
    { id: 'components', name: 'Components', zone: 'web', include: ['src/components/**'] },
    { id: 'lib', name: 'Lib', zone: 'core', include: ['src/lib/**'] },
    { id: 'scripts', name: 'Scripts', zone: 'core', include: ['scripts/**'] },
  ],
};

// (b) a large project: 405 files in 15 folders, mixed sizes, three zones
const MIXED = [8, 20, 45, 90, 160, 320, 640, 1200, 30, 75];
const FOLDERS_B = Array.from({ length: 15 }, (_, i) => `pkg/m${String(i).padStart(2, '0')}`);
const LARGE_FILES = Array.from({ length: 405 }, (_, i) => ({ path: `${FOLDERS_B[i % 15]}/f${String(i).padStart(3, '0')}.js`, lines: MIXED[(i * 7) % MIXED.length] }));
const LARGE_PLAN = {
  version: 1, project: 'large',
  zones: [{ id: 'a', name: 'A', kind: 'industrial' }, { id: 'b', name: 'B', kind: 'commercial' }, { id: 'c', name: 'C', kind: 'residential' }],
  districts: FOLDERS_B.map((f, i) => ({ id: `m${String(i).padStart(2, '0')}`, name: `M${i}`, zone: ['a', 'b', 'c'][i % 3], include: [`${f}/**`] })),
};

let dominant, large;
const dominantCity = () => (dominant ||= cityOf(DOMINANT_FILES, DOMINANT_PLAN));
const largeCity = () => (large ||= cityOf(LARGE_FILES, LARGE_PLAN));
const tallestOf = (layout) => layout.buildings.reduce((a, b) => (b.h > a.h ? b : a));

// ---------- projection ----------

const groundCorners = (b) => [[b.minX, 0, b.minZ], [b.maxX, 0, b.minZ], [b.minX, 0, b.maxZ], [b.maxX, 0, b.maxZ]];
const topCorners = (t) => { const y = PLATE_TOP + t.h; return [[t.x, y, t.z], [t.x + t.w, y, t.z], [t.x, y, t.z + t.d], [t.x + t.w, y, t.z + t.d]]; };
const footCorners = (t) => [[t.x, PLATE_TOP, t.z], [t.x + t.w, PLATE_TOP, t.z], [t.x, PLATE_TOP, t.z + t.d], [t.x + t.w, PLATE_TOP, t.z + t.d]];

function checkFrame(frame) {
  assert.ok(frame && frame.target && frame.position, 'cityFrame returns { target, position, distance }');
  for (const k of ['x', 'y', 'z']) {
    assert.ok(Number.isFinite(frame.target[k]), `target.${k} is finite: ${frame.target[k]}`);
    assert.ok(Number.isFinite(frame.position[k]), `position.${k} is finite: ${frame.position[k]}`);
  }
  assert.ok(Number.isFinite(frame.distance) && frame.distance > 0, `distance is finite and positive: ${frame.distance}`);
  const d = Math.hypot(frame.position.x - frame.target.x, frame.position.y - frame.target.y, frame.position.z - frame.target.z);
  assert.ok(Math.abs(d - frame.distance) <= 1e-6 * Math.max(1, d), `distance is |position − target|: ${frame.distance} vs ${d}`);
  assert.ok(frame.position.y > frame.target.y, 'the camera looks down on the city');
}

function projector(frame, aspect) {
  const cam = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 100000);
  cam.position.set(frame.position.x, frame.position.y, frame.position.z);
  cam.lookAt(frame.target.x, frame.target.y, frame.target.z);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return ([x, y, z]) => new THREE.Vector3(x, y, z).project(cam);
}

function assertInFrame(frame, aspect, points, label) {
  const project = projector(frame, aspect);
  for (const p of points) {
    const n = project(p);
    assert.ok(n.z < 1, `${label}: (${p.join(', ')}) is in front of the camera (ndc z ${n.z.toFixed(3)})`);
    assert.ok(Math.abs(n.x) <= EDGE && Math.abs(n.y) <= EDGE, `${label}: (${p.map((v) => v.toFixed(1)).join(', ')}) is in the frame with a margin, ndc (${n.x.toFixed(3)}, ${n.y.toFixed(3)}), aspect ${aspect}`);
  }
}

const spanOf = (ns, k) => Math.max(...ns.map((n) => n[k])) - Math.min(...ns.map((n) => n[k]));

// ---------- tests ----------

test('#849 fixture: the 3,000-line index.html is much taller than every other building (precondition)', () => {
  const city = dominantCity();
  assert.equal(city.buildings.length, 41, 'the 41 files are drawn as 41 buildings');
  const t = tallestOf(city);
  assert.equal(t.path, 'app/index.html');
  const second = Math.max(...city.buildings.filter((b) => b !== t).map((b) => b.h));
  assert.ok(t.h >= 3 * second, `the dominant building ${t.h.toFixed(1)} is at least 3× the next one ${second.toFixed(1)}`);
});

test('#849 fixture: the large project is laid out as a big city (precondition)', () => {
  const city = largeCity();
  assert.ok(city.buildings.length >= 300, `the large fixture draws most of its 405 files: ${city.buildings.length}`);
  assert.ok(city.districts.length >= 15, `one district per folder: ${city.districts.length}`);
});

test('#849 cityFrame, one dominant file: the city bounds and the tallest building\'s top are in the frame (aspect 1.6)', async (t) => {
  const s = await sceneWith(t, 'cityFrame');
  if (!s) return;
  const city = dominantCity();
  const frame = s.cityFrame(city, 1.6);
  checkFrame(frame);
  assertInFrame(frame, 1.6, groundCorners(city.bounds), 'a ground corner of the city');
  assertInFrame(frame, 1.6, topCorners(tallestOf(city)), 'a top corner of the tallest building');
});

test('#849 cityFrame, one dominant file: framed in a narrow window (aspect 0.8)', async (t) => {
  const s = await sceneWith(t, 'cityFrame');
  if (!s) return;
  const city = dominantCity();
  const frame = s.cityFrame(city, 0.8);
  checkFrame(frame);
  assertInFrame(frame, 0.8, groundCorners(city.bounds), 'a ground corner of the city');
  assertInFrame(frame, 0.8, topCorners(tallestOf(city)), 'a top corner of the tallest building');
});

test('#849 cityFrame, one dominant file: framed before the canvas has a size (aspect 0 → a 1.6 frame)', async (t) => {
  const s = await sceneWith(t, 'cityFrame');
  if (!s) return;
  const city = dominantCity();
  for (const aspect of [0, undefined]) {
    const frame = s.cityFrame(city, aspect);
    checkFrame(frame);
    assertInFrame(frame, 1.6, groundCorners(city.bounds), `no size yet (${aspect}), a ground corner of the city`);
    assertInFrame(frame, 1.6, topCorners(tallestOf(city)), `no size yet (${aspect}), a top corner of the tallest building`);
  }
});

test('#849 cityFrame, a large project (405 files, 15 folders): the bounds and the tallest top are in the frame', async (t) => {
  const s = await sceneWith(t, 'cityFrame');
  if (!s) return;
  const city = largeCity();
  for (const aspect of [1.6, 0.8]) {
    const frame = s.cityFrame(city, aspect);
    checkFrame(frame);
    assertInFrame(frame, aspect, groundCorners(city.bounds), 'a ground corner of the city');
    assertInFrame(frame, aspect, topCorners(tallestOf(city)), 'a top corner of the tallest building');
  }
});

test('#849 cityFrame: the tallest building does not fill the view and the city is not a speck', async (t) => {
  const s = await sceneWith(t, 'cityFrame');
  if (!s) return;
  const city = dominantCity();
  const frame = s.cityFrame(city, 1.6);
  checkFrame(frame);
  const project = projector(frame, 1.6);
  const tower = [...footCorners(tallestOf(city)), ...topCorners(tallestOf(city))].map(project);
  const towerHeight = spanOf(tower, 'y');
  assert.ok(towerHeight < 1.6, `the tallest building spans less than 80% of the frame's height: ${towerHeight.toFixed(3)} of 2 ndc units`);
  const ground = groundCorners(city.bounds).map(project);
  const groundWidth = spanOf(ground, 'x');
  assert.ok(groundWidth > 0.5, `the city's bounds span a sizeable part of the frame's width: ${groundWidth.toFixed(3)} of 2 ndc units`);
});

test('#849 zoomDistance: a zoom-out click moves the camera away by a fixed share, past the home view too', async (t) => {
  const s = await sceneWith(t, 'zoomDistance');
  if (!s) return;
  const home = 1000;
  const close = s.zoomDistance(100, 'out', home);
  assert.ok(Number.isFinite(close) && close > 0, `finite and positive: ${close}`);
  assert.ok(close >= 115, `from home/10 one click out moves away by at least 15%: ${close}`);
  const past = s.zoomDistance(home, 'out', home);
  assert.ok(Number.isFinite(past) && past > 1150, `from the home view one click out keeps moving away: ${past}`);
});

test('#849 zoomDistance: from home/10, at most 14 zoom-out clicks reach the home distance', async (t) => {
  const s = await sceneWith(t, 'zoomDistance');
  if (!s) return;
  const home = 1000;
  let d = 100;
  let clicks = 0;
  // 20% a click: 1.2^14 ≈ 12.8, past the 10× from home/10 to home
  while (d < home && clicks < 14) {
    const next = s.zoomDistance(d, 'out', home);
    assert.ok(Number.isFinite(next) && next > d, `click ${clicks + 1} moves out: ${d} → ${next}`);
    d = next;
    clicks += 1;
  }
  assert.ok(d >= home, `14 clicks from ${100} reach the home distance ${home}: got ${d}`);
});

test('#849 zoomDistance: a zoom-in click brings the camera closer by at least 15%', async (t) => {
  const s = await sceneWith(t, 'zoomDistance');
  if (!s) return;
  const home = 1000;
  for (const from of [1000, 400, 2000]) {
    const d = s.zoomDistance(from, 'in', home);
    assert.ok(Number.isFinite(d) && d > 0, `finite and positive: ${d}`);
    assert.ok(d <= from * 0.85, `from ${from} one click in comes at least 15% closer: ${d}`);
  }
});
