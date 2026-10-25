// The browser UI of a served engine for the Playwright E2E suite (#339): launchServedUi() starts the
// engine server (`node scripts/serve.js --port 0 --workspace <scratch>`, as `npm run serve` does) on a
// fresh scratch workspace, in simulation (MULTIAGENT_SIMULATION_ONLY=1, MULTIAGENT_AUTH=off, HOME
// inside the scratch folder), and a "browser" for its UI: an Electron window with no preload
// (features/support/browser-main.js), so window.api is src/renderer/api-http.js over HTTP, as in a
// real browser. Electron is the browser on purpose: it is always installed with the app, Playwright's
// own browsers may not be. The window starts on about:blank: a step can set routes (page.route) before
// it opens the served UI (open()). Takes the machine's screenshot slot like launchApp (#199), only
// with slot: true (the visual lane, #365); close() stops the window and the server and removes the scratch folder.
// The browser's locale is en-US (LANG/LC_ALL too) whatever the computer's language (#444).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { _electron: electron } = require('@playwright/test');
const { screenshotSlot } = require('./app');

const root = path.join(__dirname, '..', '..');

function removeScratch(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* EBUSY: the OS temp folder cleans it */ }
}

// The server's and the browser's environment: simulation only, no account, no Node mode
function servedEnv(scratch, { size }) {
  const home = path.join(scratch, 'home');
  for (const d of [home, path.join(home, 'AppData'), path.join(scratch, 'workspace'), path.join(scratch, 'user-data')]) fs.mkdirSync(d, { recursive: true });
  const env = {
    ...process.env,
    MULTIAGENT_USER_DATA: path.join(scratch, 'user-data'),
    MULTIAGENT_SIMULATION_ONLY: '1',
    MULTIAGENT_AUTH: 'off',
    MULTIAGENT_MOCK_DELAY_SCALE: '0.02',
    MULTIAGENT_E2E_SIZE: size,
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
    GH_CONFIG_DIR: path.join(home, 'gh'), GLAB_CONFIG_DIR: path.join(home, 'glab'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

// Starts scripts/serve.js on a free port → { child, url } (url carries the token once)
function startServer(scratch, env) {
  const child = spawn(process.execPath, [path.join(root, 'packages', 'engine', 'bin', 'multiagent-engine.js'), '--port', '0', '--workspace', path.join(scratch, 'workspace')], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`the engine server did not start in 60 s:\n${out}`)), 60000);
    const read = (chunk) => {
      out += chunk;
      const m = out.match(/Open: (http:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve({ child, url: m[1] }); }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', (c) => { out += c; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the engine server exited (${code}):\n${out}`)); });
  });
}

/**
 * Starts a served engine and a browser window on about:blank → { app, window, url, open, scratch, close }.
 * open() loads the served UI (the url with its token) in the window.
 */
async function launchServedUi({ size = '1400x900', slot: takeSlot = true } = {}) {
  const slot = await screenshotSlot(takeSlot);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-e2e-served-'));
  let app = null;
  let server = null;
  const close = async () => {
    if (app) await app.close().catch(() => {});
    if (server) server.child.kill();
    slot.release();
    removeScratch(scratch);
  };
  try {
    const env = servedEnv(scratch, { size });
    server = await startServer(scratch, env);
    app = await electron.launch({
      executablePath: require('electron'),
      args: [path.join(__dirname, 'browser-main.js')],
      cwd: root,
      env,
      locale: 'en-US',
      timeout: 60000,
    });
    const window = await app.firstWindow();
    const open = async () => {
      await window.goto(server.url);
      await window.waitForLoadState('domcontentloaded');
    };
    return { app, window, url: server.url, open, scratch, close };
  } catch (e) {
    await close();
    throw e;
  }
}

module.exports = {
  launchServedUi,
};
