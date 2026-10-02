// Runs: start, stop, the runs in progress (with the gates they wait at), the runs on disk, a run's
// events, answering a gate and resuming a run from a step. Several runs can be in progress (Settings ›
// Execution › Concurrent runs): the channels that act on one take its runId.

const runs = require('../../runs');

module.exports = (ctx) => [
  {
    channel: 'run:start',
    method: 'startRun',
    params: 'payload',
    // projectId/issues: a run started from a Backlog issue (Write & Review's "Enrich"), recorded in workflow.started.
    // When an ended run of those issues kept a worktree with commits, the answer is the kept-work
    // question { confirm, kept, runId } (that run can be resumed instead) until `confirmed` (#112, #170).
    // attachments: { <input>: [path | { path, name }] } images attached to inputs (#129, WorkflowRun).
    fn: ({ file, inputs, mock, mockSequences, projectId, issues, confirmed, attachments }) => {
      const list = Array.isArray(issues) && issues.length
        ? issues.map((i) => ({ number: Number(i.number), url: String(i.url || ''), title: String(i.title || '') }))
        : undefined;
      const kept = list && !confirmed ? ctx.keptWorkForIssues(list) : null;
      if (kept) return { confirm: kept.text, kept, runId: kept.runId };
      return ctx.startWorkflowRun({ file, inputs, mock, mockSequences, projectId: projectId || undefined, issues: list, allowKeptWork: true, attachments });
    },
  },
  // runId: the run to stop (without it, the only run in progress)
  {
    channel: 'run:stop',
    method: 'stopRun',
    params: ['runId'],
    fn: (opts) => {
      const run = ctx.liveRun(opts?.runId);
      if (!run && !opts?.runId && ctx.active.size > 1) throw new Error('Several runs are in progress: say which one to stop.');
      if (!run && opts?.runId && ctx.runAlive(opts.runId)) throw new Error(`Run ${opts.runId} runs in another app window: stop it there.`);
      run?.stop();
      return !!run;
    },
  },
  // each run with its pending gates: the source of truth of "waiting for you" in every view
  { channel: 'runs:active', method: 'listActiveRuns', fn: () => ctx.activeRuns() },
  { channel: 'runs:list', method: 'listRuns', fn: () => ctx.listAllRuns() },
  // activity: also the agents' tool calls and thinking, compacted (the run chat shows them)
  {
    channel: 'runs:events',
    method: 'runEvents',
    params: ['runId', '...opts'],
    fn: ({ runId, activity }) => runs.runEvents(ctx.runFolder(runId), { activity: !!activity }),
  },
  // answer: true/false or the id of a choice; feedback: the optional text typed at the gate;
  // intent: 'save_to_issue' for "Accept and save to issue #n" (#125).
  // Gate ids are per run (a1, a2…): runId says which run (without it, the only run waiting on that id).
  {
    channel: 'approval:resolve',
    method: 'resolveApproval',
    // images: pictures attached to the feedback (#129), given to the next agent step
    params: ['id', 'answer', 'feedback', 'runId', 'intent', 'images'],
    fn: ({ runId, id, answer, feedback, intent, images }) => {
      const waiting = [...ctx.active.values()].filter((r) => r.approvals.has(id));
      const run = runId ? ctx.active.get(String(runId)) : waiting.length === 1 ? waiting[0] : null;
      return run?.resolveApproval(id, answer, 'user', feedback, intent || null, Array.isArray(images) ? images : []) ?? false;
    },
  },
  // resume a run from a step (a new run, no supervisor call) and what the dialog offers;
  // confirmGate: the decided gate the owner approves again in the dialog (#112)
  { channel: 'runs:resume', method: 'resumeRun', params: ['runId', 'step', 'instruction', 'mock', 'confirmGate'], fn: (opts) => ctx.resumeRun(opts) },
  { channel: 'runs:resumeOptions', method: 'resumeOptions', params: ['runId'], fn: (opts) => ctx.resumeOptions(opts) },
  // the PR a run opened, with its state read with gh/glab (cached), and the owner's title of a run (#84)
  { channel: 'runs:prState', method: 'runPrState', params: ['runId'], fn: (opts) => ctx.runPrState(opts) },
  { channel: 'runs:setTitle', method: 'setRunTitle', params: ['runId', 'title'], fn: (opts) => ctx.setRunTitle(opts) },
  { event: 'run:event', method: 'onEvent' },
  // a run's PR state or title changed: { runId, pr } or { runId, title, customTitle }
  { event: 'run:meta', method: 'onRunMeta' },
];
