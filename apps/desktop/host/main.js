// Electron main process: the window, the workspace dialog, desktop-only actions (native dialogs,
// clipboard, opening files and folders, external console windows) and the IPC transport to the
// engine service (packages/engine/service), which holds everything else. With a remote engine set (Settings ›
// Execution › Engine, apps/desktop/host/engine-connection.js) the process runs no engine and opens no workspace:
// its window shows the engine another computer serves (apps/desktop/host/engine-connection-window.js).

const path = require('path');
const os = require('os');
const fs = require('fs');
const {
  execFile,
  spawn,
} = require('child_process');
const {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  powerSaveBlocker,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
} = require('electron');
const { createAgentsWindow } = require('./agents-window');
const { resolveCommand } = require('@multiagent/engine/engine/providers');
const {
  externalTerminal,
  NO_TERMINAL,
  terminalLaunch,
} = require('./external-terminal');
const { pathKey } = require('@multiagent/engine/domains/machine/platform-paths');
const { psQuote } = require('@multiagent/engine/domains/machine/shell');
const I18n = require('@multiagent/shared/i18n');
const { t } = I18n;
const workspace = require('@multiagent/engine/domains/workspace/workspace');
const localPreview = require('@multiagent/engine/domains/local/local-preview');
const runOwner = require('@multiagent/engine/domains/run/run-owner');
const { allowPermission } = require('./permissions');
const { guardIpc } = require('./ipc-guard');
const { guardWindow } = require('./window-guards');
const { checkOpenable } = require('./open-guard');
const { createService } = require('@multiagent/engine/service');
const { createControlChannel } = require('@multiagent/engine/control');
const { nativeBinaryPath } = require('@multiagent/engine/domains/machine/native-bin');
const {
  authChannels,
  PUSHED_EVENTS,
} = require('@multiagent/engine/service/manifest');
const { contractHash } = require('@multiagent/engine/service/contract');
const engineConnection = require('./engine-connection');
const { createEngineConnection } = require('./engine-connection-window');
const { createAuth, fileStorage } = require('@multiagent/engine/domains/account/auth');
const authConfig = require('@multiagent/engine/domains/account/auth-config');
const { createKeepAwake } = require('./keep-awake');
const mainLog = require('@multiagent/engine/domains/workspace/main-log');

// the last lines of this process's console, for a finding's context (#361)
mainLog.capture();

// The packaged app doesn't accept Chromium's remote debugging switches (the Node inspector is
// already disabled by a fuse, see apps/desktop/scripts/package.js)
if (app.isPackaged && ['remote-debugging-port', 'remote-debugging-pipe'].some((s) => app.commandLine.hasSwitch(s))) {
  app.exit(1);
}

// A copy started by Run locally at a gate (packages/engine/domains/local/local-preview.js) keeps its own user data folder,
// so it never shares the owner's sign-in or window state
if (!app.isPackaged && process.env.MULTIAGENT_USER_DATA) app.setPath('userData', path.resolve(process.env.MULTIAGENT_USER_DATA));

