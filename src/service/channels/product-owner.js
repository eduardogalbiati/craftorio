// The Backlog's Product Owner (#105, src/product-owner.js): questions about a project's backlog and
// the conversation kept per project. Read-only: it proposes, the owner applies (Assign, roadmap).
// `mock` (the screen's developer mode) and MULTIAGENT_SIMULATION_ONLY answer from the simulated
// Product Owner: no model call, no cost.

const path = require('path');
const agents = require('../../agents');
const backlog = require('../../backlog');
const productOwner = require('../../product-owner');
const projects = require('../../projects');
const runs = require('../../runs');
const simulation = require('../../engine/simulation');
const usage = require('../../usage');
const workspace = require('../../workspace');
const { resolveCommand } = require('../../engine/providers');

module.exports = (ctx) => {
  const project = (projectId) => path.basename(String(projectId));
  return [
    {
      channel: 'po:ask',
      method: 'askProductOwner',
      params: ['projectId', 'question', 'mock'],
      fn: async ({ projectId, question, mock }) => {
        const id = project(projectId);
        const p = projects.readProject(ctx.ws.projects, id);
        const data = ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, id));
        if (!data) throw new Error('Sync the backlog first: the Product Owner reads the synced issues.');
        const simulated = !!mock || simulation.simulationOnly();
        const settings = workspace.readSettings(ctx.ws);
        return productOwner.ask({
          backlogDir: ctx.ws.backlog,
          projectId: id,
          question,
          data,
          activeRuns: ctx.activeRuns().filter((r) => r.projectId === id),
          runs: runs.runsForProject(runs.listRuns(ctx.ws.runs), p),
          workflows: ctx.listWorkflows().filter((w) => !w.error && w.inputs?.task),
          folder: p.folder,
          agent: agents.readAgent(ctx.ws.agents, agents.PRODUCT_OWNER_ID),
          skillsDirs: [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR],
          resolveCommand,
          // its own past calls are in no run: add them to what the runs used this month
          budget: simulated ? null : usage.withPeerUsage(usage.budgetBaseline({ runsDir: ctx.ws.runs, settings }), productOwner.monthUsage(ctx.ws.backlog), settings.prices),
          mock: simulated,
        });
      },
    },
    { channel: 'po:history', method: 'productOwnerHistory', params: ['projectId'], fn: ({ projectId }) => productOwner.readConversation(ctx.ws.backlog, project(projectId)) },
    { channel: 'po:clear', method: 'clearProductOwner', params: ['projectId'], fn: ({ projectId }) => productOwner.clearConversation(ctx.ws.backlog, project(projectId)) },
  ];
};
