// The source tree of the repository, as the layout-bound tooling sees it (phases 2, 3 and 4 of
// docs/reorganisation-study-2026-10.md): the npm workspaces (`packages/*`, `fronts/*`, `apps/*`, from
// the root package.json), the folders their sources live in, the files of each, and the UI's
// composition (the UI kit, the fronts and the apps that list them). Everything that scans "every
// source file" (the code map, the ratchets, the layering check, the list linter, the literal checks
// in the tests) asks this module instead of naming `src/` itself, so a new workspace is learnt here
// once; everything that lays out a page (`scripts/docs.js`, the smoke and screenshot runners) asks it
// which fronts an app ships.
//
//   workspaces(root)        [{ dir: 'packages/shared', name: '@craftorio/shared' }, …], from the
//                           root package.json's `workspaces` globs (one level: `packages/*`)
//   sourceDirs(root)        the folders holding app sources: `src` while it exists, then every
//                           workspace folder (paths from root, with /)
//   sourceFiles(root, opts) every .js file of sourceDirs (and `scripts/` with { scripts: true }),
//                           paths from root with /, sorted; { match } picks another extension
//   packageOf(root, file)   the workspace a path belongs to, or null (the root)
//   resolvePackagePath(root, spec)  '@craftorio/shared/i18n' → 'packages/shared/i18n' (no extension
//                           resolution), or null when `spec` names no workspace
//   uiKit(root)             the UI kit workspace (`@craftorio/ui-kit`, packages/ui-kit), or null
//   fronts(root)            the front workspaces, [{ id: 'build', dir: 'fronts/build', name }], by id:
//                           the workspaces under fronts/ whose package.json declares `craftorio.front`
//                           (the id; the folder name before phase 4), the field the engine reads too
//                           (packages/engine/service/fronts.js)
//   frontEngineDirs(root)   the fronts' engine-side folders (phase 4, #590): [{ id, dir, engine:
//                           'packages/engine/fronts/build' }] for the fronts that have one (`craftorio.engine`
//                           names another folder name; { all: true } lists every front's, existing or
//                           not); their channels/, areas/ and domains/ hold engine code the service
//                           loads when the composition serves the front
//   composition(root, app)  what the app `app` ('apps/desktop') ships: { app, page: 'apps/desktop/renderer',
//                           fronts: [{ id, dir, name }] } from `<app>/composition.js` (`fronts`, in
//                           order; a front it names that is not installed is an error; without the
//                           file, every installed front). The page is `<app>/renderer/`, where
//                           index.html lives
//   viewsOf(root, dir)      the screen folders of a layer (`<dir>/views/<view>/`), sorted
//   frontOf(root, view)     the front that holds the screen `view` (its views/<view>/ folder), the
//                           UI kit for a shell screen, or null
//   appPages(root)          the apps with a page folder: [{ app: 'apps/desktop', page: 'apps/desktop/renderer' }]
//   pageDirs(root)          the folders holding page files, in load order: the kit, the fronts, the
//                           apps' page folders
//   featureDirs(root)       the folders holding Playwright features: the repository's `features`, the
//                           kit's and each front's `features/` (playwright.config.js builds its globs from them)
//   pageFile(root, rel)     the absolute path of a page file by its page-relative name
//                           ('select.js', 'views/run/run.js'), in whichever layer holds it, or null
//   pageFiles(root, opts)   every page file of every layer, [{ dir, rel, file }]; { match } the extension

const fs = require('fs');
const path = require('path');

const posix = (p) => p.split(path.sep).join('/');
const cache = new Map();

