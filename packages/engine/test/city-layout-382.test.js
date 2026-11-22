// #382: the proof of concept's layout rules in packages/shared/city-layout.js, as pure functions: the gap
// around a building inside its cell (gapOf), the height scale (heightOf: √complexity, the lines at
// the measured complexity per line when nothing measured the file, campus files lower), the ledges
// (ledgesOf: a few, never one per floor), the weight on the ground (weightOf), and on a laid-out
// city: streets between the buildings of a district, raised plates apart from each other, and a
// height range that separates small, medium and tall files. The screenshot mode city-large draws
// this repository with the POC's plan.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildModel } = require('@craftorio/shared/architecture-model');
const { buildCity } = require('@craftorio/shared/city-model');
const L = require('@craftorio/shared/city-layout');

const EPS = 1e-6;
const hash = '11'.repeat(20);
const lines = (i) => [8, 20, 45, 90, 160, 320, 640, 1200][i % 8];
const FILES = Array.from({ length: 48 }, (_, i) => ({ path: `src/${['engine', 'ui', 'shared'][i % 3]}/f${String(i).padStart(2, '0')}.js`, lines: lines(i) }));
const COMPLEXITY = { tool: 'lizard', metric: 'cyclomatic', functions: FILES.flatMap((f, i) => Array.from({ length: 1 + (i % 9) }, (_, k) => ({ file: f.path, name: `fn${k}`, line: 1 + k, complexity: 1 + (i % 7) * 4, length: 10 }))) };
const facts = (complexity = COMPLEXITY) => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity,
});
const PLAN = {
  version: 1, project: 'fixture',
  zones: [{ id: 'core', name: 'Core', kind: 'industrial' }, { id: 'ui', name: 'UI', kind: 'commercial' }],
  districts: [{ id: 'engine', name: 'Engine', zone: 'core', include: ['src/engine/**'] }, { id: 'shared', name: 'Shared', zone: 'core', include: ['src/shared/**'] }, { id: 'views', name: 'Views', zone: 'ui', include: ['src/ui/**'] }],
};
const city = (complexity) => L.layoutCity(buildCity({ plan: PLAN, facts: facts(complexity) }).model);
const apart = (a, b) => a.x + a.w < b.x - EPS || b.x + b.w < a.x - EPS || a.z + a.d < b.z - EPS || b.z + b.d < a.z - EPS;
const pairs = (xs) => xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b]));

test('#382 gapOf: the POC gap, less in a small cell, never more than 22% of a side', () => {
  assert.equal(L.gapOf(10, 10), L.GAP);
  assert.equal(L.GAP, 0.8);
  assert.ok(Math.abs(L.gapOf(2, 10) - 0.44) < EPS, 'a narrow cell: 22% of its width');
  assert.ok(Math.abs(L.gapOf(10, 1) - 0.22) < EPS, 'a shallow cell: 22% of its depth');
  assert.equal(L.gapOf(10, 10, 0.4), 0.4, 'a scaled gap');
});

test('#382 heightOf: 1 + 1.25 × √complexity; the lines × the complexity per line when nothing is measured; campus files lower', () => {
  assert.ok(Math.abs(L.heightOf({ complexity: 16 }) - 6) < EPS);
  assert.ok(Math.abs(L.heightOf({ complexity: 0 }) - 1) < EPS);
  const unmeasured = L.heightOf({ complexity: null, lines: 100 }, { perLine: 0.16 });
  assert.ok(Math.abs(unmeasured - 6) < EPS, `100 lines at 0.16 per line: ${unmeasured}`);
  assert.ok(L.heightOf({ complexity: null, lines: 100 }, { perLine: 0.16, campus: true }) < unmeasured, 'a campus file is lower');
  assert.ok(L.heightOf({ complexity: 25 }) < L.heightOf({ complexity: 100 }), 'taller with the complexity');
  assert.ok(L.heightOf({ complexity: 100 }) - L.heightOf({ complexity: 25 }) < L.heightOf({ complexity: 25 }) - L.heightOf({ complexity: 0 }) + 10, 'a square-root scale, not linear');
});

test('#382 perLineOf: the measured complexity over the measured lines, the POC default when nothing is measured', () => {
  assert.ok(Math.abs(L.perLineOf([{ complexity: 20, lines: 100 }, { complexity: 30, lines: 100 }, { complexity: null, lines: 999 }]) - 0.25) < EPS);
  assert.equal(L.perLineOf([{ complexity: null, lines: 10 }]), 0.12);
});

