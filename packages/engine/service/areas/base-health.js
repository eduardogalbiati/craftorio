// Service area: main stays green (#405, packages/engine/domains/project/base-health.js). A real run's suite step that counted
// failures as pre-existing has them recorded by the engine; the service files their issue
// (afterStepFinished, from the run's step.finished event); the base check runs in the background
// (#749): once per roadmap stage (afterStageEnded, from areas/roadmap.js when a stage's last item
// ended; a roadmap run's merge only records the base), after a merge outside the roadmap (afterBaseMerge,
// from worktree.merged; merges before the check starts share it, on the latest tip), and at once
// when the merge was "not tested green". A check with nothing new since the last green one is
// `skipped` and the base reads green at that commit. A check deferred while a release run held the base runs when a run of the
// project ends and nothing holds it any more (afterBaseReleased). Both read Settings › Execution
// baseCheck.onRed each time, and file through the project's synced platform and repository. A red
// or failed check is a notice. #598: the check's checkout gets its dependencies before the suite (the
// shared cache, else the project's own install, both in the check's log); a check that could not run
// (`error`: the install failed, no test command, the runner crashed) is one engine log line naming the
// reason and the log, and a "Base check could not run" notice, never an issue or a fix item; #71: with no
// test file either it ends `no_tests`, without a notice. The fix item runs the project's default development workflow
// (#413; #790: projects.projectDefaultWorkflow, the project's own, its manifest's or its first build
// workflow, read each time, never a setting). A simulated run
// never reaches here; the check itself runs the suite in simulation, never pushes.
// #527: the check waits for the machine-wide suite slot (announced `waiting`, "base check waiting for
// the suite slot", and in the server log) and inserts no fix item for an issue a live run works on
// (ctx.liveRunForIssues). #613: with failures, the failed tests' files run once more in one command
// (rerunFor, its own log) before anything is filed. #78: a test the runner cancelled or never finished
// is not red: a round with only cancelled tests is an `error` ("the suite was cut short: N file(s)
// cancelled, 0 failed"). #85: the check is off unless Settings › Execution › Base check turns it on.

const fs = require('fs');
const path = require('path');
const baseHealth = require('../../domains/project/base-health');
const backlog = require('../../domains/backlog/backlog');
const DefaultWorkflow = require('@craftorio/shared/default-workflow');
const { isRelease } = require('@craftorio/shared/roadmap-model');
const projects = require('../../domains/project/projects');
const roadmaps = require('../../domains/roadmap/roadmap');
const workspace = require('../../domains/workspace/workspace');
const { projectListing } = require('../seed-runs');
const simulation = require('../../engine/simulation');
const depsCache = require('../../engine/deps-cache');
const {
  detectTestCommand,
  FILE_TIMEOUT_MS,
  filteredCommand,
  parseFailures,
  runCommand,
  suiteDurations,
  suiteTimeout,
} = require('../../engine/suite-step');
const {
  fitsCommandLine,
  takesFileList,
  TEST_FILES_ENV,
} = require('../../engine/suite-command-line');
const { folderHasTests } = require('../../engine/test-paths');
const { splitCancelled } = require('../../engine/suite-counts');

