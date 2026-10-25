// The v2 buildings (#449, ported from poc/project-city-v2.html, #415): packages/shared/city-buildings.js
// turns a laid-out building (the fields of CityLayout's buildings: path, w, d, h, lines, complexity,
// functions, worst, quadrant, test) into an archetype and its parts, pure and stable per path.
// Contract: tierOf(b) → 0..3; archetypeOf(b, { medianArea }) → 'shed' | 'pavilion' | 'hall' |
// 'block' | 'tower' | 'complex'; buildingOf(b, { medianArea }) → { kind, tier, prop, parts, top },
// prop 'plant' | 'water-tower' | 'crane' | 'roof-garden' | null, parts [{ g, x, y, z, w, h, d, role }].
// The module is loaded inside each test: it does not exist before the change.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../city-buildings');

const base = { complexity: 60, functions: 20, lines: 300, quadrant: null, test: false, worst: null, churn: 0 };
const file = (o) => ({ ...base, path: 'src/a.js', w: 6, d: 6, h: 8, ...o });
const SHAPES = {
  shed: [file({ path: 'src/tiny.js', w: 1.5, d: 1.5, h: 2, lines: 10, complexity: 3, functions: 1 }), { medianArea: 36 }],
  pavilion: [file({ path: 'test/a.test.js', w: 5, d: 5, h: 3, lines: 200, complexity: null, functions: null, test: true }), { medianArea: 25 }],
  hall: [file({ path: 'docs/guide.md', w: 5, d: 4, h: 12, lines: 800, complexity: null, functions: null }), { medianArea: 20 }],
  block: [file({ path: 'src/block.js' }), { medianArea: 36 }],
  tower: [file({ path: 'src/tower.js', w: 4, d: 4, h: 12, complexity: 200 }), { medianArea: 16 }],
  complex: [file({ path: 'src/complex.js', w: 12, d: 12, h: 10, complexity: 200, functions: 60 }), { medianArea: 36 }],
};
const bodies = (bld) => bld.parts.filter((p) => p.role === 'body').length;
const has = (bld, g, role) => bld.parts.some((p) => p.g === g && (role == null || p.role === role));

test('each archetype comes from the metrics', () => {
  const { archetypeOf, buildingOf } = load();
  for (const [kind, [b, ctx]] of Object.entries(SHAPES)) {
    assert.equal(archetypeOf(b, ctx), kind, kind);
    assert.equal(buildingOf(b, ctx).kind, kind, kind);
  }
});

test('a big unmeasured prose or data file is a low hall, the same metrics in code a tower', () => {
  const { buildingOf } = load();
  const [doc, ctx] = SHAPES.hall;
  const hall = buildingOf(doc, ctx);
  assert.ok(Math.max(...hall.parts.filter((p) => p.role === 'body').map((p) => p.h)) < doc.h, 'the hall body is lower than the file height');
  assert.equal(buildingOf({ ...doc, path: 'data/fixtures.json' }, ctx).kind, 'hall');
  assert.equal(buildingOf({ ...doc, path: 'src/unmeasured.js' }, ctx).kind, 'tower');
});

test('the complexity tier: 0 under 40, 1 under 120, 2 under 300, 3 above; unmeasured files from their lines', () => {
  const { tierOf } = load();
  const cases = [[0, 0], [39, 0], [40, 1], [119, 1], [120, 2], [299, 2], [300, 3], [1200, 3]];
  for (const [complexity, tier] of cases) assert.equal(tierOf(file({ complexity })), tier, `complexity ${complexity}`);
  assert.equal(tierOf(file({ complexity: null, lines: 100 })), 0);
  assert.equal(tierOf(file({ complexity: null, lines: 601 })), 1);
});

test('a higher tier articulates a tower: more setbacks, a spire at the top tier', () => {
  const { buildingOf } = load();
  const [tower, ctx] = SHAPES.tower;
  const low = buildingOf({ ...tower, complexity: 10 }, ctx), high = buildingOf({ ...tower, complexity: 400 }, ctx);
  assert.equal(low.kind, 'tower'); assert.equal(high.kind, 'tower');
  assert.equal(low.tier, 0); assert.equal(high.tier, 3);
  assert.ok(bodies(high) > bodies(low), `${bodies(high)} segments at tier 3, ${bodies(low)} at tier 0`);
  assert.equal(has(high, 'cone'), true, 'a spire at tier 3');
  assert.equal(has(low, 'cone'), false, 'no spire at tier 0');
});

test('a higher tier adds a corner tower to a block', () => {
  const { buildingOf } = load();
  const [block, ctx] = SHAPES.block;
  const low = buildingOf({ ...block, complexity: 10 }, ctx), high = buildingOf({ ...block, complexity: 200 }, ctx);
  assert.equal(low.kind, 'block'); assert.equal(high.kind, 'block');
  assert.ok(bodies(high) > bodies(low));
  assert.ok(high.top > low.top, 'the corner tower rises over the block');
});

