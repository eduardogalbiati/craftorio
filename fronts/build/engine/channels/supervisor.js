// The AI supervisor on demand: analysis of any run (running, failed or finished), the watch mode
// that follows a running run in a chat (packages/engine/domains/supervisor/supervisor-watch.js), and the app-wide Supervisor chat
// with its read-only tools over the service (packages/engine/domains/supervisor/supervisor-chat.js, #28), and its request inbox (#240).

const path = require('path');
const simulation = require('@craftorio/engine/engine/simulation');
const supervisor = require('@craftorio/engine/domains/supervisor/supervisor');
const workspace = require('@craftorio/engine/domains/workspace/workspace');
const {
  createBridge,
  mcpCommand,
} = require('@craftorio/engine/domains/supervisor/supervisor-bridge');
const {
  CLICK_KINDS,
  CONFIRM_KINDS,
  createSupervisorChat,
} = require('@craftorio/engine/domains/supervisor/supervisor-chat');
const { createWatches } = require('../domains/supervisor-watch');
const {
  requireId,
  requireObject,
} = require('@craftorio/engine/service/common');
const { resolveCommand } = require('@craftorio/engine/engine/providers');
const { supervisorTools } = require('@craftorio/engine/domains/supervisor/supervisor-tools');
const {
  ANY,
  args,
  FLAG,
  IMAGES,
  MESSAGES,
  nullable,
  OBJECT,
  REQUEST_ANSWER,
  RUN_ID,
  shape,
  STARTED,
  STEP_ID,
  STRING,
  TOOL_LIST,
} = require('@craftorio/engine/service/schemas');

const CHAT_ANSWER = shape({ message: OBJECT, messages: MESSAGES }, ['messages']);

