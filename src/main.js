// Electron main process: the window, the workspace dialog, desktop-only actions (native dialogs,
// clipboard, opening files and folders, external console windows) and the IPC transport to the
// engine service (src/service), which holds everything else.

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  safeStorage,
  shell,
} = require('electron');
const workspace = require('./workspace');
const { createService } = require('./service');
const { authChannels } = require('./service/manifest');
const { createAuth, fileStorage } = require('./auth');
const authConfig = require('./auth-config');

// The packaged app doesn't accept Chromium's remote debugging switches (the Node inspector is
// already disabled by a fuse, see scripts/package.js)
if (app.isPackaged && ['remote-debugging-port', 'remote-debugging-pipe'].some((s) => app.commandLine.hasSwitch(s))) {
  app.exit(1);
}

let win = null;

// ---- account (sign-in and free trial) --------------------------------------------------------
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
  });
  auth.onChange((s) => { if (win && !win.isDestroyed()) win.webContents.send('auth:changed', s); });
}

const service = createService({
  host: {
    trashItem: (p) => shell.trashItem(p),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    assertCanRun: (opts) => auth.assertCanRun(opts),
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
// scripts use window.api right away)
ipcMain.on('api:manifest', (e) => { e.returnValue = service.manifest; });
for (const channel of ['run:event', 'supervisor:watch', 'term:data', 'term:exit']) {
  service.events.on(channel, (payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); });
}

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
  if (r.dir) return workspace.setupWorkspace(r.dir, { persist: r.source !== 'env' });

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

async function pickWorkspaceDir(parent) {
  const opts = { title: 'Workspace folder', properties: ['openDirectory', 'createDirectory'], defaultPath: service.workspace()?.root || os.homedir() };
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : r.filePaths[0];
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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // a run that died with the app last time, once the window can open it
  win.webContents.once('did-finish-load', () => service.notifyInterruptedRun());
}

// ---- desktop-only actions ----------------------------------------------------------------
ipcMain.handle('path:open', (_e, p) => {
  const norm = (x) => { const r = path.resolve(x); return process.platform === 'win32' ? r.toLowerCase() : r; };
  if (!service.openableFolders().some((dir) => norm(p) === norm(dir) || norm(p).startsWith(norm(dir) + path.sep))) throw new Error('Path is outside the workspace.');
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
ipcMain.handle('artifacts:open', (_e, { path: file, reveal }) => {
  const found = service.findArtifact(file);
  if (!found?.exists) throw new Error('Artifact not found.');
  if (reveal) { shell.showItemInFolder(found.path); return ''; }
  return shell.openPath(found.path);
});

// Clipboard for the terminals (the sandboxed renderer has no clipboard module)
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.handle('clipboard:write', (_e, { text }) => { clipboard.writeText(String(text ?? '')); return true; });

// External console window (Windows) for a session: its live log or its CLI conversation.
const q = (a) => `"${String(a).replace(/"/g, '""')}"`;
function openConsole({ title, cwd, file, args, env }) {
  if (process.platform !== 'win32') throw new Error('Opening a terminal is only supported on Windows for now.');
  const cmdline = [file, ...args].map(q).join(' ');
  // start "<title>" /D "<cwd>" cmd /k "<command line>": a new console that stays open on exit
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `start ${q(title)} /D ${q(cwd)} cmd /k "${cmdline}"`], {
    windowsVerbatimArguments: true, detached: true, stdio: 'ignore', env,
  });
  child.unref();
}

ipcMain.handle('session:terminal', (_e, { sessionId, mode, runId }) => {
  openConsole(service.terminalSpec(runId, sessionId, mode));
  return true;
});

// Restart after the code changed on disk (#83): the service refuses while runs are in progress
// unless the user confirmed interrupting them, and pauses the Backlog queues first.
ipcMain.handle('app:relaunch', (_e, arg) => {
  const r = service.prepareRestart({ interruptRuns: !!arg?.interruptRuns });
  setImmediate(() => {
    // the renderer saved the interrupted runs to list after the restart
    if (win && !win.isDestroyed()) win.webContents.session.flushStorageData();
    service.shutdown();
    app.relaunch();
    app.exit(0);
  });
  return r;
});

// Windows shows notifications under the app's AppUserModelID (the exe itself in development).
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'MultiagentOrchestrator' : process.execPath);

app.whenReady().then(async () => {
  createAccount();
  const ws = await ensureWorkspace();
  if (!ws) return app.quit();
  service.setWorkspace(ws);
  createWindow();
  service.cleanupWorktrees().catch((e) => console.error('worktree cleanup:', e));
  // the trial can end while the app is open
  const checkAccount = () => auth.refresh().catch((e) => console.error('account:', e.message));
  checkAccount();
  setInterval(checkAccount, 60 * 60 * 1000).unref();
});
app.on('window-all-closed', () => {
  service.shutdown();
  app.quit();
});
