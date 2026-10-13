// Electron main process used as a plain browser by the Playwright E2E suite (#339):
// features/support/served.js launches `electron features/support/browser-main.js` to show the UI of
// a served engine (scripts/serve.js). One window, no preload and no Node in the page, so the UI
// builds window.api from src/renderer/api-http.js over HTTP as in any browser. It opens on
// about:blank: the steps set their routes, then load the served URL. Same window settings as
// features/support/electron-main.js (fixed size MULTIAGENT_E2E_SIZE, off-screen unless
// MULTIAGENT_E2E_SHOW=1, keeps painting off-screen).

const { app, BrowserWindow } = require('electron');

const [width, height] = String(process.env.MULTIAGENT_E2E_SIZE || '1400x900').split('x').map(Number);
const show = process.env.MULTIAGENT_E2E_SHOW === '1';

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    useContentSize: true,
    width,
    height,
    x: show ? undefined : -(width + 4000),
    y: show ? undefined : 0,
    skipTaskbar: !show,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL('about:blank');
});

app.on('window-all-closed', () => app.quit());
