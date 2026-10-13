#!/usr/bin/env node
// Builds the city model of this repository and embeds it into poc/project-city.html (the 3D "city"
// proof of concept): one building per tracked file under src/, scripts/, native/ and test/, grouped
// into districts. Read-only on the repository; rewrites the page's <script id="city-data"> block.
//
//   node poc/embed-city.js [--repo <dir>] [--out <page>]
//
// Needs acorn for scripts/code-health.js: run from a checkout with node_modules, or set NODE_PATH
// to one (NODE_PATH=<checkout>/node_modules node poc/embed-city.js).
//
// The model (plain JSON, see `buildModel`):
// - meta: the head commit, when the model was built, which roots it covers and the grouping rule;
// - districts: { id, label, kind, parent, files, loc }: the areas of the code, from `districtOf`
//   (folders today; a district with fewer than MIN_DISTRICT_FILES files joins its parent). Keep the
//   grouping in that one function: a C4 component map can replace it without touching the page;
// - buildings: one per file: { path, district, kind, lang, loc, complexity, worst, functions,
//   churn, quadrant, score, lastChange }. `loc` counts non-blank lines. complexity, worst,
//   functions, quadrant and score come from `node scripts/code-health.js --hotspots --json` and
//   exist only for the JS files it measures (src/ and scripts/): Rust, CSS, YAML, JSON and every
//   test file have null there, and the page says so. churn is that script's count where it has
//   one (commits that touched the file, renames followed, mass moves skipped); for the other
//   files it is counted here from `git log --name-only` with the same rules, except renames.
// Later phases (agents on buildings, the files an issue touches, release diffs) add their own
// data next to this model; buildings are looked up by `path`.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOTS = ['src', 'scripts', 'native', 'test'];
const MIN_DISTRICT_FILES = 3;
const OPEN = '<script id="city-data" type="application/json">', CLOSE = '</script>';
const LANGS = { js: 'js', jsx: 'js', css: 'css', yaml: 'yaml', yml: 'yaml', json: 'json', rs: 'rust', toml: 'toml', md: 'md', html: 'html', ndjson: 'json', lock: 'toml', cmd: 'cmd' };

function args() {
  const a = process.argv.slice(2), opt = { repo: path.join(__dirname, '..'), out: path.join(__dirname, 'project-city.html') };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--repo' && a[i + 1]) opt.repo = path.resolve(a[++i]);
    else if (a[i] === '--out' && a[i + 1]) opt.out = path.resolve(a[++i]);
    else { console.error('usage: node poc/embed-city.js [--repo <dir>] [--out <page>]'); process.exit(1); }
  }
  return opt;
}

const git = (repo, argv) => execFileSync('git', argv, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/**
 * The grouping rule: the district (an area of the code) a file belongs to, by its folders.
 * Replace this function to group by something else (for example the C4 components of a model);
 * the page only needs district ids and `labelOf`.
 */
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
const kindOf = (id) => (id === 'test' || id.startsWith('test/') ? 'test' : id === 'native' || id.startsWith('native/') ? 'native' : id.startsWith('scripts') ? 'scripts' : 'source');

/** What the ground label says. */
function labelOf(id) {
  const special = { src: 'src (root)', 'src/renderer': 'renderer (shell)', 'src/renderer/views': 'views (small)', native: 'native (Rust)', test: 'tests' };
  if (special[id]) return special[id];
  return id.replace(/^src\//, '').replace(/^renderer\//, '');
}

/**
 * Every file's district: `districtOf`, then districts under MIN_DISTRICT_FILES files fold into
 * their parent until all are big enough (test/* and native/* always fold: one district each).
 */
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

function countLoc(repo, file) {
  let text;
  try { text = fs.readFileSync(path.join(repo, file), 'utf8'); } catch { return 0; }
  let n = 0;
  for (const line of text.split('\n')) if (line.trim()) n++;
  return n;
}

/** Hotspots of scripts/code-health.js, by file. */
function codeHealth(repo) {
  let out;
  try {
    out = execFileSync(process.execPath, [path.join(repo, 'scripts', 'code-health.js'), '--hotspots', '--json'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env });
  } catch (e) {
    throw new Error(`scripts/code-health.js failed (acorn missing? set NODE_PATH to a node_modules): ${String(e.stderr || e.message).trim().split('\n')[0]}`);
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
  const log = git(repo, ['log', '--no-merges', '--format=%x01%H %cI', '--name-only', '--', ...ROOTS]);
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

function buildModel(repo) {
  const files = git(repo, ['ls-files', '--', ...ROOTS]).split('\n').map((l) => l.trim()).filter(Boolean).sort();
  const district = assignDistricts(files);
  const health = codeHealth(repo);
  const churn = churnOf(repo, files);
  const buildings = files.map((file) => {
    const h = health.byFile[file], d = district[file];
    const ext = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1).toLowerCase() : '';
    return {
      path: file, district: d, kind: kindOf(d), lang: LANGS[ext] || ext || 'text', loc: countLoc(repo, file),
      complexity: h ? h.complexity : null, worst: h ? h.worst : null, functions: h ? h.functions : null,
      churn: h && h.commits != null ? h.commits : churn[file].commits, quadrant: h ? h.quadrant : null, score: h ? h.score : null,
      lastChange: ((h && h.last_change) || churn[file].last || '').slice(0, 10) || null,
    };
  });
  const byId = {};
  for (const b of buildings) {
    const d = byId[b.district] ||= { id: b.district, label: labelOf(b.district), kind: b.kind, parent: parentOf(b.district), files: 0, loc: 0, dangerZone: 0 };
    d.files++; d.loc += b.loc; if (b.quadrant === 'Danger Zone') d.dangerZone++;
  }
  const districts = Object.values(byId).sort((a, b) => a.id.localeCompare(b.id));
  const head = health.head || {};
  return {
    meta: { repo: 'eduardogalbiati/multiagent-orchestrator', head: (head.commit || '').slice(0, 7), headDate: (head.date || '').slice(0, 10), generatedAt: new Date().toISOString(), roots: ROOTS, grouping: 'folders (poc/embed-city.js districtOf)', minDistrictFiles: MIN_DISTRICT_FILES },
    districts, buildings,
  };
}

function main() {
  const opt = args();
  const model = buildModel(opt.repo);
  const page = fs.readFileSync(opt.out, 'utf8');
  const a = page.indexOf(OPEN), b = page.indexOf(CLOSE, a);
  if (a < 0 || b < 0) throw new Error(`${opt.out}: the city-data block is missing`);
  const json = JSON.stringify(model).replace(/</g, '\\u003c'); // "<" escaped, so no path can close the script block
  fs.writeFileSync(opt.out, page.slice(0, a + OPEN.length) + json + page.slice(b));
  const danger = model.buildings.filter((x) => x.quadrant === 'Danger Zone');
  for (const d of model.districts) console.log(`${String(d.files).padStart(4)}  ${d.id.padEnd(32)} ${d.label}${d.dangerZone ? `  (${d.dangerZone} in the Danger Zone)` : ''}`);
  console.log(`${model.buildings.length} files, ${model.districts.length} districts, ${danger.length} in the Danger Zone, head ${model.meta.head}`);
  console.log(`embedded ${(json.length / 1024).toFixed(0)} KB in ${opt.out}`);
}

if (require.main === module) main();
module.exports = { districtOf, assignDistricts, labelOf, buildModel };
