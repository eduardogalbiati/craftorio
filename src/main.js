// Electron main process: the window, the workspace dialog, desktop-only actions (native dialogs,
// clipboard, opening files and folders, external console windows) and the IPC transport to the
// engine service (src/service), which holds everything else.

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
const { resolveCommand } = require('./engine/providers');
const {
  externalTerminal,
  NO_TERMINAL,
  terminalLaunch,
} = require('./external-terminal');
const { pathKey } = require('./platform-paths');
const workspace = require('./workspace');
const localPreview = require('./local-preview');
const runOwner = require('./run-owner');
const { allowPermission } = require('./permissions');
const { createService } = require('./service');
const { authChannels } = require('./service/manifest');
const { createAuth, fileStorage } = require('./auth');
const authConfig = require('./auth-config');
const { createKeepAwake } = require('./keep-awake');

// The packaged app doesn't accept Chromium's remote debugging switches (the Node inspector is
// already disabled by a fuse, see scripts/package.js)
if (app.isPackaged && ['remote-debugging-port', 'remote-debugging-pipe'].some((s) => app.commandLine.hasSwitch(s))) {
  app.exit(1);
}

// A copy started by Run locally at a gate (src/local-preview.js) keeps its own user data folder,
// so it never shares the owner's sign-in or window state
if (!app.isPackaged && process.env.MULTIAGENT_USER_DATA) app.setPath('userData', path.resolve(process.env.MULTIAGENT_USER_DATA));

// ---- one app per workspace (#112) ------------------------------------------------------------
// Two copies on one workspace judge each other's runs as interrupted and start them twice.
// - An app started by hand from a run's worktree (<workspace>/worktrees/<id>) opens a scratch
//   workspace with its own user data folder, simulations only, as Run locally does.
// - The owner's app (no MULTIAGENT_WORKSPACE) holds Electron's single-instance lock for its user
//   data folder; a second copy gets a user data folder of its own and offers a scratch copy or quit.
// - Whatever the user data folder, the app locks the workspace it opens (<workspace>/.lock with a
//   heartbeat, src/run-owner.js); a locked workspace is never opened read-write by a second copy.
// Scratch copies (screenshots, Run locally, smoke checks, tests) have their own workspaces: unaffected.
const APP_DIR = path.join(__dirname, '..');
if (!app.isPackaged && !process.env.MULTIAGENT_WORKSPACE) {
  const scratch = localPreview.worktreeAppScratch(APP_DIR);
  if (scratch) {
    process.env.MULTIAGENT_WORKSPACE = scratch.workspace;
    process.env.MULTIAGENT_SIMULATION_ONLY = '1';
    if (!process.env.MULTIAGENT_USER_DATA) app.setPath('userData', scratch.userData);
    console.log(`Started from a worktree of ${scratch.owner}: using the scratch workspace ${scratch.workspace} (simulations only).`);
  }
}
// An agent's check started without its run's scratch workspace (#120): simulations only never open
// the owner's workspace (workspace.resolveWorkspace) nor the owner's user data (sign-in, #112).
// Agents of a run with a worktree get MULTIAGENT_WORKSPACE and MULTIAGENT_USER_DATA from the engine.
if (!app.isPackaged && !process.env.MULTIAGENT_WORKSPACE && process.env.MULTIAGENT_SIMULATION_ONLY === '1') {
  const scratch = workspace.simulationWorkspace();
  process.env.MULTIAGENT_WORKSPACE = scratch.workspace;
  if (!process.env.MULTIAGENT_USER_DATA) app.setPath('userData', scratch.userData);
  console.log(`Simulation only: using the scratch workspace ${scratch.workspace}.`);
}
const secondCopy = !process.env.MULTIAGENT_WORKSPACE && !app.requestSingleInstanceLock();
if (secondCopy) {
  const dir = workspace.resolveWorkspace().dir || os.tmpdir();
  app.setPath('userData', path.join(dir, 'local-previews', `app-${process.pid}`, 'user-data'));
}
let workspaceLock = null;

let win = null;

// ---- account (sign-in; it only counts the people using the app) ------------------------------
// The session is machine- and OS-user-specific, so it lives in the app's user data folder
// (%APPDATA%), not in the workspace, encrypted with the OS (DPAPI on Windows).
// Created once the app is ready: safeStorage can't decrypt before that, and the Supabase client
// reads the stored session as soon as it is created (reading it too early lost the session and
// asked for a new sign-in at every start).
const devEnv = app.isPackaged ? {} : process.env;
const authOff = devEnv.MULTIAGENT_AUTH === 'off';
let auth = null;
function createAccount() {
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
    userDataDir: app.getPath('userData'),
    // #318: the microphone permission asked on macOS before recording (src/mic-permission.js)
    systemPreferences,
    // #279: Self-healing applies merged fixes to this app folder, then restarts it
    appDir: app.getAppPath(),
    relaunch: () => restartApp(),
  },
});

