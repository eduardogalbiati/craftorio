// Service area: the live roadmap's refill (#164, src/live-roadmap.js). When `advance` asks for one
// (a live roadmap's last stage ended), refillRoadmap checks the daily budget (and the spending budget, #206), syncs the backlog first
// (setting refreshFirst; never in a simulation), asks the Product Owner the fixed refill question
// about the issues it may pick (the simulated Product Owner in a simulated roadmap or
// MULTIAGENT_SIMULATION_ONLY: no model call), adds its first stages as planned stages and dispatches
// the roadmap again. One refill per project at a time; the outcome is the roadmap's liveRefill and a
// notification. It never answers a gate and never starts anything but the roadmap's own items.

const agents = require('../../agents');
const backlog = require('../../backlog');
const live = require('../../live-roadmap');
const notifier = require('../../notifications');
const productOwner = require('../../product-owner');
const projects = require('../../projects');
const roadmaps = require('../../roadmap');
const runs = require('../../runs');
const simulation = require('../../engine/simulation');
const usage = require('../../usage');
const workspace = require('../../workspace');
const { resolveCommand } = require('../../engine/providers');

module.exports = (ctx) => {
  const refilling = new Set();

  // a run of the roadmap, for the daily budget
  const runCost = (runId) => {
    const r = runs.readRun(ctx.ws.runs, runId);
    return r ? { costUsd: r.costUsd || 0, startedAt: r.startedAt } : null;
  };

  // Records a refill's outcome (live.applyRefill: may end or pause the roadmap) and notifies it.
  function record(projectId, refill, project) {
    const at = new Date().toISOString();
    roadmaps.updateRoadmap(ctx.ws.backlog, projectId, (r) => live.applyRefill(r, { at, ...refill }));
    if (refill.status !== 'refilling' && refill.status !== 'off') {
      ctx.notify(notifier.liveRoadmapNotice({ project: { id: projectId, name: project?.name }, refill }), { projectId });
    }
  }

  async function refill(projectId) {
    const { ws } = ctx;
    const before = roadmaps.readRoadmap(ws.backlog, projectId);
    if (!before.live || before.state !== 'running') return false;
    const settings = workspace.readSettings(ws);
    const opts = live.liveSettings(settings);
    let p = null;
    try { p = projects.readProject(ws.projects, projectId); } catch { /* reported below */ }
    const blocked = live.budgetProblem(live.spentToday({ roadmap: before, runCost }), opts);
    if (blocked) { record(projectId, { status: 'budget', message: blocked }, p); return false; }
    // #206: the workspace's spending budget (Settings › Budget) stops refills too (the Product Owner's answer costs)
    const capped = before.simulated ? null : ctx.budgetBlock(before, 0);
    if (capped) {
      const when = capped.period === 'night' ? 'tonight' : 'today';
      record(projectId, { status: 'budget', message: `Live roadmap: the budget is reached (US$ ${capped.spentUsd.toFixed(2)} of US$ ${capped.limitUsd.toFixed(2)} ${when}): no refill until it is raised.` }, p);
      return false;
    }
    if (!p) { record(projectId, { status: 'failed', message: `Live roadmap: the project ${projectId} no longer exists.` }, p); return false; }
    const simulated = !!before.simulated || simulation.simulationOnly();
    record(projectId, { status: 'refilling', message: 'The Product Owner is picking the next issues.' }, p);
    const cached = backlog.readBacklog(ws.backlog, projectId);
    const platform = cached?.platform || settings.backlogPlatform || backlog.DEFAULT_PLATFORM;
    // the Product Owner reads current issues; a sync that fails leaves the last one
    if (opts.refreshFirst && !simulated && p.repo) {
      try {
        const synced = await backlog.syncBacklog({ dir: ws.backlog, project: p, platform });
        roadmaps.refreshCopies(ws.backlog, projectId, synced?.issues || []);
      } catch (e) { console.error('live roadmap: sync before the refill:', e.message); }
    }
    const data = ctx.withIssueRuns(backlog.readBacklog(ws.backlog, projectId));
    if (!data) { record(projectId, { status: 'failed', message: 'Live roadmap: sync the backlog first: the Product Owner reads the synced issues.' }, p); return false; }
    const maxGroup = settings.backlogMaxGroup || workspace.DEFAULT_SETTINGS.backlogMaxGroup;
    const picks = live.candidates(data, opts).slice(0, opts.maxStages * maxGroup);
    const nothing = `Live roadmap: nothing left under complexity ${opts.complexityCap}. Start tries again.`;
    if (!picks.length) { record(projectId, { status: 'empty', message: nothing }, p); return false; }
    // #235: the workflow and options last chosen in the Product Owner's drawer for this project
    const chosen = productOwner.lastWorkflow(ws.backlog, projectId);
    const out = await productOwner.ask({
      backlogDir: ws.backlog,
      projectId,
      runsDir: ws.runs,
      question: live.refillQuestion(opts),
      workflow: chosen?.workflow || null,
      inputs: chosen?.inputs || null,
      data,
      activeRuns: ctx.activeRuns().filter((r) => r.projectId === projectId),
      runs: runs.runsForProject(runs.listRuns(ws.runs), p),
      workflows: ctx.listWorkflows().filter((w) => !w.error && w.inputs?.task),
      defaultWorkflow: settings.defaultWorkflow, // #195
      folder: p.folder,
      agent: agents.readAgent(ws.agents, agents.PRODUCT_OWNER_ID),
      skillsDirs: [ws.skills, ctx.BUNDLED_SKILLS_DIR],
      resolveCommand,
      // as po:ask: its own and the Oracle's calls count in the monthly budget (a blocking one refuses)
      budget: simulated ? null : usage.withPeerUsage(usage.budgetBaseline({ runsDir: ws.runs, settings, extraRuns: ctx.agentUsageRuns() }), productOwner.monthUsage(ws.backlog, new Date(), settings.timeZone), settings.prices),
      timeZone: settings.timeZone, // #273
      mock: simulated,
      mode: 'plan',
      selection: picks.map((i) => i.number),
    });
    const message = out.message || {};
    const costUsd = message.costUsd || 0;
    if (message.error) {
      const budget = /budget/i.test(message.text || '');
      record(projectId, { status: budget ? 'budget' : 'failed', costUsd, message: `Live roadmap: ${budget ? 'no more refills: ' : 'the Product Owner could not answer: '}${message.text}` }, p);
      return false;
    }
    const at = new Date();
    const stages = live.refillStages(message.answer, {
      allowed: new Set(picks.map((i) => i.number)), maxStages: opts.maxStages, maxGroup, mock: simulated, origin: message.ts || '', note: live.refillNote(at, costUsd),
    });
    // the owner may have turned live off, paused or stopped the roadmap while the Product Owner answered
    const now = roadmaps.readRoadmap(ws.backlog, projectId);
    if (!now.live || now.state !== 'running') {
      record(projectId, { status: 'off', costUsd, message: 'Live roadmap turned off during the refill: nothing was added.' }, p);
      return false;
    }
    if (!stages.length) { record(projectId, { status: 'empty', costUsd, message: nothing }, p); return false; }
    const { roadmap } = roadmaps.propose(ws.backlog, projectId, { stages }, { issues: data.issues, alive: ctx.runAlive, keepRunning: true });
    const added = roadmap.stages.length - now.stages.length;
    if (!added) { record(projectId, { status: 'empty', costUsd, message: nothing }, p); return false; }
    record(projectId, { status: 'added', added, costUsd, message: `${live.refillNote(at, costUsd)} +${added} stage${added === 1 ? '' : 's'}.` }, p);
    return true;
  }

  /**
   * Refills a live roadmap whose last stage ended (not awaited by the dispatch: the Product Owner's
   * answer takes minutes). A second call while one runs is ignored. After stages were added, the
   * roadmap is dispatched again; any other outcome ended or paused it (no loop).
   */
  function refillRoadmap(projectId) {
    if (!ctx.ws || refilling.has(projectId)) return Promise.resolve(false);
    refilling.add(projectId);
    return refill(projectId)
      .catch((e) => {
        console.error('live roadmap:', projectId, e);
        try { record(projectId, { status: 'failed', message: `Live roadmap: the refill failed: ${e.message}` }, null); } catch { /* the roadmap is gone */ }
        return false;
      })
      .then(async (added) => {
        refilling.delete(projectId);
        if (added) await ctx.dispatchRoadmaps();
        return added;
      });
  }

  return {
    refillRoadmap,
  };
};