function workspaces(root) {
  if (cache.has(root)) return cache.get(root);
  let globs = [];
  try { globs = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).workspaces || []; } catch { /* no root package.json: no workspaces */ }
  const out = [];
  for (const glob of globs) {
    const m = /^([^*]+)\/\*$/.exec(glob);
    const dirs = m
      ? (fs.existsSync(path.join(root, m[1])) ? fs.readdirSync(path.join(root, m[1]), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `${m[1]}/${e.name}`) : [])
      : [glob.replace(/\/$/, '')];
    for (const dir of dirs) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
        if (pkg.name) out.push({ dir: posix(dir), name: pkg.name });
      } catch { /* a folder without a package.json is not a workspace */ }
    }
  }
  out.sort((a, b) => a.dir.localeCompare(b.dir));
  cache.set(root, out);
  return out;
}

// the workspace folders a checkout may hold even without manifests (a test's temporary tree)
const WORKSPACE_PARENTS = ['apps', 'fronts', 'packages'];

function sourceDirs(root) {
  const dirs = new Set(fs.existsSync(path.join(root, 'src')) ? ['src'] : []);
  for (const w of workspaces(root)) dirs.add(w.dir);
  for (const parent of WORKSPACE_PARENTS) {
    if (!fs.existsSync(path.join(root, parent))) continue;
    for (const e of fs.readdirSync(path.join(root, parent), { withFileTypes: true })) if (e.isDirectory()) dirs.add(`${parent}/${e.name}`);
  }
  return [...dirs];
}

// the folders of a workspace that hold no sources (its tests, its Playwright features)
const NOT_SOURCE = new Set(['features', 'node_modules', 'test']);

function listFiles(root, dir, match) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return NOT_SOURCE.has(e.name) ? [] : listFiles(root, rel, match);
    return e.isFile() && match.test(e.name) ? [rel] : [];
  });
}

function sourceFiles(root, { scripts = false, match = /\.js$/ } = {}) {
  const dirs = [...sourceDirs(root), ...(scripts ? ['scripts'] : [])];
  return dirs.flatMap((d) => listFiles(root, d, match)).sort();
}

function packageOf(root, file) {
  const f = posix(file);
  return workspaces(root).find((w) => f === w.dir || f.startsWith(`${w.dir}/`)) || null;
}

function resolvePackagePath(root, spec) {
  const w = workspaces(root).find((x) => spec === x.name || spec.startsWith(`${x.name}/`));
  if (!w) return null;
  return spec === w.name ? w.dir : `${w.dir}${spec.slice(w.name.length)}`;
}

// ---- phase 3: the UI kit, the fronts and the compositions ----------------------------------------
const UI_KIT = '@craftorio/ui-kit';
// the folder of the fronts (`fronts/<id>`, decision 7 of 2026-10-24): a front's id is its folder name
const FRONTS_DIR = 'fronts';
// an app's page folder: where its index.html and its own page files live
const PAGE_DIR = 'renderer';

function uiKit(root) {
  return workspaces(root).find((w) => w.name === UI_KIT) || null;
}

// a front's manifest fields (phase 4): `craftorio.front` its id, `craftorio.engine` its engine folder,
// read by the engine's own reader (packages/engine/service/fronts.js: one definition of the fields and
// of the default folder; the runtime scan itself stays in the engine, which cannot require scripts/)
const frontManifest = (root, dir) => require('@craftorio/engine/service/fronts').frontManifest(path.join(root, dir));

