// A suite step with `coverage: true` (#225) measures coverage only when it runs the whole suite: its rounds
// of selected files (affected, failed first, listed) run bare. Coverage cost about a quarter of the
// suite's time on this repository (270 s bare, 341 s with it, 2026-11-25), and the affected rounds were
// most of a run's rounds; the coverage report (coverage/coverage-summary.md, a Tests artifact) stays the
// last whole run's.
// Seam (as suite-guards-slow-736.test.js): WorkflowRun.prototype.suiteRound on a small run state whose
// machine is the real one (the real affected-tests selection over a real git repository), runSuite
// recorded and run with a stubbed child-process boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const suiteStep = require('../engine/suite-step');
const machineActions = require('../engine/machine-actions');
const { WorkflowRun } = require('../engine/workflow');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-cov-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const tmp = (t, prefix) => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
};

// the machine-wide locks folder in a temp folder (a whole-suite round takes the suite slot of #455 there)
function machineFolder(t) {
  const root = tmp(t, 'suite-cov-machine-');
  const saved = {};
  for (const k of ['TEMP', 'TMP', 'TMPDIR', 'CRAFTORIO_LOCKS_DIR']) saved[k] = process.env[k];
  process.env.TEMP = root;
  process.env.TMP = root;
  process.env.TMPDIR = root;
  process.env.CRAFTORIO_LOCKS_DIR = path.join(root, 'craftorio', 'locks');
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

// a project with a module, its test and another test, on a run branch
function repo(t) {
  const dir = tmp(t, 'suite-cov-repo-');
  const write = (f, text) => { fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
  write('package.json', JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }));
  write('src/x.js', 'module.exports = 1;\n');
  write('test/x.test.js', "require('../src/x');\n");
  write('test/z.test.js', "require('node:test');\n");
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'run-branch');
  return { dir, commit: (f, text) => { write(f, text); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', `change ${f}`); } };
}

// a green suite: every command passes; each runSuite call is recorded with its files (null: whole) and coverage
function engineRun(t, worktree, step) {
  const runDir = path.join(tmp(t, 'suite-cov-run-'), 'runs', 'run-cov');
  fs.mkdirSync(runDir, { recursive: true });
  const calls = [];
  const run = async ({ logFile }) => {
    if (logFile) fs.appendFileSync(logFile, 'ℹ tests 2\nℹ pass 2\nℹ fail 0\n');
    return { code: 0, timedOut: false, error: null };
  };
  const state = Object.create(WorkflowRun.prototype);
  Object.assign(state, {
    mock: false,
    mockSequences: {},
    machine: {
      ...machineActions.real(),
      simulated: false,
      runSuite: (opts) => {
        calls.push({ files: opts.files || null, coverage: opts.coverage });
        return suiteStep.runSuite({ ...opts, run });
      },
      noteFailingOnMain: () => {},
      confirmedOnMain: () => [],
    },
    runDir,
    runId: 'run-cov',
    worktree: { repo: worktree, base: 'main' },
    ctx: { worktree_dir: worktree, steps: {} },
    abort: new AbortController(),
    preexisting: [],
    suiteRuns: { engine: 0 },
    suiteFailedFiles: [],
    fullSuitePassed: false,
    watchMemory: () => ({ stop() {} }),
    emitEvent: () => {},
  });
  const outputs = [];
  const round = async () => {
    const visits = outputs.length + 1;
    const out = await state.suiteRound(step, { visits, outputs: [...outputs] }, { execution: visits, reruns: 0, stopped: [] });
    outputs.push(out);
    return out;
  };
  return { calls, round };
}

const STEP = { id: 'suite', type: 'suite', command: 'npm test', scope: 'affected', base_check: false, coverage: true };

test('coverage: an affected round runs bare and the whole suite after it measures coverage; a later affected round runs bare', async (t) => {
  machineFolder(t);
  const r = repo(t);
  r.commit('src/x.js', 'module.exports = 2;\n');
  const { calls, round } = engineRun(t, r.dir, STEP);
  const first = await round();
  assert.equal(first.status, 'pass');
  assert.deepEqual(calls, [{ files: ['test/x.test.js'], coverage: false }, { files: null, coverage: true }]);
  r.commit('src/x.js', 'module.exports = 3;\n');
  calls.length = 0;
  assert.equal((await round()).status, 'pass');
  assert.deepEqual(calls, [{ files: ['test/x.test.js'], coverage: false }], 'after the run\'s whole suite, the affected files only, bare');
});

test('coverage: a step whose selection is the whole suite measures it; a step without `coverage` never does', async (t) => {
  machineFolder(t);
  const r = repo(t);
  r.commit('package.json', JSON.stringify({ name: 'p', scripts: { test: 'node --test', x: 'true' } }));
  const whole = engineRun(t, r.dir, STEP);
  await whole.round();
  assert.deepEqual(whole.calls, [{ files: null, coverage: true }], 'a shared root changed: the whole suite, with coverage');
  const bare = engineRun(t, r.dir, { ...STEP, coverage: undefined });
  await bare.round();
  assert.deepEqual(bare.calls, [{ files: null, coverage: false }]);
});
