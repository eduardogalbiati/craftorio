// Service area: the open workspace ({ root, runs, repos, projects, skills, workflows, worktrees,
// settings }, see packages/engine/domains/workspace/workspace.js). Opening one seeds the bundled skills, workflows, pipelines and
// analysis seeds (#360), opens its index, moves a leftover Backlog queue into the roadmap once (#446)
// and lets started roadmaps continue. `ctx.ws` is read at call
// time: it changes with the workspace.

const fs = require('fs');
const path = require('path');
const backlog = require('../../domains/backlog/backlog');
const pipelines = require('../../domains/workflow/pipelines');
const roadmaps = require('../../domains/roadmap/roadmap');
const seeds = require('../../domains/seed/seeds');
const skills = require('../../domains/agents/skills');
const { storeFor } = require('../../domains/workspace/store');
const workflows = require('../../domains/workflow/workflows');
const { BUNDLED_SKILLS_DIR, BUNDLED_WORKFLOWS_DIR } = require('../common');

module.exports = (ctx) => {
  let ws = null;

  const workspaceDir = () => {
    if (!ws) throw new Error('No workspace is open.');
    return ws;
  };

  // Copies/updates the bundled skills, workflows and pipelines (#135) into the workspace.
  function seedDefaults() {
    try { skills.seedSkills(BUNDLED_SKILLS_DIR, ws.skills); } catch (e) { console.error('skill seeding:', e); }
    try { workflows.seedWorkflows(BUNDLED_WORKFLOWS_DIR, ws.workflows); } catch (e) { console.error('workflow seeding:', e); }
    try { pipelines.seedPipelines(pipelines.BUNDLED_PIPELINES_DIR, ws.pipelines); } catch (e) { console.error('pipeline seeding:', e); }
    try { seeds.seedSeeds(seeds.BUNDLED_SEEDS_DIR, ws.seeds); } catch (e) { console.error('analysis seed seeding:', e); }
  }

  function setWorkspace(next) {
    if (ctx.isRunning()) throw new Error('Cannot change the workspace while workflows are running.');
    ws = next;
    seedDefaults();
    // the OS notifications follow its interface language (#329, areas/interface-language.js)
    ctx.applyInterfaceLanguage?.();
    // #607: the runs the app died in, taken over now (areas/recover.js), started below; the index
    // leaves their gates out of its "interrupted" notices
    const recovering = ctx.claimLiveRuns();
    ctx.openIndex({ recovering: recovering.map((r) => r.runId) });
    // the Backlog screen follows the backlog/ files live (#204, areas/backlog-watch.js)
    ctx.watchBacklog();
    // the phone gates page (#226, areas/phone-gates.js), when the owner turned it on
    ctx.resumePhoneGates();
    // processes of finished runs that keep using CPU (#390, areas/runs.js)
    ctx.watchStrayProcesses();
    // #446: a plain queue an older version left becomes a planned roadmap stage, once (never started)
    try {
      roadmaps.moveLeftoverQueues(ws.backlog, {
        fromIndex: storeFor(ws.backlog)?.takeLeftoverQueues() || {},
        issuesOf: (id) => backlog.readBacklog(ws.backlog, id)?.issues || [],
      });
    } catch (e) { console.error('backlog queues:', e); }
    // after an app update's restart (#279, areas/app-update.js): the roadmaps it paused run again,
    // before the dispatch below starts their stage
    ctx.appUpdateAfterRestart();
    // the recovered runs continue first (they hold their slots again, #607); then a started roadmap
    // continues where it was: its runs that ended meanwhile settle their stage (an interrupted one
    // pauses it), the next stage starts when the current one is over
    setTimeout(() => ctx.recoverLiveRuns(recovering)
      .then(() => ctx.dispatchRoadmaps()).catch((e) => console.error('roadmap dispatch:', e)), 0);
    return ws;
  }

  // Workflows are read from the workspace; the bundled copy is a fallback for runs whose workflow
  // file the user deleted (e.g. resuming an old run).
  const workflowDirs = () => [ws.workflows, BUNDLED_WORKFLOWS_DIR];
  const workflowPath = (file) => workflows.resolveWorkflow(path.basename(String(file || '')), workflowDirs());

  // A run's folder under runs/, or an error when it has no events.jsonl.
  function runFolder(runId) {
    const dir = path.join(ws.runs, path.basename(String(runId || '')));
    if (!fs.existsSync(path.join(dir, 'events.jsonl'))) throw new Error(`Run not found: ${runId}`);
    return dir;
  }

  return {
    get ws() { return ws; },
    runFolder,
    setWorkspace,
    workflowDirs,
    workflowPath,
    workspaceDir,
  };
};
