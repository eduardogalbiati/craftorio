// Dependency map of the sources for reorganisation work (docs/reorganisation-study-2026-10.md): the
// require() edges between areas (engine, service, shared, server, control, renderer, host, the loose files
// of a src/ tree; a workspace's folders count by the same names, scripts/source-tree.js), the clusters the loose files form by name, which of them the engine side needs,
// which service channel files each screen calls (through `api.<method>(`), by the front that holds the
// screen (the UI kit's screens as `shell`, phase 3), the channel files called from more than one
// front (what phase 4's vertical slices have to place), and the script globals a front defines
// (`window.X = …`, a top-level `function X(` or `const X =` of a classic script) that another layer
// uses by name: the couplings the layering check cannot see, since the fronts reach each other through
// the page, not through require. After phase 4 (#590) it also says which package holds each channel
// file (the engine kernel or a front's engine/channels/) and flags a front's file called from outside
// the front. Read-only; prints a report.
// `node scripts/dep-map.js [--json <file>]` writes the raw edges too.

'use strict';

const fs = require('fs');
const path = require('path');

const { FOLDERS, PACKAGES } = require('./layers');
const {
  frontEngineDirs,
  fronts,
  resolvePackagePath,
  sourceDirs,
  sourceFiles,
  uiKit,
  viewsOf,
} = require('./source-tree');

const ROOT = path.resolve(__dirname, '..');
// the first source folder (scripts/source-tree.js) holding `sub`, e.g. service/channels (packages/engine) or renderer/views (apps/desktop)
const sourceDirWith = (sub) => sourceDirs(ROOT).map((d) => path.join(ROOT, d, sub)).find((p) => fs.existsSync(p));
// the area folders (scripts/layers.js FOLDERS): anything else under a src/ tree is a loose file
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

// The channel folders: the kernel's (packages/engine/service/channels, `engine`) and each front's
// engine/channels/ (phase 4 of the study, #590; scripts/source-tree.js frontEngineDirs), [{ dir, from }].
function channelDirs() {
  const kernel = sourceDirWith(path.join('service', 'channels'));
  return [...(kernel ? [{ dir: rel(kernel), from: 'engine' }] : []), ...frontEngineDirs(ROOT).map((f) => ({ dir: `${f.engine}/channels`, from: f.id }))]
    .filter((d) => fs.existsSync(path.join(ROOT, d.dir)));
}

// The service's channel files, by the `method` each channel exposes on window.api, and the package
// that holds each file (`engine`, or a front's id).
function channelFiles() {
  const byMethod = {};
  const holder = {};
  for (const { dir, from } of channelDirs()) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((x) => x.endsWith('.js'))) {
      const name = f.replace(/\.js$/, '');
      holder[name] = from;
      const text = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
      for (const m of text.matchAll(/method:\s*'([A-Za-z0-9_]+)'/g)) byMethod[m[1]] = name;
    }
  }
  return { byMethod, holder };
}

