// The one rule to compare paths (#318): case-insensitive on Windows and macOS (default APFS/HFS+),
// case-sensitive on Linux. `pathKey` resolves the path with the platform's own `path` flavour
// (so slashes and a trailing separator do not matter) and lower-cases it where the file system
// ignores case; on Windows it is the key src/domains/workspace/store.js and src/host/permissions.js always used.
// `platform` defaults to process.platform (tests pass another one).
const path = require('path');

const caseInsensitive = (platform) => platform === 'win32' || platform === 'darwin';

function pathKey(p, platform = process.platform) {
  const flavour = platform === 'win32' ? path.win32 : path.posix;
  const resolved = flavour.resolve(String(p || ''));
  return caseInsensitive(platform) ? resolved.toLowerCase() : resolved;
}

const samePath = (a, b, platform = process.platform) => pathKey(a, platform) === pathKey(b, platform);

module.exports = {
  caseInsensitive,
  pathKey,
  samePath,
};
