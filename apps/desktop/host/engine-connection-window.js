// The desktop app's windows for the engine connection (rules in apps/desktop/host/engine-connection.js): in remote
// mode the main window is the remote engine's page, and the connection page
// (apps/desktop/renderer/connection/, preload apps/desktop/host/engine-connection-preload.js) sets where the engine runs.
// Pure of Electron, like apps/desktop/host/agents-window.js: createEngineConnection({ BrowserWindow, ipcMain, shell,
// session, dirname, store, version, ... }) → { startRemote(decision), openPage(), window() }.
//
// - The remote window loads `<url>/` with only the capture preload (apps/desktop/host/remote-window-preload.js,
//   #751: window.desktopCapture.capturePage(), answered for that window only; remote content: context
//   isolation, no Node, sandboxed) in its own session (PARTITION): the token goes in an `Authorization: Bearer` header
//   to the engine's origin only (webRequest.onBeforeSendHeaders), never in an address (#480); only
//   the engine's origin loads in it, other http(s) links open in the system browser, and the engine's
//   page asks for the connection page by opening CONNECTION_PATH (Settings › Execution › Engine, api-http.js).
// - Saving a plain-http address outside loopback and Tailscale needs the page's "Allow an insecure
//   connection" (insecure: true, kept in the setting); without it Save answers why, untested (#480).
// - The engine is tested (GET /api/version) before its window opens; an engine that cannot be
//   reached, a refused token or a page that does not load replaces the window with the connection
//   page and the reason (Retry / Change the address / Use this computer), so the app is never locked out.
// - The page's channels (engine-connection:*) answer only the page's own window. The token never
//   goes to a page: the page gets connectionView. Saving tests first, then writes the setting and
//   restarts the app (relaunch): switching mode is always a restart.
// - The page always has the OS title bar and fits the screen. Its Cancel (Esc), or the window's X,
//   closes it and changes nothing; when it is the app's only window (the engine failed) Cancel reads
//   Quit and closing it quits the app, so the app is never left running without a window.

const path = require('path');
const conn = require('./engine-connection');
const { guardWindow } = require('./window-guards');

const PAGE_SIZE = { width: 640, height: 700 };

/**
 * @param store       { read() → connection, write(connection), encryptionAvailable?(), tokenStorage?() }
 *                    (the setting in the user data folder; the last two let the page warn on a plain token)
 * @param version     { app, contract } of this app (the connection test compares the contracts)
 * @param mode        'local' | 'remote': where this process's engine runs
 * @param windowOptions  the main window's size, colour and icon (the remote window uses them)
 * @param mainWindow  () → the local main window (the page opens over it), in local mode
 * @param prepareRestart  () → throws when the app cannot restart now (runs in progress here)
 * @param relaunch    () → restarts the app
 * @param env         the process environment decideMode reads (MULTIAGENT_ENGINE, MULTIAGENT_SIMULATION_ONLY)
 * @param screen      Electron's screen (optional): the page fits the display it opens on
 * @param quit        () → quits the app (the page closed while it was the app's only window)
 */
