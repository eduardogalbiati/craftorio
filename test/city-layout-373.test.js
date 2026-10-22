// #373: the layout of the project city, src/shared/city-layout.js (dual load like city-model.js:
// window.CityLayout in the browser, module.exports in Node). Pure and deterministic:
// - squarify(items [{ id, weight }], rect { x, y, w, h }) → [{ id, x, y, w, h }], one cell per item
//   with weight > 0, each cell's area proportional to its weight, filling the rect;
// - layoutCity(model, options?) → { zones, districts, buildings, ports, bounds, aggregated, note? }
//   from the `model` of #371's buildCity: zones as strips in plan order with an avenue between them,
//   each zone a treemap of its districts with streets between them, buildings inside their district
//   (footprint grows with lines, height with complexity), ports outside the zones, small files
//   aggregated per district over 5,000 drawn files. Rects are { x, z, w, d }: x..x+w by z..z+d.
// - defaultColourBy(model), COLOUR_BY, applyOverlay(layout, { highlight, markers }), flyTarget.
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildModel } = require('../src/shared/architecture-model');

const root = path.join(__dirname, '..');
const load = () => require('../src/shared/city-layout.js');
const loadModel = () => require('../src/shared/city-model.js');
const EPS = 1e-6;

// ---------- fixtures: #356 facts and #371 city models ----------

const hash = (n) => String(n).padStart(2, '0').repeat(20);
const at = (day) => `${day}T12:00:00Z`;

const FILES = [
  { path: 'README.md', lines: 4 },
  { path: 'docs/a.md', lines: 5 },
  { path: 'docs/b.md', lines: 5 },
  { path: 'docs/c.md', lines: 5 },
  { path: 'package.json', lines: 12 },
  { path: 'scripts/build.js', lines: 20 },
  { path: 'src/engine/big.js', lines: 400 },
  { path: 'src/engine/small.js', lines: 20 },
  { path: 'src/engine/tall.js', lines: 60 },
  { path: 'src/engine/flat.js', lines: 60 },
  { path: 'src/renderer/app.js', lines: 60 },
  { path: 'src/renderer/views/board.js', lines: 25 },
  { path: 'src/renderer/views/kanban.js', lines: 25 },
  { path: 'src/renderer/views/list.js', lines: 25 },
  { path: 'src/shared/globs.js', lines: 15 },
];

const LOG = `\x01${hash(1)} ${at('2026-01-05')}\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`;

const COMPLEXITY = {
  tool: 'lizard',
  metric: 'cyclomatic',
  functions: [
    { file: 'src/engine/big.js', name: 'a', line: 1, complexity: 3, length: 10 },
    { file: 'src/engine/small.js', name: 'a', line: 1, complexity: 3, length: 10 },
    { file: 'src/engine/tall.js', name: 'a', line: 1, complexity: 30, length: 50 },
    { file: 'src/engine/tall.js', name: 'b', line: 52, complexity: 9, length: 5 },
    { file: 'src/engine/flat.js', name: 'a', line: 1, complexity: 1, length: 50 },
  ],
};

function facts({ complexity = COMPLEXITY } = {}) {
  return buildModel({
    head: { commit: hash(1), date: at('2026-01-05') },
    branch: 'main',
    shallow: false,
    window: { since: null, until: null },
    files: FILES.map((f) => ({ ...f })),
    log: LOG,
    ignoreRevs: [],
    attributes: '',
    exclude: [],
    includeMass: true,
    complexity,
  });
}

const PLAN = {
  version: 1,
  project: 'fixture',
  summary: 'A small fixture repository.',
  ignore: [],
  zones: [
    { id: 'core', name: 'Core', kind: 'industrial', purpose: 'Runs the work.' },
    { id: 'ui', name: 'UI', kind: 'commercial', purpose: 'What people see.' },
    { id: 'books', name: 'Books', kind: 'library', purpose: 'Docs and project files.' },
  ],
  districts: [
    { id: 'engine', name: 'Engine', zone: 'core', purpose: 'The engine.', include: ['/src/engine/**'], exclude: [] },
    { id: 'views', name: 'Views', zone: 'ui', purpose: 'The views.', include: ['/src/renderer/views/**'], exclude: [] },
    { id: 'renderer', name: 'Renderer', zone: 'ui', purpose: 'The rest of the UI.', include: ['/src/renderer/**'], exclude: [] },
    { id: 'docs', name: 'Docs', zone: 'books', purpose: 'Markdown.', include: ['*.md'], exclude: [] },
    { id: 'root', name: 'Root', zone: 'books', purpose: 'Root files.', include: ['/*'], exclude: [] },
  ],
  landmarks: [{ path: 'src/engine/big.js', label: 'The big one' }],
  ports: [{ id: 'cli', name: 'CLI', via: ['package.json'] }],
  evidence: ['README.md'],
};