// ---- one app per workspace (#112) ------------------------------------------------------------
// Two copies on one workspace judge each other's runs as interrupted and start them twice.
// - An app started by hand from a run's worktree (<workspace>/worktrees/<id>) opens a scratch
//   workspace with its own user data folder, simulations only, as Run locally does.
// - The owner's app (no MULTIAGENT_WORKSPACE) holds Electron's single-instance lock for its user
//   data folder; a second copy gets a user data folder of its own and offers a scratch copy or quit.
// - Whatever the user data folder, the app locks the workspace it opens (<workspace>/.lock with a
//   heartbeat, packages/engine/domains/run/run-owner.js); a locked workspace is never opened read-write by a second copy.
// Scratch copies (screenshots, Run locally, smoke checks, tests) have their own workspaces: unaffected.
const APP_DIR = path.join(__dirname, '..', '..', '..');
// true when the user data folder is a throwaway one (MULTIAGENT_USER_DATA, or a scratch one chosen below)
let scratchUserData = !!process.env.MULTIAGENT_USER_DATA;
if (!app.isPackaged && !process.env.MULTIAGENT_WORKSPACE) {
  const scratch = localPreview.worktreeAppScratch(APP_DIR);
  if (scratch) {
    process.env.MULTIAGENT_WORKSPACE = scratch.workspace;
    process.env.MULTIAGENT_SIMULATION_ONLY = '1';
    if (!process.env.MULTIAGENT_USER_DATA) { app.setPath('userData', scratch.userData); scratchUserData = true; }
    console.log(`Started from a worktree of ${scratch.owner}: using the scratch workspace ${scratch.workspace} (simulations only).`);
  }
}
// An agent's check started without its run's scratch workspace (#120): simulations only never open
// the owner's workspace (workspace.resolveWorkspace) nor the owner's user data (sign-in, #112).
// Agents of a run with a worktree get MULTIAGENT_WORKSPACE and MULTIAGENT_USER_DATA from the engine.
if (!app.isPackaged && !process.env.MULTIAGENT_WORKSPACE && process.env.MULTIAGENT_SIMULATION_ONLY === '1') {
  const scratch = workspace.simulationWorkspace();
  process.env.MULTIAGENT_WORKSPACE = scratch.workspace;
  if (!process.env.MULTIAGENT_USER_DATA) { app.setPath('userData', scratch.userData); scratchUserData = true; }
  console.log(`Simulation only: using the scratch workspace ${scratch.workspace}.`);
}
// A simulation on a throwaway user data folder never reaches the owner's keychain: on macOS,
// safeStorage (the account session, the engine connection) asks for "Chromium Safe Storage" at every
// launch of a scratch copy (the smoke, the screenshots, each E2E scenario), and the dialog blocks the
// run until it is dismissed. Chromium's mock keychain answers in memory instead: a scratch copy's
// account.bin is throwaway anyway. Never on the owner's own user data (a dev launch with
// MULTIAGENT_SIMULATION_ONLY and a workspace of its own but no MULTIAGENT_USER_DATA keeps the real
// keychain, so its account.bin stays readable by the next normal launch), never in the packaged app.
if (!app.isPackaged && process.env.MULTIAGENT_SIMULATION_ONLY === '1' && scratchUserData) app.commandLine.appendSwitch('use-mock-keychain');
const secondCopy = !process.env.MULTIAGENT_WORKSPACE && !app.requestSingleInstanceLock();
if (secondCopy) {
  const dir = workspace.resolveWorkspace().dir || os.tmpdir();
  app.setPath('userData', path.join(dir, 'local-previews', `app-${process.pid}`, 'user-data'));
}
let workspaceLock = null;

let win = null;

// ---- account (sign-in; it only counts the people using the app) ------------------------------
// The session is machine- and OS-user-specific, so it lives in the app's user data folder
// (%APPDATA%), not in the workspace, encrypted with the OS (DPAPI on Windows) when safeStorage is
// available; without it (Linux without a keyring: basic_text) it is plain text, and a warning is
// logged (SEC-19, SECURITY.md). Created once the app is ready: safeStorage can't decrypt before that, and the Supabase client
// reads the stored session as soon as it is created (reading it too early lost the session and
// asked for a new sign-in at every start).
const devEnv = app.isPackaged ? {} : process.env;
const authOff = devEnv.MULTIAGENT_AUTH === 'off';
let auth = null;
function createAccount() {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('account: this computer offers no encryption (safeStorage): the account session in account.bin is stored as plain text.');
  }
  auth = createAuth({
    url: authOff ? '' : devEnv.MULTIAGENT_SUPABASE_URL || authConfig.url,
    key: authOff ? '' : devEnv.MULTIAGENT_SUPABASE_KEY || authConfig.publishableKey,
    providers: authConfig.providers,
    // development builds without a Supabase project run without sign-in; the packaged app never does
    required: app.isPackaged || (!!(authConfig.url || devEnv.MULTIAGENT_SUPABASE_URL) && !authOff),
    storage: fileStorage(path.join(app.getPath('userData'), 'account.bin'), {
      encrypt: (s) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s, 'utf8')),
      decrypt: (b) => (safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8')),
    }),
    openExternal: (url) => shell.openExternal(url),
    appVersion: app.getVersion(),
  });
  auth.onChange((s) => broadcast('auth:changed', s));
}

