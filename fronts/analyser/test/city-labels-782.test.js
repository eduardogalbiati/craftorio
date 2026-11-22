// #782: which floating labels the city shows (packages/shared/city-layout.js labelsShown). Acceptance tests, written
// before the code, on a real layout (buildCity, layoutCity) with a landmark and a port, as city-layout-373.test.js.
//
// The contract these tests assume:
// labelsShown(layout, { hover, pinned, fly }) → { districts: [id], landmarks: [path], ports: [id] }; hover / pinned:
// { kind, id } | null; fly: flyTarget's answer or null.
// - nothing: all empty.
// - building: landmarks has its path when it is a landmark, districts has its district, ports has each port whose
//   `via` includes the path.
// - district: districts has it, nothing else. zone: nothing.
// - pinned and fly add the same way as hover (union, no duplicates).
// - zone labels are not its business: layoutCity keeps zones[].label.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildModel } = require('@craftorio/shared/architecture-model');
const { buildCity } = require('@craftorio/shared/city-model');

const load = () => require('@craftorio/shared/city-layout.js');

const hash = '01'.repeat(20);
const LANDMARK = 'packages/engine/engine/big.js';
const PLAIN = 'packages/engine/engine/small.js';
const DOCK = 'package.json';
const FILES = [
  { path: 'README.md', lines: 4 }, { path: 'docs/a.md', lines: 5 }, { path: DOCK, lines: 12 },
  { path: LANDMARK, lines: 400 }, { path: PLAIN, lines: 20 }, { path: 'packages/engine/engine/flat.js', lines: 60 },
  { path: 'apps/desktop/renderer/views/board.js', lines: 25 }, { path: 'apps/desktop/renderer/views/list.js', lines: 25 },
];
const PLAN = {
  version: 1,
  project: 'fixture',
  zones: [{ id: 'core', name: 'Core', kind: 'industrial' }, { id: 'ui', name: 'UI', kind: 'commercial' }, { id: 'books', name: 'Books', kind: 'library' }],
  districts: [
    { id: 'engine', name: 'Engine', zone: 'core', include: ['/packages/engine/engine/**'] },
    { id: 'views', name: 'Views', zone: 'ui', include: ['/apps/desktop/renderer/views/**'] },
    { id: 'docs', name: 'Docs', zone: 'books', include: ['*.md'] },
    { id: 'root', name: 'Root', zone: 'books', include: ['/*'] },
  ],
  landmarks: [{ path: LANDMARK, label: 'The big one' }],
  ports: [{ id: 'cli', name: 'CLI', via: [DOCK] }, { id: 'npm', name: 'npm', via: [DOCK, PLAIN] }],
};

function layout() {
  const facts = buildModel({
    head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
    files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
    ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
  });
  return load().layoutCity(buildCity({ plan: JSON.parse(JSON.stringify(PLAN)), facts }).model);
}

const building = (id) => ({ kind: 'building', id });
const shown = (on) => {
  const out = load().labelsShown(layout(), { hover: null, pinned: null, fly: null, ...on });
  return { districts: [...out.districts].sort(), landmarks: [...out.landmarks].sort(), ports: [...out.ports].sort() };
};
const NONE = { districts: [], landmarks: [], ports: [] };

test('#782 nothing hovered, pinned or flown to: no label', () => {
  assert.deepEqual(shown({}), NONE);
});

test('#782 a landmark building shows its landmark and its district', () => {
  assert.deepEqual(shown({ hover: building(LANDMARK) }), { districts: ['engine'], landmarks: [LANDMARK], ports: [] });
});

test('#782 a plain building shows only its district', () => {
  assert.deepEqual(shown({ hover: building('packages/engine/engine/flat.js') }), { districts: ['engine'], landmarks: [], ports: [] });
});

test('#782 a building shows each port it is the way to', () => {
  assert.deepEqual(shown({ hover: building(DOCK) }), { districts: ['root'], landmarks: [], ports: ['cli', 'npm'] });
  assert.deepEqual(shown({ hover: building(PLAIN) }), { districts: ['engine'], landmarks: [], ports: ['npm'] });
});

test('#782 a district shows its label and nothing else', () => {
  assert.deepEqual(shown({ hover: { kind: 'district', id: 'engine' } }), { districts: ['engine'], landmarks: [], ports: [] });
});

test('#782 a zone shows nothing', () => {
  assert.deepEqual(shown({ hover: { kind: 'zone', id: 'core' } }), NONE);
});

test('#782 a pinned building shows as a hovered one', () => {
  assert.deepEqual(shown({ pinned: building(LANDMARK) }), { districts: ['engine'], landmarks: [LANDMARK], ports: [] });
});

test('#782 the fly target shows as a hovered one', () => {
  const city = layout();
  const fly = load().flyTarget(city, LANDMARK);
  const out = load().labelsShown(city, { hover: null, pinned: null, fly });
  assert.deepEqual(Array.from(out.landmarks), [LANDMARK]);
  assert.deepEqual(Array.from(out.districts), ['engine']);
});

test('#782 a district flown to shows its label', () => {
  const city = layout();
  const fly = load().flyTarget(city, 'Views');
  assert.deepEqual(Array.from(load().labelsShown(city, { hover: null, pinned: null, fly }).districts), ['views']);
});

test('#782 hover, pinned and fly add up', () => {
  const city = layout();
  const fly = load().flyTarget(city, DOCK);
  const out = load().labelsShown(city, { hover: building(LANDMARK), pinned: { kind: 'district', id: 'views' }, fly });
  assert.deepEqual([...out.districts].sort(), ['engine', 'root', 'views']);
  assert.deepEqual([...out.landmarks], [LANDMARK]);
  assert.deepEqual([...out.ports].sort(), ['cli', 'npm']);
});

test('#782 the same label asked twice shows once', () => {
  const out = load().labelsShown(layout(), { hover: building(LANDMARK), pinned: building(LANDMARK), fly: null });
  assert.deepEqual([...out.districts], ['engine']);
  assert.deepEqual([...out.landmarks], [LANDMARK]);
});

test('#782 zone labels stay on the layout, whatever is shown', () => {
  const zones = layout().zones;
  assert.equal(zones.length, 3);
  assert.equal(zones.every((z) => z.label && typeof z.label === 'object'), true, 'each zone keeps its label');
});