const planModel = (opts) => loadModel().buildCity({ plan: JSON.parse(JSON.stringify(PLAN)), facts: facts(opts) }).model;
const folderModel = () => loadModel().buildCity({ plan: null, facts: facts() }).model;

// a model of n drawn files: the plan model's districts with synthetic buildings spread over them
function bigModel(n) {
  const model = planModel();
  const template = model.buildings.find((b) => b.path === 'src/engine/big.js');
  const districts = model.districts.map((d) => d.id);
  const buildings = Array.from({ length: n }, (_, i) => ({
    ...template,
    path: `gen/d${i % districts.length}/f${String(i).padStart(5, '0')}.js`,
    district: districts[i % districts.length],
    lines: 1 + (i % 50) * (i % 7 === 0 ? 40 : 1),
  }));
  return { ...model, buildings, landmarks: [], ports: [] };
}

// ---------- geometry helpers ----------

const inside = (p, r) => p.x >= r.x - EPS && p.z >= r.z - EPS && p.x <= r.x + r.w + EPS && p.z <= r.z + r.d + EPS;
const contains = (outer, inner) => inner.x >= outer.x - EPS && inner.z >= outer.z - EPS
  && inner.x + inner.w <= outer.x + outer.w + EPS && inner.z + inner.d <= outer.z + outer.d + EPS;
const overlaps = (a, b) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.z < b.z + b.d - EPS && b.z < a.z + a.d - EPS;
// strictly apart: a positive gap on at least one axis
const apart = (a, b) => a.x + a.w < b.x - EPS || b.x + b.w < a.x - EPS || a.z + a.d < b.z - EPS || b.z + b.d < a.z - EPS;
const cellOverlaps = (a, b) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
const pairs = (xs) => xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b]));
const near = (a, b, rel = 1e-6) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

// ---------- the module ----------

test('#373 city-layout.js loads in Node and, in the browser, defines window.CityLayout', () => {
  const api = load();
  for (const name of ['squarify', 'layoutCity', 'defaultColourBy', 'applyOverlay', 'flyTarget']) assert.equal(typeof api[name], 'function', name);
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'src', 'shared', 'city-layout.js'), 'utf8'), sandbox, { filename: 'city-layout.js' });
  assert.equal(typeof sandbox.window.CityLayout?.squarify, 'function');
});

test('#373 city-layout.js is pure: no I/O, no clock, no randomness', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'shared', 'city-layout.js'), 'utf8');
  for (const banned of ["require('fs')", "require('child_process')", "require('net')", "require('http')", "require('https')", 'Date.now', 'new Date(', 'Math.random']) {
    assert.equal(src.includes(banned), false, `city-layout.js uses ${banned}`);
  }
});

test('#373 COLOUR_BY is exactly quadrant, zone, churn', () => {
  assert.deepEqual([...load().COLOUR_BY], ['quadrant', 'zone', 'churn']);
});

// ---------- squarify ----------

const RECT = { x: 10, y: 20, w: 300, h: 200 };
const ITEMS = [
  { id: 'a', weight: 6 }, { id: 'b', weight: 6 }, { id: 'c', weight: 4 },
  { id: 'd', weight: 3 }, { id: 'e', weight: 2 }, { id: 'f', weight: 2 }, { id: 'g', weight: 1 },
];

test('#373 squarify: one cell per item, each inside the rect', () => {
  const cells = load().squarify(ITEMS, RECT);
  assert.deepEqual(cells.map((c) => c.id).sort(), ITEMS.map((i) => i.id).sort());
  for (const c of cells) {
    assert.ok(c.x >= RECT.x - EPS && c.y >= RECT.y - EPS, `${c.id} starts inside`);
    assert.ok(c.x + c.w <= RECT.x + RECT.w + EPS && c.y + c.h <= RECT.y + RECT.h + EPS, `${c.id} ends inside`);
    assert.ok(c.w > 0 && c.h > 0, `${c.id} has an area`);
  }
});

test('#373 squarify: no two cells overlap', () => {
  const cells = load().squarify(ITEMS, RECT);
  for (const [a, b] of pairs(cells)) assert.equal(cellOverlaps(a, b), false, `${a.id} overlaps ${b.id}`);
});