const service = createService({
  host: {
    trashItem: (p) => shell.trashItem(p),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    // #329: the interface language until one is chosen (areas/interface-language.js)
    get locale() { return app.getLocale(); }, // read once the app is ready
    userDataDir: app.getPath('userData'),
    // #318: the microphone permission asked on macOS before recording (packages/engine/domains/chat/mic-permission.js)
    systemPreferences,
    // #279: Self-healing applies merged fixes to this app folder, then restarts it
    appDir: app.getAppPath(),
    relaunch: () => restartApp(),
  },
  // the fronts this app ships (apps/desktop/composition.js, phase 4 of the study, #590): their
  // engine-side channels and areas load with the kernel's
  fronts: require('../composition').fronts,
});

// The account channels (declared in packages/engine/service/manifest.js). `auth` is created once the app is
// ready, so it is read at call time; signing in brings the window forward.
const account = {
  state: () => auth.state(),
  refresh: () => auth.refresh(),
  async signIn(provider) {
    const s = await auth.signIn(provider);
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); }
    return s;
  },
  cancelSignIn: () => auth.cancelSignIn(),
  signOut: () => auth.signOut(),
};
// Every channel below answers only the app's page in a window's top frame (#467, apps/desktop/host/ipc-guard.js):
// another page or a subframe is refused and logged (the console, kept by packages/engine/domains/workspace/main-log.js)
const APP_PAGE = path.join(__dirname, '..', 'renderer', 'index.html');
const ipc = guardIpc(ipcMain, { appPage: APP_PAGE, log: (...a) => console.warn('[ipc]', ...a) });
for (const { channel, fn } of authChannels(account)) if (channel) ipc.handle(channel, (arg) => fn(arg));

// ---- IPC transport ------------------------------------------------------------------
for (const [channel, fn] of Object.entries(service.api)) ipc.handle(channel, (arg) => fn(arg));
// a fire-and-forget channel has no reply to carry a refusal: logged, like the server's (#333)
for (const [channel, fn] of Object.entries(service.notifications)) {
  ipc.on(channel, (arg) => { try { fn(arg); } catch (e) { console.error(`${channel}:`, e.message); } });
}
// what the preload builds window.api from, asked once when the window loads (sync: the page's
// scripts use window.api right away); also when the window's code is recorded (#83)
ipc.on('api:manifest', (_arg, e) => {
  service.code.markLoaded();
  e.returnValue = service.manifest;
});
// pushed to the main window and to the Agents window (#263) when it is open
function broadcast(channel, payload) {
  for (const w of [win, agentsWindow?.current()]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}
for (const channel of PUSHED_EVENTS) {
  service.events.on(channel, (payload) => broadcast(channel, payload));
}

// ---- the Agents window (#263, apps/desktop/host/agents-window.js) -----------------------------------------
// Created once the workspace is known (its state file lives there); opened from the drawers'
// "Open in a window" buttons and Ctrl+Shift+A (agents-window:open), told which agent the window
// shows (agents-window:agent) so it reopens there. A link in its chats to a screen of the app
// (agents-window:navigate) is relayed to the main window (main-window:navigate), brought to the front.
let agentsWindow = null;
ipc.handle('agents-window:open', (arg) => { agentsWindow?.open(arg || {}); });
ipc.on('agents-window:agent', (arg) => agentsWindow?.setAgent(arg?.agent));
ipc.on('agents-window:navigate', (arg) => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('main-window:navigate', arg || {});
});

// ---- keep awake (#162) -----------------------------------------------------------------
// The app that runs the work (#112) holds the blocker, only while the setting is on and there is
// work (apps/desktop/host/keep-awake.js). Re-checked after run events, when the settings change and every 15 s
// (a roadmap or a queue changed from the Backlog); released when idle, switched off and on quit.
const keepAwake = createKeepAwake({
  blocker: powerSaveBlocker,
  enabled: () => { const ws = service.workspace(); return !!ws && !!workspace.readSettings(ws).keepAwake; },
  readWork: () => service.pendingWork(),
  onChange: (s) => broadcast('keepAwake:changed', s),
});
let keepAwakeTimer = null;
function checkKeepAwake() {
  if (keepAwakeTimer) return;
  keepAwakeTimer = setTimeout(() => { keepAwakeTimer = null; keepAwake.update(); }, 1000);
}
service.events.on('run:event', checkKeepAwake);
service.events.on('settings:changed', () => keepAwake.update());
ipc.handle('keepAwake:state', () => keepAwake.update());

