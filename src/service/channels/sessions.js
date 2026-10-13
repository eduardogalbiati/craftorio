// Sessions screen and embedded terminals: the CLIs' own conversations on this machine, and the
// terminals that run them (xterm in the renderer, the process in the engine).

const { requireObject } = require('../common');

module.exports = (ctx) => [
  { channel: 'cliSessions:list', method: 'listCliSessions', fn: () => ctx.listCliSessions() },
  { channel: 'cliSessions:rename', method: 'renameCliSession', params: ['provider', 'id', 'title'], fn: (opts) => ctx.renameCliSession(opts) },
  { channel: 'term:open', method: 'termOpen', params: 'opts', fn: (opts) => ctx.openTerminal(requireObject(opts, 'terminal options')) },
  { channel: 'term:kill', method: 'termKill', params: ['id'], fn: ({ id }) => { ctx.waiting.close(id); return ctx.terminals.kill(id); } },
  { send: 'term:input', method: 'termInput', params: ['id', 'data'], fn: ({ id, data }) => { ctx.waiting.input(id); ctx.terminals.input(id, data); } },
  { send: 'term:resize', method: 'termResize', params: ['id', 'cols', 'rows'], fn: ({ id, cols, rows }) => ctx.terminals.resize(id, cols, rows) },
  { event: 'term:data', method: 'onTermData' },
  { event: 'term:exit', method: 'onTermExit' },
];
