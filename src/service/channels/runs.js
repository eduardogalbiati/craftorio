// Runs: start, stop, the runs in progress (with the gates they wait at), the runs on disk, a run's
// events, answering a gate and resuming a run from a step. Several runs can be in progress (Settings ›
// Execution › Concurrent runs): the channels that act on one take its runId.

const runs = require('../../runs');

module.exports = (ctx) => [
  {
    channel: 'run:start',
    method: 'startRun',
    params: 'payload',
    fn: ({ file, inputs, mock, mockSequences }) => ctx.startWorkflowRun({ file, inputs, mock, mockSequences }),
  },
  // runId: the run to stop (without it, the only run in progress)
  {
    channel: 'run:stop',
    method: 'stopRun',
    params: ['runId'],
    fn: (opts) => {
      const run = ctx.liveRun(opts?.runId);
      if (!run && !opts?.runId && ctx.active.size > 1) throw new Error('Several runs are in progress: say which one to stop.');
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
  // answer: true/false or the id of a choice; feedback: the optional text typed at the gate.
  // Gate ids are per run (a1, a2…): runId says which run (without it, the only run waiting on that id).
  {
    channel: 'approval:resolve',
    method: 'resolveApproval',
    params: ['id', 'answer', 'feedback', 'runId'],
    fn: ({ runId, id, answer, feedback }) => {
      const waiting = [...ctx.active.values()].filter((r) => r.approvals.has(id));
      const run = runId ? ctx.active.get(String(runId)) : waiting.length === 1 ? waiting[0] : null;
      return run?.resolveApproval(id, answer, 'user', feedback) ?? false;
    },
  },
  // resume a run from a step (a new run, no supervisor call) and what the dialog offers
  { channel: 'runs:resume', method: 'resumeRun', params: ['runId', 'step', 'instruction', 'mock'], fn: (opts) => ctx.resumeRun(opts) },
  { channel: 'runs:resumeOptions', method: 'resumeOptions', params: ['runId'], fn: (opts) => ctx.resumeOptions(opts) },
  { event: 'run:event', method: 'onEvent' },
];