// ---- control channel (#336) ------------------------------------------------------------
// Outside sessions drive this app through its own channels (packages/engine/control): opened and closed with
// the setting, closed on quit; the Settings screen shows its port and endpoint file.
const control = createControlChannel({ service, ctlPath: nativeBinaryPath('multiagent-ctl', { isPackaged: app.isPackaged }) });
const updateControl = () => control.update().then((s) => { broadcast('control:changed', s); return s; });
service.events.on('settings:changed', () => { updateControl().catch((e) => console.error('control channel:', e.message)); });
ipc.handle('control:state', () => updateControl());

// ---- desktop notifications -------------------------------------------------------------
// The service decides what deserves one (settings, what the window shows); clicking it brings the
// window forward on the run or session. Shown notifications are kept referenced until clicked or
// closed, or their click handler could be garbage-collected.
const shownNotices = new Set();
service.events.on('notify', (n) => {
  if (!Notification.isSupported()) return;
  const note = new Notification({ title: n.title, body: n.body });
  shownNotices.add(note);
  const forget = () => shownNotices.delete(note);
  note.on('click', () => {
    forget();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('notify:open', n.target);
  });
  note.on('close', forget);
  note.show();
});

// Resolves the workspace before opening the window. If the registered folder (or the default
// ~/multiagent-workspace) does not exist, asks whether to create the default or pick another.
async function ensureWorkspace() {
  const r = workspace.resolveWorkspace();
  if (r.dir) return workspace.setupWorkspace(r.dir, { persist: r.source !== 'env' && r.source !== 'simulation' });

  // #329: no workspace, so no setting yet: the computer's language when it has a catalog
  const lang = I18n.resolveLanguage('', app.getLocale());
  const reason = r.registered
    ? t('dialog.workspace_gone', { path: r.registered }, lang)
    : t('dialog.workspace_missing', { path: r.fallback }, lang);
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: t('dialog.workspace', {}, lang),
      message: t('dialog.workspace_choose', {}, lang),
      detail: `${reason}\n\n${t('dialog.workspace_detail', {}, lang)}`,
      buttons: [t('dialog.workspace_create', { path: r.fallback }, lang), t('dialog.workspace_other', {}, lang), t('dialog.quit', {}, lang)],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 0) return workspace.setupWorkspace(r.fallback);
    if (response === 2) return null;
    const dir = await pickWorkspaceDir();
    if (dir) return workspace.setupWorkspace(dir);
  }
}

// Locks the workspace for this process (#112). Held by another live copy: says so and offers a
// scratch copy of it (simulations only) or quit; returns the workspace to open, or null to quit.
async function claimWorkspace(ws) {
  const lock = secondCopy ? { ok: false, holder: null } : runOwner.lockWorkspace(ws.root, { app: APP_DIR });
  if (lock.ok) { workspaceLock = lock; return ws; }
  const h = lock.holder;
  let chosen = '';
  try { chosen = workspace.readSettings(ws).language?.interface; } catch { /* defaults */ }
  const lang = I18n.resolveLanguage(chosen, app.getLocale()); // #329
  const who = h ? t('dialog.in_use_process', { pid: h.pid, host: h.host, since: h.started_at, from: h.app ? t('dialog.in_use_from', { app: h.app }, lang) : '' }, lang) : t('dialog.in_use_other', {}, lang);
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: t('dialog.in_use_title', {}, lang),
    message: t('dialog.in_use_message', {}, lang),
    detail: `${ws.root}\n\n${t('dialog.in_use_detail', { who }, lang)}`,
    buttons: [t('dialog.in_use_scratch', {}, lang), t('dialog.quit', {}, lang)],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return null;
  const scratch = localPreview.scratchWorkspace(ws, path.join(ws.root, 'local-previews', `app-${process.pid}`));
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  const next = workspace.setupWorkspace(scratch.workspace, { persist: false });
  workspaceLock = runOwner.lockWorkspace(next.root, { app: APP_DIR });
  return next;
}

async function pickWorkspaceDir(parent) {
  const opts = { title: t('dialog.workspace_folder'), properties: ['openDirectory', 'createDirectory'], defaultPath: service.workspace()?.root || os.homedir() };
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : r.filePaths[0];
}

