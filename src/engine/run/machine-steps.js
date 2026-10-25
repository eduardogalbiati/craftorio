// @ts-check
// Steps without an agent (#250, from src/engine/workflow.js): `type: screenshots` (`runScreenshots`,
// #144), `type: suite` (`runSuiteStep` naming its command for a pause #368, `suiteRounds`, `suiteRound` with the memory guard's waits and reruns #276,
// the machine-wide suite slot of a whole-suite round and its `suite_slot` log while it waits #455,
// `redCheckOutput` #220, `failedFirstRound` for `scope: failed` #324), `type: test_ids`
// (`runTestIdsStep`, #246), `type: check` (`runCheckStep`, the project's rule checks, #404), `type:
// workflow` child runs (`runChildWorkflows`, #174), `type: release_version` (`runReleaseVersionStep`,
// #325), and the evidence a step leaves (`recordEvidence`, `saveScenarios`). #465: a suite, check or
// screenshots step emits step.log { step_id, path, command } when its command's log starts (its live
// terminal follows it); a wait for memory or the suite slot is written to that log as it starts.
// The steps' own logic is src/engine/suite-step.js, screenshot-step.js, test-ids.js, check-step.js and workflow-step.js;
// what they run on the machine goes through the run's machine adapter (`this.machine`, #353).

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const capabilities = require('../capabilities');
const checkStep = require('../check-step');
const { childEnv } = require('../child-env');
const evidence = require('../../domains/evidence/evidence');
const scenarios = require('../scenarios');
const suiteStep = require('../suite-step');
const { changedFiles, selectionLines } = require('../affected-tests');
const { machineSlotDir } = require('../machine-slot');
const { runWorkflowStep } = require('../workflow-step');
const testIds = require('../test-ids');
const { previousTag } = require('../../domains/releases/release-city');
const { releaseSemver } = require('../../domains/releases/releases');
const { render } = require('./templates');
const { parseDuration, renderFileList } = require('./load');
const { pausedError } = require('./resume');
const { gib } = require('./turns');

// #276: a suite / e2e step waits at most this long for memory before it starts, and reruns at most
// this many times a round that failed during a memory incident
const MEMORY_WAIT_MS = 10 * 60e3;
const MAX_ENV_RERUNS = 2;

// The name of a suite step's round log (logs/<name>.log): suite-<visit> for the `suite` step, else
// <step>-<visit> (an e2e step, #223); an environment rerun adds -env, -env-2… (#276)
function envSuffix(reruns) {
  return reruns ? `-env${reruns > 1 ? `-${reruns}` : ''}` : '';
}

function roundLogName(stepId, visit, reruns) {
  const env = envSuffix(reruns);
  return stepId === 'suite' && !env ? `suite-${visit}` : `${stepId}-${visit}${env}`;
}

// #364: the commit a suite round tests and whether the worktree was clean when it started (no
// uncommitted or untracked change), or { commit: null, clean: false } without a git checkout
function testedTree(dir) {
  if (!dir) return { commit: null, clean: false };
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const commit = git('rev-parse', 'HEAD').trim() || null;
    return { commit, clean: !!commit && git('status', '--porcelain').trim() === '' };
  } catch {
    return { commit: null, clean: false };
  }
}

