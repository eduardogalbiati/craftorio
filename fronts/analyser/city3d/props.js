// The project city's street life (#450, poc/project-city-v2.html propsOf, makeTraffic and the
// crosswalks of build), pure: what the scene draws around the buildings, from a layout of
// packages/shared/city-layout.js (its avenues, avenueWidth, scale, zones' and districts' cells and plates).
// - lawnsOf(layout): per district, the lawn strip in front of its buildings (the plate's free band on
//   the south side, PLAZA of its depth at most, clear of the district's name strip).
// - propsOf(layout): the trees (a trunk `cyl` and a crown `green`), the lamps (a `mast` and a `light`,
//   with the `pool` of light under it at night), the corner lamps of every district's sidewalk, the
//   trees and a bench (`box`) on the lawns, the trees and lamps along every zone's avenue sidewalk;
//   parts with absolute positions and a colour `role` (trunk, leaf, post, lamp, bench) the scene
//   paints from the theme. A lawn's trees stay lower than the district's lowest building, so no prop
//   covers a roof, its marker or a highlight.
// - carsOf(layout): the cars of the avenues, two lanes each way, a seeded start and speed.
// - crosswalksOf(layout): the zebra stripes on the approaches of the avenues' crossings and ends.
// - lifeCount(layout, on): how many life props the scene shows (props, cars, lamp pools), 0 when
//   City life is off (main.jsx stats().props).
// - inset(rect, m), and the layout's STREET and SIDEWALK_AV (city-layout.js owns them): for scene.jsx too.
// The same layout always gives the same city (seeded, packages/shared/city-buildings.js rngOf); each list
// is computed once per layout.
import { rngOf } from '@craftorio/shared/city-buildings.js';
import { SIDEWALK, SIDEWALK_AV, STREET } from '@craftorio/shared/city-layout.js';

// the slabs: the floor's top is y = 0; the sidewalk, the zone slab and the district plate stack on it
export const SIDEWALK_TOP = 0.22, ZONE_TOP = 0.55, PLATE_TOP = 0.95;
export { SIDEWALK_AV, STREET }; // the layout's sidewalk along a zone's avenue side, its street between districts
const PLAZA = 0.14; // the most of a plate's depth a lawn takes
const CAR_COLOURS = ['#e6e8ee', '#b9bfce', '#596079', '#f87171', '#7c9cff', '#facc15', '#4ade80', '#2b3247'];

/** A rect { x, z, w, d } moved in by `m` on every side (out when negative). */
export const inset =(r, m) => ({ x: r.x + m, z: r.z + m, w: Math.max(0, r.w - 2 * m), d: Math.max(0, r.d - 2 * m) });
const cache = (fn) => {
  const memo = new WeakMap();
  return (layout) => {
    if (!layout) return [];
    if (!memo.has(layout)) memo.set(layout, fn(layout));
    return memo.get(layout);
  };
};

/** Per district (by index), its lawn { x, z, w, d } in front of its buildings, or null (see the header). */
export const lawnsOf = cache((layout) => {
  const k = layout.scale || 1, byDistrict = {};
  for (const b of layout.buildings || []) (byDistrict[b.district] ||= []).push(b);
  return (layout.districts || []).map((g) => {
    const lots = byDistrict[g.id] || [];
    if (!lots.length) return null;
    const side = SIDEWALK * k, bottom = g.z + g.d - side;
    let z0 = Math.max(...lots.map((b) => b.z + b.d)) + 0.8 * k, z1 = Math.min(bottom, z0 + Math.max(3 * k, g.d * PLAZA));
    let x0 = g.x + side, x1 = g.x + g.w - side;
    const L = g.label; // keep clear of the name's strip
    if (L && L.x < x1 && L.x + L.w > x0 && L.z < z1 && L.z + L.d > z0) {
      if (L.vertical) { if (L.x - x0 > x1 - (L.x + L.w)) x1 = L.x; else x0 = L.x + L.w; }
      else if (L.z > z0) z1 = L.z; else z0 = L.z + L.d;
    }
    const lawn = { x: x0, z: z0, w: x1 - x0, d: z1 - z0 };
    return lawn.w >= 4 * k && lawn.d >= 2.5 * k ? lawn : null;
  });
});

