// The deterministic core of the project city (#371), from the proof of concept poc/embed-city.js
// (#370): a city plan and #356's facts (src/shared/architecture-model.js buildModel) in, { model,
// validation } out, with no file system, git, network, clock or randomness inside.
// - The plan (CITY_PLAN_SCHEMA, checked with validateSchema of src/domains/workspace/json-schema.js, #338): zones
//   (one of ZONE_KINDS each), districts with include/exclude globs (the app's glob rules,
//   src/shared/globs.js: no slash matches at any depth, a leading `/` anchors to the root), landmarks,
//   ports, evidence and `ignore` (files not drawn). A drawn file is a facts row the plan does not
//   ignore; the first district whose rules match it wins, the rest go to an "Outskirts" district.
// - Without a plan, districts come from folders: top-level folders are zones, their subfolders
//   districts, a subfolder under MIN_DISTRICT_FILES files folds into its parent, root files form
//   the ROOT zone.
// - Buildings: { path, district, lines, churn, complexity, worst, functions, lastChange };
//   complexity, worst and functions are null unless a real tool measured them ("not measured").
// - Edges from the sources the service reads at the facts' commit (src/domains/project/architecture-facts.js
//   readCity): `imports` ([{ from, text }], the lines of JavaScript/TypeScript files that name a
//   relative path) give file edges from relative require/import, `manifests` ({ path: Cargo.toml text }) give district edges from each
//   dependency on a sibling crate; for any other language `edges` is "not read for <language>",
//   and `edgesNotRead` lists "not read for <language>" for each code language left out of the graph.
// - The validation: coverage, the first UNMATCHED_SAMPLE unmatched files, empty and small
//   districts, unknown zones, duplicate ids, landmark and port paths missing at the commit, schema
//   errors. Keys sorted.
// - The project map workflow (#372): planVerdict (the validate step's ok / problems), refreshPlan
//   (a refresh keeps the ids and names the owner saw), planDiff (districts added / removed) and
//   refreshSignal (when the Architecture tab suggests "Refresh the map").
// Browser: window.CityModel; Node: module.exports.
(function (root) {
  const MIN_DISTRICT_FILES = 3;
  const UNMATCHED_SAMPLE = 30;
  // the project map (#372): a plan passes at this coverage; the tab suggests a refresh above this unmatched share
  const MIN_COVERAGE = 0.95;
  const REFRESH_SHARE = 0.05;
  const ZONE_KINDS = ['campus', 'civic', 'commercial', 'industrial', 'infrastructure', 'library', 'logistics', 'power', 'workshop'];
  const OUTSKIRTS = { id: 'outskirts', name: 'Outskirts', kind: 'outskirts', purpose: 'Drawn files no district rule matched.' };
  const ROOT = '(root)';
  const NOT_MEASURED = 'not measured';
  // folder zones without a plan: a kind by the folder's usual role, industrial otherwise
  const FOLDER_KINDS = {
    '.github': 'infrastructure', bin: 'workshop', doc: 'library', docs: 'library', scripts: 'workshop',
    spec: 'campus', test: 'campus', tests: 'campus', tools: 'workshop',
  };
  // what "not read for <language>" names: the first code language, not the prose or data files
  const NOT_CODE = ['CSS', 'HTML', 'JSON', 'Markdown', 'Other', 'SCSS', 'YAML'];
  const JS_LANGUAGES = ['JavaScript', 'TypeScript'];
  const JS_TARGETS = ['', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '/index.js', '/index.ts'];
  const IMPORT_RE = /(?:require\(\s*|import\(\s*|from\s+|import\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;

  const TEXT = { type: 'string', maxLength: 2000 };
  const ID = { type: 'string', minLength: 1, maxLength: 100 };
  const NAME = { type: 'string', minLength: 1, maxLength: 200 };
  const GLOB = { type: 'string', minLength: 1, maxLength: 300 };
  const PATH = { type: 'string', minLength: 1, maxLength: 500 };
  const list = (items) => ({ type: 'array', items });
  const CITY_PLAN_SCHEMA = {
    type: 'object',
    required: ['version', 'project', 'zones', 'districts'],
    properties: {
      version: { type: 'integer', minimum: 1 },
      project: NAME,
      summary: TEXT,
      ignore: list(GLOB),
      zones: list({ type: 'object', required: ['id', 'name', 'kind'], properties: { id: ID, name: NAME, kind: { type: 'string', enum: ZONE_KINDS }, purpose: TEXT } }),
      districts: list({ type: 'object', required: ['id', 'name', 'zone', 'include'], properties: { id: ID, name: NAME, zone: ID, purpose: TEXT, include: list(GLOB), exclude: list(GLOB) } }),
      landmarks: list({ type: 'object', required: ['path', 'label'], properties: { path: PATH, label: NAME } }),
      ports: list({ type: 'object', required: ['id', 'name', 'via'], properties: { id: ID, name: NAME, via: list(PATH) } }),
      evidence: list(PATH),
    },
  };

  const node = typeof module === 'object' && module.exports;
  // the facts' core (glob rule, sorted keys) and the schema validator; in the browser they load after this file
  const facts = () => (node ? require('./architecture-model') : root.ArchitectureModel);
  const schema = () => (node ? require('./json-schema') : root.JsonSchema || null);

  const arr = (x) => (Array.isArray(x) ? x : []);
  const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const uniqueSorted = (xs) => [...new Set(xs)].sort(byString);
  const matcher = (globs) => {
    const res = arr(globs).map(String).filter(Boolean).map((g) => facts().globRe(g));
    return (file) => res.some((re) => re.test(file));
  };

  // ---------- grouping ----------

  // { of: file -> district id, unmatched: [file] }: the first district whose rules match wins
  function applyPlan(plan, files) {
    const rules = arr(plan.districts).map((d) => ({ id: d.id, inc: matcher(d.include), exc: matcher(d.exclude) }));
    const of = {};
    const unmatched = [];
    for (const f of files) {
      const hit = rules.find((r) => r.inc(f) && !r.exc(f));
      if (hit) of[f] = hit.id;
      else unmatched.push(f);
    }
    return { of, unmatched };
  }

  const parentOf = (id) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : null);

  // A file's folder district: <top>/<sub> below two folders, <top> for its own files, ROOT at the root
  function districtOf(file) {
    const p = file.split('/');
    if (p.length > 2) return `${p[0]}/${p[1]}`;
    return p.length === 2 ? p[0] : ROOT;
  }

  // Every file's folder district; districts under MIN_DISTRICT_FILES fold into their parent
  function folderDistricts(files) {
    const of = {};
    for (const f of files) of[f] = districtOf(f);
    for (;;) {
      const count = {};
      for (const d of Object.values(of)) count[d] = (count[d] || 0) + 1;
      const small = new Set(Object.keys(count).filter((d) => count[d] < MIN_DISTRICT_FILES && parentOf(d)));
      if (!small.size) return of;
      for (const f of Object.keys(of)) if (small.has(of[f])) of[f] = parentOf(of[f]);
    }
  }

  const zoneOfFolder = (id) => (id === ROOT ? ROOT : id.split('/')[0]);

  function folderLayout(files) {
    const of = folderDistricts(files);
    const ids = uniqueSorted(Object.values(of));
    const zones = uniqueSorted(ids.map(zoneOfFolder)).map((id) => (id === ROOT
      ? { id, name: 'Root files', kind: 'civic', purpose: 'The files at the root of the repository.' }
      : { id, name: id, kind: FOLDER_KINDS[id] || 'industrial', purpose: `Files under ${id}/` }));
    const districts = ids.map((id) => ({ id, name: id === ROOT ? 'Root files' : id, zone: zoneOfFolder(id), purpose: id === ROOT ? 'The files at the root of the repository.' : `Files under ${id}/` }));
    return { of, unmatched: [], zones, districts };
  }

  function planLayout(plan, files) {
    const { of, unmatched } = applyPlan(plan, files);
    const zones = [];
    for (const z of arr(plan.zones)) {
      if (!zones.some((x) => x.id === z.id)) zones.push({ id: z.id, name: z.name, kind: z.kind, purpose: z.purpose || '' });
    }
    const known = new Set(zones.map((z) => z.id));
    const districts = [];
    for (const d of arr(plan.districts)) {
      // a district in an unknown zone is drawn in the outskirts (the validation names it)
      if (!districts.some((x) => x.id === d.id)) districts.push({ id: d.id, name: d.name, zone: known.has(d.zone) ? d.zone : OUTSKIRTS.id, purpose: d.purpose || '' });
    }
    for (const f of unmatched) of[f] = OUTSKIRTS.id;
    if (unmatched.length && !districts.some((d) => d.id === OUTSKIRTS.id)) districts.push({ id: OUTSKIRTS.id, name: OUTSKIRTS.name, zone: OUTSKIRTS.id, purpose: OUTSKIRTS.purpose });
    if (districts.some((d) => d.zone === OUTSKIRTS.id) && !known.has(OUTSKIRTS.id)) zones.push({ ...OUTSKIRTS });
    return { of, unmatched, zones, districts };
  }

  // ---------- edges ----------

  // File edges [{ from, to, kind: 'file' }] from relative require/import specifiers
  function jsEdges(imports, drawn) {
    const edges = new Map();
    for (const { from, spec } of arr(imports)) {
      if (!drawn.has(from)) continue;
      const base = normalize(`${from.slice(0, from.lastIndexOf('/') + 1)}${spec}`);
      const to = base && JS_TARGETS.map((ext) => `${base}${ext}`).find((c) => drawn.has(c));
      if (to && to !== from) edges.set(`${from}\n${to}`, { from, kind: 'file', to });
    }
    return [...edges.values()];
  }

  // a/./b/../c → a/c (null when it climbs above the root)
  function normalize(p) {
    const out = [];
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
    }
    return out.join('/');
  }

  // The relative specifiers of one source line or text: [spec]
  function importSpecs(text) {
    return [...String(text).matchAll(IMPORT_RE)].map((m) => m[2]);
  }

  // A TOML section's body ('' when absent)
  function section(text, header) {
    const re = new RegExp(`^\\[${header.replace(/[.[\]]/g, '\\$&')}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm');
    const m = re.exec(text);
    return m ? m[1] : '';
  }

  // District edges [{ from, to, crates, kind: 'district' }] from each Cargo.toml dependency on a sibling crate
  function rustEdges(manifests, of, campus, project) {
    const files = Object.keys(manifests).sort(byString);
    const dirname = (f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '');
    // crate name -> folder: [workspace.dependencies] path entries, then each crate's [package] name
    const dirOf = {};
    for (const line of section(manifests['Cargo.toml'] || '', 'workspace.dependencies').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^}]*path\s*=\s*"([^"]+)"/.exec(line);
      if (m) dirOf[m[1]] = normalize(m[2]);
    }
    for (const f of files) {
      const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(section(manifests[f], 'package'));
      if (name) dirOf[name[1]] = dirname(f);
    }
    const prefix = `${project}-`;
    const crateDir = (name) => {
      if (dirOf[name] != null) return dirOf[name];
      const short = name.startsWith(prefix) ? `crates/${name.slice(prefix.length)}` : null;
      return short && manifests[`${short}/Cargo.toml`] != null ? short : null;
    };
    // the districts (not on a campus) that own a crate's drawn files
    const owners = (dir) => new Set(Object.keys(of)
      .filter((f) => (dir === '' ? !f.includes('/') : f.startsWith(`${dir}/`)) && !campus.has(of[f]))
      .map((f) => of[f]));
    const edges = new Map();
    for (const f of files) {
      if (f === 'Cargo.toml') continue;
      const dir = dirname(f);
      const from = owners(dir);
      for (const m of manifests[f].matchAll(/^\[((?:target\.[^\]]*\.)?dependencies)\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm)) {
        for (const line of m[2].split(/\r?\n/)) {
          const e = /^\s*([A-Za-z0-9_-]+)(?:\.workspace)?\s*=\s*(.*)$/.exec(line);
          if (!e) continue;
          const inline = /path\s*=\s*"([^"]+)"/.exec(e[2]);
          const target = inline ? normalize(`${dir ? `${dir}/` : ''}${inline[1]}`) : crateDir(e[1]);
          if (target == null || target === dir) continue;
          for (const a of from) {
            for (const b of owners(target)) {
              if (a === b) continue;
              const key = `${a}\n${b}`;
              if (!edges.has(key)) edges.set(key, { crates: new Set(), from: a, kind: 'district', to: b });
              edges.get(key).crates.add(e[1]);
            }
          }
        }
      }
    }
    return [...edges.values()].map((e) => ({ ...e, crates: uniqueSorted(e.crates) }));
  }

  // The first code language of the buildings, by lines
  function mainLanguage(rows) {
    const lines = {};
    for (const r of rows) lines[r.language] = (lines[r.language] || 0) + r.lines;
    const ranked = Object.keys(lines).sort((a, b) => lines[b] - lines[a] || byString(a, b));
    return ranked.find((l) => !NOT_CODE.includes(l)) || ranked[0] || 'Other';
  }

  // [edge] for JavaScript/TypeScript and Rust, or "not read for <language>"
  function edgesOf(sources, rows, of, campus, project) {
    const hasJs = rows.some((r) => JS_LANGUAGES.includes(r.language));
    const manifests = (sources && sources.manifests) || {};
    const hasCargo = Object.keys(manifests).length > 0;
    if (!sources || (!hasJs && !hasCargo)) return `not read for ${mainLanguage(rows)}`;
    const drawn = new Set(Object.keys(of));
    const imports = arr(sources.imports).flatMap((i) => importSpecs(i.text).map((spec) => ({ from: i.from, spec })));
    return [...(hasJs ? jsEdges(imports, drawn) : []), ...(hasCargo ? rustEdges(manifests, of, campus, project) : [])]
      .sort((a, b) => byString(a.kind, b.kind) || byString(a.from, b.from) || byString(a.to, b.to));
  }

  // ["not read for <language>"]: the code languages of the buildings whose edges were not read,
  // so a graph of part of the city never looks complete
  function edgesNotRead(sources, rows) {
    const hasCargo = Object.keys((sources && sources.manifests) || {}).length > 0;
    const read = (l) => !!sources && (JS_LANGUAGES.includes(l) || (hasCargo && l === 'Rust'));
    return uniqueSorted(rows.map((r) => r.language).filter((l) => l && !NOT_CODE.includes(l) && !read(l)))
      .map((l) => `not read for ${l}`);
  }

  // ---------- validation ----------

  // plan: the drawn plan (lists of objects only), raw: the plan as given (its schema errors)
  function validate(plan, raw, { drawn, of, planError, unmatched, tracked }) {
    const out = {
      coverage: drawn.length ? (drawn.length - unmatched.length) / drawn.length : 1,
      drawn: drawn.length,
      duplicateIds: [],
      emptyDistricts: [],
      matched: drawn.length - unmatched.length,
      missingPaths: [],
      schemaErrors: [],
      smallDistricts: [],
      unknownZones: [],
      unmatched: [...unmatched].sort(byString).slice(0, UNMATCHED_SAMPLE),
    };
    const validator = schema();
    if (raw != null && validator) out.schemaErrors = validator.validateSchema(raw, CITY_PLAN_SCHEMA, 'plan');
    if (planError) out.schemaErrors = [String(planError), ...out.schemaErrors];
    if (!plan) return out;
    const ids = (xs) => arr(xs).map((x) => x && x.id);
    const seen = (xs) => xs.filter((id, i) => xs.indexOf(id) !== i);
    out.duplicateIds = uniqueSorted([...seen(ids(plan.zones)), ...seen(ids(plan.districts))]);
    const zones = new Set(ids(plan.zones));
    const count = {};
    for (const d of Object.values(of)) count[d] = (count[d] || 0) + 1;
    for (const d of arr(plan.districts)) {
      if (!zones.has(d.zone)) out.unknownZones.push({ district: d.id, zone: d.zone });
      const n = count[d.id] || 0;
      if (n === 0) out.emptyDistricts.push(d.id);
      else if (n < MIN_DISTRICT_FILES) out.smallDistricts.push(d.id);
    }
    out.emptyDistricts = uniqueSorted(out.emptyDistricts);
    out.smallDistricts = uniqueSorted(out.smallDistricts);
    const at = new Set(tracked);
    const paths = [...arr(plan.landmarks).map((l) => l && l.path), ...arr(plan.ports).flatMap((p) => arr(p && p.via))];
    out.missingPaths = uniqueSorted(paths.filter((p) => typeof p === 'string' && !at.has(p)));
    return out;
  }

  // ---------- the model ----------

  /**
   * The city of a repository at the facts' commit: { model, validation }.
   * input: { plan (CITY_PLAN_SCHEMA) | null, facts (architecture-model buildModel), tracked: [path]
   * (the files at the commit; default: the facts' files), sources: { imports: [{ from, text }],
   * manifests: { path: text } } | undefined (edges not read), planError: why the saved plan could
   * not be read (a schema error; the city falls back to folder districts) | undefined }
   */
  const isObject = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

  // A plan that fails its schema is still drawn: its lists keep only objects (schemaErrors name the rest)
  function drawablePlan(raw) {
    if (!isObject(raw)) return null;
    const objects = (xs) => arr(xs).filter(isObject);
    return { ...raw, districts: objects(raw.districts), landmarks: objects(raw.landmarks), ports: objects(raw.ports), zones: objects(raw.zones) };
  }

  // The facts' complexity: measured by a tool, or "not measured" with the reason
  function complexityOf(model) {
    const c = model && model.complexity;
    if (c && c.status === 'measured') return { status: 'measured', tool: c.tool || null };
    return { reason: (c ? c.reason : 'no facts') || null, status: NOT_MEASURED, tool: null };
  }

  function buildingOf(r, district, measured) {
    const tool = (x) => (measured && x != null ? x : null);
    return { churn: r.commits, complexity: tool(r.complexity), district, functions: tool(r.functions), lastChange: r.last_change || null, lines: r.lines, path: r.file, worst: tool(r.worst) };
  }

  function buildCity({ plan: raw = null, facts: model, tracked, sources, planError } = {}) {
    const plan = drawablePlan(raw);
    const ignored = plan ? matcher(plan.ignore) : () => false;
    const rows = arr(model && model.files).filter((r) => !ignored(r.file)).sort((a, b) => byString(a.file, b.file));
    const drawn = rows.map((r) => r.file);
    const layout = plan ? planLayout(plan, drawn) : folderLayout(drawn);
    const { of } = layout;
    const complexity = complexityOf(model);
    const buildings = rows.map((r) => buildingOf(r, of[r.file], complexity.status === 'measured'));
    const totals = {};
    for (const b of buildings) {
      const t = totals[b.district] || (totals[b.district] = { files: 0, lines: 0 });
      t.files++;
      t.lines += b.lines;
    }
    const districts = layout.districts.map((d) => ({ ...d, ...(totals[d.id] || { files: 0, lines: 0 }) }));
    const isDrawn = new Set(drawn);
    const zoneKind = Object.fromEntries(layout.zones.map((z) => [z.id, z.kind]));
    const campus = new Set(districts.filter((d) => zoneKind[d.zone] === 'campus').map((d) => d.id));
    const city = {
      commit: (model && model.head && model.head.commit) || null,
      complexity,
      districts,
      edges: edgesOf(sources, rows, of, campus, plan ? String(plan.project || '') : ''),
      edgesNotRead: edgesNotRead(sources, rows),
      grouping: plan ? 'plan' : 'folders',
      buildings,
      landmarks: plan ? plan.landmarks.filter((l) => isDrawn.has(l.path)).map((l) => ({ label: l.label, path: l.path })) : [],
      ports: plan ? plan.ports.map((p) => ({ id: p.id, name: p.name, via: arr(p.via).filter((v) => isDrawn.has(v)) })).filter((p) => p.via.length) : [],
      project: plan ? plan.project || null : null,
      summary: plan ? plan.summary || '' : '',
      zones: layout.zones,
    };
    const validation = validate(plan, raw, { drawn, of, planError, unmatched: layout.unmatched, tracked: tracked || arr(model && model.files).map((r) => r.file) });
    return facts().sortKeys({ model: city, validation });
  }

  // ---------- the project map workflow (#372) ----------

  const percent = (share) => `${Math.floor(share * 1000) / 10}%`;

  // The validate step's verdict on a validation: { ok, problems: [text] }; not ok on schema errors,
  // duplicate ids, districts in unknown zones, or coverage under MIN_COVERAGE (exactly 95% passes)
  function planVerdict(validation) {
    const v = validation || {};
    const problems = [
      ...arr(v.schemaErrors).map((e) => `schema: ${e}`),
      ...(arr(v.duplicateIds).length ? [`duplicate ids: ${arr(v.duplicateIds).join(', ')}`] : []),
      ...arr(v.unknownZones).map((u) => `district "${u.district}" is in an unknown zone "${u.zone}"`),
    ];
    const coverage = Number(v.coverage) || 0;
    if (coverage < MIN_COVERAGE) problems.push(`coverage ${percent(coverage)} (${v.matched || 0} of ${v.drawn || 0} drawn files) is under ${percent(MIN_COVERAGE)}`);
    return { ok: !problems.length, problems };
  }

  // A refresh (#372): the proposal's order and rules (include/exclude), the current plan's ids, names,
  // zones and purposes for what both have, the current zones and districts the proposal drops kept
  // (after the rest), the proposal's new ones added; the rest of the plan (summary, ignore,
  // landmarks, ports, evidence) is the proposal's
  function refreshPlan(current, proposed) {
    if (!isObject(current)) return proposed;
    const next = isObject(proposed) ? proposed : {};
    const merge = (was, now, rules) => {
      const old = new Map(arr(was).filter(isObject).map((x) => [x.id, x]));
      const out = arr(now).filter(isObject).map((x) => (old.has(x.id) ? { ...old.get(x.id), ...rules(x) } : x));
      return [...out, ...[...old.values()].filter((x) => !out.some((y) => y.id === x.id))];
    };
    return {
      ...next,
      version: current.version,
      project: current.project,
      zones: merge(current.zones, next.zones, () => ({})),
      districts: merge(current.districts, next.districts, (d) => ({ include: arr(d.include), exclude: arr(d.exclude) })),
    };
  }

  // The districts a plan adds and removes: { added: [id], removed: [id] }, sorted
  function planDiff(before, after) {
    const ids = (p) => new Set(arr(p && p.districts).filter(isObject).map((d) => d.id));
    const a = ids(before);
    const b = ids(after);
    return { added: uniqueSorted([...b].filter((id) => !a.has(id))), removed: uniqueSorted([...a].filter((id) => !b.has(id))) };
  }

  // Whether the Architecture tab suggests "Refresh the map" for a city (buildCity's result):
  // { suggested, unmatchedShare, newFolders }: more than REFRESH_SHARE of the drawn files match no
  // rule, or a top-level folder has drawn files and none matches a rule; never for a folder city
  function refreshSignal(city) {
    const model = city && city.model;
    if (!model || model.grouping !== 'plan') return { newFolders: [], suggested: false, unmatchedShare: 0 };
    const buildings = arr(model.buildings);
    const unmatched = buildings.filter((b) => b.district === OUTSKIRTS.id);
    const top = (b) => (b.path.includes('/') ? b.path.split('/')[0] : null);
    const matchedTops = new Set(buildings.filter((b) => b.district !== OUTSKIRTS.id).map(top));
    const newFolders = uniqueSorted(unmatched.map(top).filter((t) => t && !matchedTops.has(t)));
    const unmatchedShare = buildings.length ? unmatched.length / buildings.length : 0;
    return { newFolders, suggested: unmatchedShare > REFRESH_SHARE || newFolders.length > 0, unmatchedShare };
  }

  const api = {
    applyPlan,
    buildCity,
    CITY_PLAN_SCHEMA,
    districtOf,
    folderDistricts,
    importSpecs,
    MIN_COVERAGE,
    MIN_DISTRICT_FILES,
    OUTSKIRTS,
    planDiff,
    planVerdict,
    refreshPlan,
    REFRESH_SHARE,
    refreshSignal,
    ROOT,
    UNMATCHED_SAMPLE,
    ZONE_KINDS,
  };
  if (node) module.exports = api;
  else root.CityModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
