// Runs: start, stop, the runs in progress (with the gates they wait at), the runs on disk, a run's
// events, answering a gate and resuming a run from a step. Several runs can be in progress (Settings ›
// Execution › Concurrent runs): the channels that act on one take its runId.

const fs = require('fs');
const runs = require('../../domains/run/runs');
const projects = require('../../domains/project/projects');
const { loadWorkflow } = require('../../engine/workflow');
const { resolveRunInputs } = require('../../domains/project/project-run-defaults');
const { runDefaultsNow } = require('../seed-runs');
const {
  clientError,
  requireId,
  requireObject,
  requireText,
} = require('../common');
const {
  ANY,
  args,
  BASE_CHOICE,
  BOOL,
  FLAG,
  GATE_ID,
  IMAGES,
  ISSUE_REF,
  listOf,
  nullable,
  NUMBER,
  OBJECT,
  orNone,
  PROJECT_ID,
  RUN_ID,
  shape,
  STARTED,
  STARTED_OR_KEPT,
  STEP_ID,
  STRING,
  text,
  WORKFLOW_FILE,
} = require('../schemas');

// #795: the last `bytes` (8 KB by default, 64 KB at most) of a log file, from its first whole line
const TAIL_BYTES = 8192;
function logTail(file, bytes) {
  const want = Math.min(Math.max(Number(bytes) || TAIL_BYTES, 256), 65536);
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return { text: '', size: 0 }; }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - want);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    return { text: start > 0 ? text.slice(text.indexOf('\n') + 1) : text, size };
  } finally { fs.closeSync(fd); }
}

// a run's title as the lists show it (run-meta setRunTitle, pushed on run:meta)
const TITLE = shape({ runId: RUN_ID, title: STRING, customTitle: ANY }, ['runId']);

// The run in progress in this process that `opts.runId` names, for `what` (run:pause, #368).
// (optional: null for a run that is not in progress, run:stop's answer)
function liveRunOf(ctx, opts, what, optional = false) {
  const runId = requireId(opts?.runId, 'runId');
  const run = ctx.liveRun(runId);
  if (run) return run;
  if (ctx.runAlive(runId)) throw new Error(`Run ${runId} runs in another app window: ${what} it there.`);
  if (optional) return null;
  throw clientError(`Run ${runId} is not in progress: there is nothing to ${what}.`);
}

// A gate of run `runId` answered before (#603): { already_answered, answered_at } from its
// approval.resolved event (the run going on or ended), else false
function answeredBefore(ctx, runId, id) {
  let events;
  try { events = runs.runEvents(ctx.runFolder(runId)); } catch { return false; }
  const ev = events.find((e) => e.type === 'approval.resolved' && e.approval_id === id);
  return ev ? { already_answered: true, answered_at: ev.ts } : false;
}

