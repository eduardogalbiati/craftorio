// Agents screen: the agents' looks and defaults. The built-in supervisor is always listed first;
// only its look can be changed. The workflows' agents (read from <workspace>/workflows/) follow,
// and only their look can be changed too.

const agents = require('../../domains/agents/agents');
const { requireId } = require('../common');
const {
  AGENT_ID,
  ANY,
  args,
  listOf,
  OBJECT,
} = require('../schemas');

// an agent's fields (look and defaults): checked by packages/engine/domains/agents/agents.js
const AGENT_DATA = OBJECT;

module.exports = (ctx) => [
  { channel: 'agents:list', method: 'listAgents', schema: { result: listOf(OBJECT) }, fn: () => agents.listAgents(ctx.ws.agents, { workflowsDir: ctx.ws.workflows }) },
  { channel: 'agents:create', method: 'createAgent', params: 'data', schema: { params: AGENT_DATA, result: OBJECT }, fn: (data) => agents.createAgent(ctx.ws.agents, data) },
  {
    channel: 'agents:save',
    method: 'saveAgent',
    params: ['id', 'data'],
    schema: { params: args({ id: AGENT_ID, data: AGENT_DATA }, ['id']), result: OBJECT },
    fn: ({ id, data }) => agents.saveAgent(ctx.ws.agents, requireId(id, 'agent id'), data, { workflowsDir: ctx.ws.workflows }),
  },
  // Moves to the trash (recoverable), like skills; the result is the host's trashItem's.
  { channel: 'agents:remove', method: 'removeAgent', params: 'id', schema: { params: AGENT_ID, result: ANY }, fn: (id) => ctx.host.trashItem(agents.agentPathForRemoval(ctx.ws.agents, requireId(id, 'agent id'))) },
];
