// Service area: the runs in progress. Starts a run (concurrency limits, budgets, the project it
// belongs to, no second live run of the same issues, #112), records what it emits (events.jsonl,
// the index, notifications, 'run:event') and reacts as it ends (the Backlog queue, roadmaps, issue
// tracker, the run's chain #134). Runs in progress live in `active` by run id (several with Settings › Execution ›
// Concurrent runs); a run leaves it when it finishes and is read from its folder from then on.

const fs = require('fs');
const path = require('path');
const { aliasInputs } = require('@multiagent/shared/default-workflow');
const {
  childRunCost,
  loadWorkflow,
  WorkflowRun,
} = require('../../engine/workflow');
const { loadRepositoryWorkflow } = require('../../engine/run/load');
const { Recorder } = require('../../engine/recorder');
const { resolveCommand } = require('../../engine/providers');
const simulation = require('../../engine/simulation');
const {
  cleanupWorktrees,
  samePath,
  worktreeRuns,
} = require('../../engine/worktree');
const {
  configureMemoryGuard,
  memoryProblem,
  sharedMemoryGuard,
} = require('../../engine/memory-guard');
const { pruneDepsCache } = require('../../engine/deps-cache');
const workspace = require('../../domains/workspace/workspace');
const projects = require('../../domains/project/projects');
const workflows = require('../../domains/workflow/workflows');
const backlog = require('../../domains/backlog/backlog');
const roadmaps = require('../../domains/roadmap/roadmap');
const agents = require('../../domains/agents/agents');
const usage = require('../../domains/usage/usage');
const sessionCache = require('../../domains/session/session-cache');
const actionsUsage = require('../../domains/usage/actions-usage');
const runs = require('../../domains/run/runs');
const runOwner = require('../../domains/run/run-owner');
const runPr = require('../../domains/run/run-pr');
const notifier = require('../../domains/workspace/notifications');
const nightLimits = require('../../domains/night/night-limits');
const machineProfile = require('../../domains/machine/machine-profile');
const { num } = require('../common');

// how often a child run waiting for a slot of Settings › Execution checks again (#175)
const SLOT_POLL_MS = 1000;
// how often a start refused for low memory (#276) checks whether memory recovered
const MEMORY_RETRY_MS = 30e3;

// #262: Settings' providers.<name>.fallbacks as the WorkflowRun `fallbacks` option ({ <provider>: [entries] })
const settingsFallbacks = (settings) => Object.fromEntries(Object.entries(settings.providers || {})
  .filter(([, p]) => Array.isArray(p?.fallbacks) && p.fallbacks.length)
  .map(([name, p]) => [name, p.fallbacks.map(String)]));

// #312: Settings' providers.<name>.accounts (those with a folder) as the WorkflowRun `accounts` option
const settingsAccounts = (settings) => Object.fromEntries(Object.entries(settings.providers || {})
  .map(([name, p]) => [name, (Array.isArray(p?.accounts) ? p.accounts : []).filter((a) => a?.name && a?.dir)])
  .filter(([, list]) => list.length));
// #312: Settings' accountCooldownMinutes (60 by default) as the WorkflowRun `accountCooldownMs` option
const settingsAccountCooldownMs = (settings) => (settings.accountCooldownMinutes ?? 60) * 60e3;

