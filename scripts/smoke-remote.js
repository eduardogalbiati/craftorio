// Remote engine smoke check: the desktop app as a window onto an engine `npm run serve` runs
// (Settings › Execution › Engine, apps/desktop/host/engine-connection-window.js), end to end.
// Usage: npx electron scripts/smoke-remote.js <out-dir>
//
// Starts scripts/serve.js on 127.0.0.1 (a free port) with a scratch workspace, simulation only and
// no account, writes a scratch user data folder whose engine connection points at it, then opens
// the app (apps/desktop/host/main): it must open no workspace of its own, show the engine's page (window.api over
// HTTP: a project created through it is the engine's), say "remote" in Settings › Execution ›
// Engine, open the connection page from Change… (its Cancel closes it), and, once the engine stops,
// replace its window with the connection page and the reason (its close button then reads Quit). Saves remote.png, connection.png and unreachable.png in
// <out-dir>. Never calls a model: MULTIAGENT_SIMULATION_ONLY=1 (decideMode only uses an engine on
// 127.0.0.1 under it) and the engine runs in simulation. Built like scripts/smoke.js: never a
// hand-written script that launches apps/desktop/host/main.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, BrowserWindow } = require('electron');
const { FILE } = require('@multiagent/desktop/host/engine-connection');

process.env.MULTIAGENT_SIMULATION_ONLY = '1';
const out = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('-') && !a.endsWith('.js')) || 'smoke-remote');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-smoke-remote-'));
const appWorkspace = path.join(scratch, 'app-workspace');
const userData = path.join(scratch, 'user-data');
for (const d of [appWorkspace, userData, path.join(scratch, 'engine-workspace'), path.join(scratch, 'home')]) fs.mkdirSync(d, { recursive: true });
// the app's own workspace: remote mode must leave it empty (no lock, no index, no seeded workflows)
process.env.MULTIAGENT_WORKSPACE = appWorkspace;
// before the app is ready (its sessions live there); apps/desktop/host/main is required once the engine listens
process.env.MULTIAGENT_USER_DATA = userData; // a throwaway user data folder (the host reads it, main.js)
app.setPath('userData', userData);
const token = crypto.randomBytes(24).toString('base64url');
let engine = null;

const fail = (message) => {
  console.error(`smoke-remote: ${message}`);
  engine?.kill();
  app.exit(1);
};
setTimeout(() => fail('timed out'), 120000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// scripts/serve.js under this Electron as node, on a scratch workspace → its origin
function startEngine() {
  // a workspace already set up: the first-run Setup (#319) would cover the screenshots
  fs.writeFileSync(path.join(scratch, 'engine-workspace', 'settings.json'), JSON.stringify({ setupDone: true }));
  const home = path.join(scratch, 'home');
  const env = {
    ...process.env, ELECTRON_RUN_AS_NODE: '1', MULTIAGENT_AUTH: 'off', MULTIAGENT_SERVER_TOKEN: token, MULTIAGENT_MOCK_DELAY_SCALE: '0.02',
    MULTIAGENT_USER_DATA: path.join(scratch, 'engine-user-data'), HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
  };
  delete env.MULTIAGENT_WORKSPACE;
  engine = spawn(process.execPath, [path.join(__dirname, '..', 'packages', 'engine', 'bin', 'multiagent-engine.js'), '--port', '0', '--workspace', path.join(scratch, 'engine-workspace')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    let text = '';
    const read = (c) => {
      text += c;
      const m = text.match(/Open: (http:\/\/\S+)/);
      if (m) resolve(new URL(m[1]).origin);
    };
    engine.stdout.on('data', read);
    engine.stderr.on('data', (c) => { text += c; });
    engine.once('exit', (code) => reject(new Error(`the engine exited (${code}):\n${text}`)));
  });
}

// the first window whose page matches, once it has loaded
async function waitForWindow(test, what) {
  for (let i = 0; i < 300; i++) {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !x.webContents.isLoading() && test(x.webContents.getURL()));
    if (w) return w;
    await sleep(100);
  }
  throw new Error(`no ${what} window`);
}

async function waitFor(win, expression, what) {
  for (let i = 0; i < 100; i++) {
    if (await win.webContents.executeJavaScript(`!!(${expression})`).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`${what}: not seen`);
}

async function capture(win, name) {
  await sleep(500); // the page's transitions (a radio's check) end first
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(out, name), img.toPNG());
  console.log(`screenshot: ${path.join(out, name)}`);
}

