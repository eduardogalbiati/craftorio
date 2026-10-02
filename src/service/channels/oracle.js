// The Oracle (#122, src/oracle.js): the app-wide master agent's persistent conversation, its memory,
// its state (busy, paused by budget, owning process) and its read-only tools (src/oracle-tools.js,
// served over its own bridge). One Oracle per workspace root. `mock` (the drawer's developer mode)
// and MULTIAGENT_SIMULATION_ONLY answer from the simulated Oracle: no model call, no cost.
// Its spend counts in the monthly budgets with the runs' and the Product Owner's.

const path = require('path');
const agents = require('../../agents');
const oracle = require('../../oracle');
const productOwner = require('../../product-owner');
const simulation = require('../../engine/simulation');
const usage = require('../../usage');
const workspace = require('../../workspace');
const { createBridge, mcpCommand } = require('../../supervisor-bridge');
const { oracleTools } = require('../../oracle-tools');
const { resolveCommand } = require('../../engine/providers');

module.exports = (ctx) => {
  const tools = oracleTools(ctx);
  const bridge = createBridge({ tools: () => tools });
  const oracles = new Map(); // workspace root → its Oracle (the workspace can change)
  const dir = () => ctx.ws.oracle || path.join(ctx.ws.root, 'oracle');
  const get = () => {
    const root = ctx.ws.root;
    if (!oracles.has(root)) {
      oracles.set(root, oracle.createOracle({
        dir, tools: () => tools, bridge, mcpCommand: () => mcpCommand(!!ctx.host?.isPackaged, resolveCommand),
        skillsDirs: () => [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR], resolveCommand, refuseReal: simulation.refuseReal,
        agent: () => agents.readAgent(ctx.ws.agents, agents.ORACLE_ID),
        settings: () => workspace.readSettings(ctx.ws),
        // the runs' spend, the Oracle's own days and the Product Owner's calls this month
        budget: () => {
          const settings = workspace.readSettings(ctx.ws);
          const base = usage.budgetBaseline({ runsDir: ctx.ws.runs, settings, extraRuns: oracle.usageRuns(dir()) });
          return usage.withPeerUsage(base, productOwner.monthUsage(ctx.ws.backlog), settings.prices);
        },
      }));
    }
    return oracles.get(root);
  };
  const simulated = (opts) => !!opts?.mock || simulation.simulationOnly();
  return [
    // { question, screen, mock, mockContextTokens } → { message, messages, state } or { refused, ... };
    // mockContextTokens (simulated only) makes the answer report that context size (compaction checks)
    {
      channel: 'oracle:ask',
      method: 'askOracle',
      params: 'opts',
      fn: (opts = {}) => {
        const mock = simulated(opts);
        return get().ask({ question: opts.question, screen: opts.screen, mock, mockContextTokens: mock ? opts.mockContextTokens : undefined });
      },
    },
    { channel: 'oracle:history', method: 'oracleHistory', fn: () => get().history() },
    // a new session from a handoff note; the messages and the memory are kept
    { channel: 'oracle:reset', method: 'resetOracle', params: 'opts', fn: (opts) => get().reset({ mock: simulated(opts) }) },
    { channel: 'oracle:memory', method: 'oracleMemory', fn: () => get().memory() },
    { channel: 'oracle:saveMemory', method: 'saveOracleMemory', params: 'text', fn: (text) => get().saveMemory(text) },
    // { busy, paused, today, owner, model, effort, contextTokens, compactAtTokens, ... }
    { channel: 'oracle:state', method: 'oracleState', fn: () => get().state() },
    { channel: 'oracle:tools', method: 'listOracleTools', fn: () => tools.map(({ name, description }) => ({ name, description })) },
  ];
};
