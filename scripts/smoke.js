// UI smoke test: opens the app, starts the workflow in mock mode, approves the
// gates automatically and saves a screenshot.
// Usage: npx electron scripts/smoke.js <output.png>

const path = require('path');
const { app } = require('electron');
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.2';
process.env.MULTIAGENT_WORKSPACE ??= path.join(__dirname, '..', 'runs', 'smoke-workspace'); // no workspace dialog
require('../src/main');

const out = process.argv.find((a) => a.endsWith('.png')) || path.join(__dirname, '..', 'runs', 'smoke.png');

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => console.log(`[renderer:${level}] ${message}`));
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    await new Promise((r) => setTimeout(r, 1500));
    // Registers this repository as a project (once), opens the "Start" panel and launches the workflow.
    const repo = JSON.stringify(path.join(__dirname, '..'));
    await js(`(async () => {
      const list = await api.listProjects();
      const p = list.find((x) => x.folder === ${repo}) || await api.createProject({ name: 'multiagent', folder: ${repo} });
      document.querySelector('#btn-quick-start').click();
      await new Promise((r) => setTimeout(r, 500));
      document.querySelector('#project-select').value = p.id;
      document.querySelector('#in-task').value = 'Add a /health endpoint';
      document.querySelector('#mock-toggle').checked = true;
      document.querySelector('#btn-start').click();
    })()`);
    const timer = setInterval(() => js(`(document.querySelector('#approval-modal:not(.hidden) #approval-choices:not(.hidden) button') || document.querySelector('#approval-modal:not(.hidden) #btn-approve'))?.click()`), 1000);
    setTimeout(async () => {
      clearInterval(timer);
      await js(`document.querySelectorAll('.session-card')[1]?.click()`);
      await new Promise((r) => setTimeout(r, 500));
      const img = await win.webContents.capturePage();
      require('fs').writeFileSync(out, img.toPNG());
      console.log('screenshot:', out);
      console.log('status:', await js(`document.querySelector('#run-status').textContent`), '| error:', await js(`document.querySelector('#start-error').textContent`));
      app.quit();
    }, 45000);
  });
});
