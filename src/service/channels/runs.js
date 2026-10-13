// Runs: start, stop, the runs in progress (with the gates they wait at), the runs on disk, a run's
// events, answering a gate and resuming a run from a step. Several runs can be in progress (Settings ›
// Execution › Concurrent runs): the channels that act on one take its runId.

const runs = require('../../runs');
const {
  clientError,
  requireId,
  requireObject,
} = require('../common');
const {
  ANY,
  args,
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

// a run's title as the lists show it (run-meta setRunTitle, pushed on run:meta)
const TITLE = shape({ runId: RUN_ID, title: STRING, customTitle: ANY }, ['runId']);

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
      }),
      result: STARTED_OR_KEPT,
    },
    // projectId/issues: a run started from a Backlog issue (Write & Review's "Enrich"), recorded in workflow.started.
    // When an ended run of those issues kept a worktree with commits, the answer is the kept-work
    // question { confirm, kept, runId } (that run can be resumed instead) until `confirmed` (#112, #170).
    // attachments: { <input>: [path | { path, name }] } images attached to inputs (#129, WorkflowRun).
    // then: what happens with the run's result when it finishes (#134, chain-model normalizeThen).
    // agentOverrides: { <agent>: { provider?, model?, effort? } } this run's choice per agent (#262, WorkflowRun).
    fn: (payload) => {
      const { file, inputs, mock, mockSequences, projectId, issues, confirmed, attachments, then, agentOverrides } = requireObject(payload, 'run options');
      const list = Array.isArray(issues) && issues.length
        ? issues.map((i) => ({ number: Number(i.number), url: String(i.url || ''), title: String(i.title || '') }))
        : undefined;
      const kept = list && !confirmed ? ctx.keptWorkForIssues(list) : null;
      if (kept) return { confirm: kept.text, kept, runId: kept.runId };
      return ctx.startWorkflowRun({ file, inputs, mock, mockSequences, projectId: projectId || undefined, issues: list, allowKeptWork: true, attachments, then, agentOverrides });
    },
  },
  // runId: the run to stop (without it, the only run in progress)
  {
    channel: 'run:stop',
    method: 'stopRun',
    params: ['runId'],
    schema: { params: args({ runId: RUN_ID }), result: BOOL },
    fn: (opts) => {
      const run = ctx.liveRun(opts?.runId);
      if (!run && !opts?.runId && ctx.active.size > 1) throw new Error('Several runs are in progress: say which one to stop.');
      if (!run && opts?.runId && ctx.runAlive(opts.runId)) throw new Error(`Run ${opts.runId} runs in another app window: stop it there.`);
      run?.stop();
      return !!run;
    },
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
      if (!gate) return false;
      const offered = gate.choices
        ? typeof answer === 'string' && gate.choices.some((c) => c.id === answer)
        : typeof answer === 'boolean';
      if (!offered) throw clientError(`Invalid answer for gate ${id}: ${gate.choices ? 'one of its choices' : 'true or false'}.`);
      return run.resolveApproval(id, answer, 'user', feedback, intent || null, Array.isArray(images) ? images : []);
    },
  },
  // resume a run from a step (a new run, no supervisor call) and what the dialog offers;
  // confirmGate: the decided gate the owner approves again in the dialog (#112)
  // images: pictures pasted into the instruction (#130), given to the first resumed agent step
  {
    channel: 'runs:resume',
    method: 'resumeRun',
    params: ['runId', 'step', 'instruction', 'mock', 'confirmGate', 'images'],
    schema: {
      params: args({ runId: RUN_ID, step: nullable(STEP_ID), instruction: nullable(STRING), mock: FLAG, confirmGate: ANY, images: nullable(IMAGES) }, ['runId']),
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
