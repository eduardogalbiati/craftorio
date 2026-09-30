// The AI supervisor on demand: analysis of any run (running, failed or finished).

const supervisor = require('../../supervisor');
const { resolveCommand } = require('../../engine/providers');

module.exports = (ctx) => [
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
];