// The microphone (voice input, #82) for the app's own page only, audio only; every other
// permission and page is denied (see apps/desktop/host/permissions.js). A check names the page through its
// webContents (its origin is just "file://").
function restrictPermissions(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(allowPermission(permission, details, APP_PAGE)));
  ses.setPermissionCheckHandler((wc, permission, _origin, details) =>
    allowPermission(permission, { ...details, requestingUrl: details?.requestingUrl || wc?.getURL() }, APP_PAGE));
}

// the main window's frame, the remote engine's window too
const WINDOW = {
  width: 1500,
  height: 950,
  minWidth: 1100,
  minHeight: 700,
  backgroundColor: '#0e1014',
  title: 'Multiagent Orchestrator',
  // Linux takes the window icon from here (Windows and macOS from the packaged executable)
  ...(process.platform === 'linux' && { icon: path.join(__dirname, '..', 'assets', 'icon.png') }),
  autoHideMenuBar: true,
};

// ---- the engine connection (apps/desktop/host/engine-connection.js, apps/desktop/host/engine-connection-window.js) --------
// Per machine, in the user data folder (never the workspace), the token encrypted with the OS: this
// computer runs the engine (the default), or the window shows an engine another computer serves
// (`npm run serve`). Read once the app is ready (safeStorage); switching restarts the app.
const connectionFile = () => path.join(app.getPath('userData'), engineConnection.FILE);
const connectionStore = {
  read: () => engineConnection.readConnection(connectionFile(), { decrypt: (b) => safeStorage.decryptString(b) }),
  write: (c) => engineConnection.writeConnection(connectionFile(), c, {
    encrypt: safeStorage.isEncryptionAvailable() ? (s) => safeStorage.encryptString(s) : null,
  }),
  // read at each ask: Settings warns when the token is (or would be) stored unencrypted (#479)
  encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  tokenStorage: () => engineConnection.tokenStorage(connectionFile()),
};
let remoteMode = false;
let connection = null;
// Settings › Execution › Engine › Change… (local mode; the remote engine's page opens it by itself)
ipc.handle('engine:openConnection', () => { connection?.openPage(); return true; });

function createConnection(mode) {
  connection = createEngineConnection({
    BrowserWindow, ipcMain, shell, session,
    dirname: __dirname,
    store: connectionStore,
    version: { app: app.getVersion(), contract: contractHash(service.manifest) },
    mode,
    windowOptions: WINDOW,
    mainWindow: () => win,
    // runs in progress here refuse the switch (packages/engine/service/areas/runs.js), before anything is saved
    prepareRestart: () => { if (!remoteMode) service.prepareRestart({ interruptRuns: false }); },
    relaunch: () => (remoteMode ? setImmediate(() => { app.relaunch(); app.exit(0); }) : restartApp()),
    devTools: !app.isPackaged,
    env: process.env,
    screen,
    // the connection page closed while it was the only window (the remote engine failed)
    quit: () => app.quit(),
  });
}

function createWindow() {
  win = new BrowserWindow({
    ...WINDOW,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });
  // the window never navigates, not even to a file: page (#466): http(s) links go to the browser
  guardWindow(win.webContents, { openExternal: (url) => shell.openExternal(url) });
  win.loadFile(APP_PAGE);
  // a run that died with the app last time, once the window can open it
  win.webContents.once('did-finish-load', () => service.notifyInterruptedRun());
  // the Agents window goes with the main one (#263)
  win.on('closed', () => { const aw = agentsWindow?.current(); if (aw) aw.close(); });
  // Packaged-app smoke (scripts/smoke-package.js, the release jobs): in simulation only, the app
  // writes MULTIAGENT_SMOKE_FILE a few seconds after its page loads and quits by itself
  const smokeFile = process.env.MULTIAGENT_SIMULATION_ONLY === '1' && process.env.MULTIAGENT_SMOKE_FILE;
  if (smokeFile) {
    win.webContents.once('did-fail-load', (_e, code, desc) => { console.error(`Smoke: the page did not load: ${desc} (${code})`); app.exit(1); });
    win.webContents.once('render-process-gone', (_e, details) => { console.error(`Smoke: the page crashed: ${details.reason}`); app.exit(1); });
    win.webContents.once('did-finish-load', () => setTimeout(() => {
      fs.writeFileSync(smokeFile, `loaded ${win.webContents.getURL()}\n`);
      app.quit();
    }, 3000));
  }
}

