// The app under test for the Playwright E2E suite (#222). launchApp() seeds a fresh scratch
// workspace with the demo data of scripts/screenshot.js (the project `demo-app`, its backlog, a
// roadmap with Tonight's runs, a local merge, the dependency cache) and the three agents' usage
// (src/analytics-demo.js, #280), and launches the real Electron
// app on it with Playwright's _electron (features/support/electron-main.js), in simulation:
// MULTIAGENT_SIMULATION_ONLY=1 (the engine refuses real runs, real providers and CLI terminals),
// sign-in off, HOME/USERPROFILE/APPDATA inside the scratch folder (no CLI session or account of this
// machine shows). Electron is never started as plain Node: ELECTRON_RUN_AS_NODE is removed.
// One Electron at a time on the machine (#199): each launch takes the machine-wide screenshot slot
// (src/engine/machine-slot.js, in machineSlotDir: not the suite step's own MULTIAGENT_LOCKS_DIR,
// so a release run waits for other runs' captures) and frees it on close. close() removes the scratch folder.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');
const demo = require('../../scripts/screenshot');
const machineSlot = require('../../src/engine/machine-slot');

const root = path.join(__dirname, '..', '..');
const src = (m) => require(path.join(root, 'src', m));

// The demo workspace: what every scenario starts from
async function seedWorkspace(wsDir) {
  const workspace = src('workspace');
  const projects = src('projects');
  const ws = workspace.setupWorkspace(wsDir, { persist: false });
  // the repository is set afterwards: createProject would clone it
  const created = await projects.createProject(ws.projects, { name: 'demo-app', description: 'Sample project (simulated data)' });
  const project = projects.updateProject(ws.projects, created.id, { repo: demo.DEMO_REPO });
  workspace.writeSettings(ws, { developerMode: true, lastWorkflow: 'software-development.yaml', lastProject: project.id });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${project.id}.json`), JSON.stringify(demo.demoBacklog(project.id, src('backlog').taskProgress), null, 2));
  demo.demoLocalMerge(ws, project.id);
  demo.demoRoadmap(ws, project.id);
  demo.demoDepsCache(ws, project.id);
  // Analytics' Agents tab (#280); no Oracle turn today: oracle.feature counts today's spend from zero
  src('analytics-demo').writeDemoAgents(ws, project.id, { today: false });
  if (project.folder) {
    fs.mkdirSync(project.folder, { recursive: true });
    fs.writeFileSync(path.join(project.folder, 'package.json'), JSON.stringify({ name: 'demo-app', private: true, scripts: { start: 'node server.js' } }, null, 2));
  }
  return { ws, project };
}

// The launched app's environment: simulation only, the scratch workspace, no Node mode
function appEnv(scratch, { theme, size }) {
  const home = path.join(scratch, 'home');
  for (const d of [home, path.join(home, 'AppData'), path.join(scratch, 'user-data')]) fs.mkdirSync(d, { recursive: true });
  const env = {
    ...process.env,
    MULTIAGENT_SIMULATION_ONLY: '1',
    MULTIAGENT_AUTH: 'off',
    MULTIAGENT_WORKSPACE: path.join(scratch, 'workspace'),
    MULTIAGENT_USER_DATA: path.join(scratch, 'user-data'),
    MULTIAGENT_MOCK_DELAY_SCALE: '0.02',
    MULTIAGENT_E2E_THEME: theme,
    MULTIAGENT_E2E_SIZE: size,
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
    GH_CONFIG_DIR: path.join(home, 'gh'), GLAB_CONFIG_DIR: path.join(home, 'glab'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function removeScratch(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* EBUSY: the OS temp folder cleans it */ }
}

/**
 * Launches the app on a fresh demo workspace → { app, window, project, scratch, close }.
 * theme: light | dark; size: WxH. No recordVideo: with Electron 44 it stalls the window before
 * its page loads (the trace's screencast is the scenario's video, features/steps/fixtures.js).
 */
async function launchApp({ theme = 'light', size = '1400x900' } = {}) {
  const slot = await machineSlot.acquireSlot('screenshot', {
    dir: machineSlot.machineSlotDir(), holder: 'e2e', onWait: (h) => console.log(`e2e: waiting for the screenshot slot (pid ${h?.pid ?? '?'})`),
  });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-e2e-'));
  let app = null;
  const close = async () => {
    if (app) await app.close().catch(() => {});
    slot.release();
    removeScratch(scratch);
  };
  try {
    const { project } = await seedWorkspace(path.join(scratch, 'workspace'));
    app = await electron.launch({
      executablePath: require('electron'),
      args: [path.join(__dirname, 'electron-main.js')],
      cwd: root,
      env: appEnv(scratch, { theme, size }),
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
  seedWorkspace,
};
