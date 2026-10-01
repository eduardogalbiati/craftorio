// The Backlog's Product Owner (#105, src/product-owner.js): questions about a project's backlog and
// the conversation kept per project. Read-only: it proposes, the owner applies (Assign, roadmap).
// `mock` (the screen's developer mode) and MULTIAGENT_SIMULATION_ONLY answer from the simulated
// Product Owner: no model call, no cost.
// Registering an issue (#117): `mode: 'issue'` drafts an issue in the same conversation; po:attach
// stores a pasted or dropped file; po:file files the draft on the owner's click (create, append to
// an existing issue's body, or comment), then syncs the backlog; po:discard drops it. `preview`
// and MULTIAGENT_SIMULATION_ONLY only preview: never gh/glab.

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
      params: ['projectId', 'question', 'mock', 'mode', 'attachments'],
      fn: async ({ projectId, question, mock, mode, attachments }) => {
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
          mode: mode === 'issue' ? 'issue' : 'plan',
          attachments: Array.isArray(attachments) ? attachments : [],
        });
      },
    },
    {
      channel: 'po:attach',
      method: 'attachProductOwnerFile',
      params: ['projectId', 'name', 'data'],
      fn: ({ projectId, name, data }) => productOwner.saveAttachment(ctx.ws.backlog, project(projectId), { name, data }),
    },
    { channel: 'po:clear', method: 'clearProductOwner', params: ['projectId'], fn: ({ projectId }) => productOwner.clearConversation(ctx.ws.backlog, project(projectId)) },
    {
      channel: 'po:discard',
      method: 'discardProductOwnerDraft',
      params: ['projectId', 'at'],
      fn: ({ projectId, at }) => productOwner.discardDraft(ctx.ws.backlog, project(projectId), at),
    },
    // Returns fileDraft's result plus, after a real filing, the backlog synced again (syncError when that failed).
    {
      channel: 'po:file',
      method: 'fileProductOwnerDraft',
      params: ['projectId', 'at', 'action', 'number', 'preview'],
      fn: async ({ projectId, at, action, number, preview }) => {
        const id = project(projectId);
        const data = backlog.readBacklog(ctx.ws.backlog, id);
        if (!data) throw new Error('Sync the backlog first: the Product Owner files to the synced repository.');
        const p = projects.readProject(ctx.ws.projects, id);
        const platform = data.platform || workspace.readSettings(ctx.ws).backlogPlatform || backlog.DEFAULT_PLATFORM;
        const res = await productOwner.fileDraft({
          backlogDir: ctx.ws.backlog,
          projectId: id,
          at,
          action,
          number,
          preview: !!preview || simulation.simulationOnly(),
          platform,
          repo: data.repo || p?.repo,
          cached: (data.issues || []).find((i) => i.number === Number(number)) || null,
        });
        if (res.preview) return res;
        // the Backlog shows the new or updated issue right away
        try {
          return { ...res, backlog: ctx.withIssueRuns(await backlog.syncBacklog({ dir: ctx.ws.backlog, project: p, platform })) };
        } catch (e) {
          return { ...res, syncError: e.message, backlog: ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, id)) };
        }
      },
    },
    { channel: 'po:history', method: 'productOwnerHistory', params: ['projectId'], fn: ({ projectId }) => productOwner.readConversation(ctx.ws.backlog, project(projectId)) },
  ];
};