test('#373 squarify: each cell\'s share of the area is its share of the weight, and the cells fill the rect', () => {
  const cells = load().squarify(ITEMS, RECT);
  const total = ITEMS.reduce((s, i) => s + i.weight, 0);
  const area = RECT.w * RECT.h;
  for (const c of cells) {
    const weight = ITEMS.find((i) => i.id === c.id).weight;
    assert.ok(near((c.w * c.h) / area, weight / total), `${c.id}: ${(c.w * c.h) / area} vs ${weight / total}`);
  }
  assert.ok(near(cells.reduce((s, c) => s + c.w * c.h, 0), area), 'the cells fill the rect');
});

test('#373 squarify: empty input gives no cell; one item fills the rect', () => {
  const { squarify } = load();
  assert.deepEqual(squarify([], RECT), []);
  const [cell] = squarify([{ id: 'only', weight: 5 }], RECT);
  assert.equal(cell.id, 'only');
  assert.ok(near(cell.x, RECT.x) && near(cell.y, RECT.y) && near(cell.w, RECT.w) && near(cell.h, RECT.h), JSON.stringify(cell));
});

test('#373 squarify: zero-weight items are dropped', () => {
  const cells = load().squarify([{ id: 'a', weight: 3 }, { id: 'zero', weight: 0 }, { id: 'b', weight: 1 }], RECT);
  assert.deepEqual(cells.map((c) => c.id).sort(), ['a', 'b']);
  assert.ok(near(cells.reduce((s, c) => s + c.w * c.h, 0), RECT.w * RECT.h));
});

test('#373 squarify: the same input gives the same output', () => {
  const { squarify } = load();
  assert.deepEqual(squarify(ITEMS, RECT), squarify(ITEMS, RECT));
});

test('#373 squarify: six equal weights in a square give cells no longer than 3:1', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, weight: 1 }));
  const cells = load().squarify(items, { x: 0, y: 0, w: 60, h: 60 });
  assert.equal(cells.length, 6);
  for (const c of cells) assert.ok(Math.max(c.w / c.h, c.h / c.w) <= 3, `${c.id} is ${c.w}×${c.h}`);
});

// ---------- layoutCity: zones, districts, buildings ----------

const PLAN_ZONES = PLAN.zones.map((z) => z.id);

// #382: the zones fill the city rectangle as the proof of concept's strips (stripLayout, the plan's
// order kept, from the south edge northward), an avenue between any two of them
test('#373 layoutCity: zones come in plan order, each with an area, an avenue between any two of them', () => {
  const layout = load().layoutCity(planModel());
  const zones = layout.zones.filter((z) => PLAN_ZONES.includes(z.id));
  assert.deepEqual(zones.map((z) => z.id), PLAN_ZONES);
  for (const z of layout.zones) assert.ok(z.w > 0 && z.d > 0, `${z.id} has an area`);
  assert.ok(layout.avenueWidth > 0, 'an avenue width');
  const gap = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.z - (a.z + a.d), a.z - (b.z + b.d));
  for (const [a, b] of pairs(layout.zones)) {
    assert.equal(overlaps(a, b), false, `zones ${a.id} and ${b.id} overlap`);
    assert.ok(gap(a, b) >= layout.avenueWidth - EPS, `an avenue between ${a.id} and ${b.id}: ${gap(a, b)} vs ${layout.avenueWidth}`);
  }
});

test('#382 stripLayout: strips from the south edge northward, the order kept, the cells filling the rect', () => {
  const { stripLayout } = load();
  const items = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, weight: 5 - i }));
  const strips = stripLayout(items, RECT);
  const cells = strips.flatMap((s) => s.cells);
  assert.deepEqual(cells.map((c) => c.id), ['a', 'b', 'c', 'd', 'e'], 'the order is kept');
  assert.ok(strips.length >= 2, `${strips.length} strips`);
  assert.ok(near(strips[0].y1, RECT.y + RECT.h), 'the first strip lies on the south edge');
  for (let i = 1; i < strips.length; i++) assert.ok(near(strips[i].y1, strips[i - 1].y0), `strip ${i} sits north of strip ${i - 1}`);
  assert.ok(near(cells.reduce((s, c) => s + c.w * c.h, 0), RECT.w * RECT.h), 'the cells fill the rect');
  for (const [a, b] of pairs(cells)) assert.equal(cellOverlaps(a, b), false, `${a.id} overlaps ${b.id}`);
  assert.deepEqual(stripLayout([], RECT), []);
});

test('#373 layoutCity: each zone carries its kind', () => {
  const layout = load().layoutCity(planModel());
  const kind = Object.fromEntries(layout.zones.map((z) => [z.id, z.kind]));
  assert.equal(kind.core, 'industrial');
  assert.equal(kind.ui, 'commercial');
  assert.equal(kind.books, 'library');
});

