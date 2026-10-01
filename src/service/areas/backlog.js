// Service area: a project's Backlog (src/backlog.js). The synced issues with their runs, queue,
// roadmap stage and local status; Assign (queue issues for a workflow, alone or as one group run);
// the queue's dispatch into free run slots; and the issue tracker's "create and queue" / epic
// placement after a run filed issues (#81, #138).

const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const simulation = require('../../engine/simulation');
const workspace = require('../../workspace');
const projects = require('../../projects');
const backlog = require('../../backlog');
const epics = require('../../epics');
const roadmaps = require('../../roadmap');
const runs = require('../../runs');

module.exports = (ctx) => {
  const { host } = ctx;

  // A synced backlog with each issue's runs and place in the queue (computed on every read: runs
  // come and go), plus the queue itself.
  function withIssueRuns(data) {
    if (!data) return null;
    const { ws } = ctx;
    const project = projects.listProjects(ws.projects).find((p) => p.id === data.projectId);
    const list = project ? runs.runsForProject(runs.listRuns(ws.runs), project) : [];
    const live = list.map((r) => {
      const run = ctx.active.get(r.runId);
      const pr = ctx.withPrState(run?.pr || r.pr, r.mock); // the card's PR icon (#84)
      return run ? { ...r, status: 'running', waiting: run.approvals.size > 0, pr } : { ...r, pr };
    });
    const queue = backlog.readQueue(ws.backlog, data.projectId);
    const local = backlog.readLocal(ws.backlog, data.projectId);
    // the roadmap, each item with its run's live state, and each issue's stage ("Roadmap: stage 2")
    const roadmap = ctx.roadmapView(data.projectId, live);
    const stages = roadmaps.issueStages(roadmap);
    const issues = backlog.linkRuns(data.issues, live, queue, local).map((i) => (stages.has(i.number) ? { ...i, roadmap: stages.get(i.number) } : i));
    return { ...data, queue, local, roadmap, autoPush: !!project?.autoPush, autoEpic: !!project?.autoEpic, issues };
  }

  // Queues issues of a project's synced backlog for a workflow and starts the first ones if there
  // are free run slots. Only open issues; the workflow needs a `task` input (the issue goes there).
  // group: the issues go as one run (one branch, one PR/MR), up to the backlogMaxGroup setting; a
  // backlog is one project's, so a group never mixes projects.
  async function assignWorkflow({ projectId, numbers, workflow, inputs, mock, group = false }) {
    const { ws } = ctx;
    const project = projects.readProject(ws.projects, path.basename(String(projectId)));
    const data = backlog.readBacklog(ws.backlog, project.id);
    if (!data) throw new Error('Sync the backlog first.');
    // in the order they were selected
    const issues = [...new Set((numbers || []).map(Number))].map((n) => data.issues.find((i) => i.number === n)).filter((i) => i?.state === 'open');
    if (!issues.length) throw new Error('Select at least one open issue.');
    const maxGroup = workspace.readSettings(ws).backlogMaxGroup || workspace.DEFAULT_SETTINGS.backlogMaxGroup;
    if (group && issues.length > maxGroup) throw new Error(`One run takes at most ${maxGroup} issues (Settings › General › Backlog); ${issues.length} were selected.`);
    const file = path.basename(String(workflow || ''));
    const wf = loadWorkflow(ctx.workflowPath(file).file);
    if (!wf.inputs?.task) throw new Error(`Workflow ${wf.metadata?.name || file} has no task input to receive the issue.`);
    if (!mock) {
      simulation.refuseReal('real runs from the Backlog');
      await host.assertCanRun?.({ mock: false });
    }
    backlog.enqueue(ws.backlog, project.id, { issues, workflow: file, workflowName: wf.metadata?.name || file, inputs: inputs || {}, mock: !!mock, group: !!group });
    // an issue belongs to one plan: assigned here (the screen asked first), it leaves the roadmap's items not started
    roadmaps.dropIssues(ws.backlog, project.id, issues.map((i) => i.number), { alive: ctx.runAlive });
    await dispatchQueue();
    return withIssueRuns(backlog.readBacklog(ws.backlog, project.id));
  }

  // Issue tracker (#81), "create and queue": once the run filed its issues, the project's backlog is
  // synced (the new issues are in it) and they are assigned like the Backlog's Assign does. A
  // simulated run filed nothing real: nothing is queued. Groups respect backlogMaxGroup (one assign
  // per batch), so a long group_with list never makes the assign refuse the whole queue.
  async function queueFiledIssues(run, ev) {
    const { ws } = ctx;
    const maxGroup = workspace.readSettings(ws).backlogMaxGroup || workspace.DEFAULT_SETTINGS.backlogMaxGroup;
    const plan = backlog.filedToQueue({ workflow: run.wf.metadata?.name, status: ev.status, steps: run.ctx.steps, inputs: run.inputs, maxGroup });
    if (!plan || !run.projectId || run.mock) return;
    const project = projects.readProject(ws.projects, run.projectId);
    const platform = run.inputs.git_platform === 'gl' ? 'gitlab' : 'github';
    await backlog.syncBacklog({ dir: ws.backlog, project, platform });
    for (const batch of plan.batches) {
      await assignWorkflow({ projectId: project.id, numbers: batch.numbers, workflow: plan.workflow, inputs: {}, mock: false, group: batch.group });
    }
  }

  // Issue tracker (#81) and epics (#138): the created issues join the existing epic the analyzer
  // matched clearly, only when the project's autoEpic option ("Auto-place new issues") is on and the
  // epic is in the synced backlog. Never creates an epic; a simulated run places nothing.
  async function placeFiledInEpic(run, ev) {
    const { ws } = ctx;
    const plan = epics.filedToEpic({ workflow: run.wf.metadata?.name, status: ev.status, steps: run.ctx.steps });
    if (!plan || !run.projectId || run.mock) return;
    const project = projects.readProject(ws.projects, run.projectId);
    if (!project?.autoEpic) return;
    const platform = run.inputs.git_platform === 'gl' ? 'gitlab' : 'github';
    const synced = await backlog.syncBacklog({ dir: ws.backlog, project, platform });
    const list = synced?.epics || backlog.readBacklog(ws.backlog, project.id)?.epics || [];
    if (!list.some((e) => e.id === plan.epic)) return;
    await epics.applyEpic({ platform, repo: project.repo, epic: { id: plan.epic }, issues: plan.numbers, epics: list });
    await backlog.syncBacklog({ dir: ws.backlog, project, platform });
  }

  // Starts queued issues while there are free run slots: the oldest first across projects, a
  // project at its own limit waiting. A start that fails (budget, missing CLI, bad input) pauses
  // that project's queue with the reason.
  let dispatching = false;
  async function dispatchQueue() {
    if (dispatching || !ctx.ws) return;
    dispatching = true;
    try {
      for (;;) {
        const { ws } = ctx;
        // claimed atomically (with the index): another dispatcher on this workspace never takes it too
        const next = backlog.claimQueued(ws.backlog, (projectId, item) => !ctx.slotProblem({ mock: !!item.mock, projectId }));
        if (!next) return;
        const { projectId, item } = next;
        try {
          const project = projects.readProject(ws.projects, projectId);
          const wf = loadWorkflow(ctx.workflowPath(item.workflow).file);
          // a PR/MR may have been opened for an issue since it was queued: skip it, don't redo the work
          // (an issue of a group leaves the group, which starts with the others)
          if (!item.mock && project.repo) {
            const platform = backlog.readBacklog(ws.backlog, projectId)?.platform || workspace.readSettings(ws).backlogPlatform || backlog.DEFAULT_PLATFORM;
            const prs = await backlog.newPullRequests({ item, platform, repo: project.repo });
            if (prs.length) {
              for (const n of new Set(prs.map((p) => p.issue ?? item.number))) {
                const mine = prs.filter((p) => (p.issue ?? item.number) === n);
                backlog.skipQueued(ws.backlog, projectId, n, `open ${mine.map((p) => `${platform === 'gitlab' ? 'MR !' : 'PR #'}${p.number}`).join(', ')} since it was queued`);
              }
              continue;
            }
          }
          await ctx.startWorkflowRun({
            file: item.workflow, inputs: backlog.runInputs(item, wf, project.folder), mock: item.mock,
            projectId, issues: backlog.itemIssues(item).map(({ number, url, title }) => ({ number, url, title })),
          });
          backlog.unqueue(ws.backlog, projectId, item.number, { cancelGroup: true });
        } catch (e) {
          backlog.setPaused(ws.backlog, projectId, true, `Could not start ${backlog.itemIssues(item).map((i) => `#${i.number}`).join(', ')}: ${e.message}`);
          backlog.releaseQueued(ws.backlog, projectId, item.number);
        }
      }
    } finally {
      dispatching = false;
    }
  }

  return {
    assignWorkflow,
    dispatchQueue,
    placeFiledInEpic,
    queueFiledIssues,
    withIssueRuns,
  };
};
