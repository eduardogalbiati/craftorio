// The release tags of the two products (T7 of the Craftorio migration), on the commit of
// `npm run release:version` (Changesets wrote the versions and the changelogs): the app is
// v<version of @craftorio/desktop>, the tag the Deploy workflow builds the installers from and the
// app's Releases screen knows (`vX.Y.Z`); the engine is engine-v<version of @craftorio/engine>, the tag
// release-engine.yml publishes the engine package from. Only a product whose version that commit
// changed (HEAD against its parent) is tagged, and never twice, so a release that bumped only the
// engine tags only the engine. The tags are created on HEAD, never pushed: the owner (or the release
// run) pushes them.
//   node scripts/release-tags.js [--dry]
//   releaseTags({ app, engine }, { before, existing }) → [tags to create]
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRODUCTS = { app: 'apps/desktop', engine: 'packages/engine' };
const TAG = { app: (v) => `v${v}`, engine: (v) => `engine-v${v}` };

// now / before: { app, engine } versions on HEAD and on its parent; existing: the repository's tags
function releaseTags(now, { before = {}, existing = [] } = {}) {
  const have = new Set(existing);
  return Object.keys(TAG)
    .filter((p) => now[p] && now[p] !== before[p])
    .map((p) => TAG[p](now[p]))
    .filter((t) => !have.has(t));
}

if (require.main === module) {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const versionAt = (rev, dir) => { try { return JSON.parse(git(['show', `${rev}:${dir}/package.json`])).version; } catch { return null; } };
  const at = (rev) => Object.fromEntries(Object.entries(PRODUCTS).map(([p, dir]) => [p, versionAt(rev, dir)]));
  const tags = releaseTags(at('HEAD'), { before: at('HEAD^'), existing: git(['tag', '--list']).split('\n') });
  if (!tags.length) console.log('release tags: nothing to tag (HEAD changes no product version, or its tags exist)');
  for (const tag of tags) {
    if (!process.argv.includes('--dry')) git(['tag', '-a', tag, '-m', tag]);
    console.log(`release tags: ${tag}${process.argv.includes('--dry') ? ' (dry run)' : ''}`);
  }
}

module.exports = { releaseTags };
