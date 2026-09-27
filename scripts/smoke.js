// Smoke test da UI: abre o app, inicia o workflow em modo mock, aprova os
// gates automaticamente e salva um screenshot.
// Uso: npx electron scripts/smoke.js <saida.png>

const path = require('path');
const { app } = require('electron');
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.2';
require('../src/main');

const out = process.argv.find((a) => a.endsWith('.png')) || path.join(__dirname, '..', 'runs', 'smoke.png');

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => console.log(`[renderer:${level}] ${message}`));
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    await new Promise((r) => setTimeout(r, 1500));
    await js(`document.querySelector('#in-task').value = 'Adicionar endpoint /health'; document.querySelector('#in-repo_path').value = 'C:/Users/Eduardo/Desktop/multiagent'; document.querySelector('#btn-start').click();`);
    const timer = setInterval(() => js(`(document.querySelector('#approval-modal:not(.hidden) #approval-choices:not(.hidden) button') || document.querySelector('#approval-modal:not(.hidden) #btn-approve'))?.click()`), 1000);
    setTimeout(async () => {
      clearInterval(timer);
      await js(`document.querySelectorAll('.session-card')[1]?.click()`);
      await new Promise((r) => setTimeout(r, 500));
      const img = await win.webContents.capturePage();
      require('fs').writeFileSync(out, img.toPNG());
      console.log('screenshot:', out);
      console.log('status:', await js(`document.querySelector('#run-status').textContent`), '| erro:', await js(`document.querySelector('#start-error').textContent`));
      app.quit();
    }, 45000);
  });
});
