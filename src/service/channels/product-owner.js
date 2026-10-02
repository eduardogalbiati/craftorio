// The Backlog's Product Owner (#105, src/product-owner.js): questions about a project's backlog and
// the conversation kept per project. Read-only: it proposes, the owner applies (Assign, roadmap).
// `mock` (the screen's developer mode) and MULTIAGENT_SIMULATION_ONLY answer from the simulated
// Product Owner: no model call, no cost. po:ask's `issues` (#169): the issues the owner selected on
// the Backlog and sent to the Product Owner, read in full and planned with suggested extra issues.
// Registering an issue (#117): `mode: 'issue'` drafts an issue in the same conversation; po:attach
// stores a pasted or dropped file; po:file files the draft on the owner's click (create, append to
// an existing issue's body, or comment), then syncs the backlog; po:discard drops it. `preview`
// and MULTIAGENT_SIMULATION_ONLY only preview: never gh/glab.
// po:file's `epic`: a new issue joins its draft's epic (#138). po:split files a proposed split of an
// issue too big for one run (#124); po:epic creates an epic or places issues in one (#138). Both
// run only on the owner's click, preview like po:file, and sync the backlog after a real write.
// po:ask's `scenario` (#148, simulated only): forces the simulated answer (MOCK_SCENARIOS). Every
// real answer raises a `po` notice (#149, src/notifications.js); a simulated one does not.

const path = require('path');
const agents = require('../../agents');
const backlog = require('../../backlog');
const notifier = require('../../notifications');
const oracle = require('../../oracle');
const productOwner = require('../../product-owner');
const projects = require('../../projects');
const runs = require('../../runs');
const simulation = require('../../engine/simulation');
const usage = require('../../usage');
const workspace = require('../../workspace');
const { resolveCommand } = require('../../engine/providers');

module.exports = (ctx) => {
  const project = (projectId) => path.basename(String(projectId));
  // The synced backlog, its platform and the project: what every write to the platform needs.
  const target = (projectId) => {
    const id = project(projectId);
    const data = backlog.readBacklog(ctx.ws.backlog, id);
    if (!data) throw new Error('Sync the backlog first: the Product Owner writes to the synced repository.');
    const p = projects.readProject(ctx.ws.projects, id);
    const platform = data.platform || workspace.readSettings(ctx.ws).backlogPlatform || backlog.DEFAULT_PLATFORM;
    return { id, data, p, platform, repo: data.repo || p?.repo };
  };
  // After a real write the Backlog shows the new or updated issues right away.
  const resync = async (res, { id, p, platform }) => {
    if (res.preview) return res;
    try {
      return { ...res, backlog: ctx.withIssueRuns(await backlog.syncBacklog({ dir: ctx.ws.backlog, project: p, platform })) };
    } catch (e) {
      return { ...res, syncError: e.message, backlog: ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, id)) };
    }
  };
  return [
    {
      channel: 'po:ask',
      method: 'askProductOwner',
      params: ['projectId', 'question', 'mock', 'mode', 'attachments', 'issues', 'scenario'],
      fn: async ({ projectId, question, mock, mode, attachments, issues, scenario }) => {
        const id = project(projectId);
        const p = projects.readProject(ctx.ws.projects, id);
        const data = ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, id));
        if (!data) throw new Error('Sync the backlog first: the Product Owner reads the synced issues.');
        const simulated = !!mock || simulation.simulationOnly();
        const settings = workspace.readSettings(ctx.ws);
        const out = await productOwner.ask({
          backlogDir: ctx.ws.backlog,
          projectId: id,
          runsDir: ctx.ws.runs,
          question,
          data,
          activeRuns: ctx.activeRuns().filter((r) => r.projectId === id),
          runs: runs.runsForProject(runs.listRuns(ctx.ws.runs), p),
          workflows: ctx.listWorkflows().filter((w) => !w.error && w.inputs?.task),
          folder: p.folder,
          agent: agents.readAgent(ctx.ws.agents, agents.PRODUCT_OWNER_ID),
          skillsDirs: [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR],
          resolveCommand,
          // its own past calls and the Oracle's are in no run: add them to what the runs used this month
          budget: simulated ? null : usage.withPeerUsage(usage.budgetBaseline({ runsDir: ctx.ws.runs, settings, extraRuns: oracle.usageRuns(ctx.ws.oracle) }), productOwner.monthUsage(ctx.ws.backlog), settings.prices),
          mock: simulated,
          mode: mode === 'issue' ? 'issue' : 'plan',
          attachments: Array.isArray(attachments) ? attachments : [],
          // #169: the Backlog's selection sent to the Product Owner (plan mode)
          selection: Array.isArray(issues) ? issues : [],
          // #148: the drawer's simulation-only scenario picker (ignored for a real call)
          scenario: simulated && typeof scenario === 'string' && scenario ? scenario : null,
        });
        // #149: the bell and a desktop notice for a real answer only (not while the window shows this
        // project's drawer); a simulated one shows the avatar's unread dot only
        if (!simulated) ctx.notify?.(notifier.productOwnerNotice({ project: { id, name: p?.name }, message: out.message }), { projectId: id });
        return out;
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
      fn: ({ projectId, at }) => productOwner.discardDraft(ctx.ws.backlog, project(projectId), at, ctx.ws.runs),
    },
    // Returns fileDraft's result plus, after a real filing, the backlog synced again (syncError when that failed).
    {
      channel: 'po:file',
      method: 'fileProductOwnerDraft',
      params: ['projectId', 'at', 'action', 'number', 'preview', 'epic'],
      fn: async ({ projectId, at, action, number, preview, epic }) => {
        const t = target(projectId);
        const res = await productOwner.fileDraft({
          backlogDir: ctx.ws.backlog,
          projectId: t.id,
          runsDir: ctx.ws.runs,
          at,
          action,
          number,
          preview: !!preview || simulation.simulationOnly(),
          platform: t.platform,
          repo: t.repo,
          cached: (t.data.issues || []).find((i) => i.number === Number(number)) || null,
          placeEpic: !!epic,
          epicList: t.data.epics || [],
        });
        return resync(res, t);
      },
    },
    {
      channel: 'po:split',
      method: 'splitProductOwnerIssue',
      params: ['projectId', 'at', 'split', 'preview'],
      fn: async ({ projectId, at, split, preview }) => {
        const t = target(projectId);
        const res = await productOwner.applySplit({
          backlogDir: ctx.ws.backlog, projectId: t.id, runsDir: ctx.ws.runs, at, split, preview: !!preview || simulation.simulationOnly(), platform: t.platform, repo: t.repo, data: t.data,
        });
        return resync(res, t);
      },
    },
    {
      channel: 'po:epic',
      method: 'applyProductOwnerEpic',
      params: ['projectId', 'at', 'key', 'epic', 'issues', 'preview'],
      fn: async ({ projectId, at, key, epic, issues, preview }) => {
        const t = target(projectId);
        const res = await productOwner.applyEpicProposal({
          backlogDir: ctx.ws.backlog, projectId: t.id, runsDir: ctx.ws.runs, at, key, epic, issues, preview: !!preview || simulation.simulationOnly(), platform: t.platform, repo: t.repo, data: t.data,
        });
        return resync(res, t);
      },
    },
    { channel: 'po:history', method: 'productOwnerHistory', params: ['projectId'], fn: ({ projectId }) => productOwner.readConversation(ctx.ws.backlog, project(projectId)) },
  ];
};
