// The app root: the folder that holds the bundled defaults (workflows/, skills/, pipelines/, seeds/,
// fragments/), the root package.json (the app's version), the native sidecars' dev build and the UI the
// engine server serves. The engine is an npm workspace (packages/engine, phase 2 of
// docs/reorganisation-study-2026-10.md), so a module's __dirname no longer says where the app is: in a
// checkout the package sits under packages/, and in the packaged app its copy under node_modules/
// (@electron/packager dereferences the workspace link). appRoot() walks up from this file to the first
// package.json that declares `workspaces` (the repository's, or resources/app's in the asar).
// MULTIAGENT_APP_ROOT names it explicitly (another layout, an engine installed from npm). Bundled
// defaults come from here, never from a package's own folder; user data never from either (AGENTS.md).
//
//   appRoot()            the folder (cached)
//   bundledDir(name)     path.join(appRoot(), name), e.g. bundledDir('workflows')
//   appPackage()         the root package.json, parsed ({} when unreadable)

const fs = require('fs');
const path = require('path');

let cached = null;

function findRoot(from) {
  let dir = from;
  for (;;) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (pkg.workspaces) return dir;
      } catch { /* not the manifest we want */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function appRoot() {
  if (cached) return cached;
  const env = process.env.MULTIAGENT_APP_ROOT;
  cached = env ? path.resolve(env) : findRoot(__dirname);
  if (!cached) throw new Error(`The app root was not found above ${__dirname}: no package.json with "workspaces" (set MULTIAGENT_APP_ROOT).`);
  return cached;
}

const bundledDir = (name) => path.join(appRoot(), name);

function appPackage() {
  try { return JSON.parse(fs.readFileSync(path.join(appRoot(), 'package.json'), 'utf8')); } catch { return {}; }
}

module.exports = {
  appPackage,
  appRoot,
  bundledDir,
};
