const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const { WorkflowRun, loadWorkflow } = require('./engine/workflow');
const { Recorder } = require('./engine/recorder');
const { resolveCommand } = require('./engine/providers');
const workspace = require('./workspace');
const projects = require('./projects');
const skills = require('./skills');
const usage = require('./usage');
const { readLocalUsage } = require('./local-usage');
const runs = require('./runs');
const { Terminals } = require('./terminals');
const { followSession } = require('./session-tail');
const supervisor = require('./supervisor');
const { cleanupWorktrees } = require('./engine/worktree');

const workflows = require('./workflows');

const ROOT = path.join(__dirname, '..');
// Bundled defaults (read-only in the packaged app): only a seed source for the workspace copies.
const BUNDLED_WORKFLOWS_DIR = workflows.BUNDLED_WORKFLOWS_DIR;
const BUNDLED_SKILLS_DIR = path.join(ROOT, 'skills');

let win = null;
let currentRun = null;
let ws = null; // { root, runs, repos, projects, skills, workflows, worktrees, settings } (see src/workspace.js)

// Copies/updates the bundled skills and workflows into the workspace (src/seed.js).
function seedDefaults() {
  try { skills.seedSkills(BUNDLED_SKILLS_DIR, ws.skills); } catch (e) { console.error('skill seeding:', e); }
  try { workflows.seedWorkflows(BUNDLED_WORKFLOWS_DIR, ws.workflows); } catch (e) { console.error('workflow seeding:', e); }
}

// Workflows are read from the workspace; the bundled copy is a fallback for runs whose workflow
// file the user deleted (e.g. resuming an old run).
const workflowDirs = () => [ws.workflows, BUNDLED_WORKFLOWS_DIR];
const workflowPath = (file) => workflows.resolveWorkflow(path.basename(String(file || '')), workflowDirs());

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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('workflows:list', () => {
  if (!fs.existsSync(ws.workflows)) return [];
  const status = workflows.workflowStatus(BUNDLED_WORKFLOWS_DIR, ws.workflows);
  const bundledVersion = (file) => { try { return loadWorkflow(path.join(BUNDLED_WORKFLOWS_DIR, file)).metadata?.version || null; } catch { return null; } };
  return fs.readdirSync(ws.workflows)
    .filter(workflows.isWorkflowFile)
    .map((file) => {
      // origin: default (untouched bundled copy), modified (edited bundled copy) or custom (user-created)
      const st = status[file] || { origin: 'custom', updateAvailable: false, restorable: false };
      const origin = { origin: st.origin, updateAvailable: st.updateAvailable, restorable: st.restorable, bundledVersion: st.updateAvailable ? bundledVersion(file) : null };
      try {
        const wf = loadWorkflow(path.join(ws.workflows, file));
        return {
          file,
          ...origin,
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
        return { file, ...origin, name: file, error: e.message, steps: [] };
      }
    });
});

// Replaces the user's edited copy of a bundled workflow with the default; the edited copy goes to
// the trash (recoverable).
ipcMain.handle('workflows:restore', async (_e, file) => {
  const name = path.basename(String(file || ''));
  if (!workflows.workflowStatus(BUNDLED_WORKFLOWS_DIR, ws.workflows)[name]?.restorable) throw new Error(`"${name}" has no bundled default to restore.`);
  await shell.trashItem(path.join(ws.workflows, name));
  workflows.restoreWorkflow(BUNDLED_WORKFLOWS_DIR, ws.workflows, name);
  return true;
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
  workflowsDir: ws.workflows,
}));

ipcMain.handle('path:open', (_e, p) => {
  const allowed = [ws.root, ...projects.listProjects(ws.projects).map((x) => x.folder)];
  const norm = (x) => { const r = path.resolve(x); return process.platform === 'win32' ? r.toLowerCase() : r; };
  if (!allowed.some((dir) => norm(p) === norm(dir) || norm(p).startsWith(norm(dir) + path.sep))) throw new Error('Path is outside the workspace.');
  return shell.openPath(p);
});

// ---- settings ---------------------------------------------------------------
ipcMain.handle('settings:get', () => workspace.readSettings(ws));
ipcMain.handle('settings:set', (_e, patch) => workspace.writeSettings(ws, patch));

