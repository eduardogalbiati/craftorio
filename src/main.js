const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { WorkflowRun, loadWorkflow } = require('./engine/workflow');
const { Recorder } = require('./engine/recorder');
const { resolveCommand } = require('./engine/providers');

const ROOT = path.join(__dirname, '..');
const WORKFLOWS_DIR = path.join(ROOT, 'workflows');
const RUNS_DIR = path.join(ROOT, 'runs');

let win = null;
let currentRun = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0e1014',
    title: 'Multiagent Orchestrator',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('workflows:list', () => {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  return fs.readdirSync(WORKFLOWS_DIR)
    .filter((f) => /\.ya?ml$/i.test(f))
    .map((file) => {
      try {
        const wf = loadWorkflow(path.join(WORKFLOWS_DIR, file));
        return {
          file,
          name: wf.metadata?.name || file,
          version: wf.metadata?.version,
          description: wf.metadata?.description,
          inputs: wf.inputs || {},
          agents: Object.fromEntries(Object.entries(wf.agents).map(([k, a]) => [k, { provider: a.provider, model: a.model, session: a.session }])),
          steps: wf.steps.map((s) => ({ id: s.id, type: s.type || 'agent', agent: s.agent || null })),
        };
      } catch (e) {
        return { file, name: file, error: e.message };
      }
    });
});

ipcMain.handle('env:check', () => ({
  claude: resolveCommand('claude')?.file || null,
  codex: resolveCommand('codex')?.file || null,
}));

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('run:start', (_e, { file, inputs, mock }) => {
  if (currentRun?.status === 'running') throw new Error('Já existe um workflow em execução.');
  const run = new WorkflowRun({ file: path.join(WORKFLOWS_DIR, path.basename(file)), inputs, mock, runsDir: RUNS_DIR });
  const recorder = new Recorder(run.runDir, run.wf.observability?.capture?.redact);
  run.on('event', (ev) => {
    try { recorder.write(ev); } catch (e) { console.error('recorder:', e); }
    if (win && !win.isDestroyed()) win.webContents.send('run:event', ev);
  });
  currentRun = run;
  run.start();
  return { runId: run.runId, runDir: run.runDir };
});

ipcMain.handle('run:stop', () => { currentRun?.stop(); return true; });

ipcMain.handle('approval:resolve', (_e, { id, approved }) => currentRun?.resolveApproval(id, approved) ?? false);

ipcMain.handle('run:openDir', () => {
  const dir = currentRun?.runDir || RUNS_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  currentRun?.stop();
  app.quit();
});