// #378: the tag before the release `version` (release.yaml's `previous_version` output, the `since`
// a refactor-proposals stage reads), as the Release city tab names it (src/domains/releases/release-city.js
// previousTag: semver order for a semver name, even before Ship tags it); a name that is not a
// semver and not tagged yet: the newest tag reachable from HEAD. '' without a git checkout or a tag
async function previousReleaseTag(dir, version) {
  if (!dir || !fs.existsSync(dir)) return '';
  const tag = await previousTag(dir, version);
  if (tag || releaseSemver(version)) return tag || '';
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', 'HEAD'], { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// #364: a step's last round that ran the whole suite to the end (not focused, not blocked, not timed
// out, every failure in a known file), so its result stands for the files a focused rerun leaves out
function lastWholeRound(outputs) {
  return (outputs || []).findLast((o) => o && o.scope !== 'files' && (o.status === 'pass' || o.status === 'fail') && !o.timed_out && (o.failures || []).every((f) => f.file)) || null;
}

const methods = {
  // Rebuilds <run_dir>/evidence/manifest.json after a step (#146, src/domains/evidence/evidence.js): a new image
  // gets the worktree's commit (modified) or the base's (original); a step output's `screenshots:
  // [{ path, caption }]` (a file of the step's round folder, or a path under the run folder) gives
  // the captions. Nothing to do while the run has no evidence folder.
  recordEvidence(step, st, output) {
    if (!this.runDir || !fs.existsSync(evidence.evidenceRoot(this.runDir))) return;
    try {
      const captions = {};
      for (const s of Array.isArray(output?.screenshots) ? output.screenshots : []) {
        if (!s || typeof s.path !== 'string' || !s.caption) continue;
        const rel = path.isAbsolute(s.path) ? path.relative(this.runDir, s.path) : s.path;
        const p = rel.split(/[\\/]/).join('/');
        captions[p.includes('/') ? p : `evidence/${step.id}/round-${st.visits}/${p}`] = { caption: String(s.caption) };
      }
      // an E2E scenario's screenshots (#143): captioned with the scenario's name
      for (const s of scenarios.normalizeScenarios(output?.scenarios, this.runDir)) {
        for (const p of s.screenshots) {
          const key = p.includes('/') ? p : `evidence/${step.id}/round-${st.visits}/${p}`;
          if (!captions[key]) captions[key] = { caption: `Scenario: ${s.name}` };
        }
      }
      // a screenshots step (#185): its new elements and errors, with the captions of the developer's list
      let capture = null;
      if (output?.kind === 'screenshots' && output.folder) {
        const entries = this.ctx.steps[step.from]?.output?.screenshots;
        const names = Object.fromEntries((Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.name === 'string').map((e) => [e.name, String(e.caption || '')]));
        capture = evidence.captureOf(output, names);
      }
      evidence.writeManifest(this.runDir, {
        captions, commit: this.worktreeHead(), baseCommit: this.worktree?.commit || null, base: this.worktree?.base || null, branch: this.worktreeBranch(),
        ...(capture ? { capture } : {}),
      });
    } catch (e) {
      this.emitEvent('log', { level: 'warn', message: `evidence manifest: ${e.message}` });
    }
  },

  // A step output's E2E `scenarios` (#143): <run_dir>/e2e/scenarios.feature + scenarios.json
  // (src/engine/scenarios.js), the copy the gates' Dev/QA reads; never blocks the step.
  saveScenarios(step, output) {
    try {
      const saved = scenarios.recordScenarios(this.runDir, step.id, output);
      if (saved) this.emitEvent('file.saved', { step_id: step.id, path: saved.feature });
    } catch (e) {
      this.emitEvent('log', { level: 'warn', message: `e2e scenarios: ${e.message}` });
    }
  },

  // `type: screenshots` (#144): the project's screenshot command once per entry of `from`'s
  // `screenshots` output, modified from the worktree and original at `base` (default: the
  // worktree's base ref), into evidence/<folder>/round-<visit>/ (src/engine/screenshot-step.js).
  // A simulated run captures nothing. Never throws: an error becomes the output's reason.
  async runScreenshots(step, st) {
    const folder = step.folder || step.id;
    // (a cast, not a declared type: `watch` is set in a callback the checker does not follow)
    let watch = /** @type {{ stop(): void } | null} */ (null);
    try {
      const base = step.base ? render(String(step.base), this.ctx).trim() : this.worktree?.ref || null;
      return await this.machine.captureScreenshots({
        entries: this.ctx.steps[step.from]?.output?.screenshots,
        cwd: this.ctx.worktree_dir,
        runDir: this.runDir,
        folder,
        round: st.visits,
        base: base || null,
        // #470: the repository's screenshot command gets the allowlisted environment
        env: { ...childEnv(process.env, { passthrough: this.envPassthrough() }), ...capabilities.agentEnv(this.scratchWorkspace(), this.workers) },
        signal: this.abort.signal,
        timeoutMs: parseDuration(step.timeout, undefined),
        log: (level, message) => this.emitEvent('log', { level, message }),
        // another run (or agent) is capturing: one Electron screenshot at a time on the machine (#199)
        onSlotWait: (holder) => {
          this.emitEvent('screenshots.waiting', { step_id: step.id, holder_pid: holder?.pid ?? null, holder: holder?.holder || null });
          this.emitEvent('log', { level: 'info', kind: 'screenshot_slot', message: `${step.id}: waiting for the screenshot slot (held by pid ${holder?.pid ?? '?'}${holder?.holder ? `, ${holder.holder}` : ''})` });
        },
        // #276: each capture's process tree is watched by the memory guard
        onSpawn: (pid) => { watch?.stop(); watch = this.watchMemory({ rootPid: pid, stepId: step.id }); },
        // #465: the captures' output in logs/screenshots-<visit>.log, followed by the step's live terminal
        logFile: path.join(this.runDir, 'logs', `screenshots-${st.visits}.log`),
        onLog: ({ path: rel, command }) => this.emitEvent('step.log', { step_id: step.id, path: rel, command }),
      });
    } catch (e) {
      const reason = `the capture failed: ${e.message}`;
      return { kind: 'screenshots', folder, round: st.visits, dir: null, taken: 0, screens: 0, screenshots: [], errors: [], new_elements: [], reason, message: `No screenshots: ${reason}` };
    } finally {
      watch?.stop();
    }
  },

  // The whole-suite command of the run (its first suite step's, else the one the worktree's files
  // give), '' when none: what `full_suite: warn` compares an agent's commands with.
  suiteCommand() {
    const s = this.wf.steps.find((x) => x.type === 'suite');
    const cmd = s?.command ? render(String(s.command), this.ctx).trim() : '';
    return cmd || suiteStep.detectTestCommand(this.ctx.worktree_dir) || '';
  },

  // #527: the failures a base check confirmed red alone (the only ones red on the base too that a
  // suite round counts as pre-existing); null without a project: the #211 rule unchanged.
  confirmedOnBase(root) {
    return this.projectId ? this.machine.confirmedOnMain?.(root, this.projectId) ?? null : null;
  },

  // `type: suite` (#177): the project's whole test suite once (src/engine/suite-step.js), with the
  // environment a shell would give it (simulation only, no scratch workspace shared by every test
  // process, its own lock folder, #210), its log in logs/suite-<visit>.log; the run's known
  // pre-existing failures do not count, and the other failures are checked on the base checkout
  // (#211: those failing there too become the run's pre-existing failures and go to the project's
  // base-health store, #405 src/domains/project/base-health.js). Without a step `timeout`, the timeout comes from the project's recent suite
  // durations (cache/suite-durations.json). Simulation: mockSequences.suite: { <step>: [...] }.
  // #403: each round of a local workflow first brings the moved local base into the branch
  // (bringBaseIn); the output's `base_commit` is the base commit it tested on.
  // `scope: affected` (#212): each visit runs only the affected test files (affectedSelection: the
  // import graph since the base, plus the files that failed in an earlier round); when they pass and
  // the whole suite has not run yet in this run, the whole suite runs right after (log
  // suite-<visit>-full.log), so it runs once before the merge. #553: at most once per run: after it,
  // pass or fail (this.wholeSuiteRun), the next rounds run the files affected since its commit plus
  // the files that failed, never the whole suite after them. A shared root changed or a project
  // without a JS graph: the whole suite (the only second one). The output's `selection` says which files and why.
  // `files` (#220): only these test files (a rendered list; those missing from the worktree are left
  // out), never the whole suite after them. With `expect: red` (tests written before the code) the
  // run is a red check: `red_check` sorts the files into red / green (already passing: they guard
  // existing behaviour or are wrong) / broken (cannot run), the status is `broken` when one cannot
  // run (else pass: failing is expected), and `affected_tests` lists the existing tests that reach
  // the sources the new tests import (relatedTests, the code → tests graph). Simulation: default red.
  //
  // The memory guard (#276): each execution waits first while free memory is under the guard's floor
  // (at most MEMORY_WAIT_MS), its command's process tree is watched (a stop is named in its message),
  // and a round that fails while the guard recorded a stop or a low-memory period in its time window
  // runs again in the same visit (log <name>-env.log, output environment_reruns), at most
  // MAX_ENV_RERUNS times: only the last result is routed. mockSequences.suite.<step> is indexed by
  // execution (a visit plus its environment reruns).
  async runSuiteStep(step, st) {
    return this.withLiveCommand(step.command ? render(String(step.command), this.ctx).trim() : step.id, () => this.suiteRounds(step, st));
  },

  // The command a pause waits for while fn runs (#368, pauseState: a suite, the screenshots, a
  // transition action): it is never cut.
  async withLiveCommand(command, fn) {
    this.liveCommand = command;
    try {
      return await fn();
    } finally {
      this.liveCommand = null;
    }
  },

  async suiteRounds(step, st) {
    const guard = this.memoryGuard;
    this.suiteEnvReruns ??= {}; // step -> environment reruns so far in this run
    for (let reruns = 0; ; reruns++) {
      if (reruns) this.suiteEnvReruns[step.id] = (this.suiteEnvReruns[step.id] || 0) + 1;
      const execution = st.visits + (this.suiteEnvReruns[step.id] || 0);
      const logFile = path.join(this.runDir, 'logs', `${roundLogName(step.id, st.visits, reruns)}.log`);
      const logPrefix = guard ? await this.waitForMemory(step.id, { file: logFile, command: step.command ? render(String(step.command), this.ctx).trim() : '' }) : '';
      const stopped = [];
      const start = Date.now();
      const output = await this.suiteRound(step, st, { execution, reruns, stopped, logPrefix });
      const end = Date.now();
      if (stopped.length) {
        const list = [...new Set(stopped.map((ev) => `\`${ev.commandLine}\` (${gib(ev.bytes)} GB)`))].join(', ');
        output.memory_stops = stopped.map((ev) => ({ pid: ev.pid, command_line: ev.commandLine, bytes: ev.bytes, limit_bytes: ev.limitBytes }));
        output.message = `${output.message} The memory guard stopped ${list} for passing the memory limit of ${gib(stopped[0].limitBytes)} GB per process.`;
      }
      if (reruns) output.environment_reruns = reruns;
      const incidents = guard && output.status === 'fail' && reruns < MAX_ENV_RERUNS ? guard.incidentsBetween(start, end) : [];
      if (!incidents.length) return output;
      const what = incidents.some((i) => i.kind === 'stop') ? 'the memory guard stopped a process' : 'the machine was low on memory';
      this.emitEvent('log', { level: 'warn', kind: 'suite_env_rerun', step_id: step.id, message: `${step.id}: the round failed while ${what}: an environment failure, not the change's; it runs again once memory recovers (rerun ${reruns + 1} of at most ${MAX_ENV_RERUNS}).` });
    }
  },

  // #276: a suite / e2e step waits while free memory is under the memory guard's floor (memory.hold:
  // the Night watch counts a long one). #465 `log` { file, command }: the round's log, where the wait is
  // written as it starts (step.log: its live terminal shows it) → the lines written, '' without a wait
  async waitForMemory(stepId, log = /** @type {{ file: string, command?: string | null } | null} */ (null)) {
    let low = /** @type {{ freeBytes: number, floorBytes: number } | null} */ (null);
    let written = '';
    const note = (text) => {
      if (!log?.file) return;
      try {
        fs.mkdirSync(path.dirname(log.file), { recursive: true });
        fs.appendFileSync(log.file, text);
        written += text;
      } catch { /* the log is a convenience */ }
    };
    const r = await this.memoryGuard.waitForMemory({
      maxWaitMs: MEMORY_WAIT_MS,
      onWait: (info) => {
        low = info;
        const message = `${stepId} waits for memory before it starts: ${gib(info.freeBytes)} GB free, under the memory guard's floor of ${gib(info.floorBytes)} GB (at most ${MEMORY_WAIT_MS / 60e3} min).`;
        this.emitEvent('log', { level: 'warn', kind: 'memory_hold', step_id: stepId, message });
        if (log?.file && !written) {
          try { fs.rmSync(log.file, { force: true }); } catch { /* written over below */ }
          note(`# ${message}\n`);
          this.emitEvent('step.log', { step_id: stepId, path: path.relative(this.runDir, log.file).split(path.sep).join('/'), command: log.command || null });
        }
      },
    });
    if (low) {
      note(`# waited ${Math.round((r.waitedMs || 0) / 1000)} s for memory${r.recovered ? '' : ' (not recovered)'}\n`);
      this.emitEvent('memory.hold', { step_id: stepId, waited_ms: r.waitedMs, recovered: r.recovered, free_bytes: low.freeBytes, floor_bytes: low.floorBytes });
    }
    return written;
  },

  // One execution of a suite step (see runSuiteStep); stopped: what the memory guard stopped meanwhile;
  // logPrefix: what the round's log already holds (the wait for memory, #465)
  async suiteRound(step, st, { execution, reruns, stopped, logPrefix = '' }) {
    const seq = this.mockSequences?.suite?.[step.id];
    const mockResult = Array.isArray(seq) && seq.length ? seq[Math.min(execution, seq.length) - 1] : step.expect === 'red' ? 'fail' : 'pass';
    const root = path.dirname(path.dirname(this.runDir));
    const project = this.worktree?.repo || this.ctx.worktree_dir || '';
    const scope = step.scope ? render(String(step.scope), this.ctx).trim() : 'full';
    // an environment rerun logs next to the round's own log
    const env = envSuffix(reruns);
    const roundLog = roundLogName(step.id, st.visits, reruns);
    // #403: the change on top of the current local base (checkout.js bringBaseIn), before the tree is taken
    const sync = await this.bringBaseIn(step);
    // a rebase that could not be aborted leaves a half-rebased tree: never tested
    if (sync?.blocked) {
      const output = { kind: 'suite', status: 'blocked', round: st.visits, scope: 'full', command: null, log: null, exit_code: null, duration_ms: 0, timed_out: false, failures: [], preexisting: [], reason: sync.blocked, message: `The suite could not run: ${sync.blocked}`, base_commit: sync.base_commit };
      this.emitEvent('log', { level: 'warn', kind: 'suite', step_id: step.id, status: output.status, failures: 0, message: `${step.id}: ${output.message}` });
      return output;
    }
    // #364: what this round tests, taken before it runs (output.commit, output.clean)
    const tested = testedTree(this.ctx.worktree_dir);
    const once = async (extra = {}) => {
      const onStop = (ev) => stopped.push(ev);
      // a simulated suite spawns nothing (no onSpawn): its watch starts here, without a process tree
      let watch = this.machine.simulated ? this.watchMemory({ stepId: step.id, onStop }) : null;
      const onSpawn = (pid) => { watch?.stop(); watch = this.watchMemory({ rootPid: pid, stepId: step.id, onStop }); };
      try {
        return await this.machine.runSuite({
          command: step.command ? render(String(step.command), this.ctx).trim() : '',
          cwd: this.ctx.worktree_dir,
          runDir: this.runDir,
          round: st.visits,
          env: { ...process.env, ...capabilities.agentEnv() },
          passthrough: this.envPassthrough(),
          testWorkers: this.workers?.testWorkers,
          mockResult,
          preexisting: this.preexisting,
          signal: this.abort.signal,
          timeoutMs: step.timeout ? parseDuration(render(String(step.timeout), this.ctx).trim(), suiteStep.SUITE_TIMEOUT_MS) : null,
          history: project ? { file: path.join(root, 'cache', 'suite-durations.json'), project } : null,
          // `base_check: false` (#260, release.yaml): the worktree is the base itself, so a test that
          // fails there too is the regression to fix, never a pre-existing failure to wave through
          base: step.base_check === false ? null : () => this.suiteBase(),
          baseCacheDir: path.join(root, 'cache', 'base-tests'),
          confirmedOnBase: this.confirmedOnBase(root),
          log: (level, message) => this.emitEvent('log', { level, message }),
          // a suite step other than `suite` (an e2e step, #223) logs under its own name
          ...(step.id === 'suite' && !env ? {} : { logName: roundLog }),
          // #465: the log the command writes to, followed by the step's live terminal
          onLog: ({ path: rel, command, base }) => this.emitEvent('step.log', { step_id: step.id, path: rel, command, ...(base ? { base: true } : {}) }),
          // the wait for memory was written to the round's log: kept when this execution writes that file
          ...(logPrefix && (extra.logName ? `${extra.logName}${env}` : roundLog) === roundLog ? { logPrefix } : {}),
          // #225: `coverage: true` adds node's coverage; the summary covers the files the run changed
          // (#396: and the failures are classed in or outside the change; null: unknown, in the change)
          coverage: step.coverage === true,
          changedFiles: () => {
            const base = this.worktree?.base;
            return this.ctx.worktree_dir && base ? changedFiles(this.ctx.worktree_dir, base) : null;
          },
          onSpawn,
          // #390: what the suite leaves running in the run's own worktree is stopped (never in a folder it does not own)
          sweep: !!this.worktree?.dir,
          ...(sync?.base_commit ? { baseCommit: sync.base_commit } : {}),
          // #455: one whole suite at a time on the machine; another run's round holds it: wait and say whose
          ...(this.machine.simulated ? {} : {
            slot: {
              dir: machineSlotDir(),
              holder: this.runId,
              onWait: (holder) => this.emitEvent('log', { level: 'info', kind: 'suite_slot', step_id: step.id, message: `${step.id}: waiting for the suite slot (run ${holder?.holder || '?'}, pid ${holder?.pid ?? '?'})` }),
            },
          }),
          ...extra,
          ...(env && extra.logName ? { logName: `${extra.logName}${env}` } : {}),
        });
      } catch (e) {
        return { kind: 'suite', status: 'blocked', round: st.visits, scope: 'full', command: null, log: null, exit_code: null, duration_ms: 0, timed_out: false, failures: [], preexisting: [], reason: e.message, message: `The suite could not run: ${e.message}` };
      } finally {
        watch?.stop();
      }
    };
    let output;
    if (step.files !== undefined) {
      output = await this.listedFilesRound(step, st, once, mockResult);
    } else if (scope === 'affected') {
      output = await this.affectedRound(step, st, once, tested);
    } else if (scope === 'failed') {
      output = await this.failedFirstRound(step, st, once, tested);
    } else {
      output = await once();
    }
    Object.assign(output, tested);
    if (sync) {
      output.base_commit = sync.base_commit;
      if (sync.note) output.message = `${output.message} ${sync.note}`;
    }
    if (output.status !== 'blocked' && output.scope !== 'files' && !output.whole_run) this.suiteRuns.engine++;
    if (output.status === 'pass' && output.scope !== 'files' && step.files === undefined) this.fullSuitePassed = true;
    // the files that failed come back in the next round's affected set
    for (const f of output.failures || []) if (f.file && !this.suiteFailedFiles.includes(f.file)) this.suiteFailedFiles.push(f.file);
    if (output.preexisting_failures?.length && this.projectId) {
      this.machine.noteFailingOnMain(root, { projectId: this.projectId, commit: output.base_check?.commit, runId: this.runId, failures: output.preexisting_failures });
    }
    if (output.log) this.emitEvent('file.saved', { step_id: step.id, path: path.join(this.runDir, output.log) });
    if (output.base_check?.log) this.emitEvent('file.saved', { step_id: step.id, path: path.join(this.runDir, output.base_check.log) });
    if (output.coverage?.path) this.emitEvent('file.saved', { step_id: step.id, path: path.join(this.runDir, output.coverage.path) });
    this.emitEvent('log', { level: output.status === 'pass' ? 'info' : 'warn', kind: 'suite', step_id: step.id, status: output.status, failures: output.failures.length, message: `${step.id}: ${output.message}` });
    return output;
  },

  // A `scope: affected` round (#212, see runSuiteStep): the affected files, then the whole suite once
  // in the run when they pass. #553: after the run's whole suite, pass or fail (this.wholeSuiteRun,
  // its commit as `tested` gave it), the selection takes the changes since that commit and no whole
  // suite follows; only a whole-suite selection (a shared root changed) runs it again. Only a whole
  // suite that stands for every file counts (lastWholeRound, #364: not timed out, every failure in a
  // known file); after it, the slow files the changes reach join the selection, since no later whole
  // suite runs them.
  async affectedRound(step, st, once, tested) {
    const whole = this.wholeSuiteRun?.commit ? this.wholeSuiteRun : null;
    let selection;
    try { selection = this.affectedSelection(whole ? { since: whole.commit } : {}); } catch (e) { selection = { mode: 'all', files: [], reasons: {}, changed: [], slow: [], why: `the affected tests could not be listed (${e.message}): the whole suite` }; }
    if (whole) {
      const since = `round ${whole.round}'s whole suite (${whole.commit.slice(0, 7)})`;
      const slow = selection.mode === 'affected' ? (selection.slow || []).filter((f) => !selection.files.includes(f)) : [];
      const why = slow.length ? `${selection.why.replace(/; \d+ slow file\(s\) left to the full suite/, '')}; ${slow.length} slow file(s) run with them` : selection.why;
      selection = {
        ...selection,
        files: [...selection.files, ...slow],
        reasons: { ...selection.reasons, ...Object.fromEntries(slow.map((f) => [f, 'slow, reaches the change'])) },
        why: selection.mode === 'affected' ? `since ${since}: ${why}` : `${selection.why} again, after ${since}`,
      };
    }
    this.emitEvent('log', { level: 'info', kind: 'suite', step_id: step.id, message: `${step.id}: ${selectionLines(selection).slice(0, 6).join('\n')}` });
    let output = await once(selection.mode === 'affected' ? { files: selection.files, selection, wholeTests: whole?.tests || 0 } : { selection });
    if (output.scope === 'files') this.suiteRuns.affected = (this.suiteRuns.affected || 0) + 1;
    if (output.scope === 'files' && output.status === 'pass' && !this.fullSuitePassed && !whole) {
      const affected = { command: output.command, log: output.log, passed: output.passed, failed: output.failed, duration_ms: output.duration_ms, files: selection.files };
      if (output.log) this.emitEvent('file.saved', { step_id: step.id, path: path.join(this.runDir, output.log) });
      output = await once({ selection: { ...selection, why: `the ${selection.files.length} affected test file(s) passed; the whole suite runs once before the merge` }, logName: `suite-${st.visits}-full` });
      output.affected = affected;
    }
    if (lastWholeRound([output]) && tested.commit) this.wholeSuiteRun = { round: st.visits, commit: tested.commit, tests: (output.passed || 0) + (output.failed || 0) };
    return output;
  },

  // A suite step with `files:` runs only the files it lists; `expect: red|green` (#355) checks them.
  async listedFilesRound(step, st, once, mockResult) {
    const cwd = this.ctx.worktree_dir;
    const given = renderFileList(step.files, this.ctx);
    const files = this.machine.existingFiles(cwd, given);
    const missing = given.filter((f) => !files.includes(f));
    const selection = { mode: 'affected', files, reasons: Object.fromEntries(files.map((f) => [f, `listed by ${step.id}`])), why: `the ${files.length} test file(s) the step lists${missing.length ? ` (not found: ${missing.join(', ')})` : ''}` };
    // new tests are not on the base: no base check for a red or a green check (#355: a pinned test
    // that fails is never waved through as failing on the base too)
    let output = await once({ files, selection, logName: `${step.id}-${st.visits}`, mockResult: step.expect === 'red' && mockResult === 'broken' ? 'fail' : mockResult, ...(step.expect ? { base: null } : {}) });
    output.missing = missing;
    if (step.expect === 'red') output = this.redCheckOutput(output, files, mockResult);
    if (step.expect === 'green') output = this.greenCheckOutput(output, cwd, given, files, missing);
    return output;
  },

  // A green check whose listed files are not all on disk proves nothing (#355): never a pass. The
  // disk is read here even in a simulated run, whose machine lists every file as existing
  greenCheckOutput(output, cwd, given, files, missing) {
    if (output.status !== 'pass') return output;
    const absent = cwd && fs.existsSync(cwd) ? given.filter((f) => !fs.existsSync(path.join(cwd, f))) : missing;
    if (!absent.length && files.length) return output;
    const why = absent.length ? `the listed test file(s) are not in the worktree: ${absent.join(', ')}` : 'no test file to check';
    return { ...output, status: 'fail', reason: why, message: `Green check: ${why}. Write and commit them, then list them in tests_added.` };
  },

  // `scope: failed` (#324, release.yaml's e2e step): the first visit runs the whole suite; a later
  // visit runs only the files that failed in the step's previous round (`failures[].file`) plus the
  // `.feature` files changed since the base (the fixes), and when they pass the whole suite runs right
  // after (log <step>-<visit>-full.log, the focused run under `affected`), so only a green whole run
  // routes on. A red focused run is the visit's result. A previous round without failed files, or a
  // command that cannot be filtered (runSuite says so in `selection.why`): the whole suite.
  // #364: when the worktree is clean at the commit of the round that last ran the whole suite (a fix
  // round that changed nothing), the green focused run completes the round: that whole run's result
  // stands for the other files, no whole rerun (a whole pass with the focused run in `affected` and
  // that run in `whole_run`, so the Ship gate reads as after a whole rerun). A commit or an
  // uncommitted change since then, or a whole round without a recorded commit, keeps the whole rerun.
  async failedFirstRound(step, st, once, tested = testedTree(this.ctx.worktree_dir)) {
    const prev = st.outputs?.at(-1);
    if (!prev) return once();
    const failed = [...new Set((prev.failures || []).map((f) => f.file).filter(Boolean))];
    const base = this.worktree?.base;
    const changed = this.ctx.worktree_dir && base ? changedFiles(this.ctx.worktree_dir, base).filter((f) => f.endsWith('.feature') && !failed.includes(f)) : [];
    const files = [...failed, ...changed];
    if (prev.status !== 'fail' || !failed.length) {
      return once({ selection: { mode: 'all', files: [], reasons: {}, why: `no file failed in round ${prev.round} (${prev.status}): the whole suite` } });
    }
    const reasons = Object.fromEntries([...failed.map((f) => [f, `failed in round ${prev.round}`]), ...changed.map((f) => [f, 'changed by a fix'])]);
    const selection = { mode: 'failed', files, reasons, why: `${files.length} file(s): ${failed.length} failed in round ${prev.round}${changed.length ? `, ${changed.length} changed by a fix` : ''}` };
    this.emitEvent('log', { level: 'info', kind: 'suite', step_id: step.id, message: `${step.id}: the files that failed first, then the whole suite: ${selection.why} (${files.join(', ')})` });
    let output = await once({ files, selection });
    if (output.scope !== 'files' || output.status !== 'pass') return output;
    const focused = { command: output.command, log: output.log, passed: output.passed, failed: output.failed, duration_ms: output.duration_ms, files };
    const whole = lastWholeRound(st.outputs);
    if (whole?.commit && whole.clean === true && tested.clean && tested.commit === whole.commit) {
      // the suite's result at this commit: the focused files now, that whole run for the others
      const sha = whole.commit.slice(0, 7);
      const why = `no commit since round ${whole.round}'s whole run (${sha}): the failed files passed, the whole suite is not rerun`;
      this.emitEvent('log', { level: 'info', kind: 'suite', step_id: step.id, message: `${step.id}: ${why}; round ${whole.round}'s result stands for the other files` });
      return {
        ...output,
        scope: 'full',
        selection: { ...selection, why: `${selection.why}; ${why}` },
        affected: focused,
        whole_run: { round: whole.round, commit: whole.commit, passed: whole.passed ?? null, failed: whole.failed ?? null },
        message: `The suite passed in round ${st.visits}: the ${files.length} file(s) that failed in round ${prev.round} passed (\`${output.command}\`), and round ${whole.round}'s whole run (${sha}) stands for the others: no commit since.`,
      };
    }
    if (output.log) this.emitEvent('file.saved', { step_id: step.id, path: path.join(this.runDir, output.log) });
    output = await once({ selection: { ...selection, why: `${selection.why}; they passed, so the whole suite runs once more` }, logName: `${step.id}-${st.visits}-full` });
    output.affected = focused;
    return output;
  },

  // `type: release_version` (#325, release.yaml before the suites): the release's version written into
  // the project's package.json and committed on the run's branch (src/domains/releases/releases.js writeReleaseVersion).
  // Never fails the run: a name that is not a semver, no package.json, nothing to change or a git
  // error is said in the output and the log. Only in the run's own worktree (never the owner's
  // checkout); a simulation writes nothing and says what it would set.
  async runReleaseVersionStep(step) {
    const dir = render(String(step.dir ?? '{{ worktree_dir }}'), this.ctx).trim();
    const version = render(String(step.version ?? ''), this.ctx).trim();
    const branch = step.branch ? render(String(step.branch), this.ctx).trim() : null;
    const none = (reason) => ({ written: false, from: null, to: null, files: [], commit: null, reason });
    let r;
    let error = false;
    const simulated = this.machine.simulated;
    try {
      r = !simulated && !this.worktree
        ? none('The run has no worktree of its own: the version is not written in the repository folder.')
        : await this.machine.writeReleaseVersion({ dir, version, branch });
    } catch (e) {
      error = true;
      r = none(`The version could not be written: ${e.message}`);
    }
    // what ships with the release (a simulation: what a real run would write)
    const change = r.written || (simulated && r.files.length) ?`package.json ${r.from || '(no version)'} → ${r.to}` : '';
    const output = { kind: 'release_version', status: r.written ? 'written' : 'unchanged', version, ...r, change, previous_version: await previousReleaseTag(dir, version), message: r.reason };
    this.emitEvent('log', { level: error ? 'warn' : 'info', kind: 'release_version', step_id: step.id, message: `${step.id}: ${r.reason}` });
    return output;
  },

  // `type: test_ids` (#246): the test ids the E2E step definitions use and the renderer lacks, in the
  // run's checkout (src/engine/test-ids.js, the rule test/e2e-playwright.test.js uses too), with the
  // project's own folders when the step names them (`steps`, `renderer`: templates, repository-relative).
  // Output: { kind: 'test_ids', status: pass | missing | skipped, missing: [{ id, files }], message };
  // skipped when the project has no step definitions (no BDD steps) or the run has no checkout.
  runTestIdsStep(step, st) {
    const dir = this.ctx.worktree_dir;
    const folder = (key, def) => (step[key] ? render(String(step[key]), this.ctx).trim() : '') || def;
    const folders = { steps: folder('steps', testIds.DEFAULT_STEPS), renderer: folder('renderer', testIds.DEFAULT_RENDERER) };
    const base = { kind: 'test_ids', round: st.visits, steps: folders.steps, renderer: folders.renderer, missing: [] };
    let output;
    if (!dir || !fs.existsSync(dir)) {
      output = { ...base, status: 'skipped', message: 'Test id check skipped: the run has no checkout.' };
    } else if (!testIds.stepFiles(dir, folders).length) {
      output = { ...base, status: 'skipped', message: `Test id check skipped: the project has no BDD step definitions in ${folders.steps}.` };
    } else {
      const missing = testIds.missingTestIds(dir, folders);
      output = missing.length
        ? { ...base, status: 'missing', missing, message: `${missing.length} test id(s) the E2E step definitions use are not in ${folders.renderer}:\n${testIds.missingTestIdLines(missing)}` }
        : { ...base, status: 'pass', message: `Every test id the E2E step definitions use is in ${folders.renderer}.` };
    }
    this.emitEvent('log', { level: output.status === 'missing' ? 'warn' : 'info', kind: 'test_ids', step_id: step.id, status: output.status, message: `${step.id}: ${output.message}` });
    return output;
  },

  // `type: check` (#404): the project's rule checks in the run's checkout (src/engine/check-step.js),
  // `command` rendered (empty: the project's `check` script), `timeout` optional, the log under
  // logs/check-<visit>.log. Output: { kind: 'check', status: pass | fail | skipped, command,
  // findings, message, round }.
  async runCheckStep(step, st) {
    const command = step.command ? render(String(step.command), this.ctx).trim() : '';
    const timeoutMs = step.timeout ? parseDuration(render(String(step.timeout), this.ctx).trim(), undefined) : undefined;
    const logFile = path.join(this.runDir, 'logs', `check-${st.visits}.log`);
    const onLog = ({ command: cmd }) => this.emitEvent('step.log', { step_id: step.id, path: `logs/check-${st.visits}.log`, command: cmd });
    const output = { ...(await checkStep.runCheck({ dir: this.ctx.worktree_dir, command, logFile, env: { ...childEnv(process.env, { passthrough: this.envPassthrough() }), ...capabilities.AGENT_ENV }, timeoutMs, signal: this.abort.signal, onLog })), round: st.visits };
    this.emitEvent('log', { level: output.status === 'fail' ? 'warn' : 'info', kind: 'check', step_id: step.id, status: output.status, message: `${step.id}: ${output.message.split('\n')[0]}` });
    return output;
  },

  // A suite output turned into the red check of tests written before the code (#220): red_check,
  // affected_tests (+ affected_reasons), status broken | pass (| blocked), and a message for the
  // next prompt that names the already-green files.
  redCheckOutput(output, files, mockResult) {
    if (output.status === 'blocked') return output;
    const check = this.machine.redCheck(output, files, { mockResult });
    let related = { files: [], reasons: {}, why: '' };
    if (files.length) {
      try { related = this.machine.relatedTests({ root: this.ctx.worktree_dir, tests: files }); } catch (e) { related.why = `the related tests could not be listed (${e.message.split('\n')[0]})`; }
    }
    const lines = [`Red check of ${files.length} test file(s) written before the code (\`${output.command}\`):`];
    if (check.red.length) lines.push(`- red, as expected: ${check.red.join(', ')}`);
    for (const p of check.partly_green) lines.push(`- ${p.file}: ${p.passed} test(s) already pass, ${p.failed} fail`);
    if (check.green.length) lines.push(`- already green (they pass before any code: they guard existing behaviour or are wrong): ${check.green.join(', ')}`);
    for (const b of check.broken) lines.push(`- cannot run: ${b.file}: ${b.error}`);
    if (output.missing?.length) lines.push(`- not found in the worktree: ${output.missing.join(', ')}`);
    if (!files.length) lines.push('- no test file to check');
    if (related.why) lines.push(`Existing tests related to them: ${related.why}${related.files.length ? `: ${related.files.join(', ')}` : ''}`);
    if (output.human_log || output.log) lines.push(`Log: ${path.join(this.runDir, output.human_log || output.log)}`);
    return {
      ...output,
      status: check.broken.length ? 'broken' : 'pass',
      red_check: check,
      affected_tests: related.files,
      affected_reasons: related.reasons,
      message: lines.join('\n'),
    };
  },

  // `type: workflow` (#174): the child runs of the step (src/engine/workflow-step.js), started through
  // startChild; the run shows as waiting while they go. Each one lands in `child_runs` (summary).
  async runChildWorkflows(step, st) {
    this.setStatus(this.orchestrator, 'waiting');
    const emit = (type, data) => {
      if (type === 'workflow.child_started') {
        this.childRuns.push({
          run_id: data.child_run_id, step_id: step.id, visit: st.visits, ...(data.index !== undefined ? { index: data.index, label: data.label } : {}), workflow: data.workflow, status: 'running',
          ...(data.resumed_from ? { resumed_from: data.resumed_from } : {}), ...(data.reused ? { reused: true } : {}),
        });
      }
      if (type === 'workflow.child_finished') {
        const c = this.childRuns.find((x) => x.run_id && x.run_id === data.child_run_id);
        if (c) Object.assign(c, { status: data.status, cost_usd: data.cost_usd || 0 });
      }
      this.emitEvent(type, data);
    };
    try {
      const output = await runWorkflowStep({
        step, render, emit, startChild: this.startChild, signal: this.abort.signal, previous: this.previousChildren(step),
        // #368: the children pause with this run; none starts once it pauses
        paused: () => !!this.pausing, handles: this.childHandles,
        scope: { ...this.ctx, iteration: st.iteration },
        parent: { run_id: this.runId, workflow: this.wf.metadata?.name || path.basename(this.file), depth: this.parent?.depth || 0 },
      });
      // #368: its children paused with this run: the run ends paused here, Resume runs the step
      // again and resumes them where they paused (whatever this.pausing says now: a Cancel pause that
      // came after a child had paused cannot take that back)
      if (output.status === 'paused' && !this.abort.signal.aborted) throw pausedError();
      return output;
    } finally {
      this.setStatus(this.orchestrator, 'active');
    }
  },
};

module.exports = {
  methods,
};