// ---- projects -----------------------------------------------------------------
ipcMain.handle('projects:list', () => projects.listProjects(ws.projects));
ipcMain.handle('projects:create', (_e, data) => projects.createProject(ws.projects, data, { reposDir: ws.repos }));
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
    seedDefaults();
  }
  return ws;
});

ipcMain.handle('workspace:open', () => shell.openPath(ws.root));

ipcMain.handle('run:start', (_e, { file, inputs, mock }) => startWorkflowRun({ file, inputs, mock }));

async function startWorkflowRun({ file, inputs, mock, resume = null, projectId: forcedProject = null }) {
  if (currentRun?.status === 'running') throw new Error('A workflow is already running.');
  // repo_path can be a git URL: clones (or updates) it into <workspace>/repos.
  if (workspace.isGitUrl(inputs?.repo_path)) {
    inputs = { ...inputs, repo_path: (await workspace.cloneRepo(inputs.repo_path, ws.repos)).dir };
  }
  const settings = workspace.readSettings(ws);
  const folders = Object.values(inputs || {}).filter((v) => typeof v === 'string' && /[\\/]/.test(v)).map((v) => path.resolve(v).toLowerCase());
  const projectId = forcedProject || projects.listProjects(ws.projects).find((p) => p.folder && folders.includes(path.resolve(p.folder).toLowerCase()))?.id || null;
  // budgets that count usage outside the orchestrator need the CLIs' own logs
  const needsLocal = Object.values(settings.budgets || {}).some((b) => b?.countOutside);
  const budget = usage.budgetBaseline({ runsDir: ws.runs, settings, local: needsLocal ? readLocalUsage() : null });
  const wfFile = workflowPath(file);
  const notices = [];
  if (wfFile.fallback) {
    const msg = `workflow ${path.basename(wfFile.file)} is not in ${ws.workflows}; using the copy bundled with the app (${wfFile.file})`;
    console.warn(msg);
    notices.push({ level: 'warn', message: msg });
  }
  const run = new WorkflowRun({
    file: wfFile.file, inputs, mock, runsDir: ws.runs, skillsDirs: [ws.skills], notices,
    budget, prices: settings.prices, projectId, resume,
    // simulation runs never touch git: the agents are mocked and work in the repository folder
    worktreesDir: mock ? null : ws.worktrees,
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
}

ipcMain.handle('run:stop', () => { currentRun?.stop(); return true; });

// ---- session terminals --------------------------------------------------------------
// Opens a separate terminal window for an agent session of any run (default: the current one):
// - live: follows the session's log (src/session-tail.js, run by the Electron binary in
//   Node mode, so it also works in the packaged app);
// - cli: the provider's interactive CLI resuming the same conversation in the session's
//   folder (claude --resume / codex resume / grok --resume).
const RESUME_ARGS = { 'claude-code': (id) => ['--resume', id], 'codex-cli': (id) => ['resume', id], 'grok-cli': (id) => ['--resume', id] };
const q = (a) => `"${String(a).replace(/"/g, '""')}"`;

function openTerminal({ title, cwd, file, args, env }) {
  if (process.platform !== 'win32') throw new Error('Opening a terminal is only supported on Windows for now.');
  const cmdline = [file, ...args].map(q).join(' ');
  // start "<title>" /D "<cwd>" cmd /k "<command line>": a new console that stays open on exit
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `start ${q(title)} /D ${q(cwd)} cmd /k "${cmdline}"`], {
    windowsVerbatimArguments: true, detached: true, stdio: 'ignore', env,
  });
  child.unref();
}

const isCurrent = (runId) => !runId || (currentRun && currentRun.runId === runId);

// A session in the same shape whether it comes from the live engine or from a run on disk.
function sessionView(x, live) {
  return {
    id: x.id, agent: x.agent, provider: x.provider, model: x.model, status: x.status,
    providerSessionId: live ? x.providerSessionId : x.provider_session_id || null,
    cwd: x.cwd || null, turns: x.turns || 0, costUsd: live ? x.costUsd : x.cost_usd || 0,
  };
}

// Provider config of a run's workflow: the live one, or the workflow file named in its events.
function runProviders(runId, file) {
  if (isCurrent(runId) && currentRun) return currentRun.wf.providers || {};
  try { return loadWorkflow(workflowPath(file).file).providers || {}; } catch { return {}; }
}