test('each quadrant brings its props', () => {
  const { buildingOf } = load();
  const big = file({ path: 'src/big.js', w: 8, d: 8, h: 8, complexity: 60, functions: 20 }), ctx = { medianArea: 64 };
  const prop = (o) => buildingOf({ ...big, ...o }, ctx).prop;
  assert.equal(prop({ quadrant: 'Danger Zone' }), 'plant');
  assert.equal(prop({ quadrant: 'Cowboy Code' }), 'water-tower');
  assert.equal(prop({ quadrant: 'Fertile Ground' }), 'crane');
  assert.equal(prop({ quadrant: 'Healthy Closure' }), 'roof-garden');
  assert.equal(prop({ quadrant: null }), null);
  assert.equal(prop({ quadrant: 'Healthy Closure', complexity: 10 }), null, 'no roof garden at tier 0');
});

test('a Danger Zone plant shows a warning light only over the complexity limit', () => {
  const { buildingOf } = load();
  const b = file({ path: 'src/danger.js', w: 8, d: 8, h: 8, quadrant: 'Danger Zone' }), ctx = { medianArea: 64 };
  assert.equal(has(buildingOf({ ...b, worst: 30 }, ctx), 'light', 'warn'), true);
  assert.equal(has(buildingOf({ ...b, worst: 20 }, ctx), 'light'), false);
});

test('the mast keeps its meaning: as tall as the worst function, none without one', () => {
  const { buildingOf } = load();
  const [b, ctx] = SHAPES.block;
  const none = buildingOf({ ...b, worst: null }, ctx), short = buildingOf({ ...b, worst: 10 }, ctx), tall = buildingOf({ ...b, worst: 40 }, ctx);
  assert.equal(has(none, 'mast'), false);
  assert.equal(has(tall, 'mast'), true);
  assert.ok(tall.top > short.top, 'a worse function, a taller mast');
});

test('every part is a finite, positive box and the top covers the parts', () => {
  const { buildingOf } = load();
  for (const [kind, [b, ctx]] of Object.entries(SHAPES)) {
    for (const quadrant of [null, 'Danger Zone', 'Cowboy Code', 'Fertile Ground', 'Healthy Closure']) {
      const bld = buildingOf({ ...b, quadrant, worst: 30 }, ctx);
      assert.ok(bld.parts.length > 0, kind);
      for (const p of bld.parts) {
        assert.equal(typeof p.g, 'string'); assert.equal(typeof p.role, 'string');
        for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(p[k]), `${kind} ${quadrant} ${p.g}.${k}`);
        for (const k of ['w', 'h', 'd']) assert.ok(Number.isFinite(p[k]) && p[k] > 0, `${kind} ${quadrant} ${p.g}.${k}=${p[k]}`);
      }
      const highest = Math.max(...bld.parts.map((p) => p.y + p.h));
      assert.ok(Number.isFinite(bld.top) && bld.top >= highest - 0.5, `${kind} ${quadrant}: top ${bld.top}, highest part ${highest}`);
    }
  }
});

test('the same path gives the same shape, whatever Math.random says, and the input is not changed', (t) => {
  const { buildingOf } = load();
  const first = Object.entries(SHAPES).map(([, [b, ctx]]) => buildingOf({ ...b, quadrant: 'Danger Zone', worst: 30 }, ctx));
  let n = 0;
  t.mock.method(Math, 'random', () => ((n += 0.37) % 1));
  for (const [i, [, [b, ctx]]] of Object.entries(SHAPES).entries()) {
    const input = { ...b, quadrant: 'Danger Zone', worst: 30 }, copy = JSON.parse(JSON.stringify(input));
    assert.deepEqual(JSON.parse(JSON.stringify(buildingOf(input, ctx))), JSON.parse(JSON.stringify(first[i])));
    assert.deepEqual(input, copy, 'buildingOf does not write into the layout building');
  }
});

test('the seed comes from the path: different files of the same metrics vary', () => {
  const { buildingOf } = load();
  const [b, ctx] = SHAPES.block;
  const shapes = new Set();
  for (let i = 0; i < 30; i++) shapes.add(JSON.stringify(buildingOf({ ...b, path: `src/f${i}.js`, complexity: 200, quadrant: 'Danger Zone' }, ctx).parts));
  assert.ok(shapes.size > 1, 'thirty paths, one shape');
});

test("a file's metrics changing changes only that file", () => {
  const { buildingOf } = load();
  const [a, ctx] = SHAPES.block, [t] = SHAPES.tower;
  const before = JSON.stringify(buildingOf(a, ctx));
  buildingOf({ ...t, complexity: 900, worst: 80, quadrant: 'Danger Zone' }, ctx);
  assert.equal(JSON.stringify(buildingOf(a, ctx)), before);
  assert.notEqual(JSON.stringify(buildingOf({ ...a, h: 14, complexity: 250 }, ctx)), before);
});
