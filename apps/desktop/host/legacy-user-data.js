// The desktop app's user data folder before the rename to Craftorio (T3). Electron names the folder
// after the app (%APPDATA%\craftorio, ~/Library/Application Support/craftorio, ~/.config/craftorio);
// an install from before the rename has its sign-in, its engine connection, its secrets, its window
// state and its speech models in the folder named multiagent-orchestrator next to it. On the first
// launch with no folder of the new name, that one is copied over (Chromium's caches and lock files
// left out), and the old folder is left as it was. Called in main.js before anything creates the new
// folder (requestSingleInstanceLock does), never for a throwaway user data folder.
// On macOS the secrets and the account are encrypted with a keychain entry named after the app: the
// new name cannot read them, so that user signs in and enters the secrets again (Windows' DPAPI is
// per user, not per app: nothing to enter again there).
//   migrateLegacyUserData({ userData }) → the old folder copied, or null
const fs = require('fs');
const path = require('path');

const LEGACY_NAME = 'multiagent-orchestrator';
// Chromium's own, rebuilt as needed; the lock files belong to a process that is not running
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Crashpad', 'blob_storage', 'Service Worker', 'Shared Dictionary', 'SingletonCookie', 'SingletonLock', 'SingletonSocket', 'lockfile']);

function migrateLegacyUserData({ userData, legacyName = LEGACY_NAME, log = () => {} } = {}) {
  if (!userData) return null;
  const legacy = path.join(path.dirname(userData), legacyName);
  if (path.resolve(legacy) === path.resolve(userData) || fs.existsSync(userData) || !fs.existsSync(legacy)) return null;
  try {
    fs.cpSync(legacy, userData, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(legacy, src);
        return !rel || !SKIP.has(rel.split(path.sep)[0]);
      },
    });
  } catch (e) {
    log(`user data: could not copy ${legacy} to ${userData}: ${e.message}`);
    return null;
  }
  log(`user data: copied ${legacy} to ${userData} (the folder from before the rename to Craftorio, left as it was)`);
  return legacy;
}

module.exports = { LEGACY_NAME, migrateLegacyUserData };
