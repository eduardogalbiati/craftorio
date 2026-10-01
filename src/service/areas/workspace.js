// Service area: the open workspace ({ root, runs, repos, projects, skills, workflows, worktrees,
// settings }, see src/workspace.js). Opening one seeds the bundled skills and workflows, opens its
// index, pauses the Backlog queues and lets started roadmaps continue. `ctx.ws` is read at call
// time: it changes with the workspace.

const fs = require('fs');
const path = require('path');
const backlog = require('../../backlog');
const skills = require('../../skills');
const workflows = require('../../workflows');
const { BUNDLED_SKILLS_DIR, BUNDLED_WORKFLOWS_DIR } = require('../common');

module.exports = (ctx) => {
  let ws = null;

  const workspaceDir = () => {
    if (!ws) throw new Error('No workspace is open.');
    return ws;
  };

  // Copies/updates the bundled skills and workflows into the workspace.
  function seedDefaults() {
    try { skills.seedSkills(BUNDLED_SKILLS_DIR, ws.skills); } catch (e) { console.error('skill seeding:', e); }
    try { workflows.seedWorkflows(BUNDLED_WORKFLOWS_DIR, ws.workflows); } catch (e) { console.error('workflow seeding:', e); }
  }

  function setWorkspace(next) {
    if (ctx.isRunning()) throw new Error('Cannot change the workspace while workflows are running.');
    ws = next;
    seedDefaults();
    ctx.openIndex();
    // queued issues never start on their own after a restart or a workspace change
    try { backlog.pauseAll(ws.backlog, 'Paused when the app started: resume to start the queued issues.'); } catch (e) { console.error('backlog queues:', e); }
    // a started roadmap continues where it was: its runs that ended meanwhile settle their stage
    // (an interrupted one pauses it), the next stage starts when the current one is over
    setTimeout(() => ctx.dispatchRoadmaps().catch((e) => console.error('roadmap dispatch:', e)), 0);
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