// ---- desktop-only actions ----------------------------------------------------------------
ipc.handle('path:open', (p) => {
  if (!service.openableFolders().some((dir) => pathKey(p) === pathKey(dir) || pathKey(p).startsWith(pathKey(dir) + path.sep))) throw new Error('Path is outside the workspace.');
  // never run a program an agent wrote (#477): an executable extension or, on POSIX, the x bit
  const openable = checkOpenable(p);
  if (!openable.ok) throw new Error(openable.reason);
  return shell.openPath(p);
});

// the window's real pixels for the Findings button (#361): a PNG data URL
ipc.handle('window:capture', async (_arg, e) => (await e.sender.capturePage()).toDataURL());

ipc.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: service.workspace().projects });
  return r.canceled ? null : r.filePaths[0];
});

ipc.handle('workspace:change', async () => {
  if (service.isRunning()) throw new Error('Cannot change the workspace while workflows are running.');
  const dir = await pickWorkspaceDir(win);
  if (dir) service.setWorkspace(workspace.setupWorkspace(dir));
  // the endpoint follows the workspace (its own setting, its own control/ folder)
  if (dir) await updateControl().catch((e) => console.error('control channel:', e.message));
  return service.workspace();
});

ipc.handle('workspace:open', () => shell.openPath(service.workspace().root));

ipc.handle('run:openDir', (arg) => {
  const dir = service.runDir(arg?.runId) || service.workspace().runs;
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

// Opens an artifact with the default app, or shows it in the file explorer. A program (an
// executable extension, or the x bit on POSIX) is never opened: the answer is the reason (#477),
// like shell.openPath's own error string.
ipc.handle('artifacts:open', async ({ path: file, reveal }) => {
  const found = await service.findArtifact(file);
  if (!found?.exists) throw new Error('Artifact not found.');
  if (reveal) { shell.showItemInFolder(found.path); return ''; }
  const openable = checkOpenable(found.path);
  if (!openable.ok) return openable.reason;
  return shell.openPath(found.path);
});

// Clipboard for the terminals (the sandboxed renderer has no clipboard module). Electron 44's
// clipboard is async and ClipboardItem-based (#139): readText/writeText return promises.
ipc.handle('clipboard:read', async () => clipboard.readText());
ipc.handle('clipboard:write', async ({ text }) => { await clipboard.writeText(String(text ?? '')); return true; });

// An artifact's image, or the file itself, on the clipboard (#114). Only a run's artifact (a file of
// its folder or its recorded project copy) is accepted: service.existingArtifact refuses the rest.
// The image goes as PNG data (writeImage was removed in Electron 44, #139).
ipc.handle('clipboard:writeImage', async ({ path: file }) => {
  const found = await service.existingArtifact(file);
  const img = nativeImage.createFromPath(found.path);
  if (img.isEmpty()) throw new Error(`Not an image the clipboard can hold: ${path.basename(found.path)}`);
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]);
  return true;
});

