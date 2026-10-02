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
    // simulated: every item runs as a simulation (mock runs), whatever its own setting; stage: a
    // stage id, to run only that stage (#141: the roadmap pauses when it is done)
    {
      channel: 'roadmap:start',
      method: 'startRoadmap',
      params: ['projectId', 'simulated', 'stage'],
      fn: ({ projectId, simulated, stage }) => ctx.startRoadmap({ projectId, simulated: !!simulated, stage: stage || null }),
    },
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
    // A retry is refused while the item's run is alive (in any app process, #112); when its worktree,
    // or an ended run's of the same issues, still has commits of its own, the answer is the kept-work
    // question { confirm, kept, runId } (#170: Resume the old run / Start from scratch) until
    // `confirmed` (Start from scratch), which lets the item's next start go past that work.
    {
      channel: 'roadmap:item',
      method: 'roadmapItem',
      params: ['projectId', 'itemId', 'action', 'confirmed'],
      fn: async ({ projectId, itemId, action, confirmed }) => {
        const id = project(projectId);
        const item = roadmaps.findItem(roadmaps.readRoadmap(ctx.ws.backlog, id), String(itemId));
        if (action === 'retry' && item && !(item.runId && ctx.runAlive(item.runId))) {
          if (!confirmed) {
            const issues = backlog.itemIssues(item);
            const kept = (item.runId && ctx.keptWorkOfRun(item.runId, issues)) || ctx.keptWorkForIssues(issues);
            if (kept) return { ...current(projectId), confirm: kept.text, kept, runId: kept.runId };
          } else ctx.allowKeptWork(id, item.id);
        }
        roadmaps.itemAction(ctx.ws.backlog, id, String(itemId), String(action), { alive: ctx.runAlive });
        await ctx.dispatchRoadmaps();
        return current(projectId);
      },
    },
  ];
};