const apiCalls = (text) => new Set([...text.matchAll(/\bapi\.([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]));

// The layers that hold screens (phase 3 of the study): the UI kit (`shell`), each front by its id, and
// each app's page folder (`app:<name>`); before phase 3, the renderer folder alone (`renderer`).
function viewLayers() {
  const layers = [];
  const kit = uiKit(ROOT);
  if (kit) layers.push({ id: 'shell', dir: kit.dir });
  for (const f of fronts(ROOT)) layers.push({ id: f.id, dir: f.dir });
  const legacy = sourceDirWith(path.join('renderer', 'views'));
  if (legacy) layers.push({ id: kit ? `app:${path.basename(path.dirname(path.dirname(legacy)))}` : 'renderer', dir: rel(path.dirname(legacy)) });
  return layers;
}

// view → { channel file: calls }, and view → the layer (front) holding it
function viewChannels(byMethod) {
  const result = {};
  const layerOf = {};
  for (const layer of viewLayers()) {
    // a layer's own root files count as one screen of its own (a front's Home card, <id>-home.js, phase 3)
    const rootFiles = fs.readdirSync(path.join(ROOT, layer.dir)).filter((f) => f.endsWith('.js') && !layer.id.startsWith('app:') && layer.id !== 'shell');
    if (rootFiles.length) {
      const calls = new Set();
      for (const f of rootFiles) apiCalls(fs.readFileSync(path.join(ROOT, layer.dir, f), 'utf8')).forEach((c) => calls.add(c));
      const files = {};
      for (const c of calls) { const k = byMethod[c] || `?${c}`; files[k] = (files[k] || 0) + 1; }
      result[`${layer.id}/*`] = files;
      layerOf[`${layer.id}/*`] = layer.id;
    }
    for (const v of viewsOf(ROOT, layer.dir)) {
      const dir = path.join(ROOT, layer.dir, 'views', v);
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
      layerOf[v] = layer.id;
    }
  }
  return { views: result, layerOf };
}

// The page scripts of each layer (the UI kit's and the fronts' root files and views/), with the globals
// each defines (`window.X = …`, a top-level `function X(` or `const X =`) and the names it uses.
function pageGlobals() {
  const layers = [...(uiKit(ROOT) ? [{ id: 'shell', dir: uiKit(ROOT).dir }] : []), ...fronts(ROOT).map((f) => ({ id: f.id, dir: f.dir }))];
  const filesOf = (dir) => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const own = fs.readdirSync(abs).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`);
    const views = viewsOf(ROOT, dir).flatMap((v) => fs.readdirSync(path.join(abs, 'views', v)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/views/${v}/${f}`));
    return [...own, ...views];
  };
  const defined = new Map(); // name -> the layer that defines it
  const texts = [];
  for (const layer of layers) {
    for (const file of filesOf(layer.dir)) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      texts.push({ layer: layer.id, text });
      for (const m of text.matchAll(/^window\.([A-Za-z_$][\w$]*)\s*=/gm)) defined.set(m[1], layer.id);
      for (const m of text.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) defined.set(m[1], layer.id);
      for (const m of text.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=/gm)) defined.set(m[1], layer.id);
    }
  }
  const out = [];
  for (const [name, from] of defined) {
    if (from === 'shell') continue;
    const re = new RegExp(`(?<![\\w$.])${name.split('$').join('\\$')}(?=\\s*[(.?])`);
    const users = [...new Set(texts.filter((t) => t.layer !== from && re.test(t.text)).map((t) => t.layer))].sort();
    if (users.length) out.push({ name, from, users });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
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
  say(''); say(`## loose files (outside the area folders): ${roots.length}; clusters by name prefix (2 or more)`);
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
  const svc = all.filter(([a, b]) => area(a) === 'service' && (area(b) === 'renderer' || rel(b) === 'apps/desktop/host/main.js'));
  say(`## service/ requiring renderer/ or main.js: ${svc.length ? svc.length : 'none'}`);

  const { byMethod, holder } = channelFiles();
  const { views, layerOf } = viewChannels(byMethod);
  say(''); say(`## channels: ${Object.keys(byMethod).length}; per view (its front in brackets), the channel files it calls (count); "?name" = a window.api method outside the channel files`);
  for (const v of Object.keys(views).sort()) {
    say(`${v} [${layerOf[v]}]`.padEnd(22), Object.entries(views[v]).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' '));
  }
  const users = {};
  for (const [v, files] of Object.entries(views)) for (const k of Object.keys(files)) (users[k] ??= new Set()).add(v);
  say(''); say('## channel file [the package that holds it] -> the views that call it');
  for (const [k, s] of Object.entries(users).sort()) say(`${k}${holder[k] ? ` [${holder[k]}]` : ''}`.padEnd(30), [...s].sort().join(' '));
  // phase 3: a channel file called from two fronts or more is what phase 4 has to place (the shell's
  // screens and the host's own methods, "?name", are left out of the count); after phase 4 (#590) only
  // kernel files may cross fronts, and a front's file is called by that front alone (or by the shell:
  // a shell call keeps a file in the kernel, docs/agents/fronts.md)
  const byFront = {};
  for (const [k, s] of Object.entries(users)) byFront[k] = new Set([...s].map((v) => layerOf[v]).filter((l) => l !== 'shell' && !l.startsWith('app:')));
  const crossing = Object.entries(byFront).filter(([k, s]) => !k.startsWith('?') && s.size > 1).sort();
  say(''); say(`## channel files called from more than one front: ${crossing.length}${crossing.length ? '' : ' (none)'}`);
  for (const [k, s] of crossing) say(`${k} [${holder[k] || '?'}]`.padEnd(30), [...s].sort().join(' '));
  const misplaced = Object.entries(users).filter(([k, s]) => holder[k] && holder[k] !== 'engine' && [...s].some((v) => layerOf[v] !== holder[k])).sort();
  say(''); say(`## a front's channel files called from outside the front (phase 4 forbids it): ${misplaced.length}${misplaced.length ? '' : ' (none)'}`);
  for (const [k, s] of misplaced) say(`${k} [${holder[k]}]`.padEnd(30), [...s].filter((v) => layerOf[v] !== holder[k]).sort().join(' '));
  const byHolder = {};
  for (const [name, from] of Object.entries(holder)) (byHolder[from] ??= []).push(name);
  say(''); say('## channel files by package (phase 4)');
  for (const [from, names] of Object.entries(byHolder).sort()) say(from.padEnd(12), names.sort().join(' '));

  // the page's globals a front defines that another layer uses; the shell's globals are the page's
  // (every front may use them), so only a front's are listed
  const globals = pageGlobals();
  say(''); say(`## script globals a front defines that another layer uses (the fronts' couplings through the page): ${globals.length}${globals.length ? '' : ' (none)'}`);
  for (const g of globals) say(`${g.name} [${g.from}]`.padEnd(40), `used by ${g.users.join(' ')}`);

  return { text: lines.join('\n'), edges: all.map(([a, b]) => [rel(a), rel(b)]) };
}

if (require.main === module) {
  const { text, edges: raw } = report();
  console.log(text);
  const i = process.argv.indexOf('--json');
  if (i > 0 && process.argv[i + 1]) fs.writeFileSync(process.argv[i + 1], JSON.stringify(raw, null, 1));
}

module.exports = { report, area };