// The account channels (declared in src/service/manifest.js). `auth` is created once the app is
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
for (const { channel, fn } of authChannels(account)) if (channel) ipcMain.handle(channel, (_e, arg) => fn(arg));

// ---- IPC transport ------------------------------------------------------------------
for (const [channel, fn] of Object.entries(service.api)) ipcMain.handle(channel, (_e, arg) => fn(arg));
for (const [channel, fn] of Object.entries(service.notifications)) ipcMain.on(channel, (_e, arg) => fn(arg));
// what the preload builds window.api from, asked once when the window loads (sync: the page's
// scripts use window.api right away); also when the window's code is recorded (#83)
ipcMain.on('api:manifest', (e) => {
  service.code.markLoaded();
  e.returnValue = service.manifest;
});
// pushed to the main window and to the Agents window (#263) when it is open
function broadcast(channel, payload) {
  for (const w of [win, agentsWindow?.current()]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}
for (const channel of ['backlog:changed', 'chat:progress', 'notifications:changed','oracle:changed', 'run:event', 'run:meta', 'supervisor:watch', 'term:data', 'term:exit']) {
  service.events.on(channel, (payload) => broadcast(channel, payload));
}

// ---- the Agents window (#263, src/agents-window.js) -----------------------------------------
// Created once the workspace is known (its state file lives there); opened from the drawers'
// "Open in a window" buttons and Ctrl+Shift+A (agents-window:open), told which agent the window
// shows (agents-window:agent) so it reopens there. A link in its chats to a screen of the app
// (agents-window:navigate) is relayed to the main window (main-window:navigate), brought to the front.
let agentsWindow = null;
ipcMain.handle('agents-window:open', (_e, arg) => { agentsWindow?.open(arg || {}); });
ipcMain.on('agents-window:agent', (_e, arg) => agentsWindow?.setAgent(arg?.agent));
ipcMain.on('agents-window:navigate', (_e, arg) => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('main-window:navigate', arg || {});
});

// ---- keep awake (#162) -----------------------------------------------------------------
// The app that runs the work (#112) holds the blocker, only while the setting is on and there is
// work (src/keep-awake.js). Re-checked after run events, when the settings change and every 15 s
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
ipcMain.handle('keepAwake:state', () => keepAwake.update());

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

  const reason = r.registered
    ? `The registered workspace folder no longer exists:\n${r.registered}`
    : `Workspace folder not found:\n${r.fallback}`;
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'Workspace',
      message: 'Choose the workspace folder',
      detail: `${reason}\n\nIt holds the run logs and cloned repositories. The path is saved and reloaded the next time the app opens.`,
      buttons: [`Create ${r.fallback}`, 'Choose another folder…', 'Quit'],
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
  const who = h ? `process ${h.pid} on ${h.host}, open since ${h.started_at}${h.app ? ` (from ${h.app})` : ''}` : 'another copy of the app';
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Workspace in use',
    message: 'This workspace is already open in another copy of the app',
    detail: `${ws.root}\n\nIt is open in ${who}. Two copies on one workspace would take each other's runs for interrupted and start them twice.\n\nOpen a scratch copy (your agents, skills, workflows and settings copied to a new workspace; simulations only), or quit.`,
    buttons: ['Open a scratch copy', 'Quit'],
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
  const opts = { title: 'Workspace folder', properties: ['openDirectory', 'createDirectory'], defaultPath: service.workspace()?.root || os.homedir() };
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : r.filePaths[0];
}

const APP_PAGE = path.join(__dirname, 'renderer', 'index.html');

// The microphone (voice input, #82) for the app's own page only, audio only; every other
// permission and page is denied (see src/permissions.js). A check names the page through its
// webContents (its origin is just "file://").
function restrictPermissions(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(allowPermission(permission, details, APP_PAGE)));
  ses.setPermissionCheckHandler((wc, permission, _origin, details) =>
    allowPermission(permission, { ...details, requestingUrl: details?.requestingUrl || wc?.getURL() }, APP_PAGE));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0e1014',
    title: 'Multiagent Orchestrator',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  win.loadFile(APP_PAGE);
  // a run that died with the app last time, once the window can open it
  win.webContents.once('did-finish-load', () => service.notifyInterruptedRun());
  // the Agents window goes with the main one (#263)
  win.on('closed', () => { const aw = agentsWindow?.current(); if (aw) aw.close(); });
}

