// Service area: the work in progress that Keep awake (#162, apps/desktop/host/keep-awake.js) keeps the computer
// awake for: the runs in progress (waiting at a gate or not) and the started roadmaps with their
// current stage (the plain Backlog queue is retired, #446: planned work is the roadmap's). Read by
// apps/desktop/host/main.js.

const roadmaps = require('../../domains/roadmap/roadmap');
const { stageCount, stageNumber } = require('@multiagent/shared/roadmap-model');

module.exports = (ctx) => {
  function pendingWork() {
    const { ws } = ctx;
    if (!ws) return { runs: [], roadmaps: [] };
    const runs = [...ctx.active.values()].map((r) => ({ runId: r.runId, waiting: r.approvals.size > 0 }));
    const started = roadmaps.roadmapProjects(ws.backlog).map((projectId) => {
      const r = roadmaps.readRoadmap(ws.backlog, projectId);
      // #284: the disabled stages are counted apart ("roadmap stage 3/6 (1 disabled)"), never as the current one
      const disabled = r.stages.filter((s) => s.disabled).length;
      // #555: the release entries between the stages are not counted
      return { projectId, state: r.state, stage: stageNumber(r, roadmaps.currentStage(r)), of: stageCount(r), ...(disabled ? { disabled } : {}) };
    });
    return { runs, roadmaps: started };
  }

  return {
    pendingWork,
  };
};
