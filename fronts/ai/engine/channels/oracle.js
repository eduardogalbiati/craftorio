// The Oracle's channels (#122, #123, #171): the ai front's end of the Oracle service, a kernel area since
// phase 4 of the reorganisation study (#590, packages/engine/service/areas/oracle.js), read through ctx:
// oracleService() the workspace's Oracle (ask, act, history, memory, the Night watch switch),
// oracleDelegate (the Product Owner, the supervisor, the analyzer, the checker), oracleProposeOrRoute
// and oracleRequestAgent (#241: a card an owner holds goes to that owner's inbox), oracleWake (#123:
// watches, mutes, the pending batch), oracleToolList. `mock` (the drawer's developer mode) and
// MULTIAGENT_SIMULATION_ONLY answer from the simulated Oracle: no model call, no cost. Every oracle
// channel with input takes one object (`params: 'opts'`), the way the renderer calls them (#187).

const simulation = require('@multiagent/engine/engine/simulation');
const { requireObject } = require('@multiagent/engine/service/common');
const {
  ANY,
  args,
  BOOL,
  FLAG,
  listOf,
  MESSAGES,
  nullable,
  NUMBER,
  OBJECT,
  OPTIONS,
  orNone,
  PROJECT_ID,
  REQUEST_ANSWER,
  RUN_ID,
  shape,
  STRING,
  TOOL_LIST,
} = require('@multiagent/engine/service/schemas');

// an action card's id; what the chat answers after a change (its messages and the Oracle's state)
const ACTION_ID = { type: ['string', 'integer'], description: 'An action card\'s id.' };
const ON_ACTION = args({ actionId: ACTION_ID, mock: FLAG }, ['actionId']);
const CHAT = shape({ messages: MESSAGES, state: OBJECT }, ['messages']);
// who turned the Night watch on (#172): the account, and the screen it was turned on from
const nightBy = (from) => `${process.env.USERNAME || process.env.USER || 'the owner'} (${String(from || 'the Oracle drawer').slice(0, 60)})`;

