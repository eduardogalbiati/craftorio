// Engine that runs the step graph defined in the YAML.
// Emits events ('event') that feed the UI and the observability recorder.
// `WorkflowRun` keeps the run loop: the constructor (run state, inputs, agents, template context),
// `start` (workflow.started, the walk from the first step to `end`) and `finish` (summary.json,
// workflow.finished), `runStep` (one visit of a step by type: a gate, a machine step, an agent or a
// fan-out `agents: [...]` through `runFanOut`, `on_error`), `runAgentStep` (the prompt, the turn, schema
// validation and retries, `save_as`), `startChildRun` (the default child run of a `type: workflow` step),
// `stop`, `stepById`, `emitEvent` and the chaining `then` (#134: `setThen`, `thenFromChoice`).
// Everything else is one module per area in packages/engine/engine/run/ (#250), mixed into the prototype below:
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
const { bundledDir } = require('../domains/workspace/app-root');
const { resolveSkill, skillPrompt } = require('../domains/agents/skills');
const evidence = require('../domains/evidence/evidence');
const { writeResultSummary } = require('../domains/evidence/result-summary');
const { stopProcessesIn } = require('./processes');
const { sharedMemoryGuard } = require('./memory-guard');
const machineActions = require('./machine-actions');
const { StepTrail } = require('@multiagent/shared/run-progress-model');
const chain = require('@multiagent/shared/chain-model');
const Language = require('@multiagent/shared/language');
const { BUNDLED_SKILLS, methods: sessionsMethods } = require('./run/sessions');
const { evalExpr, render, testsPlan } = require('./run/templates');
const { GATE } = require('./run/field-rules');
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
  stepOutputSchema,
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
const { methods: accountsMethods } = require('./run/accounts');
const { childRunCost, methods: costsMethods } = require('./run/costs');
const { methods: gatesMethods } = require('./run/gates');
const { methods: supervisionMethods } = require('./run/supervision');
const { methods: checkoutMethods } = require('./run/checkout');
const { methods: machineStepsMethods } = require('./run/machine-steps');
const { methods: projectMapStepsMethods } = require('./run/project-map-steps');
const { methods: refactorProposalsStepsMethods } = require('./run/refactor-proposals-steps');
const { methods: testRequestsMethods } = require('./run/test-requests');
const { methods: resumeMethods, pausedError } = require('./run/resume');
const { methods: setupMethods } = require('./run/setup');

const stepAgentLabel = (s) => (s.agents ? s.agents.join(' · ') : s.agent || null);

// The machine steps whose output is all there is (no worktree processes, no supervisor): type → method.
// project_map (#372): the project map's facts, validation and save; refactor_proposals (#378): the
// Refactor proposals workflow's facts, proposals, ranking and filing; release_version (#325): never
// fails the run, the output says what was written; test_ids (#246): the missing test ids; check
// (#404): the project's rule checks (its command sweeps what it leaves running)
const PLAIN_MACHINE_STEPS = {
  check: 'runCheckStep',
  project_map: 'runProjectMapStep',
  refactor_proposals: 'runRefactorProposalsStep',
  release_version: 'runReleaseVersionStep',
  test_ids: 'runTestIdsStep',
};

