// Service area: main stays green (#405, src/base-health.js). A real run's suite step that counted
// failures as pre-existing has them recorded by the engine; the service files their issue
// (afterStepFinished, from the run's step.finished event); a merge into the local base starts the
// base check in the background (afterBaseMerge, from worktree.merged; at once when the merge was
// "not tested green"). A check deferred while a release run held the base runs when a run of the
// project ends and nothing holds it any more (afterBaseReleased). Both read Settings › Execution
// baseCheck.onRed each time, and file through the project's synced platform and repository. A red
// or failed check is a notice. The fix item runs the project's default development workflow
// (settings.defaultWorkflow through DefaultWorkflow.resolve, read each time, #413). A simulated run
// never reaches here; the check itself runs the suite in simulation, never pushes.

const fs = require('fs');
const path = require('path');
const baseHealth = require('../../base-health');
const backlog = require('../../backlog');
const DefaultWorkflow = require('../../shared/default-workflow');
const projects = require('../../projects');
const roadmaps = require('../../roadmap');
const workspace = require('../../workspace');
const simulation = require('../../engine/simulation');
const depsCache = require('../../engine/deps-cache');
const {
  detectTestCommand,
  parseFailures,
  runCommand,
  suiteDurations,
  suiteTimeout,
} = require('../../engine/suite-step');

