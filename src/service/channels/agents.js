// Agents screen: the agents' looks and defaults. The built-in supervisor is always listed first;
// only its look can be changed.

const agents = require('../../agents');

module.exports = (ctx) => [
  { channel: 'agents:list', method: 'listAgents', fn: () => agents.listAgents(ctx.ws.agents) },
  { channel: 'agents:create', method: 'createAgent', params: 'data', fn: (data) => agents.createAgent(ctx.ws.agents, data) },
  { channel: 'agents:save', method: 'saveAgent', params: ['id', 'data'], fn: ({ id, data }) => agents.saveAgent(ctx.ws.agents, id, data) },
  // Moves to the trash (recoverable), like skills.
  { channel: 'agents:remove', method: 'removeAgent', params: 'id', fn: (id) => ctx.host.trashItem(agents.agentPathForRemoval(ctx.ws.agents, id)) },
];
