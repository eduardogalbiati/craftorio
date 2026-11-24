// The release tags of the two products (T7 of the Craftorio migration), on the commit of
// `npm run release:version` (Changesets wrote the versions and the changelogs): the app is
// v<version of @craftorio/desktop>, the tag the Deploy workflow builds the installers from and the
// app's Releases screen knows (`vX.Y.Z`); the engine is engine-v<version of @craftorio/engine>, the tag
// release-engine.yml publishes the engine package from. Only a product whose version that commit
// changed (HEAD against its parent) is tagged, and never twice, so a release that bumped only the
// engine tags only the engine. The tags are created on HEAD, never pushed: the owner (or the release
// run) pushes them. `--product` (#46) tags the chosen one only. A release run needs none of this: its
// Ship tags the product it released (packages/engine/domains/releases/releases.js).
//   node scripts/release-tags.js [--dry] [--product app|engine]
//   releaseTags({ app, engine }, { before, existing, product }) → [tags to create]
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRODUCTS = { app: 'apps/desktop', engine: 'packages/engine' };
const TAG = { app: (v) => `v${v}`, engine: (v) => `engine-v${v}` };

// now / before: { app, engine } versions on HEAD and on its parent; existing: the repository's tags
// product: only this one's tag (none: every product's)
function releaseTags(now, { before = {}, existing = [], product = null } = {}) {
  const have = new Set(existing);
  return Object.keys(TAG)
    .filter((p) => !product || p === product)
    .filter((p) => now[p] && now[p] !== before[p])
    .map((p) => TAG[p](now[p]))
    .filter((t) => !have.has(t));
}

if (require.main === module) {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const versionAt = (rev, dir) => { try { return JSON.parse(git(['show', `${rev}:${dir}/package.json`])).version; } catch { return null; } };
  const at = (rev) => Object.fromEntries(Object.entries(PRODUCTS).map(([p, dir]) => [p, versionAt(rev, dir)]));
  const asked = process.argv.indexOf('--product');
  const product = asked < 0 ? null : process.argv[asked + 1];
  if (asked >= 0 && !Object.hasOwn(PRODUCTS, product || '')) throw new Error(`--product: ${Object.keys(PRODUCTS).join(' or ')}`);
  const tags = releaseTags(at('HEAD'), { before: at('HEAD^'), existing: git(['tag', '--list']).split('\n'), product });
  if (!tags.length) console.log('release tags: nothing to tag (HEAD changes no product version, or its tags exist)');
  for (const tag of tags) {
    if (!process.argv.includes('--dry')) git(['tag', '-a', tag, '-m', tag]);
    console.log(`release tags: ${tag}${process.argv.includes('--dry') ? ' (dry run)' : ''}`);
  }
}

module.exports = {
  PRODUCTS,
  releaseTags,
};