// Why "Open in CLI" is not possible for a session ('' = possible).
function cliReason(sess, providers, running) {
  if (sess.agent === 'orchestrator') return 'The orchestrator is the app itself: only its live log can be opened.';
  if (sess.provider === 'mock') return 'Simulated sessions have no CLI conversation.';
  if (!sess.providerSessionId) return 'No provider conversation yet: the first turn has not finished.';
  if (running && (sess.status === 'active' || sess.status === 'retrying')) return 'The agent is in the middle of a turn.';
  const cfg = providers[sess.provider];
  if (!cfg || !RESUME_ARGS[cfg.type]) return `Provider "${sess.provider}" cannot be opened interactively.`;
  if (!resolveCommand(cfg.command)) return `Command "${cfg.command}" is not installed.`;
  return '';
}

// Everything needed to open a session: from the current run, or from the run folder on disk.
function findSession(runId, sessionId) {
  if (isCurrent(runId) && currentRun) {
    const x = currentRun.sessions.get(sessionId);
    return x && { run: { runDir: currentRun.runDir, file: path.basename(currentRun.file), inputs: currentRun.inputs, running: currentRun.status === 'running' }, sess: sessionView(x, true) };
  }
  const r = runs.readRun(ws.runs, path.basename(String(runId)));
  const x = r?.sessions.find((y) => y.id === sessionId);
  return x && { run: { runDir: r.runDir, file: r.file, inputs: r.inputs, running: false }, sess: sessionView(x, false) };
}

// What to run to watch (live) or resume (cli) a session: { title, file, args, cwd, env }.
function terminalSpec(runId, sessionId, mode) {
  const found = findSession(runId, sessionId);
  if (!found) throw new Error('Session not found.');
  const { run, sess } = found;
  const env = { ...process.env };
  delete env.CLAUDECODE;
  if (mode === 'live') {
    return {
      title: sess.agent === 'orchestrator' ? 'orchestrator · live' : `${sess.agent} (${sess.id}) · live`,
      cwd: run.runDir, file: process.execPath,
      args: [path.join(__dirname, 'session-tail.js'), run.runDir, sess.id], env: { ...env, ELECTRON_RUN_AS_NODE: '1', FORCE_COLOR: '1' },
    };
  }
  const providers = runProviders(runId, run.file);
  const why = cliReason(sess, providers, run.running);
  if (why) throw new Error(why);
  const cfg = providers[sess.provider];
  // older runs did not record the session folder, and a succeeded run's worktree is removed:
  // fall back to the run's repo/project folder
  const folder = [sess.cwd, run.inputs?.repo_path, run.inputs?.project_path].find((d) => d && fs.existsSync(d)) || run.runDir;
  delete env.ELECTRON_RUN_AS_NODE;
  return { title: `${sess.agent} (${sess.id}) · ${cfg.command}`, cwd: folder, file: resolveCommand(cfg.command).file, args: RESUME_ARGS[cfg.type](sess.providerSessionId), env };
}

// Interactive chat with the supervisor about a run: the provider's CLI in the run folder, with the
// run report written to supervisor/context.md and a first message that points to it.
function supervisorChatSpec(runId) {
  const runDir = runFolder(runId);
  const cfg = supervisor.supervisorConfig(runDir, workflowDirs());
  const skill = skills.resolveSkill([ws.skills, path.join(ROOT, 'skills')], 'run-supervisor');
  const ctxFile = path.join(runDir, 'supervisor', 'context.md');
  fs.mkdirSync(path.dirname(ctxFile), { recursive: true });
  fs.writeFileSync(ctxFile, supervisor.runReport(runDir, { workflowsDir: workflowDirs() }));
  const cmd = resolveCommand(cfg.provider.command || 'claude');
  if (!cmd) throw new Error(`The supervisor needs ${cfg.provider.command}, which is not installed.`);
  const first = `You are the supervisor of the multi-agent workflow run in this folder. Read ${path.join(skill.path, 'SKILL.md')} (your method) and supervisor/context.md (the run report); events.jsonl, sessions/ and the other files have the details. Then explain briefly what happened in this run and wait for my questions. Do not change any file.`;
  const args = {
    'claude-code': ['--model', cfg.model, '--permission-mode', 'plan', '--add-dir', skill.path, first],
    'codex-cli': ['-m', cfg.model, '-s', 'read-only', first],
    'grok-cli': ['-m', cfg.model, '--tools', 'read_file,list_dir,grep', first],
  }[cfg.provider.type] || [first];
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.ELECTRON_RUN_AS_NODE;
  return { title: `supervisor · ${path.basename(runDir)}`, cwd: runDir, file: cmd.file, args, env };
}

