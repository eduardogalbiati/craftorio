// After Changesets wrote the versions (T7 of the Craftorio migration): the app's version is the
// version of @craftorio/desktop, and the packaged app reports the root package.json's (Electron's
// app.getVersion, the packager's appVersion): the root takes the desktop app's version. Run by
// `npm run release:version` right after `changeset version`.
//   node scripts/release-version-sync.js   → prints the version the root has
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

function syncAppVersion(root = ROOT) {
  const file = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const app = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8')).version;
  if (pkg.version !== app) fs.writeFileSync(file, `${JSON.stringify({ ...pkg, version: app }, null, 2)}\n`);
  return app;
}

if (require.main === module) console.log(`app version: ${syncAppVersion()} (root package.json, from @craftorio/desktop ${read('apps/desktop/package.json').version})`);

module.exports = { syncAppVersion };
