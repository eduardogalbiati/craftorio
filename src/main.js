const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { WorkflowRun, loadWorkflow } = require('./engine/workflow');
const { Recorder } = require('./engine/recorder');
const { resolveCommand } = require('./engine/providers');
const workspace = require('./workspace');
const projects = require('./projects');
const skills = require('./skills');
const usage = require('./usage');
const { readLocalUsage } = require('./local-usage');

const ROOT = path.join(__dirname, '..');
const WORKFLOWS_DIR = path.join(ROOT, 'workflows');
const BUNDLED_SKILLS_DIR = path.join(ROOT, 'skills'); // skills bundled with the app

let win = null;
let currentRun = null;
let ws = null; // { root, runs, repos, projects, skills, settings } (see src/workspace.js)

// Resolves the workspace before opening the window. If the registered folder (or the default
// ~/multiagent-workspace) does not exist, asks whether to create the default or pick another.
async function ensureWorkspace() {
  const r = workspace.resolveWorkspace();
  if (r.dir) return workspace.setupWorkspace(r.dir, { persist: r.source !== 'env' });

  const reason = r.registered
    ? `The registered workspace folder no longer exists:\n${r.registered}`
    : `Workspace folder not found:\n${r.fallback}`;
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'Workspace',
      message: 'Choose the workspace folder',
      detail: `${reason}\n\nIt holds the run logs and cloned repositories. The path is saved and reloaded the next time the app opens.`,
      buttons: [`Create ${r.fallback}`, 'Choose another folder…', 'Quit'],
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
  const opts = { title: 'Workspace folder', properties: ['openDirectory', 'createDirectory'], defaultPath: ws?.root || os.homedir() };
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
          category: wf.metadata?.category || 'build',
          tags: wf.metadata?.tags || [],
          inputs: wf.inputs || {},
          agents: Object.fromEntries(Object.entries(wf.agents).map(([k, a]) => [k, { provider: a.provider, model: a.model, session: a.session, skills: a.skills || [] }])),
          steps: wf.steps.map((s) => ({
            id: s.id,
            type: s.type || 'agent',
            agent: s.agents ? s.agents.join(' · ') : s.agent || null,
            agents: s.agents || null,
            skills: s.skills || [],
            goal: !!s.goal,
            loop: !!s.loop,
            next: [...new Set((s.transitions || []).map((t) => t.goto).filter(Boolean))],
          })),
        };
      } catch (e) {
        return { file, name: file, error: e.message, steps: [] };
      }
    });
});

ipcMain.handle('env:check', () => ({
  claude: resolveCommand('claude')?.file || null,
  codex: resolveCommand('codex')?.file || null,
  grok: resolveCommand('grok')?.file || null,
}));

// Details for the Settings screen: path, version and (gh) authentication of each CLI.
function runTool(file, args, shellMode) {
  return new Promise((resolve) => {
    const cmd = shellMode ? `"${file}"` : file;
    execFile(cmd, args, { windowsHide: true, timeout: 15000, shell: shellMode }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() }));
  });
}

ipcMain.handle('env:details', async () => {
  const tools = [
    { id: 'claude', name: 'Claude Code', args: ['--version'] },
    { id: 'codex', name: 'Codex CLI', args: ['--version'], auth: ['login', 'status'] },
    // `grok models` fails when not logged in and prints "You are logged in with ..." otherwise
    { id: 'grok', name: 'Grok Build', args: ['--version'], auth: ['models'] },
    { id: 'gh', name: 'GitHub CLI', args: ['--version'], auth: ['auth', 'status'] },
    { id: 'glab', name: 'GitLab CLI', args: ['--version'], auth: ['auth', 'status'] },
    { id: 'git', name: 'Git', args: ['--version'] },
  ];
  return Promise.all(tools.map(async (t) => {
    const r = resolveCommand(t.id);
    if (!r) return { id: t.id, name: t.name, path: null, connected: false };
    const v = await runTool(r.file, t.args, r.shell);
    const out = { id: t.id, name: t.name, path: r.file, version: v.ok ? v.out.split(/\r?\n/)[0] : null, connected: v.ok, auth: !!t.auth };
    if (t.auth) {
      const a = await runTool(r.file, t.auth, r.shell);
      out.connected = a.ok;
      out.account = (a.out.match(/account (\S+)/) || a.out.match(/as (\S+)/) || [])[1] || null;
    }
    return out;
  }));
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  workflowsDir: WORKFLOWS_DIR,
}));

ipcMain.handle('path:open', (_e, p) => {
  const allowed = [ws.root, WORKFLOWS_DIR, ...projects.listProjects(ws.projects).map((x) => x.folder)];
  const norm = (x) => { const r = path.resolve(x); return process.platform === 'win32' ? r.toLowerCase() : r; };
  if (!allowed.some((dir) => norm(p) === norm(dir) || norm(p).startsWith(norm(dir) + path.sep))) throw new Error('Path is outside the workspace.');
  return shell.openPath(p);
});

// ---- settings ---------------------------------------------------------------
ipcMain.handle('settings:get', () => workspace.readSettings(ws));
ipcMain.handle('settings:set', (_e, patch) => workspace.writeSettings(ws, patch));

