// Steps without an agent (#250, from src/engine/workflow.js): `type: screenshots` (`runScreenshots`,
// #144), `type: suite` (`runSuiteStep`, `suiteRound` with the memory guard's waits and reruns #276,
// `redCheckOutput` #220), `type: test_ids` (`runTestIdsStep`, #246), `type: workflow` child runs
// (`runChildWorkflows`, #174), and the evidence a step leaves (`recordEvidence`, `saveScenarios`).
// The steps' own logic is src/engine/suite-step.js, screenshot-step.js, test-ids.js and workflow-step.js.

'use strict';

const fs = require('fs');
const path = require('path');
const capabilities = require('../capabilities');
const evidence = require('../../evidence');
const scenarios = require('../scenarios');
const { captureScreenshots } = require('../screenshot-step');
const suiteStep = require('../suite-step');
const { changedFiles, relatedTests, selectionLines } = require('../affected-tests');
const { runWorkflowStep } = require('../workflow-step');
const testIds = require('../test-ids');
const { render } = require('./templates');
const { parseDuration, renderFileList } = require('./load');
const { gib } = require('./turns');

// #276: a suite / e2e step waits at most this long for memory before it starts, and reruns at most
// this many times a round that failed during a memory incident
const MEMORY_WAIT_MS = 10 * 60e3;
const MAX_ENV_RERUNS = 2;

