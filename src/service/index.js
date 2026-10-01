// Engine service: everything the UI can ask of the engine, with no dependency on Electron or on a
// transport. `api` maps a channel name ('projects:list', 'run:start', ...) to a function taking
// one argument; `notifications` are the fire-and-forget channels (no reply). Both come from one
// file per area in src/service/channels/ (a new channel is one edit there), and `manifest` is what
// the clients build `window.api` from (see src/service/manifest.js). Pushed data
// ('run:event', 'run:meta', 'supervisor:watch', 'term:data', 'term:exit') is emitted on `events`, and so are desktop notifications
// ('notify', see src/notifications.js), already filtered by the settings and what the UI shows.
// The service owns the workspace's SQLite index (src/store.js, #76): it writes the run index, the
// pending gates and every notification as the engine emits, and pushes 'notifications:changed'.
//
// Today src/main.js exposes it over Electron IPC; the same object can be exposed over HTTP +
// WebSocket so the engine runs on a server and the UI connects to it.
//
// What depends on the machine the engine runs on comes from `host`:
//   trashItem(path)  moves a file to the trash (skills and workflows are never hard-deleted)
//   appVersion       shown in Settings
//   isPackaged       the packaged app can't run itself as node (see terminalSpec)
//   assertCanRun({ mock })  optional; throws when the account may not start or resume a run
//   readPrJson(cmd, args)   optional; replaces the gh/glab call that reads a run's PR (tests, UI checks)
//   userDataDir      optional; the app's user data folder, where speech models live (src/speech.js)

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { WorkflowRun, loadWorkflow } = require('../engine/workflow');
const { Recorder } = require('../engine/recorder');
const { resolveCommand } = require('../engine/providers');
const simulation = require('../engine/simulation');
const capabilities = require('../engine/capabilities');
const { cleanupWorktrees, canonicalPath } = require('../engine/worktree');
const workspace = require('../workspace');
const projects = require('../projects');
const localPreview = require('../local-preview');
const backlog = require('../backlog');
const roadmaps = require('../roadmap');
const localPush = require('../local-push');
const skills = require('../skills');
const agents = require('../agents');
const usage = require('../usage');
const analytics = require('../analytics');
const actionsUsage = require('../actions-usage');
const { readLocalUsage } = require('../local-usage');
const cliSessions = require('../cli-sessions');
const { trustFolder } = require('../cli-trust');
const { createCodeVersion } = require('../code-version');
const runs = require('../runs');
const runPr = require('../run-pr');
const workflows = require('../workflows');
const builder = require('../workflow-builder');
const { Terminals } = require('../terminals');
const { followSession } = require('../session-tail');
const supervisor = require('../supervisor');
const notifier = require('../notifications');
const { openStore } = require('../store');
const {
  authChannels,
  declarations,
  DESKTOP,
  loadChannels,
} = require('./manifest');

const SRC = path.join(__dirname, '..');
const ROOT = path.join(SRC, '..');
// Bundled defaults (read-only in the packaged app): only a seed source for the workspace copies.
const BUNDLED_WORKFLOWS_DIR = workflows.BUNDLED_WORKFLOWS_DIR;
const BUNDLED_SKILLS_DIR = path.join(ROOT, 'skills');

const RESUME_ARGS = { 'claude-code': (id) => ['--resume', id], 'codex-cli': (id) => ['resume', id], 'grok-cli': (id) => ['--resume', id] };
const q = (a) => `"${String(a).replace(/"/g, '""')}"`;
const num = (v) => (v === '' || v == null || !Number.isFinite(+v) || +v <= 0 ? null : +v);
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

// Details for the Settings screen: path, version and (gh) authentication of each CLI.
function runTool(file, args, shellMode) {
  return new Promise((resolve) => {
    const cmd = shellMode ? `"${file}"` : file;
    execFile(cmd, args, { windowsHide: true, timeout: 15000, shell: shellMode }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() }));
  });
}

// A session in the same shape whether it comes from the live engine or from a run on disk.
// tokens: the breakdown plus `total` (as on the Usage screen), or null when the session has none.
function sessionView(x, live) {
  return {
    id: x.id, agent: x.agent, provider: x.provider, model: x.model, status: x.status,
    providerSessionId: live ? x.providerSessionId : x.provider_session_id || null,
    cwd: x.cwd || null, turns: x.turns || 0, costUsd: live ? x.costUsd : x.cost_usd || 0,
    tokens: tokensView(x.tokens),
  };
}

