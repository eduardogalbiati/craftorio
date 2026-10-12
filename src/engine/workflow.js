// Engine that runs the step graph defined in the YAML.
// Emits events ('event') that feed the UI and the observability recorder.
// `WorkflowRun` keeps the run loop: the constructor (run state, inputs, agents, template context),
// `start` (workflow.started, the walk from the first step to `end`, `finish`), `runStep` (one visit of a
// step by type: a gate, a machine step, an agent or a fan-out `agents: [...]`, `on_error`), `runAgentStep`
// (the prompt, the turn, schema validation and retries, `save_as`), `startChildRun` (the default child
// run of a `type: workflow` step), `stop`, `emitEvent` and the chaining `then` (#134).
// Everything else is one module per area in src/engine/run/ (#250), mixed into the prototype below:
// templates (`render`, `evalExpr`, filters) · load (`loadWorkflow`, the YAML vocabularies and parsers) ·
// setup (inputs, attachments, agent overrides, personas) · transitions (`finishStep`, counters, loops,
// `wait:` probes, merges, `ship:`) · gates (`type: human_approval`, `requestApproval`, `resolveApproval`) ·
// sessions (session records, `sendToAgent`, `agentTurn`, handoff notes, skills) · turns (`invokeTurn`:
// the provider call, retries, fallbacks, idle and memory watches) · costs (limits, budgets, the
// context gate, timing and context metrics) · outputs (`extractJson`, `validateSchema`, declared
// `outputs:`, the decision log) · supervision (the AI supervisor and the supervisor on call) · checkout
// (the run's worktree, deps, scratch, processes) · machine-steps (screenshots, suite, test_ids, child
// workflows, evidence) · test-requests (run-tests requests, the test map, refused test edits) · resume
// (what a resumed run reuses). A change touches the module of its area; this file only changes with
// the run loop. The public API (`new WorkflowRun(...)`, `loadWorkflow`, `evalExpr`, `render`, the
// helpers below and the events) is unchanged by the split.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { emptyUsage, refreshWindowsPath } = require('./providers');
const { resolveSkill, skillPrompt } = require('../skills');
const supervisor = require('../supervisor');
const capabilities = require('./capabilities');
const evidence = require('../evidence');
const { writeResultSummary } = require('../result-summary');
const { stopProcessesIn } = require('./processes');
const { sharedMemoryGuard } = require('./memory-guard');
const { runProbe } = require('./probes');
const { StepTrail } = require('../renderer/run-progress-model');
const chain = require('../renderer/chain-model');
const { BUNDLED_SKILLS, methods: sessionsMethods, OUTPUT_LANGUAGE } = require('./run/sessions');
const { evalExpr, render, testsPlan } = require('./run/templates');
const {
  loadWorkflow,
  MACHINE_STEP_TYPES,
  parseTokens,
  silentEfforts,
  validateModels,
} = require('./run/load');
const {
  answeredKey,
  extractJson,
  methods: outputsMethods,
  parseTestRequest,
  repeatKey,
  takeHandoff,
  validateSchema,
} = require('./run/outputs');
const { goalLoopInstructions, methods: transitionsMethods } = require('./run/transitions');
const {
  addUsage,
  attemptSummary,
  IDLE_WARN_MS,
  methods: turnsMethods,
} = require('./run/turns');
const { childRunCost, methods: costsMethods } = require('./run/costs');
const { methods: gatesMethods } = require('./run/gates');
const { methods: supervisionMethods } = require('./run/supervision');
const { methods: checkoutMethods } = require('./run/checkout');
const { methods: machineStepsMethods } = require('./run/machine-steps');
const { methods: testRequestsMethods } = require('./run/test-requests');
const { methods: resumeMethods } = require('./run/resume');
const { methods: setupMethods } = require('./run/setup');

const stepAgentLabel = (s) => (s.agents ? s.agents.join(' · ') : s.agent || null);