module.exports = (ctx) => {
  const get = () => ctx.oracleService();
  const simulated = (opts) => !!opts?.mock || simulation.simulationOnly();
  const withState = (out) => ({ ...out, messages: get().history(), state: get().state() });
  // Every oracle channel with input takes one object (`params: 'opts'`), the way the renderer calls
  // them (`api.oracleAct({ actionId, mock })`): positional params would wrap that object again (#187).
  return [
    // { question, screen, images, mock, mockContextTokens } → { message, messages, state } or { refused, ... };
    // images: pasted screenshots ({ dataUrl }, oracle.ATTACHMENT_LIMITS); mockContextTokens (simulated
    // only) makes the answer report that context size (compaction checks)
    {
      channel: 'oracle:ask',
      method: 'askOracle',
      params: 'opts',
      schema: {
        params: args({ question: STRING, screen: ANY, images: nullable(listOf(OBJECT)), context: ANY, mock: FLAG, mockContextTokens: nullable(NUMBER) }),
        result: shape({ message: nullable(OBJECT), messages: MESSAGES, state: OBJECT, refused: ANY }, ['messages']),
      },
      fn: async (arg) => {
        const opts = requireObject(arg, 'options');
        const mock = simulated(opts);
        // #180: its progress is pushed on chat:progress; chat:cancel ('oracle') stops it
        const turn = ctx.chatTurns.start('oracle');
        let out;
        try {
          out = await get().ask({ question: opts.question, screen: opts.screen, images: opts.images, context: opts.context || null, mock, mockContextTokens: mock ? opts.mockContextTokens : undefined, onItem: turn.onItem, signal: turn.signal });
        } finally {
          turn.end(turn.stopped() ? 'stopped' : out?.message?.error || !out ? 'failed' : 'done');
        }
        return out;
      },
    },
    // the owner's "Do it" on an action card (#123): performs exactly that card, once → { ok, text, messages, state }
    {
      channel: 'oracle:act',
      method: 'oracleAct',
      params: 'opts',
      schema: { params: ON_ACTION, result: shape({ ok: BOOL, text: ANY, messages: MESSAGES, state: OBJECT }, ['ok']) },
      fn: (arg) => { const { actionId, mock } = requireObject(arg, 'options'); return get().act(actionId, { mock: simulated({ mock }) }); },
    },
    // a pasted image of the conversation (its file name in a user message's attachments) → data: URL or null
    { channel: 'oracle:attachment', method: 'oracleAttachment', params: 'name', schema: { params: STRING, result: nullable(STRING) }, fn: (name) => get().attachment(name) },
    // asks another agent (product-owner, issue-draft, supervisor, analyzer, checker) → { to, text, costUsd, error, ref }; recorded in the chat
    {
      channel: 'oracle:delegate',
      method: 'oracleDelegate',
      params: 'opts',
      // { to, question, ... } as the delegate tool sends it; the agent checks the rest
      schema: { params: args({ to: STRING, mock: FLAG }), result: shape({ to: STRING, text: ANY, costUsd: NUMBER, error: ANY, ref: ANY }) },
      fn: (arg) => {
        const { mock, ...input } = requireObject(arg, 'options');
        return ctx.oracleDelegate(input, { mock });
      },
    },
    { channel: 'oracle:dismiss', method: 'oracleDismiss', params: 'opts', schema: { params: ON_ACTION, result: CHAT }, fn: (arg) => get().dismiss(requireObject(arg, 'options').actionId) },
    { channel: 'oracle:history', method: 'oracleHistory', schema: { result: MESSAGES }, fn: () => get().history() },
    // #184: { text (pasted, e.g. a Claude Code memory index), base (the draft; default the saved memory) } →
    // { text }: the draft with the pasted decisions added; nothing is saved (the owner saves it)
    {
      channel: 'oracle:importMemory',
      method: 'importOracleMemory',
      params: 'opts',
      schema: { params: { type: ['object', 'null'], properties: { text: STRING, base: nullable(STRING) } }, result: shape({ text: STRING }, ['text']) },
      fn: (opts) => get().importMemory(opts || {}),
    },
    // the owner read the conversation up to { at } (default now) → { readAt }: the unread badge counts after it
    { channel: 'oracle:markRead', method: 'markOracleRead', params: 'opts', schema: { params: { type: ['object', 'null'], properties: { at: ANY } }, result: shape({ readAt: ANY }) }, fn: (opts) => get().markRead(opts?.at) },
    { channel: 'oracle:memory', method: 'oracleMemory', schema: { result: shape({ text: STRING, updatedAt: nullable(STRING) }, ['text']) }, fn: () => get().memory() },
    // mutes (on) or unmutes one run's wake-ups → the wake-up state
    {
      channel: 'oracle:mute',
      method: 'muteOracleRun',
      params: 'opts',
      schema: { params: args({ runId: RUN_ID, on: FLAG }, ['runId']), result: OBJECT },
      fn: (arg) => { const { runId, on } = requireObject(arg, 'options'); return ctx.oracleWake.mute(runId, on !== false); },
    },
    // the Night watch: { on, until (ISO, at most 24 h ahead), from (the screen it was turned on from) } → { nightWatch, messages, state }
    { channel: 'oracle:nightWatch', method: 'setOracleNightWatch', params: 'opts', schema: { params: args({ on: FLAG, until: nullable(STRING), from: nullable(STRING) }), result: OBJECT }, fn: (arg) => { const { on, until, from } = requireObject(arg, 'options'); return get().setNightWatch({ on, until, by: nightBy(from) }); } },
    // the owner proposes a card themselves (or a check): { kind, params, why } → { id, status, ... };
    // #241: a card requested by the Oracle or by content, of a kind an owner holds, goes to that owner's
    // inbox → { routed, to, kind, ok, text, ... }
    {
      channel: 'oracle:propose',
      method: 'oracleProposeAction',
      params: 'opts',
      // params: the card kind's own (packages/engine/domains/oracle/oracle-actions.js checks them per kind)
      schema: { params: args({ kind: STRING, params: ANY, why: ANY, requestedBy: nullable(STRING) }, ['kind']), result: OBJECT },
      fn: async (arg) => {
        const input = requireObject(arg, 'options');
        return withState(await ctx.oracleProposeOrRoute(input, { fromOracle: input.requestedBy !== 'owner' }));
      },
    },
    // #241: the request_agent tool's function: { to: 'po' | 'supervisor', kind, params, reason, projectId?, requestedBy?, mock } →
    // { ok, text, costUsd, error?, pending? } (pending: a card waits for the owner's click in the owner's chat)
    {
      channel: 'oracle:requestAgent',
      method: 'oracleRequestAgent',
      params: 'opts',
      // params: the request kind's own (the receiving agent checks them per kind)
      schema: {
        params: args({ to: STRING, kind: STRING, params: ANY, reason: ANY, projectId: orNone(PROJECT_ID), requestedBy: nullable(STRING), mock: FLAG }),
        result: REQUEST_ANSWER,
      },
      fn: (arg) => ctx.oracleRequestAgent(requireObject(arg, 'options')),
    },
    // a new session from a handoff note; the messages and the memory are kept
    { channel: 'oracle:reset', method: 'resetOracle', params: 'opts', schema: { params: OPTIONS, result: CHAT }, fn: (opts) => get().reset({ mock: simulated(opts) }) },
    { channel: 'oracle:saveMemory', method: 'saveOracleMemory', params: 'text', schema: { params: STRING, result: OBJECT }, fn: (text) => get().saveMemory(text) },
    // { busy, paused, today, owner, model, effort, contextTokens, compactAtTokens, nightWatch, ... }
    { channel: 'oracle:state', method: 'oracleState', schema: { result: OBJECT }, fn: () => get().state() },
    { channel: 'oracle:tools', method: 'listOracleTools', schema: { result: TOOL_LIST }, fn: () => ctx.oracleToolList() },
    { channel: 'oracle:undo', method: 'oracleUndo', params: 'opts', schema: { params: ON_ACTION, result: CHAT }, fn: (arg) => get().undo(requireObject(arg, 'options').actionId) },
    // watch a run ({ runId }) or a project's roadmap ({ projectId }) until it ends; on: false stops
    {
      channel: 'oracle:watch',
      method: 'oracleWatch',
      params: 'opts',
      schema: { params: { type: ['object', 'null'], properties: { runId: orNone(RUN_ID), projectId: orNone(PROJECT_ID), on: FLAG } }, result: OBJECT },
      fn: (input) => ctx.oracleWake.watch(input || {}),
    },
    // the batch waiting for the wake-up window now (the owner's "wake now", checks) → the wake's answer or null
    { channel: 'oracle:wakeNow', method: 'wakeOracleNow', schema: { result: nullable(OBJECT) }, fn: () => ctx.oracleWake.flush() },
    // { muted, watching, wakeScope, wakeOn, pending }
    { channel: 'oracle:wakeState', method: 'oracleWakeState', schema: { result: OBJECT }, fn: () => ({ ...ctx.oracleWake.state(), pending: ctx.oracleWake.pending() }) },
    // a message was added to the conversation (a wake-up, a card, a result): { id, role, kind }
    { event: 'oracle:changed', method: 'onOracleChanged' },
  ];
};
