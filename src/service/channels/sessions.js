// Sessions screen and embedded terminals: the CLIs' own conversations on this machine, and the
// terminals that run them (xterm in the renderer, the process in the engine).

const { requireObject } = require('../common');
const {
  ANY,
  args,
  BOOL,
  INT,
  listOf,
  nullable,
  NULL,
  OBJECT,
  shape,
  STRING,
  text,
} = require('../schemas');

const TERMINAL_ID = { type: ['string', 'integer'], description: 'An embedded terminal\'s id.' };

module.exports = (ctx) => [
  { channel: 'cliSessions:list', method: 'listCliSessions', schema: { result: shape({ sessions: listOf(OBJECT), providers: ANY }, ['sessions']) }, fn: () => ctx.listCliSessions() },
  {
    channel: 'cliSessions:rename',
    method: 'renameCliSession',
    params: ['provider', 'id', 'title'],
    schema: { params: args({ provider: STRING, id: STRING, title: nullable(text(500)) }, ['provider', 'id']), result: shape({ title: nullable(STRING), renamed: BOOL }) },
    fn: (opts) => ctx.renameCliSession(opts),
  },
  // opts: what to run ({ cwd, sessionId, provider, cols, rows, ... }, src/service/areas/terminals.js) → the terminal
  { channel: 'term:open', method: 'termOpen', params: 'opts', schema: { params: OBJECT, result: shape({ id: TERMINAL_ID, title: STRING }, ['id']) }, fn: (opts) => ctx.openTerminal(requireObject(opts, 'terminal options')) },
  { channel: 'term:kill', method: 'termKill', params: ['id'], schema: { params: args({ id: TERMINAL_ID }, ['id']), result: BOOL }, fn: ({ id }) => { ctx.waiting.close(id); return ctx.terminals.kill(id); } },
  { send: 'term:input', method: 'termInput', params: ['id', 'data'], schema: { params: args({ id: TERMINAL_ID, data: STRING }, ['id']), result: NULL }, fn: ({ id, data }) => { ctx.waiting.input(id); ctx.terminals.input(id, data); } },
  { send: 'term:resize', method: 'termResize', params: ['id', 'cols', 'rows'], schema: { params: args({ id: TERMINAL_ID, cols: INT, rows: INT }, ['id']), result: NULL }, fn: ({ id, cols, rows }) => ctx.terminals.resize(id, cols, rows) },
  { event: 'term:data', method: 'onTermData' },
  { event: 'term:exit', method: 'onTermExit' },
];
