// A release on the project city (#376): the city as it was at the previous release, in grey, with
// what the release added, changed, renamed or removed in colour. No model call. Pure and
// deterministic: no I/O, clock or randomness (packages/engine/domains/releases/release-city.js reads git in the main process; the
// City view's release overlay, fronts/analyser/views/project/project-city-release.js, draws it).
// - parseNameStatus(text) → [{ status, path, from? }] sorted by path, from `git diff --name-status -M`:
//   A → added, M/T → changed, D → removed, R → renamed (from the old path), C → added (the copy).
// - ADDED_COLOUR, CHANGE_RAMP (light to strong), rampColour(lines, maxLines) → a ramp colour.
// - releaseRamp(changes) → { cuts, colourOf }: the ramp spread over the release's own changes (#438:
//   quantiles of the distinct line counts, a geometric split under four), its cut points for the legend.
// - releaseOverlay(changes) → { highlight, ghosts, renamed }: added green, changed and renamed on the
//   release's ramp (a rename on its base building, the old path), removed paths as ghosts, the renamed
//   buildings for their sign (RENAME_COLOUR's marker, #438); for ProjectCity.overlay.
// - issuesOf(message), filterByIssue(changes, commits, issue): one issue's footprint, through the
//   commits that name it (`#n`).
// - releaseModel(baseModel, changes, { plan }) → the base city plus a building per added file, in the
//   first plan district whose rules match (CityModel.applyPlan); the input is never mutated.
// - releaseHeader(layout, changes) → { counts, districts, zones }; captionText(...) → the image caption.
// Browser: window.CityRelease; Node: module.exports.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  // the plan's first-match rule (#371), resolved at call time: in the browser city-model.js may load later
  const cityModel = () => (node ? require('./city-model') : root.CityModel);
  // the header's district and zone counting rule (#375), shared with the impact overlay, at call time
  const cityImpact = () => (node ? require('./city-impact') : root.CityImpact);

  const ADDED_COLOUR = '#3fb68b';
  const CHANGE_RAMP = ['#f6d58e', '#f2a541', '#e8743b', '#d9480f'];
  const RENAME_COLOUR = '#7c9cff'; // the rename sign's marker (#438): no ramp shade, the app's accent
  const STATUSES = ['added', 'changed', 'removed', 'renamed'];
  const STATUS_OF = { A: 'added', C: 'added', D: 'removed', M: 'changed', R: 'renamed', T: 'changed' };

  const arr = (x) => (Array.isArray(x) ? x : []);
  const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const clean = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  // the building a change is drawn on: a rename on its old path, the one the base city has
  const drawnPath = (c) => (c.status === 'renamed' && c.from ? c.from : c.path);

  /** The changes of `git diff --name-status -M`, sorted by path. */
  function parseNameStatus(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const [code, a, b] = line.split('\t');
      const status = code && STATUS_OF[code[0]];
      if (!status || !a) continue;
      if (code[0] === 'R' && b) out.push({ status, from: clean(a), path: clean(b) });
      else if (code[0] === 'C' && b) out.push({ status, path: clean(b) });
      else out.push({ status, path: clean(a) });
    }
    return out.sort((x, y) => byString(x.path, y.path));
  }

  /** A change's colour on the ramp: one line the lightest, `maxLines` and more the strongest. */
  function rampColour(lines, maxLines) {
    const max = Number(maxLines) || 0;
    const n = Math.max(0, Number(lines) || 0);
    if (max <= 1 || n >= max) return CHANGE_RAMP[max > 0 && n >= max ? CHANGE_RAMP.length - 1 : 0];
    const share = (n - 1) / (max - 1);
    return CHANGE_RAMP[Math.min(CHANGE_RAMP.length - 1, Math.max(0, Math.floor(share * CHANGE_RAMP.length)))];
  }

  const isRamped = (c) => c.status === 'changed' || c.status === 'renamed';
  const linesOf = (c) => Math.max(0, Number(c.lines) || 0);

  /**
   * The release's ramp (#438), spread over its own changed and renamed files: with four distinct line
   * counts or more, each shade holds a quarter of them (quantiles); with fewer, the shades split
   * min..max on a log scale: the fewest lines the lightest, the most the strongest, and a shade no
   * whole line count fits in (close counts) gets a fractional, empty cut. The cuts never overlap.
   * → { cuts: [[from, to]] per shade, colourOf(lines) }.
   */
  function releaseRamp(changes) {
    const k = CHANGE_RAMP.length;
    const values = [...new Set(arr(changes).filter(isRamped).map(linesOf))].sort((a, b) => a - b);
    let cuts = [];
    if (values.length >= k) {
      const groups = CHANGE_RAMP.map(() => []);
      values.forEach((v, i) => groups[Math.floor((i * k) / values.length)].push(v));
      cuts = groups.map((g) => [g[0], g[g.length - 1]]);
    } else if (values.length) {
      const m = values.length;
      const lo = values[0];
      const hi = values[m - 1];
      const at = (v) => Math.log1p(v);
      // the shade each count takes: a middle count where it sits between the fewest and the most
      const shade = values.map((v, i) => (i === 0 ? 0 : i === m - 1 ? k - 1
        : Math.min(k - 2, Math.max(1, Math.round(((at(v) - at(lo)) / (at(hi) - at(lo))) * (k - 1))))));
      const from = [];
      values.forEach((v, i) => { from[shade[i]] = v; });
      // the shades between two counts (or above a single one) split the gap, whole numbers when it has room
      values.forEach((va, i) => {
        const a = shade[i];
        const b = i + 1 < m ? shade[i + 1] : k;
        const vb = i + 1 < m ? values[i + 1] : va + 1;
        const room = vb - va - 1 >= b - a - 1;
        for (let s = a + 1; s < b; s++) {
          const share = (s - a) / (b - a);
          from[s] = room
            ? Math.min(vb - (b - s), Math.max(from[s - 1] + 1, Math.round(Math.expm1(at(va) + share * (at(vb) - at(va))))))
            : va + share * (vb - va);
        }
      });
      cuts = from.map((f, s) => {
        if (!Number.isInteger(f)) return [f, f];
        if (s === k - 1) return [f, Math.max(f, hi)];
        const next = from[s + 1];
        return [f, Number.isInteger(next) ? next - 1 : Math.floor(next)];
      });
    }
    // the strongest shade whose cut starts at or under `lines`
    const colourOf = (lines) => {
      const n = Math.max(0, Number(lines) || 0);
      let s = 0;
      cuts.forEach(([from], i) => { if (from <= n) s = i; });
      return CHANGE_RAMP[s];
    };
    return { cuts, colourOf };
  }

  /** The city's layer of a release: highlight { path: colour }, the removed paths as ghosts, the renamed ones' buildings (their sign). */
  function releaseOverlay(changes) {
    const list = arr(changes);
    const ramp = releaseRamp(list);
    const highlight = {};
    const ghosts = [];
    const renamed = [];
    for (const c of list) {
      if (c.status === 'removed') ghosts.push(c.path);
      else if (c.status === 'added') highlight[c.path] = ADDED_COLOUR;
      else if (isRamped(c)) highlight[drawnPath(c)] = ramp.colourOf(c.lines);
      if (c.status === 'renamed') renamed.push(drawnPath(c));
    }
    return { highlight, ghosts: ghosts.sort(byString), renamed: renamed.sort(byString) };
  }

  // ---------- by issue ----------

  /** The sorted unique issue numbers a message names as `#n`. */
  function issuesOf(message) {
    const out = new Set();
    for (const m of String(message || '').matchAll(/(?:^|[^\w&])#(\d+)\b/g)) out.add(Number(m[1]));
    return [...out].sort((a, b) => a - b);
  }

  /** The changes of the commits naming `issue`; no issue → every change. */
  function filterByIssue(changes, commits, issue) {
    if (issue == null) return arr(changes).slice();
    const n = Number(issue);
    const files = new Set();
    for (const c of arr(commits)) if (arr(c.issues).map(Number).includes(n)) for (const f of arr(c.files)) files.add(clean(f));
    return arr(changes).filter((c) => files.has(c.path) || (c.from && files.has(c.from)));
  }

  // ---------- the city ----------

  // the zone of a district the base city lacks (a plan district with no file yet, the outskirts, a new folder), added to the model
  function zoneFor(model, id, pd, plan, CM) {
    const outskirts = id === CM.OUTSKIRTS.id;
    const zone = outskirts ? CM.OUTSKIRTS.id : pd ? pd.zone : id === CM.ROOT ? CM.ROOT : id.split('/')[0];
    if (model.zones.some((z) => z.id === zone)) return zone;
    const pz = arr(plan && plan.zones).find((z) => z.id === zone) || { name: zone, kind: 'industrial' };
    model.zones.push(outskirts ? { ...CM.OUTSKIRTS } : { id: zone, name: pz.name, kind: pz.kind, purpose: pz.purpose || '' });
    return zone;
  }

  // the model's district `id`, added when the base city has no file there
  function districtFor(model, id, plan, CM) {
    const found = model.districts.find((x) => x.id === id);
    if (found) return found;
    const pd = arr(plan && plan.districts).find((x) => x.id === id) || null;
    const name = pd ? pd.name : id === CM.OUTSKIRTS.id ? CM.OUTSKIRTS.name : id;
    const d = { files: 0, id, lines: 0, name, purpose: pd ? pd.purpose || '' : '', zone: zoneFor(model, id, pd, plan, CM) };
    model.districts.push(d);
    return d;
  }

  /** The base city plus one building per added file it lacks; the base model is not mutated. */
  function releaseModel(baseModel, changes, { plan = null } = {}) {
    const model = JSON.parse(JSON.stringify(baseModel || {}));
    model.buildings = arr(model.buildings);
    model.districts = arr(model.districts);
    model.zones = arr(model.zones);
    const known = new Set(model.buildings.map((b) => b.path));
    const added = arr(changes).filter((c) => c.status === 'added' && !known.has(c.path));
    if (!added.length) return model;
    const CM = cityModel();
    const paths = added.map((c) => c.path);
    const rules = plan && arr(plan.districts).length ? plan : null;
    const of = rules ? CM.applyPlan(rules, paths).of : Object.fromEntries(paths.map((p) => [p, CM.districtOf(p)]));
    for (const c of added) {
      const id = of[c.path] || CM.OUTSKIRTS.id;
      const d = districtFor(model, id, rules, CM);
      const lines = Number(c.lines) || 0;
      d.files = (d.files || 0) + 1;
      d.lines = (d.lines || 0) + lines;
      model.buildings.push({ churn: 1, complexity: null, district: id, functions: null, lastChange: null, lines, path: c.path, worst: null });
    }
    model.buildings.sort((a, b) => byString(a.path, b.path));
    return model;
  }

  /** The changes counted by status, and by district and zone over the buildings the layout draws (CityImpact's rule). */
  function releaseHeader(layout, changes) {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const c of arr(changes)) if (c.status in counts) counts[c.status]++;
    const { districts, zones } = cityImpact().countByDistrict(layout, arr(changes).map(drawnPath));
    return { counts, districts, zones };
  }

  /** The non-zero counts as '<n> added', in status order. */
  const countsText = (counts) => STATUSES.filter((s) => (counts || {})[s] > 0).map((s) => `${counts[s]} ${s}`);

  /** The saved image's caption: one line with the project, both tags and the non-zero counts. */
  function captionText({ project = '', from = '', to = '', counts = {}, issue = null } = {}) {
    const parts = countsText(counts);
    const head = [project, `${from || '?'} → ${to || '?'}`, issue != null ? `#${issue}` : ''].filter(Boolean).join(' · ');
    return `${head}: ${parts.length ? parts.join(', ') : 'no change'}`.replace(/\s+/g, ' ');
  }

  const api = {
    ADDED_COLOUR,
    captionText,
    CHANGE_RAMP,
    countsText,
    filterByIssue,
    issuesOf,
    parseNameStatus,
    rampColour,
    releaseHeader,
    releaseModel,
    releaseOverlay,
    releaseRamp,
    RENAME_COLOUR,
  };
  if (node) module.exports = api;
  else root.CityRelease = api;
})(typeof window !== 'undefined' ? window : globalThis);
