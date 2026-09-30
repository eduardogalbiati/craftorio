// Desktop notifications: what the window shows, so there is no notification about the run or
// session the user is looking at (the notifications themselves: src/notifications.js).

module.exports = (ctx) => [
  { send: 'notify:context', method: 'setNotifyContext', params: 'ctx', fn: (uiCtx) => ctx.setUiContext(uiCtx) },
];
