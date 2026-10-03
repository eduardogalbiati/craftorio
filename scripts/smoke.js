// UI smoke test: opens the app, starts the workflow in mock mode, approves the
// gates automatically and saves a screenshot.
// Usage: npx electron scripts/smoke.js <output.png>
//
// Never calls a real model: MULTIAGENT_SIMULATION_ONLY=1 makes the engine refuse real runs, the app
// opens a fresh temporary workspace (never the user's) with Developer mode on, and the script fails
// unless every session of the run was simulated. Write UI checks as scripts like this one, never as
// a hand-written script that launches src/main directly.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
process.env.MULTIAGENT_SIMULATION_ONLY = '1';
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.2';
const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-smoke-ws-'));
process.env.MULTIAGENT_WORKSPACE = wsDir; // scratch workspace, no workspace dialog
require('../src/main');

const out = process.argv.find((a) => a.endsWith('.png')) || path.join(__dirname, '..', 'runs', 'smoke.png');
setTimeout(() => { console.error('smoke: timed out'); app.exit(1); }, 90000);

// Every session of every run in the scratch workspace, with its provider: all must be 'mock' (the
// orchestrator's is 'engine', the deterministic walk, which calls no model).
function realSessions() {
  const runsDir = path.join(wsDir, 'runs');
  const found = [];
  for (const run of fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : []) {
    const dir = path.join(runsDir, run, 'sessions');
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        const provider = line.trim() && JSON.parse(line).session?.provider;
        if (provider && provider !== 'mock' && provider !== 'engine') found.push(`${run}/${f}: ${provider}`);
      }
    }
  }
  return found;
}

app.on('browser-window-created', (_e, win) => {
  // Electron 35+: the details come in the event object
  win.webContents.on('console-message', (ev) => console.log(`[renderer:${ev.level}] ${ev.message}`));
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    await new Promise((r) => setTimeout(r, 1500));
    // Registers this repository as a project, opens the "Start" panel and launches the workflow.
    const repo = JSON.stringify(path.join(__dirname, '..'));
    await js(`(async () => {
      const p = await api.createProject({ name: 'multiagent', folder: ${repo} });
      await api.setSettings({ developerMode: true, lastWorkflow: 'software-development.yaml' });
      document.querySelector('#btn-quick-start').click();
      await new Promise((r) => setTimeout(r, 500));
      document.querySelector('#project-select').value = p.id;
      document.querySelector('#in-task').value = 'Add a /health endpoint';
      document.querySelector('#mock-toggle').checked = true;
      if (!document.body.classList.contains('dev-mode')) throw new Error('developer mode is off: refusing to start a real run');
      document.querySelector('#btn-start').click();
    })()`);
    const timer = setInterval(() => js(`document.querySelector('#run-gates:not(.hidden) .run-gate-actions button[data-choice]:not(:disabled), #run-gates:not(.hidden) button[data-answer=\"true\"]:not(:disabled)')?.click()`), 1000);
    setTimeout(() => finish().catch((e) => { console.error('smoke:', e); app.exit(1); }), 45000);
    async function finish() {
      clearInterval(timer);
      await js(`document.querySelectorAll('.session-card')[1]?.click()`);
      await new Promise((r) => setTimeout(r, 500));
      const img = await win.webContents.capturePage();
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, img.toPNG());
      console.log('screenshot:', out);
      console.log('status:', await js(`document.querySelector('#run-status').textContent`), '| error:', await js(`document.querySelector('#start-error').textContent`));
      const real = realSessions();
      if (real.length) { console.error('smoke: sessions that were not simulated:', real); app.exit(1); return; }
      console.log('sessions: all simulated (mock)');
      app.quit();
    }
  });
});