/** The street furniture of `layout`: [{ g, x, y, z, w, h, d, role, shade?, pool? }] (see the header). */
export const propsOf = cache((layout) => {
  const out = [], r = rngOf(7), k = layout.scale || 1;
  const tree = (x, z, y, s0, cap = Infinity) => {
    let s = (1.2 + r() * 0.9) * s0;
    const shade = r() * 0.25;
    if (0.5 * k + 1.25 * s > cap) s = Math.max(0.2 * k, (cap - 0.5 * k) / 1.25); // lower than the buildings it stands by
    out.push({ g: 'cyl', x, y, z, w: 0.22 * s0, h: 0.7 * k + s * 0.3, d: 0.22 * s0, role: 'trunk' });
    out.push({ g: 'green', x, y: y + 0.5 * k + s * 0.3, z, w: s, h: s * 0.95, d: s, role: 'leaf', shade });
  };
  const lamp = (x, z, y, h) => {
    out.push({ g: 'mast', x, y, z, w: 1, h, d: 1, role: 'post' });
    out.push({ g: 'light', x, y: y + h + 0.15, z, w: 0.34, h: 0.34, d: 0.34, role: 'lamp', pool: y });
  };
  const lawns = lawnsOf(layout), lowest = {};
  for (const b of layout.buildings || []) lowest[b.district] = Math.min(lowest[b.district] ?? Infinity, b.h);
  // the district streets: a lamp at each corner of the sidewalk; the lawns: trees and a bench
  (layout.districts || []).forEach((g, i) => {
    const s = inset(g.cell || inset(g, -1.3 * k), (STREET / 2 - 0.65) * k);
    if (s.w > 8 * k && s.d > 8 * k) for (const [x, z] of [[s.x, s.z], [s.x + s.w, s.z], [s.x, s.z + s.d], [s.x + s.w, s.z + s.d]]) lamp(x, z, ZONE_TOP + 0.14, 2.6 * k);
    const lawn = lawns[i];
    if (!lawn) return;
    const placed = [], want = Math.min(6, Math.floor((lawn.w * lawn.d) / (18 * k * k))), cap = (lowest[g.id] ?? 3) * 0.9;
    for (let tries = 0; placed.length < want && tries < 40; tries++) {
      const x = lawn.x + 0.9 * k + r() * Math.max(0, lawn.w - 1.8 * k), z = lawn.z + 0.9 * k + r() * Math.max(0, lawn.d - 1.8 * k);
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 2.4 * k)) continue;
      placed.push({ x, z });
      tree(x, z, PLATE_TOP + 0.15, 0.7 * k, cap);
    }
    if (lawn.w > 4 * k && lawn.d > 2.5 * k) out.push({ g: 'box', x: lawn.x + 1.2 * k + r() * (lawn.w - 2.4 * k), y: PLATE_TOP + 0.15, z: lawn.z + lawn.d - 0.6 * k, w: 1.3 * k, h: 0.3 * k, d: 0.4 * k, role: 'bench' }); // on the south edge
  });
  // the avenues' sidewalks: trees, a lamp every third
  const half = (layout.avenueWidth || 16 * k) / 2;
  for (const zn of layout.zones || []) {
    if (!zn.cell) continue;
    const s = inset(zn.cell, half - (SIDEWALK_AV * k) / 2); // the middle of the sidewalk ring
    const edges = [[s.x, s.z, s.x + s.w, s.z], [s.x, s.z + s.d, s.x + s.w, s.z + s.d], [s.x, s.z, s.x, s.z + s.d], [s.x + s.w, s.z, s.x + s.w, s.z + s.d]];
    for (const [x0, z0, x1, z1] of edges) {
      const n = Math.floor(Math.hypot(x1 - x0, z1 - z0) / (7 * k));
      for (let i = 1; i < n; i++) {
        const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        if (i % 3 === 0) lamp(x, z, SIDEWALK_TOP, 3.4 * k);
        else if (r() < 0.8) tree(x, z, SIDEWALK_TOP, k);
      }
    }
  }
  return out;
});

/** The cars of the avenues: [{ axis, x, z, length, t, speed, off, dir, colour }], `t` along the avenue (see the header). */
export const carsOf = cache((layout) => {
  const out = [], r = rngOf(11), k = layout.scale || 1;
  for (const a of layout.avenues || []) {
    const n = Math.max(2, Math.round(a.length / (22 * k)));
    for (let i = 0; i < n; i++) {
      const lane = Math.floor(r() * 4), dir = lane < 2 ? 1 : -1;
      out.push({ axis: a.axis, x: a.x, z: a.z, length: a.length, t: r() * a.length, speed: (7 + r() * 6) * k * dir, off: [-4.2, -1.7, 1.7, 4.2][lane] * k, dir, colour: CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)] });
    }
  }
  return out;
});

/** The zebra stripes of the crosswalks: [{ x, z, sx, sz }] lying on the road (see the header). */
export const crosswalksOf = cache((layout) => {
  const out = [], k = layout.scale || 1, avs = layout.avenues || [];
  const zebra = (x, z, along) => { for (let i = -4; i <= 4; i++) out.push(along ? { x, z: z + i * 1.2 * k, sx: 1.5 * k, sz: 0.6 * k } : { x: x + i * 1.2 * k, z, sx: 0.6 * k, sz: 1.5 * k }); };
  const hs = avs.filter((a) => a.axis === 'x'), vs = avs.filter((a) => a.axis === 'z');
  for (const a of hs) {
    zebra(a.x + 2.2 * k, a.z, true); zebra(a.x + a.length - 2.2 * k, a.z, true);
    for (const v of vs) {
      if (v.z < a.z && a.z < v.z + v.length && a.x < v.x && v.x < a.x + a.length) {
        zebra(v.x - 9.5 * k, a.z, true); zebra(v.x + 9.5 * k, a.z, true); zebra(v.x, a.z - 9.5 * k, false); zebra(v.x, a.z + 9.5 * k, false);
      }
    }
  }
  for (const v of vs) {
    for (const end of [v.z, v.z + v.length]) {
      const into = end === v.z ? 1 : -1, crossing = hs.some((a) => Math.abs(a.z - end) < 1);
      zebra(v.x, end + into * (crossing ? 9.5 : 2.2) * k, false);
    }
  }
  return out;
});

/** How many life props the scene shows: the props, the cars and the lamps' pools; 0 with City life off. */
export function lifeCount(layout, on) {
  if (!on || !layout) return 0;
  const props = propsOf(layout);
  return props.length + carsOf(layout).length + props.filter((p) => p.pool != null).length;
}