// External console window (Windows)
ipcMain.handle('session:terminal', (_e, { sessionId, mode, runId }) => {
  openTerminal(terminalSpec(runId, sessionId, mode));
  return true;
});

// Embedded terminals (xterm.js in the renderer + node-pty here)
const terminals = new Terminals((channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); });
ipcMain.handle('term:open', (_e, { kind, runId, sessionId, cols, rows }) => {
  if (kind === 'supervisor') return terminals.open({ ...supervisorChatSpec(runId || currentRun?.runId), cols, rows });
  const spec = terminalSpec(runId, sessionId, kind === 'cli' ? 'cli' : 'live');
  if (kind !== 'cli') {
    // live: follow the log in this process (see src/terminals.js for why not a child process)
    const [, runDir, id] = spec.args;
    return terminals.openVirtual({ title: spec.title, start: (write) => followSession(runDir, id, write) });
  }
  // .cmd/.bat shims (npm-installed CLIs) run through cmd.exe; node-pty re-quotes array
  // arguments on Windows, so cmd.exe gets its command line as a single string
  const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(spec.file);
  return terminals.open({
    ...spec, cols, rows,
    file: shim ? 'cmd.exe' : spec.file,
    args: shim ? `/d /s /c "${[spec.file, ...spec.args].map(q).join(' ')}"` : spec.args,
  });
});
ipcMain.on('term:input', (_e, { id, data }) => terminals.input(id, data));
ipcMain.on('term:resize', (_e, { id, cols, rows }) => terminals.resize(id, cols, rows));
ipcMain.handle('term:kill', (_e, { id }) => terminals.kill(id));

// Clipboard for the terminals (the sandboxed renderer has no clipboard module)
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.handle('clipboard:write', (_e, { text }) => { clipboard.writeText(String(text ?? '')); return true; });

