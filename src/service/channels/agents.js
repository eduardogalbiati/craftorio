// Agents screen: the agents' looks and defaults. The built-in supervisor is always listed first;
// only its look can be changed. The workflows' agents (read from <workspace>/workflows/) follow,
// and only their look can be changed too.

const agents = require('../../agents');

module.exports = (ctx) => [
  { channel: 'agents:list', method: 'listAgents', fn: () => agents.listAgents(ctx.ws.agents, { workflowsDir: ctx.ws.workflows }) },
  { channel: 'agents:create', method: 'createAgent', params: 'data', fn: (data) => agents.createAgent(ctx.ws.agents, data) },
  { channel: 'agents:save', method: 'saveAgent', params: ['id', 'data'], fn: ({ id, data }) => agents.saveAgent(ctx.ws.agents, id, data, { workflowsDir: ctx.ws.workflows }) },
  // Moves to the trash (recoverable), like skills.
  { channel: 'agents:remove', method: 'removeAgent', params: 'id', fn: (id) => ctx.host.trashItem(agents.agentPathForRemoval(ctx.ws.agents, id)) },
];