test('#373 layoutCity: districts lie inside their zone, with a street between any two of them', () => {
  const layout = load().layoutCity(planModel());
  const zone = Object.fromEntries(layout.zones.map((z) => [z.id, z]));
  for (const d of layout.districts) {
    assert.ok(zone[d.zone], `district ${d.id} has a zone ${d.zone}`);
    assert.ok(contains(zone[d.zone], d), `district ${d.id} lies inside zone ${d.zone}`);
  }
  for (const [a, b] of pairs(layout.districts)) {
    if (a.zone === b.zone) assert.ok(apart(a, b), `districts ${a.id} and ${b.id} are apart`);
  }
  assert.deepEqual(['books', 'core', 'ui'].map((id) => layout.districts.filter((d) => d.zone === id).length > 0), [true, true, true]);
});

test('#373 layoutCity: every building lies inside its district, one per drawn file', () => {
  const model = planModel();
  const layout = load().layoutCity(model);
  const district = Object.fromEntries(layout.districts.map((d) => [d.id, d]));
  assert.deepEqual(layout.buildings.map((b) => b.path).sort(), model.buildings.map((b) => b.path).sort());
  for (const b of layout.buildings) {
    assert.ok(district[b.district], `${b.path} has a district`);
    assert.ok(contains(district[b.district], b), `${b.path} lies inside ${b.district}`);
    assert.ok(b.w > 0 && b.d > 0 && b.h > 0, `${b.path} has a size`);
  }
});

test('#373 layoutCity: more lines, a larger footprint; more complexity, a taller building', () => {
  const layout = load().layoutCity(planModel());
  const b = Object.fromEntries(layout.buildings.map((x) => [x.path, x]));
  const foot = (p) => b[p].w * b[p].d;
  assert.ok(foot('src/engine/big.js') > foot('src/engine/small.js'), `400 lines ${foot('src/engine/big.js')} vs 20 lines ${foot('src/engine/small.js')}`);
  assert.ok(b['src/engine/tall.js'].h > b['src/engine/flat.js'].h, `complexity 39 ${b['src/engine/tall.js'].h} vs 1 ${b['src/engine/flat.js'].h}`);
});

test('#449 layoutCity: the mast follows the worst function (a quarter of it from 8), none under it', () => {
  const b = Object.fromEntries(load().layoutCity(planModel()).buildings.map((x) => [x.path, x]));
  assert.ok(near(b['src/engine/tall.js'].antenna, 7.5), `worst 30: ${b['src/engine/tall.js'].antenna}`);
  assert.equal(b['src/engine/big.js'].antenna, 0, 'worst 3: no mast');
  assert.equal(b['README.md'].antenna, 0, 'not measured: no mast');
});

test('#449 layoutCity: each building carries its score from `scores`, null without one', () => {
  const b = Object.fromEntries(load().layoutCity(planModel(), { scores: { 'src/engine/tall.js': 42, 'src/engine/flat.js': 0 } }).buildings.map((x) => [x.path, x]));
  assert.equal(b['src/engine/tall.js'].score, 42);
  assert.equal(b['src/engine/flat.js'].score, 0, 'a zero score is kept');
  assert.equal(b['src/engine/big.js'].score, null);
  assert.equal(load().layoutCity(planModel()).buildings.every((x) => x.score === null), true, 'no scores: every score null');
});

test('#373 layoutCity: unmatched files land in the outskirts district', () => {
  const layout = load().layoutCity(planModel());
  assert.ok(layout.districts.some((d) => d.id === 'outskirts'), 'an outskirts district');
  const of = Object.fromEntries(layout.buildings.map((b) => [b.path, b.district]));
  assert.equal(of['scripts/build.js'], 'outskirts');
  assert.equal(of['src/shared/globs.js'], 'outskirts');
});

test('#373 layoutCity: ports sit at the edge, outside every zone, with their via files', () => {
  const layout = load().layoutCity(planModel());
  assert.deepEqual(layout.ports.map((p) => p.id), ['cli']);
  const [port] = layout.ports;
  assert.deepEqual([...port.via], ['package.json']);
  for (const z of layout.zones) assert.equal(inside(port, z), false, `port inside zone ${z.id}`);
});

test('#373 layoutCity: bounds enclose every zone', () => {
  const { bounds, zones } = load().layoutCity(planModel());
  for (const z of zones) {
    assert.ok(z.x >= bounds.minX - EPS && z.x + z.w <= bounds.maxX + EPS, `${z.id} within x bounds`);
    assert.ok(z.z >= bounds.minZ - EPS && z.z + z.d <= bounds.maxZ + EPS, `${z.id} within z bounds`);
  }
});