function tokensView(t) {
  if (!t || typeof t !== 'object') return null;
  const n = (v) => (Number.isFinite(+v) ? +v : 0);
  const out = { input: n(t.input), output: n(t.output), cache_read: n(t.cache_read), cache_write: n(t.cache_write), reasoning: n(t.reasoning) };
  out.total = usage.totalTokens(out);
  return out;
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
  // the code this process started with, to tell a window it runs newer code (#83)
  const code = createCodeVersion({ appVersion: host.appVersion, isPackaged: host.isPackaged });
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

  // ---- the PR of each run (#84) ------------------------------------------------------------
  // Read with gh/glab (no LLM), cached by URL: the runs in progress every minute and on their
  // events, finished runs when a list shows them (runs:prState). A change is pushed on 'run:meta'
  // ({ runId, pr } or { runId, title, customTitle }). A simulated run's PR is not real: never read
  // (unless host.readPrJson stands in for gh/glab).
  const prs = runPr.prCache({ reader: host.readPrJson });
  const SIMULATED_PR = { state: 'unknown', detail: 'simulated run: its PR is not real, so it is not read' };
  const unreadPr = (mock) => !!mock && !host.readPrJson;
  const prSeen = new Map(); // run id → "url state" last pushed
  function withPrState(pr, mock) {
    if (!pr) return null;
    if (unreadPr(mock)) return { ...pr, ...SIMULATED_PR, checkedAt: null };
    const hit = prs.get(pr.url);
    return hit ? { ...pr, state: hit.state, detail: hit.detail, checkedAt: hit.checkedAt } : { ...pr, state: null, detail: null, checkedAt: null };
  }
  async function refreshLivePr(run, maxAgeMs) {
    if (!run.pr) return;
    const pr = unreadPr(run.mock) ? withPrState(run.pr, true) : await prs.refresh(run.pr, { maxAgeMs });
    const key = `${pr.url} ${pr.state}`;
    if (prSeen.get(run.runId) === key) return;
    prSeen.set(run.runId, key);
    events.emit('run:meta', { runId: run.runId, pr });
  }
  // { title, customTitle } of a run in progress (meta.json, the run it resumes, its issue or task)
  const liveTitle = (run) => runs.runTitle(ws.runs, run.runId, { issues: run.issues, inputs: run.inputs });
  const prTimer = setInterval(() => {
    for (const run of active.values()) refreshLivePr(run, 0).catch((e) => console.error('run PR:', e.message));
  }, 60 * 1000);
  prTimer.unref?.();

  // ---- desktop notifications ----------------------------------------------------------------
  // uiContext: what the window shows ({ focused, runId, terminalId }), reported by the UI.
  let uiContext = notifier.normalizeContext(null);
  // Every notice is a row of the notification center (whatever the settings say about showing it on
  // the desktop); `extra`: { projectId, issue } of its run. The desktop notice carries the row's id
  // in its target, so a click on it marks it read.
  function notify(notice, extra = {}) {
    if (!notice) return;
    let settings = {};
    try { if (ws) settings = workspace.readSettings(ws); } catch { /* defaults */ }
    let shown = notice;
    if (store) {
      try {
        const row = store.addNotification({
          type: `${notice.kind}.${notice.event}`, kind: notice.kind, runId: notice.target?.runId || null,
          projectId: extra.projectId || null, issue: extra.issue || null, title: notice.title, body: notice.body, target: notice.target || null,
        });
        store.pruneNotifications(settings.notificationRetentionDays ?? workspace.DEFAULT_SETTINGS.notificationRetentionDays);
        shown = { ...notice, target: { ...notice.target, notificationId: row.id } };
        events.emit('notifications:changed', { unread: store.unreadCount(), latest: row });
      } catch (e) { console.error('notification center:', e.message); }
    }
    if (notifier.shouldNotify(notice, { settings, context: uiContext })) events.emit('notify', shown);
  }

  // ---- the workspace's index (src/store.js) ----------------------------------------------------
  // Opened with the workspace; without it (node:sqlite missing, a locked or broken file) everything
  // still works on the plain files, the notification center and the gate history excepted.
  let store = null;
  let storeError = null;
  function openIndex() {
    try { store?.close(); } catch { /* already closed */ }
    store = null;
    storeError = null;
    try { store = openStore(ws); } catch (e) { storeError = e.message; console.error('index.db:', e.message); return; }
    // gates still open from the last time are of runs that did not survive: interrupted, never phantom gates
    try {
      for (const g of store.interruptGates([...active.keys()])) {
        notify({
          kind: 'run', event: 'gate_interrupted', title: `Gate interrupted: ${g.stepId || g.approvalId}`,
          body: `${g.message ? `${String(g.message).slice(0, 180)}\n` : ''}The app closed while run ${g.runId} waited here. Resume it from the run screen.`,
          target: { runId: g.runId },
        });
      }
    } catch (e) { console.error('index.db gates:', e.message); }
    // the run index catches up with runs/ (a new or rebuilt index reads every run once)
    setTimeout(() => { try { if (ws) runs.listRuns(ws.runs); } catch (e) { console.error('run index:', e.message); } }, 0);
  }
  // What the engine emitted, written to the index: the run's row, its gates.
  function indexEvent(run, ev) {
    if (!store) return;
    try {
      if (ev.type === 'approval.requested') {
        const gate = run.pendingGates().find((g) => g.approval_id === ev.approval_id);
        if (gate) store.openGate(run.runId, gate); // answered by a listener already: no gate to keep
      } else if (ev.type === 'approval.resolved') store.closeGate(run.runId, ev.approval_id, ev.withdrawn ? 'withdrawn' : 'resolved');
      else if (ev.type === 'workflow.finished') store.closeRunGates(run.runId, 'closed');
      // summary.json is written with workflow.finished; workflow.started reaches events.jsonl through a
      // stream, so its row is read a moment later (a listing in between indexes it anyway)
      if (ev.type === 'workflow.finished') runs.indexRun(ws.runs, run.runId);
      if (ev.type === 'workflow.started') setTimeout(() => { try { if (store) runs.indexRun(ws.runs, run.runId); } catch { /* the next listing */ } }, 1000);
    } catch (e) { console.error('index.db:', e.message); }
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
    openIndex();
    // queued issues never start on their own after a restart or a workspace change
    try { backlog.pauseAll(ws.backlog, 'Paused when the app started: resume to start the queued issues.'); } catch (e) { console.error('backlog queues:', e); }
    // a started roadmap continues where it was: its runs that ended meanwhile settle their stage
    // (an interrupted one pauses it), the next stage starts when the current one is over
    setTimeout(() => dispatchRoadmaps().catch((e) => console.error('roadmap dispatch:', e)), 0);
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

  // What the UI shows of each run in progress (the Run menu list). `gates` are the gates the run
  // waits at (approval_id, step_id, message, choices, feedback, requested_at): the sidebar, the
  // Backlog and a reloaded window all read them here, never only from the events they saw live.
  // With the index open the gates come from its table (written as the engine emits them).
  function activeRuns() {
    return [...active.values()].map((r) => {
      let gates = r.pendingGates();
      try { if (store) gates = store.openGates(r.runId); } catch (e) { console.error('index.db gates:', e.message); }
      return {
        runId: r.runId, workflow: r.wf.metadata?.name || path.basename(r.file), file: path.basename(r.file), mock: r.mock,
        projectId: r.projectId, issues: r.issues, startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
        status: r.status, waiting: gates.length, gates, inputs: r.inputs, agent_names: r.agentNames(),
        ...liveTitle(r), pr: withPrState(r.pr, r.mock),
      };
    });
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
          // the visual builder opens it only when it draws everything the workflow uses
          const drawn = builder.fromWorkflow(wf).problems;
          return {
            file,
            ...origin,
            builder: !drawn.length,
            builderProblems: drawn,
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

  // Visual builder (Workflows > Builder): a workflow as the builder's spec, and back to YAML.
  // mode: 'full' (drawn by the builder: everything editable), 'fixed' (uses what the builder doesn't
  // draw: agents and prompts editable, the steps stay as they are) or 'readonly' (bundled with the
  // app: clone it to change it).
  const isBundled = (name) => (workflows.workflowStatus(BUNDLED_WORKFLOWS_DIR, ws.workflows)[name]?.origin || 'custom') !== 'custom';
  function loadBuilderWorkflow(file) {
    const name = path.basename(String(file || ''));
    const doc = loadWorkflow(path.join(ws.workflows, name));
    const drawn = builder.fromWorkflow(doc);
    const fixed = drawn.problems.length > 0;
    const mode = isBundled(name) ? 'readonly' : fixed ? 'fixed' : 'full';
    return { file: name, mode, problems: drawn.problems, spec: fixed ? builder.describeWorkflow(doc) : drawn.spec };
  }

  // A new workflow gets a file named after it (never overwriting one); an edited one keeps its file
  // and what the builder doesn't touch (providers, defaults, orchestrator, observability; for a
  // fixed spec, everything but the agents and the prompts).
  function saveBuilderWorkflow({ file, spec }) {
    const name = file ? path.basename(String(file)) : builder.fileNameFor(spec?.name);
    if (!workflows.isWorkflowFile(name)) throw new Error(`Not a workflow file: ${name}`);
    const dest = path.join(ws.workflows, name);
    if (!file && fs.existsSync(dest)) throw new Error(`A workflow file named ${name} already exists: pick another name.`);
    if (file && isBundled(name)) throw new Error(`"${name}" is bundled with the app: clone it to change it.`);
    const exists = file && fs.existsSync(dest);
    const base = exists ? loadWorkflow(dest) : null;
    let text;
    if (spec?.fixed) {
      if (!base) throw new Error(`Workflow not found: ${name}`);
      text = builder.patchWorkflow(base, spec, builder.leadingComments(fs.readFileSync(dest, 'utf8')));
    } else {
      text = builder.toYaml(spec, base);
    }
    fs.mkdirSync(ws.workflows, { recursive: true });
    // checked by the engine's own loader before it replaces anything
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, text);
    try { loadWorkflow(tmp); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    fs.renameSync(tmp, dest);
    return { file: name };
  }

  // A copy of any workflow as the user's own (custom): "<name>-copy", comments kept.
  function cloneBuilderWorkflow(file) {
    const name = path.basename(String(file || ''));
    const src = path.join(ws.workflows, name);
    const doc = loadWorkflow(src);
    const base = String(doc.metadata?.name || name.replace(/\.ya?ml$/i, ''));
    let n = 1, copyName, dest;
    do {
      copyName = `${base}-copy${n > 1 ? `-${n}` : ''}`;
      dest = path.join(ws.workflows, builder.fileNameFor(copyName));
      n++;
    } while (fs.existsSync(dest));
    fs.writeFileSync(dest, builder.cloneText(fs.readFileSync(src, 'utf8'), copyName));
    try { loadWorkflow(dest); } catch (e) { fs.rmSync(dest, { force: true }); throw e; }
    return { file: path.basename(dest) };
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
  async function startWorkflowRun({ file, inputs, mock, mockSequences = null, resume = null, projectId: forcedProject = null, issues = null }) {
    // simulation-only (automated checks): a real run is refused, never turned into a simulation
    if (!mock) simulation.refuseReal('a real run');
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
      const project = projectId ? projects.listProjects(ws.projects).find((p) => p.id === projectId) : null;
      run = new WorkflowRun({
        file: wfFile.file, inputs, mock, runsDir: ws.runs, skillsDirs: [ws.skills], notices,
        // Run locally at gates: the project's override of the workflow's orchestrator.local_preview
        localPreview: project?.localPreview?.command ? project.localPreview : null,
        budget, prices: settings.prices, projectId, issues, resume, mockSequences: mock ? mockSequences : null,
        // simulation runs never touch git: the agents are mocked and work in the repository folder
        worktreesDir: mock ? null : ws.worktrees,
        // concurrent runs share the monthly budgets
        peerSessions: () => peerSessions(run),
        idleWarnMs: settings.idleWarningMinutes != null && Number.isFinite(+settings.idleWarningMinutes) ?+settings.idleWarningMinutes * 60e3 : undefined,
        // `persona: random` agents become one of the user's agents (Agents menu)
        personas: agents.listAgents(ws.agents).filter((a) => !a.system && !a.error),
        // CI waiting on a PR whose account ran out of Actions minutes reports it instead of waiting
        actionsQuota: async (owner) => actionsUsage.quotaExhausted(await actionsUsage.getActionsUsage({ owner, includedMinutes: +settings.actionsIncludedMinutes || 0 })),
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
      // the run's display title (#84), read when a notice is made: the owner can change it meanwhile
      get title() { return liveTitle(run).title; },
    };
    // a resumed run shows the PR of the run it resumes until one of its steps reports one
    run.pr = resume?.runId ? runs.runPr(ws.runs, resume.runId) : null;
    run.on('event', (ev) => {
      try { recorder.write(ev); } catch (e) { console.error('recorder:', e); }
      indexEvent(run, ev);
      const pr = ev.type === 'step.finished' ? runPr.prOfOutput(ev.output) : null;
      if (pr) run.pr = pr;
      if (run.pr) refreshLivePr(run, pr || ev.type === 'workflow.finished' ? 0 : 15000).catch((e) => console.error('run PR:', e.message));
      if (ev.type === 'workflow.finished') runEnded(run);
      // a local preview lives only while its gate is open
      if (ev.type === 'approval.resolved' || ev.type === 'workflow.finished') {
        stopLocalPreview({ runId: run.runId, reason: ev.type === 'approval.resolved' ? 'the gate was answered' : 'the run ended' });
      }
      if (ev.type === 'worktree.merged') afterLocalMerge(run, ev).catch((e) => console.error('after local merge:', e));
      events.emit('run:event', ev);
      if (ev.type === 'workflow.started') markActiveRun(run.runId, runInfo);
      if (ev.type === 'workflow.finished') markActiveRun(run.runId, null);
      notify(notifier.runNotice(ev, runInfo), { projectId: run.projectId, issue: run.issues?.map((i) => `#${i.number}`).join(', ') || null });
      // the next issues waiting in a Backlog queue start once this run is over; a queued issue whose
      // run failed pauses its queue (a failure that repeats would otherwise burn through it)
      if (ev.type === 'workflow.finished') {
        if (run.issues && run.projectId && ev.status === 'failed' && !run.mock) {
          try { backlog.setPaused(ws.backlog, run.projectId, true, `${run.issues.map((i) => `#${i.number}`).join(', ')} failed: resume to start the next issues.`); } catch (e) { console.error('backlog queue:', e); }
        }
        queueFiledIssues(run, ev).catch((e) => console.error('issue tracker queue:', e.message));
        // a roadmap's next items first (its stage may be over), then the plain queue
        setTimeout(() => dispatchRoadmaps().catch((e) => console.error('roadmap dispatch:', e)).then(() => dispatchQueue()).catch((e) => console.error('backlog dispatch:', e)), 1000);
      }
    });
    // a failed roadmap item's run resumed from a step (#100): the new run takes its place
    if (resume?.runId && run.projectId) {
      try { roadmaps.adoptResumed(ws.backlog, run.projectId, resume.runId, run.runId); } catch (e) { console.error('roadmap resume:', e); }
    }
    run.start();
    return { runId: run.runId, runDir: run.runDir };
  }

  // Provider config of a run's workflow: the live one, or the workflow file named in its events.
  function runWorkflow(runId, file) {
    const live = active.get(runId);
    if (live) return live.wf;
    try { return loadWorkflow(workflowPath(file).file); } catch { return {}; }
  }
  const runProviders = (runId, file) => runWorkflow(runId, file).providers || {};

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
    if (mode !== 'live') simulation.refuseReal(`the ${sess.provider} CLI`);
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
    simulation.refuseReal(`the supervisor's CLI (${cfg.provider.command || 'claude'})`);
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
    simulation.refuseReal(`the ${p.command} CLI`);
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

  // A shell in a folder of the workspace or of a project (Open the worktree at a gate)
  function shellSpec(folder) {
    const dir = path.resolve(String(folder || ''));
    const inside = [ws.root, ...projects.listProjects(ws.projects).map((x) => x.folder)].filter(Boolean).some((d) => folderMatcher()(dir, d));
    if (!inside) throw new Error('The folder is outside the workspace and the projects.');
    if (!fs.existsSync(dir)) throw new Error(`Folder not found: ${dir}`);
    const win = process.platform === 'win32';
    return { title: path.basename(dir), cwd: dir, file: win ? 'cmd.exe' : process.env.SHELL || '/bin/sh', args: [], env: cliEnv() };
  }

  // Show the diff at a gate with `diff_base` (developer_check): the worktree's changes since that
  // ref, read-only. The ref and the folder come from the open gate, never from the caller.
  // file: only that file's diff (a changed file clicked in the gate's Artifacts panel, #108).
  function openDiffGate({ runId, approvalId }) {
    const run = active.get(String(runId || ''));
    const gate = run?.pendingGates().find((g) => g.approval_id === approvalId);
    if (!gate) throw new Error('The gate is no longer open.');
    if (!gate.diff_base || !gate.work_dir) throw new Error('This gate does not offer a diff.');
    if (gate.diff_base.startsWith('-')) throw new Error(`Not a ref: ${gate.diff_base}`);
    return gate;
  }

  function gateDiffSpec({ runId, approvalId, file }) {
    const gate = openDiffGate({ runId, approvalId });
    // ConPTY does not look a bare command name up in PATH
    const git = resolveCommand('git');
    if (!git) throw new Error('git is not installed.');
    const only = file ? [String(file)] : [];
    return {
      title: `Diff ${gate.diff_base}...HEAD${file ? ` · ${path.basename(String(file))}` : ''}`, cwd: gate.work_dir, file: git.file, env: cliEnv(),
      args: ['--no-pager', 'diff', '--color=always', '--stat', '--patch', `${gate.diff_base}...HEAD`, '--', ...only],
    };
  }

  // The files a gate with `diff_base` changed (git diff --numstat), for its Artifacts panel (#108):
  // [{ file, added, deleted }] (null counts for binary files).
  async function gateChanges({ runId, approvalId }) {
    const gate = openDiffGate({ runId, approvalId });
    const git = resolveCommand('git');
    if (!git) throw new Error('git is not installed.');
    const { ok, out } = await runTool(git.file, ['-C', gate.work_dir, '--no-pager', 'diff', '--numstat', `${gate.diff_base}...HEAD`, '--']);
    if (!ok) throw new Error(/not a git repository/i.test(out) ? 'the run\'s folder is not a git repository (a simulation works in the project folder).' : `git diff failed: ${out.split('\n')[0]}`);
    return out.split(/\r?\n/).filter(Boolean).map((l) => {
      const [added, deleted, ...rest] = l.split('\t');
      return { file: rest.join('\t'), added: added === '-' ? null : +added, deleted: deleted === '-' ? null : +deleted };
    }).filter((c) => c.file);
  }

  // Run locally at a gate (#70, src/local-preview.js): one preview per run, in the run's worktree,
  // stopped when the gate is answered or the run ends. It never answers the gate.
  const previews = new Map(); // runId -> { id (terminal), stepId, approvalId, title, url, dir, startedAt }

  // Run App (#108): the config a gate runs, read now (a Local preview saved while the gate waits
  // applies at once): the project's, else the workflow's, else the one the gate was opened with.
  function gateRunConfig(run, gate) {
    const project = run.projectId ? projects.listProjects(ws.projects).find((p) => p.id === run.projectId) : null;
    return { project, config: localPreview.resolveConfig(project, run.wf) || (gate.local_preview?.command ? gate.local_preview : null) };
  }

  function openRunAppGate({ runId, approvalId }) {
    const run = active.get(String(runId || ''));
    if (!run) throw new Error('The run is not in progress.');
    const gate = run.pendingGates().find((g) => g.approval_id === approvalId);
    if (!gate) throw new Error('The gate is no longer open.');
    if (!(gate.run_app || gate.local_preview) || !gate.work_dir) throw new Error('This gate does not offer Run locally (Run App): no local_preview on the step.');
    return { run, gate };
  }

  // What the gate's Run App button runs, and when nothing is configured, a setup prefilled from
  // the worktree (package.json scripts, the README, a known framework).
  function runAppInfo({ runId, approvalId }) {
    const { run, gate } = openRunAppGate({ runId, approvalId });
    const { project, config } = gateRunConfig(run, gate);
    const source = project?.localPreview?.command ? 'project' : config ? 'workflow' : null;
    return {
      config, source, dir: gate.work_dir,
      project: project ? { id: project.id, name: project.name } : null,
      suggestion: config ? null : localPreview.suggestConfig(gate.work_dir),
      running: previews.has(run.runId) && terminals.procs.has(previews.get(run.runId).id),
    };
  }

  // config: a one-off command from the gate's setup when the run has no project to save it to.
  async function startLocalPreview({ runId, approvalId, realWorkspace = false, cols, rows, config = null }) {
    const { run, gate } = openRunAppGate({ runId, approvalId });
    // a terminal that went away without reporting its exit does not block the next preview
    if (previews.has(run.runId) && !terminals.procs.has(previews.get(run.runId).id)) previews.delete(run.runId);
    if (previews.has(run.runId)) throw new Error('A local preview of this run is already running: stop it first.');
    const cfg = gateRunConfig(run, gate).config || (config?.command ? { install: config.install || null, command: String(config.command), url: config.url || null } : null);
    if (!cfg) throw new Error('No command to run: set the project\'s Local preview (Run App opens its setup).');
    const dir = gate.work_dir;
    if (!fs.existsSync(dir)) throw new Error(`The run's folder no longer exists: ${dir}`);
    const port = cfg.url ? localPreview.portOf(cfg.url) : null;
    if (port && await localPreview.portInUse(port)) throw new Error(`Port ${port} (${cfg.url}) is already in use: stop what listens on it (another local preview?) and try again.`);
    const root = path.join(ws.localPreviews, run.runId);
    const target = realWorkspace ? { workspace: ws.root, userData: null } : localPreview.scratchWorkspace(ws, root);
    const stateFile = path.join(root, 'install.json');
    const due = localPreview.needsInstall(dir, stateFile);
    const line = localPreview.commandLine(cfg, due.install);
    const label = run.issues?.length ? run.issues.map((i) => `#${i.number}`).join(', ') : run.runId;
    const title = `Local preview · ${label}`;
    const win = process.platform === 'win32';
    const spec = {
      title, cwd: dir, env: localPreview.previewEnv(cliEnv(), target),
      file: win ? 'cmd.exe' : '/bin/sh', args: win ? `/d /s /c "${line}"` : ['-c', line],
      onExit: (exitCode) => {
        const p = previews.get(run.runId);
        if (!p || p.id !== opened.id) return;
        // the program ended by itself (or its terminal was closed): the install succeeded when it exits 0
        previews.delete(run.runId);
        if (exitCode === 0 && due.install) localPreview.recordInstall(stateFile, due.hash);
        if (['pending', 'running'].includes(run.status)) run.emitEvent('local_preview.stopped', { step_id: p.stepId, approval_id: p.approvalId, exit_code: exitCode });
      },
    };
    const opened = openProgram(spec, cols, rows);
    // an install that was not due: the lockfile hash is known now
    if (!due.install) localPreview.recordInstall(stateFile, due.hash);
    const info = { id: opened.id, stepId: gate.step_id, approvalId, title, url: cfg.url || null, dir, startedAt: new Date().toISOString() };
    previews.set(run.runId, info);
    run.emitEvent('local_preview.started', {
      step_id: gate.step_id, approval_id: approvalId, command: line, dir, url: cfg.url || null, terminal: opened.id,
      workspace: realWorkspace ? 'real' : 'scratch', installed: !!(due.install && cfg.install),
    });
    return { ...opened, url: cfg.url || null, cwd: dir };
  }

  // Recorded here rather than on the program's exit: a killed tree does not always report one.
  function stopLocalPreview({ runId, reason = 'stopped by the owner' }) {
    const id = String(runId || '');
    const p = previews.get(id);
    if (!p) return false;
    previews.delete(id);
    terminals.kill(p.id);
    // a run that ended records nothing after its workflow.finished
    const run = active.get(id);
    if (run && ['pending', 'running'].includes(run.status)) run.emitEvent('local_preview.stopped', { step_id: p.stepId, approval_id: p.approvalId, reason });
    return true;
  }

  const listLocalPreviews = () => [...previews.entries()].map(([runId, p]) => ({ runId, id: p.id, stepId: p.stepId, approvalId: p.approvalId, title: p.title, url: p.url, dir: p.dir, startedAt: p.startedAt }));

  // Embedded terminals (xterm.js in the UI + node-pty here)
  function openTerminal({ kind, runId, sessionId, cols, rows, ...opts }) {
    if (kind === 'supervisor') return openProgram(supervisorChatSpec(runId || liveRun(null)?.runId), cols, rows);
    if (kind === 'shell') return { ...openProgram(shellSpec(opts.folder), cols, rows), cwd: path.resolve(String(opts.folder)) };
    if (kind === 'diff') {
      const spec = gateDiffSpec({ runId, approvalId: opts.approvalId, file: opts.file });
      return { ...openProgram(spec, cols, rows), cwd: spec.cwd };
    }
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

  const runIsLive = (runId) => ['pending', 'running'].includes(active.get(runId)?.status);

  // Continues a run from a step: a new run with the previous outputs, agent conversations and an
  // instruction. Called by the owner directly (Resume from step…) and by the supervisor's
  // recommendations; no LLM call. It never goes past a human gate on an earlier decision: a step
  // after a gate the previous run decided is refused, and every gate reached again asks again.
  // mock: true resumes as a simulation (a simulated run always resumes as one).
  function resumeRun({ runId, step, instruction, mock }) {
    const runDir = runFolder(runId);
    if (runIsLive(path.basename(runDir))) throw new Error('The run is still active: wait for it to end (or stop it) before resuming it.');
    const spec = supervisor.resumeSpec(runDir, step);
    if (!spec.file) throw new Error('The run does not record its workflow file.');
    const wf = loadWorkflow(workflowPath(spec.file).file);
    const fromStep = step || wf.steps[0].id;
    if (!wf.steps.some((s) => s.id === fromStep)) throw new Error(`Cannot resume: step "${fromStep}" does not exist in the current version of the workflow.`);
    const gate = supervisor.skippedGate(wf, fromStep, spec.steps);
    if (gate) throw new Error(`Cannot resume from "${fromStep}": it would go past the human gate "${gate}" on the previous run's decision. Resume from "${gate}" instead: it asks again.`);
    return startWorkflowRun({
      file: spec.file, inputs: spec.inputs, mock: spec.mock || mock === true, projectId: spec.projectId, issues: spec.issues,
      resume: { runId: spec.runId, fromStep, steps: supervisor.withoutGateDecisions(wf, spec.steps), sessions: spec.sessions, handoffs: spec.handoffs, instruction: instruction || null, worktree: spec.worktree },
    });
  }

  // What the Resume from step… dialog shows: the workflow's steps in order (reached, where the run
  // stopped, the steps a decided gate keeps out of reach), the suggested step and what is kept.
  function resumeOptions({ runId }) {
    const runDir = runFolder(runId);
    const id = path.basename(runDir);
    const spec = supervisor.resumeSpec(runDir, null);
    if (!spec.file) throw new Error('The run does not record its workflow file.');
    let wf;
    try { wf = loadWorkflow(workflowPath(spec.file).file); } catch (e) { throw new Error(`The run's workflow (${spec.file}) cannot be loaded: ${e.message}`); }
    const visits = {};
    let stoppedAt = null;
    let failedStep = null;
    for (const ev of supervisor.readEvents(runDir)) {
      if (ev.type === 'step.started') { visits[ev.step_id] = (visits[ev.step_id] || 0) + 1; stoppedAt = ev.step_id; }
      if (ev.type === 'step.finished' && ev.error) failedStep = ev.step_id;
    }
    const status = runIsLive(id) ? 'running' : runs.readRun(ws.runs, id)?.status || 'interrupted';
    const steps = wf.steps.map((s) => ({
      id: s.id, type: s.type || 'agent', gate: s.type === 'human_approval', visits: visits[s.id] || 0,
      blockedBy: supervisor.skippedGate(wf, s.id, spec.steps),
    }));
    const exists = (x) => steps.some((s) => s.id === x && !s.blockedBy);
    const suggested = [status === 'failed' ? failedStep : null, stoppedAt, failedStep].find(exists) || steps.find((s) => !s.blockedBy)?.id || null;
    const wt = spec.worktree;
    return {
      runId: id, workflow: wf.metadata?.name || spec.file, file: spec.file, status, active: status === 'running', mock: spec.mock,
      steps, stoppedAt, failedStep, suggested,
      worktree: wt ? { dir: wt.dir, branch: wt.branch, exists: fs.existsSync(wt.dir) } : null,
      sessions: Object.keys(spec.sessions), handoffs: Object.keys(spec.handoffs),
    };
  }

  // ---- run lists (Projects > Project and Workflows > Runs) ------------------------------
  function runListItem(r) {
    const run = active.get(r.runId);
    const current = !!run && run.status === 'running';
    const live = current ? [...run.sessions.values()].map((x) => sessionView(run.snapshot(x), false)) : null;
    // the orchestrator first: its live log is the run's timeline
    const sessions = (live || r.sessions.map((x) => sessionView(x, false))).sort((a, b) => (b.agent === 'orchestrator') - (a.agent === 'orchestrator'));
    const wf = runWorkflow(current ? r.runId : 'disk', r.file);
    const providers = wf.providers || {};
    const { inputs, ...info } = r;
    return {
      ...info,
      // { number, url, state, detail, checkedAt }: the state from the cache (null until read, runs:prState)
      pr: withPrState(run?.pr || r.pr, r.mock),
      artifacts: runs.runArtifacts(r.runDir),
      status: current ? 'running' : r.status,
      current,
      // runs recorded before `groups:` take the workflow's current ones
      groups: r.groups || wf.groups || [],
      // a run in progress: the engine's own trail, not events.jsonl
      progress: current ? run.trail.steps : r.progress,
      costUsd: current ? sessions.reduce((a, x) => a + (x.costUsd || 0), 0) : r.costUsd,
      sessions: sessions.map((x) => {
        const why = cliReason(x, providers, current);
        return { ...x, cliAvailable: !why, cliReason: why };
      }),
    };
  }

  // The PR of a run with its state read now (or from the cache, under 5 minutes old): the lists ask
  // for the runs they show. null when the run opened none.
  async function runPrState({ runId }) {
    const id = path.basename(runFolder(runId));
    const run = active.get(id);
    const r = run ? { pr: run.pr, mock: run.mock } : runs.readRun(ws.runs, id);
    if (!r?.pr) return null;
    return unreadPr(r.mock) ? withPrState(r.pr, true) : prs.refresh(r.pr);
  }

  // The owner's title for a run (empty: back to the default), in runs/<id>/meta.json: events.jsonl
  // is never touched. Pushed on 'run:meta' so every window and list shows it.
  function setRunTitle({ runId, title }) {
    const dir = runFolder(runId);
    const id = path.basename(dir);
    runPr.writeTitle(dir, title);
    const run = active.get(id);
    const r = run ? null : runs.readRun(ws.runs, id);
    const out = { runId: id, ...runs.runTitle(ws.runs, id, run ? { issues: run.issues, inputs: run.inputs } : { issues: r?.issues, task: r?.task }) };
    events.emit('run:meta', out);
    return out;
  }

  function projectRuns({ id }) {
    const project = projects.listProjects(ws.projects).find((p) => p.id === id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return { project, local: backlog.readLocal(ws.backlog, project.id), runs: runs.runsForProject(runs.listRuns(ws.runs), project).map(runListItem) };
  }

  // A synced backlog with each issue's runs and place in the queue (computed on every read: runs
  // come and go), plus the queue itself.
  function withIssueRuns(data) {
    if (!data) return null;
    const project = projects.listProjects(ws.projects).find((p) => p.id === data.projectId);
    const list = project ? runs.runsForProject(runs.listRuns(ws.runs), project) : [];
    const live = list.map((r) => {
      const run = active.get(r.runId);
      const pr = withPrState(run?.pr || r.pr, r.mock); // the card's PR icon (#84)
      return run ? { ...r, status: 'running', waiting: run.approvals.size > 0, pr } : { ...r, pr };
    });
    const queue = backlog.readQueue(ws.backlog, data.projectId);
    const local = backlog.readLocal(ws.backlog, data.projectId);
    // the roadmap, each item with its run's live state, and each issue's stage ("Roadmap: stage 2")
    const roadmap = roadmapView(data.projectId, live);
    const stages = roadmaps.issueStages(roadmap);
    const issues = backlog.linkRuns(data.issues, live, queue, local).map((i) => (stages.has(i.number) ? { ...i, roadmap: stages.get(i.number) } : i));
    return { ...data, queue, local, roadmap, autoPush: !!project?.autoPush, issues };
  }

  // A project's roadmap for the screen: each running item with `waiting` (at a human gate).
  function roadmapView(projectId, list = []) {
    const roadmap = roadmaps.readRoadmap(ws.backlog, projectId);
    const byId = new Map(list.map((r) => [r.runId, r]));
    return {
      ...roadmap,
      stages: roadmap.stages.map((s) => ({
        ...s, items: s.items.map((x) => (x.status === 'running' && byId.get(x.runId)?.waiting ? { ...x, waiting: true } : x)),
      })),
    };
  }

  // ---- local merges not pushed (software-development-local-hero, src/local-push.js) ----
  // The base a project's local runs merge into: the newest run's `merge: local`, else the
  // repository's default branch (chosen by localStatus).
  function projectBase(project) {
    return runs.runsForProject(runs.listRuns(ws.runs), project).find((r) => r.localMerge?.base)?.localMerge.base || null;
  }
  const gitProject = (projectId) => {
    const project = projects.readProject(ws.projects, path.basename(String(projectId)));
    if (!project.isGit) throw new Error(`The folder of ${project.name} is not a git repository: ${project.folder || '(none)'}.`);
    return project;
  };

  // Checks (fetch: true fetches origin/<base> first) and caches what the project's local base has
  // that origin has not. A failure is cached too (the Backlog then assumes local merges are not pushed).
  async function refreshLocal(projectId, { fetch = true, base = null } = {}) {
    const project = projects.readProject(ws.projects, path.basename(String(projectId)));
    if (!project.isGit) return null;
    let status;
    try {
      status = await localPush.localStatus({ repo: project.folder, base: base || projectBase(project), fetch });
    } catch (e) {
      status = { error: e.message, ahead: 0, behind: 0, commits: [], issues: [], checkedAt: new Date().toISOString() };
    }
    return backlog.writeLocal(ws.backlog, project.id, status);
  }

  // The Backlog after a push: the status just written, and a new sync when there is one to redo
  // (the issues the push closed move to Done; a sync that fails keeps the cache).
  async function afterPush(projectId, result) {
    backlog.writeLocal(ws.backlog, projectId, result.status);
    const data = backlog.readBacklog(ws.backlog, projectId);
    if (result.pushed && data) {
      const project = projects.readProject(ws.projects, projectId);
      await backlog.syncBacklog({ dir: ws.backlog, project, platform: data.platform }).catch((e) => console.error('backlog sync after push:', e.message));
    }
    const { status, ...rest } = result;
    return { ...rest, local: status, backlog: withIssueRuns(backlog.readBacklog(ws.backlog, projectId)) };
  }

  async function pushProject({ projectId, update = false, base = null }) {
    const project = gitProject(projectId);
    base = base || projectBase(project);
    const result = update ? await localPush.updateAndPush({ repo: project.folder, base }) : await localPush.pushBase({ repo: project.folder, base });
    // a merge conflict (#69) is a row of the notification center too, whoever asked for the push
    if (result.conflict) notify(notifier.pushConflictNotice({ project, base, files: result.files, error: result.error }), { projectId: project.id });
    return afterPush(project.id, result);
  }

  // A push conflict (Update and push found the local base conflicting with origin) handed to a run
  // of the local workflow that merged there last (software-development-local-hero when none): its
  // developer merges origin/<base> into the run's branch and resolves the conflict, the change is
  // reviewed, tested, built and verified, then merged locally; Push takes it from there.
  async function resolvePushConflict({ projectId, files = [], mock = false }) {
    const project = gitProject(projectId);
    const last = runs.runsForProject(runs.listRuns(ws.runs), project).find((r) => r.localMerge?.base && r.file);
    const base = last?.localMerge.base || projectBase(project);
    const status = await localPush.localStatus({ repo: project.folder, base, fetch: false });
    if (status.error) throw new Error(status.error);
    if (!status.behind) throw new Error(`The local ${status.base} already has every commit of origin/${status.base}: push it.`);
    const file = last ? path.basename(last.file) : 'software-development-local-hero.yaml';
    const wf = loadWorkflow(workflowPath(file).file);
    if (!wf.inputs?.task) throw new Error(`Workflow ${wf.metadata?.name || file} has no task input to receive the conflict.`);
    const inputs = { task: localPush.conflictTask({ ...status, files: (files || []).map(String) }) };
    for (const [k, def] of Object.entries(wf.inputs)) {
      if (k === 'task') continue;
      if (/^base(_branch)?$/.test(k)) inputs[k] = status.base;
      else if ((def.type || 'string') === 'string' && /path|dir/i.test(k)) inputs[k] = project.folder;
      else if (k === 'language' && last?.inputs?.language) inputs[k] = last.inputs.language;
    }
    return startWorkflowRun({ file, inputs, mock: !!mock, projectId: project.id });
  }

  // After a run's `merge: local`: the project's count of commits not pushed, and the push when the
  // project asks for it (auto-push, off by default). A rejected or failed push only notifies: the
  // Backlog's Push / Update and push takes it from there.
  async function afterLocalMerge(run, { base }) {
    if (!run.projectId || run.mock) return;
    const project = projects.readProject(ws.projects, run.projectId);
    if (project.autoPush && project.isGit) {
      try {
        const r = await pushProject({ projectId: project.id, base });
        if (!r.pushed && r.rejected) throw new Error(`origin moved: use Update and push in the Backlog. ${r.error || ''}`);
      } catch (e) {
        notify({ kind: 'run', event: 'failed', title: `Auto-push failed: ${project.name}`, body: e.message.slice(0, 180), target: { runId: run.runId, workflow: run.wf.metadata?.name } });
      }
      return;
    }
    await refreshLocal(project.id, { fetch: false, base });
  }

  // Projects with local commits not pushed, from the cached checks (sidebar badge; no git here).
  function unpushedProjects() {
    return projects.listProjects(ws.projects)
      .map((p) => ({ projectId: p.id, name: p.name, local: backlog.readLocal(ws.backlog, p.id) }))
      .filter((x) => x.local?.ahead > 0)
      .map(({ projectId, name, local }) => ({ projectId, name, base: local.base, ahead: local.ahead, issues: local.issues }));
  }

  // Queues issues of a project's synced backlog for a workflow and starts the first ones if there
  // are free run slots. Only open issues; the workflow needs a `task` input (the issue goes there).
  // group: the issues go as one run (one branch, one PR/MR), up to the backlogMaxGroup setting; a
  // backlog is one project's, so a group never mixes projects.
  async function assignWorkflow({ projectId, numbers, workflow, inputs, mock, group = false }) {
    const project = projects.readProject(ws.projects, path.basename(String(projectId)));
    const data = backlog.readBacklog(ws.backlog, project.id);
    if (!data) throw new Error('Sync the backlog first.');
    // in the order they were selected
    const issues = [...new Set((numbers || []).map(Number))].map((n) => data.issues.find((i) => i.number === n)).filter((i) => i?.state === 'open');
    if (!issues.length) throw new Error('Select at least one open issue.');
    const maxGroup = workspace.readSettings(ws).backlogMaxGroup || workspace.DEFAULT_SETTINGS.backlogMaxGroup;
    if (group && issues.length > maxGroup) throw new Error(`One run takes at most ${maxGroup} issues (Settings › General › Backlog); ${issues.length} were selected.`);
    const file = path.basename(String(workflow || ''));
    const wf = loadWorkflow(workflowPath(file).file);
    if (!wf.inputs?.task) throw new Error(`Workflow ${wf.metadata?.name || file} has no task input to receive the issue.`);
    if (!mock) {
      simulation.refuseReal('real runs from the Backlog');
      await host.assertCanRun?.({ mock: false });
    }
    backlog.enqueue(ws.backlog, project.id, { issues, workflow: file, workflowName: wf.metadata?.name || file, inputs: inputs || {}, mock: !!mock, group: !!group });
    // an issue belongs to one plan: assigned here (the screen asked first), it leaves the roadmap's items not started
    roadmaps.dropIssues(ws.backlog, project.id, issues.map((i) => i.number));
    await dispatchQueue();
    return withIssueRuns(backlog.readBacklog(ws.backlog, project.id));
  }

  // Issue tracker (#81), "create and queue": once the run filed its issues, the project's backlog is
  // synced (the new issues are in it) and they are assigned like the Backlog's Assign does. A
  // simulated run filed nothing real: nothing is queued. Groups respect backlogMaxGroup (one assign
  // per batch), so a long group_with list never makes the assign refuse the whole queue.
  async function queueFiledIssues(run, ev) {
    const maxGroup = workspace.readSettings(ws).backlogMaxGroup || workspace.DEFAULT_SETTINGS.backlogMaxGroup;
    const plan = backlog.filedToQueue({ workflow: run.wf.metadata?.name, status: ev.status, steps: run.ctx.steps, inputs: run.inputs, maxGroup });
    if (!plan || !run.projectId || run.mock) return;
    const project = projects.readProject(ws.projects, run.projectId);
    const platform = run.inputs.git_platform === 'gl' ? 'gitlab' : 'github';
    await backlog.syncBacklog({ dir: ws.backlog, project, platform });
    for (const batch of plan.batches) {
      await assignWorkflow({ projectId: project.id, numbers: batch.numbers, workflow: plan.workflow, inputs: {}, mock: false, group: batch.group });
    }
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
        // claimed atomically (with the index): another dispatcher on this workspace never takes it too
        const next = backlog.claimQueued(ws.backlog, (projectId, item) => !slotProblem({ mock: !!item.mock, projectId }));
        if (!next) return;
        const { projectId, item } = next;
        try {
          const project = projects.readProject(ws.projects, projectId);
          const wf = loadWorkflow(workflowPath(item.workflow).file);
          // a PR/MR may have been opened for an issue since it was queued: skip it, don't redo the work
          // (an issue of a group leaves the group, which starts with the others)
          if (!item.mock && project.repo) {
            const platform = backlog.readBacklog(ws.backlog, projectId)?.platform || workspace.readSettings(ws).backlogPlatform || backlog.DEFAULT_PLATFORM;
            const prs = await backlog.newPullRequests({ item, platform, repo: project.repo });
            if (prs.length) {
              for (const n of new Set(prs.map((p) => p.issue ?? item.number))) {
                const mine = prs.filter((p) => (p.issue ?? item.number) === n);
                backlog.skipQueued(ws.backlog, projectId, n, `open ${mine.map((p) => `${platform === 'gitlab' ? 'MR !' : 'PR #'}${p.number}`).join(', ')} since it was queued`);
              }
              continue;
            }
          }
          await startWorkflowRun({
            file: item.workflow, inputs: backlog.runInputs(item, wf, project.folder), mock: item.mock,
            projectId, issues: backlog.itemIssues(item).map(({ number, url, title }) => ({ number, url, title })),
          });
          backlog.unqueue(ws.backlog, projectId, item.number, { cancelGroup: true });
        } catch (e) {
          backlog.setPaused(ws.backlog, projectId, true, `Could not start ${backlog.itemIssues(item).map((i) => `#${i.number}`).join(', ')}: ${e.message}`);
          backlog.releaseQueued(ws.backlog, projectId, item.number);
        }
      }
    } finally {
      dispatching = false;
    }
  }

  // ---- roadmaps (src/roadmap.js) ----------------------------------------------------------
  // Settles each started roadmap from its runs (roadmaps.advance) and starts the current stage's
  // items while there are free run slots. Called after every run and when a workspace opens; a call
  // while one is going runs again right after it (a run that ends meanwhile is never missed).
  let roadmapBusy = false;
  let roadmapAgain = false;
  async function dispatchRoadmaps() {
    if (!ws) return;
    if (roadmapBusy) { roadmapAgain = true; return; }
    roadmapBusy = true;
    try {
      do {
        roadmapAgain = false;
        for (const projectId of roadmaps.roadmapProjects(ws.backlog)) {
          try { await advanceRoadmap(projectId); } catch (e) { console.error('roadmap:', projectId, e); }
        }
      } while (roadmapAgain);
    } finally {
      roadmapBusy = false;
    }
  }

  // The state of a roadmap item's run: live (a gate keeps it open), else what it recorded; merged =
  // a local merge, a PR/MR merge action, or a simulation that succeeded (simulations never merge).
  function roadmapRun(runId) {
    const live = runId && active.get(runId);
    if (live) return { status: 'running', waiting: live.approvals.size > 0 };
    const r = runId ? runs.readRun(ws.runs, runId) : null;
    if (!r) return null;
    return { status: r.status, error: r.error, merged: r.status === 'success' && (r.mock || !!r.localMerge || roadmaps.mergedPullRequest(r.runDir)) };
  }

  async function advanceRoadmap(projectId) {
    const before = roadmaps.readRoadmap(ws.backlog, projectId);
    if (before.state !== 'running') return;
    const closed = new Set((backlog.readBacklog(ws.backlog, projectId)?.issues || []).filter((i) => i.state === 'closed').map((i) => i.number));
    const mockOf = (item) => !!item.mock || !!before.simulated;
    const { roadmap, start } = roadmaps.advance(before, {
      runOf: roadmapRun, closed: (n) => closed.has(n), canStart: (item) => !slotProblem({ mock: mockOf(item), projectId }),
    });
    roadmaps.updateRoadmap(ws.backlog, projectId, (cur) => (cur.updatedAt === before.updatedAt ? roadmap : null));
    if (roadmap.state === 'paused' && before.state === 'running') {
      notify({ kind: 'run', event: 'failed', title: 'Roadmap paused', body: String(roadmap.error || '').slice(0, 180) });
    }
    if (roadmap.state === 'done' && before.state === 'running') notify({ kind: 'run', event: 'succeeded', title: 'Roadmap finished', body: `Every stage of ${projectId} is done.` });
    for (const item of start) {
      // a slot may have been taken by the previous start
      if (slotProblem({ mock: mockOf(item), projectId })) break;
      try {
        const project = projects.readProject(ws.projects, projectId);
        const wf = loadWorkflow(workflowPath(item.workflow).file);
        // a closed issue of a group is left out; the others start
        const open = backlog.itemIssues(item).filter((i) => !closed.has(i.number));
        const run = { ...item, ...open[0], ...(open.length > 1 ? { issues: open } : { issues: undefined }) };
        const started = await startWorkflowRun({
          file: item.workflow, inputs: backlog.runInputs(run, wf, project.folder), mock: mockOf(item),
          projectId, issues: open.map(({ number, url, title }) => ({ number, url, title })),
        });
        roadmaps.markStarted(ws.backlog, projectId, item.id, { runId: started.runId });
      } catch (e) {
        roadmaps.markStarted(ws.backlog, projectId, item.id, { error: e.message });
        notify({ kind: 'run', event: 'failed', title: 'Roadmap paused', body: `Could not start an item: ${e.message}`.slice(0, 180) });
        break;
      }
    }
  }

  // Start: a roadmap with real items is refused in simulation-only mode (automated checks), like assignments.
  async function startRoadmap({ projectId, simulated = false }) {
    const id = path.basename(String(projectId));
    const r = roadmaps.readRoadmap(ws.backlog, id);
    if (!simulated && r.stages.some((s) => s.items.some((x) => !x.mock && !['done', 'skipped'].includes(x.status)))) {
      simulation.refuseReal('real runs from a roadmap');
      await host.assertCanRun?.({ mock: false });
    }
    roadmaps.setState(ws.backlog, id, 'running', { simulated: !!simulated });
    await dispatchRoadmaps();
    return withIssueRuns(backlog.readBacklog(ws.backlog, id));
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
    // images (e.g. the test step's UI screenshots) come whole as a data URL, for an <img>
    const image = found.kind === 'image' && !truncated ? `data:${IMAGE_TYPES[path.extname(found.path).toLowerCase()]};base64,${buf.toString('base64')}` : null;
    return { ...found, truncated, binary, image, text: binary ? null : buf.subarray(0, MAX_ARTIFACT_BYTES).toString('utf8') };
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

  // ---- analytics: tokens and session metrics over a date range ---------------------------
  // The CLIs' transcripts are read in both scopes: they add tool calls, prompts, files... to run sessions.
  function analyticsSnapshot({ scope, from, to } = {}) {
    const within = folderMatcher();
    const projectList = projects.listProjects(ws.projects);
    const projectOf = (cwd) => {
      const p = cwd && projectList.find((x) => [x.folder, ...(x.previousFolders || [])].some((d) => within(cwd, d)));
      return p ? { id: p.id, name: p.name } : null;
    };
    return analytics.computeAnalytics({
      runsDir: ws.runs, local: readLocalUsage(), settings: workspace.readSettings(ws), projects: projectList, projectOf,
      scope: scope === 'machine' ? 'machine' : 'orchestrator', from, to,
    });
  }

  // The supervisor's report on the range; it calls a real model unless `mock` (the UI asks first).
  async function analyzeAnalytics({ scope, from, to, question, mock } = {}) {
    if (!mock) simulation.refuseReal('the supervisor\'s CLI (claude)');
    const a = analyticsSnapshot({ scope, from, to });
    return supervisor.analyzeSessions({
      report: analytics.analyticsReport(a), from: a.from, to: a.to, scope: a.scope, question, mock: !!mock,
      reportsDir: ws.reports, skillsDirs: [ws.skills, BUNDLED_SKILLS_DIR], resolveCommand,
    });
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

  // The channels, one file per area (src/service/channels/*.js, see src/service/manifest.js). They
  // share the service's state and helpers through ctx; `ws` is read at call time (it can change).
  const ctx = {
    get ws() { return ws; },
    // the workspace's index (src/store.js), null when it could not be opened (storeError says why)
    get store() { return store; },
    get storeError() { return storeError; },
    host, active, events, notify, waiting, terminals, BUNDLED_SKILLS_DIR,
    setUiContext: (c) => { uiContext = notifier.normalizeContext(c); },
    activeRuns, analyticsSnapshot, analyzeAnalytics, artifactRuns, assignWorkflow, cloneBuilderWorkflow, code, dispatchQueue, dispatchRoadmaps, envDetails, gateChanges, listAllRuns,
    listCliSessions, listLocalPreviews, listWorkflows, liveRun, loadBuilderWorkflow, openTerminal, projectRuns, pushProject,
    readArtifact, refreshLocal, renameCliSession, resolvePushConflict, restoreWorkflow, resumeOptions, resumeRun,
    runAppInfo, runFolder, runPrState, saveBuilderWorkflow, setBudget, setPrice, setRunTitle, startLocalPreview, startRoadmap, startWorkflowRun, stopLocalPreview, unpushedProjects, usageSnapshot,
    withIssueRuns, workflowDirs,
  };
  const entries = loadChannels(ctx);
  // Every channel needs an open workspace (checked once here instead of in each handler).
  const withWorkspace = (fn) => (arg) => { workspaceDir(); return fn(arg); };
  const api = Object.fromEntries(entries.filter((e) => e.channel).map((e) => [e.channel, withWorkspace(e.fn)]));
  const notifications = Object.fromEntries(entries.filter((e) => e.send).map((e) => [e.send, e.fn]));
  // what window.api is built from (src/preload.js, src/renderer/api-http.js), desktop and account included
  const manifest = declarations([...entries, ...DESKTOP, ...authChannels(null)]);

  return {
    api,
    notifications,
    manifest,
    events,
    // the code version (#83): main.js calls code.markLoaded() when a window loads
    code,
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
    // Before a restart (the code changed on disk, #83): refuses while runs are in progress unless
    // the user confirmed interrupting them, and pauses the Backlog queues so nothing starts on the
    // way out. Returns the runs the restart interrupts (to resume after it). A start still under way
    // (e.g. cloning its repository) has no run to resume yet: the restart waits until it resolves.
    prepareRestart({ interruptRuns = false } = {}) {
      if (reserved.size) {
        throw new Error(`${reserved.size} run${reserved.size > 1 ? 's are' : ' is'} starting: restart when ${reserved.size > 1 ? 'they have' : 'it has'} started, to have ${reserved.size > 1 ? 'them' : 'it'} listed for resume.`);
      }
      const runs = activeRuns().map((r) => ({ runId: r.runId, workflow: r.workflow }));
      if (runs.length && !interruptRuns) {
        throw new Error(`${runs.length} run${runs.length > 1 ? 's are' : ' is'} in progress: confirm the restart to interrupt ${runs.length > 1 ? 'them' : 'it'} (${runs.map((r) => r.runId).join(', ')}).`);
      }
      if (ws) backlog.pauseAll(ws.backlog, 'Paused for the app restart: resume to start the queued issues.');
      return { interrupted: runs };
    },
    shutdown() {
      clearInterval(prTimer);
      waiting.closeAll();
      terminals.killAll();
      for (const run of active.values()) run.stop();
      // what the stopped runs write afterwards goes to the files only (the next listing indexes it)
      try { store?.close(); } catch { /* already closed */ }
      store = null;
    },
  };
}

module.exports = { createService, BUNDLED_WORKFLOWS_DIR, BUNDLED_SKILLS_DIR };
