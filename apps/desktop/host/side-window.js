// What the app's side windows share (the Agents window #263, the mockup editor #625): the saved bounds
// check and the main window's preload and isolation. Pure of Electron.
// sideWindowOptions({ dirname, devTools, min, defaults, bounds, title }) → the BrowserWindow options
// (the same preload, contextIsolation on, no nodeIntegration); onScreenBounds(state, min, screen) →
// state.bounds when sane, at least `min` and (with `screen`) still on a display, else null;
// windowState(statePath, tag) → { read(), write(patch) } (the window's JSON state file: {} when missing
// or corrupt; write merges, makes the folder and logs a failure with `tag`).
const fs = require('fs');
const path = require('path');

function windowState(statePath, tag) {
  function read() {
    try {
      const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return s && typeof s === 'object' ? s : {};
    } catch { return {}; }
  }
  function write(patch) {
    const s = { ...read(), ...patch };
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(s, null, 2));
    } catch (e) { console.error(`[${tag}] could not save its state:`, e.message); }
  }
  return { read, write };
}

function onScreenBounds(state, min, screen) {
  const b = state && state.bounds;
  if (!b || ![b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n))) return null;
  if (b.width < min.width || b.height < min.height) return null;
  if (screen?.getAllDisplays) {
    const on = screen.getAllDisplays().some((d) => {
      const a = d.workArea || d.bounds;
      return b.x + b.width > a.x && b.x < a.x + a.width && b.y + b.height > a.y && b.y < a.y + a.height;
    });
    if (!on) return null;
  }
  return b;
}

// The window icon (apps/desktop/assets): Windows takes the .ico and Linux the .png, also when the app runs from the
// source code, where Electron's own icon showed otherwise; macOS uses the bundle's icon (and app.dock from source).
const WINDOW_ICON = { win32: 'icon.ico', linux: 'icon.png' };
function windowIcon(platform = process.platform) {
  return WINDOW_ICON[platform] ? path.join(__dirname, '..', 'assets', WINDOW_ICON[platform]) : null;
}

function sideWindowOptions({ dirname, devTools = false, min, defaults, bounds = null, title }) {
  const icon = windowIcon();
  return {
    ...defaults,
    ...(icon ? { icon } : {}),
    ...(bounds || {}),
    minWidth: min.width,
    minHeight: min.height,
    backgroundColor: '#0e1014',
    title,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools,
    },
  };
}

module.exports = {
  onScreenBounds,
  sideWindowOptions,
  windowIcon,
  windowState,
};
