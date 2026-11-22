// The app under test for the Playwright E2E suite (#222). launchApp() seeds a fresh scratch
// workspace with the demo data of scripts/screenshot.js (the project `demo-app`, its backlog, a
// roadmap with Tonight's runs, a local merge, the dependency cache) and the three agents' usage
// (packages/engine/domains/analytics/analytics-demo.js, #280), and launches the real Electron
// app on it with Playwright's _electron (features/support/electron-main.js), in simulation:
// MULTIAGENT_SIMULATION_ONLY=1 (the engine refuses real runs, real providers and CLI terminals),
// sign-in off, HOME/USERPROFILE/APPDATA inside the scratch folder (no CLI session or account of this
// machine shows). Electron is never started as plain Node: ELECTRON_RUN_AS_NODE is removed.
// A launch with slot: true (the visual lane, #365) takes the machine-wide screenshot slot (#199,
// packages/engine/engine/machine-slot.js, in machineSlotDir: not the suite step's own MULTIAGENT_LOCKS_DIR,
// so a release run waits for other runs' captures) and frees it on close; the behaviour lane's
// launches (slot: false) never wait for it. close() removes the scratch folder.
// The app runs in English whatever the computer's language (#444): the demo workspace chooses
// English as its interface language, and the launch pins the locale (en-US, LANG/LC_ALL), so an
// empty workspace (Setup, #319) is English too; a scenario that wants Portuguese chooses it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');
const demo = require('../../scripts/screenshot');
const machineSlot = require('@craftorio/engine/engine/machine-slot');
const { shiftClock } = require('./fixed-clock');
const workflows = require('./workflows');

const root = path.join(__dirname, '..', '..');
const src = (m) => require(path.join(root, 'packages', 'engine', m));

// The demo workspace: what every scenario starts from
async function seedWorkspace(wsDir) {
  const workspace = src('domains/workspace/workspace');
  const projects = src('domains/project/projects');
  const ws = workspace.setupWorkspace(wsDir, { persist: false });
  // the repository is set afterwards: createProject would clone it
  const created = await projects.createProject(ws.projects, { name: 'demo-app', description: 'Sample project (simulated data)' });
  const project = projects.updateProject(ws.projects, created.id, { repo: demo.DEMO_REPO });
  // #444: English chosen, not "same as the computer" (writeSettings merges one level: keep the language defaults)
  const language = { ...workspace.readSettings(ws).language, interface: 'en' };
  workspace.writeSettings(ws, { developerMode: true, lastWorkflow: workflows.FEATURE.file, lastProject: project.id, language });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${project.id}.json`), JSON.stringify(demo.demoBacklog(project.id, src('domains/backlog/backlog').taskProgress), null, 2));
  demo.demoLocalMerge(ws, project.id);
  demo.demoRoadmap(ws, project.id);
  demo.demoDepsCache(ws, project.id);
  // Analytics' Agents tab (#280); no Oracle turn today: oracle.feature counts today's spend from zero
  src('domains/analytics/analytics-demo').writeDemoAgents(ws, project.id, { today: false });
  if (project.folder) {
    fs.mkdirSync(project.folder, { recursive: true });
    fs.writeFileSync(path.join(project.folder, 'package.json'), JSON.stringify({ name: 'demo-app', private: true, scripts: { start: 'node server.js' } }, null, 2));
  }
  return { ws, project };
}

// The launched app's environment: simulation only, the scratch workspace, no Node mode.
// mockDelayScale: the simulated turns' speed (default 0.02: a turn in well under a second; #368's
// pause scenarios use a larger one so an agent's turn lasts long enough to be paused during it)
// extra: more variables for the app, e.g. { MULTIAGENT_NO_SANDBOX: '1' } (#476: what the Linux
// AppImage's launcher sets when it starts the app without Chromium's sandbox)
function appEnv(scratch, { theme, size, now, mockDelayScale = 0.02, extra = {} }) {
  const home = path.join(scratch, 'home');
  for (const d of [home, path.join(home, 'AppData'), path.join(scratch, 'user-data')]) fs.mkdirSync(d, { recursive: true });
  const env = {
    ...process.env,
    MULTIAGENT_SIMULATION_ONLY: '1',
    MULTIAGENT_AUTH: 'off',
    MULTIAGENT_WORKSPACE: path.join(scratch, 'workspace'),
    MULTIAGENT_USER_DATA: path.join(scratch, 'user-data'),
    MULTIAGENT_MOCK_DELAY_SCALE: String(mockDelayScale),
    MULTIAGENT_E2E_THEME: theme,
    MULTIAGENT_E2E_SIZE: size,
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
    GH_CONFIG_DIR: path.join(home, 'gh'), GLAB_CONFIG_DIR: path.join(home, 'glab'),
    ...extra,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  if (now != null) env.MULTIAGENT_E2E_NOW = String(now);
  else delete env.MULTIAGENT_E2E_NOW;
  return env;
}

// The machine's screenshot slot (#199) when take is set, else a no-op holder (#365) → { release }
async function screenshotSlot(take) {
  if (!take) return { release() {} };
  return machineSlot.acquireSlot('screenshot', {
    dir: machineSlot.machineSlotDir(), holder: 'e2e', onWait: (h) => console.log(`e2e: waiting for the screenshot slot (pid ${h?.pid ?? '?'})`),
  });
}

function removeScratch(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* EBUSY: the OS temp folder cleans it */ }
}

/**
 * Launches the app on a fresh demo workspace → { app, window, project, scratch, close }.
 * theme: light | dark; size: WxH; empty: true leaves the workspace folder unseeded (a first start:
 * no settings.json, no project; project is null, #319); now: a fixed clock (ms, #362,
 * features/support/fixed-clock.js) for the seed and the app's main process, the real one without it.
 * mockDelayScale: MULTIAGENT_MOCK_DELAY_SCALE for the app (default 0.02).
 * slot: hold the machine's screenshot slot while the app is open (#365: the visual lane).
 * env: more environment variables for the app (appEnv's extra, #476).
 * No recordVideo: with Electron 44 it stalls the window before its page loads (the trace's
 * screencast is the scenario's video, features/steps/fixtures.js).
 */
async function launchApp({ theme = 'light', size = '1400x900', empty = false, now = null, mockDelayScale, slot: takeSlot = true, env = {} } = {}) {
  const slot = await screenshotSlot(takeSlot);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-e2e-'));
  let app = null;
  const close = async () => {
    if (app) await app.close().catch(() => {});
    slot.release();
    removeScratch(scratch);
  };
  try {
    let project = null;
    if (!empty) {
      const restore = now != null ? shiftClock(now) : () => {};
      try { ({ project } = await seedWorkspace(path.join(scratch, 'workspace'))); } finally { restore(); }
    }
    app = await electron.launch({
      executablePath: require('electron'),
      args: [path.join(__dirname, 'electron-main.js')],
      cwd: root,
      env: appEnv(scratch, { theme, size, now, mockDelayScale, extra: env }),
      locale: 'en-US',
      timeout: 60000,
    });
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    return { app, window, project, scratch, close };
  } catch (e) {
    await close();
    throw e;
  }
}

module.exports = {
  launchApp,
  screenshotSlot,
  seedWorkspace,
};
