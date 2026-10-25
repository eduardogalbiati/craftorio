// The code version the engine process (Electron main, or the `npm run serve` server) started with,
// to tell when the code on disk changed since (#83): a window reloaded after a pull runs the new UI
// against the old process, and every new channel is missing. The version is the app version plus
// a hash of src/ (the process's sources, the renderer and the preload). The window's loaded
// version is the same hash taken when it loaded (the preload asks for the channel manifest). The
// packaged app can't change while it runs: its version is the app version.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', '..');

// The source files under `dir`, as sorted paths relative to it ('/' separators).
function sourceFiles(dir = SRC_DIR, rel = '') {
  let entries = [];
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((e) => {
    const name = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return sourceFiles(dir, name);
    return /\.(js|json|html|css)$/.test(e.name) ? [name] : [];
  }).sort();
}

// A short hash of the files' names and contents.
function hashSources(dir = SRC_DIR) {
  const h = crypto.createHash('sha1');
  for (const f of sourceFiles(dir)) {
    h.update(`${f}\0`);
    try { h.update(fs.readFileSync(path.join(dir, f))); } catch { h.update('(unreadable)'); }
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

const versionOf = ({ appVersion, isPackaged, dir }) => (isPackaged ? String(appVersion || '') : `${appVersion || ''}+${hashSources(dir)}`);

/**
 * Records the version now (the process's start). `markLoaded()` records the version a window
 * loaded (call when it loads); `check()` compares both, and the code on disk, with the process's:
 * { running, loaded, disk, changed }.
 */
function createCodeVersion({ appVersion, isPackaged = false, dir = SRC_DIR } = {}) {
  const running = versionOf({ appVersion, isPackaged, dir });
  let loaded = null;
  return {
    running,
    markLoaded() {
      loaded = isPackaged ? running : versionOf({ appVersion, isPackaged, dir });
      return loaded;
    },
    check() {
      const disk = isPackaged ? running : versionOf({ appVersion, isPackaged, dir });
      return { running, loaded, disk, changed: disk !== running || (loaded != null && loaded !== running) };
    },
  };
}

module.exports = {
  createCodeVersion,
  hashSources,
  sourceFiles,
};
