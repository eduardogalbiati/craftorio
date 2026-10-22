// The Agents window (#263): a second BrowserWindow with the conversational agents (the Oracle, the
// Product Owner, the Supervisor) in their own window, laid out with a rail on the left
// (src/renderer/agents-window.js on the app's page, `?window=agents&agent=<id>`). Pure of Electron:
// createAgentsWindow({ BrowserWindow, statePath, dirname, page?, devTools?, screen? }) →
// { open({ agent }), current(), setAgent(id) }. One window at a time (a second open focuses it and
// switches it to the asked agent); its bounds and the last agent shown are remembered in `statePath`
// (a JSON file in the workspace, { bounds, agent }; a missing or corrupt file means the defaults and
// the OS's placement; with `screen`, bounds on a display that is gone are dropped). The window loads
// with the main window's preload and isolation (the same window.api and service channels) and, like
// it, never navigates (src/window-guards.js, #466). Closing it never stops an agent's turn: the
// service runs the turns, the window only shows them.
const fs = require('fs');
const path = require('path');
const { guardWindow } = require('./window-guards');

const DEFAULTS = { width: 1100, height: 760 };
const MIN = { width: 640, height: 480 };

function createAgentsWindow({ BrowserWindow, statePath, dirname, page = null, devTools = false, screen = null }) {
  let win = null;
  let agent = null; // the agent the window shows (the last asked or reported)

  function readState() {
    try {
      const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return s && typeof s === 'object' ? s : {};
    } catch { return {}; }
  }
  function writeState(patch) {
    const s = { ...readState(), ...patch };
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(s, null, 2));
    } catch (e) { console.error('[agents-window] could not save its state:', e.message); }
  }

  // the saved bounds when they are sane and (with `screen`) still on a display
  function savedBounds(s) {
    const b = s.bounds;
    if (!b || ![b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n))) return null;
    if (b.width < MIN.width || b.height < MIN.height) return null;
    if (screen?.getAllDisplays) {
      const on = screen.getAllDisplays().some((d) => {
        const a = d.workArea || d.bounds;
        return b.x + b.width > a.x && b.x < a.x + a.width && b.y + b.height > a.y && b.y < a.y + a.height;
      });
      if (!on) return null;
    }
    return b;
  }

  function current() {
    return win && !win.isDestroyed() ? win : null;
  }

  function setAgent(id) {
    if (!id || typeof id !== 'string') return;
    agent = id;
    writeState({ agent });
  }

  function open({ agent: asked } = {}) {
    const state = readState();
    const id = typeof asked === 'string' && asked ? asked : agent || state.agent || 'oracle';
    const live = current();
    if (live) {
      if (live.isMinimized()) live.restore();
      live.show();
      live.focus();
      if (asked && asked !== agent) live.webContents.send('agents-window:show', { agent: id });
      setAgent(id);
      return live;
    }
    const bounds = savedBounds(state);
    win = new BrowserWindow({
      ...DEFAULTS,
      ...(bounds || {}),
      minWidth: MIN.width,
      minHeight: MIN.height,
      backgroundColor: '#0e1014',
      title: 'Agents · Multiagent Orchestrator',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        devTools,
      },
    });
    const opened = win;
    // the window never navigates (#466): external links go to the browser, as in the main window
    guardWindow(opened.webContents, { openExternal: (url) => require('electron').shell.openExternal(url) });
    opened.on('close', () => { try { writeState({ bounds: opened.getBounds(), agent }); } catch { /* the window is gone */ } });
    opened.on('closed', () => { if (win === opened) win = null; });
    setAgent(id);
    opened.loadFile(page || path.join(dirname, 'renderer', 'index.html'), { query: { window: 'agents', agent: id } });
    return opened;
  }

  return { open, current, setAgent };
}

module.exports = { createAgentsWindow };
