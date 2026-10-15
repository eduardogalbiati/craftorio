#!/usr/bin/env node
// Builds the city model of a repository and embeds it into a copy of poc/project-city.html (the 3D
// "city" proof of concept): one building per drawn file, grouped into districts inside zones.
// Read-only on the repository; rewrites the page's <script id="city-data"> block.
//
//   node poc/embed-city.js [--repo <dir>] [--plan <city-plan.json>] [--out <page>] [--force]
//
// With --plan (the format of poc/project-map/SKILL.md) the drawn files are every tracked file
// minus the plan's `ignore` globs, and each file goes to the first district whose `include`
// matches (minus its `exclude`); the zones come from the plan, in its order. A validator prints
// the coverage (matched / drawn), the first unmatched files, small districts, unknown zones,
// duplicate ids and landmark or port paths that are not tracked; coverage under COVERAGE_MIN
// exits 1 unless --force. Unmatched files are still drawn, in an "Outskirts" zone.
// Without --plan the drawn files are src/, scripts/, native/ and test/, grouped by folders
// (`districtOf`, with districts under MIN_DISTRICT_FILES files folded into their parent) into
// one zone per root, so the two groupings can be compared.
// The page template is poc/project-city.html; --out writes the filled copy elsewhere.
// Needs acorn for scripts/code-health.js: run from a checkout with node_modules, or set NODE_PATH.
//
// The model (plain JSON, see `buildModel`):
// - meta: project, summary, head, when the model was built, the grouping and the plan's coverage;
// - zones: { id, name, kind, purpose } in layout order; districts: { id, name, zone, purpose,
//   files, loc, dangerZone }; buildings: one per file: { path, district, zone, lang, loc,
//   complexity, worst, functions, churn, quadrant, score, lastChange };
// - landmarks { path, label } and ports { id, name, via } from the plan (existing paths only);
// - deps.files: [from, to] pairs of building indexes from relative require/import calls (JS);
//   deps.districts: { from, to, crates } from each Cargo.toml's [dependencies] that name a
//   sibling crate (workspace `path` entries, or `<project>-<name>` -> crates/<name>), mapped to
//   the non-campus districts that own the crates' files.
// `loc` counts non-blank lines. complexity, worst, functions, quadrant and score come from
// `scripts/code-health.js --hotspots --json` (this repository's script, run with --root) and
// exist only for the JS files it measures (src/ and scripts/); everything else is "not measured"
// (null) and the page says so. churn is that script's count where it has one (renames followed,
// mass moves skipped); for the other files it is counted here from `git log --name-only` with
// the same rules, except renames.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOTS = ['src', 'scripts', 'native', 'test'];
const MIN_DISTRICT_FILES = 3;
const COVERAGE_MIN = 95;
const UNMATCHED_SAMPLE = 30;
const TEMPLATE = path.join(__dirname, 'project-city.html');
const OPEN = '<script id="city-data" type="application/json">', CLOSE = '</script>';
const LANGS = { js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', css: 'css', yaml: 'yaml', yml: 'yaml', json: 'json', rs: 'rust', toml: 'toml', md: 'md', html: 'html', ndjson: 'json', lock: 'toml', cmd: 'cmd', sh: 'sh', wgsl: 'wgsl', feature: 'gherkin', tsv: 'tsv', txt: 'text' };
const FOLDER_ZONES = {
  src: { id: 'src', name: 'Source', kind: 'industrial', purpose: 'The app: engine, product logic, service and renderer.' },
  scripts: { id: 'scripts', name: 'Scripts', kind: 'workshop', purpose: 'Build, docs, screenshot and check scripts.' },
  native: { id: 'native', name: 'Native', kind: 'power', purpose: 'The Rust sidecars.' },
  test: { id: 'test', name: 'Tests', kind: 'campus', purpose: 'Unit, service, slow and contract tests.' },
};
const OUTSKIRTS = { id: 'outskirts', name: 'Outskirts', kind: 'outskirts', purpose: 'Drawn files no district rule matched.' };

function args() {
  const a = process.argv.slice(2), opt = { repo: path.join(__dirname, '..'), out: TEMPLATE, plan: null, force: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--repo' && a[i + 1]) opt.repo = path.resolve(a[++i]);
    else if (a[i] === '--out' && a[i + 1]) opt.out = path.resolve(a[++i]);
    else if (a[i] === '--plan' && a[i + 1]) opt.plan = path.resolve(a[++i]);
    else if (a[i] === '--force') opt.force = true;
    else { console.error('usage: node poc/embed-city.js [--repo <dir>] [--plan <city-plan.json>] [--out <page>] [--force]'); process.exit(1); }
  }
  return opt;
}

const git = (repo, argv) => execFileSync('git', ['-c', 'core.quotepath=off', ...argv], { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// ---------- globs ----------
/** A glob as a RegExp over repository paths: `**` crosses folders, `*` and `?` stay in a segment, no slash means a root file. */
// Same rules as the app's src/shared/globs.js: a pattern without a slash matches the file name at
// any depth (as in .gitignore); a leading `/` anchors it to the root (`/*` = the root files).
function globToRegExp(glob) {
  let g = String(glob).trim();
  const anywhere = !g.includes('/');
  if (g.startsWith('/')) g = g.slice(1);
  const segments = g.split('/');
  let re = anywhere ? '^(?:[^/]+/)*' : '^';
  segments.forEach((seg, i) => {
    const last = i === segments.length - 1;
    if (seg === '**') { re += last ? '(?:[^/]+/)*[^/]+' : '(?:[^/]+/)*'; return; }
    re += seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    if (!last) re += '/';
  });
  return new RegExp(`${re}$`);
}
function matcher(globs) {
  const res = (globs || []).map(globToRegExp);
  return (file) => res.some((re) => re.test(file));
}

// ---------- folder grouping (no plan) ----------
/** The district a file belongs to, by its folders (one function: a plan replaces it). */
function districtOf(file) {
  const p = file.split('/');
  if (p[0] !== 'src') return p.length > 2 ? `${p[0]}/${p[1]}` : p[0]; // scripts/screenshot, native/<crate>, test/<area>
  if (p[1] === 'renderer') {
    if (p[2] === 'views' && p.length > 4) return `src/renderer/views/${p[3]}`;
    return p.length > 3 ? `src/renderer/${p[2]}` : 'src/renderer'; // run3d has its own; the rest is the shell
  }
  if (p.length > 3) return `src/${p[1]}/${p[2]}`; // src/engine/run, src/service/areas, src/shared/providers
  if (p.length > 2) return `src/${p[1]}`; // src/engine, src/service, src/control
  return 'src';
}
const parentOf = (id) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : null);

/** What the ground label says in folder mode. */
function labelOf(id) {
  const special = { src: 'src (root)', 'src/renderer': 'renderer (shell)', 'src/renderer/views': 'views (small)', native: 'native (Rust)', test: 'tests' };
  if (special[id]) return special[id];
  return id.replace(/^src\//, '').replace(/^renderer\//, '');
}

/** Every file's district by folders; districts under MIN_DISTRICT_FILES fold into their parent (test/* and native/* always fold). */
function assignDistricts(files) {
  const of = {};
  for (const f of files) {
    const d = districtOf(f);
    of[f] = d.startsWith('test/') ? 'test' : d.startsWith('native/') ? 'native' : d;
  }
  for (;;) {
    const count = {};
    for (const d of Object.values(of)) count[d] = (count[d] || 0) + 1;
    const small = new Set(Object.keys(count).filter((d) => count[d] < MIN_DISTRICT_FILES && parentOf(d)));
    if (!small.size) return of;
    // all at once, so the small views of src/renderer/views meet there before it is judged itself
    for (const f of Object.keys(of)) if (small.has(of[f])) of[f] = parentOf(of[f]);
  }
}

// ---------- the plan ----------
/** Applies a plan's rules: { of: file -> district id, unmatched: [files] }. The first district whose rules match wins. */
function applyPlan(plan, files) {
  const rules = (plan.districts || []).map((d) => ({ id: d.id, inc: matcher(d.include), exc: matcher(d.exclude) }));
  const of = {}, unmatched = [];
  for (const f of files) {
    const hit = rules.find((r) => r.inc(f) && !r.exc(f));
    if (hit) of[f] = hit.id; else unmatched.push(f);
  }
  return { of, unmatched };
}

/** The validator's report lines and whether the coverage passes. */
function validatePlan(plan, tracked, drawn, of, unmatched) {
  const lines = [], warnings = [];
  const matched = drawn.length - unmatched.length;
  const coverage = drawn.length ? (matched / drawn.length) * 100 : 100;
  lines.push(`plan ${plan.project}: ${tracked.length} tracked files, ${drawn.length} drawn (${tracked.length - drawn.length} ignored), ${matched} matched: coverage ${coverage.toFixed(1)}%${coverage < COVERAGE_MIN ? ` (under ${COVERAGE_MIN}%)` : ''}`);
  if (unmatched.length) {
    lines.push(`  unmatched (${unmatched.length}, first ${Math.min(UNMATCHED_SAMPLE, unmatched.length)}):`);
    for (const f of unmatched.slice(0, UNMATCHED_SAMPLE)) lines.push(`    ${f}`);
  }
  const count = {};
  for (const d of Object.values(of)) count[d] = (count[d] || 0) + 1;
  const zoneIds = new Set((plan.zones || []).map((z) => z.id));
  const seen = new Set();
  for (const z of plan.zones || []) { if (seen.has(z.id)) warnings.push(`duplicate zone id: ${z.id}`); seen.add(z.id); }
  const seenD = new Set();
  for (const d of plan.districts || []) {
    if (seenD.has(d.id)) warnings.push(`duplicate district id: ${d.id}`);
    seenD.add(d.id);
    if (!zoneIds.has(d.zone)) warnings.push(`district ${d.id}: unknown zone "${d.zone}"`);
    const n = count[d.id] || 0;
    if (n < MIN_DISTRICT_FILES) warnings.push(`district ${d.id} (${d.name}): ${n === 0 ? 'no files' : `${n} file${n === 1 ? '' : 's'}`}`);
  }
  const isTracked = new Set(tracked), isDrawn = new Set(drawn);
  const where = (p) => (!isTracked.has(p) ? 'not tracked' : !isDrawn.has(p) ? 'ignored by the plan' : null);
  for (const l of plan.landmarks || []) { const w = where(l.path); if (w) warnings.push(`landmark ${l.path}: ${w}`); }
  for (const p of plan.ports || []) for (const v of p.via || []) { const w = where(v); if (w) warnings.push(`port ${p.id} via ${v}: ${w}`); }
  for (const w of warnings) lines.push(`  warning: ${w}`);
  if (!warnings.length) lines.push('  no warnings');
  return { lines, warnings, coverage, matched, ok: coverage >= COVERAGE_MIN };
}

// ---------- metrics ----------
function countLoc(repo, file) {
  let text;
  try { text = fs.readFileSync(path.join(repo, file), 'utf8'); } catch { return 0; }
  let n = 0;
  for (const line of text.split('\n')) if (line.trim()) n++;
  return n;
}

/** Hotspots of this repository's scripts/code-health.js run on `repo`, by file ({} when it measures nothing there). */
function codeHealth(repo) {
  const script = path.join(__dirname, '..', 'scripts', 'code-health.js');
  let out;
  try {
    out = execFileSync(process.execPath, [script, '--hotspots', '--json', '--root', repo], { cwd: path.dirname(script), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const why = String(e.stderr || e.message).trim().split('\n')[0];
    if (/Cannot find module 'acorn'/.test(why)) throw new Error('scripts/code-health.js needs acorn: set NODE_PATH to a node_modules');
    console.log(`code-health measured nothing in ${repo} (${why})`);
    return { byFile: {}, head: null };
  }
  const report = JSON.parse(out);
  const byFile = {};
  for (const f of report.files) byFile[f.file] = f;
  return { byFile, head: report.head };
}

/** Churn of every file: commits that touched it (no merges, not the one that created it, not the mass moves). */
function churnOf(repo, files) {
  const wanted = new Set(files);
  let ignore = new Set();
  try { ignore = new Set(fs.readFileSync(path.join(repo, '.git-blame-ignore-revs'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))); } catch { /* no ignore file */ }
  const log = git(repo, ['log', '--no-merges', '--format=%x01%H %cI', '--name-only']);
  const commits = {}, last = {};
  let skip = false, date = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('\u0001')) { const [hash, d] = line.slice(1).trim().split(' '); skip = ignore.has(hash); date = d; continue; }
    const f = line.trim();
    if (!f || skip || !wanted.has(f)) continue;
    commits[f] = (commits[f] || 0) + 1;
    if (!last[f]) last[f] = date; // the log is newest first
  }
  const churn = {};
  for (const f of files) churn[f] = { commits: Math.max(0, (commits[f] || 0) - 1), last: last[f] || null };
  return churn;
}

function readHead(repo) {
  try { const [commit, date] = git(repo, ['log', '-1', '--format=%H %cI']).trim().split(' '); return { commit, date }; } catch { return { commit: '', date: '' }; }
}

// ---------- dependencies ----------
const posix = path.posix;
/** File-level edges from relative require()/import calls in JS files: [from, to] indexes into `files`. */
function jsDeps(repo, files, langOf) {
  const index = new Map(files.map((f, i) => [f, i]));
  const edges = new Set();
  const re = /(?:require\(\s*|from\s+|import\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;
  files.forEach((file, i) => {
    if (langOf(file) !== 'js') return;
    let text;
    try { text = fs.readFileSync(path.join(repo, file), 'utf8'); } catch { return; }
    for (const m of text.matchAll(re)) {
      const base = posix.normalize(posix.join(posix.dirname(file), m[2]));
      const target = [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}/index.js`].find((c) => index.has(c));
      if (target && target !== file) edges.add(`${i} ${index.get(target)}`);
    }
  });
  return [...edges].map((e) => e.split(' ').map(Number));
}

/** Crate-level edges from Cargo.toml [dependencies], as district pairs: { from, to, crates }. */
function rustDeps(repo, files, districtOf, campusDistricts, project) {
  const set = new Set(files);
  const manifests = files.filter((f) => f === 'Cargo.toml' || f.endsWith('/Cargo.toml'));
  if (!manifests.length) return [];
  const read = (f) => { try { return fs.readFileSync(path.join(repo, f), 'utf8'); } catch { return ''; } };
  // name -> crate dir: the workspace's [workspace.dependencies] path entries, then any crate's own [package] name
  const dirOf = {};
  const section = (text, header) => { const m = new RegExp(`^\\[${header.replace(/[.[\]]/g, '\\$&')}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(text); return m ? m[1] : ''; };
  for (const line of section(read('Cargo.toml'), 'workspace.dependencies').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^}]*path\s*=\s*"([^"]+)"/.exec(line);
    if (m) dirOf[m[1]] = posix.normalize(m[2]);
  }
  for (const f of manifests) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(section(read(f), 'package'));
    if (name) dirOf[name[1]] = posix.dirname(f) === '.' ? '' : posix.dirname(f);
  }
  const prefix = `${project}-`;
  const crateDir = (name, from) => {
    if (dirOf[name] != null) return dirOf[name];
    if (name.startsWith(prefix) && set.has(`crates/${name.slice(prefix.length)}/Cargo.toml`)) return `crates/${name.slice(prefix.length)}`;
    return null;
  };
  // the non-campus districts that own a crate's files
  const owners = (dir) => {
    const ds = new Set();
    for (const f of files) if (dir === '' ? !f.includes('/') : f.startsWith(`${dir}/`)) { const d = districtOf(f); if (d && !campusDistricts.has(d)) ds.add(d); }
    return ds;
  };
  const edges = new Map();
  for (const f of manifests) {
    if (f === 'Cargo.toml') continue;
    const text = read(f), dir = posix.dirname(f);
    const from = owners(dir);
    if (!from.size) continue;
    const deps = [];
    for (const m of text.matchAll(/^\[((?:target\.[^\]]*\.)?dependencies)\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm)) {
      for (const line of m[2].split(/\r?\n/)) { // the clone may have CRLF: "." never crosses "\r"
        const e = /^\s*([A-Za-z0-9_-]+)(?:\.workspace)?\s*=\s*(.*)$/.exec(line);
        if (!e) continue;
        const inline = /path\s*=\s*"([^"]+)"/.exec(e[2]);
        const target = inline ? posix.normalize(posix.join(dir, inline[1])) : crateDir(e[1], dir);
        if (target != null && target !== dir) deps.push({ name: e[1], dir: target });
      }
    }
    for (const dep of deps) {
      for (const a of from) for (const b of owners(dep.dir)) {
        if (a === b) continue;
        const key = `${a}>${b}`;
        const edge = edges.get(key) || (edges.set(key, { from: a, to: b, crates: new Set() }), edges.get(key));
        edge.crates.add(dep.name);
      }
    }
  }
  return [...edges.values()].map((e) => ({ from: e.from, to: e.to, crates: [...e.crates].sort() })).sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
}

// ---------- the model ----------
function projectName(repo) {
  try { const name = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).name; if (name) return String(name).replace(/^@[^/]+\//, ''); } catch { /* no package.json */ }
  return path.basename(repo);
}

function buildModel(opt) {
  const repo = opt.repo;
  const tracked = git(repo, ['ls-files']).split('\n').map((l) => l.trim()).filter(Boolean).sort();
  let plan = null, files, of, zones, districtDefs, validation = null, unmatched = [];
  if (opt.plan) {
    plan = JSON.parse(fs.readFileSync(opt.plan, 'utf8'));
    const ignored = matcher(plan.ignore);
    files = tracked.filter((f) => !ignored(f));
    ({ of, unmatched } = applyPlan(plan, files));
    validation = validatePlan(plan, tracked, files, of, unmatched);
    for (const f of unmatched) of[f] = OUTSKIRTS.id;
    zones = (plan.zones || []).map((z) => ({ id: z.id, name: z.name, kind: z.kind, purpose: z.purpose || '' }));
    districtDefs = (plan.districts || []).map((d) => ({ id: d.id, name: d.name, zone: d.zone, purpose: d.purpose || '' }));
    if (unmatched.length) { zones.push(OUTSKIRTS); districtDefs.push({ id: OUTSKIRTS.id, name: `${OUTSKIRTS.name} (unmatched)`, zone: OUTSKIRTS.id, purpose: OUTSKIRTS.purpose }); }
  } else {
    files = tracked.filter((f) => ROOTS.includes(f.split('/')[0]));
    of = assignDistricts(files);
    zones = ROOTS.map((r) => FOLDER_ZONES[r]);
    districtDefs = [...new Set(Object.values(of))].sort().map((id) => ({ id, name: labelOf(id), zone: id.split('/')[0], purpose: `Files under ${id}/` }));
  }
  const zoneById = Object.fromEntries(zones.map((z) => [z.id, z]));
  const health = codeHealth(repo);
  const churn = churnOf(repo, files);
  const langOf = (file) => { const ext = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1).toLowerCase() : ''; return LANGS[ext] || ext || 'text'; };
  const buildings = files.map((file) => {
    const h = health.byFile[file], d = of[file];
    const def = districtDefs.find((x) => x.id === d);
    return {
      path: file, district: d, zone: def ? def.zone : OUTSKIRTS.id, lang: langOf(file), loc: countLoc(repo, file),
      complexity: h ? h.complexity : null, worst: h ? h.worst : null, functions: h ? h.functions : null,
      churn: h && h.commits != null ? h.commits : churn[file].commits, quadrant: h ? h.quadrant : null, score: h ? h.score : null,
      lastChange: ((h && h.last_change) || churn[file].last || '').slice(0, 10) || null,
    };
  });
  const districts = districtDefs.map((d) => ({ ...d, files: 0, loc: 0, dangerZone: 0 }));
  const dById = Object.fromEntries(districts.map((d) => [d.id, d]));
  for (const b of buildings) { const d = dById[b.district]; d.files++; d.loc += b.loc; if (b.quadrant === 'Danger Zone') d.dangerZone++; }
  const campus = new Set(districts.filter((d) => (zoneById[d.zone] || {}).kind === 'campus').map((d) => d.id));
  const project = plan ? plan.project : projectName(repo);
  const drawn = new Set(files);
  const head = health.head || readHead(repo);
  return {
    meta: {
      project, summary: plan ? plan.summary || '' : `${project}: src/, scripts/, native/ and test/ grouped by folders.`,
      head: (head.commit || '').slice(0, 7), headDate: (head.date || '').slice(0, 10), generatedAt: new Date().toISOString(),
      grouping: plan ? 'plan' : 'folders', measured: Object.keys(health.byFile).length,
      plan: plan ? { file: path.basename(opt.plan), coverage: +validation.coverage.toFixed(1), matched: validation.matched, drawn: files.length, tracked: tracked.length, unmatched: unmatched.slice(0, UNMATCHED_SAMPLE), warnings: validation.warnings } : null,
    },
    zones, districts, buildings,
    landmarks: plan ? (plan.landmarks || []).filter((l) => drawn.has(l.path)) : [],
    ports: plan ? (plan.ports || []).map((p) => ({ id: p.id, name: p.name, via: (p.via || []).filter((v) => drawn.has(v)) })).filter((p) => p.via.length) : [],
    deps: { files: jsDeps(repo, files, langOf), districts: rustDeps(repo, files, (f) => of[f], campus, project) },
    validation,
  };
}

function main() {
  const opt = args();
  const { validation, ...model } = buildModel(opt);
  if (validation) {
    for (const line of validation.lines) console.log(line);
    if (!validation.ok && !opt.force) { console.error(`coverage under ${COVERAGE_MIN}%: fix the plan's rules, or pass --force to draw it anyway`); process.exit(1); }
  }
  const page = fs.readFileSync(TEMPLATE, 'utf8');
  const a = page.indexOf(OPEN), b = page.indexOf(CLOSE, a);
  if (a < 0 || b < 0) throw new Error(`${TEMPLATE}: the city-data block is missing`);
  const json = JSON.stringify(model).replace(/</g, '\\u003c'); // "<" escaped, so no path can close the script block
  fs.writeFileSync(opt.out, page.slice(0, a + OPEN.length) + json + page.slice(b));
  const danger = model.buildings.filter((x) => x.quadrant === 'Danger Zone');
  for (const z of model.zones) {
    const ds = model.districts.filter((d) => d.zone === z.id);
    console.log(`${z.name} (${z.kind}): ${ds.reduce((s, d) => s + d.files, 0)} files`);
    for (const d of ds) console.log(`  ${String(d.files).padStart(4)}  ${d.id.padEnd(24)} ${d.name}${d.dangerZone ? `  (${d.dangerZone} in the Danger Zone)` : ''}`);
  }
  console.log(`${model.buildings.length} files, ${model.zones.length} zones, ${model.districts.length} districts, ${model.meta.measured} measured, ${danger.length} in the Danger Zone, ${model.deps.files.length} file edges, ${model.deps.districts.length} district edges, ${model.landmarks.length} landmarks, ${model.ports.length} ports, head ${model.meta.head}`);
  console.log(`embedded ${(json.length / 1024).toFixed(0)} KB in ${opt.out}`);
}

if (require.main === module) main();
module.exports = { globToRegExp, matcher, districtOf, assignDistricts, labelOf, applyPlan, validatePlan, jsDeps, rustDeps, buildModel };
