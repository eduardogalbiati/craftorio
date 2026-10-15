// Service area: main stays green (#405, src/base-health.js). A real run's suite step that counted
// failures as pre-existing records them (afterStepFinished, from the run's step.finished event);
// a merge into the local base starts the base check in the background (afterBaseMerge, from
// worktree.merged; at once when the merge was "not tested green"). Both read Settings › Execution
// baseCheck.onRed each time, and file through the project's synced platform and repository. A
// simulated run never reaches here; the check itself runs the suite in simulation, never pushes.

const fs = require('fs');
const path = require('path');
const baseHealth = require('../../base-health');
const backlog = require('../../backlog');
const projects = require('../../projects');
const roadmaps = require('../../roadmap');
const workspace = require('../../workspace');
const simulation = require('../../engine/simulation');
const depsCache = require('../../engine/deps-cache');
const {
  detectTestCommand,
  parseFailures,
  runCommand,
} = require('../../engine/suite-step');

// the base check's whole suite: at most an hour
const CHECK_TIMEOUT_MS = 60 * 60e3;

module.exports = (ctx) => {
  const onRed = () => ({ ...workspace.DEFAULT_SETTINGS.baseCheck, ...(workspace.readSettings(ctx.ws).baseCheck || {}) }).onRed;
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

  // A run's suite step counted failures as pre-existing (#211, #396): record them for its project
  async function afterStepFinished(run, ev) {
    const failures = ev.output?.preexisting_failures;
    if (!run.projectId || run.mock || !Array.isArray(failures) || !failures.length) return null;
    return baseHealth.recordPreexisting(ctx.ws.root, {
      projectId: run.projectId, runId: run.runId, commit: ev.output.base_check?.commit, failures, onRed: onRed(), ...issueTarget(run.projectId),
    });
  }

  // A release run holds the base: the roadmap's release running, or a release workflow of the project at work
  function releaseHoldsBase(projectId) {
    if (roadmaps.readRoadmap(ctx.ws.backlog, projectId).stages.some((s) => s.release?.status === 'running')) return true;
    return [...(ctx.active?.values?.() || [])].some((r) => r.projectId === projectId && /release/i.test(path.basename(String(r.file || ''))));
  }

  // The project's whole suite in the check's clean checkout: dependencies from the shared cache, the
  // detected command, its failures parsed from the log
  async function runSuite({ cwd, env }) {
    const command = detectTestCommand(cwd);
    if (!command) return { failures: [], log: '', error: 'no test command found' };
    await depsCache.ensureDeps({ workDir: cwd, cacheDir: path.join(ctx.ws.cache, 'deps'), env });
    const logFile = path.join(cwd, '..', `${path.basename(cwd)}-suite.log`);
    const r = await runCommand({ command, cwd, env, timeoutMs: CHECK_TIMEOUT_MS, logFile });
    let log = '';
    try { log = fs.readFileSync(logFile, 'utf8'); fs.rmSync(logFile, { force: true }); } catch { /* no log */ }
    const failures = parseFailures(log, { cwd });
    const error = r.timedOut ? 'the suite timed out' : r.error || (r.code && !failures.length ? `the suite exited with ${r.code}, no failure parsed` : null);
    return { failures, log, error };
  }

  // After a run's `merge: local`: the base check, in the background (one at a time, src/base-health.js)
  function afterBaseMerge(run, { base, tested } = {}) {
    if (!run.projectId || run.mock || onRed() === 'off') return null;
    const project = projects.readProject(ctx.ws.projects, run.projectId);
    if (!project.isGit || !base) return null;
    const check = baseHealth.runBaseCheck(ctx.ws.root, {
      projectId: project.id, repo: project.folder, base, onRed: onRed(),
      trigger: tested === 'not green' ? 'not-green' : 'merge',
      releaseHoldsBase: () => releaseHoldsBase(project.id),
      runSuite,
      ...(({ platform, repo, exec }) => ({ platform, ghRepo: repo, exec }))(issueTarget(project.id)),
    });
    check.then((r) => { if (r.status === 'red') console.log(`base check ${project.name}: red at ${r.commit}, ${r.issues.length} issue(s)`); })
      .catch((e) => console.error('base check:', e.message));
    return check;
  }

  return {
    afterBaseMerge,
    afterStepFinished,
  };
};
