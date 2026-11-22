// Service area: local merges not pushed (feature in Local mode, packages/engine/domains/local/local-push.js). The
// base a project's local runs merge into, what it has that origin has not (cached for the Backlog
// and the sidebar badge), Push / Update and push, the status after a run's `merge: local`, and a
// push conflict handed to a run of the local workflow. A push records a release candidate (#489).
// A local run's start (#805): localRunTarget says a run is local, prepareLocalBase compares its base with
// origin (engine/worktree.js checkLocalBase) and asks, or applies the choice: 'update' fast-forwards, 'continue'
// goes on from the base as it is; a diverged base is never moved. run:start, pipelines:run and the Roadmap call them.

const path = require('path');
const DefaultWorkflow = require('@craftorio/shared/default-workflow');
const { loadWorkflow } = require('../../engine/workflow');
const { worktreeTarget } = require('../../engine/run/checkout');
const { inputValues } = require('../../engine/run/setup');
const { baseCheckMessage, checkLocalBase, fastForwardBase } = require('../../engine/worktree');
const { clientError } = require('../common');
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
    // #861: a local-folder origin with uncommitted changes or a diverged base: nothing moved there; the
    // Backlog's push modal shows the reason and the commands to run by hand (its error line)
    if (!result.pushed && result.commands?.length) {
      throw clientError(`${result.reason} To bring the commits over, run:\n${result.commands.join('\n')}`);
    }
    return afterPush(project.id, result);
  }

  // A push conflict (Update and push found the local base conflicting with origin) handed to a run
  // of the local workflow that merged there last (feature in Local mode when none, #630): its
  // developer merges origin/<base> into the run's branch and resolves the conflict, the change is
  // reviewed, tested, built and verified, then merged locally; Push takes it from there.
  async function resolvePushConflict({ projectId, files = [], mock = false }) {
    const project = gitProject(projectId);
    const last = runs.runsForProject(runs.listRuns(ctx.ws.runs), project).find((r) => r.localMerge?.base && r.file);
    const base = last?.localMerge.base || projectBase(project);
    const status = await localPush.localStatus({ repo: project.folder, base, fetch: false });
    if (status.error) throw new Error(status.error);
    if (!status.behind) throw new Error(`The local ${status.base} already has every commit of origin/${status.base}: push it.`);
    const file = last ? path.basename(last.file) : DefaultWorkflow.LOCAL;
    const wf = loadWorkflow(ctx.projectWorkflowFile(project.id, file));
    if (!wf.inputs?.task) throw new Error(`Workflow ${wf.metadata?.name || file} has no task input to receive the conflict.`);
    const inputs = { task: localPush.conflictTask({ ...status, files: (files || []).map(String) }) };
    for (const [k, def] of Object.entries(wf.inputs)) {
      if (k === 'task') continue;
      if (/^base(_branch)?$/.test(k)) inputs[k] = status.base;
      else if ((def.type || 'string') === 'string' && /path|dir/i.test(k)) inputs[k] = project.folder;
      else if (k === 'language' && last?.inputs?.language) inputs[k] = last.inputs.language;
      // #630: feature's Local mode (the conflict is merged locally, then pushed)
      else if (k === 'mode' && def.enum?.includes('local')) inputs[k] = 'local';
    }
    return ctx.startWorkflowRun({ file, inputs, mock: !!mock, projectId: project.id });
  }

  // After a run's `merge: local`: the project's count of commits not pushed. The push itself is the
  // feature and fix workflows' last step in Local mode (`push_main`, #630; the project auto-push left).
  async function afterLocalMerge(run, { base }) {
    if (!run.projectId || run.mock) return;
    const project = projects.readProject(ctx.ws.projects, run.projectId);
    await refreshLocal(project.id, { fetch: false, base });
  }

  // Projects with local commits not pushed, from the cached checks (sidebar badge; no git here).
  function unpushedProjects() {
    return projects.listProjects(ctx.ws.projects)
      .map((p) => ({ projectId: p.id, name: p.name, local: backlog.readLocal(ctx.ws.backlog, p.id) }))
      .filter((x) => x.local?.ahead > 0)
      .map(({ projectId, name, local }) => ({ projectId, name, base: local.base, ahead: local.ahead, issues: local.issues }));
  }

  // #805: { repo, base } of a run that would start from its local base, or null: a remote or fork run, a
  // workflow without a worktree, one that cannot be read (the start reports that). Synchronous, so a run
  // that is not local still reserves its slot before run:start returns. The inputs as the run gets them:
  // an old workflow name's, then setup.js inputValues (an input's old name, the workflow's defaults).
  function localRunTarget({ file, inputs, projectId = null, workspaceWorkflow = false }) {
    let found = null; // none: a workflow only the repository declares
    try { found = ctx.workflowPath(file); } catch { /* projectWorkflowFile finds it */ }
    try {
      const wf = loadWorkflow(workspaceWorkflow ? found.file : ctx.projectWorkflowFile(projectId, file));
      const cfg = wf.orchestrator?.worktree;
      if (!cfg) return null;
      const values = inputValues(wf.inputs || {}, DefaultWorkflow.aliasInputs(found, inputs) || {});
      const { repo, base, remote, fork } = worktreeTarget(cfg, { inputs: values });
      return !remote && !fork && repo && base ? { repo, base } : null;
    } catch { return null; }
  }

  // #805: the base of a local run before it starts → { confirm, baseCheck } (the person's question: `ask`, no
  // `choice`, a base behind or diverged; nothing changed) or { notices, baseCheck? } for the run's log (baseCheck:
  // it goes on from a base behind or diverged). A real run's own worktree logs what it finds (prepareWorktree); a
  // simulated one has none, so its warning comes from here. With `ask` a person chose 'update': a refusal is an
  // error for their screen and nothing starts; with nobody there it is a warning and the run goes on.
  async function prepareLocalBase({ target, choice = null, ask = false, mock = false }) {
    const check = await checkLocalBase(target);
    const said = baseCheckMessage(check);
    if (!said) return { notices: [] };
    const warned = mock ? [{ level: 'warn', message: `base: ${said}` }] : [];
    if (check.state === 'fetch-failed') return { notices: warned };
    if (!choice && ask) return { confirm: said, baseCheck: check };
    if (choice !== 'update' || !check.canUpdate) return { notices: warned, baseCheck: check };
    const { moved, commit, reason } = await fastForwardBase(target);
    if (moved) return { notices: [{ level: 'info', message: `base: ${target.base} fast-forwarded to origin/${target.base} (${commit.slice(0, 8)})` }] };
    if (ask) throw clientError(`Could not update the local ${target.base}: ${reason}. Nothing was started.`);
    return { notices: [{ level: 'warn', message: `base: could not fast-forward ${target.base}: ${reason}` }, ...warned], baseCheck: check };
  }

  return {
    afterLocalMerge,
    localRunTarget,
    prepareLocalBase,
    pushProject,
    refreshLocal,
    resolvePushConflict,
    unpushedProjects,
  };
};
