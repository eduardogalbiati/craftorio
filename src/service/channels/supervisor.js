// The AI supervisor on demand: analysis of any run (running, failed or finished), the watch mode
// that follows a running run in a chat (src/supervisor-watch.js), and the app-wide Supervisor chat
// with its read-only tools over the service (src/supervisor-chat.js, #28), and its request inbox (#240).

const path = require('path');
const simulation = require('../../engine/simulation');
const supervisor = require('../../supervisor');
const { createBridge, mcpCommand } = require('../../supervisor-bridge');
const {
  CLICK_KINDS,
  CONFIRM_KINDS,
  createSupervisorChat,
} = require('../../supervisor-chat');
const { createWatches } = require('../../supervisor-watch');
const { resolveCommand } = require('../../engine/providers');
const { supervisorTools } = require('../../supervisor-tools');

module.exports = (ctx) => {
  const watches = createWatches({
    events: ctx.events, liveRun: ctx.liveRun, runFolder: ctx.runFolder, workflowDirs: ctx.workflowDirs,
    skillsDirs: () => [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR], resolveCommand, notify: ctx.notify,
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
  // the Oracle's request_agent sends here (src/service/channels/oracle.js)
  ctx.supervisorRequest = request;

  return [
    // Explains a run and recommends actions; the analysis is saved in the run folder
    // (supervisor/analysis-*.md), so it shows up in Artifacts.
    {
      channel: 'supervisor:analyze',
      method: 'askSupervisor',
      // attachments: images for the question (#129)
      params: ['runId', 'question', 'attachments'],
      fn: ({ runId, question, attachments }) => supervisor.analyzeRun({
        runDir: ctx.runFolder(runId), question, workflowsDir: ctx.workflowDirs(), skillsDirs: [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR], resolveCommand,
        attachments: Array.isArray(attachments) ? attachments : [],
      }),
    },
    // resuming needs no supervisor: runs:resume is the channel; this one is kept for older clients
    // (never with the owner's gate confirmation, #112: automation does not cross a human gate)
    { channel: 'supervisor:resume', fn: ({ confirmGate: _owner, ...opts } = {}) => ctx.resumeRun(opts) },
    // Watch mode (opt-in per run, it costs tokens): on/off with { provider, model, effort }; the
    // messages are pushed on supervisor:watch.
    {
      channel: 'supervisor:watchRun',
      method: 'watchRun',
      params: ['runId', 'on', 'options'],
      fn: ({ runId, on, options }) => (on ? watches.start(runId, options || {}) : watches.stop(runId)),
    },
    { channel: 'supervisor:watchAsk', method: 'askWatch', params: ['runId', 'question'], fn: ({ runId, question }) => watches.ask(runId, question) },
    { channel: 'supervisor:watchState', method: 'watchState', params: 'runId', fn: (runId) => watches.state(runId) },
    { event: 'supervisor:watch', method: 'onWatch' },
    // The app-wide chat (drawer on every screen, Supervisor page): { question, screen, mock, model }.
    // `mock` and MULTIAGENT_SIMULATION_ONLY answer from the simulated supervisor (no model call).
    {
      channel: 'supervisor:chat',
      method: 'askSupervisorChat',
      params: 'opts',
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
    { channel: 'supervisor:chatHistory', method: 'supervisorChatHistory', fn: () => chat().history() },
    { channel: 'supervisor:chatClear', method: 'clearSupervisorChat', fn: () => chat().clear() },
    // #240: another agent's request in the Supervisor's inbox: { kind, params, reason, from, ref, byContent?, mock } →
    // { ok, text, costUsd: 0, error?, pending? }. Every kind runs the app's own code (the Oracle's action
    // functions, ctx.performAction), never a model; the request and its result are messages of the chat,
    // and a request from the Oracle leaves a short line in its chat. A refused or failed one is ok: false.
    // #241: a run retry or resume (or what the Night watch does not allow) is a card waiting for the owner's click.
    { channel: 'supervisor:request', method: 'supervisorRequest', params: 'opts', fn: (opts) => request(opts) },
    // #241: the owner's click on a request card in this chat: { ref, action: 'do' | 'dismiss' | 'undo', mock } →
    // { ok, text, costUsd, error?, messages }
    {
      channel: 'supervisor:requestAct',
      method: 'supervisorRequestAct',
      params: 'opts',
      fn: async ({ ref, action, mock } = {}) => {
        const out = await chat().actRequest({ ref, action }, { perform: performer(mock), restore: ctx.restoreAction, after: rules().after });
        sent(out);
        return { ...answer(out), messages: chat().history() };
      },
    },
    // what the MCP server offers (names and descriptions), for the Supervisor page
    { channel: 'supervisor:tools', method: 'supervisorTools', fn: () => tools.map(({ name, description }) => ({ name, description })) },
  ];
};
