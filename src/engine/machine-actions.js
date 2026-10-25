// The run's machine actions as an injected adapter (#353): what a run does on the machine besides
// its agent turns (git, `merge: local`, `ship:`, the PR/MR and CI probes, transition actions, the
// suite's and the test requests' commands, screenshots, the release version, the provider an agent
// turn starts). `real()` does it; `simulated({ sequences })` does what a mock run did before (#353:
// the `this.mock` branches of src/engine/run/): nothing runs, merges, pushes or captures, probes
// follow MOCK_PROBES (or mockSequences.probes), `action_errors` fails the first transitions of a step,
// and every agent gets the mock provider. Each adapter says what it is in `simulated`.
// WorkflowRun takes one as its `machine` option (the one matching `mock` when none is given) and
// refuses a mismatch: a real run never takes the simulated adapter, nor the reverse. The safety rule
// (MULTIAGENT_SIMULATION_ONLY refuses real providers, src/engine/providers.js) is not here: a real
// adapter under simulation-only is still refused where it was.

'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  git,
  mergeLocally,
} = require('./worktree');
const { childEnv, PLATFORM_CLIS } = require('./child-env');
const { runProbe } = require('./probes');
const { captureScreenshots } = require('./screenshot-step');
const suiteStep = require('./suite-step');
const { affectedTests, relatedTests } = require('./affected-tests');
const { shipRelease, writeReleaseVersion } = require('../domains/releases/releases');
const {
  confirmedFailures,
  recordSightings,
} = require('./base-health-store');

// Simulation: probe states per call, per probe (mockSequences.probes: { step: [...] } overrides them).
// The CI check fails once (the agent triages it), then passes without an agent turn.
const MOCK_PROBES = {
  pr_checks: ['pending', 'failed', 'pending', 'passed'],
  pr_changes: ['unchanged', 'changed'],
  workflow_run: ['pending', 'passed'],
  // the check right before a merge (`check:` / `precheck:`): mergeable; a conflict is simulated with
  // mockSequences.probes: { '<step>:check': [...], '<step>:precheck': [...] }
  pr_mergeable: ['passed'],
};

// The affected tests of a simulated change (scope: affected, run-tests `affected`)
const SIMULATED_FILES = ['test/simulated.test.js', 'test/simulated-other.test.js'];

function real() {
  return {
    simulated: false,
    git: (args, cwd) => git(args, cwd),
    // fast-forwards the local base to the run's branch (src/engine/worktree.js mergeLocally) →
    // its result with base_commit (#289), the base's tip before the merge
    async mergeLocal({ repo, dir, base, log }) {
      if (!dir) throw new Error('merge: local needs the run\'s git worktree (orchestrator.worktree on a git repository).');
      const baseCommit = await git(['rev-parse', `refs/heads/${base}`], repo).then((s) => s.trim(), () => null);
      return { ...(await mergeLocally({ repo, dir, base, log })), base_commit: baseCommit };
    },
    ship: ({ repo, base, tag, expect }) => shipRelease({ repo, base, tag, expect }),
    // what a ship needs before it does anything (WorkflowRun.shipGuard): checked
    guardShip: (check) => check(),
    // a transition's action / merge / ship: no simulated failure
    transitionFault: () => {},
    // #470 (SEC-5): the allowlisted environment; the platform tokens pass (the workflow's own
    // `gh pr merge` / `glab mr merge`), plus the workflow's env.passthrough
    runAction: (cmd, { cwd, passthrough = [] } = {}) => new Promise((resolve) => {
      exec(cmd, { cwd, windowsHide: true, env: childEnv(process.env, { platforms: PLATFORM_CLIS, passthrough }) }, (err, stdout, stderr) => {
        resolve({ skipped: false, exit_code: err ? err.code ?? 1 : 0, output: `${stdout}${stderr}`.slice(-4000), stdout, stderr });
      });
    }),
    probe: (args) => runProbe(args),
    runSuite: (opts) => suiteStep.runSuite({ ...opts, mock: false }),
    redCheck: (output, files, { mockResult } = {}) => suiteStep.redCheck(output, files, { mock: false, mockResult }),
    relatedTests: (opts) => relatedTests(opts),
    // the listed test files that exist in the checkout
    existingFiles: (cwd, files) => files.filter((f) => cwd && fs.existsSync(path.join(cwd, f))),
    // #211, #405: the run's pre-existing failures go to the project's base-health store (record only:
    // the service files the issue, src/service/areas/base-health.js)
    noteFailingOnMain: (root, info) => recordSightings(root, info).catch(() => { /* reported in the run anyway */ }),
    // #527: the failures a base check confirmed red alone since its last green check, the only ones a
    // run's suite counts as pre-existing (a store it cannot read: none confirmed)
    confirmedOnMain: (root, projectId) => { try { return confirmedFailures(root, projectId); } catch { return []; } },
    // the test files the run's change can break (#212), plus those that failed in an earlier round
    affectedTests({ root, base, failed = [] }) {
      if (!root || !base) return { mode: 'all', files: [], reasons: {}, changed: [], slow: [], why: 'the run has no worktree or base branch: the whole suite' };
      const sel = affectedTests({ root, base });
      for (const f of failed) {
        if (sel.mode !== 'affected' || sel.files.includes(f) || !fs.existsSync(path.join(root, f))) continue;
        sel.files.push(f);
        sel.reasons[f] = 'failed in an earlier round';
      }
      sel.files.sort();
      return sel;
    },
    captureScreenshots: (opts) => captureScreenshots({ ...opts, mock: false }),
    writeReleaseVersion: (opts) => writeReleaseVersion({ ...opts, mock: false }),
    provider: (agent, providers) => providers?.[agent.provider],
    // #414: the run's temp folder (<run>/tmp), created → its path
    runTmp(runDir) {
      const tmp = path.join(runDir, 'tmp');
      fs.mkdirSync(tmp, { recursive: true });
      return tmp;
    },
  };
}

