// Engine service: everything the UI can ask of the engine, with no dependency on Electron or on a
// transport. `api` maps a channel name ('projects:list', 'run:start', ...) to a function taking
// one argument; `notifications` are the fire-and-forget channels (no reply). Pushed data
// ('run:event', 'term:data', 'term:exit') is emitted on `events`, and so are desktop notifications
// ('notify', see src/notifications.js), already filtered by the settings and what the UI shows.
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
const os = require('os');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { WorkflowRun, loadWorkflow } = require('../engine/workflow');
const { Recorder } = require('../engine/recorder');
const { resolveCommand } = require('../engine/providers');
const capabilities = require('../engine/capabilities');
const { cleanupWorktrees, canonicalPath } = require('../engine/worktree');
const workspace = require('../workspace');
const projects = require('../projects');
const backlog = require('../backlog');
const skills = require('../skills');
const agents = require('../agents');
const usage = require('../usage');
const { readLocalUsage } = require('../local-usage');
const cliSessions = require('../cli-sessions');
const { trustFolder } = require('../cli-trust');
const runs = require('../runs');
const workflows = require('../workflows');
const { Terminals } = require('../terminals');
const { followSession } = require('../session-tail');
const supervisor = require('../supervisor');
const notifier = require('../notifications');

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
  // Runs in progress, by run id (several with Settings › Execution › Concurrent runs). A run leaves
  // the map when it finishes; from then on it is read from its folder.
  const active = new Map();
  // Starts under way (between the limit check and the run entering `active`): counted like runs.
  const reserved = new Set();
  // Budget baseline time of each active run, and real runs that finished while others were running:
  // their usage is not in the baseline of those runs, so the per-turn budget check adds it.
  const budgetAt = new Map();
  let finishedPeers = []; // [{ finishedAt, sessions }]

  // ---- desktop notifications ----------------------------------------------------------------
  // uiContext: what the window shows ({ focused, runId, terminalId }), reported by the UI.
  let uiContext = notifier.normalizeContext(null);
  function notify(notice) {
    let settings = {};
    try { if (ws) settings = workspace.readSettings(ws); } catch { /* defaults */ }
    if (notifier.shouldNotify(notice, { settings, context: uiContext })) events.emit('notify', notice);
  }
  // CLIs in Sessions terminals that stop and wait for the user
  const waiting = new notifier.WaitDetector({ onWaiting: (id, info, message) => notify(notifier.sessionNotice(id, info, message)) });
  const terminals = new Terminals((channel, payload) => {
    if (channel === 'term:data') waiting.output(payload.id, payload.data);
    if (channel === 'term:exit') waiting.close(payload.id);
    events.emit(channel, payload);
  });

  // The runs in progress are written down until they end: still there at the next start = they
  // died with the app. The file holds a list (one object in older versions).
  const marked = new Map(); // run id -> { runId, workflow, project, mock }
  function markActiveRun(runId, info) {
    if (info) marked.set(runId, info); else marked.delete(runId);
    try {
      if (marked.size) fs.writeFileSync(ws.activeRun, JSON.stringify([...marked.values()]));
      else fs.rmSync(ws.activeRun, { force: true });
    } catch (e) { console.error('active run marker:', e.message); }
  }
  // Notifies each run the app had in progress when it last closed; returns the first notice.
  function notifyInterruptedRun() {
    if (!ws || isRunning()) return null;
    let list = null;
    try { list = [].concat(JSON.parse(fs.readFileSync(ws.activeRun, 'utf8'))); } catch { return null; }
    fs.rmSync(ws.activeRun, { force: true });
    const notices = list.filter((info) => info?.runId && runs.readRun(ws.runs, path.basename(String(info.runId)))?.status === 'interrupted')
      .map((info) => notifier.interruptedNotice(info));
    notices.forEach(notify);
    return notices[0] || null;
  }

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
    if (isRunning()) throw new Error('Cannot change the workspace while workflows are running.');
    ws = next;
    seedDefaults();
    // queued issues never start on their own after a restart or a workspace change
    try { backlog.pauseAll(ws.backlog, 'Paused when the app started: resume to start the queued issues.'); } catch (e) { console.error('backlog queues:', e); }
    return ws;
  }

  // Workflows are read from the workspace; the bundled copy is a fallback for runs whose workflow
  // file the user deleted (e.g. resuming an old run).
  const workflowDirs = () => [ws.workflows, BUNDLED_WORKFLOWS_DIR];
  const workflowPath = (file) => workflows.resolveWorkflow(path.basename(String(file || '')), workflowDirs());
  const isRunning = () => active.size > 0 || reserved.size > 0;
  // The run in progress with this id; without an id, the only one in progress (older callers).
  const liveRun = (runId) => (runId ? active.get(String(runId)) : active.size === 1 ? [...active.values()][0] : null) || null;
  const usageOf = (run) => [...run.sessions.values()].map((s) => ({ provider: s.provider, model: s.model, tokens: s.tokens, costUsd: s.costUsd }));

  // ---- concurrent runs ------------------------------------------------------------------
  // Settings › Execution › Concurrent runs. Disabled: one run at a time, simulations included.
  function concurrency() {
    const c = { ...workspace.DEFAULT_SETTINGS.concurrentRuns, ...(workspace.readSettings(ws).concurrentRuns || {}) };
    if (!c.enabled) return { enabled: false, max: 1, perProject: null, countSimulations: true };
    return {
      enabled: true, max: Math.max(1, Math.floor(num(c.max) || 1)),
      perProject: num(c.perProject) ? Math.max(1, Math.floor(num(c.perProject))) : null, countSimulations: !!c.countSimulations,
    };
  }

  // Why a run ({ mock, projectId }) cannot start now ('' = it can). `self` is its own reservation.
  function slotProblem({ mock, projectId }, self = null) {
    const c = concurrency();
    if (mock && !c.countSimulations) return '';
    const taken = [...active.values(), ...[...reserved].filter((x) => x !== self)].filter((r) => c.countSimulations || !r.mock);
    if (taken.length >= c.max) {
      return c.enabled ? `${taken.length} of ${c.max} runs in progress: wait for one to finish, or raise the limit in Settings › Execution.` : 'A workflow is already running.';
    }
    const same = projectId ? taken.filter((r) => r.projectId === projectId).length : 0;
    if (c.perProject && same >= c.perProject) {
      return `${same} of ${c.perProject} runs of this project in progress: wait for one to finish, or raise the limit per project in Settings › Execution.`;
    }
    return '';
  }

  // Usage of the other real runs that count toward a run's budget (see WorkflowRun peerSessions).
  function peerSessions(run) {
    const since = budgetAt.get(run.runId) ?? Date.now();
    return [
      ...[...active.values()].filter((r) => r !== run && !r.mock).flatMap(usageOf),
      ...finishedPeers.filter((f) => f.finishedAt >= since).flatMap((f) => f.sessions),
    ];
  }

  function runEnded(run) {
    active.delete(run.runId);
    budgetAt.delete(run.runId);
    if (!run.mock && active.size) finishedPeers.push({ finishedAt: Date.now(), sessions: usageOf(run) });
    const oldest = Math.min(...budgetAt.values());
    finishedPeers = finishedPeers.filter((f) => f.finishedAt >= oldest); // none left when nothing runs
  }

  // What the UI shows of each run in progress (the Run menu list).
  function activeRuns() {
    return [...active.values()].map((r) => ({
      runId: r.runId, workflow: r.wf.metadata?.name || path.basename(r.file), file: path.basename(r.file), mock: r.mock,
      projectId: r.projectId, issue: r.issue, startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
      waiting: r.approvals.size, inputs: r.inputs,
    }));
  }

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
            agents: Object.fromEntries(Object.entries(wf.agents).map(([k, a]) => {
              const d = { ...(wf.defaults || {}), ...a };
              return [k, {
                provider: a.provider, model: a.model, session: d.session || 'persistent', max_context: d.max_context || null, skills: a.skills || [],
                capabilities: capabilities.describe(a.capabilities), isolated: d.isolation !== false,
              }];
            })),
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
  async function startWorkflowRun({ file, inputs, mock, mockSequences = null, resume = null, projectId: forcedProject = null, issue = null }) {
    const slot = { mock: !!mock, projectId: forcedProject };
    const busy = slotProblem(slot);
    if (busy) throw new Error(busy);
    reserved.add(slot);
    let run;
    try {
      await host.assertCanRun?.({ mock: !!mock });
      // repo_path can be a git URL: clones (or updates) it into <workspace>/repos.
      if (workspace.isGitUrl(inputs?.repo_path)) {
        inputs = { ...inputs, repo_path: (await workspace.cloneRepo(inputs.repo_path, ws.repos)).dir };
      }
      const settings = workspace.readSettings(ws);
      const folders = Object.values(inputs || {}).filter((v) => typeof v === 'string' && /[\\/]/.test(v)).map((v) => path.resolve(v).toLowerCase());
      const projectId = forcedProject || projects.listProjects(ws.projects).find((p) => p.folder && folders.includes(path.resolve(p.folder).toLowerCase()))?.id || null;
      // the project is known now: its own limit applies
      slot.projectId = projectId;
      const busyProject = slotProblem(slot, slot);
      if (busyProject) throw new Error(busyProject);
      // budgets that count usage outside the orchestrator need the CLIs' own logs
      const needsLocal = Object.values(settings.budgets || {}).some((b) => b?.countOutside);
      const baselineAt = Date.now();
      const budget = usage.budgetBaseline({ runsDir: ws.runs, settings, local: needsLocal ? readLocalUsage() : null });
      const wfFile = workflowPath(file);
      const notices = [];
      if (wfFile.fallback) {
        const msg = `workflow ${path.basename(wfFile.file)} is not in ${ws.workflows}; using the copy bundled with the app (${wfFile.file})`;
        console.warn(msg);
        notices.push({ level: 'warn', message: msg });
      }
      run = new WorkflowRun({
        file: wfFile.file, inputs, mock, runsDir: ws.runs, skillsDirs: [ws.skills], notices,
        budget, prices: settings.prices, projectId, issue, resume, mockSequences: mock ? mockSequences : null,
        // simulation runs never touch git: the agents are mocked and work in the repository folder
        worktreesDir: mock ? null : ws.worktrees,
        // concurrent runs share the monthly budgets
        peerSessions: () => peerSessions(run),
      });
      if (!mock) {
        // the runs in progress have not written their usage to disk yet
        const problems = usage.preflight(run.wf, usage.withPeerUsage(budget, peerSessions(run), settings.prices), resolveCommand, run.inputs);
        if (problems.length) throw new Error(problems.join('\n'));
      }
      budgetAt.set(run.runId, baselineAt);
      active.set(run.runId, run);
    } finally {
      reserved.delete(slot);
    }
    const recorder = new Recorder(run.runDir, run.wf.observability?.capture?.redact);
    const runInfo = {
      runId: run.runId, workflow: run.wf.metadata?.name || path.basename(run.file), mock: !!run.mock,
      project: run.projectId ? projects.listProjects(ws.projects).find((p) => p.id === run.projectId)?.name || run.projectId : null,
    };
    run.on('event', (ev) => {
      try { recorder.write(ev); } catch (e) { console.error('recorder:', e); }
      if (ev.type === 'workflow.finished') runEnded(run);
      events.emit('run:event', ev);
      if (ev.type === 'workflow.started') markActiveRun(run.runId, runInfo);
      if (ev.type === 'workflow.finished') markActiveRun(run.runId, null);
      notify(notifier.runNotice(ev, runInfo));
      // the next issues waiting in a Backlog queue start once this run is over; a queued issue whose
      // run failed pauses its queue (a failure that repeats would otherwise burn through it)
      if (ev.type === 'workflow.finished') {
        if (run.issue && run.projectId && ev.status === 'failed' && !run.mock) {
          try { backlog.setPaused(ws.backlog, run.projectId, true, `#${run.issue.number} failed: resume to start the next issues.`); } catch (e) { console.error('backlog queue:', e); }
        }
        setTimeout(() => dispatchQueue().catch((e) => console.error('backlog dispatch:', e)), 1000);
      }
    });
    run.start();
    return { runId: run.runId, runDir: run.runDir };
  }

  // Provider config of a run's workflow: the live one, or the workflow file named in its events.
  function runProviders(runId, file) {
    const live = active.get(runId);
    if (live) return live.wf.providers || {};
    try { return loadWorkflow(workflowPath(file).file).providers || {}; } catch { return {}; }
  }

  // Everything needed to open a session: from the run in progress, or from the run folder on disk.
  function findSession(runId, sessionId) {
    const live = liveRun(runId);
    if (live) {
      const x = live.sessions.get(sessionId);
      return x && { run: { runId: live.runId, runDir: live.runDir, file: path.basename(live.file), inputs: live.inputs, running: live.status === 'running' }, sess: sessionView(x, true) };
    }
    if (!runId) return null;
    const r = runs.readRun(ws.runs, path.basename(String(runId)));
    const x = r?.sessions.find((y) => y.id === sessionId);
    return x && { run: { runId: r.runId, runDir: r.runDir, file: r.file, inputs: r.inputs, running: false }, sess: sessionView(x, false) };
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
    const providers = runProviders(run.runId, run.file);
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

  // ---- Sessions screen: the CLIs' own conversations on this machine --------------------
  // Whether a folder is (inside) another, compared canonically (8.3 names, symlinks), memoized.
  function folderMatcher() {
    const memo = new Map();
    const canon = (p) => {
      if (!memo.has(p)) memo.set(p, canonicalPath(p).toLowerCase());
      return memo.get(p);
    };
    return (dir, root) => {
      if (!dir || !root) return false;
      const a = canon(dir), b = canon(root);
      return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
    };
  }

  // Titles given on the Sessions screen, kept in the workspace (the CLIs' files are never edited).
  const titleKey = (provider, id) => `${provider}:${id}`;
  function sessionTitles() {
    try { return JSON.parse(fs.readFileSync(ws.sessionTitles, 'utf8')) || {}; } catch { return {}; }
  }
  function renameCliSession({ provider, id, title }) {
    const titles = sessionTitles();
    const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (clean) titles[titleKey(provider, id)] = clean;
    else delete titles[titleKey(provider, id)]; // empty: back to the CLI's own title
    fs.writeFileSync(ws.sessionTitles, JSON.stringify(titles, null, 2));
    return { title: clean || cliSessions.findCliSession(provider, id)?.title || null, renamed: !!clean };
  }

  // Every session with the project it belongs to and whether a workflow agent created it (a
  // headless CLI call, or a run's folder), plus which CLIs can start new sessions.
  function listCliSessions() {
    const within = folderMatcher();
    const projectList = projects.listProjects(ws.projects);
    const titles = sessionTitles();
    const sessions = cliSessions.listCliSessions().map((x) => {
      const owner = projectList.find((p) => [p.folder, ...(p.previousFolders || [])].some((d) => within(x.cwd, d)));
      const agent = x.headless || within(x.cwd, ws.runs) || within(x.cwd, ws.worktrees);
      const title = titles[titleKey(x.provider, x.id)];
      return { ...x, title: title || x.title, renamed: !!title, workflowAgent: !!agent, project: owner ? { id: owner.id, name: owner.name } : null };
    });
    const providers = Object.entries(cliSessions.CLI_PROVIDERS).map(([id, p]) => ({
      id, name: p.name, installed: !!resolveCommand(p.command), models: cliSessions.providerModels(id), efforts: p.efforts,
    }));
    return { sessions, providers };
  }

  const cliEnv = () => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
  };

  // What to run for the Sessions screen: reopen a recorded session in its folder, or start a new
  // one (in a project's folder, a chosen folder, or the home folder) with a model and effort.
  function cliSessionSpec({ kind, provider, sessionId, model, effort, projectId, folder }) {
    const p = cliSessions.CLI_PROVIDERS[provider];
    if (!p) throw new Error(`Unknown provider: ${provider}`);
    const cmd = resolveCommand(p.command);
    if (!cmd) throw new Error(`${p.name} (${p.command}) is not installed.`);
    if (kind === 'cli-resume') {
      const sess = cliSessions.findCliSession(provider, String(sessionId || ''));
      if (!sess) throw new Error('Session not found.');
      // the CLIs look conversations up by folder: resuming elsewhere would not find it
      if (!sess.cwd || !fs.existsSync(sess.cwd)) throw new Error(`The session's folder no longer exists: ${sess.cwd || 'unknown'}`);
      trustWorkspaceFolder(provider, sess.cwd);
      const title = sessionTitles()[titleKey(provider, sess.id)] || sess.title;
      return { title, cwd: sess.cwd, file: cmd.file, args: cliSessions.cliArgs(provider, { resume: sess.id }), env: cliEnv() };
    }
    const project = projectId ? projects.listProjects(ws.projects).find((x) => x.id === projectId) : null;
    if (projectId && !project) throw new Error(`Project not found: ${projectId}`);
    const cwd = folder || project?.folder || os.homedir();
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Folder not found: ${cwd}`);
    trustWorkspaceFolder(provider, cwd);
    const title = `${project?.name || path.basename(cwd) || cwd} · ${model || p.name}`;
    return { title, cwd, file: cmd.file, args: cliSessions.cliArgs(provider, { model, effort }), env: cliEnv() };
  }

  // Folders inside the workspace are the app's own: the CLI does not ask whether to trust them.
  // Folders elsewhere keep the CLI's own question (asked once per folder).
  function trustWorkspaceFolder(provider, dir) {
    if (!folderMatcher()(dir, ws.root)) return;
    try { trustFolder(provider, canonicalPath(dir)); } catch (e) { console.warn(`folder trust (${provider}):`, e.message); }
  }

  // A program in a pseudoterminal. .cmd/.bat shims (npm-installed CLIs) run through cmd.exe;
  // node-pty re-quotes array arguments on Windows, so cmd.exe gets its command line as a single string.
  // `windowsPty` tells xterm.js the program runs in ConPTY: ConPTY reflows the lines itself on a
  // resize, and xterm reflowing them too leaves pieces of the old layout on screen (full-screen
  // CLIs like Grok's end up garbled).
  function openProgram(spec, cols, rows) {
    const win = process.platform === 'win32';
    const shim = win && /\.(cmd|bat)$/i.test(spec.file);
    const opened = terminals.open({
      ...spec, cols, rows,
      file: shim ? 'cmd.exe' : spec.file,
      args: shim ? `/d /s /c "${[spec.file, ...spec.args].map(q).join(' ')}"` : spec.args,
    });
    return win ? { ...opened, windowsPty: { backend: 'conpty', buildNumber: Number(os.release().split('.')[2]) || undefined } } : opened;
  }

  // Embedded terminals (xterm.js in the UI + node-pty here)
  function openTerminal({ kind, runId, sessionId, cols, rows, ...opts }) {
    if (kind === 'supervisor') return openProgram(supervisorChatSpec(runId || liveRun(null)?.runId), cols, rows);
    if (kind === 'cli-resume' || kind === 'cli-new') {
      const spec = cliSessionSpec({ kind, sessionId, ...opts });
      const opened = openProgram(spec, cols, rows);
      waiting.watch(opened.id, { title: spec.title });
      return { ...opened, cwd: spec.cwd };
    }
    const spec = terminalSpec(runId, sessionId, kind === 'cli' ? 'cli' : 'live');
    if (kind !== 'cli') {
      // live: follow the log in this process (see src/terminals.js for why not a child process)
      const [, runDir, id] = spec.args;
      return terminals.openVirtual({ title: spec.title, start: (write) => followSession(runDir, id, write) });
    }
    return openProgram(spec, cols, rows);
  }

  // Continues a run from a step: a new run with the previous outputs, agent conversations and an instruction.
  function resumeRun({ runId, step, instruction }) {
    const runDir = runFolder(runId);
    const spec = supervisor.resumeSpec(runDir, step);
    if (!spec.file) throw new Error('The run does not record its workflow file.');
    const first = loadWorkflow(workflowPath(spec.file).file).steps[0].id;
    return startWorkflowRun({
      file: spec.file, inputs: spec.inputs, mock: spec.mock, projectId: spec.projectId, issue: spec.issue,
      resume: { runId: spec.runId, fromStep: step || first, steps: spec.steps, sessions: spec.sessions, handoffs: spec.handoffs, instruction: instruction || null, worktree: spec.worktree },
    });
  }

  // ---- run lists (Projects > Project and Workflows > Runs) ------------------------------
  function runListItem(r) {
    const run = active.get(r.runId);
    const current = !!run && run.status === 'running';
    const live = current ? [...run.sessions.values()].map((x) => sessionView(run.snapshot(x), false)) : null;
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

  // A synced backlog with each issue's runs and place in the queue (computed on every read: runs
  // come and go), plus the queue itself.
  function withIssueRuns(data) {
    if (!data) return null;
    const project = projects.listProjects(ws.projects).find((p) => p.id === data.projectId);
    const list = project ? runs.runsForProject(runs.listRuns(ws.runs), project) : [];
    const live = list.map((r) => (active.has(r.runId) ? { ...r, status: 'running', waiting: active.get(r.runId).approvals.size > 0 } : r));
    const queue = backlog.readQueue(ws.backlog, data.projectId);
    return { ...data, queue, issues: backlog.linkRuns(data.issues, live, queue) };
  }

  // Queues issues of a project's synced backlog for a workflow and starts the first ones if there
  // are free run slots. Only open issues; the workflow needs a `task` input (the issue goes there).
  async function assignWorkflow({ projectId, numbers, workflow, inputs, mock }) {
    const project = projects.readProject(ws.projects, path.basename(String(projectId)));
    const data = backlog.readBacklog(ws.backlog, project.id);
    if (!data) throw new Error('Sync the backlog first.');
    // in the order they were selected
    const issues = [...new Set((numbers || []).map(Number))].map((n) => data.issues.find((i) => i.number === n)).filter((i) => i?.state === 'open');
    if (!issues.length) throw new Error('Select at least one open issue.');
    const file = path.basename(String(workflow || ''));
    const wf = loadWorkflow(workflowPath(file).file);
    if (!wf.inputs?.task) throw new Error(`Workflow ${wf.metadata?.name || file} has no task input to receive the issue.`);
    if (!mock) await host.assertCanRun?.({ mock: false });
    backlog.enqueue(ws.backlog, project.id, { issues, workflow: file, workflowName: wf.metadata?.name || file, inputs: inputs || {}, mock: !!mock });
    await dispatchQueue();
    return withIssueRuns(backlog.readBacklog(ws.backlog, project.id));
  }

  // Starts queued issues while there are free run slots: the oldest first across projects, a
  // project at its own limit waiting. A start that fails (budget, missing CLI, bad input) pauses
  // that project's queue with the reason.
  let dispatching = false;
  async function dispatchQueue() {
    if (dispatching || !ws) return;
    dispatching = true;
    try {
      for (;;) {
        const next = backlog.nextQueued(ws.backlog, (projectId, item) => !slotProblem({ mock: !!item.mock, projectId }));
        if (!next) return;
        const { projectId, item } = next;
        try {
          const project = projects.readProject(ws.projects, projectId);
          const wf = loadWorkflow(workflowPath(item.workflow).file);
          // a PR/MR may have been opened for the issue since it was queued: skip it, don't redo the work
          if (!item.mock && project.repo) {
            const platform = backlog.readBacklog(ws.backlog, projectId)?.platform || workspace.readSettings(ws).backlogPlatform || backlog.DEFAULT_PLATFORM;
            const prs = await backlog.newPullRequests({ item, platform, repo: project.repo });
            if (prs.length) {
              backlog.skipQueued(ws.backlog, projectId, item.number, `open ${prs.map((p) => `${platform === 'gitlab' ? 'MR !' : 'PR #'}${p.number}`).join(', ')} since it was queued`);
              continue;
            }
          }
          await startWorkflowRun({
            file: item.workflow, inputs: backlog.runInputs(item, wf, project.folder), mock: item.mock,
            projectId, issue: { number: item.number, url: item.url, title: item.title },
          });
          backlog.unqueue(ws.backlog, projectId, item.number);
        } catch (e) {
          backlog.setPaused(ws.backlog, projectId, true, `Could not start #${item.number}: ${e.message}`);
        }
      }
    } finally {
      dispatching = false;
    }
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
      const current = active.get(r.runId)?.status === 'running';
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
    const live = [...active.values()].filter((r) => r.status === 'running' && !r.mock).map((r) => ({
      run_id: r.runId, workflow: r.wf.metadata?.name, started_at: new Date(r.startedAt).toISOString(), sessions: [...r.sessions.values()].map((x) => r.snapshot(x)),
    }));
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
    'settings:set': (patch) => {
      const next = workspace.writeSettings(ws, patch);
      // a higher limit of concurrent runs frees slots for the Backlog queues
      if (patch && 'concurrentRuns' in patch) dispatchQueue().catch((e) => console.error('backlog dispatch:', e));
      return next;
    },

    'projects:list': () => projects.listProjects(ws.projects),
    'projects:create': (data) => projects.createProject(ws.projects, data, { reposDir: ws.repos }),
    'projects:update': ({ id, patch }) => projects.updateProject(ws.projects, id, patch),
    'projects:remove': (id) => projects.removeProject(ws.projects, id),
    'projects:runs': (opts) => projectRuns(opts),

    // A project's issues: the last sync (instant) and a new sync with gh/glab, each issue with
    // the runs working on it.
    'backlog:get': ({ projectId }) => withIssueRuns(backlog.readBacklog(ws.backlog, projectId)),
    'backlog:sync': async ({ projectId, platform }) => withIssueRuns(await backlog.syncBacklog({
      dir: ws.backlog,
      project: projects.readProject(ws.projects, path.basename(String(projectId))),
      platform: platform || workspace.readSettings(ws).backlogPlatform,
    })),
    // Assign a workflow to issues: they are queued and start while there are free run slots (see dispatchQueue).
    'backlog:assign': (opts) => assignWorkflow(opts),
    'backlog:unqueue': async ({ projectId, number }) => {
      backlog.unqueue(ws.backlog, path.basename(String(projectId)), Number(number));
      return withIssueRuns(backlog.readBacklog(ws.backlog, projectId));
    },
    'backlog:pause': async ({ projectId, paused }) => {
      backlog.setPaused(ws.backlog, path.basename(String(projectId)), !!paused);
      if (!paused) await dispatchQueue();
      return withIssueRuns(backlog.readBacklog(ws.backlog, projectId));
    },

    'skills:list': () => skills.listSkills(ws.skills),
    'skills:create': (data) => skills.createSkill(ws.skills, data),
    'skills:save': ({ id, data }) => skills.saveSkill(ws.skills, id, data),
    // Moves to the trash (recoverable), does not delete permanently.
    'skills:remove': (id) => host.trashItem(path.join(ws.skills, path.basename(id))),

    // The built-in supervisor is always listed first; only its look can be changed.
    'agents:list': () => agents.listAgents(ws.agents),
    'agents:create': (data) => agents.createAgent(ws.agents, data),
    'agents:save': ({ id, data }) => agents.saveAgent(ws.agents, id, data),
    // Moves to the trash (recoverable), like skills.
    'agents:remove': (id) => host.trashItem(agents.agentPathForRemoval(ws.agents, id)),

    'workspace:get': () => ({ ...ws, registry: process.env[workspace.ENV_VAR] ? null : workspace.defaultStore().describe }),

    'run:start': ({ file, inputs, mock, mockSequences }) => startWorkflowRun({ file, inputs, mock, mockSequences }),
    // runId: the run to stop (without it, the only run in progress)
    'run:stop': (opts) => {
      const run = liveRun(opts?.runId);
      if (!run && !opts?.runId && active.size > 1) throw new Error('Several runs are in progress: say which one to stop.');
      run?.stop();
      return !!run;
    },
    'runs:active': () => activeRuns(),
    'runs:list': () => listAllRuns(),
    // activity: also the agents' tool calls and thinking, compacted (the run chat shows them)
    'runs:events': ({ runId, activity }) => runs.runEvents(runFolder(runId), { activity: !!activity }),
    // answer: true/false or the id of a choice; feedback: the optional text typed at the gate.
    // Gate ids are per run (a1, a2…): runId says which run (without it, the only run waiting on that id).
    'approval:resolve': ({ runId, id, answer, feedback }) => {
      const waiting = [...active.values()].filter((r) => r.approvals.has(id));
      const run = runId ? active.get(String(runId)) : waiting.length === 1 ? waiting[0] : null;
      return run?.resolveApproval(id, answer, 'user', feedback) ?? false;
    },

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

    'cliSessions:list': () => listCliSessions(),
    'cliSessions:rename': (opts) => renameCliSession(opts),
    'term:open': (opts) => openTerminal(opts),
    'term:kill': ({ id }) => { waiting.close(id); return terminals.kill(id); },
  }).map(([channel, fn]) => [channel, withWorkspace(fn)]));

  const notifications = {
    'term:input': ({ id, data }) => { waiting.input(id); terminals.input(id, data); },
    'term:resize': ({ id, cols, rows }) => terminals.resize(id, cols, rows),
    // what the window shows: no notification about the run or session the user is looking at
    'notify:context': (ctx) => { uiContext = notifier.normalizeContext(ctx); },
  };

  return {
    api,
    notifications,
    events,
    workspace: () => ws,
    setWorkspace,
    isRunning,
    // a run's folder (the run in progress without an id), for "Open log folder"
    runDir: (runId) => {
      if (!runId) return liveRun(null)?.runDir || null;
      try { return runFolder(runId); } catch { return null; }
    },
    // folders the UI may open on this machine: the workspace and the projects' folders
    openableFolders: () => [ws.root, ...projects.listProjects(ws.projects).map((x) => x.folder)],
    findArtifact,
    terminalSpec,
    // run worktrees left behind: succeeded runs whose removal failed, or unused for 14 days
    // (call at startup; the worktrees of runs in progress are never touched)
    cleanupWorktrees: () => cleanupWorktrees({
      worktreesDir: ws.worktrees, runsDir: ws.runs,
      active: [...active.values()].flatMap((r) => [r.worktree?.dir, r.resume?.worktree?.dir, path.join(ws.worktrees, r.runId)]).filter(Boolean),
    }),
    // the runs the app had in progress when it last closed, as notifications (call at startup)
    notifyInterruptedRun,
    shutdown() {
      waiting.closeAll();
      terminals.killAll();
      for (const run of active.values()) run.stop();
    },
  };
}

module.exports = { createService, BUNDLED_WORKFLOWS_DIR, BUNDLED_SKILLS_DIR };
