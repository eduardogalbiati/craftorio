// Self-healing applies merged fixes to the app (#279, areas/app-update.js): where it applies (the
// Settings row and the roadmap cards), the failed update's banner and its dismissal, and the Undo
// of an update (the same cycle, back to the previous commit).

const {
  args,
  BOOL,
  FLAG,
  nullable,
  OBJECT,
  STRING,
} = require('../schemas');

module.exports = (ctx) => [
  { channel: 'app-update:back', method: 'appUpdateBack', params: ['to'], schema: { params: args({ to: nullable(STRING) }), result: OBJECT }, fn: ({ to } = {}) => ctx.appUpdateBack({ to }) },
  { channel: 'app-update:dismiss', method: 'dismissAppUpdate', schema: { result: BOOL }, fn: () => ctx.dismissAppUpdate() },
  { channel: 'app-update:failed', method: 'appUpdateFailed', schema: { result: nullable(OBJECT) }, fn: () => ctx.appUpdateFailed() },
  { channel: 'app-update:state', method: 'appUpdateState', params: ['fresh'], schema: { params: args({ fresh: FLAG }), result: OBJECT }, fn: ({ fresh } = {}) => ctx.appUpdateState({ fresh: fresh !== false }) },
];