module.exports = (ctx) => {
  // projectId -> the merge whose check a release deferred (the latest one: it checks the newest tip)
  const pending = new Map();
  const onRed = () => ({ ...workspace.DEFAULT_SETTINGS.baseCheck, ...(workspace.readSettings(ctx.ws).baseCheck || {}) }).onRed;
  // #413: the fix item runs the default development workflow, as the Product Owner's plans and the Assign dialog
  const fixWorkflow = () => DefaultWorkflow.resolve(
    workspace.readSettings(ctx.ws).defaultWorkflow,
    (ctx.listWorkflows?.() || []).filter((w) => !w.error && w.inputs?.task).map((w) => w.file),
  ).file;
  // where an issue goes: the synced backlog's platform and repository (else the project's); none in simulation
  function issueTarget(projectId) {
    const data = backlog.readBacklog(ctx.ws.backlog, projectId);
    const proj = projects.listProjects(ctx.ws.projects).find((p) => p.id === projectId);
    return {
      platform: data?.platform || workspace.readSettings(ctx.ws).backlogPlatform || backlog.DEFAULT_PLATFORM,
      repo: data?.repo || proj?.repo,
      exec: simulation.simulationOnly() ? async () => '' : backlog.execCli,
    };
  }

  // A run's suite step counted failures as pre-existing (#211, #396): the engine recorded them, the
  // issue they are due is filed here
  async function afterStepFinished(run, ev) {
    const failures = ev.output?.preexisting_failures;
    if (!run.projectId || run.mock || !Array.isArray(failures) || !failures.length) return null;
    return baseHealth.recordPreexisting(ctx.ws.root, {
      projectId: run.projectId, runId: run.runId, commit: ev.output.base_check?.commit, failures, onRed: onRed(), workflow: fixWorkflow(), ...issueTarget(run.projectId),
    });
  }

  // A release run holds the base: the roadmap's release running, or a release run of the project at work
  function releaseHoldsBase(projectId) {
    if (roadmaps.readRoadmap(ctx.ws.backlog, projectId).stages.some((s) => s.release?.status === 'running')) return true;
    return [...(ctx.active?.values?.() || [])].some((r) => r.projectId === projectId && ctx.isReleaseRun(r));
  }

  // #465: the check tells the screens when it starts and ends (`baseCheck:changed`), so its log can be
  // followed live; the last state per project answers `baseCheck:state` (a screen opened meanwhile)
  const states = new Map();
  const logOf = (projectId) => baseHealth.baseCheckLog(ctx.ws.root, projectId);
  function announce(projectId, patch) {
    const state = { ...(states.get(projectId) || {}), ...patch, projectId };
    states.set(projectId, state);
    ctx.events?.emit('baseCheck:changed', state);
    return state;
  }

  // The project's whole suite in the check's clean checkout: dependencies from the shared cache, the
  // detected command with the suite step's timeout (from the project's recent suite durations), its
  // failures parsed from the log. The log stays next to the checkout until the next check (#465)
  const suiteFor = (project) => async ({ cwd, env, commit }) => {
    const logFile = logOf(project.id);
    fs.rmSync(logFile, { force: true });
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    announce(project.id, { status: 'running', commit: commit || null, log: logFile, startedAt: new Date().toISOString(), endedAt: null, failures: null, error: null });
    const command = detectTestCommand(cwd);
    if (!command) return { failures: [], log: '', error: 'no test command found' };
    fs.appendFileSync(logFile, `$ ${command}\n`);
    await depsCache.ensureDeps({ workDir: cwd, cacheDir: path.join(ctx.ws.cache, 'deps'), env });
    const timeoutMs = suiteTimeout(suiteDurations({ file: path.join(ctx.ws.cache, 'suite-durations.json'), key: `${project.folder}\n${command}` }));
    const r = await runCommand({ command, cwd, env, timeoutMs, logFile });
    let log = '';
    try { log = fs.readFileSync(logFile, 'utf8'); } catch { /* no log */ }
    const failures = parseFailures(log, { cwd });
    const error = r.timedOut ? 'the suite timed out' : r.error || (r.code && !failures.length ? `the suite exited with ${r.code}, no failure parsed` : null);
    return { failures, log, error };
  };

  // The owner hears of a red or failed check (a green or deferred one is silent)
  function noticeOf(project, r) {
    const target = { view: 'roadmap', projectId: project.id };
    if (r.status === 'red') {
      const filed = r.issues.length ? ` ${r.issues.length} issue(s) filed or updated${r.fixItem ? ', a fix item is at the front of the roadmap' : ''}.` : '';
      ctx.notify({ kind: 'run', event: 'failed', title: `Base is red: ${project.name}`, body: `The base check found a red test at ${String(r.commit || '').slice(0, 12)}.${filed}`.slice(0, 180), target }, { projectId: project.id });
    } else if (r.status === 'error') {
      ctx.notify({ kind: 'run', event: 'failed', title: `Base check failed: ${project.name}`, body: String(r.error || 'unknown error').slice(0, 180), target }, { projectId: project.id });
    }
  }

  // After a run's `merge: local`: the base check, in the background (one at a time, src/base-health.js)
  function afterBaseMerge(run, { base, tested } = {}) {
    if (!run.projectId || run.mock || onRed() === 'off') return null;
    const project = projects.readProject(ctx.ws.projects, run.projectId);
    if (!project.isGit || !base) return null;
    const check = baseHealth.runBaseCheck(ctx.ws.root, {
      projectId: project.id, repo: project.folder, base, onRed: onRed(), workflow: fixWorkflow(),
      trigger: tested === 'not green' ? 'not-green' : 'merge',
      releaseHoldsBase: () => releaseHoldsBase(project.id),
      runSuite: suiteFor(project),
      ...(({ platform, repo, exec }) => ({ platform, ghRepo: repo, exec }))(issueTarget(project.id)),
    });
    check.then((r) => {
      if (r.status === 'deferred') pending.set(project.id, { run, base, tested });
      else ended(project.id, r);
      noticeOf(project, r);
    }).catch((e) => {
      ended(project.id, { status: 'error', error: e.message });
      noticeOf(project, { status: 'error', error: e.message });
    });
    return check;
  }

  // the check ended: green or red with the count, or the error; its log stays reachable (#465)
  function ended(projectId, r) {
    if (!states.has(projectId)) return;
    announce(projectId, {
      status: r.status, commit: r.commit || states.get(projectId).commit, endedAt: new Date().toISOString(),
      failures: r.status === 'red' ? r.issues?.length ?? null : 0, error: r.error || null,
    });
  }

  // the project's base check as last announced (null when none ran since the service started)
  const baseCheckState = (projectId) => states.get(projectId) || null;

  // A run ended: a check a release deferred runs once nothing holds the project's base any more
  function afterBaseReleased(run) {
    const waiting = run?.projectId && pending.get(run.projectId);
    if (!waiting || releaseHoldsBase(run.projectId)) return null;
    pending.delete(run.projectId);
    return afterBaseMerge(waiting.run, waiting);
  }

  return {
    afterBaseMerge,
    afterBaseReleased,
    afterStepFinished,
    baseCheckLog: logOf,
    baseCheckState,
  };
};
