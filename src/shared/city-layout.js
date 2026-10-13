// The layout of the project city (#373): where each zone, district, building and port of #371's
// city model (src/shared/city-model.js buildCity → model) stands on the ground, as plain numbers
// the 3D scene (src/renderer/city3d/) draws. Pure and deterministic: no I/O, clock or randomness.
// Rects are { x, z, w, d } on the ground (x..x+w by z..z+d); y is up.
// - squarify(items [{ id, weight }], rect { x, y, w, h }) → [{ id, x, y, w, h }]: the squarified
//   treemap (Bruls, Huizing, van Wijk), one cell per item with a weight > 0, areas proportional to
//   the weights, filling the rect.
// - layoutCity(model, { quadrants }) → { zones, districts, buildings, avenues, landmarks, ports,
//   edges, bounds, aggregated, note }: zones as strips in the model's (the plan's) order with an
//   AVENUE between them, each a treemap of its districts with a STREET between them; buildings
//   shelf-packed inside their district, the footprint growing with the lines, the height with the
//   complexity, floors from the function count and an antenna from the worst function; ports in a
//   row past the city's far edge. Over MAX_BUILDINGS drawn files the smallest are drawn as one
//   block per district (`aggregated`, `note`). `quadrants` ({ path: quadrant }, from the facts)
//   colours by quadrant.
// - COLOUR_BY, defaultColourBy(model), colourBy(layout, mode, { light }) → { colours, legend }.
// - The overlay API the city epic's next issues build on: applyOverlay(layout, { highlight
//   { path: colour }, markers [path] }) greys every building not highlighted and puts each marker
//   on its building's roof; flyTarget(layout, name) is the point to fly to for a file, a district
//   or a zone (null when unknown); findTargets(layout, query) feeds the search.
// - neighbours(layout, path) / districtNeighbours(layout, id): what a file or a district requires
//   and what requires it (the hover's arcs), from the model's edges.
// Browser: window.CityLayout; Node: module.exports.
(function (root) {
  const AVENUE = 7;
  const STREET = 2;
  const PAD = 0.8; // a district's kerb, around its buildings
  const GAP = 0.6; // between two buildings
  const LABEL = 1.6; // the deepest strip a district's name takes on its plate
  const SLACK = 1.35; // room left in a district beyond its buildings' footprints
  const MAX_BUILDINGS = 5000;
  const PORT_MARGIN = 14;
  const ASPECT = 1.6; // the city's width over its depth
  const STRIP = 3; // a zone's depth over its width, at most
  const EMPTY_DISTRICT = 16; // the ground of a district without files, so the plan's district still shows
  const COLOUR_BY = ['quadrant', 'zone', 'churn'];
  const QUADRANTS = ['Danger Zone', 'Cowboy Code', 'Fertile Ground', 'Healthy Closure'];
  // the buildings' colours in the run's two 3D themes (run3d-theme.js), as the proof of concept has
  // them: the quadrants on the state colours (Danger Zone failed, Cowboy Code changes, Fertile Ground
  // running, Healthy Closure done), the churn ramp, and one colour per zone in plan order
  const PALETTES = {
    dark: {
      quadrant: { 'Danger Zone': '#f87171', 'Cowboy Code': '#facc15', 'Fertile Ground': '#7c9cff', 'Healthy Closure': '#4ade80' },
      none: '#6f788c',
      zone: ['#8db4e2', '#c47a63', '#7fb08f', '#cda76b', '#c9b58f', '#a4abb8', '#ae8a5a', '#b49cff', '#cdbe9c', '#8a95ab'],
      churn: ['#2a3040', '#facc15', '#fb923c', '#f87171'],
    },
    light: {
      quadrant: { 'Danger Zone': '#EA4E4B', 'Cowboy Code': '#E39A12', 'Fertile Ground': '#4C6FFF', 'Healthy Closure': '#1FAE6E' },
      none: '#A7B0C2',
      zone: ['#8DB4E2', '#C47A63', '#9CC594', '#CDA76B', '#D8C7A4', '#A4ABB8', '#AE8A5A', '#7C5CFF', '#CDBE9C', '#717C90'],
      churn: ['#E9ECF2', '#F6D55C', '#F0883E', '#D7263D'],
    },
  };
  const TEST_RE = /(^|\/)(__tests__|e2e|spec|specs|test|tests)\/|\.(spec|test)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$/i;

  const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const arr = (x) => (Array.isArray(x) ? x : []);

  // ---------- the treemap ----------

  /** The squarified treemap of `items` in `rect`: [{ id, x, y, w, h }], heaviest first. */
  function squarify(items, rect) {
    const list = arr(items).map((it, i) => ({ id: it.id, weight: Number(it.weight) || 0, i }))
      .filter((it) => it.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.i - b.i);
    if (!list.length || !(rect.w > 0) || !(rect.h > 0)) return [];
    const scale = (rect.w * rect.h) / sum(list, (it) => it.weight);
    const areas = list.map((it) => ({ id: it.id, a: it.weight * scale }));
    const out = [];
    let { x, y, w, h } = rect;
    // the worst aspect ratio of a row laid along a side of length `side`
    const worst = (row, side) => {
      const s = sum(row, (r) => r.a);
      let max = 0, min = Infinity;
      for (const r of row) { max = Math.max(max, r.a); min = Math.min(min, r.a); }
      return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
    };
    const place = (row, last) => {
      const s = sum(row, (r) => r.a);
      if (w >= h) { // a column on the left
        const t = last ? w : s / h;
        let cy = y;
        row.forEach((r, k) => {
          const ch = k === row.length - 1 ? y + h - cy : r.a / t;
          out.push({ id: r.id, x, y: cy, w: t, h: ch });
          cy += ch;
        });
        x += t; w -= t;
      } else { // a row along the top
        const t = last ? h : s / w;
        let cx = x;
        row.forEach((r, k) => {
          const cw = k === row.length - 1 ? x + w - cx : r.a / t;
          out.push({ id: r.id, x: cx, y, w: cw, h: t });
          cx += cw;
        });
        y += t; h -= t;
      }
    };
    let row = [];
    for (let i = 0; i < areas.length;) {
      const side = Math.min(w, h);
      if (!row.length || worst([...row, areas[i]], side) <= worst(row, side)) {
        row.push(areas[i]);
        i++;
      } else {
        place(row, false);
        row = [];
      }
    }
    place(row, true);
    return out;
  }

  // ---------- buildings ----------

  // the proof of concept's rules (poc/project-city.html): height = H_MIN + H_K × √complexity (√(lines ×
  // PER_LINE) when nothing measured it), floors from the functions (lines / FLOOR_LINES otherwise), a
  // mast of ANTENNA_K × the worst function from ANTENNA_MIN; test files smaller and lower (a campus)
  const H_MIN = 1, H_K = 1.25, PER_LINE = 0.12;
  const FLOOR_CAP = 40, FLOOR_LINES = 45, FLOOR_CAP_UNMEASURED = 12;
  const ANTENNA_K = 0.25, ANTENNA_MIN = 8;
  const CAMPUS_SIZE = 0.7, CAMPUS_HEIGHT = 0.5;
  const isTest = (path) => TEST_RE.test(String(path));
  const footprint = (b) => clamp(0.9 + 0.13 * Math.sqrt(Math.max(0, b.lines || 0)), 0.9, 7) * (isTest(b.path) ? CAMPUS_SIZE : 1);
  const heightOf = (b) => Math.min(60, H_MIN + H_K * Math.sqrt(b.complexity != null ? b.complexity : (b.lines || 0) * PER_LINE)) * (isTest(b.path) ? CAMPUS_HEIGHT : 1);
  const floorsOf = (b) => (b.functions != null ? Math.min(b.functions, FLOOR_CAP) : Math.min(Math.floor((b.lines || 0) / FLOOR_LINES), FLOOR_CAP_UNMEASURED));
  const antennaOf = (b) => (b.worst != null && b.worst >= ANTENNA_MIN ? ANTENNA_K * b.worst : 0);

  // Over MAX_BUILDINGS files: the largest stay, the rest become one block per district
  function aggregate(buildings, districtIds) {
    if (buildings.length <= MAX_BUILDINGS) return { buildings, aggregated: false, note: '' };
    const keep = Math.max(0, MAX_BUILDINGS - districtIds.length);
    const ranked = [...buildings].sort((a, b) => b.lines - a.lines || byString(a.path, b.path));
    const kept = new Set(ranked.slice(0, keep).map((b) => b.path));
    const rest = {};
    for (const b of buildings) {
      if (kept.has(b.path)) continue;
      const r = rest[b.district] || (rest[b.district] = { files: 0, lines: 0, churn: 0, lastChange: null });
      r.files++;
      r.lines += b.lines;
      r.churn = Math.max(r.churn, b.churn || 0);
    }
    const blocks = Object.keys(rest).sort(byString).map((d) => ({
      aggregate: rest[d].files, churn: rest[d].churn, complexity: null, district: d, functions: null, lastChange: null,
      lines: rest[d].lines, path: `${d} (${rest[d].files} small files)`, worst: null,
    }));
    const small = buildings.length - kept.size;
    return {
      buildings: [...buildings.filter((b) => kept.has(b.path)), ...blocks],
      aggregated: true,
      note: `${buildings.length.toLocaleString('en-US')} files: the ${small.toLocaleString('en-US')} smallest are drawn as one block per district.`,
    };
  }

  // Shelf-packs a district's buildings inside `inner`, scaled down when they do not fit
  function pack(list, inner) {
    const sorted = [...list].sort((a, b) => b.side - a.side || byString(a.path, b.path));
    let x = 0, z = 0, rowD = 0, extent = 0;
    const at = [];
    for (const b of sorted) {
      if (x > 0 && x + b.side > inner.w) { z += rowD + GAP; x = 0; rowD = 0; }
      at.push({ b, x, z });
      extent = Math.max(extent, x + b.side);
      x += b.side + GAP;
      rowD = Math.max(rowD, b.side);
    }
    const depth = z + rowD;
    const s = Math.min(1, extent ? inner.w / extent : 1, depth ? inner.d / depth : 1);
    const ox = inner.x + (inner.w - extent * s) / 2;
    const oz = inner.z + (inner.d - depth * s) / 2;
    return at.map(({ b, x: bx, z: bz }) => ({ b, x: ox + bx * s, z: oz + bz * s, side: b.side * s }));
  }

  // a cell shrunk by half a street on each side (less when the cell is narrow)
  const inset = (r, by) => {
    const ix = Math.min(by, r.w / 4), iz = Math.min(by, r.d / 4);
    return { x: r.x + ix, z: r.z + iz, w: r.w - 2 * ix, d: r.d - 2 * iz };
  };

  /** The city on the ground: see the header. */
  function layoutCity(model, { quadrants = {} } = {}) {
    const zonesIn = arr(model && model.zones);
    const districtsIn = arr(model && model.districts);
    const zoneIds = new Set(zonesIn.map((z) => z.id));
    const districtZone = Object.fromEntries(districtsIn.map((d) => [d.id, zoneIds.has(d.zone) ? d.zone : null]));
    const { buildings: drawn, aggregated, note } = aggregate(arr(model && model.buildings), districtsIn.map((d) => d.id));
    const sized = drawn.map((b) => ({ ...b, side: footprint(b) }));
    const byDistrict = {};
    for (const b of sized) (byDistrict[b.district] || (byDistrict[b.district] = [])).push(b);
    // each district's weight: its buildings' footprints with their gaps and slack, plus its street
    const need = (id) => {
      const list = byDistrict[id] || [];
      const area = list.length ? sum(list, (b) => (b.side + GAP) ** 2) * SLACK : EMPTY_DISTRICT;
      return (Math.sqrt(area) + 2 * PAD + STREET + LABEL) ** 2;
    };
    const zoneList = zonesIn.map((z, index) => {
      const ds = districtsIn.filter((d) => districtZone[d.id] === z.id);
      const maxSide = Math.max(0, ...ds.flatMap((d) => (byDistrict[d.id] || []).map((b) => b.side)));
      return { z, index, ds, area: sum(ds, (d) => need(d.id)), minW: maxSide + 2 * PAD + STREET + 1 };
    }).filter((x) => x.ds.length);
    // each zone a strip along x from the near boulevard, STRIP times deeper than wide at most and the
    // city's depth D at most; D is the one that gives the city its ASPECT (a bisection: the width
    // falls as D grows), or the deepest the strips allow
    const avenues = AVENUE * Math.max(0, zoneList.length - 1);
    const sizeAt = (D) => zoneList.map((x) => {
      const d = Math.min(D, Math.max(Math.sqrt(STRIP * x.area), x.minW));
      return { d, w: Math.max(x.area / d, x.minW) };
    });
    const widthAt = (D) => sum(sizeAt(D), (s) => s.w) + avenues;
    let lo = 4, hi = 4 + 4 * Math.sqrt(sum(zoneList, (x) => x.area));
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (widthAt(mid) / mid > ASPECT) lo = mid; else hi = mid;
    }
    const sizes = sizeAt(hi);
    const depth = Math.max(8, ...sizes.map((s) => s.d));
    const zones = [];
    const districts = [];
    const buildings = [];
    const roads = [];
    let cx = 0;
    zoneList.forEach(({ z, index, ds }, k) => {
      const { w, d: zd } = sizes[k];
      if (zones.length) { // as deep as the deeper of the two zones it runs between
        const along = Math.max(zd, sizes[k - 1].d);
        roads.push({ axis: 'z', x: cx, z: depth - along, w: AVENUE, d: along });
        cx += AVENUE;
      }
      // along the boulevard at z = depth, the one the home view looks from (the zone names are there)
      const rect = { x: cx, z: depth - zd, w, d: zd };
      const files = sum(ds, (d) => (byDistrict[d.id] || []).length);
      zones.push({ ...rect, files, id: z.id, index, kind: z.kind, lines: sum(ds, (d) => sum(byDistrict[d.id] || [], (b) => b.lines)), name: z.name, purpose: z.purpose || '' });
      const cells = squarify(ds.map((d) => ({ id: d.id, weight: need(d.id) })), { x: rect.x, y: rect.z, w: rect.w, h: rect.d });
      for (const cell of cells) {
        const d = ds.find((x) => x.id === cell.id);
        const r = inset({ x: cell.x, z: cell.y, w: cell.w, d: cell.h }, STREET / 2);
        const list = byDistrict[d.id] || [];
        // the district's name on the ground, in a strip along its edge facing the home view (z + d);
        // the buildings behind it
        const inner = inset(r, PAD);
        const labelD = Math.min(LABEL, inner.d * 0.18);
        const label = { x: inner.x, z: inner.z + inner.d - labelD, w: inner.w, d: labelD };
        districts.push({ ...r, empty: !list.length, files: list.length, id: d.id, label, lines: sum(list, (b) => b.lines), name: d.name, purpose: d.purpose || '', zone: z.id });
        for (const p of pack(list, { x: inner.x, z: inner.z, w: inner.w, d: inner.d - labelD })) {
          const b = p.b;
          buildings.push({
            aggregate: b.aggregate || 0,
            antenna: antennaOf(b),
            churn: b.churn || 0,
            complexity: b.complexity ?? null,
            d: p.side,
            district: d.id,
            floors: floorsOf(b),
            functions: b.functions ?? null,
            h: heightOf(b),
            landmark: null,
            lastChange: b.lastChange || null,
            lines: b.lines || 0,
            path: b.path,
            quadrant: quadrants[b.path] || null,
            test: isTest(b.path),
            w: p.side,
            worst: b.worst ?? null,
            x: p.x,
            z: p.z,
            zone: z.id,
          });
        }
      }
      cx += w;
    });
    const width = cx;
    // the boulevard along the near edge joins the avenues
    if (zones.length) roads.push({ axis: 'x', x: -AVENUE, z: depth, w: width + 2 * AVENUE, d: AVENUE });
    const at = Object.fromEntries(buildings.map((b) => [b.path, b]));
    const landmarks = arr(model && model.landmarks).filter((l) => at[l.path]).map((l) => {
      at[l.path].landmark = l.label;
      const b = at[l.path];
      return { label: l.label, path: l.path, x: b.x + b.w / 2, y: b.h + b.antenna, z: b.z + b.d / 2 };
    });
    const portsIn = arr(model && model.ports);
    // past the far boulevard, behind the city as the home view sees it
    const portZ = -AVENUE - PORT_MARGIN;
    const ports = portsIn.map((p, i) => ({
      id: p.id, name: p.name, via: arr(p.via).filter((v) => at[v]),
      x: portsIn.length === 1 ? width / 2 : (width * (i + 0.5)) / portsIn.length, y: 0, z: portZ,
    }));
    const bounds = { maxX: width + AVENUE, maxZ: depth + AVENUE, minX: -AVENUE, minZ: ports.length ? portZ - 6 : -AVENUE };
    bounds.centerX = (bounds.minX + bounds.maxX) / 2;
    bounds.centerZ = (bounds.minZ + bounds.maxZ) / 2;
    bounds.size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    return { aggregated, avenueWidth: AVENUE, avenues: roads, bounds, buildings, districts, edges: Array.isArray(model && model.edges) ? model.edges : [], landmarks, note, ports, zones };
  }

  // ---------- colour by ----------

  /** Quadrant when a tool measured the complexity, the zones otherwise. */
  const defaultColourBy = (model) => (model && model.complexity && model.complexity.status === 'measured' ? 'quadrant' : 'zone');

  // #RRGGBB between two colours
  function mix(a, b, t) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
  }
  function ramp(stops, t) {
    const k = clamp(t, 0, 1) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(k));
    return mix(stops[i], stops[i + 1], k - i);
  }

  /** Each building's colour (by index) and the legend of `mode` (quadrant, zone or churn). */
  function colourBy(layout, mode, { light = false } = {}) {
    const pal = light ? PALETTES.light : PALETTES.dark;
    const buildings = layout.buildings;
    if (mode === 'zone') {
      const of = Object.fromEntries(layout.zones.map((z) => [z.id, pal.zone[z.index % pal.zone.length]]));
      return { colours: buildings.map((b) => of[b.zone] || pal.none), legend: layout.zones.map((z) => ({ colour: of[z.id], label: z.name })) };
    }
    if (mode === 'churn') {
      const max = Math.max(1, ...buildings.map((b) => b.churn));
      const t = (c) => Math.log1p(c) / Math.log1p(max);
      return {
        colours: buildings.map((b) => ramp(pal.churn, t(b.churn))),
        legend: [{ colour: ramp(pal.churn, 0), label: 'No commit' }, { colour: ramp(pal.churn, t(Math.round(Math.sqrt(max)))), label: `${Math.round(Math.sqrt(max))} commits` }, { colour: ramp(pal.churn, 1), label: `${max} commits` }],
      };
    }
    return {
      colours: buildings.map((b) => pal.quadrant[b.quadrant] || pal.none),
      legend: [...QUADRANTS.map((q) => ({ colour: pal.quadrant[q], label: q })), { colour: pal.none, label: 'Not measured' }],
    };
  }

  // ---------- the overlay API ----------

  /** The layout with `highlight`ed buildings in their colour, the rest greyed, and `markers` on their roofs. */
  function applyOverlay(layout, { highlight = {}, markers = [] } = {}) {
    const lit = highlight || {};
    const any = Object.keys(lit).length > 0;
    const buildings = layout.buildings.map((b) => ({ ...b, colour: lit[b.path] || b.colour || null, greyed: any && !lit[b.path] }));
    const at = Object.fromEntries(buildings.map((b) => [b.path, b]));
    const out = [];
    for (const m of arr(markers)) {
      const path = typeof m === 'string' ? m : m && m.path;
      const b = at[path];
      if (b) out.push({ colour: (m && m.colour) || null, label: (m && m.label) || '', path, x: b.x + b.w / 2, y: b.h, z: b.z + b.d / 2 });
    }
    return { ...layout, buildings, markers: out };
  }

  /** Where the camera flies for a file, a district or a zone (by id or name): { kind, id, x, y, z, distance } or null. */
  function flyTarget(layout, name) {
    const b = layout.buildings.find((x) => x.path === name);
    if (b) return { distance: clamp(b.h * 3 + 20, 24, 90), id: b.path, kind: 'building', x: b.x + b.w / 2, y: b.h / 2, z: b.z + b.d / 2 };
    const area = (kind, r) => ({ distance: clamp(Math.max(r.w, r.d) * 1.6, 30, 400), id: r.id, kind, x: r.x + r.w / 2, y: 0, z: r.z + r.d / 2 });
    const d = layout.districts.find((x) => x.id === name) || layout.districts.find((x) => x.name === name);
    if (d) return area('district', d);
    const z = layout.zones.find((x) => x.id === name) || layout.zones.find((x) => x.name === name);
    return z ? area('zone', z) : null;
  }

  /** The search's matches for `query` (files by path, districts and zones by name): [{ kind, id, label }]. */
  function findTargets(layout, query, limit = 8) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const hit = (s) => String(s).toLowerCase().includes(q);
    return [
      ...layout.zones.filter((z) => hit(z.name)).map((z) => ({ id: z.id, kind: 'zone', label: z.name })),
      ...layout.districts.filter((d) => hit(d.name) || hit(d.id)).map((d) => ({ id: d.id, kind: 'district', label: d.name })),
      ...layout.buildings.filter((b) => hit(b.path)).map((b) => ({ id: b.path, kind: 'building', label: b.path })),
    ].slice(0, limit);
  }

  // ---------- the hover's arcs ----------

  /** The files `path` requires and those that require it (file edges). */
  function neighbours(layout, path) {
    const edges = layout.edges.filter((e) => e.kind === 'file');
    return { requiredBy: edges.filter((e) => e.to === path).map((e) => e.from), requires: edges.filter((e) => e.from === path).map((e) => e.to) };
  }

  /** The districts `id` depends on and those that depend on it (district edges, e.g. Rust crates). */
  function districtNeighbours(layout, id) {
    const edges = layout.edges.filter((e) => e.kind === 'district');
    return { requiredBy: edges.filter((e) => e.to === id).map((e) => e.from), requires: edges.filter((e) => e.from === id).map((e) => e.to) };
  }

  const api = {
    applyOverlay,
    AVENUE,
    COLOUR_BY,
    colourBy,
    defaultColourBy,
    districtNeighbours,
    findTargets,
    flyTarget,
    isTest,
    layoutCity,
    MAX_BUILDINGS,
    neighbours,
    QUADRANTS,
    squarify,
    STREET,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CityLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
