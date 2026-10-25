// The fronts installed next to the engine and the engine-side code each one carries (phase 4 of
// docs/reorganisation-study-2026-10.md, #590). A front is a package whose package.json declares
// `multiagent.front: "<id>"` (`fronts/<id>/` in the checkout, `@multiagent/front-<id>` under
// node_modules once installed or packaged); its engine side is the folder `multiagent.engine` names
// (`engine/` by default): `channels/*.js` and `areas/*.js`, loaded next to the kernel's own
// (packages/engine/service/manifest.js loadChannels, packages/engine/service/index.js loadAreas),
// and `domains/*.js`, which only that front's engine files require. The service serves the fronts a
// composition names (`createService({ fronts })`: the desktop app's composition.js, the bin's
// `--fronts` or the web app's composition.js), every installed front without one.
//
//   installedFronts(root)         [{ id, dir, engine }] by id: dir the package folder, engine the
//                                 absolute engine-side folder or null (a UI-only front)
//   servedFronts(ids, installed)  the fronts a composition names (an unknown id is an error), or all
//   FRONT_ENGINE_DIR              'engine', the default folder name

const fs = require('fs');
const path = require('path');
const { appRoot } = require('../domains/workspace/app-root');

const FRONT_ENGINE_DIR = 'engine';

// the folders a front package may sit in: the checkout's fronts/ (first, so it wins over the
// node_modules link or copy of the same package) and the installed @multiagent packages
const PARENTS = ['fronts', path.join('node_modules', '@multiagent')];

function readPackage(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return null; }
}

function installedFronts(root = appRoot()) {
  const byId = new Map();
  for (const parent of PARENTS) {
    const abs = path.join(root, parent);
    if (!fs.existsSync(abs)) continue;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      const dir = path.join(abs, e.name);
      const pkg = readPackage(dir);
      const id = pkg?.multiagent?.front;
      if (typeof id !== 'string' || !id || byId.has(id)) continue;
      const engine = path.join(dir, pkg.multiagent.engine || FRONT_ENGINE_DIR);
      byId.set(id, { id, dir, engine: fs.existsSync(engine) ? engine : null });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function servedFronts(ids, installed = installedFronts()) {
  if (ids == null) return installed;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('The fronts to serve must be a list of front ids.');
  return ids.map((id) => {
    const front = installed.find((f) => f.id === id);
    if (!front) throw new Error(`No installed front "${id}" (installed: ${installed.map((f) => f.id).join(', ') || 'none'}).`);
    return front;
  }).sort((a, b) => a.id.localeCompare(b.id));
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
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  FRONT_ENGINE_DIR,
  installedFronts,
  servedFronts,
  serviceFiles,
};
