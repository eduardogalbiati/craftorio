// Desktop notifications: what the window shows, so there is no notification about the run or
// session the user is looking at (the notifications themselves: src/notifications.js).

const {
  NULL,
  OPTIONS,
} = require('../schemas');

module.exports = (ctx) => [
  // the window's context ({ view, runId, ... }): fire-and-forget, no result
  { send: 'notify:context', method: 'setNotifyContext', params: 'ctx', schema: { params: OPTIONS, result: NULL }, fn: (uiCtx) => ctx.setUiContext(uiCtx) },
];