// sequences: the run's mockSequences ({ probes: { step: [...] }, action_errors: { step: n } }).
function simulated({ sequences = null } = {}) {
  const probeCalls = {}; // step -> probes answered
  const transitionCalls = {}; // step -> transition actions/merges run (sequences.action_errors)
  return {
    simulated: true,
    // no git runs: an empty answer, whatever the folder
    git: () => Promise.resolve(''),
    mergeLocal: () => Promise.resolve({ skipped: true, output: '[mock] local merge not executed' }),
    ship: () => Promise.resolve({ skipped: true, output: '[mock] release not pushed, not tagged' }),
    // a simulated gate is never the owner's own answer, and nothing ships: no guard
    guardShip: () => {},
    // sequences.action_errors: { step: n } fails the first n actions/merges/ships of that step
    transitionFault({ stepId, action, merge }) {
      const n = (transitionCalls[stepId] = (transitionCalls[stepId] || 0) + 1);
      if (n <= (sequences?.action_errors?.[stepId] || 0)) {
        throw new Error(`(simulated) ${merge ? 'local merge: the branch conflicts with the local base in src/simulated.js' : `action failed: ${action}`}`);
      }
    },
    runAction: () => Promise.resolve({ skipped: true, output: '[mock] action not executed' }),
    probe({ probe, stepId, baseline }) {
      if (baseline) return Promise.resolve({});
      const seq = sequences?.probes?.[stepId] || MOCK_PROBES[probe];
      const n = (probeCalls[stepId] = (probeCalls[stepId] || 0) + 1);
      const state = seq[Math.min(n - 1, seq.length - 1)];
      return Promise.resolve({ state, detail: `(simulated) ${probe}: ${state}` });
    },
    // nothing runs: the log says so and the result is `mockResult` (mockSequences.suite)
    runSuite: (opts) => suiteStep.runSuite({ ...opts, mock: true }),
    redCheck: (output, files, { mockResult } = {}) => suiteStep.redCheck(output, files, { mock: true, mockResult }),
    relatedTests: () => ({ files: [], reasons: {}, why: '' }),
    existingFiles: (cwd, files) => [...files],
    noteFailingOnMain: () => {},
    // no base check in a simulation: every failure on the base too stays pre-existing (#211)
    confirmedOnMain: () => null,
    affectedTests: () => ({
      mode: 'affected', files: [...SIMULATED_FILES],
      reasons: { [SIMULATED_FILES[0]]: 'imports src/simulated.js', [SIMULATED_FILES[1]]: 'imports src/simulated.js (through src/simulated-user.js)' },
      changed: ['src/simulated.js'], slow: [], why: `${SIMULATED_FILES.length} test file(s) reach the 1 changed file(s) (simulated)`,
    }),
    captureScreenshots: (opts) => captureScreenshots({ ...opts, mock: true }),
    // writes nothing: says what a real run would set
    writeReleaseVersion: (opts) => writeReleaseVersion({ ...opts, mock: true }),
    provider: () => ({ type: 'mock' }),
    // #414: no temp folder (a mock run changes nothing on disk it did not before)
    runTmp: () => null,
  };
}

module.exports = {
  MOCK_PROBES,
  real,
  simulated,
};