// #735: the dialog's inputs over the project's run defaults (resolveRunInputs: typed > project), the
// workflow's own defaults left to the engine; the inputs unchanged without a project or a workflow.
// Synchronous (runDefaultsNow): run:start reserves its run before it returns (prepareRestart); #805: only a
// local run looks at its base first, and a restart meanwhile loses a start, never a run.
function withProjectDefaults(ctx, { file, inputs, projectId }) {
  if (!projectId) return inputs;
  let project = null;
  let wf = null;
  try {
    project = projects.readProject(ctx.ws.projects, projectId);
    wf = loadWorkflow(ctx.projectWorkflowFile(projectId, file));
  } catch { return inputs; }
  if (!project?.folder || !wf?.inputs) return inputs;
  const typed = Object.fromEntries(Object.entries(inputs || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const { values, sources } = resolveRunInputs({ typed, project: runDefaultsNow(ctx, project), workflow: { inputs: wf.inputs } });
  const out = { ...inputs };
  for (const [k, v] of Object.entries(values)) if (sources[k] === 'project') out[k] = v;
  return out;
}

module.exports = (ctx) => [
  {
    channel: 'run:start',
    method: 'startRun',
    params: 'payload',
    schema: {
      params: args({
        file: WORKFLOW_FILE,
        inputs: nullable(OBJECT),
        mock: FLAG,
        mockSequences: ANY,
        projectId: orNone(PROJECT_ID),
        issues: nullable(listOf(ISSUE_REF)),
        confirmed: FLAG,
        attachments: nullable(OBJECT),
        then: ANY,
        agentOverrides: nullable(OBJECT),
        workspace: FLAG,
        baseChoice: BASE_CHOICE,
      }),
      result: STARTED_OR_KEPT,
    },
    // workspace: the workspace's workflow of that name even when the project's repository declares
    // its own (#485: the Start drawer lists the workspace's workflows).
    // projectId/issues: a run started from a Backlog issue (Write & Review's "Enrich"), recorded in workflow.started.
    // When an ended run of those issues kept a worktree with commits, the answer is the kept-work
    // question { confirm, kept, runId } (that run can be resumed instead) until `confirmed` (#112, #170).
    // attachments: { <input>: [path | { path, name }] } images attached to inputs (#129, WorkflowRun).
    // then: what happens with the run's result when it finishes (#134, chain-model normalizeThen).
    // agentOverrides: { <agent>: { provider?, model?, effort? } } this run's choice per agent (#262, WorkflowRun).
    // #735: an input the dialog left empty takes the project's run default (an empty ui_folders of a
    // backend project included) before the workflow's own (withProjectDefaults).
    // #805 baseChoice: a local run whose base is behind origin or diverged answers the question
    // { confirm, baseCheck } and starts nothing until it says 'update' or 'continue' (areas/local-push.js); a run
    // that went on from such a base answers its baseCheck too, for the screens that do not ask.
    fn: (payload) => {
      const { file, inputs, mock, mockSequences, projectId, issues, confirmed, attachments, then, agentOverrides, workspace, baseChoice } = requireObject(payload, 'run options');
      const list = Array.isArray(issues) && issues.length
        ? issues.map((i) => ({ number: Number(i.number), url: String(i.url || ''), title: String(i.title || '') }))
        : undefined;
      const kept = list && !confirmed ? ctx.keptWorkForIssues(list) : null;
      if (kept) return { confirm: kept.text, kept, runId: kept.runId };
      const resolved = withProjectDefaults(ctx, { file, inputs, projectId });
      const start = (notices) => ctx.startWorkflowRun({ file, inputs: resolved, mock, mockSequences, projectId: projectId || undefined, issues: list, allowKeptWork: true, attachments, then, agentOverrides, workspaceWorkflow: !!workspace, notices });
      const target = ctx.localRunTarget({ file, inputs: resolved, projectId: projectId || null, workspaceWorkflow: !!workspace });
      if (!target) return start([]);
      return ctx.prepareLocalBase({ target, choice: baseChoice || null, ask: true, mock: !!mock }).then(async (base) => {
        if (base.confirm) return base;
        const started = await start(base.notices);
        return base.baseCheck ? { ...started, baseCheck: base.baseCheck } : started;
      });
    },
  },
  // runId: the run to stop (without it, the only run in progress)
  {
    channel: 'run:stop',
    method: 'stopRun',
    params: ['runId'],
    schema: { params: args({ runId: RUN_ID }), result: BOOL },
    fn: (opts) => {
      const run = opts?.runId ? liveRunOf(ctx, opts, 'stop', true) : ctx.liveRun(null);
      if (!run && !opts?.runId && ctx.active.size > 1) throw new Error('Several runs are in progress: say which one to stop.');
      run?.stop();
      return !!run;
    },
  },
  // #368: pause the run after the current turn (WorkflowRun#pause): its turns and step command
  // finish, nothing new starts, it ends `paused`; a run at a gate pauses at once, the gate unanswered
  {
    channel: 'run:pause',
    method: 'pauseRun',
    params: ['runId'],
    schema: { params: args({ runId: RUN_ID }), result: BOOL },
    fn: (opts) => liveRunOf(ctx, opts, 'pause').pause(),
  },
  // #368: take a pause back while the run waits for its turns: it goes on (false: nothing to cancel)
  {
    channel: 'run:cancel-pause',
    method: 'cancelPauseRun',
    params: ['runId'],
    schema: { params: args({ runId: RUN_ID }), result: BOOL },
    fn: (opts) => liveRunOf(ctx, opts, 'cancel the pause of').cancelPause(),
  },
  // each run with its pending gates: the source of truth of "waiting for you" in every view
  { channel: 'runs:active', method: 'listActiveRuns', schema: { result: listOf(OBJECT) }, fn: () => ctx.activeRuns() },
  // opts (#200): { offset, limit, filter, showSim, q, upTo } for one page, or { ids } for just those rows
  {
    channel: 'runs:list',
    method: 'listRuns',
    params: ['...opts'],
    schema: {
      params: args({ offset: NUMBER, limit: NUMBER, filter: ANY, showSim: FLAG, q: nullable(text(1000)), upTo: ANY, ids: listOf(RUN_ID) }),
      result: OBJECT,
    },
    fn: (opts) => ctx.listAllRuns(opts || {}),
  },
  // activity: also the agents' tool calls and thinking, compacted (the run chat shows them)
  {
    channel: 'runs:events',
    method: 'runEvents',
    params: ['runId', '...opts'],
    schema: { params: args({ runId: RUN_ID, activity: FLAG }, ['runId']), result: listOf(OBJECT) },
    fn: ({ runId, activity }) => runs.runEvents(ctx.runFolder(requireId(runId, 'run id')), { activity: !!activity }),
  },
  // #795: the end of a deterministic step's log (`path` relative to the run, only under its logs/), for
  // the run chat's orchestrator message: { text, size }; a log not written yet gives ''
  {
    channel: 'runs:logTail',
    method: 'runLogTail',
    params: ['runId', 'path', '...opts'],
    schema: { params: args({ runId: RUN_ID, path: text(500), bytes: NUMBER }, ['runId', 'path']), result: shape({ text: STRING, size: NUMBER }) },
    fn: ({ runId, path: rel, bytes }) => logTail(ctx.logTarget({ runId: requireId(runId, 'run id'), logPath: rel }).file, bytes),
  },
  // the run's scratch workspace (#201: not artifacts, shown on the Run screen while it exists):
  // { dir, files, bytes } or null
  {
    channel: 'runs:scratch',
    method: 'runScratch',
    params: ['runId'],
    schema: { params: args({ runId: RUN_ID }, ['runId']), result: nullable(shape({ dir: STRING, files: ANY, bytes: NUMBER })) },
    fn: ({ runId }) => runs.runScratch(ctx.runFolder(runId)),
  },
  // answer: true/false or the id of a choice; feedback: the optional text typed at the gate;
  // intent: 'save_to_issue' for "Accept and save to issue #n" (#125).
  // Gate ids are per run (a1, a2…): runId says which run (without it, the only run waiting on that id).
  // #333: a human gate opens only to the owner's answer: a run id given as null or '' is refused (never
  // "the only run waiting"), and so is an answer the gate does not offer: true/false on a gate
  // without choices, one of its choice ids on a gate with choices.
  // #603: a gate of that run answered before answers { already_answered: true, answered_at } (a
  // window that missed the push says so); a gate the run never asked, false.
  {
    channel: 'approval:resolve',
    method: 'resolveApproval',
    // images: pictures attached to the feedback (#129), given to the next agent step
    params: ['id', 'answer', 'feedback', 'runId', 'intent', 'images'],
    schema: {
      // answer: checked against the gate's own choices by the channel (its message names them)
      params: args({ id: GATE_ID, answer: ANY, feedback: nullable(STRING), runId: RUN_ID, intent: nullable(STRING), images: nullable(IMAGES) }, ['id']),
      result: ANY,
    },
    fn: ({ runId, id, answer, feedback, intent, images }) => {
      if (runId !== undefined) requireId(runId, 'run id');
      const waiting = [...ctx.active.values()].filter((r) => r.approvals.has(id));
      const run = runId ? ctx.active.get(runId) : waiting.length === 1 ? waiting[0] : null;
      const gate = run?.approvals.get(id)?.gate;
      if (!gate) return runId ? answeredBefore(ctx, runId, id) : false;
      const offered = gate.choices
        ? typeof answer === 'string' && gate.choices.some((c) => c.id === answer)
        : typeof answer === 'boolean';
      if (!offered) throw clientError(`Invalid answer for gate ${id}: ${gate.choices ? 'one of its choices' : 'true or false'}.`);
      return run.resolveApproval(id, answer, 'user', feedback, intent || null, Array.isArray(images) ? images : []);
    },
  },
  // #647: the owner's edit request at an open human_edit gate (write-doc's editor): one turn of the
  // gate's agent with the text (and pasted images); the gate stays open, answers the turn's result
  {
    channel: 'run:request-edit',
    method: 'requestEdit',
    params: ['runId', 'id', 'text', 'images'],
    schema: {
      params: args({ runId: RUN_ID, id: GATE_ID, text: STRING, images: nullable(IMAGES) }, ['runId', 'id', 'text']),
      result: ANY,
    },
    fn: ({ runId, id, text, images }) => {
      const run = ctx.active.get(requireId(runId, 'run id'));
      if (!run?.approvals.has(id)) throw clientError(`No open gate ${id} in run ${runId}.`);
      return run.requestEdit(id, requireText(text, 'request'), { images: Array.isArray(images) ? images : [] });
    },
  },
  // resume a run from a step (a new run, no supervisor call) and what the dialog offers;
  // confirmGate: the decided gate the owner approves again in the dialog (#112)
  // images: pictures pasted into the instruction (#130), given to the first resumed agent step
  // inputs: the inputs that change for the new run, over the ones the run recorded (#799)
  {
    channel: 'runs:resume',
    method: 'resumeRun',
    params: ['runId', 'step', 'instruction', 'mock', 'confirmGate', 'images', 'inputs'],
    schema: {
      params: args({ runId: RUN_ID, step: nullable(STEP_ID), instruction: nullable(STRING), mock: FLAG, confirmGate: ANY, images: nullable(IMAGES), inputs: nullable(OBJECT) }, ['runId']),
      result: STARTED,
    },
    fn: (opts) => ctx.resumeRun(opts),
  },
  {
    channel: 'runs:resumeOptions',
    method: 'resumeOptions',
    params: ['runId'],
    schema: { params: args({ runId: RUN_ID }, ['runId']), result: OBJECT },
    fn: (opts) => ctx.resumeOptions(opts),
  },
  // the PR a run opened, with its state read with gh/glab (cached), and the owner's title of a run (#84)
  {
    channel: 'runs:prState',
    method: 'runPrState',
    params: ['runId'],
    schema: { params: args({ runId: RUN_ID }, ['runId']), result: nullable(OBJECT) },
    fn: (opts) => ctx.runPrState(opts),
  },
  // #810: merge a live run's PR from its PR monitor card (a merge commit; admin: "merge ignoring protection",
  // only with that permission): read again first, refused when blocked → { merged, commit?, error?, blockers? }
  {
    channel: 'runs:mergePr',
    method: 'mergeRunPr',
    params: ['runId', 'admin'],
    schema: { params: args({ runId: RUN_ID, admin: FLAG }, ['runId']), result: OBJECT },
    fn: (opts) => {
      liveRunOf(ctx, opts, 'merge its pull request');
      return ctx.mergeRunPr(opts);
    },
  },
  // #810: close a live run's PR without merging (after the card's confirmation): the run ends failed → { closed, error? }
  {
    channel: 'runs:closePr',
    method: 'closeRunPr',
    params: ['runId'],
    schema: { params: args({ runId: RUN_ID }, ['runId']), result: OBJECT },
    fn: (opts) => {
      liveRunOf(ctx, opts, 'close its pull request');
      return ctx.closeRunPr(opts);
    },
  },
  // #811: ask the developer for a fix from the PR monitor's card: the requests the owner picked (ids of the card's
  // requests; only trusted authors' are sent) and a note → { queued, round?, error?, refused? }
  {
    channel: 'runs:askFix',
    method: 'askRunPrFix',
    params: ['runId', 'ids', 'note'],
    schema: { params: args({ runId: RUN_ID, ids: listOf(text(200)), note: nullable(text(4000)) }, ['runId']), result: OBJECT },
    fn: (opts) => {
      liveRunOf(ctx, opts, 'ask a fix for its pull request');
      return ctx.askRunPrFix(opts);
    },
  },
  // title: empty (or none) goes back to the default title
  {
    channel: 'runs:setTitle',
    method: 'setRunTitle',
    params: ['runId', 'title'],
    schema: { params: args({ runId: RUN_ID, title: { type: 'string', maxLength: 200 } }, ['runId']), result: TITLE },
    fn: (opts) => ctx.setRunTitle(opts),
  },
  { event: 'run:event', method: 'onEvent' },
  // a run's PR state or title changed: { runId, pr } or { runId, title, customTitle }
  { event: 'run:meta', method: 'onRunMeta' },
];