module.exports = (ctx) => {
  const { events } = ctx;
  const active = new Map();
  // Starts under way (between the limit check and the run entering `active`): counted like runs.
  const reserved = new Set();
  // Budget baseline time of each active run, and real runs that finished while others were running:
  // their usage is not in the baseline of those runs, so the per-turn budget check adds it.
  const budgetAt = new Map();
  let finishedPeers = []; // [{ finishedAt, sessions }]
  // the queue dispatches scheduled as runs end, cancelled by the service's shutdown (#186)
  const dispatchTimers = new Set();
  function stopDispatchTimers() {
    for (const t of dispatchTimers) clearTimeout(t);
    dispatchTimers.clear();
    if (memoryRetry) { clearInterval(memoryRetry); memoryRetry = null; }
    // the stray check (#390) runs again with the next workspace
    sharedMemoryGuard()?.watchStrays(null);
  }

  // ---- memory guard (#276) --------------------------------------------------------------
  // Settings › Execution › Memory guard configures the app's guard (packages/engine/engine/memory-guard.js) that
  // real runs use. A new real run does not start while free memory is under its floor: the refusal
  // names the reason like slotProblem, and a timer dispatches the roadmaps and queues again once
  // memory recovers (they only dispatch at app start, when a run ends and on a screen action).
  let memoryRetry = null;
  function applyMemorySettings() {
    configureMemoryGuard({ ...workspace.DEFAULT_SETTINGS.memoryGuard, ...(workspace.readSettings(ctx.ws).memoryGuard || {}) });
    return sharedMemoryGuard();
  }
  const memoryNow = async (guard) => {
    const m = guard ? await guard.freeMemory() : null;
    return m ? memoryProblem({ freeBytes: m.freeBytes, floorBytes: guard.floorBytes }) : '';
  };
  // '' or why a new real run cannot start now for memory
  async function memoryHold() {
    // automated checks start no real run, so no sampler either
    if (simulation.simulationOnly()) return '';
    const guard = applyMemorySettings();
    const why = await memoryNow(guard);
    if (why && !memoryRetry) {
      memoryRetry = setInterval(async () => {
        if (!ctx.ws || await memoryNow(applyMemorySettings())) return;
        clearInterval(memoryRetry);
        memoryRetry = null;
        Promise.resolve().then(() => ctx.dispatchRoadmaps()).catch((e) => console.error('roadmap dispatch:', e))
          .then(() => ctx.dispatchQueue()).catch((e) => console.error('backlog dispatch:', e));
      }, MEMORY_RETRY_MS);
      memoryRetry.unref?.();
    }
    return why;
  }

  // #390: the guard also flags a process under a finished run's worktree that keeps using CPU. Its
  // runs are the folders of worktrees/ (<runId> and <runId>-base); each stray is a notification,
  // memory:stopStray stops it. Started with the workspace (strays of an earlier app session too),
  // never in automated checks. #406: a folder is live while any run uses it, here or in another app
  // process (a run resumed into an earlier run's worktree too), and a stray under it is named with
  // the last run that used it (run ids start with their start time). #414: a run's temp folder
  // (runs/<id>/tmp, where its tests write) is one more folder of run <id>, live while that run is.
  function watchStrayProcesses() {
    if (simulation.simulationOnly() || !ctx.ws) return;
    const guard = applyMemorySettings();
    if (!guard) return;
    const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };
    const runsOfWorktrees = () => {
      const names = subdirs(ctx.ws.worktrees);
      const tmpIds = subdirs(ctx.ws.runs).filter((id) => fs.existsSync(path.join(ctx.ws.runs, id, 'tmp')));
      if (!names.length && !tmpIds.length) return [];
      const ids = names.map((name) => name.replace(/-base$/, ''));
      // a run using a worktree started after the run it is named after
      const since = [...ids, ...tmpIds].reduce((a, b) => (a && a < b ? a : b), '');
      const used = worktreeRuns(ctx.ws.runs, ctx.ws.worktrees, { since });
      const inUse = activeWorktreeDirs();
      const worktrees = names.map((name, i) => {
        const id = ids[i];
        const main = path.join(ctx.ws.worktrees, id);
        const users = used.filter((r) => r.dirs.some((d) => samePath(d, main)));
        const live = active.has(id) || runAlive(id) || inUse.some((d) => samePath(d, main)) || users.some((r) => r.live);
        return { id: [id, ...users.map((r) => r.runId)].sort().pop(), worktree: path.join(ctx.ws.worktrees, name), live };
      });
      const tmps = tmpIds.map((id) => ({
        id, worktree: path.join(ctx.ws.runs, id, 'tmp'), live: active.has(id) || runAlive(id) || used.some((r) => r.runId === id && r.live),
      }));
      return [...worktrees, ...tmps];
    };
    guard.watchStrays({
      runs: runsOfWorktrees,
      onStray: (s) => {
        console.warn(`memory guard: process ${s.pid} of finished run ${s.runId} keeps using CPU: ${s.commandLine}`);
        ctx.notify(notifier.strayNotice(s));
      },
    });
  }
  const strayGuard = () => {
    const guard = sharedMemoryGuard();
    if (!guard) throw new Error('The memory guard is off (Settings › Execution): it watches no process.');
    return guard;
  };
  const strayProcesses = () => sharedMemoryGuard()?.strayProcesses() || [];
  const stopStray = (pid) => strayGuard().stopStray(pid);

  // The runs in progress are written down until they end: still there at the next start = they
  // died with the app. The file holds a list (one object in older versions).
  const marked = new Map(); // run id -> { runId, workflow, project, mock }
  // #607: the marks found at start-up (keepInterruptedMarks), kept in the file next to the live runs'
  // until their run ends here (a recovered one) or notifyInterruptedRun reports them
  let leftMarks = [];
  function writeMarks() {
    const list = [...marked.values(), ...leftMarks.filter((m) => !marked.has(m.runId))];
    try {
      if (list.length) fs.writeFileSync(ctx.ws.activeRun, JSON.stringify(list));
      else fs.rmSync(ctx.ws.activeRun, { force: true });
    } catch (e) { console.error('active run marker:', e.message); }
  }
  function markActiveRun(runId, info) {
    if (info) marked.set(runId, info);
    else {
      marked.delete(runId);
      leftMarks = leftMarks.filter((m) => m.runId !== runId);
    }
    writeMarks();
  }
  const keepInterruptedMarks = (list, { replace = false } = {}) => {
    leftMarks = [...(replace ? [] : leftMarks), ...list];
    writeMarks();
  };
  // Notifies each run the app had in progress when it last closed; returns the first notice. A run
  // this process runs (recovered at start-up, #607) is not one of them.
  function notifyInterruptedRun() {
    const { ws } = ctx;
    if (!ws) return null;
    let list = null;
    try { list = [].concat(JSON.parse(fs.readFileSync(ws.activeRun, 'utf8'))); } catch { return null; }
    leftMarks = [];
    writeMarks();
    const interrupted = list.filter((info) => info?.runId && !active.has(String(info.runId)) && runs.readRun(ws.runs, path.basename(String(info.runId)))?.status === 'interrupted');
    const notices = interrupted.map((info) => notifier.interruptedNotice(info));
    notices.forEach((n) => ctx.notify(n));
    // the Oracle's wake-ups (#123, packages/engine/domains/oracle/oracle-wake.js)
    interrupted.forEach((info) => events.emit('run:interrupted', info));
    return notices[0] || null;
  }
  // #607: a run the start-up claimed but could not start again, reported at once (notifyInterruptedRun
  // may have run while it started); its mark goes, so it is never reported twice
  function reportInterruptedRun(info) {
    markActiveRun(String(info.runId), null);
    ctx.notify(notifier.interruptedNotice(info));
    events.emit('run:interrupted', info);
  }

  const isRunning = () => active.size > 0 || reserved.size > 0;
  // The run in progress with this id; without an id, the only one in progress (older callers).
  const liveRun = (runId) => (runId ? active.get(String(runId)) : active.size === 1 ? [...active.values()][0] : null) || null;
  const usageOf = (run) => [...run.sessions.values()].map((s) => ({ provider: s.provider, model: s.model, tokens: s.tokens, costUsd: s.costUsd, cliOnlyUsd: s.cliOnlyUsd || 0 }));

  // ---- concurrent runs ------------------------------------------------------------------
  // Settings › Execution › Concurrent runs. Disabled: one run at a time, simulations included.
  // The maximum is the machine profile's (#367): this machine's proposal in auto, the owner's in manual.
  function concurrency() {
    const settings = workspace.readSettings(ctx.ws);
    const c = { ...workspace.DEFAULT_SETTINGS.concurrentRuns, ...(settings.concurrentRuns || {}) };
    if (!c.enabled) return { enabled: false, max: 1, perProject: null, countSimulations: true };
    const max = machineProfile.resolveLimits(settings, machineProfile.readMachine()).concurrentRuns;
    return {
      enabled: true, max: Math.max(1, Math.floor(num(max) || 1)),
      perProject: num(c.perProject) ? Math.max(1, Math.floor(num(c.perProject))) : null, countSimulations: !!c.countSimulations,
    };
  }

  // Why a run ({ mock, projectId, parentRunId }) cannot start now ('' = it can). `self` is its own reservation.
  // Child runs of `type: workflow` steps count like any run (#175), and a parent waiting for its children
  // lends them its slot: it does not count for its own descendants, nor for anyone while one of its
  // children holds the slot (a limit of 1 runs the children one at a time instead of never).
  function slotProblem({ mock, projectId, parentRunId = null }, self = null) {
    const c = concurrency();
    if (mock && !c.countSimulations) return '';
    const all = [...active.values(), ...[...reserved].filter((x) => x !== self)];
    const parentOf = (r) => r?.parent?.run_id || r?.parentRunId || null;
    const ancestors = new Set();
    for (let id = parentRunId; id && !ancestors.has(id); id = parentOf(active.get(id))) ancestors.add(id);
    const lends = (r) => !!r.runId && (ancestors.has(r.runId) || all.some((x) => parentOf(x) === r.runId));
    // #395: a parked roadmap item's run waiting at its gate holds no slot (the roadmap moved on past it)
    const parked = (r) => r.approvals?.size > 0 && !!ctx.parkedRun?.(r.runId, r.projectId);
    const taken = all.filter((r) => (c.countSimulations || !r.mock) && !lends(r) && !parked(r));
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
    run.owner?.release();
    active.delete(run.runId);
    budgetAt.delete(run.runId);
    if (!run.mock && active.size) finishedPeers.push({ finishedAt: Date.now(), sessions: usageOf(run) });
    const oldest = Math.min(...budgetAt.values());
    finishedPeers = finishedPeers.filter((f) => f.finishedAt >= oldest); // none left when nothing runs
  }

  // What follows a run's end (its workflow.finished event): the next issues waiting in a Backlog
  // queue start once this run is over; a queued issue whose run failed pauses its queue (a failure
  // that repeats would otherwise burn through it). #445: only a run the queue started pauses it
  // (not a roadmap item's, a release's, a chain's or one by hand), and the pause ends once the
  // issues it names are done (closed on the platform, or a later run of them succeeded).
  function afterRunFinished(run, ev) {
    if (run.issues && run.projectId && !run.mock) {
      try {
        if (ev.status === 'failed' && run.fromQueue) backlog.pauseForFailure(ctx.ws.backlog, run.projectId, run.issues.map((i) => i.number));
        else {
          const ok = new Set(ev.status === 'success' ? run.issues.map((i) => i.number) : []);
          const closed = new Set((backlog.readBacklog(ctx.ws.backlog, run.projectId)?.issues || []).filter((i) => i.state === 'closed').map((i) => i.number));
          backlog.clearDonePause(ctx.ws.backlog, run.projectId, (n) => ok.has(n) || closed.has(n));
        }
      } catch (e) { console.error('backlog queue:', e); }
    }
    // the epic first (the chain may sync the backlog), then what the run's chain starts (#134)
    ctx.placeFiledInEpic(run, ev).catch((e) => console.error('issue tracker epic:', e.message))
      .then(() => ctx.continueChain(run, ev)).catch((e) => console.error('run chain:', e.message));
    // a Backlog Refresh run edited or closed issues: the Backlog syncs the project (#161)
    ctx.afterBacklogRefresh(run).catch((e) => console.error('backlog refresh sync:', e.message));
    // a release run (#260): a shipped release is recorded and its cut line lets the roadmap go on
    ctx.afterRelease(run, ev).catch((e) => console.error('release:', e.message));
    // #405: a base check deferred while this release run held the base runs now
    try { ctx.afterBaseReleased(run); } catch (e) { console.error('base health:', e.message); }
    // a merged run changes the conflict map the Product Owner plans with (#150)
    ctx.afterRunConflictMap(run, ev).catch((e) => console.error('conflict map:', e.message));
    // a roadmap's next items first (its stage may be over), then the plain queue; a shutdown
    // cancels it (#186: it would run after the workspace was closed, e.g. a test's removed one)
    const dispatch = setTimeout(() => {
      dispatchTimers.delete(dispatch);
      if (!ctx.ws) return;
      Promise.resolve().then(() => ctx.dispatchRoadmaps()).catch((e) => console.error('roadmap dispatch:', e))
        .then(() => ctx.dispatchQueue()).catch((e) => console.error('backlog dispatch:', e));
    }, 1000);
    dispatchTimers.add(dispatch);
  }

  // What the UI shows of each run in progress (the Run menu list). `gates` are the gates the run
  // waits at (approval_id, step_id, message, choices, feedback, requested_at): the sidebar, the
  // Backlog and a reloaded window all read them here, never only from the events they saw live.
  // With the index open the gates come from its table (written as the engine emits them).
  function activeRuns() {
    return [...active.values()].map((r) => {
      let gates = r.pendingGates();
      try { if (ctx.store) gates = ctx.store.openGates(r.runId); } catch (e) { console.error('index.db gates:', e.message); }
      // while Phone gates is on, each gate with its phone page link (#226; Home's "What needs you", #255)
      const phoneLink = ctx.phoneGateLink?.();
      if (phoneLink) gates = gates.map((g) => ({ ...g, phoneUrl: phoneLink(r.runId, g.approval_id) }));
      return {
        runId: r.runId, workflow: r.wf.metadata?.name || path.basename(r.file), file: path.basename(r.file), mock: r.mock,
        projectId: r.projectId, issues: r.issues, startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
        status: r.status, waiting: gates.length, gates, inputs: r.inputs, agent_names: r.agentNames(), display: r.displayNames(),
        // #368: pausing after the current turn ({ state: 'pausing', step, agents?, command?, at }), else null
        pause: r.pauseState(),
        ...ctx.liveTitle(r), pr: ctx.withPrState(r.pr, r.mock), passedGates: passedGates(r),
        // what happens with its result when it finishes, and the run whose chain started it (#134)
        chain: r.then || r.from ? { then: r.then, from: r.from, state: r.then ? 'waiting' : undefined } : null,
        // `type: workflow` steps (#174): the run that started this one, the runs this one started
        parentRun: r.parent || null, childRuns: r.childRuns.length ? r.childRuns : null,
        // #320: what Continue at a gate will re-read, per agent (the phone page's gate line)
        ...(gates.length && r.sessions ? { nextTurns: sessionCache.agentNextTurns([...r.sessions.values()].map((s) => r.snapshot(s))) } : {}),
      };
    });
  }
  // The human gates a run in progress has passed (decided, or confirmed at resume): stopping it asks first (#112).
  const passedGates = (run) => run.wf.steps.filter((s) => s.type === 'human_approval' && run.ctx.steps[s.id]?.output).map((s) => s.id);

  // #472: the project's "install dependencies without running their scripts"; a repository the run
  // cloned from a URL with no project to hold the setting is not the user's checkout: on, with a notice
  function installScriptsOff(project, fromUrl, notices) {
    if (project) return !!project.ignoreInstallScripts;
    if (fromUrl) notices.push({ level: 'info', message: 'dependencies install without their scripts (--ignore-scripts): the repository was cloned from a URL and has no project setting' });
    return fromUrl;
  }

  // #485: the project's repository workflow of that name wins (its committed text at HEAD), refused
  // until the owner accepted it and capped even then (packages/engine/engine/run/load.js); else, and always with
  // workspaceOnly (the Start drawer's pick), the workspace's. A path (a resumed run's recorded file)
  // is that file, unless it is a repository workflow's copy: that one is checked again
  // #554: the owner's edited workspace copy of that name (modified or custom) wins, unless the project
  // prefers the repository's workflows; when the repository's copy runs, the edited copy's per-agent
  // provider / model / effort come with it (ownerCopy, WorkflowRun)
  function runWorkflowFile(project, file, settings, workspaceOnly = false) {
    const projectId = project?.id || null;
    const resumed = path.isAbsolute(String(file || ''));
    const own = resumed && !ctx.isRepositoryCopy(file);
    const fromRepo = projectId && !workspaceOnly && !own ? ctx.repositoryWorkflow(projectId, file) : null;
    if (!fromRepo) return ctx.workflowPath(file);
    const edited = workflows.editedWorkspaceCopy([file, fromRepo.file], ctx.workflowDirs());
    if (edited && !resumed && !project.preferRepositoryWorkflows) return ctx.workflowPath(edited);
    const wf = loadRepositoryWorkflow(fromRepo.path, { accepted: fromRepo.accepted, policy: { tools: settings.repositoryWorkflowTools }, commit: fromRepo.commit });
    return { file: fromRepo.path, fallback: false, ownerCopy: edited ? ownerCopy(path.join(ctx.ws.workflows, edited), wf) : null };
  }

  // #554: { agents: { <agent>: { provider?, model?, effort? } }, providers } of the owner's workspace
  // copy, for the agents the repository's copy (wf) also has; templated values are left out
  function ownerCopy(file, wf) {
    let mine;
    try { mine = loadWorkflow(file); } catch { return null; }
    const agents = {};
    for (const [name, a] of Object.entries(mine.agents || {})) {
      if (!Object.hasOwn(wf.agents || {}, name)) continue;
      const pick = Object.fromEntries(['provider', 'model', 'effort'].filter((k) => a?.[k] && !String(a[k]).includes('{{')).map((k) => [k, String(a[k])]));
      if (Object.keys(pick).length) agents[name] = pick;
    }
    return Object.keys(agents).length ? { agents, providers: mine.providers || {} } : null;
  }

  // mockSequences: simulation scenario ({ field: [value per visit] }, invalid_answers), ignored for real runs
  // allowKeptWork: the owner chose to start these issues again although an ended run kept commits
  // for them (run:start's confirmation, a confirmed roadmap Retry); otherwise that start is refused (#112)
  // notices: [{ level, message }] the starter logs in the run (e.g. an issue read from the cache, #168)
  // attachments: { <input>: [path | { path, name }] } images attached to inputs (#129, WorkflowRun)
  // then / from: the run's chain (#134, WorkflowRun): what follows it, and the run whose chain started it
  // parent: the run whose `type: workflow` step starts this one (#174, WorkflowRun): it takes a slot of
  // Settings › Execution like any run (#175, slotProblem: its parent lends it its own) and, when none is
  // free, waits for one instead of failing; signal: the parent's abort signal (stops that wait);
  // onSlotWait: (why) => void, called once when it has to wait
  // onFinished: (workflow.finished event) => void, called when the run ends (the parent's step waits on it)
  // agentOverrides: { <agent>: { provider?, model?, effort? } } this run's choice per agent (#262, WorkflowRun);
  // every run also gets Settings' fallback chains per provider and limits per model (settingsFallbacks)
  // workspaceWorkflow: the workspace's `file` even when the project's repository declares one (#485)
  // A new run's issues already in work (#112) refuse it, naming the run that holds them (err.runId).
  function refuseDuplicateWork(issues, allowKeptWork) {
    // the same issues never get a second live run, from this app or another one: resume that run instead
    const twin = liveRunForIssues(issues);
    if (twin) {
      const err = new Error(`${twin.issues.map((i) => `#${i.number}`).join(', ')} already has a live run, ${twin.runId}${twin.runningElsewhere ? ' (in another app window)' : ''}: open or resume that run instead of starting the same work twice.`);
      err.runId = twin.runId;
      throw err;
    }
    // automation (queue, roadmap) cannot ask: it stops and names the run that holds the same work
    const kept = allowKeptWork ? null : ctx.keptWorkForIssues(issues);
    if (kept) {
      const err = new Error(`${kept.title}. ${kept.text} Choose with Retry on the roadmap item, Resume on the queue or Start on the issue.`);
      err.runId = kept.runId;
      throw err;
    }
  }

  // recover (#607, areas/recover.js): { runId, events, worktree, personas, owner } a run the app died in,
  // continued in its own folder with its own id; `owner` is its owner.json, already taken over
  async function startWorkflowRun({ file, inputs, mock, mockSequences = null, resume = null, recover = null, projectId: forcedProject = null, issues = null, allowKeptWork = false, notices: startNotices = [], attachments = null, then = null, from = null, parent = null, onFinished = null, signal = null, onSlotWait = null, agentOverrides = null, fromQueue = false, workspaceWorkflow = false }) {
    // simulation-only (automated checks): a real run is refused, never turned into a simulation
    if (!mock) simulation.refuseReal('a real run');
    // a resumed run continues that work, a recovered run (#607) is that run
    if (!resume && !recover) refuseDuplicateWork(issues, allowKeptWork);
    const { ws } = ctx;
    // #276: the memory guard's settings for this real run; a new one waits while memory is low
    // (a child run starts inside its parent's run, which already passed the check)
    if (!mock) {
      applyMemorySettings();
      const low = parent ? '' : await memoryHold();
      if (low) throw new Error(low);
    }
    const slot = { mock: !!mock, projectId: forcedProject, parentRunId: parent?.run_id || null };
    // a child waits for its slot (waitForSlot reserves it); any other run fails when none is free
    if (parent) await waitForSlot(slot, signal, onSlotWait);
    else {
      const busy = slotProblem(slot);
      if (busy) throw new Error(busy);
      reserved.add(slot);
    }
    let run;
    try {
      // repo_path can be a git URL: clones (or updates) it into <workspace>/repos.
      const fromUrl = workspace.isGitUrl(inputs?.repo_path);
      if (fromUrl) {
        inputs = { ...inputs, repo_path: (await workspace.cloneRepo(inputs.repo_path, ws.repos)).dir };
      }
      const settings = workspace.readSettings(ws);
      const folders = Object.values(inputs || {}).filter((v) => typeof v === 'string' && /[\\/]/.test(v)).map((v) => path.resolve(v).toLowerCase());
      const projectId = forcedProject || projects.listProjects(ws.projects).find((p) => p.folder && folders.includes(path.resolve(p.folder).toLowerCase()))?.id || null;
      // the project is known now: its own limit applies (a child already waited with its parent's
      // project; one whose project only shows now waits again for a slot of that project)
      const projectChanged = projectId !== slot.projectId;
      slot.projectId = projectId;
      if (parent) {
        if (projectChanged) {
          reserved.delete(slot);
          await waitForSlot(slot, signal, onSlotWait);
        }
      } else {
        const busyProject = slotProblem(slot, slot);
        if (busyProject) throw new Error(busyProject);
      }
      // budgets that count usage outside the orchestrator need the CLIs' own logs
      const needsLocal = Object.values(settings.budgets || {}).some((b) => b?.countOutside);
      const local = needsLocal ? await ctx.localUsage() : null;
      const baselineAt = Date.now();
      // the Oracle's spend (in no run folder) counts too
      const budget = usage.budgetBaseline({ runsDir: ws.runs, settings, local, extraRuns: ctx.agentUsageRuns() });
      const project = projectId ? projects.listProjects(ws.projects).find((p) => p.id === projectId) : null;
      const wfFile = runWorkflowFile(project, file, settings, workspaceWorkflow);
      const notices = [...(startNotices || [])];
      if (wfFile.fallback) {
        const msg = `workflow ${path.basename(wfFile.file)} is not in ${ws.workflows}; using the copy bundled with the app (${wfFile.file})`;
        console.warn(msg);
        notices.push({ level: 'warn', message: msg });
      }
      run = new WorkflowRun({
        // #630: an old workflow name brings its variant's inputs, under the run's own (an old
        // `mode: validated` is the validation, so the alias's mode stays)
        file: wfFile.file, inputs: aliasInputs(wfFile, inputs), mock, runsDir: ws.runs, skillsDirs: [ws.skills], notices,
        // Run locally at gates: the project's override of the workflow's orchestrator.local_preview
        localPreview: project?.localPreview?.command ? project.localPreview : null,
        ignoreInstallScripts: installScriptsOff(project, fromUrl, notices),
        budget, prices: settings.prices, projectId, issues, resume, recover, attachments, mockSequences: mock ? mockSequences : null, then, from,
        agentOverrides, ownerCopy: wfFile.ownerCopy,fallbacks: settingsFallbacks(settings), models: settings.models || {},
        accounts: settingsAccounts(settings), accountCooldownMs: settingsAccountCooldownMs(settings),
        // #337: tonight's limits, read at each check (a raise reaches the run at its next one)
        nightLimits: () => nightLimits.tonightLimits(ws.oracle || path.join(ws.root, 'oracle')),
        // #327: Settings › Language, read at each turn (a change reaches the run at its next turn)
        language: () => workspace.readSettings(ws).language,
        // #367: the machine profile's test workers per run (auto from this machine, or the owner's)
        testWorkers: machineProfile.resolveLimits(settings, machineProfile.readMachine()).testWorkers,
        // `type: workflow` steps (#174): each child is a normal run of this service, linked to this one
        parent, startChild: (spec) => startChildRun(run, spec),
        // simulation runs never touch git: the agents are mocked and work in the repository folder
        worktreesDir: mock ? null : ws.worktrees,
        // concurrent runs share the monthly budgets
        peerSessions: () => peerSessions(run),
        idleWarnMs: settings.idleWarningMinutes != null && Number.isFinite(+settings.idleWarningMinutes) ?+settings.idleWarningMinutes * 60e3 : undefined,
        // `persona: random` agents become one of the user's agents (Agents menu)
        personas: agents.listAgents(ws.agents).filter((a) => !a.system && !a.error),
        // CI waiting on a PR whose account ran out of Actions minutes reports it instead of waiting
        actionsQuota: async (owner) => actionsUsage.quotaExhausted(await actionsUsage.getActionsUsage({ owner, includedMinutes: +settings.actionsIncludedMinutes || 0, timeZone: settings.timeZone })),
        // #381: the project map's analyze step runs the Oracle's architecture analysis with the service's Oracle
        architectureOracle: () => ({ oracle: ctx.oracleService(), agent: agents.readAgent(ws.agents, agents.ORACLE_ID) }),
        // #378: the Refactor proposals workflow ranks with the Refactor tab's Product Owner (channels/refactor.js)
        refactorPriorityOptions: (projectId) => ctx.refactorPriorityOptions?.(projectId) || null,
      });
      run.fromQueue = !!fromQueue; // #445: only the queue's own runs pause it (afterRunFinished)
      if (!mock) {
        // the runs in progress have not written their usage to disk yet
        const problems = usage.preflight(run.wf, usage.withPeerUsage(budget, peerSessions(run), settings.prices), resolveCommand, run.inputs);
        if (problems.length) throw new Error(problems.join('\n'));
      }
      budgetAt.set(run.runId, baselineAt);
      active.set(run.runId, run);
      // runs/<id>/owner.json with a heartbeat (#112): another app process sees the run as running, not interrupted
      run.owner = recover?.owner || runOwner.claimRun(run.runDir);
    } finally {
      reserved.delete(slot);
    }
    const recorder = new Recorder(run.runDir, run.wf.observability?.capture?.redact);
    const runInfo = {
      runId: run.runId, workflow: run.wf.metadata?.name || path.basename(run.file), mock: !!run.mock,
      project: run.projectId ? projects.listProjects(ws.projects).find((p) => p.id === run.projectId)?.name || run.projectId : null,
      // the run's display title (#84), read when a notice is made: the owner can change it meanwhile
      get title() { return ctx.liveTitle(run).title; },
    };
    // a resumed run shows the PR of the run it resumes until one of its steps reports one
    // (a recovered run, its own)
    const prOf = recover?.runId || resume?.runId;
    run.pr = prOf ? runs.runPr(ws.runs, prOf) : null;
    run.on('event', (ev) => {
      try { recorder.write(ev); } catch (e) { console.error('recorder:', e); }
      ctx.indexEvent(run, ev);
      const pr = ev.type === 'step.finished' ? runPr.prOfOutput(ev.output) : null;
      if (pr) run.pr = pr;
      if (run.pr) ctx.refreshLivePr(run, pr || ev.type === 'workflow.finished' ? 0 : 15000).catch((e) => console.error('run PR:', e.message));
      if (ev.type === 'workflow.finished') runEnded(run);
      // a local preview lives only while its gate is open (the build front's area, phase 4: an engine
      // without that front has no previews to stop)
      if (ev.type === 'approval.resolved' || ev.type === 'workflow.finished') {
        ctx.stopLocalPreview?.({ runId: run.runId, reason: ev.type === 'approval.resolved' ? 'the gate was answered' : 'the run ended' });
      }
      if (ev.type === 'worktree.merged') ctx.afterLocalMerge(run, ev).catch((e) => console.error('after local merge:', e));
      // #405: pre-existing failures are tracked, and a merge starts the base check (areas/base-health.js)
      try {
        if (ev.type === 'step.finished') ctx.afterStepFinished(run, ev).catch((e) => console.error('base health:', e.message));
        if (ev.type === 'worktree.merged') ctx.afterBaseMerge(run, ev);
      } catch (e) { console.error('base health:', e.message); }
      if (ev.type === 'workflow.started' || ev.type === 'run.then') ctx.recordChain(run, ev);
      events.emit('run:event', ev);
      if (ev.type === 'workflow.started' || ev.type === 'run.recovered') markActiveRun(run.runId, runInfo);
      if (ev.type === 'workflow.finished') markActiveRun(run.runId, null);
      if (ev.type === 'workflow.finished' && onFinished) {
        try { onFinished(ev); } catch (e) { console.error('run finished:', e.message); }
      }
      // a gate's notice carries its phone page link while Phone gates is on (#226)
      ctx.notify(notifier.runNotice(ev, runInfo, { gateLink: ctx.phoneGateLink() }), { projectId: run.projectId, issue: run.issues?.map((i) => `#${i.number}`).join(', ') || null });
      if (ev.type === 'workflow.finished') afterRunFinished(run, ev);
    });
    // a failed roadmap item's run resumed from a step (#100): the new run takes its place
    if (resume?.runId && run.projectId) {
      try { roadmaps.adoptResumed(ws.backlog, run.projectId, resume.runId, run.runId); } catch (e) { console.error('roadmap resume:', e); }
    }
    run.start();
    return { runId: run.runId, runDir: run.runDir };
  }

  // A child run waits until slotProblem lets it start (#175), the limit per project included, then
  // reserves the slot in the same tick as the check that let it through: children of a foreach step
  // start together and must see each other's reservation. The parent's stop ends the wait.
  async function waitForSlot(slot, signal, onWait) {
    let told = false;
    for (let busy = slotProblem(slot, slot); busy; busy = slotProblem(slot, slot)) {
      if (signal?.aborted) break;
      if (!told) { told = true; onWait?.(busy); }
      await new Promise((resolve) => setTimeout(resolve, SLOT_POLL_MS));
    }
    if (signal?.aborted) throw new Error('Cancelled: the parent run was stopped before this child run could start.');
    reserved.add(slot);
  }

  // A child run of a `type: workflow` step (#174, WorkflowRun startChild): started like any run of the
  // parent's project and mode, its gates waiting for the owner; resolves `finished` when it ends.
  // previous: { run_id, status } the child a resumed parent's previous run started for this item (#175):
  // reused when it succeeded, else resumed from where it stopped (the step Resume from step… suggests,
  // its gate when that step lies past a decided one: a gate always asks again), else started afresh.
  async function startChildRun(parentRun, { file, inputs, parent, label, signal = null, previous = null }) {
    let done;
    const finished = new Promise((resolve) => { done = resolve; });
    const step = `${parentRun.wf.metadata?.name || path.basename(parentRun.file)}, step ${parent.step_id}${label ? `: ${label}` : ''}`;
    const child = {
      parent, signal,
      onFinished: (ev) => done({ status: ev.status, outputs: ev.outputs || {}, error: ev.error, cost_usd: childRunCost(ev.summary) }),
      onSlotWait: (why) => parentRun.emitEvent('log', { level: 'info', step_id: parent.step_id, message: `${parent.step_id}: a child run${label ? ` (${label})` : ''} waits for a free slot: ${why}` }),
      notices: [{ level: 'info', message: `Child run of ${parentRun.runId} (${step}).` }],
    };
    const old = previous?.run_id && ctx.ws ? runs.readRun(ctx.ws.runs, path.basename(String(previous.run_id))) : null;
    if (old?.status === 'success') {
      return { runId: old.runId, reused: true, stop: () => {}, finished: Promise.resolve({ status: 'success', outputs: old.outputs || {}, error: null, cost_usd: old.costUsd + (old.childrenCostUsd || 0) }) };
    }
    let started = null;
    if (old && old.status !== 'running') {
      try {
        // a child paused with its parent (#368) continues where it paused
        const o = old.status === 'paused' ? null : ctx.resumeOptions({ runId: old.runId });
        const at = o?.steps.find((s) => s.id === o.suggested);
        const fromStep = o ? at?.blockedBy || o.suggested : old.paused?.step;
        if (!fromStep) throw new Error('no step to resume from');
        child.notices = [{ level: 'info', message: `Child run of ${parentRun.runId} (${step}), resuming ${old.runId} from ${fromStep}.` }];
        started = { ...(await ctx.resumeRun({ runId: old.runId, step: o ? fromStep : undefined, mock: parentRun.mock }, child)), resumedFrom: old.runId };
      } catch (e) {
        if (signal?.aborted) throw e;
        parentRun.emitEvent('log', { level: 'warn', step_id: parent.step_id, message: `${parent.step_id}: child run ${old.runId} could not be resumed (${e.message}); starting it again.` });
      }
    }
    started ||= await startWorkflowRun({ file, inputs, mock: parentRun.mock, projectId: parentRun.projectId, ...child });
    return {
      runId: started.runId, finished, stop: () => active.get(started.runId)?.stop(),
      pause: () => active.get(started.runId)?.pause(), cancelPause: () => active.get(started.runId)?.cancelPause(),
      ...(started.resumedFrom ? { resumedFrom: started.resumedFrom } : {}),
    };
  }

  // Provider config of a run's workflow: the live one, or the workflow file named in its events.
  function runWorkflow(runId, file) {
    const live = active.get(runId);
    if (live) return live.wf;
    try { return loadWorkflow(ctx.workflowPath(file).file); } catch { return {}; }
  }

  const runIsLive = (runId) => ['pending', 'running'].includes(active.get(runId)?.status);
  // Whether a run is alive in this process or in another app process on the workspace (#112).
  const runAlive = (runId) => {
    const id = path.basename(String(runId || ''));
    return !!id && (runIsLive(id) || (!!ctx.ws && runOwner.runOwnedElsewhere(path.join(ctx.ws.runs, id))));
  };

  // A live run (any app process) of one of these issues, or null (#112: no duplicate work).
  function liveRunForIssues(issues) {
    const numbers = new Set((issues || []).map((i) => Number(i?.number ?? i)).filter(Boolean));
    if (!numbers.size || !ctx.ws) return null;
    const mine = [...active.values()].find((r) => (r.issues || []).some((i) => numbers.has(Number(i.number))));
    if (mine) return { runId: mine.runId, issues: mine.issues, runningElsewhere: null };
    return runs.listRuns(ctx.ws.runs).find((r) => r.status === 'running' && r.runningElsewhere && (r.issues || []).some((i) => numbers.has(Number(i.number)))) || null;
  }

  // Before a restart (the code changed on disk, #83): refuses while runs are in progress unless
  // the user confirmed interrupting them, and pauses the Backlog queues so nothing starts on the
  // way out. Returns the runs the restart interrupts (to resume after it). A start still under way
  // (e.g. cloning its repository) has no run to resume yet: the restart waits until it resolves.
  function prepareRestart({ interruptRuns = false } = {}) {
    if (reserved.size) {
      throw new Error(`${reserved.size} run${reserved.size > 1 ? 's are' : ' is'} starting: restart when ${reserved.size > 1 ? 'they have' : 'it has'} started, to have ${reserved.size > 1 ? 'them' : 'it'} listed for resume.`);
    }
    const list = activeRuns().map((r) => ({ runId: r.runId, workflow: r.workflow }));
    if (list.length && !interruptRuns) {
      throw new Error(`${list.length} run${list.length > 1 ? 's are' : ' is'} in progress: confirm the restart to interrupt ${list.length > 1 ? 'them' : 'it'} (${list.map((r) => r.runId).join(', ')}).`);
    }
    if (ctx.ws) backlog.pauseAll(ctx.ws.backlog, 'Paused for the app restart: resume to start the queued issues.');
    return { interrupted: list };
  }

  // run worktrees left behind (#202): every run not in progress here, live in another app process
  // or waiting at a human gate loses its folder (its branch keeps the work), and the scratch of
  // runs that ended days ago goes (#201). At startup and every 30 minutes; one pass at a time. Then the dependency
  // cache's entries no worktree links any more (#198: unused for 14 days, or over the size cap)
  let cleaning = null;
  const cleanupRunWorktrees = () => {
    cleaning ??= cleanupPass().finally(() => { cleaning = null; });
    return cleaning;
  };
  // the worktree folders the runs of `active` use (a resumed run's is the earlier run's, #406)
  const activeWorktreeDirs = () => [...active.values()].flatMap((r) => [r.worktree?.dir, r.resume?.worktree?.dir, path.join(ctx.ws.worktrees, r.runId), path.join(ctx.ws.worktrees, `${r.runId}-base`)]).filter(Boolean);
  const cleanupPass = async () => {
    if (!ctx.ws) return [];
    const removed = await cleanupWorktrees({
      worktreesDir: ctx.ws.worktrees, runsDir: ctx.ws.runs,
      active: activeWorktreeDirs,
    });
    try { pruneDepsCache({ cacheDir: path.join(ctx.ws.cache, 'deps') }); } catch (e) { console.error('dependency cache cleanup:', e.message); }
    return removed;
  };

  return {
    active,
    activeRuns,
    cleanupRunWorktrees,
    isRunning,
    keepInterruptedMarks,
    liveRun,
    liveRunForIssues,
    memoryHold,
    notifyInterruptedRun,
    passedGates,
    prepareRestart,
    reportInterruptedRun,
    runAlive,
    runIsLive,
    runWorkflow,
    slotProblem,
    startWorkflowRun,
    stopDispatchTimers,
    stopStray,
    strayProcesses,
    watchStrayProcesses,
  };
};
