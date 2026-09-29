// Engine service: everything the UI can ask of the engine, with no dependency on Electron or on a
// transport. `api` maps a channel name ('projects:list', 'run:start', ...) to a function taking
// one argument; `notifications` are the fire-and-forget channels (no reply). Pushed data
// ('run:event', 'term:data', 'term:exit') is emitted on `events`.
//
// Today src/main.js exposes it over Electron IPC; the same object can be exposed over HTTP +
// WebSocket so the engine runs on a server and the UI connects to it.
//
// What depends on the machine the engine runs on comes from `host`:
//   trashItem(path)  moves a file to the trash (skills and workflows are never hard-deleted)
//   appVersion       shown in Settings
//   isPackaged       the packaged app can't run itself as node (see terminalSpec)
//   assertCanRun({ mock })  optional; throws when the account may not start or resume a run

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { WorkflowRun, loadWorkflow } = require('../engine/workflow');
const { Recorder } = require('../engine/recorder');
const { resolveCommand } = require('../engine/providers');
const { cleanupWorktrees } = require('../engine/worktree');
const workspace = require('../workspace');
const projects = require('../projects');
const skills = require('../skills');
const usage = require('../usage');
const { readLocalUsage } = require('../local-usage');
const runs = require('../runs');
const workflows = require('../workflows');
const { Terminals } = require('../terminals');
const { followSession } = require('../session-tail');
const supervisor = require('../supervisor');

const SRC = path.join(__dirname, '..');
const ROOT = path.join(SRC, '..');
// Bundled defaults (read-only in the packaged app): only a seed source for the workspace copies.
const BUNDLED_WORKFLOWS_DIR = workflows.BUNDLED_WORKFLOWS_DIR;
const BUNDLED_SKILLS_DIR = path.join(ROOT, 'skills');

const RESUME_ARGS = { 'claude-code': (id) => ['--resume', id], 'codex-cli': (id) => ['resume', id], 'grok-cli': (id) => ['--resume', id] };
const q = (a) => `"${String(a).replace(/"/g, '""')}"`;
const num = (v) => (v === '' || v == null || !Number.isFinite(+v) || +v <= 0 ? null : +v);
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;

// Details for the Settings screen: path, version and (gh) authentication of each CLI.
function runTool(file, args, shellMode) {
  return new Promise((resolve) => {
    const cmd = shellMode ? `"${file}"` : file;
    execFile(cmd, args, { windowsHide: true, timeout: 15000, shell: shellMode }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() }));
  });
}

