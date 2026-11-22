// T6: a `scope: affected` suite step with `whole_command` runs that command for its whole round (once
// per run, after the affected files pass), with the run's base and the workspace's shared Turborepo
// cache in its environment; without it the step's command runs whole, as before. A suite output with
// one agent report per workspace (Turborepo's prefixed lines) is read as one report.
// Seams as packages/engine/test/suite-one-whole-per-run-553.test.js: WorkflowRun.prototype.suiteRound
// on a small run state, the real machine over a real git repository, runSuite with a stubbed command.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const suiteStep = require('../engine/suite-step');
const machineActions = require('../engine/machine-actions');
const { parseAgentReport } = require('../engine/agent-test-report');
const { WorkflowRun } = require('../engine/workflow');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-t6-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const tmp = (t, prefix) => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
};

function machineFolder(t) {
  const root = tmp(t, 'suite-t6-machine-');
  const saved = {};
  for (const k of ['TEMP', 'TMP', 'TMPDIR', 'CRAFTORIO_LOCKS_DIR']) saved[k] = process.env[k];
  Object.assign(process.env, { TEMP: root, TMP: root, TMPDIR: root, CRAFTORIO_LOCKS_DIR: path.join(root, 'craftorio', 'locks') });
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

function repo(t) {
  const dir = tmp(t, 'suite-t6-repo-');
  const write = (f, text) => { fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
  write('package.json', JSON.stringify({ name: 'p', scripts: { test: 'node --test', 'test:affected': 'turbo' } }));
  write('src/x.js', 'module.exports = 1;\n');
  write('test/x.test.js', "require('../src/x');\n");
  write('test/c.test.js', "require('node:test');\n");
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'run-branch');
  write('src/x.js', 'module.exports = 2;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'change');
  return dir;
}

function engineRun(t, worktree, step) {
  const runDir = path.join(tmp(t, 'suite-t6-ws-'), 'runs', 'run-t6');
  fs.mkdirSync(runDir, { recursive: true });
  const calls = [];
  const run = async ({ command, env, logFile }) => {
    calls.push({ command, env: { TURBO_SCM_BASE: env?.TURBO_SCM_BASE, TURBO_CACHE_DIR: env?.TURBO_CACHE_DIR }, list: !!env?.CRAFTORIO_TEST_FILES });
    if (logFile) fs.appendFileSync(logFile, 'ℹ tests 3\nℹ pass 3\nℹ fail 0\n');
    return { code: 0, timedOut: false, error: null };
  };
  const state = Object.create(WorkflowRun.prototype);
  Object.assign(state, {
    mock: false,
    mockSequences: {},
    machine: { ...machineActions.real(), simulated: false, runSuite: (opts) => suiteStep.runSuite({ ...opts, run }), noteFailingOnMain: () => {}, confirmedOnMain: () => [] },
    runDir,
    runId: 'run-t6',
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
  const round = () => state.suiteRound(step, { visits: 1, outputs: [] }, { execution: 1, reruns: 0, stopped: [] });
  return { calls, round, runDir };
}

const STEP = { id: 'suite', type: 'suite', command: 'npm test', scope: 'affected', base_check: false };

test('T6 whole_command runs the whole round, with the run\'s base and the workspace\'s shared cache', async (t) => {
  machineFolder(t);
  const { calls, round, runDir } = engineRun(t, repo(t), { ...STEP, whole_command: 'npm run test:affected' });
  const out = await round();
  assert.equal(out.status, 'pass', out.message);
  assert.equal(calls.length, 2, 'the affected files, then the whole round');
  assert.notEqual(calls[0].command, 'npm run test:affected', 'the affected round keeps the step\'s command');
  assert.equal(calls[1].command, 'npm run test:affected');
  assert.equal(calls[1].env.TURBO_SCM_BASE, 'main');
  assert.equal(calls[1].env.TURBO_CACHE_DIR, path.join(path.dirname(path.dirname(runDir)), 'cache', 'turbo'));
  assert.match(out.selection.why, /npm run test:affected/);
});

test('T6 without whole_command (or an empty one) the step\'s command runs whole, as before', async (t) => {
  machineFolder(t);
  for (const step of [STEP, { ...STEP, whole_command: '' }]) {
    const { calls, round } = engineRun(t, repo(t), step);
    assert.equal((await round()).status, 'pass');
    assert.equal(calls.at(-1).command, 'npm test');
    assert.equal(calls.at(-1).env.TURBO_CACHE_DIR, undefined);
  }
});

test('T6 one agent report per workspace (Turborepo\'s prefixed lines) reads as one report', () => {
  const rep = (passed, failed, failures = []) => JSON.stringify({ reporter: 'craftorio-agent', passed, failed, skipped: 0, todo: 0, cancelled: 0, duration_ms: passed, failures });
  const text = [
    `@craftorio/engine:test: ${rep(10, 0)}`,
    'noise',
    `@craftorio/front-build:test: ${rep(5, 1, [{ test: 'a breaks', file: 'fronts/build/test/a.test.js' }])}`,
    `//:test:root: ${rep(2, 0)}`,
  ].join('\n');
  const r = parseAgentReport(text);
  assert.deepEqual([r.passed, r.failed, r.duration_ms, r.reports], [17, 1, 10, 3]);
  assert.deepEqual(r.failures.map((f) => f.file), ['fronts/build/test/a.test.js']);
  assert.equal(parseAgentReport(rep(4, 0)).passed, 4, 'one report: that one, unchanged');
  assert.equal(parseAgentReport('no report'), null);
});

test('T6 this repository\'s hero workflows run npm run test:affected for the whole round; feature.yaml leaves it to the project', () => {
  const root = path.join(__dirname, '..', '..', '..');
  for (const f of ['.craftorio/workflows/ai-development-local-hero.yaml', '.craftorio/workflows/ai-development-remote-hero.yaml', 'workflows/feature.yaml']) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    assert.match(text, /whole_command: "\{\{ inputs\.whole_test_command \}\}"/, f);
    const def = text.match(/ {2}whole_test_command:\n(?: {4}.*\n)*? {4}default: (.*)/)[1];
    assert.equal(def, f.startsWith('.craftorio') ? '"npm run test:affected"' : '""', f);
  }
});
