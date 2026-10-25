// Dependency map of src/ for reorganisation work (docs/reorganisation-study-2026-10.md): the
// require() edges between areas (engine, service, shared, server, control, renderer, host, the loose files
// of src/; a workspace's folders count by the same names, scripts/source-tree.js), the clusters the loose files form by name, which of them the engine side needs, and
// which service channel files each renderer view calls (through `api.<method>(`). Read-only; prints
// a report. `node scripts/dep-map.js [--json <file>]` writes the raw edges too.

'use strict';

const fs = require('fs');
const path = require('path');

const { FOLDERS, PACKAGES } = require('./layers');
const { resolvePackagePath, sourceFiles } = require('./source-tree');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
// the top-level folders of src/ (scripts/layers.js FOLDERS): anything else under src/ is a loose file
const AREA = new RegExp(`^src/(${Object.keys(FOLDERS).join('|')})/`);
// a workspace's folders (scripts/layers.js PACKAGES): the whole package, or its area folders
const PKG_AREA = new RegExp(`^(${Object.keys(PACKAGES).join('|')})/(?:(${Object.keys(FOLDERS).join('|')})/)?`);

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

// The area a file belongs to: a top-level folder of src/, a workspace's folder (`shared`,
// `engine`…: the same names), or `src-root` for the loose files.
function area(file) {
  const r = rel(file);
  const m = r.match(AREA);
  if (m) return m[1];
  const p = r.match(PKG_AREA);
  if (p) return PACKAGES[p[1]] || p[2] || p[1];
  return 'src-root';
}

function resolveRequire(from, spec) {
  if (!spec.startsWith('.')) {
    const pkgPath = resolvePackagePath(ROOT, spec);
    return pkgPath ? resolveRequire(path.join(ROOT, 'x.js'), `./${pkgPath}`) : null;
  }
  let target = path.resolve(path.dirname(from), spec);
  if (!target.endsWith('.js')) {
    if (fs.existsSync(`${target}.js`)) target += '.js';
    else if (fs.existsSync(path.join(target, 'index.js'))) target = path.join(target, 'index.js');
  }
  return fs.existsSync(target) && target.endsWith('.js') ? target : null;
}

function edges(files) {
  const out = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/require\(\s*['"]((?:\.{1,2}\/|@)[^'"]+)['"]\s*\)/g)) {
      const t = resolveRequire(f, m[1]);
      if (t) out.push([f, t]);
    }
  }
  return out;
}

function areaMatrix(all) {
  const mat = {};
  for (const [a, b] of all) {
    const x = area(a);
    const y = area(b);
    if (x === y) continue;
    mat[x] ??= {};
    mat[x][y] = (mat[x][y] || 0) + 1;
  }
  return mat;
}

// The service's channel files, by the `method` each channel exposes on window.api.
function channelFiles() {
  const dir = path.join(SRC, 'service', 'channels');
  const byMethod = {};
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/method:\s*'([A-Za-z0-9_]+)'/g)) byMethod[m[1]] = f.replace(/\.js$/, '');
  }
  return byMethod;
}

const apiCalls = (text) => new Set([...text.matchAll(/\bapi\.([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]));

function viewChannels(byMethod) {
  const viewsDir = path.join(SRC, 'renderer', 'views');
  const result = {};
  for (const v of fs.readdirSync(viewsDir)) {
    const dir = path.join(viewsDir, v);
    if (!fs.statSync(dir).isDirectory()) continue;
    const calls = new Set();
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) apiCalls(fs.readFileSync(path.join(dir, f), 'utf8')).forEach((c) => calls.add(c));
    }
    const files = {};
    for (const c of calls) {
      const k = byMethod[c] || `?${c}`;
      files[k] = (files[k] || 0) + 1;
    }
    result[v] = files;
  }
  return result;
}

function report() {
  const files = sourceFiles(ROOT).map((f) => path.join(ROOT, f));
  const all = edges(files);
  const lines = [];
  const say = (...a) => lines.push(a.join(' '));

  say('## require() edges between areas (from -> to = count)');
  const mat = areaMatrix(all);
  for (const x of Object.keys(mat).sort()) {
    say(`${x}:`, Object.entries(mat[x]).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '));
  }

  const roots = files.filter((f) => area(f) === 'src-root').map(rel);
  say(''); say(`## loose files of src/: ${roots.length}; clusters by name prefix (2 or more)`);
  const clusters = {};
  for (const r of roots) {
    const name = path.basename(r, '.js');
    (clusters[name.split('-')[0]] ??= []).push(name);
  }
  for (const [p, l] of Object.entries(clusters).sort((a, b) => b[1].length - a[1].length)) {
    if (l.length >= 2) say(p.padEnd(12), String(l.length).padStart(2), l.join(' '));
  }

  const inbound = {};
  for (const [a, b] of all) (inbound[rel(b)] ??= new Set()).add(area(a));
  const engineSide = roots.filter((r) => inbound[r] && [...inbound[r]].some((x) => ['engine', 'service', 'server'].includes(x)));
  const hostSide = roots.filter((r) => !engineSide.includes(r));
  say(''); say(`## loose files the engine side (engine/, service/, server/) requires: ${engineSide.length}`);
  say(engineSide.map((r) => path.basename(r, '.js')).sort().join(' '));
  say(''); say(`## loose files only the host side (main, preload, other loose files) requires: ${hostSide.length}`);
  say(hostSide.map((r) => path.basename(r, '.js')).sort().join(' '));

  say(''); say('## engine/ requiring loose files (what an engine package would take along)');
  const eng = [...new Set(all.filter(([a, b]) => area(a) === 'engine' && area(b) === 'src-root').map(([a, b]) => `${rel(a).replace('packages/engine/engine/', '')} -> ${path.basename(b)}`))];
  say(eng.join('\n'));

  const outside = all.filter(([a, b]) => area(a) === 'shared' && area(b) !== 'shared');
  say(''); say(`## shared/ requiring outside shared/: ${outside.length ? outside.map(([a, b]) => `${rel(a)} -> ${rel(b)}`).join(', ') : 'none'}`);
  const svc = all.filter(([a, b]) => area(a) === 'service' && (area(b) === 'renderer' || rel(b) === 'src/host/main.js'));
  say(`## service/ requiring renderer/ or main.js: ${svc.length ? svc.length : 'none'}`);

  const byMethod = channelFiles();
  const views = viewChannels(byMethod);
  say(''); say(`## channels: ${Object.keys(byMethod).length}; per view, the channel files it calls (count); "?name" = a window.api method outside the channel files`);
  for (const v of Object.keys(views).sort()) {
    say(v.padEnd(12), Object.entries(views[v]).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' '));
  }
  const users = {};
  for (const [v, files] of Object.entries(views)) for (const k of Object.keys(files)) (users[k] ??= new Set()).add(v);
  say(''); say('## channel file -> the views that call it');
  for (const [k, s] of Object.entries(users).sort()) say(k.padEnd(24), [...s].sort().join(' '));

  return { text: lines.join('\n'), edges: all.map(([a, b]) => [rel(a), rel(b)]) };
}

if (require.main === module) {
  const { text, edges: raw } = report();
  console.log(text);
  const i = process.argv.indexOf('--json');
  if (i > 0 && process.argv[i + 1]) fs.writeFileSync(process.argv[i + 1], JSON.stringify(raw, null, 1));
}

module.exports = { report, area };
