// What the app's side windows share (the Agents window #263, the mockup editor #625): the saved bounds
// check and the main window's preload and isolation. Pure of Electron.
// sideWindowOptions({ dirname, devTools, min, defaults, bounds, title }) → the BrowserWindow options
// (the same preload, contextIsolation on, no nodeIntegration); onScreenBounds(state, min, screen) →
// state.bounds when sane, at least `min` and (with `screen`) still on a display, else null.
const path = require('path');

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

function sideWindowOptions({ dirname, devTools = false, min, defaults, bounds = null, title }) {
  return {
    ...defaults,
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
};