function fronts(root) {
  return workspaces(root).filter((w) => w.dir.startsWith(`${FRONTS_DIR}/`))
    .map((w) => ({ id: frontManifest(root, w.dir).id || w.dir.slice(FRONTS_DIR.length + 1), ...w }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function frontEngineDirs(root, { all = false } = {}) {
  // T4: the engine package's fronts/<id>/ first (this repository's fronts), else the front's own folder
  const own = (f) => `packages/engine/fronts/${f.id}`;
  return fronts(root).map((f) => ({ ...f, engine: fs.existsSync(path.join(root, own(f))) ? own(f) : `${f.dir}/${frontManifest(root, f.dir).engine}` }))
    .filter((f) => all || fs.existsSync(path.join(root, f.engine)));
}

function composition(root, app) {
  const appDir = posix(app).replace(/\/+$/, '');
  const file = path.join(root, appDir, 'composition.js');
  const installed = fronts(root);
  let ids = installed.map((f) => f.id);
  if (fs.existsSync(file)) {
    const def = require(file);
    if (!Array.isArray(def.fronts) || def.fronts.some((id) => typeof id !== 'string')) throw new Error(`${appDir}/composition.js: \`fronts\` must be a list of front ids.`);
    ids = def.fronts;
  }
  const list = ids.map((id) => {
    const front = installed.find((f) => f.id === id);
    if (!front) throw new Error(`${appDir}/composition.js names the front "${id}", which has no workspace ${FRONTS_DIR}/${id}/ (a package.json with a name).`);
    return front;
  });
  return { app: appDir, page: `${appDir}/${PAGE_DIR}`, fronts: list };
}

// a screen folder holds at least one file (a folder a move left empty is none)
function viewsOf(root, dir) {
  const abs = path.join(root, dir, 'views');
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.readdirSync(path.join(abs, e.name)).length).map((e) => e.name).sort();
}

// The apps with a page folder (`apps/<app>/renderer/`, where index.html lives), by path.
function appPages(root) {
  const appsDir = path.join(root, 'apps');
  if (!fs.existsSync(appsDir)) return [];
  return fs.readdirSync(appsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(appsDir, e.name, PAGE_DIR)))
    .map((e) => ({ app: `apps/${e.name}`, page: `apps/${e.name}/${PAGE_DIR}` })).sort((a, b) => a.app.localeCompare(b.app));
}

// The folders that hold page files, in load order: the UI kit, every front, every app's page folder;
// before phase 3's moves, the page folder alone.
function pageDirs(root) {
  const kit = uiKit(root);
  return [...(kit ? [kit.dir] : []), ...fronts(root).map((f) => f.dir), ...appPages(root).map((a) => a.page)];
}

// The folders that hold Playwright features (the shell's at the root, a package's in its features/).
function featureDirs(root) {
  const kit = uiKit(root);
  return ['features', ...(kit ? [`${kit.dir}/features`] : []), ...fronts(root).map((f) => `${f.dir}/features`)];
}

function frontOf(root, view) {
  const kit = uiKit(root);
  if (kit && viewsOf(root, kit.dir).includes(view)) return kit;
  return fronts(root).find((f) => viewsOf(root, f.dir).includes(view)) || null;
}


// The file of a page by its page-relative name ('select.js', 'views/run/run.js', 'index.html'),
// wherever it lives (the UI kit, a front, an app's page folder; the first that has it, in load
// order), as an absolute path; null when no layer holds it. Tests ask this instead of naming a layer.
function pageFile(root, rel) {
  for (const dir of pageDirs(root)) {
    const abs = path.join(root, dir, ...posix(rel).split('/'));
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

// Every page file of every layer (a layer's root files and its views/<view>/ files; `match` picks
// the extension, .js by default): [{ dir, rel, file }] with `file` the path from root, sorted.
function pageFiles(root, { match = /\.js$/ } = {}) {
  const out = [];
  for (const dir of pageDirs(root)) {
    const abs = path.join(root, dir);
    const filesIn = (sub) => fs.readdirSync(path.join(abs, sub), { withFileTypes: true })
      .filter((e) => e.isFile() && match.test(e.name)).map((e) => posix(path.join(sub, e.name))).sort();
    for (const rel of [...filesIn('.'), ...viewsOf(root, dir).flatMap((v) => filesIn(path.join('views', v)))]) out.push({ dir, rel, file: `${dir}/${rel}` });
  }
  return out;
}

module.exports = {
  appPages,
  composition,
  featureDirs,
  frontEngineDirs,
  frontOf,
  fronts,
  listFiles,
  packageOf,
  pageDirs,
  pageFile,
  pageFiles,
  resolvePackagePath,
  sourceDirs,
  sourceFiles,
  uiKit,
  viewsOf,
  workspaces,
};
