// Run locally at a gate (#70): the run's worktree started with the project's command in an embedded
// terminal (term:data / term:exit, see sessions.js), stopped when the gate is answered or the run
// ends. Starting or stopping it never answers the gate. realWorkspace: the copy uses the owner's
// workspace instead of a scratch copy (the UI warns first); it always runs in simulation only.
// Run App (#108): localPreview:info says what the gate's button runs, or a setup suggestion from the
// worktree when nothing is configured; config: a one-off command for a run without a project.
// gate:changes: the files a gate with diff_base changed, for its Artifacts panel.

module.exports = (ctx) => [
  { channel: 'gate:changes', method: 'gateChanges', params: ['runId', 'approvalId'], fn: (opts) => ctx.gateChanges(opts) },
  { channel: 'localPreview:info', method: 'localPreviewInfo', params: ['runId', 'approvalId'], fn: (opts) => ctx.runAppInfo(opts) },
  { channel: 'localPreview:start', method: 'startLocalPreview', params: ['runId', 'approvalId', 'realWorkspace', 'cols', 'rows', 'config'], fn: (opts) => ctx.startLocalPreview(opts) },
  { channel: 'localPreview:stop', method: 'stopLocalPreview', params: ['runId'], fn: ({ runId }) => ctx.stopLocalPreview({ runId }) },
  { channel: 'localPreview:list', method: 'listLocalPreviews', fn: () => ctx.listLocalPreviews() },
];
