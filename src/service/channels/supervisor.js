// The AI supervisor on demand: analysis of any run (running, failed or finished), the watch mode
// that follows a running run in a chat (src/supervisor-watch.js), and the app-wide Supervisor chat
// with its read-only tools over the service (src/supervisor-chat.js, #28).

const path = require('path');
const simulation = require('../../engine/simulation');
const supervisor = require('../../supervisor');
const { createBridge, mcpCommand } = require('../../supervisor-bridge');
const { createSupervisorChat } = require('../../supervisor-chat');
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
      fn: (opts) => chat().ask({ ...opts, mock: !!opts?.mock || simulation.simulationOnly() }),
    },
    { channel: 'supervisor:chatHistory', method: 'supervisorChatHistory', fn: () => chat().history() },
    { channel: 'supervisor:chatClear', method: 'clearSupervisorChat', fn: () => chat().clear() },
    // what the MCP server offers (names and descriptions), for the Supervisor page
    { channel: 'supervisor:tools', method: 'supervisorTools', fn: () => tools.map(({ name, description }) => ({ name, description })) },
  ];
};