test('#382 ledgesOf: the functions less one, at most LEDGES_MAX; from the lines when nothing is measured', () => {
  assert.equal(L.LEDGES_MAX, 6);
  assert.equal(L.ledgesOf({ functions: 1 }), 0);
  assert.equal(L.ledgesOf({ functions: 4 }), 3);
  assert.equal(L.ledgesOf({ functions: 40 }), 6, 'never one per floor');
  assert.equal(L.ledgesOf({ functions: null, lines: 45 * 3 }), 2);
  assert.equal(L.ledgesOf({ functions: null, lines: 45 * 30 }), 6);
});

test('#382 weightOf: (lines + 15)^0.85, half for a campus file', () => {
  assert.ok(Math.abs(L.weightOf({ lines: 85 }) - 100 ** 0.85) < EPS);
  assert.ok(Math.abs(L.weightOf({ lines: 85 }, true) - (100 ** 0.85) / 2) < EPS);
});

test('#382 a laid-out district: a gap between any two of its buildings, and the buildings inside the plate', () => {
  const layout = city();
  const plate = Object.fromEntries(layout.districts.map((d) => [d.id, d]));
  for (const d of layout.districts) {
    const own = layout.buildings.filter((b) => b.district === d.id);
    assert.ok(own.length >= 10, `${d.id} has buildings`);
    for (const [a, b] of pairs(own)) assert.ok(apart(a, b), `${a.path} and ${b.path} touch`);
    for (const b of own) assert.ok(b.x > plate[d.id].x + EPS && b.z > plate[d.id].z + EPS && b.x + b.w < plate[d.id].x + plate[d.id].w - EPS, `${b.path} is clear of the plate's edge`);
  }
});

test('#382 the plates of a zone are apart by a street, and the zones by an avenue', () => {
  const layout = city();
  for (const [a, b] of pairs(layout.districts)) {
    if (a.zone !== b.zone) continue;
    const gap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.z - (a.z + a.d), a.z - (b.z + b.d));
    assert.ok(gap >= L.STREET * layout.scale - EPS, `a street between ${a.id} and ${b.id}: ${gap}`);
  }
  for (const [a, b] of pairs(layout.zones)) {
    const gap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.z - (a.z + a.d), a.z - (b.z + b.d));
    assert.ok(gap >= layout.avenueWidth - EPS, `an avenue between ${a.id} and ${b.id}: ${gap}`);
  }
  assert.ok(layout.ring.w > 0 && layout.avenues.length >= 1, 'the ring road and the avenues');
});

test('#382 the height range separates small, medium and tall files, with a few ledges each', () => {
  const layout = city();
  const hs = layout.buildings.map((b) => b.h).sort((a, b) => a - b);
  const p = (k) => hs[Math.floor((hs.length - 1) * k)];
  assert.ok(p(0.9) > 2 * p(0.1), `the tall ones stand out: p10 ${p(0.1)}, p90 ${p(0.9)}`);
  assert.ok(hs[hs.length - 1] > 1.5 * p(0.5), 'the tallest above the median');
  for (const b of layout.buildings) assert.ok(b.ledges >= 0 && b.ledges <= L.LEDGES_MAX, `${b.path}: ${b.ledges} ledges`);
  assert.ok(layout.buildings.some((b) => b.ledges > 0), 'some ledges');
  // nothing measured: the heights follow the lines, still a range
  const unmeasured = city(null).buildings.map((b) => b.h).sort((a, b) => a - b);
  assert.ok(unmeasured[unmeasured.length - 1] > 2 * unmeasured[Math.floor(unmeasured.length / 2)]);
});

test('#382 colourBy zone: a tint per zone kind, with the kind in the legend; quadrant: campus files quieter', () => {
  const layout = city();
  const { colours, legend } = L.colourBy(layout, 'zone');
  assert.deepEqual(legend.map((l) => l.sub), ['industrial', 'commercial']);
  assert.equal(new Set(colours).size, 2);
  const test = { ...layout, buildings: [{ path: 'test/a.test.js', quadrant: null, test: true }, { path: 'src/b.js', quadrant: null, test: false }] };
  const q = L.colourBy(test, 'quadrant');
  assert.notEqual(q.colours[0], q.colours[1], 'a test file and an unmeasured file differ');
  assert.ok(q.legend.some((l) => l.label === 'Tests'));
});

test('#382 the screenshot runner offers the city-large mode: this repository with the POC\'s plan', () => {
  const { VIEWS, parseArgs } = require('../../../scripts/screenshot');
  assert.ok(VIEWS.project.modes.includes('city-large'), VIEWS.project.modes.join(', '));
  assert.equal(parseArgs(['--view', 'project', '--tab', 'architecture', '--mode', 'city-large']).name, 'project-architecture-city-large');
});