// ---- desktop-only actions ----------------------------------------------------------------
ipcMain.handle('path:open', (_e, p) => {
  if (!service.openableFolders().some((dir) => pathKey(p) === pathKey(dir) || pathKey(p).startsWith(pathKey(dir) + path.sep))) throw new Error('Path is outside the workspace.');
  return shell.openPath(p);
});

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: service.workspace().projects });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('workspace:change', async () => {
  if (service.isRunning()) throw new Error('Cannot change the workspace while workflows are running.');
  const dir = await pickWorkspaceDir(win);
  if (dir) service.setWorkspace(workspace.setupWorkspace(dir));
  return service.workspace();
});

ipcMain.handle('workspace:open', () => shell.openPath(service.workspace().root));

ipcMain.handle('run:openDir', (_e, arg) => {
  const dir = service.runDir(arg?.runId) || service.workspace().runs;
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

// Opens an artifact with the default app, or shows it in the file explorer.
ipcMain.handle('artifacts:open', async (_e, { path: file, reveal }) => {
  const found = await service.findArtifact(file);
  if (!found?.exists) throw new Error('Artifact not found.');
  if (reveal) { shell.showItemInFolder(found.path); return ''; }
  return shell.openPath(found.path);
});

// Clipboard for the terminals (the sandboxed renderer has no clipboard module). Electron 44's
// clipboard is async and ClipboardItem-based (#139): readText/writeText return promises.
ipcMain.handle('clipboard:read', async () => clipboard.readText());
ipcMain.handle('clipboard:write', async (_e, { text }) => { await clipboard.writeText(String(text ?? '')); return true; });

// An artifact's image, or the file itself, on the clipboard (#114). Only a run's artifact (a file of
// its folder or its recorded project copy) is accepted: service.existingArtifact refuses the rest.
// The image goes as PNG data (writeImage was removed in Electron 44, #139).
ipcMain.handle('clipboard:writeImage', async (_e, { path: file }) => {
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
ipcMain.handle('clipboard:writeFile', async (_e, { path: file }) => {
  const found = await service.existingArtifact(file);
  if (process.platform === 'win32') {
    const literal = `'${found.path.replace(/'/g, "''")}'`;
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
// src/external-terminal.js; without one the renderer keeps the ↗ button disabled (#318).
const terminalHost = () => ({ exists: (name) => !!resolveCommand(name) });
function openConsole({ title, cwd, file, args, env }) {
  const launch = terminalLaunch({ ...terminalHost(), title, cwd, file, args, childEnv: env });
  if (!launch) throw new Error(NO_TERMINAL);
  const child = spawn(launch.file, launch.args, { ...launch.options, detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

ipcMain.on('terminal:external-sync', (e) => { e.returnValue = externalTerminal(terminalHost()); });

ipcMain.handle('session:terminal', (_e, { sessionId, mode, runId }) => {
  openConsole(service.terminalSpec(runId, sessionId, mode));
  return true;
});

// Restart after the code changed on disk (#83): the service refuses while runs are in progress
// unless the user confirmed interrupting them, and pauses the Backlog queues first.
ipcMain.handle('app:relaunch', (_e, arg) => {
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
    workspaceLock?.release();
    app.relaunch();
    app.exit(0);
  });
}

// Windows shows notifications under the app's AppUserModelID (the exe itself in development).
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'MultiagentOrchestrator' : process.execPath);

app.whenReady().then(async () => {
  createAccount();
  const found = await ensureWorkspace();
  const ws = found && await claimWorkspace(found);
  if (!ws) return app.quit();
  service.setWorkspace(ws);
  agentsWindow = createAgentsWindow({ BrowserWindow, screen, statePath: path.join(ws.root, 'agents-window.json'), dirname: __dirname, devTools: !app.isPackaged });
  keepAwake.update();
  setInterval(() => keepAwake.update(), 15 * 1000).unref();
  restrictPermissions(session.defaultSession);
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
  service.shutdown();
  keepAwake.stop();
  app.quit();
});
app.on('will-quit', () => {
  keepAwake.stop();
  workspaceLock?.release();
});
// a second copy started on the same user data folder: this window comes forward (#112)
app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
