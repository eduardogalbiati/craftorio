// Service area: the work in progress that Keep awake (#162, src/host/keep-awake.js) keeps the computer
// awake for: the runs in progress (waiting at a gate or not), the started roadmaps with their
// current stage, and the items of the Backlog queues that are not paused. Read by src/host/main.js.

const backlog = require('../../backlog');
const roadmaps = require('../../roadmap');

module.exports = (ctx) => {
  function pendingWork() {
    const { ws } = ctx;
    if (!ws) return { runs: [], roadmaps: [], queued: 0 };
    const runs = [...ctx.active.values()].map((r) => ({ runId: r.runId, waiting: r.approvals.size > 0 }));
    const started = roadmaps.roadmapProjects(ws.backlog).map((projectId) => {
      const r = roadmaps.readRoadmap(ws.backlog, projectId);
      // #284: the disabled stages are counted apart ("roadmap stage 3/6 (1 disabled)"), never as the current one
      const disabled = r.stages.filter((s) => s.disabled).length;
      return { projectId, state: r.state, stage: roadmaps.currentStage(r) + 1, of: r.stages.length, ...(disabled ? { disabled } : {}) };
    });
    const queued = backlog.queuedProjects(ws.backlog).map((projectId) => backlog.readQueue(ws.backlog, projectId))
      .filter((q) => !q.paused).reduce((n, q) => n + q.items.length, 0);
    return { runs, roadmaps: started, queued };
  }

  return {
    pendingWork,
  };
};
