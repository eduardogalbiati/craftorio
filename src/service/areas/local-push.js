// Service area: local merges not pushed (software-development-local-hero, src/domains/local/local-push.js). The
// base a project's local runs merge into, what it has that origin has not (cached for the Backlog
// and the sidebar badge), Push / Update and push, auto-push after a run's `merge: local`, and a
// push conflict handed to a run of the local workflow. A push records a release candidate (#489).

const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const projects = require('../../domains/project/projects');
const backlog = require('../../domains/backlog/backlog');
const localPush = require('../../domains/local/local-push');
const runs = require('../../domains/run/runs');
const notifier = require('../../domains/workspace/notifications');

module.exports = (ctx) => {
  // The base a project's local runs merge into: the newest run's `merge: local`, else the
  // repository's default branch (chosen by localStatus).
  function projectBase(project) {
    return runs.runsForProject(runs.listRuns(ctx.ws.runs), project).find((r) => r.localMerge?.base)?.localMerge.base || null;
  }
  const gitProject = (projectId) => {
    const project = projects.readProject(ctx.ws.projects, path.basename(String(projectId)));
    if (!project.isGit) throw new Error(`The folder of ${project.name} is not a git repository: ${project.folder || '(none)'}.`);
    return project;
  };

  // Checks (fetch: true fetches origin/<base> first) and caches what the project's local base has
  // that origin has not. A failure is cached too (the Backlog then assumes local merges are not pushed).
  async function refreshLocal(projectId, { fetch = true, base = null } = {}) {
    const project = projects.readProject(ctx.ws.projects, path.basename(String(projectId)));
    if (!project.isGit) return null;
    let status;
    try {
      status = await localPush.localStatus({ repo: project.folder, base: base || projectBase(project), fetch });
    } catch (e) {
      status = { error: e.message, ahead: 0, behind: 0, commits: [], issues: [], checkedAt: new Date().toISOString() };
    }
    return backlog.writeLocal(ctx.ws.backlog, project.id, status);
  }

  // The Backlog after a push: the status just written, and a new sync when there is one to redo
  // (the issues the push closed move to Done; a sync that fails keeps the cache).
  async function afterPush(projectId, result) {
    const { ws } = ctx;
    backlog.writeLocal(ws.backlog, projectId, result.status);
    const data = backlog.readBacklog(ws.backlog, projectId);
    // #489: what was pushed is a release candidate (deploy.yml publishes it as an rc prerelease)
    if (result.pushed) {
      try { ctx.recordPushCandidate?.(projectId, result); } catch (e) { console.error('release candidate after push:', e.message); }
    }
    if (result.pushed && data) {
      const project = projects.readProject(ws.projects, projectId);
      await backlog.syncBacklog({ dir: ws.backlog, project, platform: data.platform }).catch((e) => console.error('backlog sync after push:', e.message));
    }
    const { status, ...rest } = result;
    return { ...rest, local: status, backlog: ctx.withIssueRuns(backlog.readBacklog(ws.backlog, projectId)) };
  }

  async function pushProject({ projectId, update = false, base = null }) {
    const project = gitProject(projectId);
    base = base || projectBase(project);
    const result = update ? await localPush.updateAndPush({ repo: project.folder, base }) : await localPush.pushBase({ repo: project.folder, base });
    // a merge conflict (#69) is a row of the notification center too, whoever asked for the push
    if (result.conflict) ctx.notify(notifier.pushConflictNotice({ project, base, files: result.files, error: result.error }), { projectId: project.id });
    return afterPush(project.id, result);
  }

  // A push conflict (Update and push found the local base conflicting with origin) handed to a run
  // of the local workflow that merged there last (software-development-local-hero when none): its
  // developer merges origin/<base> into the run's branch and resolves the conflict, the change is
  // reviewed, tested, built and verified, then merged locally; Push takes it from there.
  async function resolvePushConflict({ projectId, files = [], mock = false }) {
    const project = gitProject(projectId);
    const last = runs.runsForProject(runs.listRuns(ctx.ws.runs), project).find((r) => r.localMerge?.base && r.file);
    const base = last?.localMerge.base || projectBase(project);
    const status = await localPush.localStatus({ repo: project.folder, base, fetch: false });
    if (status.error) throw new Error(status.error);
    if (!status.behind) throw new Error(`The local ${status.base} already has every commit of origin/${status.base}: push it.`);
    const file = last ? path.basename(last.file) : 'software-development-local-hero.yaml';
    const wf = loadWorkflow(ctx.workflowPath(file).file);
    if (!wf.inputs?.task) throw new Error(`Workflow ${wf.metadata?.name || file} has no task input to receive the conflict.`);
    const inputs = { task: localPush.conflictTask({ ...status, files: (files || []).map(String) }) };
    for (const [k, def] of Object.entries(wf.inputs)) {
      if (k === 'task') continue;
      if (/^base(_branch)?$/.test(k)) inputs[k] = status.base;
      else if ((def.type || 'string') === 'string' && /path|dir/i.test(k)) inputs[k] = project.folder;
      else if (k === 'language' && last?.inputs?.language) inputs[k] = last.inputs.language;
    }
    return ctx.startWorkflowRun({ file, inputs, mock: !!mock, projectId: project.id });
  }

  // After a run's `merge: local`: the project's count of commits not pushed, and the push when the
  // project asks for it (auto-push, off by default). A rejected or failed push only notifies: the
  // Backlog's Push / Update and push takes it from there.
  async function afterLocalMerge(run, { base }) {
    if (!run.projectId || run.mock) return;
    const project = projects.readProject(ctx.ws.projects, run.projectId);
    if (project.autoPush && project.isGit) {
      try {
        const r = await pushProject({ projectId: project.id, base });
        if (!r.pushed && r.rejected) throw new Error(`origin moved: use Update and push in the Backlog. ${r.error || ''}`);
      } catch (e) {
        ctx.notify({ kind: 'run', event: 'failed', title: `Auto-push failed: ${project.name}`, body: e.message.slice(0, 180), target: { runId: run.runId, workflow: run.wf.metadata?.name } });
      }
      return;
    }
    await refreshLocal(project.id, { fetch: false, base });
  }

  // Projects with local commits not pushed, from the cached checks (sidebar badge; no git here).
  function unpushedProjects() {
    return projects.listProjects(ctx.ws.projects)
      .map((p) => ({ projectId: p.id, name: p.name, local: backlog.readLocal(ctx.ws.backlog, p.id) }))
      .filter((x) => x.local?.ahead > 0)
      .map(({ projectId, name, local }) => ({ projectId, name, base: local.base, ahead: local.ahead, issues: local.issues }));
  }

  return {
    afterLocalMerge,
    pushProject,
    refreshLocal,
    resolvePushConflict,
    unpushedProjects,
  };
};
