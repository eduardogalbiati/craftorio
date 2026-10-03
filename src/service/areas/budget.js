// Service area: the spending budget (#206, src/budget.js). `budgetNow` is today's (and the Night
// watch's) spending against the caps of settings.json, from the run list (live runs included);
// `budgetBlock` is the cap the next roadmap start would pass, for the roadmaps (areas/roadmap.js) and
// the live roadmap's refills (areas/live-roadmap.js); `budgetAction` is the paused roadmap's "Raise
// for today" / "Resume anyway". The top bar reads `budgetNow` (channel budget:get).

const budget = require('../../budget');
const roadmaps = require('../../roadmap');
const runs = require('../../runs');
const workspace = require('../../workspace');
const { nightWatch } = require('../../oracle-actions');

module.exports = (ctx) => {
  function budgetNow(now = new Date()) {
    const { ws } = ctx;
    const settings = workspace.readSettings(ws);
    const caps = budget.budgetSettings(settings);
    const night = nightWatch(ws.oracle, now.getTime());
    const state = budget.budgetState({ settings, runs: runs.listRuns(ws.runs), night, now });
    return { ...state, caps, text: budget.meterText(state) };
  }

  /** The cap a start of `nextUsd` would pass for this roadmap (null: none, or "Resume anyway" covers it). */
  function budgetBlock(roadmap, nextUsd = 0) {
    const caps = budget.budgetSettings(workspace.readSettings(ctx.ws));
    if (!caps.dailyUsd && !caps.nightlyUsd) return null;
    const state = budgetNow();
    if (budget.waived(roadmap, state)) return null;
    const over = budget.overBudget(state, nextUsd);
    return over ? { ...over, state } : null;
  }

  // "Raise for today" (the cap becomes what is spent plus the next stage, for this day or night) or
  // "Resume anyway" (this roadmap ignores the cap until the day or the night ends); both start it again.
  async function budgetAction({ projectId, action }) {
    const { ws } = ctx;
    const id = String(projectId);
    const r = roadmaps.readRoadmap(ws.backlog, id);
    const state = budgetNow();
    if (action === 'raise') {
      const paused = r.budget || {};
      const period = paused.period || (state.night ? 'night' : 'day');
      const spentUsd = period === 'night' ? state.night?.spentUsd : state.day.spentUsd;
      const settings = workspace.readSettings(ws);
      workspace.writeSettings(ws, { budget: budget.raiseFor(settings, { period, spentUsd, nextUsd: paused.stageUsd ?? paused.nextUsd ?? 0, night: state.night ? { startedAt: state.night.since } : null }) });
      ctx.events.emit('settings:changed', workspace.readSettings(ws));
      roadmaps.setState(ws.backlog, id, 'running');
    } else if (action === 'resume') {
      roadmaps.waiveBudget(ws.backlog, id, budget.waiverKey(state));
    } else {
      throw new Error(`Unknown budget action: ${action}`);
    }
    await ctx.dispatchRoadmaps();
    return roadmaps.readRoadmap(ws.backlog, id);
  }

  return {
    budgetAction,
    budgetBlock,
    budgetNow,
  };
};