module.exports = (ctx) => {
  // projectId -> the merge whose check a release deferred (the latest one: it checks the newest tip)
  const pending = new Map();
  const onRed = () => ({ ...workspace.DEFAULT_SETTINGS.baseCheck, ...(workspace.readSettings(ctx.ws).baseCheck || {}) }).onRed;
  // #413, #790: the fix item runs the project's default development workflow, as the Product Owner's
  // plans and the Assign dialog, among the project's workflows (its repository's too); one that was
  // deleted or renamed falls back to an installed one
  function fixWorkflow(projectId) {
    const project = projects.listProjects(ctx.ws.projects).find((p) => p.id === projectId);
    return DefaultWorkflow.resolve(projects.projectDefaultWorkflow(project), projectListing(ctx, project).filter((w) => w.inputs?.task).map((w) => w.file)).file;
  }
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
      projectId: run.projectId, runId: run.runId, commit: ev.output.base_check?.commit, failures, onRed: onRed(), workflow: fixWorkflow(run.projectId), ...issueTarget(run.projectId),
    });
  }

  // A release run holds the base: the roadmap's release running, or a release run of the project at work
  function releaseHoldsBase(projectId) {
    if (roadmaps.readRoadmap(ctx.ws.backlog, projectId).stages.some((s) => isRelease(s) && s.status === 'running')) return true; // #555: a release entry
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

  // #598: the checkout's dependencies, into the check's log: the shared cache when it serves the
  // project, else the project's own install (`npm ci --no-audit --no-fund` for npm) → null or the reason it failed
  async function depsFor(project, { cwd, env, logFile }) {
    const write = (line) => fs.appendFileSync(logFile, `${line}\n`);
    const ignoreScripts = !!project.ignoreInstallScripts;
    const t0 = Date.now();
    let r;
    try {
      r = await depsCache.ensureDeps({ workDir: cwd, cacheDir: path.join(ctx.ws.cache, 'deps'), project: project.id, env, ignoreScripts, log: (level, message) => write(message) });
    } catch (e) { r = { status: 'failed', reason: e.message }; }
    const took = () => `in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
    const m = r.status === 'not_cached' && depsCache.MANAGERS.find((x) => x.lockfile === r.lockfile);
    if (m) {
      const args = depsCache.installArgs(m, ignoreScripts);
      write(`dependencies (${r.lockfile}): not cached (${r.reason}); $ ${m.manager} ${args.join(' ')}`);
      const i = await depsCache.runCommand(m.manager, args, { cwd, env });
      if (i.output) write(String(i.output).trimEnd());
      if (i.code !== 0) {
        const why = i.timedOut ? 'the install timed out' : `${m.manager} ${args[0]} exited ${i.code ?? '?'}`;
        write(`dependencies: ${why} ${took()}`);
        return `dependencies: ${why} (see the check's log)`;
      }
      write(`dependencies: installed in the checkout ${took()}`);
      return null;
    }
    if (r.status === 'failed') {
      write(`dependencies (${r.lockfile || '?'}): the install failed ${took()}: ${r.reason}`);
      return `dependencies: the install failed: ${r.reason}`;
    }
    write(r.status === 'none' ? 'dependencies: no lockfile, nothing installed' : `dependencies (${r.lockfile}): ${r.status}${r.key ? ` (key ${r.key})` : ''}${r.reason ? `: ${r.reason}` : ''} ${took()}`);
    return null;
  }

  // The project's whole suite in the check's clean checkout: dependencies first (#598), the
  // detected command with the suite step's timeout (from the project's recent suite durations), its
  // failures parsed from the log. The log stays next to the checkout until the next check (#465)
  const suiteFor = (project) => async ({ cwd, env, commit }) => {
    const logFile = logOf(project.id);
    fs.rmSync(logFile, { force: true });
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    announce(project.id, { status: 'running', message: null, holder: null, commit: commit || null, log: logFile, startedAt: new Date().toISOString(), endedAt: null, failures: null, error: null });
    const command = detectTestCommand(cwd);
    if (!command) {
      // #71: no test file either: nothing to run, not a failure
      const noTests = await folderHasTests(cwd) === false;
      fs.appendFileSync(logFile, noTests ? 'not run: the project has no tests\n' : 'no test command found\n');
      return { failures: [], log: '', ...(noTests ? { noTests } : { error: 'no test command found' }) };
    }
    const depsError = await depsFor(project, { cwd, env, logFile });
    if (depsError) return { failures: [], log: '', error: depsError };
    fs.appendFileSync(logFile, `$ ${command}\n`);
    const timeoutMs = suiteTimeout(suiteDurations({ file: path.join(ctx.ws.cache, 'suite-durations.json'), key: `${project.folder}\n${command}` }));
    const r = await runCommand({ command, cwd, env, timeoutMs, logFile });
    let log = '';
    try { log = fs.readFileSync(logFile, 'utf8'); } catch { /* no log */ }
    const { failures, cutShort } = redOf(log, cwd, 'the suite');
    const error = r.timedOut ? 'the suite timed out' : r.error || cutShort || (r.code && !failures.length ? `the suite exited with ${r.code}, no failure parsed` : null);
    return { failures, log, error };
  };

  // #78: the failures of a log without the tests the runner cancelled or never finished; only
  // cancelled ones: `cutShort` names why the round says nothing about the tests
  function redOf(log, cwd, what) {
    const { failed, cancelled } = splitCancelled(log, parseFailures(log, { cwd }));
    const files = new Set(cancelled.map((f) => f.file || f.test));
    return { failures: failed, cutShort: !failed.length && cancelled.length ? `${what} was cut short: ${files.size} file(s) cancelled, 0 failed` : null };
  }

  // #613: the second round, the failed tests' files in one command in the check's checkout (on the
  // command line, else through the list file of #553/#597 when the runner reads one), its log next to
  // the suite's (base-check-<project>-rerun.log, the list beside it as -rerun.files.txt)
  const rerunFor = (project) => async ({ cwd, env, files }) => {
    const logFile = logOf(project.id).replace(/-suite\.log$/, '-rerun.log');
    fs.rmSync(logFile, { force: true });
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const command = detectTestCommand(cwd);
    if (!command) {
      fs.appendFileSync(logFile, 'no test command found\n');
      return { failures: [], log: '', error: 'no test command found' };
    }
    let run = filteredCommand(command, files);
    let listEnv = {};
    if (!run || !fitsCommandLine(run)) {
      if (!takesFileList(command, cwd)) {
        fs.appendFileSync(logFile, `the command cannot run ${files.length} file(s) on their own: ${command}\n`);
        return { failures: [], log: '', error: `${command} cannot run the failed files on their own` };
      }
      const list = logFile.replace(/\.log$/, '.files.txt');
      fs.writeFileSync(list, `${files.join('\n')}\n`);
      run = command;
      listEnv = { [TEST_FILES_ENV]: list };
    }
    fs.appendFileSync(logFile, `$ ${run}\n# ${files.length} file(s) re-run in the base check: they failed in the whole suite\n`);
    const timeoutMs = Math.min(FILE_TIMEOUT_MS * files.length, suiteTimeout(suiteDurations({ file: path.join(ctx.ws.cache, 'suite-durations.json'), key: `${project.folder}\n${command}` })));
    const r = await runCommand({ command: run, cwd, env: { ...env, ...listEnv }, timeoutMs, logFile });
    let log = '';
    try { log = fs.readFileSync(logFile, 'utf8'); } catch { /* no log */ }
    const { failures, cutShort } = redOf(log, cwd, 'the re-run');
    const error = r.timedOut ? 'the re-run timed out' : r.error || cutShort || (r.code && !failures.length ? `the re-run exited with ${r.code}, no failure parsed` : null);
    return { failures, log, error };
  };

  // #527: the wait for the machine-wide suite slot, in the server log and on the Roadmap
  const slotFor = (project) => ({
    holder: `base-check ${project.id}`,
    onWait: (holder) => announce(project.id, {
      status: 'waiting', message: 'base check waiting for the suite slot', holder: holder?.holder || null,
      commit: null, startedAt: null, endedAt: null, failures: null, error: null,
    }),
  });
  const serverLog = (level, message) => (level === 'warn' || level === 'error' ? console.warn : console.log)(String(message).startsWith('base check') ? message : `base check: ${message}`);
  // the runs active while the check ran: the load a "red in the whole suite, green on the re-run" line names
  const load = () => [...(ctx.active?.values?.() || [])].map((r) => r.runId).filter(Boolean);

  // The owner hears of a red or failed check (a green or deferred one is silent)
  function noticeOf(project, r) {
    const target = { view: 'roadmap', projectId: project.id };
    if (r.status === 'red') {
      const filed = r.issues.length ? ` ${r.issues.length} issue(s) filed or updated${r.fixItem ? ', a fix item is at the front of the roadmap' : ''}.` : '';
      ctx.notify({ kind: 'run', event: 'failed', title: `Base is red: ${project.name}`, body: `The base check found a red test at ${String(r.commit || '').slice(0, 12)}.${filed}`.slice(0, 180), target }, { projectId: project.id });
    } else if (r.status === 'error') {
      // #598: nothing is known about the tests: no issue, no fix item, the reason and the engine log line
      serverLog('warn', `base check could not run for ${project.id}: ${r.error || 'unknown error'} (log: ${logOf(project.id)})`);
      ctx.notify({ kind: 'run', event: 'failed', title: `Base check could not run: ${project.name}`, body: `Base check could not run: ${String(r.error || 'unknown error')}`.slice(0, 180), target }, { projectId: project.id });
    }
  }

  // #749: projectId -> the base a roadmap stage merged into (checked once, when the stage ends)
  const stageBases = new Map();
  // #749: projectId -> the check of merges outside the roadmap not started yet (later merges share it)
  const queued = new Map();
  // #749: a roadmap run: an item of the project's roadmap names it
  function roadmapRun(projectId, runId) {
    if (!runId) return false;
    try {
      return !!roadmaps.itemOfRun(roadmaps.readRoadmap(ctx.ws.backlog, projectId), runId);
    } catch { return false; }
  }

  // After a run's `merge: local`: at once when "not tested green"; a roadmap run's waits for its
  // stage's end (#749, afterStageEnded); a run outside the roadmap gets one, shared with the merges
  // that come before it starts (it checks the latest tip)
  function afterBaseMerge(run, { base, tested } = {}) {
    if (!run.projectId || run.mock || onRed() === 'off') return null;
    const project = projects.readProject(ctx.ws.projects, run.projectId);
    if (!project.isGit || !base) return null;
    if (tested === 'not green') return startCheck(project, { base, trigger: 'not-green' });
    if (roadmapRun(project.id, run.runId)) {
      stageBases.set(project.id, base);
      return null;
    }
    const waiting = queued.get(project.id);
    if (waiting && waiting.base === base) return waiting.check;
    const entry = { base };
    const forget = () => { if (queued.get(project.id) === entry) queued.delete(project.id); };
    entry.check = startCheck(project, { base, trigger: 'merge', onStart: forget });
    queued.set(project.id, entry);
    entry.check.finally(forget).catch(() => {});
    return entry.check;
  }

  // #749: a roadmap stage ended (its last item merged or finished without merging; areas/roadmap.js):
  // one check on the base tip, none when nothing of the stage merged (no base given or recorded)
  function afterStageEnded(projectId, { base } = {}) {
    if (!projectId || onRed() === 'off') return null;
    const project = projects.readProject(ctx.ws.projects, projectId);
    const on = base || stageBases.get(project.id);
    if (!project.isGit || !on) return null;
    stageBases.delete(project.id);
    return startCheck(project, { base: on, trigger: 'stage' });
  }

  // The base check, in the background (one at a time, packages/engine/domains/project/base-health.js)
  function startCheck(project, { base, trigger, onStart }) {
    const check = baseHealth.runBaseCheck(ctx.ws.root, {
      projectId: project.id, repo: project.folder, base, onRed: onRed(), workflow: fixWorkflow(project.id),
      trigger,
      onStart,
      releaseHoldsBase: () => releaseHoldsBase(project.id),
      runSuite: suiteFor(project),
      rerunFiles: rerunFor(project),
      slot: slotFor(project),
      log: serverLog,
      load,
      liveRunForIssues: (list) => ctx.liveRunForIssues?.(list) || null,
      ...(({ platform, repo, exec }) => ({ platform, ghRepo: repo, exec }))(issueTarget(project.id)),
    });
    check.then((r) => {
      if (r.status === 'deferred') pending.set(project.id, { base, trigger });
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
    // #749: nothing new since the last green check: the base reads green at that commit, no run
    if (r.status === 'skipped') {
      announce(projectId, { status: 'green', commit: r.commit || null, endedAt: new Date().toISOString(), failures: 0, error: null, skipped: true });
      return;
    }
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
    if (onRed() === 'off') return null;
    const project = projects.readProject(ctx.ws.projects, run.projectId);
    return project.isGit ? startCheck(project, waiting) : null;
  }

  return {
    afterBaseMerge,
    afterBaseReleased,
    afterStageEnded,
    afterStepFinished,
    baseCheckLog: logOf,
    baseCheckState,
  };
};
