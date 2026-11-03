// The one rule to compare paths (#318): case-insensitive on Windows and macOS (default APFS/HFS+),
// case-sensitive on Linux. `pathKey` resolves the path with the platform's own `path` flavour
// (so slashes and a trailing separator do not matter) and lower-cases it where the file system
// ignores case; on Windows it is the key packages/engine/domains/workspace/store.js and apps/desktop/host/permissions.js always used.
// `platform` defaults to process.platform (tests pass another one).
const path = require('path');

const caseInsensitive = (platform) => platform === 'win32' || platform === 'darwin';

function pathKey(p, platform = process.platform) {
  const flavour = platform === 'win32' ? path.win32 : path.posix;
  const resolved = flavour.resolve(String(p || ''));
  return caseInsensitive(platform) ? resolved.toLowerCase() : resolved;
}

const samePath = (a, b, platform = process.platform) => pathKey(a, platform) === pathKey(b, platform);

// whether `dir` is `root` or a path inside it (never one escaping it); strict: inside only, not the root itself
function insideFolder(dir, root, { strict = false, platform = process.platform } = {}) {
  const flavour = platform === 'win32' ? path.win32 : path.posix;
  const rel = flavour.relative(pathKey(root, platform), pathKey(dir, platform));
  if (rel === '') return !strict;
  return !rel.startsWith('..') && !flavour.isAbsolute(rel);
}

module.exports = {
  caseInsensitive,
  insideFolder,
  pathKey,
  samePath,
};
