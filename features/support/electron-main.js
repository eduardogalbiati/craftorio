// Electron main process of the Playwright E2E suite (#222): features/support/app.js launches
// `electron features/support/electron-main.js` with Playwright's _electron, on a scratch workspace
// it has already seeded. This file only sets what has to happen inside Electron, then loads the
// real app (src/main.js):
// - the theme Electron reports (MULTIAGENT_E2E_THEME: light | dark), for the visual baselines;
// - a fixed window content size (MULTIAGENT_E2E_SIZE, default 1400x900);
// - the channels that would call a model (Product Owner, Oracle, supervisor chat, analysis) answer
//   with simulated data or previews, as in scripts/screenshot.js;
// - the window stays off-screen, so a run never takes the owner's screen (MULTIAGENT_E2E_SHOW=1
//   shows it, e.g. to watch a scenario); Chromium keeps painting it (no occlusion throttling);
// - the main process's clock starts at MULTIAGENT_E2E_NOW (ms) when set: the visual scenarios
//   render at a fixed instant (#362, features/support/fixed-clock.js);
// - the locale is en-US, so the interface is English until a scenario chooses another (#329).

const path = require('path');
const { app, ipcMain, nativeTheme } = require('electron');
const { shiftClock } = require('./fixed-clock');

if (process.env.MULTIAGENT_E2E_NOW) shiftClock(Number(process.env.MULTIAGENT_E2E_NOW));
// the helpers only: scripts/screenshot.js runs its own capture in an Electron main process otherwise
global.multiagentScreenshotHelpers = true;
const { simulateChannels } = require('../../scripts/screenshot');

const theme = process.env.MULTIAGENT_E2E_THEME;
if (theme) nativeTheme.themeSource = theme;
const [width, height] = String(process.env.MULTIAGENT_E2E_SIZE || '1400x900').split('x').map(Number);
const show = process.env.MULTIAGENT_E2E_SHOW === '1';

// an off-screen or covered window must keep rendering: the steps and the screenshots read it
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// #329: the scenarios run in English whatever the computer's language (the interface follows it until chosen)
app.commandLine.appendSwitch('lang', 'en-US');

app.on('browser-window-created', (_e, win) => {
  win.setMinimumSize(400, 300);
  win.setContentSize(width, height);
  if (!show) {
    win.setPosition(-(width + 4000), 0);
    win.setSkipTaskbar(true);
  }
});

simulateChannels(ipcMain);
require(path.join(__dirname, '..', '..', 'src', 'main'));
