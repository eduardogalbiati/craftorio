// An issue's impact preview on the project city (#375): where an issue would change the code, from
// what is already written down (no model call: the Product Owner's saved answers are read, never
// asked again). Pure and deterministic: no I/O, clock or randomness. The City view's impact overlay
// (src/renderer/views/project/project-city-impact.js) draws it on #373's layout.
// - citedPaths(body) → the sorted repository-relative paths an issue body cites, in backticks or in
//   plain text (`path:line[:col]` gives the path, trailing punctuation dropped); globs, URLs, issue
//   refs and folders are not paths; a root file name counts only in backticks (`README.md`).
// - expectedFiles({ body, poFiles, changed, files, plan }) → { files: [{ path, sources }], newFiles:
//   [{ path, sources, district, note }] }: sources from ['changed', 'cited', 'po']; a path the
//   repository (`files`) lacks is a new file, expected in the first plan district whose rules match
//   (CityModel.applyPlan, #371's glob rules).
// - SOURCE_COLOURS, overlayOf(preview) → { highlight }: each expected building in the colour of its
//   strongest source (changed > po > cited), for ProjectCity.overlay.
// - impactHeader(layout, paths, { quadrants }) → { total, districts, zones, dangerShare }: the counts
//   over the buildings of the layout and the share of them in the Danger Zone.
// - stageFootprint(items [{ id, files }]) → { colours, highlight, conflicts }: each item its colour, a
//   building two items would change in CONFLICT_COLOUR (#150: the items of one stage share no files).
// - predictedVsActual(predicted, changed) → { hit, missed, unexpected, hitRate }.
// - recordHitRate(history, issue, { hitRate, ts, run }) → a new history, one entry per run, ts order.
// Browser: window.CityImpact; Node: module.exports.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  // the plan's first-match rule (#371), resolved at call time: in the browser city-model.js loads after this file
  const cityModel = () => (node ? require('./city-model') : root.CityModel);

  const SOURCES = ['changed', 'cited', 'po'];
  // the strongest source first: what a run really changed, then the Product Owner's group, then the body
  const STRENGTH = ['changed', 'po', 'cited'];
  const SOURCE_COLOURS = { cited: '#4c9be8', po: '#9b6ef3', changed: '#3fb68b' };
  // the collision red of the agents on the city (#374)
  const CONFLICT_COLOUR = '#d7263d';
  const ITEM_COLOURS = ['#4c9be8', '#3fb68b', '#f2a541', '#9b6ef3', '#2ec4b6', '#c3d350', '#5c7cfa', '#a1887f'];
  const DANGER = 'Danger Zone';

  const arr = (x) => (Array.isArray(x) ? x : []);
  const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const uniqueSorted = (xs) => [...new Set(xs)].sort(byString);
  const clean = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');

  // ---------- the paths an issue body cites ----------

  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s`]+/gi;
  const GLOB_RE = /[*?{}[\]]/;
  const NAME = '[\\w.@+-]+';
  const PATH_RE = new RegExp(`^${NAME}(?:/${NAME})+$`);
  const ROOT_FILE_RE = new RegExp(`^${NAME}$`);
  const EXT_RE = /[^./]\.[A-Za-z][A-Za-z0-9]*$/;

  // a token as a path, or null: `file:line:col` and the punctuation around it dropped
  function pathOf(token, quoted) {
    let t = token.replace(/^[("'<[]+/, '');
    if (GLOB_RE.test(t.replace(/[)\]]+[.,;:]*$/, ''))) return null;
    t = t.replace(/#L?\d+(?:-L?\d+)?$/, '');
    for (let prev = ''; prev !== t;) {
      prev = t;
      t = t.replace(/[.,;:)'">]+$/, '').replace(/:\d+(?::\d+)?$/, '');
    }
    t = clean(t);
    if (!t || !EXT_RE.test(t)) return null;
    if (PATH_RE.test(t)) return t;
    return quoted && ROOT_FILE_RE.test(t) ? t : null;
  }

  /** The repository-relative paths an issue body cites, sorted and unique. */
  function citedPaths(body) {
    if (typeof body !== 'string' || !body) return [];
    const text = body.replace(URL_RE, ' ');
    const out = [];
    const take = (s, quoted) => {
      for (const token of s.split(/\s+/)) {
        const p = token && pathOf(token, quoted);
        if (p) out.push(p);
      }
    };
    const prose = text.replace(/`([^`\n]+)`/g, (_, code) => { take(code, true); return ' '; });
    take(prose, false);
    return uniqueSorted(out);
  }

  // ---------- the expected files ----------

  /** The issue's expected files, each with its sources; the ones the repository lacks apart, with their district. */
  function expectedFiles({ body = null, poFiles = [], changed = [], files = [], plan = null } = {}) {
    const sources = new Map();
    const add = (paths, source) => {
      for (const raw of arr(paths)) {
        const p = clean(raw);
        if (!p) continue;
        if (!sources.has(p)) sources.set(p, new Set());
        sources.get(p).add(source);
      }
    };
    add(citedPaths(body), 'cited');
    add(poFiles, 'po');
    add(changed, 'changed');
    const repo = new Set(arr(files).map(clean));
    const paths = [...sources.keys()].sort(byString);
    const missing = paths.filter((p) => !repo.has(p));
    const districts = plan && arr(plan.districts).length ? arr(plan.districts) : [];
    const of = districts.length && missing.length ? cityModel().applyPlan(plan, missing).of : {};
    const listed = (p) => SOURCES.filter((s) => sources.get(p).has(s));
    return {
      files: paths.filter((p) => repo.has(p)).map((p) => ({ path: p, sources: listed(p) })),
      newFiles: missing.map((p) => {
        const d = districts.find((x) => x.id === of[p]) || null;
        return { path: p, sources: listed(p), district: d ? d.id : null, note: d ? `new file, expected in ${d.name || d.id}` : 'new file' };
      }),
    };
  }

  /** The city's layer of a preview: each expected building in its strongest source's colour; new files are not drawn. */
  function overlayOf(preview) {
    const highlight = {};
    for (const f of arr(preview && preview.files)) {
      const strongest = STRENGTH.find((s) => arr(f.sources).includes(s));
      if (strongest) highlight[f.path] = SOURCE_COLOURS[strongest];
    }
    return { highlight };
  }

  // ---------- the header ----------

  const counted = (counts, names) => [...counts.entries()]
    .map(([id, count]) => ({ id, name: names.get(id) || id, count }))
    .sort((a, b) => b.count - a.count || byString(a.id, b.id));

  /** The expected buildings counted by district and zone, and the share of them in the Danger Zone. */
  function impactHeader(layout, paths, { quadrants = {} } = {}) {
    const buildings = new Map(arr(layout && layout.buildings).map((b) => [b.path, b]));
    const districtNames = new Map(arr(layout && layout.districts).map((d) => [d.id, d.name]));
    const districtZone = new Map(arr(layout && layout.districts).map((d) => [d.id, d.zone]));
    const zoneNames = new Map(arr(layout && layout.zones).map((z) => [z.id, z.name]));
    const districts = new Map();
    const zones = new Map();
    let total = 0;
    let danger = 0;
    for (const p of uniqueSorted(arr(paths).map(clean))) {
      const b = buildings.get(p);
      if (!b) continue;
      total++;
      const zone = b.zone || districtZone.get(b.district);
      districts.set(b.district, (districts.get(b.district) || 0) + 1);
      if (zone) zones.set(zone, (zones.get(zone) || 0) + 1);
      if ((quadrants || {})[p] === DANGER) danger++;
    }
    return { total, districts: counted(districts, districtNames), zones: counted(zones, zoneNames), dangerShare: total ? danger / total : 0 };
  }

  // ---------- a stage's footprint ----------

  /** Each item of a stage in its own colour; a building two items or more would change is a conflict, in red. */
  function stageFootprint(items) {
    const colours = {};
    const owners = new Map();
    arr(items).forEach((item, i) => {
      colours[item.id] = ITEM_COLOURS[i % ITEM_COLOURS.length];
      for (const p of new Set(arr(item.files).map(clean).filter(Boolean))) {
        if (!owners.has(p)) owners.set(p, []);
        owners.get(p).push(item.id);
      }
    });
    const highlight = {};
    const conflicts = [];
    for (const p of [...owners.keys()].sort(byString)) {
      const ids = owners.get(p);
      highlight[p] = ids.length > 1 ? CONFLICT_COLOUR : colours[ids[0]];
      if (ids.length > 1) conflicts.push({ path: p, items: uniqueSorted(ids.map(String)) });
    }
    return { colours, highlight, conflicts };
  }

  // ---------- predicted vs actual ----------

  /** Changed as predicted, predicted but untouched, changed but not predicted, and the share of the predicted files hit. */
  function predictedVsActual(predicted, changed) {
    const want = uniqueSorted(arr(predicted).map(clean).filter(Boolean));
    const got = uniqueSorted(arr(changed).map(clean).filter(Boolean));
    const isChanged = new Set(got);
    const isPredicted = new Set(want);
    const hit = want.filter((p) => isChanged.has(p));
    return {
      hit,
      missed: want.filter((p) => !isChanged.has(p)),
      unexpected: got.filter((p) => !isPredicted.has(p)),
      hitRate: want.length ? hit.length / want.length : null,
    };
  }

  /** A new history with the issue's hit rate of `run` (the same run again replaces its entry), in ts order. */
  function recordHitRate(history, issue, { hitRate, ts, run }) {
    const key = String(issue);
    const list = arr(history && history[key]).filter((e) => e.run !== run).map((e) => ({ ...e }));
    list.push({ hitRate, ts, run });
    list.sort((a, b) => byString(String(a.ts), String(b.ts)));
    return { ...(history || {}), [key]: list };
  }

  const api = {
    citedPaths,
    CONFLICT_COLOUR,
    expectedFiles,
    impactHeader,
    overlayOf,
    predictedVsActual,
    recordHitRate,
    SOURCE_COLOURS,
    stageFootprint,
  };
  if (node) module.exports = api;
  else root.CityImpact = api;
})(typeof window !== 'undefined' ? window : globalThis);