async function checkRemoteWindow(origin) {
  const remote = await waitForWindow((u) => u.startsWith(`${origin}/apps/web/renderer/`), 'remote engine');
  const js = (code) => remote.webContents.executeJavaScript(code);
  await waitFor(remote, 'window.api && document.querySelector("#view-settings")', 'the app page');
  const where = await js('({ platform: api.platform, engine: api.engineConnection, preload: typeof require })');
  if (where.platform !== 'browser' || where.engine?.mode !== 'remote' || where.preload !== 'undefined') throw new Error(`not a remote page: ${JSON.stringify(where)}`);
  const project = await js(`api.createProject({ name: 'remote-smoke', folder: ${JSON.stringify(path.join(scratch, 'engine-workspace'))} })`);
  const engineProjects = fs.readdirSync(path.join(scratch, 'engine-workspace', 'projects'));
  if (!engineProjects.some((f) => f.startsWith(project.id))) throw new Error('the project was not created in the engine\'s workspace');
  await js('showView("settings"); showSettingsTab("execution")');
  await waitFor(remote, 'document.querySelector("[data-testid=settings-engine-mode]")', 'Settings › Execution › Engine');
  // what the row says, in any interface language (#329): its mode attribute, then its badge's text
  const mode = await js('document.querySelector("[data-testid=settings-engine]").dataset.engineMode');
  const badge = await js('document.querySelector("[data-testid=settings-engine-mode]").textContent');
  if (mode !== 'remote' || !badge.includes(new URL(origin).host)) throw new Error(`Settings › Engine says ${mode}: "${badge}"`);
  await capture(remote, 'remote.png');
  console.log(`remote window: ${remote.webContents.getURL()} (${badge})`);
  return remote;
}

async function checkConnectionPage(remote, origin) {
  await remote.webContents.executeJavaScript('document.querySelector("[data-testid=settings-engine-change]").click()');
  const page = await waitForWindow((u) => u.startsWith('file:') && u.includes('connection.html'), 'connection page');
  await waitFor(page, 'document.querySelector("#cn-now").textContent', 'the connection page\'s state');
  const now = await page.webContents.executeJavaScript('document.querySelector("#cn-now").textContent');
  if (!now.includes(new URL(origin).host)) throw new Error(`the connection page says "${now}"`);
  await capture(page, 'connection.png');
  // Cancel closes it and leaves the engine's window as it was
  const close = await page.webContents.executeJavaScript('document.querySelector("[data-testid=engine-connection-cancel]").dataset.close');
  if (close !== 'cancel') throw new Error(`the page's close button is "${close}" over the engine's window`);
  await page.webContents.executeJavaScript('document.querySelector("[data-testid=engine-connection-cancel]").click()');
  for (let i = 0; i < 50 && !page.isDestroyed(); i++) await sleep(100);
  if (!page.isDestroyed() || remote.isDestroyed()) throw new Error('Cancel did not close the page alone');
}

async function checkUnreachable(remote) {
  engine.kill();
  await new Promise((r) => (engine.exitCode !== null ? r() : engine.once('exit', r)));
  await sleep(300);
  remote.webContents.reload();
  const page = await waitForWindow((u) => u.startsWith('file:') && u.includes('connection.html'), 'connection page after the engine stopped');
  await waitFor(page, '!document.querySelector("[data-testid=engine-connection-failure]").classList.contains("hidden") && document.querySelector("#cn-failure-text").textContent', 'the failure');
  console.log(`engine stopped: ${await page.webContents.executeJavaScript('document.querySelector("#cn-failure-text").textContent')}`);
  await capture(page, 'unreachable.png');
  // the app's only window: its close button quits the app instead (not clicked: the check ends here)
  const close = await page.webContents.executeJavaScript('document.querySelector("[data-testid=engine-connection-cancel]").dataset.close');
  if (close !== 'quit') throw new Error(`the page alone has a "${close}" button, not Quit`);
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const origin = await startEngine();
  fs.writeFileSync(path.join(userData, FILE), JSON.stringify({ mode: 'remote', address: origin, token: { plain: token } }));
  require('@multiagent/desktop/host/main');
  await app.whenReady();
  const remote = await checkRemoteWindow(origin);
  await checkConnectionPage(remote, origin);
  await checkUnreachable(remote);
  const left = fs.readdirSync(appWorkspace);
  if (left.length) throw new Error(`the app opened a workspace of its own: ${left.join(', ')}`);
  console.log('smoke-remote: pass');
  app.exit(0);
}

main().catch((e) => fail(e.stack || e.message));
