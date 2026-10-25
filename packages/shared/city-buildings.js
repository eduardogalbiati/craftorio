// The buildings of the project city v2 (#449, ported from poc/project-city-v2.html, #415): a laid-out
// building of CityLayout (packages/shared/city-layout.js: path, w, d, h, lines, complexity, functions,
// worst, quadrant, test) becomes an archetype and a list of parts on a few unit geometries, which the
// 3D scene (fronts/analyser/city3d/) draws as one instanced mesh per geometry. Pure and deterministic:
// the shapes vary by a seed from the path (hashOf, rngOf), never Math.random, so a file keeps its
// shape between loads and across machines, and a file's metrics changing changes only that file.
// - the archetypes (archetypeOf): shed (tiny files), pavilion (tests), hall (big unmeasured data and
//   prose files, by extension: lower and wide), block (the common measured file), tower (tall and
//   narrow), complex (a footprint COMPLEX_RATIO times its district's median: a main block, two
//   wings, a courtyard garden and skybridges);
// - the complexity tier (tierOf, 0..3) adds articulation: setbacks, a crown and a spire on towers, a
//   corner tower on blocks, bands every six floors, a helipad, rooftop units from the functions;
// - the quadrant adds its props (`prop`): Danger Zone a plant (tanks, a chimney whose warning light
//   shows over COMPLEXITY_LIMIT, pipes down a facade), Cowboy Code a water tower, Fertile Ground a
//   crane (its arm parts carry `crane`, the pivot the scene swings them around), Healthy Closure a
//   roof garden;
// - the mast keeps its meaning: ANTENNA_K × the worst function from ANTENNA_MIN, its cap 'warn' over
//   the limit.
// - buildingOf(b, { medianArea }) → { kind, tier, prop, tint, antenna, parts, top }: parts
//   [{ g, x, y, z, w, h, d, role, ry, win }] relative to the lot's centre and base (y up), g one of
//   box | wedge | barrel | dome | cyl | cone | green | mast | cap | light (cap and light centred on
//   y, the others standing on it), role body | trim | roof | metal | glass | green | warn | amber |
//   cap; `tint` 0..1 a stable shade per path; `top` the highest point. The input is not changed.
// Browser: window.CityBuildings; Node: module.exports.
(function (root) {
  const FLOOR_H = 0.9, WIN_PITCH = 0.72; // the windows: a real floor height and a column pitch (world units), so size reads as scale
  const COMPLEX_RATIO = 3; // a footprint this many times its district's median footprint becomes a complex (wings)
  const FLOOR_LINES = 45; // rooftop units: the functions, or lines / FLOOR_LINES
  const ANTENNA_K = 0.25, ANTENNA_MIN = 8, COMPLEXITY_LIMIT = 25; // mast height = ANTENNA_K × worst; red cap over the limit
  // data and prose, not code (by extension): big ones are halls, lower and wide, rather than grey towers
  const DATA_EXTS = new Set(['cmd', 'css', 'feature', 'htm', 'html', 'json', 'lock', 'md', 'sh', 'sql', 'toml', 'tsv', 'txt', 'yaml', 'yml']);

  /** A stable 32-bit hash of a string (FNV-1a). */
  const hashOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  /** A seeded generator (mulberry32): the same seed always gives the same numbers. */
  const rngOf = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const extOf = (path) => { const m = /\.([^./\\]+)$/.exec(String(path || '')); return m ? m[1].toLowerCase() : ''; };
  const isData = (b) => DATA_EXTS.has(extOf(b.path));

  /** The complexity tier, 0..3 (unmeasured files from their lines). */
  const tierOf = (b) => (b.complexity == null ? ((b.lines || 0) > 600 ? 1 : 0) : b.complexity < 40 ? 0 : b.complexity < 120 ? 1 : b.complexity < 300 ? 2 : 3);
  /** The mast's height: ANTENNA_K × the worst function from ANTENNA_MIN, 0 without one. */
  const antennaOf = (b) => (b.worst != null && b.worst >= ANTENNA_MIN ? ANTENNA_K * b.worst : 0);

  /** The archetype of a building from its metrics: see the header. */
  function archetypeOf(b, { medianArea } = {}) {
    const side = Math.min(b.w, b.d), area = b.w * b.d;
    if (b.test) return 'pavilion';
    if (area < 4 || (b.lines || 0) < 25) return 'shed';
    if (b.complexity == null) return isData(b) && area > 10 ? 'hall' : b.h > 2.4 * side && b.h > 6 ? 'tower' : 'block';
    if (area >= COMPLEX_RATIO * (medianArea || area) && b.h > 4 && side > 4) return 'complex';
    if (b.h > 2.2 * side && b.h > 7) return 'tower';
    return 'block';
  }

  /** The highest point of the parts so far (caps and lights are centred on their y). */
  const highest = (parts) => parts.reduce((top, p) => Math.max(top, p.g === 'cap' || p.g === 'light' ? p.y + p.h / 2 : p.y + p.h), 0);

  /** The seeded drawing kit of one building: its sizes, the generator and the part helpers the shapes below share. */
  function kitOf(b) {
    const r = rngOf(hashOf(String(b.path))), parts = [], tier = tierOf(b);
    const W = b.w, D = b.d, H = b.h;
    const add = (g, x, y, z, w, h, d, role, o = {}) => { const p = { g, x, y, z, w, h, d, role, ry: o.ry || 0, win: !!o.win }; parts.push(p); return p; };
    const trim = (x, y, z, w, d, t = 0.16) => add('box', x, y, z, w + 0.14, t, d + 0.14, 'trim');
    return {
      b, r, parts, tier, W, D, H, side: Math.min(W, D), big: Math.max(W, D), alongX: W >= D, antenna: antennaOf(b),
      roofs: [], // the flat roofs props can stand on, the main one first: { x, z, w, d, y }
      add, trim,
      pick: (arr) => arr[Math.floor(r() * arr.length)],
      sign: () => (r() < 0.5 ? -1 : 1),
      // a band every six floors on the tall bodies of the articulated tiers, a canopy over the entrance on the street side
      bands: (x, y, z, w, h, d) => { if (tier >= 1 && h > 8) for (let k = FLOOR_H * 6; k < h - 1.5; k += FLOOR_H * 6) trim(x, y + k, z, w, d, 0.1); },
      canopy: (x, z, w, d, dz = 1) => { if (Math.min(w, d) > 2.5) add('box', x, FLOOR_H * 0.95, z + dz * (d / 2 + 0.3), Math.min(w * 0.45, 2.4), 0.12, 0.8, 'trim'); },
      place: (roof, w, d) => ({ x: roof.x + (r() - 0.5) * Math.max(0, roof.w - w - 0.5), z: roof.z + (r() - 0.5) * Math.max(0, roof.d - d - 0.5) }),
    };
  }

  // a gable roof over a footprint, its ridge along the long side
  const gable = (k, h, rh, pad) => k.add('wedge', 0, h, 0, k.alongX ? k.W + pad : k.D + pad, rh, k.alongX ? k.D + pad : k.W + pad, 'roof', { ry: k.alongX ? 0 : Math.PI / 2 });

  // ---------- the archetypes (poc/project-city-v2.html partsOf) ----------
  const SHAPES = {
    shed(k) {
      const { W, D, side } = k, h = Math.max(1.1, k.H);
      k.add('box', 0, 0, 0, W, h, D, 'body', { win: side > 1.6 });
      if (k.r() < 0.65) gable(k, h, Math.min(1.2, side * 0.5), 0.2);
      else { k.trim(0, h, 0, W, D, 0.12); k.roofs.push({ x: 0, z: 0, w: W, d: D, y: h + 0.12 }); }
    },
    pavilion(k) {
      const { W, D, side } = k, h = Math.max(1.2, k.H), style = k.r();
      k.add('box', 0, 0, 0, W, h, D, 'body', { win: true });
      if (style < 0.5) gable(k, h, Math.min(1.1, side * 0.35), 0.3);
      else if (style < 0.75 && side > 3) { k.trim(0, h, 0, W, D); const dr = Math.min(side * 0.7, 4); k.add('dome', 0, h + 0.16, 0, dr, dr * 0.45, dr, 'glass'); }
      else { k.trim(0, h, 0, W, D); k.roofs.push({ x: 0, z: 0, w: W, d: D, y: h + 0.16 }); }
    },
    hall(k) {
      const { W, D, side, big, alongX } = k, h = Math.max(1.5, Math.min(k.H, 3 + k.H * 0.2));
      k.add('box', 0, 0, 0, W, h, D, 'body', { win: true });
      k.trim(0, h, 0, W, D, 0.12);
      if (k.r() < 0.55) { // a barrel roof along the long side, a skylight strip on its ridge
        const rh = Math.min(side * 0.5, 3.5);
        k.add('barrel', 0, h + 0.12, 0, alongX ? W : D, rh, alongX ? D : W, 'roof', { ry: alongX ? 0 : Math.PI / 2 });
        k.add('box', 0, h + 0.12 + rh - 0.12, 0, alongX ? W * 0.8 : 0.5, 0.2, alongX ? 0.5 : D * 0.8, 'glass');
      } else { // a sawtooth roof: wedges across the long side
        const n = Math.max(2, Math.min(6, Math.round(big / 3))), seg = big / n, rh = Math.min(seg * 0.6, 2.2);
        for (let i = 0; i < n; i++) { const c = -big / 2 + seg * (i + 0.5); k.add('wedge', alongX ? c : 0, h + 0.12, alongX ? 0 : c, side, rh, seg, 'roof', { ry: alongX ? Math.PI / 2 : 0 }); }
      }
    },
    tower(k) {
      const { H, tier } = k, n = Math.min(4, 2 + tier), shares = [0.42, 0.28, 0.18, 0.12].slice(0, n), sum = shares.reduce((s, x) => s + x, 0);
      let y = 0, w = k.W, d = k.D, x = 0, z = 0;
      k.canopy(0, 0, k.W, k.D);
      for (let i = 0; i < n; i++) {
        const h = (H * shares[i]) / sum;
        k.add('box', x, y, z, w, h, d, 'body', { win: true });
        if (i === 0) k.bands(x, y, z, w, h, d);
        k.trim(x, y + h, z, w, d, i === n - 1 ? 0.24 : 0.14);
        if (i < n - 1) { // the next segment steps back, on a random side or centred
          const nw = w * (0.72 + k.r() * 0.16), nd = d * (0.72 + k.r() * 0.16), sx = k.pick([-1, 0, 1]), sz = k.pick([-1, 0, 1]);
          x += (sx * (w - nw)) / 2; z += (sz * (d - nd)) / 2; w = nw; d = nd;
        }
        y += h;
      }
      y += 0.24;
      if (tier >= 2) { k.add('box', x, y, z, w * 0.55, 0.5, d * 0.55, 'trim'); y += 0.5; w *= 0.55; d *= 0.55; } // a crown
      k.roofs.push({ x, z, w, d, y });
      if (tier >= 3 && !k.antenna) k.add('cone', x, y, z, 0.9, 2.5 + H * 0.08, 0.9, 'metal'); // a spire
    },
    complex(k) { // the main block in a corner, a wing along each of its sides, a garden in the free corner, skybridges
      const { W, D, H, side } = k, cx = k.sign(), cz = k.sign(), gap = Math.max(0.6, side * 0.07);
      const mw = W * (0.5 + k.r() * 0.1), md = D * (0.5 + k.r() * 0.1), mx = (cx * (W - mw)) / 2, mz = (cz * (D - md)) / 2;
      k.add('box', mx, 0, mz, mw, H, md, 'body', { win: true }); k.trim(mx, H, mz, mw, md, 0.2); k.bands(mx, 0, mz, mw, H, md); k.canopy(mx, mz, mw, md, cz);
      k.roofs.push({ x: mx, z: mz, w: mw, d: md, y: H + 0.2 });
      const w1 = W - mw - gap, h1 = H * (0.38 + k.r() * 0.17), x1 = (-cx * (W - w1)) / 2;
      k.add('box', x1, 0, mz, w1, h1, md, 'body', { win: true }); k.trim(x1, h1, mz, w1, md);
      k.roofs.push({ x: x1, z: mz, w: w1, d: md, y: h1 + 0.16 });
      const d2 = D - md - gap, h2 = H * (0.5 + k.r() * 0.2), z2 = (-cz * (D - d2)) / 2;
      k.add('box', mx, 0, z2, mw, h2, d2, 'body', { win: true }); k.trim(mx, h2, z2, mw, d2);
      k.roofs.push({ x: mx, z: z2, w: mw, d: d2, y: h2 + 0.16 });
      if ((k.b.functions || 0) > 50) { // a skybridge from the main block to each wing
        k.add('box', mx - (cx * (mw + gap)) / 2, h1 * 0.55, mz, gap + 0.5, 0.8, Math.min(2.2, md * 0.3), 'glass');
        k.add('box', mx, h2 * 0.55, mz - (cz * (md + gap)) / 2, Math.min(2.2, mw * 0.3), 0.8, gap + 0.5, 'glass');
      }
      const gs = Math.min(w1, d2) * 0.5;
      if (gs > 1) { k.add('green', x1, 0, z2, gs, gs * 0.8, gs, 'green'); k.add('green', x1 + gs * 0.35 * k.sign(), 0, z2 + gs * 0.35 * k.sign(), gs * 0.6, gs * 0.5, gs * 0.6, 'green'); }
    },
    block(k) {
      const { W, D, H, side, tier } = k, podium = H > 6 && side > 3, ph = podium ? Math.min(1.6, H * 0.18) : 0, inset = podium ? Math.min(0.5, side * 0.08) : 0;
      if (podium) { k.add('box', 0, 0, 0, W, ph, D, 'body', { win: true }); k.trim(0, ph, 0, W, D, 0.14); }
      k.add('box', 0, ph, 0, W - 2 * inset, H - ph, D - 2 * inset, 'body', { win: true });
      k.trim(0, H, 0, W - 2 * inset, D - 2 * inset, 0.18); k.bands(0, ph, 0, W - 2 * inset, H - ph, D - 2 * inset); k.canopy(0, 0, W, D);
      k.roofs.push({ x: 0, z: 0, w: W - 2 * inset, d: D - 2 * inset, y: H + 0.18 });
      if (tier >= 2 && side > 4) { // a corner tower rising over the block
        const tw = side * 0.42, th = H * (0.25 + 0.1 * tier), tx = k.sign() * (W / 2 - tw / 2 - inset), tz = k.sign() * (D / 2 - tw / 2 - inset);
        k.add('box', tx, H, tz, tw, th, tw, 'body', { win: true }); k.trim(tx, H + th, tz, tw, tw, 0.18);
        k.roofs.unshift({ x: tx, z: tz, w: tw, d: tw, y: H + th + 0.18 });
      }
    },
  };

  // ---------- the quadrants' props, on the main roof: each returns its name, or null when it does not fit ----------
  const PROPS = {
    'Danger Zone'(k, main) { // a plant: tanks, a chimney (a warning light over the limit), pipes down a facade
      const { tier, alongX } = k;
      for (let i = 0; i < 1 + Math.min(2, tier); i++) { const tr = Math.min(0.9, Math.min(main.w, main.d) * 0.18), p = k.place(main, tr, tr); k.add('cyl', p.x, main.y, p.z, tr, tr * 1.1, tr, 'metal'); }
      const ch = 1.8 + tier, p = k.place(main, 0.6, 0.6);
      k.add('cyl', p.x, main.y, p.z, 0.42, ch, 0.42, 'metal'); k.add('cyl', p.x, main.y + ch, p.z, 0.54, 0.25, 0.54, 'trim');
      if (k.b.worst > COMPLEXITY_LIMIT) k.add('light', p.x, main.y + ch + 0.45, p.z, 0.44, 0.44, 0.44, 'warn');
      const fs = k.sign(), fx = alongX ? 0 : fs * (k.W / 2 + 0.16), fz = alongX ? fs * (k.D / 2 + 0.16) : 0, ph = k.H * (0.6 + k.r() * 0.3);
      for (let i = 0; i <= tier; i++) {
        const o = (i - tier / 2) * 0.55, px = fx + (alongX ? o : 0), pz = fz + (alongX ? 0 : o);
        k.add('cyl', px, 0, pz, 0.22, ph, 0.22, 'metal');
        k.add('box', px - (alongX ? 0 : fs * 0.4), ph - 0.12, pz - (alongX ? fs * 0.4 : 0), alongX ? 0.24 : 0.9, 0.24, alongX ? 0.9 : 0.24, 'metal'); // the elbow into the wall
      }
      return 'plant';
    },
    'Cowboy Code'(k, main) { // a water tower on a stilt
      if (Math.min(main.w, main.d) <= 2.6) return null;
      const p = k.place(main, 1.4, 1.4), tr = 0.55 + 0.1 * k.tier;
      k.add('cyl', p.x, main.y, p.z, 0.14, 1.4, 0.14, 'metal');
      k.add('cyl', p.x, main.y + 1.4, p.z, tr * 2, tr * 1.3, tr * 2, 'trim'); k.add('cone', p.x, main.y + 1.4 + tr * 1.3, p.z, tr * 2.2, tr * 0.6, tr * 2.2, 'roof');
      return 'water-tower';
    },
    'Fertile Ground'(k, main) { // a crane: the file keeps being built
      if (k.tier < 1 || k.big <= 6) return null;
      const { alongX } = k, p = { x: main.x + (main.w / 2 - 0.7) * k.sign(), z: main.z + (main.d / 2 - 0.7) * k.sign() }, ch = k.H * 0.5 + 3, arm = k.big * 0.9;
      k.add('mast', p.x, main.y, p.z, 2.2, ch, 2.2, 'amber');
      const crane = { x: p.x, y: main.y + ch, z: p.z, seed: k.r() * 6.3 }; // the arm and its counterweight swing around the mast (the scene animates them)
      k.add('box', p.x + (alongX ? arm * 0.3 : 0), main.y + ch, p.z + (alongX ? 0 : arm * 0.3), alongX ? arm : 0.3, 0.3, alongX ? 0.3 : arm, 'amber').crane = crane;
      k.add('box', p.x - (alongX ? arm * 0.2 : 0), main.y + ch - 0.6, p.z - (alongX ? 0 : arm * 0.2), alongX ? 1.2 : 0.6, 0.6, alongX ? 0.6 : 1.2, 'trim').crane = crane;
      return 'crane';
    },
    'Healthy Closure'(k, main) { // a roof garden
      if (k.tier < 1) return null;
      for (let i = 0; i < 2 + k.tier; i++) { const s = 0.5 + k.r() * 0.7, p = k.place(main, s, s); k.add('green', p.x, main.y, p.z, s, s * 0.8, s, 'green'); }
      return 'roof-garden';
    },
  };

  /** The rooftop of the main roof: a helipad, units from the functions, then the quadrant's prop (its name, or null). */
  function rooftop(k, main) {
    if (!main || Math.min(main.w, main.d) <= 2) return null;
    const { b } = k;
    if (Math.min(main.w, main.d) > 7 && k.tier >= 2) { const p = k.place(main, 3.2, 3.2); k.add('cyl', p.x, main.y, p.z, 3.0, 0.08, 3.0, 'trim'); k.add('cyl', p.x, main.y + 0.08, p.z, 2.2, 0.05, 2.2, 'metal'); } // a helipad
    const units = Math.min(4, Math.round((b.functions != null ? b.functions : (b.lines || 0) / FLOOR_LINES) / 14));
    for (let i = 0; i < units; i++) { const s = 0.5 + k.r() * 0.5, p = k.place(main, s, s); k.add('box', p.x, main.y, p.z, s, s * 0.7, s * 0.8, 'metal'); }
    const prop = PROPS[b.quadrant];
    return prop ? prop(k, main) : null;
  }

  /** The building's archetype and parts: see the header. */
  function buildingOf(b, ctx = {}) {
    const k = kitOf(b), kind = archetypeOf(b, ctx);
    SHAPES[kind](k);
    const main = k.roofs[0];
    const prop = rooftop(k, main);
    // the mast: as tall as the worst function, its cap red over the limit
    if (k.antenna) {
      const m = main || { x: 0, z: 0, y: highest(k.parts) };
      k.add('mast', m.x, m.y, m.z, 0.7, k.antenna, 0.7, 'metal'); k.add('cap', m.x, m.y + k.antenna, m.z, 0.85, 0.85, 0.85, b.worst > COMPLEXITY_LIMIT ? 'warn' : 'cap');
    }
    return { antenna: k.antenna, kind, parts: k.parts, prop, tier: k.tier, tint: (hashOf(`${b.path}:tint`) % 100) / 100, top: highest(k.parts) };
  }

  const api = {
    ANTENNA_K,
    ANTENNA_MIN,
    antennaOf,
    archetypeOf,
    buildingOf,
    COMPLEX_RATIO,
    COMPLEXITY_LIMIT,
    FLOOR_H,
    hashOf,
    rngOf,
    tierOf,
    WIN_PITCH,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CityBuildings = api;
})(typeof window !== 'undefined' ? window : globalThis);