test('#373 layoutCity is deterministic', () => {
  const { layoutCity } = load();
  assert.deepEqual(layoutCity(planModel()), layoutCity(planModel()));
});

test('#373 layoutCity lays out a folder city (no plan) too', () => {
  const model = folderModel();
  const layout = load().layoutCity(model);
  const district = Object.fromEntries(layout.districts.map((d) => [d.id, d]));
  assert.equal(layout.buildings.length, model.buildings.length);
  for (const b of layout.buildings) assert.ok(district[b.district] && contains(district[b.district], b), `${b.path} inside ${b.district}`);
  for (const [a, b] of pairs(layout.zones)) assert.equal(overlaps(a, b), false, `zones ${a.id} and ${b.id} overlap`);
});

// ---------- over 5,000 files ----------

test('#373 layoutCity: over 5,000 drawn files, small files are aggregated per district with a note', () => {
  const layout = load().layoutCity(bigModel(5200));
  assert.equal(layout.aggregated, true);
  assert.equal(typeof layout.note, 'string');
  assert.ok(layout.note.length > 0, 'a note says so');
  assert.ok(layout.buildings.length < 5200, `${layout.buildings.length} buildings`);
});

test('#373 layoutCity: at 5,000 drawn files, nothing is aggregated: one building per file', () => {
  const layout = load().layoutCity(bigModel(5000));
  assert.equal(layout.aggregated, false);
  assert.equal(layout.buildings.length, 5000);
});

// ---------- colour by ----------

test('#373 defaultColourBy: quadrant when complexity was measured, zone otherwise', () => {
  const { defaultColourBy } = load();
  assert.equal(defaultColourBy(planModel()), 'quadrant');
  assert.equal(defaultColourBy(planModel({ complexity: null })), 'zone');
});

// ---------- the overlay API ----------

test('#373 applyOverlay: highlighted files get their colour, every other building is greyed', () => {
  const { layoutCity, applyOverlay } = load();
  const layout = layoutCity(planModel());
  const out = applyOverlay(layout, { highlight: { 'src/engine/big.js': '#ff0000', 'docs/a.md': '#00ff00' }, markers: [] });
  const of = Object.fromEntries(out.buildings.map((b) => [b.path, { colour: b.colour, greyed: b.greyed }]));
  assert.deepEqual(of['src/engine/big.js'], { colour: '#ff0000', greyed: false });
  assert.deepEqual(of['docs/a.md'], { colour: '#00ff00', greyed: false });
  assert.equal(out.buildings.length, layout.buildings.length);
  for (const b of out.buildings) {
    if (!['src/engine/big.js', 'docs/a.md'].includes(b.path)) assert.equal(b.greyed, true, `${b.path} is greyed`);
  }
});

test('#373 applyOverlay: with no highlight nothing is greyed', () => {
  const { layoutCity, applyOverlay } = load();
  const out = applyOverlay(layoutCity(planModel()), { highlight: {}, markers: [] });
  assert.deepEqual(out.buildings.filter((b) => b.greyed).map((b) => b.path), []);
});

test('#373 applyOverlay: a marker sits on its building\'s roof; one for an unknown path is dropped', () => {
  const { layoutCity, applyOverlay } = load();
  const layout = layoutCity(planModel());
  const out = applyOverlay(layout, { highlight: {}, markers: ['src/engine/tall.js', 'nowhere/missing.js'] });
  assert.deepEqual(out.markers.map((m) => m.path), ['src/engine/tall.js']);
  const [m] = out.markers;
  const b = layout.buildings.find((x) => x.path === 'src/engine/tall.js');
  assert.ok(near(m.y, b.h), `marker at y ${m.y}, roof at ${b.h}`);
  assert.ok(inside(m, b), `marker ${m.x},${m.z} inside the footprint`);
});

test('#373 flyTarget: a file or a district gives a point inside it; an unknown name gives null', () => {
  const { layoutCity, flyTarget } = load();
  const layout = layoutCity(planModel());
  const b = layout.buildings.find((x) => x.path === 'src/engine/big.js');
  const d = layout.districts.find((x) => x.id === 'views');
  const toFile = flyTarget(layout, 'src/engine/big.js');
  const toDistrict = flyTarget(layout, 'views');
  assert.ok(toFile && inside(toFile, b), JSON.stringify(toFile));
  assert.ok(toDistrict && inside(toDistrict, d), JSON.stringify(toDistrict));
  assert.equal(flyTarget(layout, 'no/such/file.js'), null);
});