function createEngineConnection({
  BrowserWindow, ipcMain, shell, session, dirname, store, version, mode,
  windowOptions = {}, mainWindow = () => null, prepareRestart = () => {}, relaunch,
  fetch: fetchImpl = globalThis.fetch, devTools = false, env = {}, screen = null, quit = () => {},
}) {
  let remoteWin = null;
  let page = null;
  let failure = null; // why the remote engine's window is not shown: { reason, message, url }
  let sessionReady = false;
  const live = (w) => (w && !w.isDestroyed() ? w : null);
  const test = (address, token) => conn.testConnection({ address, token, fetch: fetchImpl, localContract: version.contract });

  // ---- the connection page ----------------------------------------------------------------
  // the window the page opens over (modal), or null: on its own when the engine's window failed
  const pageParent = () => (failure ? null : live(remoteWin) || live(mainWindow()));
  // no other window of the app: the page's Cancel is Quit, and closing it quits the app
  const pageAlone = () => !live(remoteWin) && !live(mainWindow());

  // the page's size, within the screen it opens on (a small notebook screen keeps its title bar
  // and its buttons in view; the page scrolls, its footer stays)
  function pageBounds(parent) {
    const area = (parent && screen?.getDisplayMatching?.(parent.getBounds())?.workArea) || screen?.getPrimaryDisplay?.()?.workArea;
    if (!area) return { ...PAGE_SIZE };
    return { width: Math.min(PAGE_SIZE.width, area.width - 24), height: Math.min(PAGE_SIZE.height, area.height - 24) };
  }

  // lang: the interface language of the page that asked (#329), a language code or nothing
  function openPage({ lang = null } = {}) {
    const open = live(page);
    if (open) {
      open.webContents.send('engine-connection:changed');
      if (open.isMinimized()) open.restore();
      open.focus();
      return open;
    }
    const parent = pageParent();
    const w = new BrowserWindow({
      ...pageBounds(parent),
      minWidth: 420,
      minHeight: 360,
      ...(parent ? { parent, modal: true } : {}),
      // always the OS title bar with its close button: closing is Cancel (Quit when it is alone)
      frame: true,
      closable: true,
      resizable: true,
      backgroundColor: windowOptions.backgroundColor || '#0e1014',
      title: 'Engine connection · Craftorio',
      ...(windowOptions.icon ? { icon: windowOptions.icon } : {}),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(dirname, 'engine-connection-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools,
      },
    });
    page = w;
    // the page never navigates (#466): http(s) links go to the browser
    guardWindow(w.webContents, { openExternal: (url) => shell.openExternal(url) });
    // the page closed by the user (X, Cancel, Quit): over a window nothing changes; alone, the app
    // quits (never left running without a window). A page replaced by another one is not this.
    w.on('closed', () => {
      if (page !== w) return;
      page = null;
      if (pageAlone()) quit();
    });
    const query = typeof lang === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang) ? { query: { lang } } : undefined;
    w.loadFile(path.join(dirname, '..', 'renderer', 'connection', 'connection.html'), query);
    return w;
  }

  // the remote engine's window goes, the connection page says why (created first: the app keeps a window)
  function fail(why) {
    failure = why;
    const old = live(remoteWin);
    remoteWin = null;
    const replaced = live(page);
    page = null;
    replaced?.destroy();
    openPage();
    old?.destroy();
  }

  // ---- the remote engine's window ---------------------------------------------------------
  // the engine's origin of a request (its WebSocket's ws(s):// counts as http(s)://), or null
  const requestOrigin = (url) => {
    try { return new URL(String(url).replace(/^ws(s?):/i, 'http$1:')).origin; } catch { return null; }
  };

  function prepareSession(origin, token) {
    const ses = session.fromPartition(conn.PARTITION);
    if (!sessionReady) {
      ses.setUserAgent(`${ses.getUserAgent()} ${conn.CLIENT_MARK}`);
      sessionReady = true;
    }
    ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(conn.allowRemotePermission(permission, details?.requestingUrl, origin)));
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => conn.allowRemotePermission(permission, requestingOrigin || wc?.getURL(), origin));
    // the token as `Authorization: Bearer`, to the engine's origin only, never in an address (#480);
    // registered again at each start (Retry may bring another engine or token)
    ses.webRequest?.onBeforeSendHeaders((details, callback) => {
      if (!token || requestOrigin(details.url) !== origin) return callback({ requestHeaders: details.requestHeaders });
      const headers = Object.fromEntries(Object.entries(details.requestHeaders || {}).filter(([k]) => k.toLowerCase() !== 'authorization'));
      callback({ requestHeaders: { ...headers, Authorization: `Bearer ${token}` } });
    });
  }

  // what a link or a navigation of the remote window does (conn.routeUrl): true when it stays
  function follow(url, origin) {
    const where = conn.routeUrl(url, origin);
    if (where === 'connection') openPage({ lang: new URL(url).searchParams.get('lang') });
    else if (where === 'external') shell.openExternal(url);
    return where === 'stay';
  }

  function openRemoteWindow(d) {
    const origin = new URL(d.url).origin;
    prepareSession(origin, d.token);
    const title = `Craftorio · engine on ${d.host}`;
    const w = new BrowserWindow({
      ...windowOptions,
      title,
      webPreferences: {
        partition: conn.PARTITION,
        preload: path.join(dirname, 'remote-window-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools,
      },
    });
    remoteWin = w;
    failure = null;
    // the title says which engine this window shows, whatever the page calls itself
    w.on('page-title-updated', (e) => e.preventDefault());
    w.webContents.setWindowOpenHandler(({ url }) => {
      follow(url, origin);
      return { action: 'deny' };
    });
    w.webContents.on('will-navigate', (e, url) => { if (!follow(url, origin)) e.preventDefault(); });
    w.webContents.on('will-attach-webview', (e) => e.preventDefault()); // #466: no webview, in any window
    // a redirect leaving the engine's origin goes no further (the server only redirects to itself)
    w.webContents.on('will-redirect', (e, url) => { if (conn.routeUrl(url, origin) !== 'stay') e.preventDefault(); });
    w.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      // -3: a navigation replaced by another one (a redirect, a reload), not a failure
      if (isMainFrame && code !== -3 && remoteWin === w) fail({ reason: 'unreachable', url: d.url, message: `The engine's page did not load from ${d.host}: ${desc} (${code}).` });
    });
    w.webContents.on('did-navigate', (_e, _url, status) => {
      if (status >= 400 && remoteWin === w) {
        fail({ reason: status === 401 ? 'token' : 'http', url: d.url, status, message: status === 401 ? `${d.host} refused the token: copy MULTIAGENT_SERVER_TOKEN from the engine's computer again.` : `${d.host} answered HTTP ${status}.` });
      }
    });
    w.on('closed', () => { if (remoteWin === w) remoteWin = null; });
    w.loadURL(`${d.url}/`);
    return w;
  }

  // Remote mode at start (and Retry): test the engine, then show its window or the page with why not.
  async function startRemote(decision) {
    if (decision.error) return fail({ reason: 'setting', url: decision.url || null, message: decision.error });
    const t = await test(decision.url, decision.token);
    if (!t.ok) return fail({ reason: t.reason, url: decision.url, message: t.message });
    return openRemoteWindow(decision);
  }

  // ---- the page's channels ----------------------------------------------------------------
  const fromPage = (e) => !!live(page) && e.sender === page.webContents;
  const handle = (channel, fn) => ipcMain.handle(channel, (e, arg) => {
    if (!fromPage(e)) throw new Error('Only the engine connection page can use this channel.');
    return fn(arg || {});
  });

  // #751 the remote window's own pixels (remote-window-preload.js), for that window only: the
  // capture the local app gets from window:capture (main.js)
  ipcMain.handle('engine-connection:capture', async (e) => {
    if (!live(remoteWin) || e.sender !== remoteWin.webContents) throw new Error('Only the remote engine window can capture itself.');
    return (await e.sender.capturePage()).toDataURL();
  });

  handle('engine-connection:state', () => {
    const saved = store.read();
    return {
      mode,
      saved: conn.connectionView(saved, { tokenStorage: store.tokenStorage?.() }),
      // false: a token saved now would be stored unencrypted (the page warns, #479)
      encryptionAvailable: store.encryptionAvailable ? !!store.encryptionAvailable() : true,
      failure,
      app: version.app,
      // the engine this window shows, in remote mode
      remoteHost: mode === 'remote' && !failure ? conn.parseAddress(saved.address).host || null : null,
      // the app's only window: its Cancel reads Quit
      alone: pageAlone(),
    };
  });

  // why an address is not encrypted (null when it is): the page shows the opt-in from it, the one rule (#480)
  handle('engine-connection:check', ({ address }) => ({ insecure: conn.insecureAddress(conn.parseAddress(address)) }));

  // a blank token tests with the saved one (the page never holds it); an unencrypted address needs
  // the opt-in before any token goes out, like Save (#480)
  handle('engine-connection:test', ({ address, token, insecure }) => {
    const parsed = conn.parseAddress(address);
    const unencrypted = conn.insecureAddress(parsed);
    if (unencrypted && insecure !== true) return { ok: false, reason: 'insecure', url: parsed.url, host: parsed.host, message: unencrypted };
    return test(address, String(token || '').trim() || store.read().token);
  });

  handle('engine-connection:save', async ({ mode: want, address, token, insecure }) => {
    const saved = store.read();
    if (want !== 'remote') {
      // the address and token stay saved, for the next switch
      if (mode === 'local') {
        if (saved.mode === 'remote') store.write({ ...saved, mode: 'local' });
        return { saved: true, restarting: false, message: 'This computer runs the engine.' };
      }
      prepareRestart();
      store.write({ ...saved, mode: 'local' });
      relaunch();
      return { saved: true, restarting: true };
    }
    const parsed = conn.parseAddress(address);
    // an unencrypted address needs the explicit opt-in, before the engine is even contacted (#480)
    const unencrypted = conn.insecureAddress(parsed);
    if (unencrypted && insecure !== true) return { saved: false, test: { ok: false, reason: 'insecure', url: parsed.url, host: parsed.host, message: unencrypted } };
    const tok = String(token || parsed.token || '').trim() || saved.token;
    const t = await test(address, tok);
    if (!t.ok) return { saved: false, test: t };
    // runs in progress on this computer: refused before anything is written
    prepareRestart();
    store.write({ mode: 'remote', address: t.url, token: tok, ...(unencrypted ? { insecure: true } : {}) });
    relaunch();
    return { saved: true, restarting: true, test: t };
  });

  handle('engine-connection:retry', async () => {
    failure = null;
    const p = live(page);
    const decision = conn.decideMode({ connection: store.read(), env });
    if (decision.mode !== 'remote') { relaunch(); return { ok: true }; }
    const t = decision.error ? null : await test(decision.url, decision.token);
    if (decision.error || !t.ok) {
      failure = { reason: decision.error ? 'setting' : t.reason, url: decision.url || null, message: decision.error || t.message };
      return { ok: false, failure };
    }
    openRemoteWindow(decision);
    if (page === p) page = null;
    p?.destroy();
    return { ok: true };
  });

  // Cancel (over a window: nothing changes) or Quit (the page alone: the app quits, see openPage)
  handle('engine-connection:close', () => {
    live(page)?.close();
    return { closed: true };
  });

  return {
    startRemote,
    openPage,
    // the window to bring forward (a second copy of the app was started)
    window: () => live(remoteWin) || live(page),
  };
}

module.exports = { createEngineConnection };
