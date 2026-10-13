// Service area: the runs in progress. Starts a run (concurrency limits, budgets, the project it
// belongs to, no second live run of the same issues, #112), records what it emits (events.jsonl,
// the index, notifications, 'run:event') and reacts as it ends (the Backlog queue, roadmaps, issue
// tracker, the run's chain #134). Runs in progress live in `active` by run id (several with Settings › Execution ›
// Concurrent runs); a run leaves it when it finishes and is read from its folder from then on.

const fs = require('fs');
const path = require('path');
const {
  childRunCost,
  loadWorkflow,
  WorkflowRun,
} = require('../../engine/workflow');
const { Recorder } = require('../../engine/recorder');
const { resolveCommand } = require('../../engine/providers');
const simulation = require('../../engine/simulation');
const { cleanupWorktrees } = require('../../engine/worktree');
const {
  configureMemoryGuard,
  memoryProblem,
  sharedMemoryGuard,
} = require('../../engine/memory-guard');
const { pruneDepsCache } = require('../../engine/deps-cache');
const workspace = require('../../workspace');
const projects = require('../../projects');
const backlog = require('../../backlog');
const roadmaps = require('../../roadmap');
const agents = require('../../agents');
const usage = require('../../usage');
const sessionCache = require('../../session-cache');
const actionsUsage = require('../../actions-usage');
const { readLocalUsage } = require('../../local-usage');
const runs = require('../../runs');
const runOwner = require('../../run-owner');
const runPr = require('../../run-pr');
const notifier = require('../../notifications');
const nightLimits = require('../../night-limits');
const machineProfile = require('../../machine-profile');
const { num } = require('../common');

// how often a child run waiting for a slot of Settings › Execution checks again (#175)
const SLOT_POLL_MS = 1000;
// how often a start refused for low memory (#276) checks whether memory recovered
const MEMORY_RETRY_MS = 30e3;