function newRunId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomUUID().slice(0, 8)}`;
}

// #607: a recovered run keeps its own id; any other run gets a new one
function runIdFor(recover) {
  return recover?.runId || newRunId();
}

// The run's machine actions (#353): the given ones, else real() or simulated() by `mock`; one that does
// not match `mock` is refused (a real run never simulates, nor the reverse).
function runMachine(machine, mock, sequences) {
  const m = machine || (mock ? machineActions.simulated({ sequences }) : machineActions.real());
  if (m.simulated !== mock) {
    throw new Error(mock ? 'A simulated run cannot take the real machine actions.' : 'A real run cannot take the simulated machine actions.');
  }
  return m;
}

// The run's test workers (#367): { testWorkers } for a whole number from 1, else null (not set).
const runWorkers = (testWorkers) => (Number.isInteger(testWorkers) && testWorkers >= 1 ? { testWorkers } : null);
// A service hook given as an option (architectureOracle, refactorPriorityOptions): the function, else null
const functionOrNull = (f) => (typeof f === 'function' ? f : null);
// #396: the failures of the suite steps that ended red, with their class (in or outside the change)
const testedFailures = (steps) => Object.entries(steps)
  .filter(([, s]) => s?.output?.kind === 'suite' && s.output.status === 'fail')
  .flatMap(([id, s]) => (s.output.failures || []).map((f) => ({ step: id, test: f.test, file: f.file || '', class: f.class || null, class_reason: f.class_reason || null })));
// #396: summary.json's { tested, tested_failures } of a run that went on without a green suite (a
// transition's `set: { tested: "not green" }`: the owner's policy or Continue at the gate), else {}
const testedSummary = (ctx) => (ctx.vars?.tested ? { tested: ctx.vars.tested, tested_failures: testedFailures(ctx.steps) } : {});
// the gates the supervisor on call tries first: an escalation, or one an exhausted loop leads to;
// never a human_edit gate (#647), which only the person ends
const supervisedGate = (step, exhausted) => step.type === 'human_approval' && (step.kind === 'escalation' || !!exhausted);

class WorkflowRun extends EventEmitter {
  // budget: { [provider id]: { name, limitUsd, limitTokens, blockOnLimit, usedUsd, usedTokens } }
  // (this month's usage before this run, see packages/engine/domains/usage/usage.js); prices: USD per 1M tokens by model.
  // projectId: the project the run belongs to (recorded in workflow.started and summary.json).
  // issues: [{ number, url, title }] the run implements (Backlog screen; several when a group of issues
  //   goes as one run), recorded the same way. `issue` (one issue, the option before groups) is still accepted.
  // resume: { runId, fromStep, steps: { id: { output, visits } }, sessions: { agent: providerSessionId }, handoffs: { agent: note },
  //   instruction, worktree: { dir, branch } }
  //   starts at fromStep with the previous run's step outputs, agent conversations and handoff notes
  //   (packages/engine/domains/supervisor/supervisor.js resumeSpec), in the previous run's worktree.
  // worktreesDir: where orchestrator.worktree creates the run's git worktree (<workspace>/worktrees);
  //   without it (e.g. simulation runs) the agents work in the repository folder itself.
  // mockSequences: { field: [value per visit] } over the mock provider's defaults (tests).
  // notices: [{ level, message }] logged right after workflow.started (e.g. the workflow file came from a fallback folder).
  // stopProcesses: (dir) => Promise<[{ pid, exe, cwd, reason, stopped }]>, stops what agents left running in the
  //   worktree (packages/engine/engine/processes.js). Default: the real one, none for simulations (mock agents start nothing).
  // machine (#353): the run's machine actions (git, merges, ship, probes, actions, suites, screenshots, the
  //   provider of a turn), packages/engine/engine/machine-actions.js. Default: real(), or simulated({ sequences: mockSequences })
  //   for a mock run; one that does not match `mock` is refused (a real run never simulates, nor the reverse).
  // probe: ({ probe, target, cwd, signal, stepId, baseline }) => Promise<{ state, detail, fingerprint? }>, the
  //   check of a `wait:` step (packages/engine/engine/probes.js). Default: the machine's (simulations use MOCK_PROBES).
  // actionsQuota: (owner) => Promise<string | null>, the message when that GitHub account's Actions quota is
  //   exhausted (packages/engine/domains/usage/actions-usage.js), passed to the probe as `quota`: pr_checks then reports `quota_exhausted`.
  // peerSessions: () => [{ provider, model, tokens, costUsd, cliOnlyUsd }], the sessions of the other runs in progress (and of
  //   those that finished after `budget` was computed): the per-turn budget check counts them too (concurrent runs).
  // idleWarnMs: an agent silent this long while a tool call is open gets an `agent_idle` warning (packages/engine/engine/idle.js).
  //   Default 5 minutes; 0 disables it.
  // personas: [{ id, name, prompt, skills }] the user's agents (Agents menu), for `persona: random`.
  // attachments: { <input>: [path | { path, name }] } images attached to inputs (#129), checked here (refused
  //   before anything runs), copied into <run_dir>/attachments/<input>/ at start and given to every turn of a
  //   step whose prompt uses that input (stepAttachments). A resume passes the previous run's copies.
  // then: what happens with the run's result when it finishes (#134, apps/desktop/renderer/chain-model.js), recorded in
  //   workflow.started and summary.json; a gate choice with `then` or the owner (setThen) can change it while it runs.
  // from: { run_id, workflow, pipeline? } the run whose chain started this one (workflow.started.from,
  //   summary.from); `pipeline` when a saved pipeline's stage (#135, chain-model normalizePipeline).
  // parent: { run_id, workflow, step_id, index?, depth } the run whose `type: workflow` step started this one
  //   (#174), recorded as `parent_run` in workflow.started and summary.json.
  // startChild: ({ file, inputs, parent, label }) => Promise<{ runId, finished: Promise<{ status, outputs, error }>, stop }>,
  //   starts a child run for a `type: workflow` step (the service: a normal run, packages/engine/service/areas/runs.js).
  //   Default: startChildRun, a WorkflowRun of its own, emitted as 'child' (its events are the listener's to record).
  // agentOverrides (#262): { <agent>: { provider?, model?, effort? } } this run's choice for an agent (the Start
  //   drawer's "Agents"); the workflow's values are the defaults, '' or null clears an effort. Recorded in
  //   workflow.started `agents`; an agent the workflow does not have, or an undefined provider, is refused.
  // ownerCopy (#554): { agents: { <agent>: { provider?, model?, effort? } }, providers } the owner's edited
  //   workspace copy of the repository workflow this run takes: under agentOverrides, over the file's values;
  //   recorded as workflow.started `agents.<agent>.from`.
  // fallbacks (#262): { <provider>: ["<provider>:<model>", ...] } Settings' chains per provider, for an agent whose
  //   workflow declares no `fallbacks` (see fallbackChain).
  // accounts (#312): { <provider>: [{ name, dir, enabled }] } Settings' accounts per provider, in order (an
  //   account is a CLI config folder); accountCooldownMs: how long an account at its usage limit stays out
  //   when the message gives no reset time (default 1 h). See packages/engine/engine/run/accounts.js.
  // models (#262): { <model id>: { timeout_factor?, max_total_cost_usd? } } Settings' limits per model; the
  //   workflow's own `models` win per model (see modelLimits).
  // nightLimits (#337): () => tonight's limits ({ multiplier } | { values }) or null, called at each check
  //   (packages/engine/domains/night/night-limits.js tonightLimits; see effectiveLimits in packages/engine/engine/run/costs.js).
  // testWorkers (#367): the machine profile's test workers per run (packages/engine/domains/machine/machine-profile.js), given to
  //   the agents and the suite as MULTIAGENT_TEST_WORKERS / MULTIAGENT_E2E_WORKERS; null = not set.
  // architectureOracle (#381): () => { oracle, agent }, the service's Oracle ({ oneTurn, budgetRefusal }
  //   of packages/engine/domains/oracle/oracle.js) and its agent, for a `type: project_map` step's analyze action
  //   (packages/engine/engine/run/project-map-steps.js); null = no Oracle (a simulation needs none).
  // refactorPriorityOptions (#378): (projectId) => the Product Owner's turn options (refactor:prioritize's),
  //   for a `type: refactor_proposals` step's prioritize action (packages/engine/engine/run/refactor-proposals-steps.js);
  //   null = no Product Owner (a simulation needs none).
  // language (#327): () => the settings' language ({ agents, issues }) or null, called at each turn: every
  //   turn's [Language] line and the output instruction follow it (packages/shared/language.js); null = English.
  // recover (#607): { runId, events, worktree } a run the app died in, continued in its own folder with
  //   its own id at its last finished turn (packages/engine/engine/run/resume.js seedRecovery); not a resume
  constructor({ file, inputs, mock, runsDir, skillsDirs, budget, prices, projectId, issues, issue, resume, recover, worktreesDir, mockSequences, notices, stopProcesses, probe, actionsQuota, peerSessions, idleWarnMs, personas, localPreview, attachments, then, from, parent, startChild, memoryGuard, agentOverrides, ownerCopy, fallbacks, accounts, accountCooldownMs, models, nightLimits, testWorkers, machine, architectureOracle, refactorPriorityOptions, language, ignoreInstallScripts }) {
    super();
    refreshWindowsPath(); // actions (e.g. gh pr merge) need the refreshed PATH
    this.file = file;
    this.wf = loadWorkflow(file);
    this.mock = !!mock;
    this.language = functionOrNull(language);
    this.architectureOracle = functionOrNull(architectureOracle);
    this.refactorPriorityOptions = functionOrNull(refactorPriorityOptions);
    this.mockSequences = mockSequences || null;
    this.machine = runMachine(machine, this.mock, this.mockSequences);
    this.notices = notices || [];
    this.runId = runIdFor(recover);
    this.runDir = path.join(runsDir, this.runId);
    this.skillsDirs = [...(skillsDirs || []), BUNDLED_SKILLS];
    this.projectId = projectId || null;
    this.ignoreInstallScripts = !!ignoreInstallScripts; // #472: the cache install runs with --ignore-scripts
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
    // #276 (packages/engine/engine/memory-guard.js): stops a process of this run over the memory limit and holds
    // suites while memory is low; the app's guard for a real run (null when turned off), none for a
    // simulation unless one is given
    this.memoryGuard = memoryGuard !== undefined ? memoryGuard : this.mock ? null : sharedMemoryGuard();
    this.workers = runWorkers(testWorkers);
    this.memoryNotes = new Map(); // agent -> [what the guard stopped], told in its next prompt
    this.memoryStops = new Map(); // `${step}\n${command}` -> stops (the second one notifies the owner)
    this.probe = probe || ((args) => this.machine.probe(args));
    this.actionsQuota = actionsQuota || null;
    this.probeStats = {}; // step -> { polls, agent_calls, completed, errors } (summary.probes)
    this.budget = budget || {};
    this.prices = prices || {};
    this.budgetWarned = new Set();
    // #369: the models Claude Code did not know, warned once each
    this.unknownModelWarned = new Set();
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
    this.wholeSuiteRun = null; // #553: { round, commit } of the run's last whole suite (scope: affected), pass or fail
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
    this.applyOwnerCopy(ownerCopy);
    this.applyAgentOverrides(agentOverrides);
    // #262: Settings' fallback chains per provider and limits per model
    validateModels(models || undefined, 'Settings models');
    this.models = { ...(models || {}), ...(this.wf.models || {}) };
    this.providerFallbacks = fallbacks || {};
    this.fallbackAt = new Map(); // agent -> { chain, index } of its fallback chain (fallbackChain)
    this.setupAccounts(accounts, accountCooldownMs); // #312 (packages/engine/engine/run/accounts.js)
    // #337: tonight's limits, read at each check (effectiveLimits); the highest granted so far stays
    this.nightLimits = typeof nightLimits === 'function' ? nightLimits : null;
    this.grantedLimits = null;
    this.dropDisabledAgents();
    // #286: an effort the CLI never gets goes to the run's log at start, never silent
    for (const message of silentEfforts(this.wf)) this.notices.push({ level: 'warn', message });
    this.pickPersonas(personas || [], (resume || recover)?.personas);
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
    this.gateClock = { total: 0, since: null }; // ms with a gate open, not counted by max_total_duration (#416)
    this.preexisting = []; // [{ step, test, file, reason }] (notePreexistingFailures)
    this.stalls = []; // last stall signals [{ step, kind, detail, ts }] (recordStall), for the supervisor on call
    this.liveTurns = new Map(); // step id -> Set of stop(decision) of its running turns (a slow step's interrupt)
    this.exhausted = null; // { from, target, detail, refund } of the last transition to an on_exhausted target (noteExhausted)
    this.abort = new AbortController();
    // #368: { at } while the run pauses after the current turn (pause()); `paused` is where it
    // stopped once it did ({ step, next, at }: summary.paused, what Resume continues from)
    this.pausing = null;
    this.paused = null;
    this.lastFinished = null; // { step, visit } of the last step.finished (endOfError)
    this.childHandles = new Set(); // the handles of the child runs in progress (startChild), paused with this run
    this.liveCommand = null; // the step command in progress (a suite step's), named while the run pauses
    this.seq = 0;
    this.nSession = 0;
    this.nApproval = 0;
    this.seedRecovery(recover);
    this.status = 'pending';
  }

  emitEvent(type, data = {}) {
    const ev = { seq: ++this.seq, ts: new Date().toISOString(), run_id: this.runId, type, ...data };
    if (type !== 'session.stream') { this.recent.push(ev); if (this.recent.length > 300) this.recent.shift(); this.trail.apply(ev); }
    if (type === 'step.finished') this.lastFinished = { step: data.step_id, visit: data.visit }; // endOfError (#368)
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

  // The run's workflow.started and the files it stores at start. #607: a recovered run keeps its own
  // (its attachments are stored already; startRecovered records `run.recovered` instead).
  recordStart() {
    if (!this.recovered) this.storeInputAttachments();
    if (this.resumeImages?.length) this.gateImages = this.copyAttachments(this.resumeImages, `${this.resume.fromStep}-instruction`);
    if (this.recovered) return;
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
      // #607: a run the Backlog queue started; recovered, it still pauses the queue when it fails (#445)
      from_queue: this.fromQueue || undefined,
      parent_run: this.parent || undefined,
      personas: Object.keys(this.personas).length ? this.personas : undefined,
      agent_names: this.agentNames(),
      // #262: what each agent runs on in this run, its overrides applied; the overrides themselves
      // (what differs from the workflow), which a resume of this run applies again
      agents: Object.fromEntries(Object.entries(this.wf.agents).map(([k, a]) => [k, { provider: a.provider, model: a.model, effort: a.effort || null, ...(this.ownerAgents?.[k] ? { from: this.agentOverrides[k] ? 'this run, over the workspace copy (your models)' : 'workspace copy (your models)' } : {}) }])),
      agent_overrides: Object.keys(this.agentOverrides).length ? this.agentOverrides : undefined,
      display: this.displayNames(),
      steps: this.wf.steps.map((s) => ({ id: s.id, type: s.type || 'agent', agent: stepAgentLabel(s) })),
      groups: this.wf.groups,
    });
  }

  async start() {
    // #607: a recovered run keeps its start
    this.startedAt = this.recovered?.startedAt || Date.now();
    this.status = 'running';
    this.recordStart();
    for (const n of this.notices) this.emitEvent('log', { level: n.level || 'info', message: n.message });
    this.orchestrator = this.openSession({
      agent: 'orchestrator', provider: 'engine', model: 'engine (deterministic)', parentId: null, stepId: null,
    });
    this.setStatus(this.orchestrator, 'active');
    if (this.recovered) this.startRecovered();

    // a recovered run that had nothing left to run ends where it was
    let current = this.recovered ? this.recovered.nextStep || 'end' : this.resume?.fromStep || this.wf.steps[0].id;
    let guard = 0;
    let status = 'success';
    let error = null;
    try {
      await this.setupWorktree();
      await this.startResumed();
      while (current !== 'end') {
        if (current === 'fail') throw new Error('Workflow routed to "fail" (retry limit reached).');
        if (++guard > 500) throw new Error('Limit of 500 transitions reached.');
        if (this.abort.signal.aborted) throw new Error('Cancelled');
        // #368: paused after the current turn: no step starts; Resume continues at `current`
        if (this.pausing) throw pausedError();
        this.checkLimits();
        this.stepRunning = current;
        current = await this.runStep(this.stepById(current));
        this.stepRunning = null;
      }
      // `goto: end` + `status: failed|cancelled` (e.g. a rejected gate): not a success
      if (this.endStatus) {
        status = this.endStatus.status;
        error = new Error(this.endStatus.message);
      }
    } catch (e) {
      ({ status, error } = this.endOfError(e, current));
    }
    await this.stopWorktreeProcesses('run end');
    await this.finishWorktree(status);
    this.finish(status, error);
  }

  stop() {
    this.abort.abort();
    for (const a of this.approvals.values()) a.reject(new Error('Cancelled'));
  }

  // How an error ends the run at step `current`: cancelled (stopped), paused (#368: Resume continues
  // at `current`; a visit the pause ended unfinished, a gate left unanswered, is not counted) or failed.
  endOfError(e, current) {
    if (this.abort.signal.aborted) return { status: 'cancelled', error: e };
    if (!e.paused) return { status: 'failed', error: e };
    if (this.pausing) this.pausing.final = true; // ending now: Cancel pause no longer applies
    const st = this.ctx.steps[current];
    // a gate after step.finished (a stall check) leaves its visit counted: it has its output
    const finished = this.lastFinished?.step === current && this.lastFinished.visit === st?.visits;
    if (this.stepRunning === current && st?.visits && !finished) st.visits--;
    this.paused = { step: current, next: this.nextTurnOf(current), at: new Date().toISOString() };
    return { status: 'paused', error: null };
  }

  // An error that ends the run rather than the step (no supervisor, no on_error): a stop or a pause (#368).
  endsRun(e) {
    return this.abort.signal.aborted || !!e?.paused;
  }

  // #368: pause after the current turn. The turns in progress (every agent of a parallel step), a
  // step command in progress and the child runs (paused too) finish, never cut; no step starts after
  // them and the run ends `paused`, its worktree, branch, outputs and sessions kept. A gate waiting
  // for the owner is left unanswered: the run ends at once and Resume asks it again.
  pause() {
    if (!['pending', 'running'].includes(this.status) || this.abort.signal.aborted) throw new Error(`The run is ${this.abort.signal.aborted ? 'stopping' : this.status}: there is nothing to pause.`);
    if (!this.pausing) {
      this.pausing = { at: new Date().toISOString() };
      const p = this.pauseState();
      this.emitEvent('run.pausing', { step_id: p.step, ...(p.agents ? { agents: p.agents } : {}), ...(p.command ? { command: p.command } : {}) });
    }
    for (const h of this.childHandles) { try { h.pause?.(); } catch { /* ending */ } }
    // a gate left unanswered ends the run at once: past that, the pause cannot be taken back
    if (this.approvals.size) this.pausing.final = true;
    for (const a of this.approvals.values()) a.reject(pausedError());
    return true;
  }

  // Takes a pause back while the run still waits for its turns: it goes on as if never asked
  // (false: not pausing, or already ending, its gate left unanswered).
  cancelPause() {
    if (!this.pausing || this.pausing.final || !['pending', 'running'].includes(this.status)) return false;
    this.pausing = null;
    for (const h of this.childHandles) { try { h.cancelPause?.(); } catch { /* ended */ } }
    this.emitEvent('run.pause_cancelled', { step_id: this.prevStepId || null });
    return true;
  }

  // What runs:active shows of a pause in progress: { state: 'pausing', step, agents?, command?, at }
  // (agents: those whose turn is under way; command: the step command it waits for), else null.
  pauseState() {
    if (!this.pausing) return null;
    const names = this.displayNames().agents;
    const agents = [...this.sessions.values()]
      .filter((s) => s.id !== 'orchestrator' && !s.closedAt && ['active', 'retrying'].includes(s.status))
      .map((s) => names[s.agent] || s.agent);
    return {
      state: 'pausing', step: this.prevStepId || this.resume?.fromStep || this.wf.steps[0].id, at: this.pausing.at,
      ...(agents.length ? { agents: [...new Set(agents)] } : {}),
      ...(this.liveCommand ? { command: this.liveCommand } : {}),
    };
  }

  // Whose turn comes first at `stepId` (summary.paused.next): its agents, the owner at a gate, else the step's kind.
  nextTurnOf(stepId) {
    const step = this.wf.steps.find((s) => s.id === stepId);
    if (!step) return null;
    if (GATE.includes(step.type)) return 'Owner';
    const names = this.displayNames().agents;
    const agents = step.agents || (step.agent ? [step.agent] : []);
    if (agents.length && !MACHINE_STEP_TYPES.includes(step.type)) return agents.map((a) => names[a] || a).join(' and ');
    return step.type === 'suite' ? 'the suite command' : this.displayNames().steps[step.id] || step.id;
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
    if (GATE.includes(step.type)) {
      // `kind: escalation`, or any gate an exhausted loop leads to: the supervisor on call tries to
      // solve the problem before the person is asked; when it cannot, the gate opens with its
      // diagnosis. A decision gate stays the person's: the supervisor may only send the run back.
      // A human_edit gate (#647) is the person's alone: their requests go to its agent (requestEdit).
      const oc = supervisedGate(step, exhausted) ? await this.superviseEscalation(step, st, t0, { decision: step.kind !== 'escalation' }) : null;
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
        output = await this.withLiveCommand(`the screenshots of ${step.id}`, () => this.runScreenshots(step, st));
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
    } else if (PLAIN_MACHINE_STEPS[step.type]) {
      // no agent, no model call: the output is the step's result, the transitions route it
      output = await this[PLAIN_MACHINE_STEPS[step.type]](step, st);
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
        if (this.endsRun(e)) throw e;
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
      // #567: the agent asked the owner (needs_human): the step runs again with the answer, no transition yet
      const asked = await this.agentQuestion(step, st, output, t0);
      if (asked) return asked;
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
    // a pause that answered a context-limit gate before one agent's turn (#368): the step runs again on Resume
    const paused = settled.find((r) => r.status === 'rejected' && r.reason?.paused);
    if (paused) throw /** @type {PromiseRejectedResult} */ (paused).reason;
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
    const schema = stepOutputSchema(step, agentName);
    // evidence_dir: where this visit's screenshots go (#146), <run_dir>/evidence/<step>/round-<visit>
    const scope = { ...this.ctx, iteration: st.iteration, delegate_result: st.delegate_result, agent: agentName, evidence_dir: evidence.roundDir(this.runDir, step.id, visit) };
    // `test_map: true` (#219): the code → tests map of the agent's checkout, as {{ test_map }}
    if (step.test_map) scope.test_map = this.writeTestMap(agentName);
    // #567: the answer to the question of its previous turn (agentQuestion), as {{ human_answer }}
    if (step.ask_human) scope.human_answer = st.humanAnswer || null;
    let prompt = render(step.prompt, scope).trim();
    if (st.supervisorNote) {
      prompt += `\n\n---\nNote from the run supervisor (a previous attempt of this step failed):\n${st.supervisorNote}`;
      if (!step.agents) st.supervisorNote = null;
    }
    if (st.humanAnswer) {
      prompt += this.humanAnswerNote(st.humanAnswer);
      st.humanAnswer = null;
    }
    // #607: this agent's turn of the step was cut by the app's crash: what it did, as a retry gets it
    if (st.lostTurns?.[agentName]) {
      prompt += `\n\n---\n${st.lostTurns[agentName]}`;
      delete st.lostTurns[agentName];
    }
    if (this.restoredWorkNote) {
      prompt += `\n\n---\n${this.restoredWorkNote}`;
      if (!step.agents) this.restoredWorkNote = null;
    }
    // #403: a suite round rebased the branch onto the moved base: the next single-agent turn is told
    // (a fan-out, e.g. reviewers, sees it and leaves it for that turn)
    if (this.baseSyncNote) {
      prompt += `\n\n---\n${this.baseSyncNote}`;
      if (!step.agents) this.baseSyncNote = null;
    }
    if (!step.agents) st.delegate_result = null; // consumed (in a fan-out, after all of them)
    // step skills go in the prompt itself; the name can be a template ("{{ inputs.document_skill }}")
    const skills = this.loadSkills(this.skillNames(step.skills || [], scope));
    if (skills.length) prompt = `${skills.map((sk) => skillPrompt(sk, agentName)).join('\n\n')}\n\n${prompt}`;
    const extra = goalLoopInstructions(step, st, this.ctx);
    st.probeNews = null; // consumed
    if (extra) prompt += '\n\n---\n' + extra;
    if (schema) {
      prompt += '\n\n---\nAt the end of your response you MUST include a ```json block with an object that validates against this JSON Schema:\n```json\n'
        + JSON.stringify(schema, null, 2) + '\n```\n'
        + Language.outputInstruction(this.agentsLanguageCode());
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
      let out;
      try {
        out = extractJson(res.text);
        errs = validateSchema(out, schema);
      } catch (e) {
        errs = [e.message];
      }
      if (!errs.length) {
        // outside the try: a refused save_as (#473) fails the step, it is not an invalid output to retry
        this.saveOutput(step, scope, JSON.stringify(out, null, 2), out);
        return out;
      }
      this.emitEvent('log', { level: 'warn', kind: 'invalid_output', step_id: step.id, message: `Invalid output in ${step.id}${step.agents ? ` (${agentName})` : ''}: ${errs.join('; ')}` });
      if (attempt >= 2) throw new Error(`Output of step "${step.id}" failed validation: ${errs.join('; ')}`);
      if (this.pausing) throw pausedError(); // #368: no retry turn; Resume runs the visit again
      res =await this.sendToAgent(agentName, this.retryPrompt(agentName, prompt, res.text, schema, errs), { ...opts, retry: true });
      countTools(res);
      st.lastAnswer = res.text;
    }
  }

  // The default startChild (the CLI, engine tests): a WorkflowRun of its own in the same runs folder,
  // with this run's settings, emitted as 'child' before it starts (record its events, answer its gates).
  // The child's workflow file: next to this run's, else the bundled one. A resumed run reuses a child
  // of its previous run that succeeded (`previous`, #175); any other child starts afresh (resuming a
  // child from where it stopped is the service's, packages/engine/service/areas/runs.js).
  async startChildRun({ file, inputs, parent, label, previous }) {
    if (previous?.run_id) {
      let summary = null;
      try { summary = JSON.parse(fs.readFileSync(path.join(this.ctx.runs_dir, path.basename(previous.run_id), 'summary.json'), 'utf8')); } catch { /* not finished */ }
      if (summary?.status === 'success') {
        return { runId: summary.run_id || path.basename(previous.run_id), reused: true, stop: () => {}, finished: Promise.resolve({ status: 'success', outputs: summary.outputs || {}, error: null, cost_usd: childRunCost(summary) }) };
      }
    }
    const bundled = bundledDir('workflows');
    const dirs = [path.dirname(path.resolve(this.file)), bundled];
    const found = path.isAbsolute(file) ? file : dirs.map((d) => path.join(d, file)).find((f) => fs.existsSync(f));
    if (!found) throw new Error(`Workflow not found: "${file}" (searched in ${dirs.join(', ')})`);
    const child = new WorkflowRun({
      file: found, inputs, mock: this.mock, runsDir: this.ctx.runs_dir, skillsDirs: this.skillsDirs.filter((d) => d !== BUNDLED_SKILLS),
      budget: this.budget, prices: this.prices, projectId: this.projectId, worktreesDir: this.worktreesDir, parent,
      accounts: this.providerAccounts, accountCooldownMs: this.accountCooldownMs,
      ...(this.stopProcesses === null ? { stopProcesses: null } : {}), idleWarnMs: this.idleWarnMs, testWorkers: this.workers?.testWorkers,
      notices: [{ level: 'info', message: `Child run of ${this.runId} (step ${parent.step_id}${label ? `, ${label}` : ''}).` }],
    });
    const finished = new Promise((resolve) => child.on('event', (ev) => {
      if (ev.type === 'workflow.finished') resolve({ status: ev.status, outputs: ev.outputs || {}, error: ev.error, cost_usd: childRunCost(ev.summary) });
    }));
    this.children.set(child.runId, child);
    this.emit('child', child);
    child.start();
    return { runId: child.runId, finished, stop: () => child.stop(), pause: () => child.pause(), cancelPause: () => child.cancelPause() };
  }

  finish(status, err) {
    this.status = status;
    for (const a of this.approvals.values()) a.reject(new Error('Finished'));
    this.approvals.clear();
    for (const s of this.sessions.values()) {
      // the session status reflects the session itself, not the workflow outcome
      if (!s.closedAt) this.closeSession(s, s.status === 'error' ? 'failed' : status === 'cancelled' ? 'cancelled' : s.id === 'orchestrator' ? status : 'success');
    }
    // #368: where a paused run stopped and whose turn is next (Resume continues there), else {}
    const paused = this.pausedRecord(status);
    const sessions = [...this.sessions.values()].map((s) => this.snapshot(s));
    const tokens = emptyUsage();
    sessions.forEach((s) => addUsage(tokens, s.tokens));
    const outputs = this.computeOutputs();
    const summary = {
      run_id: this.runId, workflow: this.wf.metadata?.name, project_id: this.projectId, issues: this.issues || undefined, status,
      started_at: new Date(this.startedAt).toISOString(), finished_at: new Date().toISOString(),
      duration_ms: Date.now() - this.startedAt, inputs: this.inputs, mock: this.mock, worktree: this.worktreeSummary(),
      ...paused,
      // `merge: local`: what landed on the local base, not pushed (Backlog: "Local" column, Push)
      local_merge: this.ctx.local_merge ? { branch: this.ctx.local_merge.branch, base: this.ctx.local_merge.base, commit: this.ctx.local_merge.commit } : null,
      // `ship:` (#260): the release the owner shipped ({ tag, base, commit, pushed, issues }; `simulated` in a simulation)
      ...(this.ctx.release ? { release: this.ctx.release } : {}),
      tokens, cost_usd: +sessions.reduce((a, s) => a + s.cost_usd, 0).toFixed(6), cost_accounting: 'per_turn',
      // #277: a multi-result Claude turn records its highest total (packages/shared/run-record.js upgrades older runs on read)
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
      // #396: a run that went on without a green suite, with the red suite steps' failures and their class
      ...testedSummary(this.ctx),
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
      ...paused,
      // the declared outputs (#134) and the chain, for what starts next
      ...(outputs ? { outputs } : {}),
      ...(this.then ? { then: this.then } : {}),
      summary,
    });
  }
}

// The areas' methods join the class here (#250): defined like class methods (not enumerable), so
// tests can still patch an instance's method and `Object.create(WorkflowRun.prototype)` keeps working.
// A name two modules (or a module and this class) both define is a mistake, not an override.
const mixin = (proto, ...sets) => {
  for (const set of sets) {
    for (const [name, fn] of Object.entries(set)) {
      if (Object.hasOwn(proto, name)) throw new Error(`WorkflowRun.${name} is defined twice (packages/engine/engine/run/)`);
      Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true, enumerable: false });
    }
  }
};
mixin(
  WorkflowRun.prototype,
  outputsMethods,
  transitionsMethods,
  gatesMethods,
  sessionsMethods,
  turnsMethods,
  accountsMethods,
  costsMethods,
  supervisionMethods,
  checkoutMethods,
  machineStepsMethods,
  projectMapStepsMethods,
  refactorProposalsStepsMethods,
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
  stepOutputSchema,
  takeHandoff,
  validateSchema,
  WorkflowRun,
};