module.exports = (ctx) => {
  const watches = createWatches({
    events: ctx.events, liveRun: ctx.liveRun, runFolder: ctx.runFolder, workflowDirs: ctx.workflowDirs,
    skillsDirs: () => [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR], resolveCommand, notify: ctx.notify,
    language: () => workspace.readSettings(ctx.ws).language, // #327: the [Language] line of each turn
  });
  const tools = supervisorTools(ctx);
  const chats = new Map(); // workspace root → its chat (the workspace can change)
  const bridge = createBridge({ tools: () => tools });
  const chat = () => {
    const root = ctx.ws.root;
    if (!chats.has(root)) {
      chats.set(root, createSupervisorChat({
        dir: () => ctx.ws.supervisor || path.join(ctx.ws.root, 'supervisor'),
        tools: () => tools, bridge, mcpCommand: () => mcpCommand(!!ctx.host?.isPackaged, resolveCommand),
        skillsDirs: () => [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR], resolveCommand, refuseReal: simulation.refuseReal,
        timeZone: () => workspace.readSettings(ctx.ws).timeZone,
        // #327: Settings › Language, the [Language] line of each question
        language: () => workspace.readSettings(ctx.ws).language,
      }));
    }
    return chats.get(root);
  };

  // ---- the inbox (#240, #241) ---------------------------------------------------------------------
  const performer = (mock) => (kind, params) => ctx.performAction(kind, params, { mock: !!mock || simulation.simulationOnly() });
  // (`byModel`: the Oracle's request_agent; by day its CONFIRM_KINDS wait too)
  const rules = (byContent = false, byModel = false) => ctx.inboxRules?.('supervisor', { clickKinds: CLICK_KINDS, confirmKinds: CONFIRM_KINDS, byContent, byModel }) || {};
  // a request from the Oracle (or the owner's click on one) leaves a short line in the Oracle's chat
  const sent = (out) => {
    if (out.from !== 'oracle') return;
    ctx.oracleService?.()?.requested({ to: 'supervisor', ref: out.ref, ownerTs: out.ownerTs, requestKind: out.kind, text: out.text, costUsd: out.costUsd, error: out.error, pending: out.pending });
  };
  const answer = (out) => ({ ok: out.ok, text: out.text, costUsd: out.costUsd, ...(out.error ? { error: out.error } : {}), ...(out.pending ? { pending: true } : {}) });
  const request = async ({ mock, byContent, byModel, ...input } = {}) => {
    const out = await chat().handleRequest(input, { perform: performer(mock), ...rules(!!byContent, !!byModel) });
    sent(out);
    return answer(out);
  };
  // the Oracle's request_agent sends here (packages/engine/service/areas/oracle.js)
  ctx.supervisorRequest = request;

  return [
    // Explains a run and recommends actions; the analysis is saved in the run folder
    // (supervisor/analysis-*.md), so it shows up in Artifacts.
    {
      channel: 'supervisor:analyze',
      method: 'askSupervisor',
      // attachments: images for the question (#129)
      params: ['runId', 'question', 'attachments'],
      schema: { params: args({ runId: RUN_ID, question: nullable(STRING), attachments: nullable(IMAGES) }, ['runId']), result: OBJECT },
      fn: ({ runId, question, attachments }) => supervisor.analyzeRun({
        runDir: ctx.runFolder(runId), question, workflowsDir: ctx.workflowDirs(), skillsDirs: [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR], resolveCommand,
        attachments: Array.isArray(attachments) ? attachments : [],
        language: workspace.readSettings(ctx.ws).language, // #327
      }),
    },
    // resuming needs no supervisor: runs:resume is the channel; this one is kept for older clients
    // (never with the owner's gate confirmation, #112: automation does not cross a human gate)
    {
      channel: 'supervisor:resume',
      // runs:resume's options (confirmGate is dropped, and inputs, #799: the owner changes them)
      schema: {
        params: args({ runId: RUN_ID, step: nullable(STEP_ID), instruction: nullable(STRING), mock: FLAG, confirmGate: ANY, images: nullable(IMAGES) }, ['runId']),
        result: STARTED,
      },
      fn: (arg) => {
        const { confirmGate: _owner, inputs: _ownerInputs, ...opts } = requireObject(arg, 'options');
        // #368: only the owner resumes a paused run (runs:resume)
        ctx.refusePausedResume(requireId(opts.runId, 'runId'));
        return ctx.resumeRun(opts);
      },
    },
    // Watch mode (opt-in per run, it costs tokens): on/off with { provider, model, effort }; the
    // messages are pushed on supervisor:watch.
    {
      channel: 'supervisor:watchRun',
      method: 'watchRun',
      params: ['runId', 'on', 'options'],
      schema: { params: args({ runId: RUN_ID, on: FLAG, options: nullable(OBJECT) }, ['runId']), result: OBJECT },
      fn: ({ runId, on, options }) => (on ? watches.start(runId, options || {}) : watches.stop(runId)),
    },
    {
      channel: 'supervisor:watchAsk',
      method: 'askWatch',
      params: ['runId', 'question'],
      schema: { params: args({ runId: RUN_ID, question: STRING }, ['runId']), result: OBJECT },
      fn: ({ runId, question }) => watches.ask(runId, question),
    },
    { channel: 'supervisor:watchState', method: 'watchState', params: 'runId', schema: { params: RUN_ID, result: OBJECT }, fn: (runId) => watches.state(runId) },
    { event: 'supervisor:watch', method: 'onWatch' },
    // The app-wide chat (the drawer opened from Workflows): { question, screen, mock, model, run }
    // (#409 run: the run a run card's Send to supervisor attached). `mock` and
    // MULTIAGENT_SIMULATION_ONLY answer from the simulated supervisor (no model call).
    {
      channel: 'supervisor:chat',
      method: 'askSupervisorChat',
      params: 'opts',
      schema: { params: { type: ['object', 'null'], properties: { question: STRING, screen: ANY, mock: FLAG, model: nullable(STRING), run: ANY } }, result: CHAT_ANSWER },
      fn: async (opts) => {
        // #180: its progress is pushed on chat:progress; chat:cancel ('supervisor') stops it
        const turn = ctx.chatTurns.start('supervisor');
        let out;
        try {
          out = await chat().ask({ ...opts, mock: !!opts?.mock || simulation.simulationOnly(), onItem: turn.onItem, signal: turn.signal });
        } finally {
          turn.end(turn.stopped() ? 'stopped' : out?.message?.error || !out ? 'failed' : 'done');
        }
        return out;
      },
    },
    { channel: 'supervisor:chatHistory', method: 'supervisorChatHistory', schema: { result: MESSAGES }, fn: () => chat().history() },
    { channel: 'supervisor:chatClear', method: 'clearSupervisorChat', schema: { result: MESSAGES }, fn: () => chat().clear() },
    // #240: another agent's request in the Supervisor's inbox: { kind, params, reason, from, ref, byContent?, mock } →
    // { ok, text, costUsd: 0, error?, pending? }. Every kind runs the app's own code (the Oracle's action
    // functions, ctx.performAction), never a model; the request and its result are messages of the chat,
    // and a request from the Oracle leaves a short line in its chat. A refused or failed one is ok: false.
    // #241: a run retry or resume (or what the Night watch does not allow) is a card waiting for the owner's click.
    {
      channel: 'supervisor:request',
      method: 'supervisorRequest',
      params: 'opts',
      // params: the request kind's own (the action functions check them per kind)
      schema: { params: args({ kind: STRING, params: ANY, reason: ANY, from: ANY, ref: ANY, byContent: FLAG, mock: FLAG }), result: REQUEST_ANSWER },
      fn: (opts) => request(requireObject(opts, 'options')),
    },
    // #241: the owner's click on a request card in this chat: { ref, action: 'do' | 'dismiss' | 'undo', mock } →
    // { ok, text, costUsd, error?, messages }
    {
      channel: 'supervisor:requestAct',
      method: 'supervisorRequestAct',
      params: 'opts',
      schema: { params: args({ ref: ANY, action: STRING, mock: FLAG }), result: { ...REQUEST_ANSWER, properties: { ...REQUEST_ANSWER.properties, messages: MESSAGES } } },
      fn: async (arg) => {
        const { ref, action, mock } = requireObject(arg, 'options');
        const out = await chat().actRequest({ ref, action }, { perform: performer(mock), restore: ctx.restoreAction, after: rules().after });
        sent(out);
        return { ...answer(out), messages: chat().history() };
      },
    },
    // what the MCP server offers (names and descriptions), for the expanded Supervisor drawer
    { channel: 'supervisor:tools', method: 'supervisorTools', schema: { result: TOOL_LIST }, fn: () => tools.map(({ name, description }) => ({ name, description })) },
  ];
};
