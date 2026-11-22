// The fronts installed next to the engine and the engine-side code each one carries (phase 4 of
// docs/reorganisation-study-2026-10.md, #590). A front is a package whose package.json declares
// `craftorio.front: "<id>"` (`fronts/<id>/` in the checkout, `@craftorio/front-<id>` under
// node_modules once installed or packaged); its engine side is the folder `craftorio.engine` names
// (`engine/` by default): `channels/*.js` and `areas/*.js`, loaded next to the kernel's own
// (packages/engine/service/manifest.js loadChannels, packages/engine/service/index.js loadAreas),
// and `domains/*.js`, which only that front's engine files require. The service serves the fronts a
// composition names (`createService({ fronts })`: the desktop app's composition.js, the bin's
// `--fronts` or the web app's composition.js), every installed front without one.
//
//   frontManifest(dir)            the front fields of a package folder: { id, engine } (id null when
//                                 the package declares no front); throws on an unreadable package.json
//                                 or a `craftorio.front` that is not an id (a non-empty lower-case
//                                 name: letters, digits, dashes, usable as a layer and folder name)
//   installedFronts(root)         [{ id, name, dir, engine }] by id: dir the package folder, engine the
//                                 absolute engine-side folder or null (a UI-only front). The same
//                                 package seen twice (the workspace link under node_modules and its
//                                 folder under fronts/, or the packaged copies: the same `name`) counts
//                                 once; two different packages claiming one id fail at startup
//   servedFronts(ids, installed)  the fronts a composition names (an unknown or a repeated id is an
//                                 error), or all of them
//   serviceFiles(dir, fronts, sub) the kernel's and the served fronts' files of `channels` or `areas`,
//                                 in one order by file name
//   FRONT_ENGINE_DIR              'engine', the default folder name
// Orders are by code unit (`<`), as `Array.prototype.sort()` without a comparator: the load order
// never depends on the process locale (localeCompare would put chain.js after gates.js under cs).

const fs = require('fs');
const path = require('path');
const { appRoot } = require('../domains/workspace/app-root');

const FRONT_ENGINE_DIR = 'engine';
// T4 (the monorepo split): the engine keeps the engine side of its own fronts in its package,
// packages/engine/fronts/<id>/, so a front package holds screens only; a front package that carries
// its own engine side (craftorio.engine, a front from outside this repository) is read from there
const ENGINE_FRONTS = path.join(__dirname, '..', 'fronts');
const engineSideOf = (id, dir, engineDir) => {
  const own = path.join(ENGINE_FRONTS, id);
  if (fs.existsSync(own)) return own;
  const carried = path.join(dir, engineDir);
  return fs.existsSync(carried) ? carried : null;
};
const FRONT_ID = /^[a-z][a-z0-9-]*$/;

// the folders a front package may sit in: the checkout's fronts/ (first, so it wins over the
// node_modules link or copy of the same package) and the installed @craftorio packages
const PARENTS = ['fronts', path.join('node_modules', '@craftorio')];

const byCodeUnit = (key) => (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

function frontManifest(dir) {
  const file = path.join(dir, 'package.json');
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file}: cannot be read as a package manifest (${e.message}).`); }
  const front = pkg?.craftorio?.front;
  if (front === undefined) return { id: null, name: pkg?.name || null, engine: FRONT_ENGINE_DIR };
  if (typeof front !== 'string' || !FRONT_ID.test(front)) throw new Error(`${file}: craftorio.front must be a front id (lower-case letters, digits and dashes), got ${JSON.stringify(front)}.`);
  const engine = pkg.craftorio.engine === undefined ? FRONT_ENGINE_DIR : pkg.craftorio.engine;
  if (typeof engine !== 'string' || !engine) throw new Error(`${file}: craftorio.engine must name a folder.`);
  return { id: front, name: pkg.name || null, engine };
}

function installedFronts(root = appRoot()) {
  const byId = new Map();
  for (const parent of PARENTS) {
    const abs = path.join(root, parent);
    if (!fs.existsSync(abs)) continue;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      const dir = path.join(abs, e.name);
      if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
      const { id, name, engine: engineDir } = frontManifest(dir);
      if (!id) continue;
      const seen = byId.get(id);
      if (seen) {
        if (seen.name && seen.name === name) continue; // the same package, linked or copied
        throw new Error(`Two packages declare the front "${id}": ${seen.dir} (${seen.name || 'no name'}) and ${dir} (${name || 'no name'}).`);
      }
      byId.set(id, { id, name, dir, engine: engineSideOf(id, dir, engineDir) });
    }
  }
  return [...byId.values()].sort(byCodeUnit((f) => f.id));
}

function servedFronts(ids, installed = installedFronts()) {
  if (ids == null) return installed;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('The fronts to serve must be a list of front ids.');
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice) throw new Error(`The front "${twice}" is named twice in the composition.`);
  return ids.map((id) => {
    const front = installed.find((f) => f.id === id);
    if (!front) throw new Error(`No installed front "${id}" (installed: ${installed.map((f) => f.id).join(', ') || 'none'}).`);
    return front;
  }).sort(byCodeUnit((f) => f.id));
}

// The js files of one folder of the kernel and of each served front (`sub`: 'channels' or
// 'areas'), sorted by file name across them, [{ file, name, from }]: the load order is the one a
// single folder had, so the manifest's order and the areas' creation order do not depend on which
// package holds a file. A name two folders both hold is refused: a channel file keeps its name when
// it moves to a front, and the manifest and docs/agents/channels.md group entries by it.
function serviceFiles(kernelDir, fronts, sub) {
  const sources = [{ dir: kernelDir, from: 'engine' }, ...fronts.filter((f) => f.engine).map((f) => ({ dir: path.join(f.engine, sub), from: f.id }))];
  const files = [];
  for (const { dir, from } of sources) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const twice = files.find((x) => x.name === name);
      if (twice) throw new Error(`Service ${sub}: ${name} exists in ${twice.from} and in ${from}; file names are unique across the engine and the fronts.`);
      files.push({ file: path.join(dir, name), name, from });
    }
  }
  return files.sort(byCodeUnit((x) => x.name));
}

module.exports = {
  ENGINE_FRONTS,
  FRONT_ENGINE_DIR,
  frontManifest,
  installedFronts,
  servedFronts,
  serviceFiles,
};
