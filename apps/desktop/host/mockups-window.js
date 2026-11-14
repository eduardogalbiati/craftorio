// The mockup editor window (#625, D6): a BrowserWindow of its own for one project's mockup screen, opened
// from Plan & Design › Mockups (fronts/plan/views/mockups/mockup-editor.js on the app's page,
// `?window=mockup&project=<id>&slug=<slug>`). Pure of Electron, the Agents window's pattern
// (apps/desktop/host/agents-window.js): createMockupsWindow({ BrowserWindow, statePath, dirname, page?,
// devTools?, screen? }) → { open({ projectId, slug }), current() }. One window at a time (a second open
// focuses it and sends `mockups-window:show` with the asked screen); its bounds are remembered in
// `statePath` (a JSON file in the workspace). The same preload and isolation as the main window, and like
// it the window never navigates (apps/desktop/host/window-guards.js, #466).
// The canvas is a sandboxed iframe (allow-scripts, no allow-same-origin: an opaque origin without
// window.api) on the `mockup:` protocol: resolveMockupRequest(url, workspace) maps
// mockup://<projectId>/<path> to <workspace>/mockups/<projectId>/<path> (null for another scheme, a
// traversal, plain or percent-encoded, or a .git path) and MOCKUP_CSP is the header of every answer (no
// network: default-src and connect-src 'none', inline scripts and styles of the agent's markup only).
// main.js registers the scheme and serves it with protocol.handle, injecting the inspector
// (fronts/plan/views/mockups/mockup-inspector.js) and axe (D11, when axe-core is installed) into the html.
const fs = require('fs');
const path = require('path');
const {
  onScreenBounds,
  sideWindowOptions,
  windowState,
} = require('./side-window');
const { guardWindow } = require('./window-guards');

const DEFAULTS = { width: 1440, height: 900 };
const MIN = { width: 800, height: 560 };
const MOCKUP_CSP = [
  "default-src 'none'",
  "connect-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' mockup:",
  'img-src mockup: data:',
  'font-src mockup: data:',
  "form-action 'none'",
].join('; ');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
// the element inspector, run inside the canvas (the index.html page loads the same file for the editor)
const INSPECTOR = path.join(__dirname, '..', '..', '..', 'fronts', 'plan', 'views', 'mockups', 'mockup-inspector.js');

// D11: axe on every version, inside the canvas (its origin is opaque: the editor cannot reach in), with
// the screenshot checks' rules (packages/engine/domains/evidence/ui-review-checks.js AXE_RULES); the
// result goes to the editor as { type: 'mockup:axe', violations: [{ id, impact, help, nodes }] }.
// axe-core is a development dependency: without it (a packaged app) the canvas only has the inspector.
let axeScript = null;
function axeTag() {
  if (axeScript !== null) return axeScript;
  axeScript = '';
  try {
    const source = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    const { AXE_RULES } = require('@multiagent/engine/domains/evidence/ui-review-checks');
    const run = `window.addEventListener('load', async () => {
      if (!window.axe || window.parent === window) return;
      try {
        const r = await window.axe.run(document, { runOnly: { type: 'rule', values: ${JSON.stringify(Object.keys(AXE_RULES))} }, resultTypes: ['violations'] });
        window.parent.postMessage({ type: 'mockup:axe', violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length })) }, '*');
      } catch (e) { window.parent.postMessage({ type: 'mockup:axe', error: String((e && e.message) || e) }, '*'); }
    });`;
    axeScript = [source, run].map((s) => `<script>${s.replace(/<\/script/gi, '<\\/script')}</script>`).join('');
  } catch (e) { console.error('[mockups-window] no axe in the canvas:', e.message); }
  return axeScript;
}

function createMockupsWindow({ BrowserWindow, statePath, dirname, page = null, devTools = false, screen = null }) {
  let win = null;
  const { read: readState, write: writeState } = windowState(statePath, 'mockups-window');

  function current() {
    return win && !win.isDestroyed() ? win : null;
  }

  function open({ projectId = '', slug = '' } = {}) {
    const live = current();
    if (live) {
      if (live.isMinimized()) live.restore();
      live.show();
      live.focus();
      live.webContents.send('mockups-window:show', { projectId, slug });
      return live;
    }
    const bounds = onScreenBounds(readState(), MIN, screen);
    win = new BrowserWindow(sideWindowOptions({ dirname, devTools, min: MIN, defaults: DEFAULTS, bounds, title: 'Mockup · Multiagent Orchestrator' }));
    const opened = win;
    guardWindow(opened.webContents, { openExternal: (url) => require('electron').shell.openExternal(url) });
    opened.on('close', () => { try { writeState({ bounds: opened.getBounds() }); } catch { /* the window is gone */ } });
    opened.on('closed', () => { if (win === opened) win = null; });
    opened.loadFile(page || path.join(dirname, '..', 'renderer', 'index.html'), { query: { window: 'mockup', project: String(projectId), slug: String(slug) } });
    return opened;
  }

  return { open, current };
}

// mockup://<projectId>/<path> → the file under <workspace>/mockups/<projectId>/, or null
function resolveMockupRequest(url, workspace) {
  // the raw string, never new URL(): it would fold `..` and `%2e%2e` away before the check
  const m = /^mockup:\/\/([^/?#]+)(\/[^?#]*)?/i.exec(String(url ?? ''));
  if (!m || !workspace) return null;
  let segments;
  try { segments = [m[1], ...(m[2] || '').split('/')].map((s) => decodeURIComponent(s)).filter((s) => s !== ''); } catch { return null; }
  if (segments.length < 2) return null;
  if (segments.some((s) => s === '.' || s === '..' || /[\\/\0]/.test(s) || s.toLowerCase() === '.git')) return null;
  const base = path.join(workspace, 'mockups', segments[0]);
  const file = path.join(base, ...segments.slice(1));
  return file.startsWith(base + path.sep) ? file : null;
}

// What protocol.handle('mockup') answers: { status, headers, body } (the file with MOCKUP_CSP; an html
// page gets the inspector injected before </body>; 404 for a refused or missing path)
async function serveMockup(url, workspace) {
  const file = resolveMockupRequest(url, workspace);
  const missing = { status: 404, headers: { 'content-type': 'text/plain', 'content-security-policy': MOCKUP_CSP }, body: 'Not found' };
  if (!file) return missing;
  let body;
  try { body = await fs.promises.readFile(file); } catch { return missing; }
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') {
    let inspector = '';
    try { inspector = await fs.promises.readFile(INSPECTOR, 'utf8'); } catch (e) { console.error('[mockups-window] no inspector:', e.message); }
    const script = `<script>${inspector.replace(/<\/script/gi, '<\\/script')}</script>${axeTag()}`;
    const html = body.toString('utf8');
    const at = html.toLowerCase().lastIndexOf('</body>');
    body = at >= 0 ? html.slice(0, at) + script + html.slice(at) : html + script;
  }
  return { status: 200, headers: { 'content-type': TYPES[ext] || 'application/octet-stream', 'content-security-policy': MOCKUP_CSP }, body };
}

module.exports = {
  createMockupsWindow,
  MOCKUP_CSP,
  resolveMockupRequest,
  serveMockup,
};