// A session in the same shape whether it comes from the live engine or from a run on disk.
function sessionView(x, live) {
  return {
    id: x.id, agent: x.agent, provider: x.provider, model: x.model, status: x.status,
    providerSessionId: live ? x.providerSessionId : x.provider_session_id || null,
    cwd: x.cwd || null, turns: x.turns || 0, costUsd: live ? x.costUsd : x.cost_usd || 0,
  };
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

function createService({ host }) {
  const events = new EventEmitter();
  let ws = null; // { root, runs, repos, projects, skills, workflows, worktrees, settings } (see src/workspace.js)
  let currentRun = null;
  const terminals = new Terminals((channel, payload) => events.emit(channel, payload));

  const workspaceDir = () => {
    if (!ws) throw new Error('No workspace is open.');
    return ws;
  };

  // Copies/updates the bundled skills and workflows into the workspace.
  function seedDefaults() {
    try { skills.seedSkills(BUNDLED_SKILLS_DIR, ws.skills); } catch (e) { console.error('skill seeding:', e); }
    try { workflows.seedWorkflows(BUNDLED_WORKFLOWS_DIR, ws.workflows); } catch (e) { console.error('workflow seeding:', e); }
  }

  function setWorkspace(next) {
    if (currentRun?.status === 'running') throw new Error('Cannot change the workspace while a workflow is running.');
    ws = next;
    seedDefaults();
    return ws;
  }

  // Workflows are read from the workspace; the bundled copy is a fallback for runs whose workflow
  // file the user deleted (e.g. resuming an old run).
  const workflowDirs = () => [ws.workflows, BUNDLED_WORKFLOWS_DIR];
  const workflowPath = (file) => workflows.resolveWorkflow(path.basename(String(file || '')), workflowDirs());
  const isCurrent = (runId) => !runId || (currentRun && currentRun.runId === runId);
  const isRunning = () => currentRun?.status === 'running';

  function listWorkflows() {
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
  }

  // Replaces the user's edited copy of a bundled workflow with the default; the edited copy goes to
  // the trash (recoverable).
  async function restoreWorkflow(file) {
    const name = path.basename(String(file || ''));
    if (!workflows.workflowStatus(BUNDLED_WORKFLOWS_DIR, ws.workflows)[name]?.restorable) throw new Error(`"${name}" has no bundled default to restore.`);
    await host.trashItem(path.join(ws.workflows, name));
    workflows.restoreWorkflow(BUNDLED_WORKFLOWS_DIR, ws.workflows, name);
    return true;
  }

  function envDetails() {
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
  }

  // mockSequences: simulation scenario ({ field: [value per visit] }, invalid_answers), ignored for real runs
  async function startWorkflowRun({ file, inputs, mock, mockSequences = null, resume = null, projectId: forcedProject = null }) {
    if (isRunning()) throw new Error('A workflow is already running.');
    await host.assertCanRun?.({ mock: !!mock });
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
      budget, prices: settings.prices, projectId, resume, mockSequences: mock ? mockSequences : null,
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
      events.emit('run:event', ev);
    });
    currentRun = run;
    run.start();
    return { runId: run.runId, runDir: run.runDir };
  }

  // Provider config of a run's workflow: the live one, or the workflow file named in its events.
  function runProviders(runId, file) {
    if (isCurrent(runId) && currentRun) return currentRun.wf.providers || {};
    try { return loadWorkflow(workflowPath(file).file).providers || {}; } catch { return {}; }
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
  // - live: follows the session's log (src/session-tail.js);
  // - cli: the provider's interactive CLI resuming the same conversation in the session's
  //   folder (claude --resume / codex resume / grok --resume).
  function terminalSpec(runId, sessionId, mode) {
    const found = findSession(runId, sessionId);
    if (!found) throw new Error('Session not found.');
    const { run, sess } = found;
    const env = { ...process.env };
    delete env.CLAUDECODE;
    if (mode === 'live') {
      // Dev: Electron itself as node. Packaged: the RunAsNode fuse is off, so the system node runs
      // the unpacked copy of session-tail.js (node can't read app.asar).
      const node = host.isPackaged ? resolveCommand('node') : { file: process.execPath };
      if (!node) throw new Error('The external live terminal needs Node.js on the PATH. Use the embedded live terminal instead.');
      const tail = path.join(SRC, 'session-tail.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      return {
        title: sess.agent === 'orchestrator' ? 'orchestrator · live' : `${sess.agent} (${sess.id}) · live`,
        cwd: run.runDir, file: node.file,
        args: [tail, run.runDir, sess.id], env: { ...env, ELECTRON_RUN_AS_NODE: '1', FORCE_COLOR: '1' },
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

  function runFolder(runId) {
    const dir = path.join(ws.runs, path.basename(String(runId || '')));
    if (!fs.existsSync(path.join(dir, 'events.jsonl'))) throw new Error(`Run not found: ${runId}`);
    return dir;
  }

  // Interactive chat with the supervisor about a run: the provider's CLI in the run folder, with the
  // run report written to supervisor/context.md and a first message that points to it.
  function supervisorChatSpec(runId) {
    const runDir = runFolder(runId);
    const cfg = supervisor.supervisorConfig(runDir, workflowDirs());
    const skill = skills.resolveSkill([ws.skills, BUNDLED_SKILLS_DIR], 'run-supervisor');
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

  // Embedded terminals (xterm.js in the UI + node-pty here)
  function openTerminal({ kind, runId, sessionId, cols, rows }) {
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
  }

  // Continues a run from a step: a new run with the previous outputs, agent conversations and an instruction.
  function resumeRun({ runId, step, instruction }) {
    const runDir = runFolder(runId);
    const spec = supervisor.resumeSpec(runDir, step);
    if (!spec.file) throw new Error('The run does not record its workflow file.');
    const first = loadWorkflow(workflowPath(spec.file).file).steps[0].id;
    return startWorkflowRun({
      file: spec.file, inputs: spec.inputs, mock: spec.mock, projectId: spec.projectId,
      resume: { runId: spec.runId, fromStep: step || first, steps: spec.steps, sessions: spec.sessions, instruction: instruction || null, worktree: spec.worktree },
    });
  }

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

  function projectRuns({ id }) {
    const project = projects.listProjects(ws.projects).find((p) => p.id === id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return { project, runs: runs.runsForProject(runs.listRuns(ws.runs), project).map(runListItem) };
  }

  // Every run, with the project it belongs to.
  function listAllRuns() {
    const projectList = projects.listProjects(ws.projects);
    return {
      runs: runs.listRuns(ws.runs).map((r) => {
        const owner = runs.projectOf(r, projectList);
        return { ...runListItem(r), project: owner ? { id: owner.id, name: owner.name } : null };
      }),
    };
  }

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

  // Only files that some run lists as an artifact can be read or opened.
  function findArtifact(file) {
    const norm = (x) => (process.platform === 'win32' ? path.resolve(x).toLowerCase() : path.resolve(x));
    return artifactRuns().flatMap((r) => r.artifacts).find((a) => norm(a.path) === norm(file)) || null;
  }

  function readArtifact({ path: file }) {
    const found = findArtifact(file);
    if (!found) throw new Error('Not an artifact of any run.');
    if (!found.exists) throw new Error(`The file no longer exists: ${found.path}`);
    const buf = fs.readFileSync(found.path);
    const truncated = buf.length > MAX_ARTIFACT_BYTES;
    const binary = buf.subarray(0, 8000).includes(0);
    return { ...found, truncated, binary, text: binary ? null : buf.subarray(0, MAX_ARTIFACT_BYTES).toString('utf8') };
  }

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

  function setBudget({ provider, budget, scope }) {
    if (!usage.PROVIDERS.some((p) => p.id === provider)) throw new Error(`Unknown provider: ${provider}`);
    const budgets = { ...workspace.readSettings(ws).budgets };
    budgets[provider] = {
      monthlyUsd: num(budget?.monthlyUsd), monthlyTokens: num(budget?.monthlyTokens),
      blockOnLimit: budget?.blockOnLimit !== false, countOutside: !!budget?.countOutside,
    };
    workspace.writeSettings(ws, { budgets });
    return usageSnapshot(scope);
  }

  function setPrice({ model, price, scope }) {
    if (!String(model || '').trim()) throw new Error('Model is required.');
    const prices = { ...workspace.readSettings(ws).prices };
    const clean = { input: +price?.input || 0, output: +price?.output || 0, cache_read: +price?.cache_read || 0 };
    if (!clean.input && !clean.output && !clean.cache_read) delete prices[model];
    else prices[model] = clean;
    workspace.writeSettings(ws, { prices });
    return usageSnapshot(scope);
  }

  // Every channel needs an open workspace (checked once here instead of in each handler).
  const withWorkspace = (fn) => (arg) => { workspaceDir(); return fn(arg); };

  const api = Object.fromEntries(Object.entries({
    'workflows:list': () => listWorkflows(),
    'workflows:restore': (file) => restoreWorkflow(file),

    'env:check': () => ({
      claude: resolveCommand('claude')?.file || null,
      codex: resolveCommand('codex')?.file || null,
      grok: resolveCommand('grok')?.file || null,
    }),
    'env:details': () => envDetails(),
    'app:info': () => ({
      version: host.appVersion,
      electron: process.versions.electron,
      node: process.versions.node,
      workflowsDir: ws.workflows,
    }),

    'settings:get': () => workspace.readSettings(ws),
    'settings:set': (patch) => workspace.writeSettings(ws, patch),

    'projects:list': () => projects.listProjects(ws.projects),
    'projects:create': (data) => projects.createProject(ws.projects, data, { reposDir: ws.repos }),
    'projects:update': ({ id, patch }) => projects.updateProject(ws.projects, id, patch),
    'projects:remove': (id) => projects.removeProject(ws.projects, id),
    'projects:runs': (opts) => projectRuns(opts),

    'skills:list': () => skills.listSkills(ws.skills),
    'skills:create': (data) => skills.createSkill(ws.skills, data),
    'skills:save': ({ id, data }) => skills.saveSkill(ws.skills, id, data),
    // Moves to the trash (recoverable), does not delete permanently.
    'skills:remove': (id) => host.trashItem(path.join(ws.skills, path.basename(id))),

    'workspace:get': () => ({ ...ws, registry: process.env[workspace.ENV_VAR] ? null : workspace.defaultStore().describe }),

    'run:start': ({ file, inputs, mock, mockSequences }) => startWorkflowRun({ file, inputs, mock, mockSequences }),
    'run:stop': () => { currentRun?.stop(); return true; },
    'runs:list': () => listAllRuns(),
    'runs:events': ({ runId }) => runs.runEvents(runFolder(runId)),
    // answer: true/false or the id of a choice; feedback: the optional text typed at the gate
    'approval:resolve': ({ id, answer, feedback }) => currentRun?.resolveApproval(id, answer, 'user', feedback) ?? false,

    // Explains any run (running, failed or finished) and recommends actions; the analysis is saved in
    // the run folder (supervisor/analysis-*.md), so it shows up in Artifacts.
    'supervisor:analyze': ({ runId, question }) => supervisor.analyzeRun({
      runDir: runFolder(runId), question, workflowsDir: workflowDirs(), skillsDirs: [ws.skills, BUNDLED_SKILLS_DIR], resolveCommand,
    }),
    'supervisor:resume': (opts) => resumeRun(opts),

    'artifacts:list': (opts) => artifactRuns(opts || {}),
    'artifacts:read': (opts) => readArtifact(opts),

    'usage:get': (opts) => usageSnapshot(opts?.scope),
    'usage:setBudget': (opts) => setBudget(opts),
    'usage:setPrice': (opts) => setPrice(opts),

    'term:open': (opts) => openTerminal(opts),
    'term:kill': ({ id }) => terminals.kill(id),
  }).map(([channel, fn]) => [channel, withWorkspace(fn)]));

  const notifications = {
    'term:input': ({ id, data }) => terminals.input(id, data),
    'term:resize': ({ id, cols, rows }) => terminals.resize(id, cols, rows),
  };

  return {
    api,
    notifications,
    events,
    workspace: () => ws,
    setWorkspace,
    isRunning,
    currentRunDir: () => currentRun?.runDir || null,
    // folders the UI may open on this machine: the workspace and the projects' folders
    openableFolders: () => [ws.root, ...projects.listProjects(ws.projects).map((x) => x.folder)],
    findArtifact,
    terminalSpec,
    // run worktrees left behind: succeeded runs whose removal failed, or unused for 14 days
    // (call at startup, when no run is in progress yet)
    cleanupWorktrees: () => cleanupWorktrees({ worktreesDir: ws.worktrees, runsDir: ws.runs }),
    shutdown() {
      terminals.killAll();
      currentRun?.stop();
    },
  };
}

module.exports = { createService, BUNDLED_WORKFLOWS_DIR, BUNDLED_SKILLS_DIR };
