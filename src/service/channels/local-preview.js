// Run locally at a gate (#70): the run's worktree started with the project's command in an embedded
// terminal (term:data / term:exit, see sessions.js), stopped when the gate is answered or the run
// ends. Starting or stopping it never answers the gate. realWorkspace: the copy uses the owner's
// workspace instead of a scratch copy (the UI warns first); it always runs in simulation only.

module.exports = (ctx) => [
  { channel: 'localPreview:start', method: 'startLocalPreview', params: ['runId', 'approvalId', 'realWorkspace', 'cols', 'rows'], fn: (opts) => ctx.startLocalPreview(opts) },
  { channel: 'localPreview:stop', method: 'stopLocalPreview', params: ['runId'], fn: ({ runId }) => ctx.stopLocalPreview({ runId }) },
  { channel: 'localPreview:list', method: 'listLocalPreviews', fn: () => ctx.listLocalPreviews() },
];
