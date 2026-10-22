// An issue's impact preview on the project city (#375): where an issue would change the code, from
// what is already written down (no model call: the Product Owner's saved answers are read, never
// asked again). Pure and deterministic: no I/O, clock or randomness. The City view's impact overlay
// (src/renderer/views/project/project-city-impact.js) draws it on #373's layout.
// - citedPaths(body) → the sorted repository-relative paths an issue body cites, in backticks or in
//   plain text (`path:line[:col]` and `path:line-line[:col]`, hyphen or en dash, give the path (#427),
//   trailing punctuation dropped); globs, URLs, issue refs and folders are not paths; a root file name
//   counts only in backticks (`README.md`).
// - expectedSection(body) → the sorted paths of the body's `## Expected files` section (#429: one path
//   per line, "- `src/x.js`: why", `(new)` for a file to create), or null when it has none.
// - expectedFiles({ body, poFiles, changed, files, plan }) → { files: [{ path, sources }], newFiles:
//   [{ path, sources, district, note }] }: sources from ['changed', 'cited', 'expected', 'po']; a root
//   file name from the body counts only when the repository (`files`) has it (#427); a path the
//   repository lacks is a new file, expected in the first plan district whose rules match
//   (CityModel.applyPlan, #371's glob rules).
// - SOURCE_COLOURS, overlayOf(preview) → { highlight }: each expected building in the colour of its
//   strongest source (changed > expected > po > cited), for ProjectCity.overlay.
// - countByDistrict(layout, paths) → { total, districts, zones }: the paths that are buildings of the
//   layout counted by district and zone (also the release header's counts, src/shared/city-release.js).
// - impactHeader(layout, paths, { quadrants }) → { total, districts, zones, dangerShare }: the counts
//   over the buildings of the layout and the share of them in the Danger Zone.
// - stageFootprint(items [{ id, files }]) → { colours, highlight, conflicts }: each item its colour, a
//   building two items would change in CONFLICT_COLOUR (#150: the items of one stage share no files),
//   both from src/shared/city-agents.js (collisions, COLLISION_COLOUR), as the agents' collisions (#374).
// - predictedVsActual(predicted, changed) → { hit, missed, unexpected, hitRate }, and bySource
//   ({ [source]: { hit, missed } }) when predicted holds { path, sources } items.
// - recordHitRate(history, issue, { hitRate, ts, run, withSection }) → a new history, one entry per
//   run, ts order; withSection (the issue had the Expected files section) kept when a boolean.
// - hitRateBySection(history) → { with, without: { average, issues } }: each issue by its latest entry.
// Browser: window.CityImpact; Node: module.exports.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  // the plan's first-match rule (#371), resolved at call time: in the browser city-model.js loads after this file
  const cityModel = () => (node ? require('./city-model') : root.CityModel);
  // #150's rule "a path two sets or more change" and its red, the ones the agents on the city draw (#374), at call time
  const cityAgents = () => (node ? require('./city-agents') : root.CityAgents);
  const conflictColour = () => cityAgents().COLLISION_COLOUR;

  const SOURCES = ['changed', 'cited', 'expected', 'po'];
  // the strongest source first: what a run really changed, then the issue's Expected files section, the Product Owner's group, the body
  const STRENGTH = ['changed', 'expected', 'po', 'cited'];
  const SOURCE_COLOURS = { cited: '#4c9be8', po: '#9b6ef3', changed: '#3fb68b', expected: '#2ec4b6' };
  const ITEM_COLOURS = ['#4c9be8', '#3fb68b', '#f2a541', '#9b6ef3', '#2ec4b6', '#c3d350', '#5c7cfa', '#a1887f'];
  const DANGER = 'Danger Zone';

  const arr = (x) => (Array.isArray(x) ? x : []);
  const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const uniqueSorted = (xs) => [...new Set(xs)].sort(byString);
  const clean = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');

  // ---------- the paths an issue body cites ----------

  // a markdown link keeps its text: [src/a.js](https://…/src/a.js) cites src/a.js
  const LINK_RE = /\[([^\]\n]+)\]\([^)\s]*\)?/g;
  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s`]+/gi;
  const GLOB_RE = /[*?{}[\]]/;
  const NAME = '[\\w.@+-]+';
  const PATH_RE = new RegExp(`^${NAME}(?:/${NAME})+$`);
  const ROOT_FILE_RE = new RegExp(`^${NAME}$`);
  const EXT_RE = /[^./]\.[A-Za-z][A-Za-z0-9]*$/;

  // a token as a path, or null: `file:line:col`, `file:line-line[:col]` and the punctuation around it dropped
  function pathOf(token, quoted) {
    let t = token.replace(/^[("'<[]+/, '');
    if (GLOB_RE.test(t.replace(/[)\]]+[.,;:]*$/, ''))) return null;
    t = t.replace(/#L?\d+(?:-L?\d+)?$/, '');
    for (let prev = ''; prev !== t;) {
      prev = t;
      t = t.replace(/[.,;:)'">]+$/, '').replace(/:\d+(?:[-–]\d+)?(?::\d+)?$/, '');
    }
    t = clean(t);
    if (!t || !EXT_RE.test(t)) return null;
    if (PATH_RE.test(t)) return t;
    return quoted && ROOT_FILE_RE.test(t) ? t : null;
  }

  /** The repository-relative paths an issue body cites, sorted and unique. */
  function citedPaths(body) {
    if (typeof body !== 'string' || !body) return [];
    const text = body.replace(LINK_RE, ' $1 ').replace(URL_RE, ' ');
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

  // the `## Expected files` heading (#429) and the next heading of its level or above, which ends the section
  const SECTION_RE = /^##[ \t]+Expected files[ \t]*$/im;
  const NEXT_HEADING_RE = /^#{1,2}[ \t]/m;

  /** The paths of the body's `## Expected files` section, sorted and unique; null when the body has no such section. */
  function expectedSection(body) {
    if (typeof body !== 'string' || !body) return null;
    const m = SECTION_RE.exec(body);
    if (!m) return null;
    const rest = body.slice(m.index + m[0].length);
    const end = rest.search(NEXT_HEADING_RE);
    return citedPaths(end < 0 ? rest : rest.slice(0, end));
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
    const repo = new Set(arr(files).map(clean));
    // a root file name from the body counts only when the repository has it (#427): an id or a log name is not a file to change
    const inBody = (paths) => arr(paths).filter((p) => p.includes('/') || repo.has(p));
    add(inBody(citedPaths(body)), 'cited');
    add(inBody(expectedSection(body)), 'expected');
    add(poFiles, 'po');
    add(changed, 'changed');
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

  /** Each path that is a building of the layout counted by district and zone (once per path given), by count desc then id. */
  function countByDistrict(layout, paths) {
    const buildings = new Map(arr(layout && layout.buildings).map((b) => [b.path, b]));
    const districtNames = new Map(arr(layout && layout.districts).map((d) => [d.id, d.name]));
    const districtZone = new Map(arr(layout && layout.districts).map((d) => [d.id, d.zone]));
    const zoneNames = new Map(arr(layout && layout.zones).map((z) => [z.id, z.name]));
    const districts = new Map();
    const zones = new Map();
    let total = 0;
    for (const p of arr(paths).map(clean)) {
      const b = buildings.get(p);
      if (!b) continue;
      total++;
      const zone = b.zone || districtZone.get(b.district);
      districts.set(b.district, (districts.get(b.district) || 0) + 1);
      if (zone) zones.set(zone, (zones.get(zone) || 0) + 1);
    }
    return { total, districts: counted(districts, districtNames), zones: counted(zones, zoneNames) };
  }

  /** The expected buildings counted by district and zone, and the share of them in the Danger Zone. */
  function impactHeader(layout, paths, { quadrants = {} } = {}) {
    const unique = uniqueSorted(arr(paths).map(clean));
    const { total, districts, zones } = countByDistrict(layout, unique);
    const drawn = new Set(arr(layout && layout.buildings).map((b) => b.path));
    const danger = unique.filter((p) => drawn.has(p) && (quadrants || {})[p] === DANGER).length;
    return { total, districts, zones, dangerShare: total ? danger / total : 0 };
  }

  // ---------- a stage's footprint ----------

  /** Each item of a stage in its own colour; a building two items or more would change is a conflict, in red. */
  function stageFootprint(items) {
    const colours = {};
    const sets = arr(items).map((item, i) => {
      colours[item.id] = ITEM_COLOURS[i % ITEM_COLOURS.length];
      return { id: item.id, changed: arr(item.files).map(clean).filter(Boolean) };
    });
    const conflicts = cityAgents().collisions(sets).map((c) => ({ path: c.path, items: uniqueSorted(c.runs.map(String)) }));
    const shared = new Set(conflicts.map((c) => c.path));
    const highlight = {};
    for (const s of sets) {
      for (const p of s.changed) highlight[p] = shared.has(p) ? conflictColour() : colours[s.id];
    }
    return { colours, highlight, conflicts };
  }

  // ---------- predicted vs actual ----------

  /**
   * Changed as predicted, predicted but untouched, changed but not predicted, and the share of the predicted files hit;
   * predicted items given as { path, sources } add bySource: which source predicted each hit and miss (#429).
   */
  function predictedVsActual(predicted, changed) {
    const items = arr(predicted);
    const want = uniqueSorted(items.map((x) => clean(x && typeof x === 'object' ? x.path : x)).filter(Boolean));
    const got = uniqueSorted(arr(changed).map(clean).filter(Boolean));
    const isChanged = new Set(got);
    const isPredicted = new Set(want);
    const hit = want.filter((p) => isChanged.has(p));
    const out = {
      hit,
      missed: want.filter((p) => !isChanged.has(p)),
      unexpected: got.filter((p) => !isPredicted.has(p)),
      hitRate: want.length ? hit.length / want.length : null,
    };
    if (!items.some((x) => x && typeof x === 'object')) return out;
    const bySource = {};
    for (const x of items) {
      const p = clean(x && typeof x === 'object' ? x.path : x);
      if (!p) continue;
      for (const s of arr(x && x.sources)) {
        if (!bySource[s]) bySource[s] = { hit: [], missed: [] };
        bySource[s][isChanged.has(p) ? 'hit' : 'missed'].push(p);
      }
    }
    for (const s of Object.keys(bySource)) bySource[s] = { hit: uniqueSorted(bySource[s].hit), missed: uniqueSorted(bySource[s].missed) };
    return { ...out, bySource };
  }

  /** A new history with the issue's hit rate of `run` (the same run again replaces its entry), in ts order; withSection kept when given. */
  function recordHitRate(history, issue, { hitRate, ts, run, withSection }) {
    const key = String(issue);
    const list = arr(history && history[key]).filter((e) => e.run !== run).map((e) => ({ ...e }));
    list.push(typeof withSection === 'boolean' ? { hitRate, ts, run, withSection } : { hitRate, ts, run });
    list.sort((a, b) => byString(String(a.ts), String(b.ts)));
    return { ...(history || {}), [key]: list };
  }

  /** The average hit rate of the issues with an Expected files section and of those without, each issue by its latest entry. */
  function hitRateBySection(history) {
    const rates = { with: [], without: [] };
    for (const entries of Object.values(history || {})) {
      const rated = arr(entries).filter((e) => e && typeof e.hitRate === 'number');
      if (!rated.length) continue;
      const latest = rated.reduce((a, b) => (byString(String(b.ts), String(a.ts)) >= 0 ? b : a));
      rates[latest.withSection === true ? 'with' : 'without'].push(latest.hitRate);
    }
    const summary = (xs) => ({ average: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, issues: xs.length });
    return { with: summary(rates.with), without: summary(rates.without) };
  }

  const api = {
    citedPaths,
    // CityAgents.COLLISION_COLOUR, read when asked: in the browser city-agents.js may load later
    get CONFLICT_COLOUR() { return conflictColour(); },
    countByDistrict,
    expectedFiles,
    expectedSection,
    hitRateBySection,
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