// #262: Settings' providers.<name>.fallbacks as the WorkflowRun `fallbacks` option ({ <provider>: [entries] })
const settingsFallbacks = (settings) => Object.fromEntries(Object.entries(settings.providers || {})
  .filter(([, p]) => Array.isArray(p?.fallbacks) && p.fallbacks.length)
  .map(([name, p]) => [name, p.fallbacks.map(String)]));

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
  }

  // ---- memory guard (#276) --------------------------------------------------------------
  // Settings › Execution › Memory guard configures the app's guard (src/engine/memory-guard.js) that
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

  // The runs in progress are written down until they end: still there at the next start = they
  // died with the app. The file holds a list (one object in older versions).
  const marked = new Map(); // run id -> { runId, workflow, project, mock }
  function markActiveRun(runId, info) {
    if (info) marked.set(runId, info); else marked.delete(runId);
    try {
      if (marked.size) fs.writeFileSync(ctx.ws.activeRun, JSON.stringify([...marked.values()]));
      else fs.rmSync(ctx.ws.activeRun, { force: true });
    } catch (e) { console.error('active run marker:', e.message); }
  }
  // Notifies each run the app had in progress when it last closed; returns the first notice.
  function notifyInterruptedRun() {
    const { ws } = ctx;
    if (!ws || isRunning()) return null;
    let list = null;
    try { list = [].concat(JSON.parse(fs.readFileSync(ws.activeRun, 'utf8'))); } catch { return null; }
    fs.rmSync(ws.activeRun, { force: true });
    const interrupted = list.filter((info) => info?.runId && runs.readRun(ws.runs, path.basename(String(info.runId)))?.status === 'interrupted');
    const notices = interrupted.map((info) => notifier.interruptedNotice(info));
    notices.forEach((n) => ctx.notify(n));
    // the Oracle's wake-ups (#123, src/oracle-wake.js)
    interrupted.forEach((info) => events.emit('run:interrupted', info));
    return notices[0] || null;
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
    const taken = all.filter((r) => (c.countSimulations || !r.mock) && !lends(r));
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
  async function startWorkflowRun({ file, inputs, mock, mockSequences = null, resume = null, projectId: forcedProject = null, issues = null, allowKeptWork = false, notices: startNotices = [], attachments = null, then = null, from = null, parent = null, onFinished = null, signal = null, onSlotWait = null, agentOverrides = null }) {
    // simulation-only (automated checks): a real run is refused, never turned into a simulation
    if (!mock) simulation.refuseReal('a real run');
    // the same issues never get a second live run, from this app or another one (#112): resume that run instead
    const twin = resume ? null : liveRunForIssues(issues);
    if (twin) {
      const err = new Error(`${twin.issues.map((i) => `#${i.number}`).join(', ')} already has a live run, ${twin.runId}${twin.runningElsewhere ? ' (in another app window)' : ''}: open or resume that run instead of starting the same work twice.`);
      err.runId = twin.runId;
      throw err;
    }
    // automation (queue, roadmap) cannot ask: it stops and names the run that holds the same work (#112)
    const kept = resume || allowKeptWork ? null : ctx.keptWorkForIssues(issues);
    if (kept) {
      const err = new Error(`${kept.title}. ${kept.text} Choose with Retry on the roadmap item, Resume on the queue or Start on the issue.`);
      err.runId = kept.runId;
      throw err;
    }
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
      if (workspace.isGitUrl(inputs?.repo_path)) {
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
      const baselineAt = Date.now();
      // the Oracle's spend (in no run folder) counts too
      const budget = usage.budgetBaseline({ runsDir: ws.runs, settings, local: needsLocal ? readLocalUsage() : null, extraRuns: ctx.agentUsageRuns() });
      const wfFile = ctx.workflowPath(file);
      const notices = [...(startNotices || [])];
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
        budget, prices: settings.prices, projectId, issues, resume, attachments, mockSequences: mock ? mockSequences : null, then, from,
        agentOverrides, fallbacks: settingsFallbacks(settings), models: settings.models || {},
        // #337: tonight's limits, read at each check (a raise reaches the run at its next one)
        nightLimits: () => nightLimits.tonightLimits(ws.oracle || path.join(ws.root, 'oracle')),
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
      });
      if (!mock) {
        // the runs in progress have not written their usage to disk yet
        const problems = usage.preflight(run.wf, usage.withPeerUsage(budget, peerSessions(run), settings.prices), resolveCommand, run.inputs);
        if (problems.length) throw new Error(problems.join('\n'));
      }
      budgetAt.set(run.runId, baselineAt);
      active.set(run.runId, run);
      // runs/<id>/owner.json with a heartbeat (#112): another app process sees the run as running, not interrupted
      run.owner = runOwner.claimRun(run.runDir);
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
    run.pr = resume?.runId ? runs.runPr(ws.runs, resume.runId) : null;
    run.on('event', (ev) => {
      try { recorder.write(ev); } catch (e) { console.error('recorder:', e); }
      ctx.indexEvent(run, ev);
      const pr = ev.type === 'step.finished' ? runPr.prOfOutput(ev.output) : null;
      if (pr) run.pr = pr;
      if (run.pr) ctx.refreshLivePr(run, pr || ev.type === 'workflow.finished' ? 0 : 15000).catch((e) => console.error('run PR:', e.message));
      if (ev.type === 'workflow.finished') runEnded(run);
      // a local preview lives only while its gate is open
      if (ev.type === 'approval.resolved' || ev.type === 'workflow.finished') {
        ctx.stopLocalPreview({ runId: run.runId, reason: ev.type === 'approval.resolved' ? 'the gate was answered' : 'the run ended' });
      }
      if (ev.type === 'worktree.merged') ctx.afterLocalMerge(run, ev).catch((e) => console.error('after local merge:', e));
      if (ev.type === 'workflow.started' || ev.type === 'run.then') ctx.recordChain(run, ev);
      events.emit('run:event', ev);
      if (ev.type === 'workflow.started') markActiveRun(run.runId, runInfo);
      if (ev.type === 'workflow.finished') markActiveRun(run.runId, null);
      if (ev.type === 'workflow.finished' && onFinished) {
        try { onFinished(ev); } catch (e) { console.error('run finished:', e.message); }
      }
      // a gate's notice carries its phone page link while Phone gates is on (#226)
      ctx.notify(notifier.runNotice(ev, runInfo, { gateLink: ctx.phoneGateLink() }), { projectId: run.projectId, issue: run.issues?.map((i) => `#${i.number}`).join(', ') || null });
      // the next issues waiting in a Backlog queue start once this run is over; a queued issue whose
      // run failed pauses its queue (a failure that repeats would otherwise burn through it)
      if (ev.type === 'workflow.finished') {
        if (run.issues && run.projectId && ev.status === 'failed' && !run.mock) {
          try { backlog.setPaused(ctx.ws.backlog, run.projectId, true, `${run.issues.map((i) => `#${i.number}`).join(', ')} failed: resume to start the next issues.`); } catch (e) { console.error('backlog queue:', e); }
        }
        // the epic first (the chain may sync the backlog), then what the run's chain starts (#134)
        ctx.placeFiledInEpic(run, ev).catch((e) => console.error('issue tracker epic:', e.message))
          .then(() => ctx.continueChain(run, ev)).catch((e) => console.error('run chain:', e.message));
        // a Backlog Refresh run edited or closed issues: the Backlog syncs the project (#161)
        ctx.afterBacklogRefresh(run).catch((e) => console.error('backlog refresh sync:', e.message));
        // a release run (#260): a shipped release is recorded and its cut line lets the roadmap go on
        ctx.afterRelease(run, ev).catch((e) => console.error('release:', e.message));
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
        const o = ctx.resumeOptions({ runId: old.runId });
        const at = o.steps.find((s) => s.id === o.suggested);
        const fromStep = at?.blockedBy || o.suggested;
        if (!fromStep) throw new Error('no step to resume from');
        child.notices = [{ level: 'info', message: `Child run of ${parentRun.runId} (${step}), resuming ${old.runId} from ${fromStep}.` }];
        started = { ...(await ctx.resumeRun({ runId: old.runId, step: fromStep, mock: parentRun.mock }, child)), resumedFrom: old.runId };
      } catch (e) {
        if (signal?.aborted) throw e;
        parentRun.emitEvent('log', { level: 'warn', step_id: parent.step_id, message: `${parent.step_id}: child run ${old.runId} could not be resumed (${e.message}); starting it again.` });
      }
    }
    started ||= await startWorkflowRun({ file, inputs, mock: parentRun.mock, projectId: parentRun.projectId, ...child });
    return { runId: started.runId, finished, stop: () => active.get(started.runId)?.stop(), ...(started.resumedFrom ? { resumedFrom: started.resumedFrom } : {}) };
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
  const cleanupPass = async () => {
    if (!ctx.ws) return [];
    const removed = await cleanupWorktrees({
      worktreesDir: ctx.ws.worktrees, runsDir: ctx.ws.runs,
      active: () => [...active.values()].flatMap((r) => [r.worktree?.dir, r.resume?.worktree?.dir, path.join(ctx.ws.worktrees, r.runId), path.join(ctx.ws.worktrees, `${r.runId}-base`)]).filter(Boolean),
    });
    try { pruneDepsCache({ cacheDir: path.join(ctx.ws.cache, 'deps') }); } catch (e) { console.error('dependency cache cleanup:', e.message); }
    return removed;
  };

  return {
    active,
    activeRuns,
    cleanupRunWorktrees,
    isRunning,
    liveRun,
    liveRunForIssues,
    memoryHold,
    notifyInterruptedRun,
    passedGates,
    prepareRestart,
    runAlive,
    runIsLive,
    runWorkflow,
    slotProblem,
    startWorkflowRun,
    stopDispatchTimers,
  };
};
