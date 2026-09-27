const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { WorkflowRun, loadWorkflow } = require('./engine/workflow');
const { Recorder } = require('./engine/recorder');
const { resolveCommand } = require('./engine/providers');
const workspace = require('./workspace');

const ROOT = path.join(__dirname, '..');
const WORKFLOWS_DIR = path.join(ROOT, 'workflows');

let win = null;
let currentRun = null;
let ws = null; // { root, runs, repos }: logs em runs/, clones em repos/ (ver src/workspace.js)

// Resolve o workspace antes de abrir a janela. Se a pasta registrada (ou a padrão
// ~/multiagent-workspace) não existir, pergunta se cria a padrão ou escolhe outra.
async function ensureWorkspace() {
  const r = workspace.resolveWorkspace();
  if (r.dir) return workspace.setupWorkspace(r.dir, { persist: r.source !== 'env' });

  const reason = r.registered
    ? `A pasta de workspace registrada não existe mais:\n${r.registered}`
    : `Não encontrei a pasta de workspace:\n${r.fallback}`;
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'Workspace',
      message: 'Escolha a pasta de workspace',
      detail: `${reason}\n\nNela ficam os logs dos runs e os repositórios clonados. O caminho fica registrado e é recarregado nas próximas aberturas.`,
      buttons: [`Criar ${r.fallback}`, 'Escolher outra pasta…', 'Sair'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 0) return workspace.setupWorkspace(r.fallback);
    if (response === 2) return null;
    const dir = await pickWorkspaceDir();
    if (dir) return workspace.setupWorkspace(dir);
  }
}

async function pickWorkspaceDir(parent) {
  const opts = { title: 'Pasta de workspace', properties: ['openDirectory', 'createDirectory'], defaultPath: ws?.root || os.homedir() };
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : r.filePaths[0];
}

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
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: ws.repos });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('workspace:get', () => ({ ...ws, registry: process.env[workspace.ENV_VAR] ? null : workspace.defaultStore().describe }));

ipcMain.handle('workspace:change', async () => {
  if (currentRun?.status === 'running') throw new Error('Não é possível trocar o workspace com um workflow em execução.');
  const dir = await pickWorkspaceDir(win);
  if (dir) ws = workspace.setupWorkspace(dir);
  return ws;
});

ipcMain.handle('workspace:open', () => shell.openPath(ws.root));

ipcMain.handle('run:start', async (_e, { file, inputs, mock }) => {
  if (currentRun?.status === 'running') throw new Error('Já existe um workflow em execução.');
  // repo_path pode ser uma URL git: clona (ou atualiza) em <workspace>/repos.
  if (workspace.isGitUrl(inputs?.repo_path)) {
    inputs = { ...inputs, repo_path: (await workspace.cloneRepo(inputs.repo_path, ws.repos)).dir };
  }
  const run = new WorkflowRun({ file: path.join(WORKFLOWS_DIR, path.basename(file)), inputs, mock, runsDir: ws.runs });
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

// answer: true/false ou o id de uma choice
ipcMain.handle('approval:resolve', (_e, { id, answer }) => currentRun?.resolveApproval(id, answer) ?? false);

ipcMain.handle('run:openDir', () => {
  const dir = currentRun?.runDir || ws.runs;
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

app.whenReady().then(async () => {
  ws = await ensureWorkspace();
  if (!ws) return app.quit();
  createWindow();
});
app.on('window-all-closed', () => {
  currentRun?.stop();
  app.quit();
});
