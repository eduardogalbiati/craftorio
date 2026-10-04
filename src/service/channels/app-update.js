// Self-healing applies merged fixes to the app (#279, areas/app-update.js): where it applies (the
// Settings row and the roadmap cards), the failed update's banner and its dismissal, and the Undo
// of an update (the same cycle, back to the previous commit).

module.exports = (ctx) => [
  { channel: 'app-update:back', method: 'appUpdateBack', params: ['to'], fn: ({ to } = {}) => ctx.appUpdateBack({ to }) },
  { channel: 'app-update:dismiss', method: 'dismissAppUpdate', fn: () => ctx.dismissAppUpdate() },
  { channel: 'app-update:failed', method: 'appUpdateFailed', fn: () => ctx.appUpdateFailed() },
  { channel: 'app-update:state', method: 'appUpdateState', params: ['fresh'], fn: ({ fresh } = {}) => ctx.appUpdateState({ fresh: fresh !== false }) },
];
