// The desktop app's user data folder before the rename to Craftorio (T3). Electron names the folder
// after the app (%APPDATA%\craftorio, ~/Library/Application Support/craftorio, ~/.config/craftorio);
// an install from before the rename has its sign-in, its engine connection, its secrets, its window
// state and its speech models in the folder named multiagent-orchestrator next to it. On the first
// launch whose folder holds none of the app's own files (Electron creates the folder, and Chromium
// writes its files in it, before main.js runs: the folder itself always exists), that one is copied
// over: Chromium's caches and lock files left out, a file the new folder already has never overwritten.
// The engine connection starts on this computer, whatever the old install used: a remote one is copied
// as local, with its address and token kept for the next switch (the owner's decision, 2026-11-24).
// The old folder is left as it was. Called in main.js before anything creates the new
// folder (requestSingleInstanceLock does), never for a throwaway user data folder.
// On macOS the secrets and the account are encrypted with a keychain entry named after the app: the
// new name cannot read them, so that user signs in and enters the secrets again (Windows' DPAPI is
// per user, not per app: nothing to enter again there).
//   migrateLegacyUserData({ userData }) → the old folder copied, or null
const fs = require('fs');
const path = require('path');

const LEGACY_NAME = 'multiagent-orchestrator';
// Chromium's own, rebuilt as needed; the lock files belong to a process that is not running
// the app's own files: one of them in the new folder means the copy happened, or the user started fresh
const OWN = ['account.bin', 'engine-connection.json', 'secrets.bin', 'speech-models'];
const CONNECTION = 'engine-connection.json';
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Crashpad', 'blob_storage', 'Service Worker', 'Shared Dictionary', 'SingletonCookie', 'SingletonLock', 'SingletonSocket', 'lockfile']);

/** The old engine connection as the new folder keeps it, { text, wasRemote }; null when there is none or it cannot be read (no file is this computer too). */
function localConnection(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const saved = JSON.parse(text);
    if (saved?.mode !== 'remote') return { text, wasRemote: false };
    return { text: `${JSON.stringify({ ...saved, mode: 'local' }, null, 2)}\n`, wasRemote: true };
  } catch { return null; }
}

function migrateLegacyUserData({ userData, legacyName = LEGACY_NAME, log = () => {} } = {}) {
  if (!userData) return null;
  const legacy = path.join(path.dirname(userData), legacyName);
  if (path.resolve(legacy) === path.resolve(userData) || !fs.existsSync(legacy)) return null;
  if (OWN.some((f) => fs.existsSync(path.join(userData, f)))) return null;
  const connection = localConnection(path.join(legacy, CONNECTION));
  try {
    fs.cpSync(legacy, userData, {
      recursive: true,
      force: false,
      errorOnExist: false,
      filter: (src) => {
        const rel = path.relative(legacy, src);
        return !rel || (rel !== CONNECTION && !SKIP.has(rel.split(path.sep)[0]));
      },
    });
    // after the copy, never through it: a copy that stops halfway leaves this computer's engine, not a remote one
    if (connection) fs.writeFileSync(path.join(userData, CONNECTION), connection.text);
  } catch (e) {
    log(`user data: could not copy ${legacy} to ${userData}: ${e.message}`);
    return null;
  }
  log(`user data: copied ${legacy} to ${userData} (the folder from before the rename to Craftorio, left as it was)`);
  if (connection?.wasRemote) log('engine connection: the old install used a remote engine; this computer runs it now (the address is kept: Settings › Execution › Engine)');
  return legacy;
}

module.exports = { LEGACY_NAME, migrateLegacyUserData };