// ---- AI supervisor on demand ------------------------------------------------------------
// Explains any run (running, failed or finished) and recommends actions; the analysis is saved in
// the run folder (supervisor/analysis-*.md), so it shows up in Artifacts.
function runFolder(runId) {
  const dir = path.join(ws.runs, path.basename(String(runId || '')));
  if (!fs.existsSync(path.join(dir, 'events.jsonl'))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

ipcMain.handle('supervisor:analyze', (_e, { runId, question }) => supervisor.analyzeRun({
  runDir: runFolder(runId), question, workflowsDir: workflowDirs(), skillsDirs: [ws.skills, path.join(ROOT, 'skills')], resolveCommand,
}));

// Continues a run from a step: a new run with the previous outputs, agent conversations and an instruction.
ipcMain.handle('supervisor:resume', async (_e, { runId, step, instruction }) => {
  const runDir = runFolder(runId);
  const spec = supervisor.resumeSpec(runDir, step);
  if (!spec.file) throw new Error('The run does not record its workflow file.');
  const first = loadWorkflow(workflowPath(spec.file).file).steps[0].id;
  return startWorkflowRun({
    file: spec.file, inputs: spec.inputs, mock: spec.mock, projectId: spec.projectId,
    resume: { runId: spec.runId, fromStep: step || first, steps: spec.steps, sessions: spec.sessions, instruction: instruction || null, worktree: spec.worktree },
  });
});

// ---- run lists (Projects > Project and Workflows > Runs) ------------------------------
function runListItem(r) {
  const current = !!currentRun && currentRun.runId === r.runId && currentRun.status === 'running';
  const live = current ? [...currentRun.sessions.values()].map((x) => sessionView(currentRun.snapshot(x), false)) : null;
  // the orchestrator first: its live log is the run's timeline
  const sessions = (live || r.sessions.map((x) => sessionView(x, false))).sort((a, b) => (b.agent === 'orchestrator') - (a.agent === 'orchestrator'));
  const providers = runProviders(current ? r.runId : 'disk', r.file);
  const { inputs, ...info } = r;
  return {
    ...info,
    artifacts: runs.runArtifacts(r.runDir),
    status: current ? 'running' : r.status,
    current,
    costUsd: current ? sessions.reduce((a, x) => a + (x.costUsd || 0), 0) : r.costUsd,
    sessions: sessions.map((x) => {
      const why = cliReason(x, providers, current);
      return { ...x, cliAvailable: !why, cliReason: why };
    }),
  };
}

ipcMain.handle('projects:runs', (_e, { id }) => {
  const project = projects.listProjects(ws.projects).find((p) => p.id === id);
  if (!project) throw new Error(`Project not found: ${id}`);
  return { project, runs: runs.runsForProject(runs.listRuns(ws.runs), project).map(runListItem) };
});

// Every run, with the project it belongs to.
ipcMain.handle('runs:list', () => {
  const projectList = projects.listProjects(ws.projects);
  return {
    runs: runs.listRuns(ws.runs).map((r) => {
      const owner = runs.projectOf(r, projectList);
      return { ...runListItem(r), project: owner ? { id: owner.id, name: owner.name } : null };
    }),
  };
});

// ---- artifacts ------------------------------------------------------------------------
// Files produced by runs (documents, proposals, reviews, reports…), newest run first.
function artifactRuns({ projectId, runId } = {}) {
  const all = runs.listRuns(ws.runs);
  const projectList = projects.listProjects(ws.projects);
  const project = projectId ? projectList.find((x) => x.id === projectId) : null;
  const list = runId ? all.filter((r) => r.runId === runId) : project ? runs.runsForProject(all, project) : all;
  return list.map((r) => {
    const owner = runs.projectOf(r, projectList);
    const current = !!currentRun && currentRun.runId === r.runId && currentRun.status === 'running';
    return {
      runId: r.runId, workflow: r.workflow, version: r.version, status: current ? 'running' : r.status,
      mock: r.mock, startedAt: r.startedAt, task: r.task, runDir: r.runDir,
      project: owner ? { id: owner.id, name: owner.name } : null,
      artifacts: runs.runArtifacts(r.runDir),
    };
  }).filter((r) => r.artifacts.length);
}

ipcMain.handle('artifacts:list', (_e, opts) => artifactRuns(opts || {}));

// Reads an artifact for the viewer. Only files that some run lists as an artifact can be read.
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
ipcMain.handle('artifacts:read', (_e, { path: file }) => {
  const norm = (x) => (process.platform === 'win32' ? path.resolve(x).toLowerCase() : path.resolve(x));
  const found = artifactRuns().flatMap((r) => r.artifacts).find((a) => norm(a.path) === norm(file));
  if (!found) throw new Error('Not an artifact of any run.');
  if (!found.exists) throw new Error(`The file no longer exists: ${found.path}`);
  const buf = fs.readFileSync(found.path);
  const truncated = buf.length > MAX_ARTIFACT_BYTES;
  const binary = buf.subarray(0, 8000).includes(0);
  return { ...found, truncated, binary, text: binary ? null : buf.subarray(0, MAX_ARTIFACT_BYTES).toString('utf8') };
});

// Opens an artifact with the default app, or shows it in the file explorer.
ipcMain.handle('artifacts:open', (_e, { path: file, reveal }) => {
  const norm = (x) => (process.platform === 'win32' ? path.resolve(x).toLowerCase() : path.resolve(x));
  const found = artifactRuns().flatMap((r) => r.artifacts).find((a) => norm(a.path) === norm(file));
  if (!found?.exists) throw new Error('Artifact not found.');
  if (reveal) { shell.showItemInFolder(found.path); return ''; }
  return shell.openPath(found.path);
});

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
  seedDefaults();
  createWindow();
  // run worktrees left behind: succeeded runs whose removal failed, or unused for 14 days
  // (no run is in progress yet at startup)
  cleanupWorktrees({ worktreesDir: ws.worktrees, runsDir: ws.runs }).catch((e) => console.error('worktree cleanup:', e));
});
app.on('window-all-closed', () => {
  terminals.killAll();
  currentRun?.stop();
  app.quit();
});
