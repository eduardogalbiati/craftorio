// Electron main process used as a plain browser by the Playwright E2E suite (#339):
// features/support/served.js launches `electron features/support/browser-main.js` to show the UI of
// a served engine (scripts/serve.js). One window, no preload and no Node in the page, so the UI
// builds window.api from src/renderer/api-http.js over HTTP as in any browser. It opens on
// about:blank: the steps set their routes, then load the served URL. Same window settings as
// features/support/electron-main.js (fixed size MULTIAGENT_E2E_SIZE, off-screen unless
// MULTIAGENT_E2E_SHOW=1, keeps painting off-screen), applied the same way: after the window exists.
// The browser runs in English (en-US) whatever the computer's language (#444).

const { app, BrowserWindow } = require('electron');

const [width, height] = String(process.env.MULTIAGENT_E2E_SIZE || '1400x900').split('x').map(Number);
const show = process.env.MULTIAGENT_E2E_SHOW === '1';

// the profile in the scratch folder, as src/main.js does: with HOME/APPDATA redirected to an empty
// scratch folder and no userData set, Electron crashed at launch (0x80000003)
if (process.env.MULTIAGENT_USER_DATA) app.setPath('userData', process.env.MULTIAGENT_USER_DATA);

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// #444: the served UI follows navigator.language when its workspace chose no language
app.commandLine.appendSwitch('lang', 'en-US');

// as electron-main.js: the window is created with plain options and moved off-screen after; a window
// created at a negative x with an explicit sandbox crashed Electron at launch (0x80000003)
app.on('browser-window-created', (_e, win) => {
  win.setContentSize(width, height);
  if (!show) {
    win.setPosition(-(width + 4000), 0);
    win.setSkipTaskbar(true);
  }
});

app.whenReady().then(() => {
  const win = new BrowserWindow({ width, height, useContentSize: true, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  win.loadURL('about:blank');
});

app.on('window-all-closed', () => app.quit());