const methods = {
  // Rebuilds <run_dir>/evidence/manifest.json after a step (#146, src/evidence.js): a new image
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
    let watch = null;
    try {
      const base = step.base ? render(String(step.base), this.ctx).trim() : this.worktree?.ref || null;
      return await captureScreenshots({
        entries: this.ctx.steps[step.from]?.output?.screenshots,
        cwd: this.ctx.worktree_dir,
        runDir: this.runDir,
        folder,
        round: st.visits,
        base: base || null,
        env: { ...process.env, ...capabilities.agentEnv(this.scratchWorkspace()) },
        mock: this.mock,
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

  // `type: suite` (#177): the project's whole test suite once (src/engine/suite-step.js), with the
  // environment a shell would give it (simulation only, no scratch workspace shared by every test
  // process, its own lock folder, #210), its log in logs/suite-<visit>.log; the run's known
  // pre-existing failures do not count, and the other failures are checked on the base checkout
  // (#211: those failing there too become the run's pre-existing failures and go to the workspace's
  // failing-on-main.json). Without a step `timeout`, the timeout comes from the project's recent suite
  // durations (cache/suite-durations.json). Simulation: mockSequences.suite: { <step>: [...] }.
  // `scope: affected` (#212): each visit runs only the affected test files (affectedSelection: the
  // import graph since the base, plus the files that failed in an earlier round); when they pass and
  // the whole suite has not passed yet in this run, the whole suite runs right after (log
  // suite-<visit>-full.log), so it runs once before the merge. A shared root changed or a project
  // without a JS graph: the whole suite. The output's `selection` says which files and why.
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
    const guard = this.memoryGuard;
    this.suiteEnvReruns ??= {}; // step -> environment reruns so far in this run
    for (let reruns = 0; ; reruns++) {
      if (reruns) this.suiteEnvReruns[step.id] = (this.suiteEnvReruns[step.id] || 0) + 1;
      const execution = st.visits + (this.suiteEnvReruns[step.id] || 0);
      if (guard) await this.waitForMemory(step.id);
      const stopped = [];
      const start = Date.now();
      const output = await this.suiteRound(step, st, { execution, reruns, stopped });
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
  // the Night watch counts a long one)
  async waitForMemory(stepId) {
    let low = null;
    const r = await this.memoryGuard.waitForMemory({
      maxWaitMs: MEMORY_WAIT_MS,
      onWait: (info) => {
        low = info;
        this.emitEvent('log', { level: 'warn', kind: 'memory_hold', step_id: stepId, message: `${stepId} waits for memory before it starts: ${gib(info.freeBytes)} GB free, under the memory guard's floor of ${gib(info.floorBytes)} GB (at most ${MEMORY_WAIT_MS / 60e3} min).` });
      },
    });
    if (low) this.emitEvent('memory.hold', { step_id: stepId, waited_ms: r.waitedMs, recovered: r.recovered, free_bytes: low.freeBytes, floor_bytes: low.floorBytes });
  },

  // One execution of a suite step (see runSuiteStep); stopped: what the memory guard stopped meanwhile.
  async suiteRound(step, st, { execution, reruns, stopped }) {
    const seq = this.mockSequences?.suite?.[step.id];
    const mockResult = Array.isArray(seq) && seq.length ? seq[Math.min(execution, seq.length) - 1] : step.expect === 'red' ? 'fail' : 'pass';
    const root = path.dirname(path.dirname(this.runDir));
    const project = this.worktree?.repo || this.ctx.worktree_dir || '';
    const scope = step.scope ? render(String(step.scope), this.ctx).trim() : 'full';
    // an environment rerun logs next to the round's own log
    const env = reruns ? `-env${reruns > 1 ? `-${reruns}` : ''}` : '';
    const once = async (extra = {}) => {
      const onStop = (ev) => stopped.push(ev);
      let watch = this.mock ? this.watchMemory({ stepId: step.id, onStop }) : null;
      const onSpawn = (pid) => { watch?.stop(); watch = this.watchMemory({ rootPid: pid, stepId: step.id, onStop }); };
      try {
        return await suiteStep.runSuite({
          command: step.command ? render(String(step.command), this.ctx).trim() : '',
          cwd: this.ctx.worktree_dir,
          runDir: this.runDir,
          round: st.visits,
          env: { ...process.env, ...capabilities.agentEnv() },
          mock: this.mock,
          mockResult,
          preexisting: this.preexisting,
          signal: this.abort.signal,
          timeoutMs: step.timeout ? parseDuration(render(String(step.timeout), this.ctx).trim(), suiteStep.SUITE_TIMEOUT_MS) : null,
          history: project ? { file: path.join(root, 'cache', 'suite-durations.json'), project } : null,
          // `base_check: false` (#260, release.yaml): the worktree is the base itself, so a test that
          // fails there too is the regression to fix, never a pre-existing failure to wave through
          base: step.base_check === false ? null : () => this.suiteBase(),
          baseCacheDir: path.join(root, 'cache', 'base-tests'),
          log: (level, message) => this.emitEvent('log', { level, message }),
          // a suite step other than `suite` (an e2e step, #223) logs under its own name
          ...(step.id === 'suite' && !env ? {} : { logName: `${step.id}-${st.visits}${env}` }),
          // #225: `coverage: true` adds node's coverage; the summary covers the files the run changed
          coverage: step.coverage === true,
          changedFiles: () => {
            const base = this.worktree?.base;
            return this.ctx.worktree_dir && base ? changedFiles(this.ctx.worktree_dir, base) : [];
          },
          onSpawn,
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
      const cwd = this.ctx.worktree_dir;
      const given = renderFileList(step.files, this.ctx);
      const files = given.filter((f) => this.mock || (cwd && fs.existsSync(path.join(cwd, f))));
      const missing = given.filter((f) => !files.includes(f));
      const selection = { mode: 'affected', files, reasons: Object.fromEntries(files.map((f) => [f, `listed by ${step.id}`])), why: `the ${files.length} test file(s) the step lists${missing.length ? ` (not found: ${missing.join(', ')})` : ''}` };
      // new tests are not on the base: no base check for a red check
      output = await once({ files, selection, logName: `${step.id}-${st.visits}`, mockResult: step.expect === 'red' && mockResult === 'broken' ? 'fail' : mockResult, ...(step.expect === 'red' ? { base: null } : {}) });
      output.missing = missing;
      if (step.expect === 'red') output = this.redCheckOutput(output, files, mockResult);
    } else if (scope === 'affected') {
      let selection;
      try { selection = this.affectedSelection(); } catch (e) { selection = { mode: 'all', files: [], reasons: {}, changed: [], slow: [], why: `the affected tests could not be listed (${e.message}): the whole suite` }; }
      this.emitEvent('log', { level: 'info', kind: 'suite', step_id: step.id, message: `${step.id}: ${selectionLines(selection).slice(0, 6).join('\n')}` });
      output = await once(selection.mode === 'affected' ? { files: selection.files, selection } : { selection });
      if (output.scope === 'files') this.suiteRuns.affected = (this.suiteRuns.affected || 0) + 1;
      if (output.scope === 'files' && output.status === 'pass' && !this.fullSuitePassed) {
        const affected = { command: output.command, log: output.log, passed: output.passed, failed: output.failed, duration_ms: output.duration_ms, files: selection.files };
        if (output.log) this.emitEvent('file.saved', { step_id: step.id, path: path.join(this.runDir, output.log) });
        output = await once({ selection: { ...selection, why: `the ${selection.files.length} affected test file(s) passed; the whole suite runs once before the merge` }, logName: `suite-${st.visits}-full` });
        output.affected = affected;
      }
    } else {
      output = await once();
    }
    if (output.status !== 'blocked' && output.scope !== 'files') this.suiteRuns.engine++;
    if (output.status === 'pass' && output.scope !== 'files' && step.files === undefined) this.fullSuitePassed = true;
    // the files that failed come back in the next round's affected set
    for (const f of output.failures || []) if (f.file && !this.suiteFailedFiles.includes(f.file)) this.suiteFailedFiles.push(f.file);
    if (output.preexisting_failures?.length && !this.mock) {
      suiteStep.noteFailingOnMain(path.join(root, 'failing-on-main.json'), { project, base: this.worktree?.base, commit: output.base_check?.commit, runId: this.runId, failures: output.preexisting_failures });
    }
    if (output.log) this.emitEvent('file.saved', { step_id: step.id, path: path.join(this.runDir, output.log) });
    if (output.base_check?.log) this.emitEvent('file.saved', { step_id: step.id, path: path.join(this.runDir, output.base_check.log) });
    if (output.coverage?.path) this.emitEvent('file.saved', { step_id: step.id, path: path.join(this.runDir, output.coverage.path) });
    this.emitEvent('log', { level: output.status === 'pass' ? 'info' : 'warn', kind: 'suite', step_id: step.id, status: output.status, failures: output.failures.length, message: `${step.id}: ${output.message}` });
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

  // A suite output turned into the red check of tests written before the code (#220): red_check,
  // affected_tests (+ affected_reasons), status broken | pass (| blocked), and a message for the
  // next prompt that names the already-green files.
  redCheckOutput(output, files, mockResult) {
    if (output.status === 'blocked') return output;
    const check = suiteStep.redCheck(output, files, { mock: this.mock, mockResult });
    let related = { files: [], reasons: {}, why: '' };
    if (!this.mock && files.length) {
      try { related = relatedTests({ root: this.ctx.worktree_dir, tests: files }); } catch (e) { related.why = `the related tests could not be listed (${e.message.split('\n')[0]})`; }
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
      return await runWorkflowStep({
        step, render, emit, startChild: this.startChild, signal: this.abort.signal, previous: this.previousChildren(step),
        scope: { ...this.ctx, iteration: st.iteration },
        parent: { run_id: this.runId, workflow: this.wf.metadata?.name || path.basename(this.file), depth: this.parent?.depth || 0 },
      });
    } finally {
      this.setStatus(this.orchestrator, 'active');
    }
  },
};

module.exports = {
  methods,
};
