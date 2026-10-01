// Backlog roadmap (src/roadmap.js): ordered stages of runs per project, each stage after the
// previous one merged. Every channel returns the Backlog (withIssueRuns), whose `roadmap` the
// screen shows (src/renderer/backlog-roadmap.js); the service's dispatchRoadmaps runs it.

const path = require('path');
const backlog = require('../../backlog');
const roadmaps = require('../../roadmap');

module.exports = (ctx) => {
  const project = (projectId) => path.basename(String(projectId));
  const current = (projectId) => ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, project(projectId)));
  const synced = (projectId) => backlog.readBacklog(ctx.ws.backlog, project(projectId))?.issues || [];
  return [
    { channel: 'roadmap:get', method: 'getRoadmap', params: ['projectId'], fn: ({ projectId }) => ctx.roadmapView(project(projectId)) },
    // the edited stages ([{ id?, name, note, items: [{ id?, workflow, inputs, mock, issues }] }]); runs are kept by item id
    {
      channel: 'roadmap:save',
      method: 'saveRoadmap',
      params: ['projectId', 'stages'],
      fn: async ({ projectId, stages }) => {
        roadmaps.saveStages(ctx.ws.backlog, project(projectId), stages, { issues: synced(projectId) });
        await ctx.dispatchRoadmaps();
        return current(projectId);
      },
    },
    // The Product Owner's "Build a roadmap" answer (#105): added at the end (or replacing the roadmap), always planned.
    {
      channel: 'roadmap:propose',
      method: 'proposeRoadmap',
      params: ['projectId', 'proposal', 'replace'],
      fn: ({ projectId, proposal, replace }) => {
        const { dropped } = roadmaps.propose(ctx.ws.backlog, project(projectId), proposal, { replace: !!replace, issues: synced(projectId), alive: ctx.runAlive });
        return { ...current(projectId), dropped };
      },
    },
    // The plain queue's items become a planned stage at the end (they leave the queue).
    {
      channel: 'roadmap:from-queue',
      method: 'roadmapFromQueue',
      params: ['projectId'],
      fn: ({ projectId }) => {
        const id = project(projectId);
        const queue = backlog.readQueue(ctx.ws.backlog, id);
        if (!queue.items.length) throw new Error('The queue is empty.');
        roadmaps.propose(ctx.ws.backlog, id, [roadmaps.fromQueue(queue.items)], { issues: synced(id) });
        for (const item of queue.items) backlog.unqueue(ctx.ws.backlog, id, item.number, { cancelGroup: true });
        return current(id);
      },
    },
    // simulated: every item runs as a simulation (mock runs), whatever its own setting
    { channel: 'roadmap:start', method: 'startRoadmap', params: ['projectId', 'simulated'], fn: ({ projectId, simulated }) => ctx.startRoadmap({ projectId, simulated: !!simulated }) },
    // pause: nothing new starts (runs in progress go on); stop: back to a plan
    {
      channel: 'roadmap:pause',
      method: 'pauseRoadmap',
      params: ['projectId', 'stop'],
      fn: ({ projectId, stop }) => {
        roadmaps.setState(ctx.ws.backlog, project(projectId), stop ? 'planned' : 'paused');
        return current(projectId);
      },
    },
    {
      channel: 'roadmap:clear',
      method: 'clearRoadmap',
      params: ['projectId'],
      fn: ({ projectId }) => {
        roadmaps.clearRoadmap(ctx.ws.backlog, project(projectId));
        return current(projectId);
      },
    },
    // retry (the item runs again) or skip (it counts as finished) an item, usually the one that paused the roadmap.
    // A retry is refused while the item's run is alive (in any app process, #112); when its worktree
    // still has commits, the answer is { confirm } (the work it would start again) until `confirmed`.
    {
      channel: 'roadmap:item',
      method: 'roadmapItem',
      params: ['projectId', 'itemId', 'action', 'confirmed'],
      fn: async ({ projectId, itemId, action, confirmed }) => {
        const id = project(projectId);
        const item = roadmaps.findItem(roadmaps.readRoadmap(ctx.ws.backlog, id), String(itemId));
        if (action === 'retry' && item?.runId && !confirmed && !ctx.runAlive(item.runId)) {
          const commits = ctx.runWorktreeCommits(item.runId);
          if (commits) return { ...current(projectId), confirm: `Run ${item.runId} still has ${commits} commit(s) in its worktree. Retry starts the item again from scratch; resuming that run keeps its work. Retry anyway?`, runId: item.runId };
        }
        roadmaps.itemAction(ctx.ws.backlog, id, String(itemId), String(action), { alive: ctx.runAlive });
        await ctx.dispatchRoadmaps();
        return current(projectId);
      },
    },
  ];
};
