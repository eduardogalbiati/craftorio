// The AI supervisor on demand: analysis of any run (running, failed or finished), and the watch mode
// that follows a running run in a chat (src/supervisor-watch.js).

const supervisor = require('../../supervisor');
const { createWatches } = require('../../supervisor-watch');
const { resolveCommand } = require('../../engine/providers');

module.exports = (ctx) => {
  const watches = createWatches({
    events: ctx.events, liveRun: ctx.liveRun, runFolder: ctx.runFolder, workflowDirs: ctx.workflowDirs,
    skillsDirs: () => [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR], resolveCommand, notify: ctx.notify,
  });
  return [
    // Explains a run and recommends actions; the analysis is saved in the run folder
    // (supervisor/analysis-*.md), so it shows up in Artifacts.
    {
      channel: 'supervisor:analyze',
      method: 'askSupervisor',
      params: ['runId', 'question'],
      fn: ({ runId, question }) => supervisor.analyzeRun({
        runDir: ctx.runFolder(runId), question, workflowsDir: ctx.workflowDirs(), skillsDirs: [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR], resolveCommand,
      }),
    },
    // resuming needs no supervisor: runs:resume is the channel; this one is kept for older clients
    { channel: 'supervisor:resume', fn: (opts) => ctx.resumeRun(opts) },
    // Watch mode (opt-in per run, it costs tokens): on/off with { provider, model, effort }; the
    // messages are pushed on supervisor:watch.
    {
      channel: 'supervisor:watchRun',
      method: 'watchRun',
      params: ['runId', 'on', 'options'],
      fn: ({ runId, on, options }) => (on ? watches.start(runId, options || {}) : watches.stop(runId)),
    },
    { channel: 'supervisor:watchAsk', method: 'askWatch', params: ['runId', 'question'], fn: ({ runId, question }) => watches.ask(runId, question) },
    { channel: 'supervisor:watchState', method: 'watchState', params: 'runId', fn: (runId) => watches.state(runId) },
    { event: 'supervisor:watch', method: 'onWatch' },
  ];
};