function newRunId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomUUID().slice(0, 8)}`;
}

class WorkflowRun extends EventEmitter {
  // budget: { [provider id]: { name, limitUsd, limitTokens, blockOnLimit, usedUsd, usedTokens } }
  // (this month's usage before this run, see src/usage.js); prices: USD per 1M tokens by model.
  // projectId: the project the run belongs to (recorded in workflow.started and summary.json).
  // issues: [{ number, url, title }] the run implements (Backlog screen; several when a group of issues
  //   goes as one run), recorded the same way. `issue` (one issue, the option before groups) is still accepted.
  // resume: { runId, fromStep, steps: { id: { output, visits } }, sessions: { agent: providerSessionId }, handoffs: { agent: note },
  //   instruction, worktree: { dir, branch } }
  //   starts at fromStep with the previous run's step outputs, agent conversations and handoff notes
  //   (src/supervisor.js resumeSpec), in the previous run's worktree.
  // worktreesDir: where orchestrator.worktree creates the run's git worktree (<workspace>/worktrees);
  //   without it (e.g. simulation runs) the agents work in the repository folder itself.
  // mockSequences: { field: [value per visit] } over the mock provider's defaults (tests).
  // notices: [{ level, message }] logged right after workflow.started (e.g. the workflow file came from a fallback folder).
  // stopProcesses: (dir) => Promise<[{ pid, exe, cwd, reason, stopped }]>, stops what agents left running in the
  //   worktree (src/engine/processes.js). Default: the real one, none for simulations (mock agents start nothing).
  // probe: ({ probe, target, cwd, signal, stepId, baseline }) => Promise<{ state, detail, fingerprint? }>, the
  //   check of a `wait:` step (src/engine/probes.js). Default: the real one; simulations use MOCK_PROBES.
  // actionsQuota: (owner) => Promise<string | null>, the message when that GitHub account's Actions quota is
  //   exhausted (src/actions-usage.js), passed to the probe as `quota`: pr_checks then reports `quota_exhausted`.
  // peerSessions: () => [{ provider, model, tokens, costUsd }], the sessions of the other runs in progress (and of
  //   those that finished after `budget` was computed): the per-turn budget check counts them too (concurrent runs).
  // idleWarnMs: an agent silent this long while a tool call is open gets an `agent_idle` warning (src/engine/idle.js).
  //   Default 5 minutes; 0 disables it.
  // personas: [{ id, name, prompt, skills }] the user's agents (Agents menu), for `persona: random`.
  // attachments: { <input>: [path | { path, name }] } images attached to inputs (#129), checked here (refused
  //   before anything runs), copied into <run_dir>/attachments/<input>/ at start and given to every turn of a
  //   step whose prompt uses that input (stepAttachments). A resume passes the previous run's copies.
  // then: what happens with the run's result when it finishes (#134, src/renderer/chain-model.js), recorded in
  //   workflow.started and summary.json; a gate choice with `then` or the owner (setThen) can change it while it runs.
  // from: { run_id, workflow, pipeline? } the run whose chain started this one (workflow.started.from,
  //   summary.from); `pipeline` when a saved pipeline's stage (#135, chain-model normalizePipeline).
  // parent: { run_id, workflow, step_id, index?, depth } the run whose `type: workflow` step started this one
  //   (#174), recorded as `parent_run` in workflow.started and summary.json.
  // startChild: ({ file, inputs, parent, label }) => Promise<{ runId, finished: Promise<{ status, outputs, error }>, stop }>,
  //   starts a child run for a `type: workflow` step (the service: a normal run, src/service/areas/runs.js).
  //   Default: startChildRun, a WorkflowRun of its own, emitted as 'child' (its events are the listener's to record).
  // agentOverrides (#262): { <agent>: { provider?, model?, effort? } } this run's choice for an agent (the Start
  //   drawer's "Agents"); the workflow's values are the defaults, '' or null clears an effort. Recorded in
  //   workflow.started `agents`; an agent the workflow does not have, or an undefined provider, is refused.
  // fallbacks (#262): { <provider>: ["<provider>:<model>", ...] } Settings' chains per provider, for an agent whose
  //   workflow declares no `fallbacks` (see fallbackChain).
  // models (#262): { <model id>: { timeout_factor?, max_total_cost_usd? } } Settings' limits per model; the
  //   workflow's own `models` win per model (see modelLimits).
  constructor({ file, inputs, mock, runsDir, skillsDirs, budget, prices, projectId, issues, issue, resume, worktreesDir, mockSequences, notices, stopProcesses, probe, actionsQuota, peerSessions, idleWarnMs, personas, localPreview, attachments, then, from, parent, startChild, memoryGuard, agentOverrides, fallbacks, models }) {
    super();
    refreshWindowsPath(); // actions (e.g. gh pr merge) need the refreshed PATH
    this.file = file;
    this.wf = loadWorkflow(file);
    this.mock = !!mock;
    this.mockSequences = mockSequences || null;
    this.notices = notices || [];
    this.runId = newRunId();
    this.runDir = path.join(runsDir, this.runId);
    this.skillsDirs = [...(skillsDirs || []), BUNDLED_SKILLS];
    this.projectId = projectId || null;
    this.issues = issues?.length ? issues : issue ? [issue] : null;
    this.then = chain.normalizeThen(then);
    const pipeline = chain.normalizePipeline(from?.pipeline);
    this.from = from?.run_id ? { run_id: String(from.run_id), workflow: from.workflow ? String(from.workflow) : undefined, ...(pipeline ? { pipeline } : {}) } : null;
    this.parent = parent?.run_id ? {
      run_id: String(parent.run_id), workflow: parent.workflow ? String(parent.workflow) : undefined, step_id: parent.step_id ? String(parent.step_id) : undefined,
      ...(Number.isInteger(parent.index) ? { index: parent.index } : {}), depth: Math.max(1, Number(parent.depth) || 1),
    } : null;
    this.startChild = startChild || ((spec) => this.startChildRun(spec));
    this.children = new Map(); // run id -> WorkflowRun started by the default startChild
    this.childRuns = []; // [{ run_id, step_id, index?, workflow, status }] (summary.child_runs)
    this.worktreesDir = worktreesDir || null;
    this.worktree = null; // see setupWorktree
    this.stopProcesses = stopProcesses === undefined ? (this.mock ? null : stopProcessesIn) : stopProcesses;
    // #276 (src/engine/memory-guard.js): stops a process of this run over the memory limit and holds
    // suites while memory is low; the app's guard for a real run (null when turned off), none for a
    // simulation unless one is given
    this.memoryGuard = memoryGuard !== undefined ? memoryGuard : this.mock ? null : sharedMemoryGuard();
    this.memoryNotes = new Map(); // agent -> [what the guard stopped], told in its next prompt
    this.memoryStops = new Map(); // `${step}\n${command}` -> stops (the second one notifies the owner)
    this.probe = probe || (this.mock ? (args) => this.mockProbe(args) : runProbe);
    this.actionsQuota = actionsQuota || null;
    this.probeStats = {}; // step -> { polls, agent_calls, completed, errors } (summary.probes)
    this.mockProbeCalls = {};
    this.mockActionCalls = {}; // step -> transition actions/merges run (mockSequences.action_errors)
    this.budget = budget || {};
    this.prices = prices || {};
    this.budgetWarned = new Set();
    this.peerSessions = peerSessions || (() => []);
    this.idleWarnMs = idleWarnMs ?? IDLE_WARN_MS;
    this.stepTiming = {};           // step id -> { turns, duration_ms, active_ms, waiting_ms, stalled_ms } (summary.timing)
    this.inputs = this.resolveInputs(inputs || {});
    this.testsPlan = testsPlan(this.wf.inputs, inputs, this.inputs); // summary.tests_plan, ctx.tests_plan (#203)
    this.suiteRuns = { engine: 0, agents: 0 }; // whole-suite runs: suite steps vs agents' own commands (#177, summary.suite_runs)
    // #212: the whole suite passed once in this run (scope: affected stops running it), and the
    // test files that failed in a suite round (they join the next rounds' affected set)
    this.fullSuitePassed = false;
    this.suiteFailedFiles = [];
    this.testsAutocommitted = []; // [{ step_id, files, commit }] (#209, summary.tests_autocommitted)
    this.toolTimeouts = 0; // tool results cut by the tool's timeout (#178, summary.tool_timeouts)
    this.inputImages = this.checkInputAttachments(attachments || {});
    this.attachments = {}; // input -> [{ name, path }] the copies in the run folder (storeInputAttachments)
    this.gateImages = []; // images attached to the last gate's feedback, for the next agent step
    this.imagesWarned = new Set();
    // An agent's provider, model and effort can be templates over the inputs
    // (provider: "{{ inputs.writer_provider }}"), so a workflow can let the user pick them.
    // Resolved once per run, before anything reads them (preflight, budgets, sessions).
    for (const a of Object.values(this.wf.agents)) {
      for (const k of ['provider', 'model', 'effort']) {
        if (typeof a[k] === 'string' && a[k].includes('{{')) a[k] = render(a[k], { inputs: this.inputs }).trim();
      }
    }
    this.applyAgentOverrides(agentOverrides);
    // #262: Settings' fallback chains per provider and limits per model
    validateModels(models || undefined, 'Settings models');
    this.models = { ...(models || {}), ...(this.wf.models || {}) };
    this.providerFallbacks = fallbacks || {};
    this.fallbackAt = new Map(); // agent -> { chain, index } of its fallback chain (fallbackChain)
    this.dropDisabledAgents();
    // #286: an effort the CLI never gets goes to the run's log at start, never silent
    for (const message of silentEfforts(this.wf)) this.notices.push({ level: 'warn', message });
    this.pickPersonas(personas || [], resume?.personas);
    this.ctx = {
      inputs: this.inputs, steps: {}, loop: { iteration: 0 }, run_id: this.runId, run_dir: this.runDir, runs_dir: runsDir, workflows_dir: path.dirname(path.resolve(file)),
      agents: Object.fromEntries(Object.entries(this.wf.agents).map(([k, a]) => [k, { provider: a.provider, model: a.model }])),
      // what the user typed at the human gates, oldest first: [{ step, choice, text, ts }]
      feedback: [],
      // the step that ran before the current one (null for the first)
      previous_step: null,
      // run variables set by transitions (`set: { name: value }`), e.g. what the next checks cover
      vars: {},
      // how to run the worktree locally ({ install, command, url }) or null; gates' messages show it
      local_preview: null,
      // folder of a skill (workspace first, then bundled), e.g. to run its script in an action
      skill_dir: (name) => resolveSkill(this.skillsDirs, name).path,
      // the unit / E2E test inputs (#203), one sentence for the gates and the verifier ('' without them)
      tests_plan: this.testsPlan.map((p) => `${p.label}: ${p.value_label} (${p.source}).`).join(' '),
    };
    // outputs (#290): every visit's output, oldest first (`output` is the last one); a resumed run
    // only has the last
    for (const s of this.wf.steps) this.ctx.steps[s.id] = { output: null, outputs: [], visits: 0 };
    this.resume = resume || null;
    if (resume) this.seedResume(resume);
    this.recent = []; // last events, for the supervisor's timeline
    this.trail = new StepTrail(); // step visits with their agents, for the progress views (summary.progress)
    // #290: the same visits for templates ({ step, visit, type, status, cost, durationMs, ts }, oldest first)
    this.ctx.trail = this.trail.steps;
    this.setupSupervisor();

    this.sessions = new Map();      // local id -> session
    this.agentSessions = new Map(); // persistent agent -> local id
    // agent -> its latest handoff note { text, step, visit, path } (a resumed run starts from the previous run's)
    this.handoffNotes = new Map(Object.entries(resume?.handoffs || {}));
    this.rotate = new Set();        // persistent agents whose last turn ended above max_context
    this.turnLog = [];              // one record per agent turn: context at start / peak, tokens, waste
    this.capsLogged = new Set();
    this.counters = {};
    this.loops = {};
    this.approvals = new Map();
    // how to run the worktree from a gate with `local_preview: true` (the project's override, else
    // the workflow's orchestrator.local_preview); null hides Run locally
    this.localPreview = localPreview || this.wf.orchestrator?.local_preview || null;
    this.ctx.local_preview = this.localPreview;
    this.gateWaits = {}; // gate step id -> { waits, wait_ms } (summary.timing.gates): owner time, not agent time
    this.preexisting = []; // [{ step, test, file, reason }] (notePreexistingFailures)
    this.stalls = []; // last stall signals [{ step, kind, detail, ts }] (recordStall), for the supervisor on call
    this.liveTurns = new Map(); // step id -> Set of stop(decision) of its running turns (a slow step's interrupt)
    this.exhausted = null; // { from, target, detail, refund } of the last transition to an on_exhausted target (noteExhausted)
    this.abort = new AbortController();
    this.seq = 0;
    this.nSession = 0;
    this.nApproval = 0;
    this.status = 'pending';
  }

  emitEvent(type, data = {}) {
    const ev = { seq: ++this.seq, ts: new Date().toISOString(), run_id: this.runId, type, ...data };
    if (type !== 'session.stream') { this.recent.push(ev); if (this.recent.length > 300) this.recent.shift(); this.trail.apply(ev); }
    this.emit('event', ev);
    return ev;
  }

  // What happens with the result when the run finishes (#134): the owner edits or cancels it while the
  // run goes (null = nothing). Recorded as `run.then`; summary.json has the last one.
  setThen(then, by = 'owner') {
    this.then = chain.normalizeThen(then);
    this.emitEvent('run.then', { then: this.then, by });
    return this.then;
  }

  // A gate choice with `then` (e.g. the issue tracker's "Create and queue"): the owner's pick sets the
  // chain; its workflow can be a template over the run (`{{ inputs.assign_workflow }}`).
  thenFromChoice(step, choice) {
    const t = choice.then && typeof choice.then === 'object' ? { ...choice.then } : choice.then;
    try {
      if (t?.workflow) t.workflow = render(t.workflow, this.ctx).trim();
      this.setThen(t, `gate:${step.id}`);
    } catch (e) {
      this.emitEvent('log', { level: 'warn', message: `Gate ${step.id}: the choice's "then" was not set: ${e.message}` });
    }
  }

  // ---- execution ------------------------------------------------------------
  stepById(id) {
    const s = this.wf.steps.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown step: ${id}`);
    return s;
  }

  async start() {
    this.startedAt = Date.now();
    this.status = 'running';
    this.storeInputAttachments();
    if (this.resumeImages?.length) this.gateImages = this.copyAttachments(this.resumeImages, `${this.resume.fromStep}-instruction`);
    this.emitEvent('workflow.started', {
      workflow: this.wf.metadata?.name, version: this.wf.metadata?.version, project_id: this.projectId,
      issues: this.issues || undefined,
      file: path.basename(this.file), inputs: this.inputs, mock: this.mock, run_dir: this.runDir,
      // #233: each turn's cost_usd is its own (runs without it recorded Claude's cumulative totals)
      cost_accounting: 'per_turn',
      // the unit / E2E test inputs and where each value came from (#203)
      tests_plan: this.testsPlan.length ? this.testsPlan : undefined,
      attachments: Object.keys(this.attachments).length ? this.attachments : undefined,
      resumed_from: this.resume ? { run_id: this.resume.runId, step: this.resume.fromStep } : undefined,
      then: this.then || undefined,
      from: this.from || undefined,
      parent_run: this.parent || undefined,
      personas: Object.keys(this.personas).length ? this.personas : undefined,
      agent_names: this.agentNames(),
      // #262: what each agent runs on in this run, its overrides applied; the overrides themselves
      // (what differs from the workflow), which a resume of this run applies again
      agents: Object.fromEntries(Object.entries(this.wf.agents).map(([k, a]) => [k, { provider: a.provider, model: a.model, effort: a.effort || null }])),
      agent_overrides: Object.keys(this.agentOverrides).length ? this.agentOverrides : undefined,
      display: this.displayNames(),
      steps: this.wf.steps.map((s) => ({ id: s.id, type: s.type || 'agent', agent: stepAgentLabel(s) })),
      groups: this.wf.groups,
    });
    for (const n of this.notices) this.emitEvent('log', { level: n.level || 'info', message: n.message });
    this.orchestrator = this.openSession({
      agent: 'orchestrator', provider: 'engine', model: 'engine (deterministic)', parentId: null, stepId: null,
    });
    this.setStatus(this.orchestrator, 'active');

    let current = this.resume?.fromStep || this.wf.steps[0].id;
    let guard = 0;
    let status = 'success';
    let error = null;
    try {
      await this.setupWorktree();
      this.replayConfirmedGate();
      while (current !== 'end') {
        if (current === 'fail') throw new Error('Workflow routed to "fail" (retry limit reached).');
        if (++guard > 500) throw new Error('Limit of 500 transitions reached.');
        if (this.abort.signal.aborted) throw new Error('Cancelled');
        this.checkLimits();
        current = await this.runStep(this.stepById(current));
      }
      // `goto: end` + `status: failed|cancelled` (e.g. a rejected gate): not a success
      if (this.endStatus) {
        status = this.endStatus.status;
        error = new Error(this.endStatus.message);
      }
    } catch (e) {
      status = this.abort.signal.aborted ? 'cancelled' : 'failed';
      error = e;
    }
    await this.stopWorktreeProcesses('run end');
    await this.finishWorktree(status);
    this.finish(status, error);
  }

  stop() {
    this.abort.abort();
    for (const a of this.approvals.values()) a.reject(new Error('Cancelled'));
  }

  async runStep(step) {
    const st = this.ctx.steps[step.id];
    // /loop iteration: resets whenever the step is (re)entered from another step
    const again = this.prevStepId === step.id;
    if (!again) { st.iteration = 0; st.loopStartedAt = Date.now(); st.blocked = null; st.probeBaseline = null; }
    st.iteration++;
    this.ctx.previous_step = this.prevStepId || null;
    this.prevStepId = step.id;
    const t0 = Date.now();
    // `wait:` the engine checks the PR/MR or CI run itself; the agent only runs on news
    if (again && step.wait) {
      const next = await this.pollStep(step, st, t0);
      if (next) return next;
    }
    st.visits++;
    st.firstVisitAt ??= Date.now();
    st.tools = { ran: 0, denials: 0, denied: [] }; // this visit's tool calls, for the blocked-loop check
    st.turnRecs = []; // this visit's turn records (turnLog), marked as waste when the visit was blocked
    this.emitEvent('step.started', { step_id: step.id, visit: st.visits, iteration: st.iteration, step_type: step.type || 'agent', agent: stepAgentLabel(step) });

    // a loop that ran out and sent the run here (finishStep handles the targets that are not gates)
    const exhausted = this.exhausted?.target === step.id ? this.exhausted : null;
    this.exhausted = null;
    let output, scope;
    if (step.type === 'human_approval') {
      // `kind: escalation`, or any gate an exhausted loop leads to: the supervisor on call tries to
      // solve the problem before the person is asked; when it cannot, the gate opens with its
      // diagnosis. A decision gate stays the person's: the supervisor may only send the run back.
      const oc = step.kind === 'escalation' || exhausted ? await this.superviseEscalation(step, st, t0, { decision: step.kind !== 'escalation' }) : null;
      if (oc?.goto) { exhausted?.refund(); return oc.goto; }
      const routed = oc?.route !== undefined;
      const gate = routed ? { answer: oc.route, feedback: '' } : await this.openGate(step, t0, oc?.diagnosis);
      if (gate.recover) return gate.recover;
      const { answer, feedback } = gate;
      const by = routed ? { by: 'supervisor' } : {};
      // who answered (#260): a `ship:` transition only follows the owner's own answer
      st.answeredBy = routed ? 'supervisor' : gate.by || 'unknown';
      if (step.choices) {
        output = { choice: answer, feedback, ...by };
        scope = { ...this.ctx, output, choice: answer, feedback };
        const picked = step.choices.find((c) => c.id === answer);
        if (picked?.then !== undefined) this.thenFromChoice(step, picked);
      } else {
        output = { approved: answer, feedback, ...by };
        scope = { ...this.ctx, output, approved: answer, rejected: !answer, feedback };
      }
      st.output = output;
    } else if (step.type === 'screenshots') {
      // no agent, no supervisor: whatever fails is in the output, for the gate that follows (#144)
      try {
        output = await this.runScreenshots(step, st);
      } finally {
        await this.stopWorktreeProcesses(`step ${step.id}`);
      }
      st.output = output;
      scope = { ...this.ctx, output, iteration: st.iteration };
    } else if (step.type === 'suite') {
      // no agent, no supervisor (#177): the result (pass, fail with the failing tests, blocked) is
      // the output, and the transitions route it
      try {
        output = await this.runSuiteStep(step, st);
      } finally {
        await this.stopWorktreeProcesses(`step ${step.id}`);
      }
      if (this.abort.signal.aborted) throw new Error('Cancelled');
      st.output = output;
      scope = { ...this.ctx, output, iteration: st.iteration };
    } else if (step.type === 'test_ids') {
      // no agent, no model call (#246): the missing test ids are the output, the transitions route it
      output = this.runTestIdsStep(step, st);
      st.output = output;
      scope = { ...this.ctx, output, iteration: st.iteration };
    } else if (step.type === 'workflow') {
      // child runs (#174): their gates wait for the owner, and so does this run; no supervisor here
      output = await this.runChildWorkflows(step, st);
      if (this.abort.signal.aborted) throw new Error('Cancelled');
      st.output = output;
      if (output.status !== 'success') {
        const reason = `the child workflow ${output.workflow} ${output.runs ? `failed for ${output.failed} of ${output.runs.length} items` : `ended ${output.status}${output.error ? `: ${output.error}` : ''}`}`;
        // `on_error: <step>` (a route or a gate) takes a child that failed or stopped; without it the
        // transitions decide (they see output.status), and a step with none fails the run
        if (step.on_error) {
          this.emitEvent('log', { level: 'error', message: `${step.id}: ${reason} → ${step.on_error}` });
          this.emitEvent('step.finished', { step_id: step.id, visit: st.visits, iteration: st.iteration, output, duration_ms: Date.now() - t0, error: true });
          this.emitEvent('step.transition', { from: step.id, to: step.on_error, when: 'on_error' });
          return step.on_error;
        }
        if (!step.transitions?.length) throw new Error(`Step "${step.id}": ${reason}.`);
      }
      scope = { ...this.ctx, output, status: output.status, iteration: st.iteration };
    } else {
      if (step.base_worktree) await this.setupBaseWorktree();
      const slow = this.watchSlowStep(step, st);
      try {
        output = step.agents ? await this.runFanOut(step, st) : await this.runAgentStep(step, st, step.agent);
      } catch (e) {
        this.lastStepError = e.message;
        if (this.abort.signal.aborted) throw e;
        // the AI supervisor may fix the output, retry with an instruction, or go to an allowed step
        const r = e.idleInterrupt ? this.idleRetry(step, st, e) : await this.superviseFailure(step, st, e);
        if (r?.output) {
          output = r.output;
        } else if (r?.goto) {
          st.output = { error: e.message, supervisor: r.decision };
          this.emitEvent('step.finished', { step_id: step.id, visit: st.visits, iteration: st.iteration, output: st.output, duration_ms: Date.now() - t0, error: true });
          this.emitEvent('step.transition', { from: step.id, to: r.goto, when: `supervisor: ${r.decision.action}` });
          return r.goto;
        }
      } finally {
        slow?.stop();
        await this.stopWorktreeProcesses(`step ${step.id}`);
        // a lockfile the step changed (a package added): its key is installed once and linked; an
        // entry the agent changed or emptied through the link is no longer given to new worktrees
        if (this.worktree && !this.abort.signal.aborted) await this.prepareDeps('worktree', this.ctx.worktree_dir, `step ${step.id}`).catch(() => {});
      }
      if (output === undefined) {
        const e = new Error(this.lastStepError || `Step "${step.id}" failed.`);
        // `on_error: <step>`: a failing step (agent error, invalid output) does not end the run;
        // its output becomes { error } and the flow goes to that step.
        if (!step.on_error) throw e;
        st.output = { error: e.message };
        this.emitEvent('log', { level: 'error', message: `${step.id} failed: ${e.message} → ${step.on_error}` });
        this.emitEvent('step.finished', { step_id: step.id, visit: st.visits, iteration: st.iteration, output: st.output, duration_ms: Date.now() - t0, error: true });
        this.emitEvent('step.transition', { from: step.id, to: step.on_error, when: 'on_error' });
        return step.on_error;
      }
      if (step.commit_tests) output = await this.commitLeftoverTests(step, st, output);
      st.output = output;
      scope = { ...this.ctx, output, iteration: st.iteration };
      if (step.wait) await this.afterAgentTurn(step, st);
    }
    const next = await this.finishStep(step, st, output, scope, t0);
    return MACHINE_STEP_TYPES.includes(step.type) ? next : this.checkStalls(step, st, output, t0, next, again);
  }

  // Fan-out: the same step runs in parallel for each agent in `agents`, each one
  // in its own session. output = { results: { agent: output }, succeeded, failed }.
  // `min_success` (default: all) says how many must respond for the step to count.
  // `agent_when: { <agent>: <expr> }` (#151) leaves an agent out of this visit when its expression
  // is false (output `skipped`; `min_success` capped at the agents that run); `required_agents`
  // fails the step when one of them ran and did not respond, whatever `min_success` says.
  async runFanOut(step, st) {
    const when = step.agent_when || {};
    const agents = step.agents.filter((name) => when[name] === undefined || evalExpr(when[name], this.ctx));
    const skipped = step.agents.filter((name) => !agents.includes(name));
    if (skipped.length) this.emitEvent('log', { level: 'info', message: `[${step.id}] skipped this visit (agent_when): ${skipped.join(', ')}` });
    if (!agents.length) throw new Error(`Step "${step.id}": agent_when leaves no agent of the fan-out to run.`);
    const settled = await Promise.allSettled(agents.map((name) => this.runAgentStep(step, st, name)));
    st.delegate_result = null; // consumed by all agents
    st.supervisorNote = null;
    this.restoredWorkNote = null;
    this.gateImages = [];
    if (this.abort.signal.aborted) throw new Error('Cancelled');
    const results = {};
    const failed = [];
    settled.forEach((r, i) => {
      const name = agents[i];
      if (r.status === 'fulfilled') { results[name] = r.value; return; }
      failed.push({ agent: name, error: r.reason?.message || String(r.reason) });
      this.emitEvent('log', { level: 'error', message: `[${step.id}] ${name} failed: ${r.reason?.message || r.reason}` });
    });
    const succeeded = Object.keys(results);
    const min = Math.min(step.min_success ?? agents.length, agents.length);
    const missing = (step.required_agents || []).filter((name) => agents.includes(name) && !results[name]);
    if (succeeded.length < min || missing.length) {
      const why = failed.map((f) => `${f.agent}: ${f.error}`).join(' | ');
      const need = missing.length ? `required: ${missing.join(', ')}` : `minimum ${min}`;
      throw new Error(`Step "${step.id}": only ${succeeded.length}/${agents.length} agents responded (${need}). ${why}`);
    }
    return { results, succeeded, failed, ...(skipped.length ? { skipped } : {}) };
  }

  async runAgentStep(step, st, agentName) {
    const visit = st.visits;
    const schema = step.output_schema;
    // evidence_dir: where this visit's screenshots go (#146), <run_dir>/evidence/<step>/round-<visit>
    const scope = { ...this.ctx, iteration: st.iteration, delegate_result: st.delegate_result, agent: agentName, evidence_dir: evidence.roundDir(this.runDir, step.id, visit) };
    // `test_map: true` (#219): the code → tests map of the agent's checkout, as {{ test_map }}
    if (step.test_map) scope.test_map = this.writeTestMap(agentName);
    let prompt = render(step.prompt, scope).trim();
    if (st.supervisorNote) {
      prompt += `\n\n---\nNote from the run supervisor (a previous attempt of this step failed):\n${st.supervisorNote}`;
      if (!step.agents) st.supervisorNote = null;
    }
    if (this.restoredWorkNote) {
      prompt += `\n\n---\n${this.restoredWorkNote}`;
      if (!step.agents) this.restoredWorkNote = null;
    }
    if (!step.agents) st.delegate_result = null; // consumed (in a fan-out, after all of them)
    // step skills go in the prompt itself; the name can be a template ("{{ inputs.document_skill }}")
    const skills = this.loadSkills((step.skills || []).map((n) => render(n, scope).trim()));
    if (skills.length) prompt = `${skills.map((sk) => skillPrompt(sk, agentName)).join('\n\n')}\n\n${prompt}`;
    const extra = goalLoopInstructions(step, st, this.ctx);
    st.probeNews = null; // consumed
    if (extra) prompt += '\n\n---\n' + extra;
    if (schema) {
      prompt += '\n\n---\nAt the end of your response you MUST include a ```json block with an object that validates against this JSON Schema:\n```json\n'
        + JSON.stringify(schema, null, 2) + '\n```\n'
        + OUTPUT_LANGUAGE;
    }
    const hint = { stepId: step.id, visit, schema, agent: agentName, sequences: this.mockSequences };
    // images (#129): those of the inputs its prompt uses, and those of the last gate's feedback
    const attachments = [...this.stepAttachments(step.prompt), ...this.gateImages];
    if (!step.agents) this.gateImages = []; // consumed (in a fan-out, after all of them)
    const opts = { stepId: step.id, hint, skills, capabilities: step.capabilities, editsTests: step.edits_tests, protectFiles: step.protect_files, attachments };
    const countTools = (r) => {
      // cutRecs: the turns of this visit cut by their request budget before this one (#302)
      for (const rec of [...(r.cutRecs || []), r.turnRec]) if (rec) st.turnRecs?.push(rec);
      if (!r.tools || !st.tools) return;
      st.tools.ran += r.tools.ran;
      st.tools.denials += r.tools.denials;
      st.tools.maxStreak = Math.max(st.tools.maxStreak || 0, r.tools.maxStreak || 0);
      st.tools.denied.push(...r.tools.denied);
    };
    let res = await this.sendToAgent(agentName, prompt, opts);
    countTools(res);
    st.lastAnswer = res.text;
    if (!schema) {
      this.saveOutput(step, scope, res.text, { text: res.text });
      return { text: res.text };
    }

    for (let attempt = 0; ; attempt++) {
      let errs;
      try {
        const out = extractJson(res.text);
        errs = validateSchema(out, schema);
        if (!errs.length) {
          this.saveOutput(step, scope, JSON.stringify(out, null, 2), out);
          return out;
        }
      } catch (e) {
        errs = [e.message];
      }
      this.emitEvent('log', { level: 'warn', kind: 'invalid_output', step_id: step.id, message: `Invalid output in ${step.id}${step.agents ? ` (${agentName})` : ''}: ${errs.join('; ')}` });
      if (attempt >= 2) throw new Error(`Output of step "${step.id}" failed validation: ${errs.join('; ')}`);
      res = await this.sendToAgent(agentName, this.retryPrompt(agentName, prompt, res.text, schema, errs), { ...opts, retry: true });
      countTools(res);
      st.lastAnswer = res.text;
    }
  }

  // The default startChild (the CLI, engine tests): a WorkflowRun of its own in the same runs folder,
  // with this run's settings, emitted as 'child' before it starts (record its events, answer its gates).
  // The child's workflow file: next to this run's, else the bundled one. A resumed run reuses a child
  // of its previous run that succeeded (`previous`, #175); any other child starts afresh (resuming a
  // child from where it stopped is the service's, src/service/areas/runs.js).
  async startChildRun({ file, inputs, parent, label, previous }) {
    if (previous?.run_id) {
      let summary = null;
      try { summary = JSON.parse(fs.readFileSync(path.join(this.ctx.runs_dir, path.basename(previous.run_id), 'summary.json'), 'utf8')); } catch { /* not finished */ }
      if (summary?.status === 'success') {
        return { runId: summary.run_id || path.basename(previous.run_id), reused: true, stop: () => {}, finished: Promise.resolve({ status: 'success', outputs: summary.outputs || {}, error: null, cost_usd: childRunCost(summary) }) };
      }
    }
    const bundled = path.join(__dirname, '..', '..', 'workflows');
    const dirs = [path.dirname(path.resolve(this.file)), bundled];
    const found = path.isAbsolute(file) ? file : dirs.map((d) => path.join(d, file)).find((f) => fs.existsSync(f));
    if (!found) throw new Error(`Workflow not found: "${file}" (searched in ${dirs.join(', ')})`);
    const child = new WorkflowRun({
      file: found, inputs, mock: this.mock, runsDir: this.ctx.runs_dir, skillsDirs: this.skillsDirs.filter((d) => d !== BUNDLED_SKILLS),
      budget: this.budget, prices: this.prices, projectId: this.projectId, worktreesDir: this.worktreesDir, parent,
      ...(this.stopProcesses === null ? { stopProcesses: null } : {}), idleWarnMs: this.idleWarnMs,
      notices: [{ level: 'info', message: `Child run of ${this.runId} (step ${parent.step_id}${label ? `, ${label}` : ''}).` }],
    });
    const finished = new Promise((resolve) => child.on('event', (ev) => {
      if (ev.type === 'workflow.finished') resolve({ status: ev.status, outputs: ev.outputs || {}, error: ev.error, cost_usd: childRunCost(ev.summary) });
    }));
    this.children.set(child.runId, child);
    this.emit('child', child);
    child.start();
    return { runId: child.runId, finished, stop: () => child.stop() };
  }

  finish(status, err) {
    this.status = status;
    for (const a of this.approvals.values()) a.reject(new Error('Finished'));
    this.approvals.clear();
    for (const s of this.sessions.values()) {
      // the session status reflects the session itself, not the workflow outcome
      if (!s.closedAt) this.closeSession(s, s.status === 'error' ? 'failed' : status === 'cancelled' ? 'cancelled' : s.id === 'orchestrator' ? status : 'success');
    }
    const sessions = [...this.sessions.values()].map((s) => this.snapshot(s));
    const tokens = emptyUsage();
    sessions.forEach((s) => addUsage(tokens, s.tokens));
    const outputs = this.computeOutputs();
    const summary = {
      run_id: this.runId, workflow: this.wf.metadata?.name, project_id: this.projectId, issues: this.issues || undefined, status,
      started_at: new Date(this.startedAt).toISOString(), finished_at: new Date().toISOString(),
      duration_ms: Date.now() - this.startedAt, inputs: this.inputs, mock: this.mock, worktree: this.worktreeSummary(),
      // `merge: local`: what landed on the local base, not pushed (Backlog: "Local" column, Push)
      local_merge: this.ctx.local_merge ? { branch: this.ctx.local_merge.branch, base: this.ctx.local_merge.base, commit: this.ctx.local_merge.commit } : null,
      // `ship:` (#260): the release the owner shipped ({ tag, base, commit, pushed, issues }; `simulated` in a simulation)
      ...(this.ctx.release ? { release: this.ctx.release } : {}),
      tokens, cost_usd: +sessions.reduce((a, s) => a + s.cost_usd, 0).toFixed(6), cost_accounting: 'per_turn',
      // #277: a multi-result Claude turn records its highest total (src/run-costs.js reads older runs from their events)
      turn_cost: 'max_result',
      context: this.contextSummary(),
      timing: this.timingSummary(),
      // `wait:` steps: checks made without an agent turn, agent turns they asked for, steps they finished
      ...(Object.keys(this.probeStats).length ? { probes: this.probeStats } : {}),
      steps: Object.fromEntries(Object.entries(this.ctx.steps).map(([k, v]) => [k, { visits: v.visits, output: v.output }])),
      // failures that also fail on the base, reported by a step and not chased in this run: follow-up issues for the owner
      ...(this.preexisting.length ? { preexisting_failures: this.preexisting } : {}),
      // #203: the unit / E2E test inputs and where each value came from; #177: whole-suite runs
      // by the engine's suite steps and by the agents' own commands (the measure of the change)
      ...(this.testsPlan.length ? { tests_plan: this.testsPlan } : {}),
      ...(Object.values(this.suiteRuns).some(Boolean) ? { suite_runs: this.suiteRuns } : {}),
      // #209: test files the engine committed for the test writer; #178: commands cut by the tool's timeout
      ...(this.testsAutocommitted.length ? { tests_autocommitted: this.testsAutocommitted } : {}),
      ...(this.toolTimeouts ? { tool_timeouts: this.toolTimeouts } : {}),
      // step visits in order with their agents (runs list); this event's own update lands in it
      groups: this.wf.groups, progress: this.trail.steps,
      ...(outputs ? { outputs } : {}),
      ...(this.then ? { then: this.then } : {}),
      ...(this.from ? { from: this.from } : {}),
      // `type: workflow` steps (#174): the run that started this one, the runs this one started
      ...(this.parent ? { parent_run: this.parent } : {}),
      ...(this.childRuns.length ? { child_runs: this.childRuns, children_cost_usd: +this.childrenCostUsd().toFixed(6) } : {}),
      sessions,
    };
    // #225: result.md, the run's first artifact, written before the event that refreshes the lists
    writeResultSummary(this.runDir, { ...summary, error: err?.message || null });
    this.emitEvent('workflow.finished', {
      status, error: err?.message || null,
      // the declared outputs (#134) and the chain, for what starts next
      ...(outputs ? { outputs } : {}),
      ...(this.then ? { then: this.then } : {}),
      summary,
    });
  }
}

// The areas' methods join the class here (#250): defined like class methods (not enumerable), so
// tests can still patch an instance's method and `Object.create(WorkflowRun.prototype)` keeps working.
const mixin = (proto, ...sets) => {
  for (const set of sets) for (const [name, fn] of Object.entries(set)) Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true, enumerable: false });
};
mixin(
  WorkflowRun.prototype,
  outputsMethods,
  transitionsMethods,
  gatesMethods,
  sessionsMethods,
  turnsMethods,
  costsMethods,
  supervisionMethods,
  checkoutMethods,
  machineStepsMethods,
  testRequestsMethods,
  resumeMethods,
  setupMethods,
);

module.exports = {
  answeredKey,
  attemptSummary,
  childRunCost,
  evalExpr,
  extractJson,
  loadWorkflow,
  parseTestRequest,
  parseTokens,
  render,
  repeatKey,
  takeHandoff,
  validateSchema,
  WorkflowRun,
};
