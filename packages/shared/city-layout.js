// The layout of the project city (#373, the proof of concept's layout ported in #382): where each
// zone, district, building and port of #371's city model (packages/shared/city-model.js buildCity → model)
// stands on the ground, as plain numbers the 3D scene (fronts/analyser/city3d/) draws. Pure and
// deterministic: no I/O, clock or randomness. Rects are { x, z, w, d } on the ground (x..x+w by
// z..z+d); y is up; the camera's home view looks from the south-east (+x, +z).
// The rules and their constants are poc/project-city.html's (phase 3, PR #379, the look the owner
// approved on this repository), copied, not re-derived:
// - the city is a rectangle of CITY_ASPECT whose area is the drawn files' weight × UNIT_AREA (the
//   POC's 360 × 240 city on this repository; a smaller project shrinks the roads, sidewalks and name
//   strips with it, down to SCALE_MIN, so the proportions stay); the zones fill it as strips in the plan's order
//   (stripLayout, from the south edge northward), an AVENUE between them; an outskirts zone (the
//   unmatched files) is a block outside the east edge;
// - inside a zone, the districts are a squarified treemap (squarify) of their weight, a STREET
//   between their raised plates, the zone's name in a strip along its south (or east) edge;
// - inside a district plate, a SIDEWALK, the district's name in a strip, and the buildings as a
//   treemap of the files' weight ((lines + 15)^0.85, campus files half) filling FILL of the plate,
//   each cell inset by a GAP (gapOf) so streets show between buildings;
// - a building's height is H_MIN + H_K × √complexity (√(lines × the measured complexity per line,
//   PER_LINE_DEFAULT when nothing is measured; campus files lower), heightOf; its ledges come from
//   the functions (the lines otherwise), at most LEDGES_MAX spaced along the height (ledgesOf); a
//   mast from the worst function (city-buildings.js antennaOf);
// - ports are docks outside the city edge nearest their files, spread along it (layoutPorts).
// Over MAX_BUILDINGS drawn files the smallest are drawn as one block per district (`aggregated`,
// `note`). `quadrants` ({ path: quadrant }, from the facts) colours by quadrant; `scores` ({ path:
// score }, the facts' too) is each building's `score`, the badge the city shows up close (#449).
// - layoutCity(model, { quadrants, scores }) →{ zones, districts, buildings, avenues, ring, landmarks,
//   ports, edges, bounds, aggregated, note, avenueWidth, scale }.
// - squarify(items [{ id, weight }], rect { x, y, w, h }) → [{ id, x, y, w, h }]; stripLayout(items,
//   rect) → [{ y0, y1, cells }], the order kept.
// - COLOUR_BY, defaultColourBy(model), colourBy(layout, mode, { light }) → { colours, legend }: by
//   quadrant (campus files quieter), by zone (a tint per zone kind) or by churn (a heat ramp).
// - #782 measuredShare(model) → { files, measured, unmeasured, share, languages: [{ language, files, share, tool }] }:
//   how much of the code (no test files) a tool measured; over half unmeasured, the city opens in churn.
// - #782 labelsShown(layout, { hover, pinned, fly }) → { districts, landmarks, ports }: the labels drawn now.
// - The overlay API the city epic's modules build on: applyOverlay(layout, { highlight { path:
//   colour }, markers [path] }) greys every building not highlighted and puts each marker on its
//   building's roof; flyTarget(layout, name) is the point to fly to for a file, a district or a zone
//   (null when unknown); findTargets(layout, query) feeds the search; mergeOverlays(layers) merges the
//   named layers, in order, into the one { highlight, markers } applyOverlay takes.
// - neighbours(layout, path) / districtNeighbours(layout, id): what a file or a district requires
//   and what requires it (the hover's arcs), from the model's edges.
// Browser: window.CityLayout; Node: module.exports.
(function (root) {
  // ---------- the proof of concept's constants ----------
  const CITY_ASPECT = 1.5; // the city rectangle's width over its depth
  const UNIT_AREA = 1.18; // ground area per unit of weight: the POC's fixed 360 × 240 city, on this repository's drawn files
  const POC_CITY_W = 360, SCALE_MIN = 0.2; // the POC's width; the roads and strips below scale with the city's width over it, never under SCALE_MIN
  const AVENUE = 16, SIDEWALK_AV = 2.6; // between zones: an avenue, with a sidewalk along each zone
  const STREET = 6, SIDEWALK = 1.4, GAP = 0.8; // between districts: a street; inside a plate: a sidewalk; between buildings: a gap
  const LABEL_H = 8, ZONE_LABEL_H = 11; // the strips for the district and zone names
  const ZONE_FLOOR = 0.05, DISTRICT_FLOOR = 0.06, FILL = 0.72; // minimum shares (a plaza fills the rest); the buildings' share of a plate
  const CAMPUS_WEIGHT = 0.5, CAMPUS_HEIGHT = 0.5; // campus files (tests): smaller footprints, lower buildings
  const H_MIN = 1.0, H_K = 1.25, PER_LINE_DEFAULT = 0.12; // height = H_MIN + H_K × √complexity; complexity per line when nothing is measured
  const FLOOR_CAP = 40, FLOOR_LINES = 45, FLOOR_CAP_UNMEASURED = 12; // floors: the functions, or lines / FLOOR_LINES
  const LEDGES_MAX = 6; // ledges drawn on a building at most (#382: a few, never one per floor)
  const PORT_OFF = AVENUE * 0.9, PORT_SPACING = 22; // docks: outside the edge, apart along it
  const OUTSKIRTS_MIN = 28;
  const MAX_BUILDINGS = 5000;
  // text widths without a canvas: bold text at LABEL_FONT of the strip's height, the count after it at SUB_FONT of that
  const CHAR_W = 0.56, LABEL_FONT = 0.6, SUB_FONT = 0.78, LABEL_PAD = 0.7;
  const COLOUR_BY = ['quadrant', 'zone', 'churn'];
  // the buildings' colours in the run's two 3D themes (run3d-theme.js), as the proof of concept has
  // them: the quadrants on the state colours, in ArchitectureModel.QUADRANTS' order (Danger Zone
  // failed, Cowboy Code changes, Fertile Ground running, Healthy Closure done), campus files quieter,
  // the churn ramp, and a tint per zone kind
  const PALETTES = {
    dark: {
      quadrant: ['#f87171', '#facc15', '#7c9cff', '#4ade80'],
      none: '#6f788c',
      campus: '#3e4659',
      kind: { civic: '#c9b58f', commercial: '#8db4e2', industrial: '#c47a63', infrastructure: '#a4abb8', logistics: '#cda76b', power: '#8a95ab', workshop: '#ae8a5a', library: '#cdbe9c', campus: '#7fb08f', outskirts: '#9a958d' },
      churn: ['#2a3040', '#facc15', '#fb923c', '#f87171'],
    },
    light: {
      quadrant: ['#EA4E4B', '#E39A12', '#4C6FFF', '#1FAE6E'],
      none: '#A7B0C2',
      campus: '#D5DAE5',
      kind: { civic: '#D8C7A4', commercial: '#8DB4E2', industrial: '#C47A63', infrastructure: '#A4ABB8', logistics: '#CDA76B', power: '#717C90', workshop: '#AE8A5A', library: '#CDBE9C', campus: '#9CC594', outskirts: '#C9C2B8' },
      churn: ['#E9ECF2', '#F6D55C', '#F0883E', '#D7263D'],
    },
  };
  const OUTSKIRTS_ZONE = { id: 'outskirts', kind: 'outskirts', name: 'Outskirts', purpose: 'Drawn files no district rule matched.' };
  // the facts' quadrants and the product's test-file patterns, resolved at call time (in the browser
  // packages/shared/globs.js loads after this file)
  const node = typeof module === 'object' && module.exports;
  const architectureModel = () => (node ? require('./architecture-model') : root.ArchitectureModel);
  // #23: the legend's words in the interface's language (packages/shared/i18n.js, window.I18n in the browser)
  const t = (...a) => (node ? require('./i18n') : root.I18n)?.t(...a) ?? a[0];
  const quadrantNames = () => {
    const m = architectureModel();
    return (m && m.QUADRANTS) || [];
  };
  // the mast's rule is the v2 buildings' (packages/shared/city-buildings.js, loaded before this file);
  // without it no mast
  const antennaOf = (b) => {
    const m = node ? require('./city-buildings') : root.CityBuildings;
    return m ? m.antennaOf(b) : 0;
  };
  let testMatchers = null;
  const isTest = (path) => {
    if (!testMatchers) {
      const g = node ? require('./globs') : root.Globs;
      if (!g) return false;
      testMatchers = g.TESTS_PATHS.map((p) => g.globMatcher(p));
    }
    const p = String(path);
    return testMatchers.some((m) => m.test(p));
  };

  const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const arr = (x) => (Array.isArray(x) ? x : []);
  // ground rects: the treemaps work in { x, y, w, h } (y south), the scene reads { x, z, w, d }
  const insetRect = (r, m) => ({ x: r.x + m, y: r.y + m, w: Math.max(0, r.w - 2 * m), h: Math.max(0, r.h - 2 * m) });
  // an inset that leaves at least half of a small rect (the POC's cities are wide enough never to need it)
  const insetCapped = (r, m) => insetRect(r, Math.min(m, r.w / 4, r.h / 4));
  const toXZ = (r) => ({ x: r.x, z: r.y, w: r.w, d: r.h });
  const labelXZ = (l) => (l ? { x: l.x, z: l.y, w: l.w, d: l.h, vertical: !!l.vertical } : null);

  // ---------- the treemaps ----------

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

  /** The strip treemap, the order kept: strips from the south edge of `rect` (y + h) northward, the items left to right. */
  function stripLayout(items, rect) {
    const list = arr(items).map((it) => ({ id: it.id, weight: Math.max(0, Number(it.weight) || 0) }));
    const total = sum(list, (it) => it.weight);
    if (!list.length || !(total > 0) || !(rect.w > 0) || !(rect.h > 0)) return [];
    const scale = (rect.w * rect.h) / total;
    const area = (it) => it.weight * scale;
    // the mean aspect ratio of a strip of area `a` across the rect's width
    const aspect = (strip, a) => {
      const h = a / rect.w;
      return sum(strip, (it) => { const w = area(it) / h; return Math.max(w / h, h / w); }) / strip.length;
    };
    const strips = [];
    let y = rect.y + rect.h, strip = [], stripArea = 0;
    const flush = () => {
      const h = stripArea / rect.w;
      let x = rect.x;
      const cells = strip.map((it) => { const w = area(it) / h; const cell = { id: it.id, x, y: y - h, w, h }; x += w; return cell; });
      strips.push({ y0: y - h, y1: y, cells });
      y -= h; strip = []; stripArea = 0;
    };
    for (const it of list) {
      const a = area(it);
      if (strip.length && aspect(strip, stripArea) < aspect([...strip, it], stripArea + a)) flush();
      strip.push(it); stripArea += a;
    }
    if (strip.length) flush();
    return strips;
  }

  // ---------- buildings ----------

  /** The complexity a line carries, measured over the files a tool measured (PER_LINE_DEFAULT when none). */
  function perLineOf(buildings) {
    const measured = arr(buildings).filter((b) => b.complexity != null);
    const lines = sum(measured, (b) => b.lines || 0);
    return measured.length && lines > 0 ? sum(measured, (b) => b.complexity) / lines : PER_LINE_DEFAULT;
  }
  /** A building's height: H_MIN + H_K × √complexity (the lines × `perLine` when nothing is measured; a campus file lower). */
  function heightOf(b, { perLine = PER_LINE_DEFAULT, campus = false } = {}) {
    const c = b.complexity != null ? b.complexity : (b.lines || 0) * perLine * (campus ? CAMPUS_HEIGHT : 1);
    return H_MIN + H_K * Math.sqrt(Math.max(0, c));
  }
  /** A file's weight on the ground: (lines + 15)^0.85, half for a campus file. */
  const weightOf = (b, campus) => Math.pow((b.lines || 0) + 15, 0.85) * (campus ? CAMPUS_WEIGHT : 1);
  /** The floors a building has: its functions (capped), or its lines / FLOOR_LINES when nothing measured them. */
  const floorsOf = (b) => (b.functions != null ? Math.min(FLOOR_CAP, b.functions) : Math.min(FLOOR_CAP_UNMEASURED, Math.round((b.lines || 0) / FLOOR_LINES)));
  /** The ledges drawn on a building: one less than its floors, at most LEDGES_MAX. */
  const ledgesOf = (b) => clamp(floorsOf(b) - 1, 0, LEDGES_MAX);
  /** The gap around a building inside its cell of w × d: GAP, less in a small cell. */
  const gapOf = (w, d, gap = GAP) => Math.min(gap, w * 0.22, d * 0.22);
  // the width of a name (bold) and a count after it (smaller) in a strip `hUnits` deep, in ground units
  const textUnits = (text, hUnits, scale = 1) => String(text == null ? '' : text).length * CHAR_W * LABEL_FONT * hUnits * scale;
  const labelWidth = (text, sub, hUnits) => textUnits(text, hUnits) + textUnits(sub, hUnits, SUB_FONT) + LABEL_PAD;

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

  // A name's strip along the south edge of `block` (the east edge when the block is much taller than
  // wide, so the camera from the south-east reads it past the towers), and the room left for what it
  // names: { label, inner }. The strip may run `over` past the block, onto the street or the avenue.
  function nameStrip(block, name, sub, depth, tall, over, pad) {
    const vertical = block.h > block.w * tall;
    const lh = Math.min(depth, (vertical ? block.w : block.h) * 0.3);
    const need = labelWidth(name, sub, lh), room = (vertical ? block.h : block.w) - 2 * pad;
    const len = Math.min(Math.max(need, room), room + over);
    if (vertical) {
      return {
        label: { x: block.x + block.w - pad - lh, y: block.y + (block.h - len) / 2, w: lh, h: len, vertical },
        inner: { x: block.x + pad, y: block.y + pad, w: block.w - 2 * pad - lh, h: block.h - 2 * pad },
      };
    }
    return {
      label: { x: block.x + (block.w - len) / 2, y: block.y + block.h - lh, w: len, h: lh, vertical },
      inner: { x: block.x + pad, y: block.y + pad, w: block.w - 2 * pad, h: block.h - lh - pad },
    };
  }

  // A district plate's inside: the sidewalk, the name strip and the buildings' treemap, filling FILL
  // of the plate's share (`unit` ground area per unit of weight); returns the buildings' rects.
  function layoutDistrict(g, unit, m) {
    const block = insetCapped(g.cell, m.street / 2);
    let { label, inner } = nameStrip(block, g.d.name, `  ${g.items.length}`, m.labelH, 1.25, m.street * 1.5, m.sidewalk);
    if (inner.w <= 0.5 * m.k || inner.h <= 0.5 * m.k) { // a plate too small for its sidewalk and name: the buildings take it whole
      inner = insetCapped(block, m.sidewalk);
      label = null;
    }
    const want = g.weight * unit * FILL;
    if (inner.w * inner.h > want) {
      const s = Math.sqrt(want / (inner.w * inner.h));
      inner = { ...inner, w: inner.w * s, h: inner.h * s };
    }
    const cells = squarify(g.items.map((it) => ({ id: it.b.path, weight: it.weight })), inner);
    const byPath = Object.fromEntries(g.items.map((it) => [it.b.path, it]));
    const placed = cells.map((cell) => {
      const gap = gapOf(cell.w, cell.h, m.gap);
      const r = insetRect(cell, gap);
      return { it: byPath[cell.id], x: r.x, z: r.y, w: r.w, d: r.h };
    });
    return { block, label, placed };
  }

  /** Ports as docks outside the city edge nearest their files, spread apart along it. */
  function layoutPorts(portsIn, at, bounds, m) {
    const docks = [];
    for (const p of portsIn) {
      const via = arr(p.via).filter((v) => at[v]);
      if (!via.length) continue;
      const centre = (b) => ({ x: b.x + b.w / 2, z: b.z + b.d / 2 });
      const cx = sum(via, (v) => centre(at[v]).x) / via.length, cz = sum(via, (v) => centre(at[v]).z) / via.length;
      const dists = { S: bounds.y + bounds.h - cz, N: cz - bounds.y, E: bounds.x + bounds.w - cx, W: cx - bounds.x };
      const edge = Object.keys(dists).sort((a, b) => dists[a] - dists[b] || byString(a, b))[0];
      docks.push({ id: p.id, name: p.name, via, edge, t: edge === 'S' || edge === 'N' ? cx : cz });
    }
    for (const edge of ['S', 'N', 'E', 'W']) {
      const row = docks.filter((d) => d.edge === edge).sort((a, b) => a.t - b.t || byString(a.id, b.id));
      for (let i = 1; i < row.length; i++) row[i].t = Math.max(row[i].t, row[i - 1].t + m.portSpacing);
      for (const d of row) {
        d.along = edge === 'S' || edge === 'N'; // the dock lies along the edge
        d.x = d.along ? d.t : edge === 'E' ? bounds.x + bounds.w + m.portOff : bounds.x - m.portOff;
        d.z = edge === 'S' ? bounds.y + bounds.h + m.portOff : edge === 'N' ? bounds.y - m.portOff : d.t;
        d.y = 0;
        delete d.t;
      }
    }
    return docks;
  }

  // The drawn files grouped by district and the districts by zone, in the plan's order, each with its
  // weight on the ground: { zoneGroups: [{ z, index, districts: [{ d, items: [{ b, weight }], weight }], weight }],
  // campus(b) }. A district the plan does not name, or whose zone it does not name, goes to the Outskirts.
  function groupByZone(model, drawn) {
    const zonesIn = arr(model && model.zones);
    const districtsIn = arr(model && model.districts);
    const zoneById = Object.fromEntries(zonesIn.map((z) => [z.id, z]));
    const districtById = Object.fromEntries(districtsIn.map((d) => [d.id, d]));
    const zoneOf = (d) => (d && zoneById[d.zone] ? d.zone : OUTSKIRTS_ZONE.id);
    const kindOf = (b) => { const d = districtById[b.district]; const z = zoneById[zoneOf(d)]; return z ? z.kind : OUTSKIRTS_ZONE.kind; };
    const campus = (b) => kindOf(b) === 'campus' || isTest(b.path);
    const groups = new Map();
    for (const b of drawn) {
      const d = districtById[b.district] || { id: b.district, name: b.district, zone: OUTSKIRTS_ZONE.id, purpose: '' };
      const g = groups.get(d.id) || groups.set(d.id, { d, items: [], weight: 0 }).get(d.id);
      const weight = weightOf(b, campus(b));
      g.items.push({ b, weight });
      g.weight += weight;
    }
    const orphans = [...groups.values()].filter((g) => !zoneById[g.d.zone]);
    const zoneList = zonesIn.some((z) => z.id === OUTSKIRTS_ZONE.id) || !orphans.length ? zonesIn : [...zonesIn, OUTSKIRTS_ZONE];
    const zoneGroups = zoneList.map((z, index) => ({
      z, index,
      districts: [...districtsIn.filter((d) => zoneOf(d) === z.id && groups.has(d.id)).map((d) => groups.get(d.id)), ...(z.id === OUTSKIRTS_ZONE.id ? orphans.filter((g) => !districtById[g.d.id]) : [])],
    })).filter((zg) => zg.districts.length);
    for (const zg of zoneGroups) zg.weight = sum(zg.districts, (g) => g.weight);
    return { zoneGroups, campus };
  }

  // A zone laid out inside its cell: its block, name strip, the districts' treemap (squarify, a
  // DISTRICT_FLOOR share each at least) and their plates with the buildings (layoutDistrict)
  function layoutZone(zg, m, unit, place) {
    const block = insetCapped(zg.cell, m.avenue / 2);
    const { label } = nameStrip(block, zg.z.name, `  ${zg.z.kind}`, m.zoneLabelH, 1.3, m.avenue * 1.4, m.sidewalk);
    // the districts' room: the block less half a street, and the name's strip
    const strip = Math.min(m.zoneLabelH, (label.vertical ? block.w : block.h) * 0.3);
    const dRect = label.vertical
      ? insetCapped({ x: block.x, y: block.y, w: block.w - strip, h: block.h }, m.street / 2)
      : insetCapped({ x: block.x, y: block.y, w: block.w, h: block.h - strip }, m.street / 2);
    const dTotal = sum(zg.districts, (g) => g.weight);
    for (const g of zg.districts) g.wBlock = Math.max(g.weight, dTotal * DISTRICT_FLOOR);
    const dCells = squarify(zg.districts.map((g) => ({ id: g.d.id, weight: g.wBlock })), dRect);
    const dUnit = Math.min(unit, (dRect.w * dRect.h) / Math.max(1e-9, sum(zg.districts, (g) => g.wBlock)));
    const files = sum(zg.districts, (g) => g.items.length);
    const lines = sum(zg.districts, (g) => sum(g.items, (it) => it.b.lines || 0));
    const zone = { ...toXZ(block), cell: toXZ(zg.cell), files, id: zg.z.id, index: zg.index, kind: zg.z.kind, label: labelXZ(label), lines, name: zg.z.name, purpose: zg.z.purpose || '' };
    const districts = [], buildings = [];
    for (const cell of dCells) {
      const g = zg.districts.find((x) => x.d.id === cell.id);
      g.cell = cell;
      const { block: plate, label: dLabel, placed } = layoutDistrict(g, dUnit, m);
      districts.push({
        ...toXZ(plate), cell: toXZ(cell), empty: false, files: g.items.length, id: g.d.id, label: labelXZ(dLabel),
        lines: sum(g.items, (it) => it.b.lines || 0), name: g.d.name, purpose: g.d.purpose || '', zone: zg.z.id,
      });
      for (const p of placed) buildings.push(place(p, g.d.id, zg.z.id));
    }
    return { zone, districts, buildings };
  }

  /** The city on the ground: see the header. */
  function layoutCity(model, { quadrants = {}, scores = {} } = {}) {
    const districtsIn = arr(model && model.districts);
    const { buildings: drawn, aggregated, note } = aggregate(arr(model && model.buildings), districtsIn.map((d) => d.id));
    const { zoneGroups, campus } = groupByZone(model, drawn);
    const perLine = perLineOf(drawn);
    let inner = zoneGroups.filter((zg) => zg.z.kind !== 'outskirts');
    let outskirts = zoneGroups.find((zg) => zg.z.kind === 'outskirts') || null;
    if (!inner.length && outskirts) { inner = [outskirts]; outskirts = null; }
    // the city rectangle: the zones' weight at the POC's density, in its aspect
    const total = sum(inner, (zg) => zg.weight);
    for (const zg of inner) zg.wBlock = Math.max(zg.weight, total * ZONE_FLOOR);
    const totalBlock = Math.max(1e-9, sum(inner, (zg) => zg.wBlock));
    const cityW = Math.max(POC_CITY_W * SCALE_MIN, Math.sqrt(totalBlock * UNIT_AREA * CITY_ASPECT));
    const cityH = cityW / CITY_ASPECT;
    // the POC's road, sidewalk and strip sizes, scaled down with a city narrower than the POC's
    const k = clamp(cityW / POC_CITY_W, SCALE_MIN, 1);
    const m = { k, avenue: AVENUE * k, street: STREET * k, sidewalk: SIDEWALK * k, labelH: LABEL_H * k, zoneLabelH: ZONE_LABEL_H * k, gap: GAP * k, portOff: PORT_OFF * k, portSpacing: PORT_SPACING * k };
    const rect = { x: -cityW / 2, y: -cityH / 2, w: cityW, h: cityH };
    const unit = (rect.w * rect.h) / totalBlock;
    const strips = stripLayout(inner.map((zg) => ({ id: zg.z.id, weight: zg.wBlock })), rect);
    const cellOf = Object.fromEntries(strips.flatMap((s) => s.cells).map((c) => [c.id, c]));
    for (const zg of inner) zg.cell = cellOf[zg.z.id] || { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    let city = { ...rect };
    if (outskirts) { // a block outside the east edge
      const side = Math.min(cityH, Math.max(OUTSKIRTS_MIN * k, Math.sqrt(outskirts.weight * unit * 1.6) + m.street + m.zoneLabelH));
      outskirts.cell = { x: rect.x + rect.w, y: rect.y + rect.h - side, w: side, h: side };
      city = { x: rect.x, y: rect.y, w: rect.w + side, h: rect.h };
    }
    // the avenues' centre lines: between the strips, and between the zones of a strip
    const avenues = [];
    strips.forEach((s, i) => {
      if (i) avenues.push({ axis: 'x', x: rect.x, z: s.y1, length: rect.w });
      s.cells.forEach((c, j) => { if (j) avenues.push({ axis: 'z', x: c.x, z: s.y0, length: s.y1 - s.y0 }); });
    });
    // a placed building, with everything the scene and the cards read
    const place = (p, district, zone) => {
      const b = p.it.b;
      const isCampus = campus(b);
      return {
        aggregate: b.aggregate || 0, antenna: antennaOf(b), churn: b.churn || 0, complexity: b.complexity ?? null, d: p.d, district,
        floors: floorsOf(b), functions: b.functions ?? null, h: heightOf(b, { perLine, campus: isCampus }), landmark: null,
        lastChange: b.lastChange || null, ledges: ledgesOf(b), lines: b.lines || 0, path: b.path, quadrant: quadrants[b.path] || null,
        score: scores[b.path] ?? null, test: isCampus, w: p.w, worst: b.worst ?? null, x: p.x, z: p.z, zone,
      };
    };
    const zones = [], districts = [], buildings = [];
    for (const zg of [...inner, ...(outskirts ? [outskirts] : [])]) {
      const out = layoutZone(zg, m, unit, place);
      zones.push(out.zone);
      districts.push(...out.districts);
      buildings.push(...out.buildings);
    }
    const at = Object.fromEntries(buildings.map((b) => [b.path, b]));
    const landmarks = arr(model && model.landmarks).filter((l) => at[l.path]).map((l) => {
      at[l.path].landmark = l.label;
      const b = at[l.path];
      return { label: l.label, path: l.path, x: b.x + b.w / 2, y: b.h + b.antenna, z: b.z + b.d / 2 };
    });
    const ports = layoutPorts(arr(model && model.ports), at, city, m);
    // the ring road around the city, and the bounds (the ports' docks included)
    const ring = toXZ(insetRect(city, -m.avenue / 2));
    const bounds = { maxX: ring.x + ring.w, maxZ: ring.z + ring.d, minX: ring.x, minZ: ring.z };
    for (const p of ports) {
      bounds.minX = Math.min(bounds.minX, p.x - 9 * k); bounds.maxX = Math.max(bounds.maxX, p.x + 9 * k);
      bounds.minZ = Math.min(bounds.minZ, p.z - 9 * k); bounds.maxZ = Math.max(bounds.maxZ, p.z + 9 * k);
    }
    bounds.centerX = (bounds.minX + bounds.maxX) / 2;
    bounds.centerZ = (bounds.minZ + bounds.maxZ) / 2;
    bounds.size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    return { aggregated, avenueWidth: m.avenue, avenues, bounds, buildings, districts, edges: Array.isArray(model && model.edges) ? model.edges : [], landmarks, note, ports, ring, scale: k, zones };
  }

  // ---------- colour by ----------

  /** #782: how much of the code a tool measured, see the header. Test files have their own legend row. */
  function measuredShare(model) {
    const m = architectureModel() || {};
    const code = arr(model && model.buildings).filter((b) => !isTest(b.path));
    const missing = code.filter((b) => b.complexity == null);
    const counts = new Map();
    for (const b of missing) {
      const language = m.languageOf ? m.languageOf(b.path) : 'Other';
      counts.set(language, (counts.get(language) || 0) + 1);
    }
    const languages = [...counts].sort((a, b) => b[1] - a[1] || byString(a[0], b[0]))
      .map(([language, files]) => ({ language, files, share: files / code.length, tool: (m.COMPLEXITY_TOOLS || {})[language] || null }));
    return { files: code.length, measured: code.length - missing.length, unmeasured: missing.length, share: code.length ? missing.length / code.length : 0, languages };
  }

  /** #782: churn when most of the code has no measure, quadrant when a tool measured it, the zones otherwise. */
  function defaultColourBy(model) {
    const { files, share } = measuredShare(model);
    if (files && share > 0.5) return 'churn';
    return files && model.complexity && model.complexity.status === 'measured' ? 'quadrant' : 'zone';
  }

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
      const tint = (kind) => pal.kind[kind] || pal.kind.outskirts;
      const of = Object.fromEntries(layout.zones.map((z) => [z.id, tint(z.kind)]));
      return { colours: buildings.map((b) => of[b.zone] || pal.none), legend: layout.zones.map((z) => ({ colour: of[z.id], label: z.name, sub: z.kind })) };
    }
    if (mode === 'churn') {
      const max = Math.max(1, ...buildings.map((b) => b.churn));
      const share = (c) => Math.log1p(c) / Math.log1p(max);
      const mid = Math.round(Math.sqrt(max));
      return {
        colours: buildings.map((b) => ramp(pal.churn, share(b.churn))),
        legend: [{ colour: ramp(pal.churn, 0), label: t('project_city.legend_no_commit') }, { colour: ramp(pal.churn, share(mid)), label: t('project_city.legend_commits', { count: mid }) }, { colour: ramp(pal.churn, 1), label: t('project_city.legend_commits', { count: max }) }],
      };
    }
    const names = quadrantNames();
    const of = Object.fromEntries(names.map((q, i) => [q, pal.quadrant[i % pal.quadrant.length]]));
    const label = (q) => architectureModel()?.quadrantLabel?.(q) ?? q;
    return {
      colours: buildings.map((b) => of[b.quadrant] || (b.test ? pal.campus : pal.none)),
      legend: [...names.map((q) => ({ colour: of[q], label: label(q) })), { colour: pal.none, label: t('project_city.legend_not_measured') }, { colour: pal.campus, label: t('project_city.legend_tests'), sub: t('project_city.legend_tests_sub') }],
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

  /** The overlay's layers merged in their order (later ones win): { highlight, markers }. */
  function mergeOverlays(layers) {
    const highlight = {};
    const markers = [];
    for (const l of layers) {
      Object.assign(highlight, l.highlight || {});
      markers.push(...(l.markers || []));
    }
    return { highlight, markers };
  }

  /** Where the camera flies for a file, a district or a zone (by id or name): { kind, id, x, y, z, distance } or null. */
  function flyTarget(layout, name) {
    const b = layout.buildings.find((x) => x.path === name);
    if (b) return { distance: clamp(Math.max(b.w, b.d, b.h) * 5, 30, 160), id: b.path, kind: 'building', x: b.x + b.w / 2, y: b.h / 2, z: b.z + b.d / 2 };
    const area = (kind, r) => ({ distance: clamp(Math.max(r.w, r.d) * 1.8, 30, 600), id: r.id, kind, x: r.x + r.w / 2, y: 0, z: r.z + r.d / 2 });
    const d = layout.districts.find((x) => x.id === name) || layout.districts.find((x) => x.name === name);
    if (d) return area('district', d);
    const z = layout.zones.find((x) => x.id === name) || layout.zones.find((x) => x.name === name);
    return z ? area('zone', z) : null;
  }

  /** #782: the labels of what is hovered, pinned or flown to ({ kind, id } each, or null), see the header. */
  function labelsShown(layout, { hover = null, pinned = null, fly = null } = {}) {
    const districts = new Set(), landmarks = new Set(), ports = new Set();
    for (const target of [hover, pinned, fly]) {
      if (target && target.kind === 'district') districts.add(target.id);
      const b = target && target.kind === 'building' ? arr(layout.buildings).find((x) => x.path === target.id) : null;
      if (!b) continue;
      districts.add(b.district);
      if (b.landmark) landmarks.add(b.path);
      for (const p of arr(layout.ports)) if (arr(p.via).includes(b.path)) ports.add(p.id);
    }
    return { districts: [...districts], landmarks: [...landmarks], ports: [...ports] };
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
    FILL,
    findTargets,
    flyTarget,
    GAP,
    gapOf,
    heightOf,
    isTest,
    labelsShown,
    layoutCity,
    LEDGES_MAX,
    ledgesOf,
    MAX_BUILDINGS,
    measuredShare,
    mergeOverlays,
    neighbours,
    perLineOf,
    SIDEWALK,
    SIDEWALK_AV,
    squarify,
    STREET,
    stripLayout,
    weightOf,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CityLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