// The file itself, to paste in the file explorer or attach in a chat. Windows: the file-drop list
// (CF_HDROP) through Windows PowerShell's Set-Clipboard -LiteralPath (Electron cannot write it).
// macOS / Linux: the file URL as a ClipboardItem (public.file-url as a raw macOS format, text/uri-list
// on Linux), checked with clipboard.has afterwards: a platform that drops the type gets a clear error.
ipc.handle('clipboard:writeFile', async ({ path: file }) => {
  const found = await service.existingArtifact(file);
  if (process.platform === 'win32') {
    const literal = psQuote(found.path);
    await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -LiteralPath ${literal}`],
      { windowsHide: true, timeout: 15000 }, (err, _out, stderr) => (err ? reject(new Error(`Could not copy the file: ${String(stderr || err.message).trim()}`)) : resolve())));
    return true;
  }
  const type = process.platform === 'darwin' ? 'electron application/osclipboard;format="public.file-url"' : 'text/uri-list';
  const url = require('url').pathToFileURL(found.path).href;
  await clipboard.write([new ClipboardItem({ [type]: new Blob([url], { type: 'text/plain' }) })]);
  if (!(await clipboard.has(type))) throw new Error('Copy file is not available on this platform: use Copy path instead');
  return true;
});

// External terminal window for a session: its live log or its CLI conversation. The window per OS
// (cmd on Windows, Terminal.app on macOS, the first terminal installed on Linux) comes from
// apps/desktop/host/external-terminal.js; without one the renderer keeps the ↗ button disabled (#318).
const terminalHost = () => ({ exists: (name) => !!resolveCommand(name) });
function openConsole({ title, cwd, file, args, env }) {
  const launch = terminalLaunch({ ...terminalHost(), title, cwd, file, args, childEnv: env });
  if (!launch) throw new Error(NO_TERMINAL);
  const child = spawn(launch.file, launch.args, { ...launch.options, detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

ipc.on('terminal:external-sync', (_arg, e) => { e.returnValue = externalTerminal(terminalHost()); });

ipc.handle('session:terminal', ({ sessionId, mode, runId }) => {
  openConsole(service.terminalSpec(runId, sessionId, mode));
  return true;
});

// Restart after the code changed on disk (#83): the service refuses while runs are in progress
// unless the user confirmed interrupting them, and pauses the Backlog queues first.
ipc.handle('app:relaunch', (arg) => {
  const r = service.prepareRestart({ interruptRuns: !!arg?.interruptRuns });
  restartApp();
  return r;
});

// The restart itself, also after an app update (#279, host.relaunch: prepareRestart already ran).
function restartApp() {
  setImmediate(() => {
    // the renderer saved the interrupted runs to list after the restart
    if (win && !win.isDestroyed()) win.webContents.session.flushStorageData();
    service.shutdown();
    // app.exit skips will-quit: the new process takes the workspace lock (and holds its own blocker)
    keepAwake.stop();
    control.stop();
    workspaceLock?.release();
    app.relaunch();
    app.exit(0);
  });
}

// Windows shows notifications under the app's AppUserModelID (the exe itself in development).
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'MultiagentOrchestrator' : process.execPath);

app.whenReady().then(async () => {
  restrictPermissions(session.defaultSession);
  const engine = engineConnection.decideMode({ connection: connectionStore.read(), env: process.env });
  remoteMode = engine.mode === 'remote';
  createConnection(engine.mode);
  // a remote engine: no workspace, no lock, no account, no keep-awake, control channel or cleanup here
  if (remoteMode) {
    console.log(`Engine: remote, ${engine.url || engine.address} (this app runs no engine of its own).`);
    return connection.startRemote(engine);
  }
  if (engine.reason) console.log(`Engine: this computer (${engine.reason}).`);
  createAccount();
  const found = await ensureWorkspace();
  const ws = found && await claimWorkspace(found);
  if (!ws) return app.quit();
  service.setWorkspace(ws);
  agentsWindow = createAgentsWindow({ BrowserWindow, screen, statePath: path.join(ws.root, 'agents-window.json'), dirname: __dirname, devTools: !app.isPackaged });
  keepAwake.update();
  setInterval(() => keepAwake.update(), 15 * 1000).unref();
  updateControl().catch((e) => console.error('control channel:', e.message));
  createWindow();
  // ended runs' worktrees and scratch (#202, #201): at start, then every 30 minutes (a folder a
  // process held is retried)
  service.cleanupWorktrees().catch((e) => console.error('worktree cleanup:', e));
  setInterval(() => service.cleanupWorktrees().catch((e) => console.error('worktree cleanup:', e)), 30 * 60 * 1000).unref();
  service.clearPastedImages();
  // #315: the account records "last seen" at start, then once a day while the app stays open
  const touchAccount = () => auth.refresh().catch((e) => console.error('account:', e.message));
  touchAccount();
  setInterval(touchAccount, 24 * 60 * 60 * 1000).unref();
});
app.on('window-all-closed', () => {
  if (remoteMode) return app.quit();
  service.shutdown();
  keepAwake.stop();
  control.stop();
  app.quit();
});
app.on('will-quit', () => {
  if (remoteMode) return;
  keepAwake.stop();
  control.stop();
  workspaceLock?.release();
});
// a second copy started on the same user data folder: this window comes forward (#112)
app.on('second-instance', () => {
  const w = win && !win.isDestroyed() ? win : connection?.window();
  if (!w) return;
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
});