// ---- projects -----------------------------------------------------------------
ipcMain.handle('projects:list', () => projects.listProjects(ws.projects));
ipcMain.handle('projects:create', (_e, data) => projects.createProject(ws.projects, data));
ipcMain.handle('projects:update', (_e, { id, patch }) => projects.updateProject(ws.projects, id, patch));
ipcMain.handle('projects:remove', (_e, id) => projects.removeProject(ws.projects, id));

// ---- skills -------------------------------------------------------------------
ipcMain.handle('skills:list', () => skills.listSkills(ws.skills));
ipcMain.handle('skills:create', (_e, data) => skills.createSkill(ws.skills, data));
ipcMain.handle('skills:save', (_e, { id, data }) => skills.saveSkill(ws.skills, id, data));
// Moves to the trash (recoverable), does not delete permanently.
ipcMain.handle('skills:remove', (_e, id) => shell.trashItem(path.join(ws.skills, path.basename(id))));

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: ws.projects });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('workspace:get', () => ({ ...ws, registry: process.env[workspace.ENV_VAR] ? null : workspace.defaultStore().describe }));

ipcMain.handle('workspace:change', async () => {
  if (currentRun?.status === 'running') throw new Error('Cannot change the workspace while a workflow is running.');
  const dir = await pickWorkspaceDir(win);
  if (dir) {
    ws = workspace.setupWorkspace(dir);
    try { skills.seedSkills(BUNDLED_SKILLS_DIR, ws.skills); } catch (e) { console.error('skill seeding:', e); }
  }
  return ws;
});

ipcMain.handle('workspace:open', () => shell.openPath(ws.root));

ipcMain.handle('run:start', async (_e, { file, inputs, mock }) => {
  if (currentRun?.status === 'running') throw new Error('A workflow is already running.');
  // repo_path can be a git URL: clones (or updates) it into <workspace>/repos.
  if (workspace.isGitUrl(inputs?.repo_path)) {
    inputs = { ...inputs, repo_path: (await workspace.cloneRepo(inputs.repo_path, ws.repos)).dir };
  }
  const settings = workspace.readSettings(ws);
  // budgets that count usage outside the orchestrator need the CLIs' own logs
  const needsLocal = Object.values(settings.budgets || {}).some((b) => b?.countOutside);
  const budget = usage.budgetBaseline({ runsDir: ws.runs, settings, local: needsLocal ? readLocalUsage() : null });
  const run = new WorkflowRun({
    file: path.join(WORKFLOWS_DIR, path.basename(file)), inputs, mock, runsDir: ws.runs, skillsDirs: [ws.skills],
    budget, prices: settings.prices,
  });
  if (!mock) {
    const problems = usage.preflight(run.wf, budget, resolveCommand, run.inputs);
    if (problems.length) throw new Error(problems.join('\n'));
  }
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

// ---- usage and budgets ------------------------------------------------------------
function usageSnapshot(scope = 'orchestrator') {
  const r = currentRun;
  const live = r?.status === 'running' && !r.mock
    ? { run_id: r.runId, workflow: r.wf.metadata?.name, started_at: new Date(r.startedAt).toISOString(), sessions: [...r.sessions.values()].map((x) => r.snapshot(x)) }
    : null;
  const installed = Object.fromEntries(usage.PROVIDERS.map((p) => [p.id, !!resolveCommand(p.command)]));
  const local = scope === 'machine' ? readLocalUsage() : null;
  return usage.computeUsage({ runsDir: ws.runs, settings: workspace.readSettings(ws), live, installed, scope, local });
}

const num = (v) => (v === '' || v == null || !Number.isFinite(+v) || +v <= 0 ? null : +v);

ipcMain.handle('usage:get', (_e, opts) => usageSnapshot(opts?.scope));

ipcMain.handle('usage:setBudget', (_e, { provider, budget, scope }) => {
  if (!usage.PROVIDERS.some((p) => p.id === provider)) throw new Error(`Unknown provider: ${provider}`);
  const budgets = { ...workspace.readSettings(ws).budgets };
  budgets[provider] = {
    monthlyUsd: num(budget?.monthlyUsd), monthlyTokens: num(budget?.monthlyTokens),
    blockOnLimit: budget?.blockOnLimit !== false, countOutside: !!budget?.countOutside,
  };
  workspace.writeSettings(ws, { budgets });
  return usageSnapshot(scope);
});

ipcMain.handle('usage:setPrice', (_e, { model, price, scope }) => {
  if (!String(model || '').trim()) throw new Error('Model is required.');
  const prices = { ...workspace.readSettings(ws).prices };
  const clean = { input: +price?.input || 0, output: +price?.output || 0, cache_read: +price?.cache_read || 0 };
  if (!clean.input && !clean.output && !clean.cache_read) delete prices[model];
  else prices[model] = clean;
  workspace.writeSettings(ws, { prices });
  return usageSnapshot(scope);
});

// answer: true/false or the id of a choice
ipcMain.handle('approval:resolve', (_e, { id, answer }) => currentRun?.resolveApproval(id, answer) ?? false);

ipcMain.handle('run:openDir', () => {
  const dir = currentRun?.runDir || ws.runs;
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

app.whenReady().then(async () => {
  ws = await ensureWorkspace();
  if (!ws) return app.quit();
  try { skills.seedSkills(BUNDLED_SKILLS_DIR, ws.skills); } catch (e) { console.error('skill seeding:', e); }
  createWindow();
});
app.on('window-all-closed', () => {
  currentRun?.stop();
  app.quit();
});
