// #553 (acceptance tests written before the code): a `scope: affected` suite step runs the whole suite
// at most once per run. The first time the affected files pass, the whole suite runs, as before; when it
// fails, the next rounds run the files that failed plus the files affected by the changes since that
// whole suite, and never the whole suite again. Only a round whose changes touch a shared root
// (package.json, the lockfile, scripts/test.js: the selection's whole-suite mode) runs it again, and
// says why.
// Seams (as test/engine-step-log-465.test.js): WorkflowRun.prototype.suiteRound on a small run state
// whose machine is the real one (machine-actions.js: the real affected-tests selection over a real git
// repository) and runs the real runSuite with a stubbed child-process boundary (`run`): nothing spawned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const suiteStep = require('../engine/suite-step');
const machineActions = require('../engine/machine-actions');
const { WorkflowRun } = require('../engine/workflow');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-553-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const tmp = (t, prefix = 'suite-553-') => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
};

// the machine-wide locks folder in a temp folder (a whole-suite round takes the suite slot of #455 there)
function machineFolder(t) {
  const root = tmp(t, 'suite-553-machine-');
  const saved = {};
  for (const k of ['TEMP', 'TMP', 'TMPDIR', 'MULTIAGENT_LOCKS_DIR']) saved[k] = process.env[k];
  process.env.TEMP = root;
  process.env.TMP = root;
  process.env.TMPDIR = root;
  process.env.MULTIAGENT_LOCKS_DIR = path.join(root, 'craftorio', 'locks');
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

// a project with two modules, each with its test, and a test of its own (test/c.test.js); the run's
// branch changes src/x.js
// extra: more files of the base commit ({ path: text })
function repo(t, { scripts = { test: 'node --test' }, extra = {} } = {}) {
  const dir = tmp(t, 'suite-553-repo-');
  const write = (f, text) => { fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
  write('package.json', JSON.stringify({ name: 'p', scripts }));
  for (const [f, text] of Object.entries(extra)) write(f, text);
  write('src/x.js', 'module.exports = 1;\n');
  write('src/z.js', 'module.exports = 1;\n');
  write('test/x.test.js', "require('../src/x');\n");
  write('test/z.test.js', "require('../src/z');\n");
  write('test/c.test.js', "require('node:test');\n");
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'run-branch');
  return { dir, commit: (f, text, msg = `change ${f}`) => { write(f, text); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); } };
}

const TEST_PATH = /test\/[\w./-]+\.test\.js/g;

// The stubbed suite command. `failing`: the test files that fail now; a whole run (no file on the
// command, no list) runs them all (WHOLE_TESTS tests), a focused run only those it selects (one test
// per file). `opts.whole`: how the next whole run ends ('timeout': the suite's timeout; 'unreadable':
// exit 1 with no failing test in its log). `opts.ignoreList`: the runner ignores MULTIAGENT_TEST_FILES
// and runs the whole suite. Each call is recorded with the files it ran (null: the whole suite).
const WHOLE_TESTS = 1000;
function fakeSuite() {
  const failing = new Set();
  const calls = [];
  const opts = { whole: 'normal', ignoreList: false };
  const run = async ({ command, env, logFile }) => {
    const listFile = env?.MULTIAGENT_TEST_FILES;
    const listed = listFile ? fs.readFileSync(path.resolve(listFile), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
    const named = String(command).match(TEST_PATH) || [];
    let files = listed.length || named.length ? [...new Set([...listed, ...named])].sort() : null;
    if (listed.length && opts.ignoreList) files = null;
    calls.push({ command, files, listed: listed.length > 0 });
    if (!files && opts.whole === 'timeout') {
      opts.whole = 'normal';
      if (logFile) fs.appendFileSync(logFile, 'ℹ tests 10\nℹ pass 10\nℹ fail 0\n');
      return { code: null, timedOut: true, error: null };
    }
    if (!files && opts.whole === 'unreadable') {
      opts.whole = 'normal';
      if (logFile) fs.appendFileSync(logFile, 'Error: the worker crashed\n');
      return { code: 1, timedOut: false, error: null };
    }
    const red = [...failing].filter((f) => !files || files.includes(f));
    const blocks = red.map((f) => `test at ${f}:3:1\n✖ ${path.basename(f)} breaks (1ms)\n  Error: it broke\n`).join('\n');
    const total = files ? files.length : WHOLE_TESTS;
    if (logFile) fs.appendFileSync(logFile, `${red.length ? `✖ failing tests:\n\n${blocks}\n` : ''}ℹ tests ${total}\nℹ pass ${total - red.length}\nℹ fail ${red.length}\n`);
    return { code: red.length ? 1 : 0, timedOut: false, error: null };
  };
  return { run, calls, failing, opts, wholeRuns: () => calls.filter((c) => c.files === null).length };
}

// platform: the platform runSuite measures the command line for (#400; injected at the machine's
// boundary so a long selection goes through the list on any machine)
function engineRun(t, worktree, { platform } = {}) {
  const runDir = path.join(tmp(t, 'suite-553-run-'), 'runs', 'run-553');
  fs.mkdirSync(runDir, { recursive: true });
  const events = [];
  const suite = fakeSuite();
  const state = Object.create(WorkflowRun.prototype);
  Object.assign(state, {
    mock: false,
    mockSequences: {},
    machine: {
      ...machineActions.real(),
      simulated: false,
      runSuite: (opts) => suiteStep.runSuite({ ...opts, run: suite.run, ...(platform ? { platform } : {}) }),
      noteFailingOnMain: () => {},
      confirmedOnMain: () => [],
    },
    runDir,
    runId: 'run-553',
    worktree: { repo: worktree, base: 'main' },
    ctx: { worktree_dir: worktree, steps: {} },
    abort: new AbortController(),
    preexisting: [],
    suiteRuns: { engine: 0 },
    suiteFailedFiles: [],
    fullSuitePassed: false,
    watchMemory: () => ({ stop() {} }),
    emitEvent: (type, data) => events.push({ type, ...data }),
  });
  const outputs = [];
  // one round of the step; its output is kept for the next round, as the engine does
  const round = async () => {
    const visits = outputs.length + 1;
    const out = await state.suiteRound(STEP, { visits, outputs: [...outputs] }, { execution: visits, reruns: 0, stopped: [] });
    outputs.push(out);
    return out;
  };
  return { state, events, suite, runDir, round };
}

// the suite step of the local workflows; the base check is off (its failures stay this run's)
const STEP = { id: 'suite', type: 'suite', command: 'npm test', scope: 'affected', base_check: false };

const fullLogs = (runDir) => {
  try { return fs.readdirSync(path.join(runDir, 'logs')).filter((f) => /^suite-.*-full\.log$/.test(f)); } catch { return []; }
};
const lastCall = (suite) => suite.calls[suite.calls.length - 1];

test('#553 after a failing whole suite, three fix rounds run filtered and the run has exactly one whole suite', async (t) => {
  machineFolder(t);
  const r = repo(t);
  r.commit('src/x.js', 'module.exports = 2;\n');
  const { suite, runDir, round } = engineRun(t, r.dir);

  // round 1: the affected file passes, the whole suite runs once and fails on test/c.test.js
  suite.failing.add('test/c.test.js');
  const one = await round();
  assert.equal(one.status, 'fail', one.message);
  assert.equal(suite.wholeRuns(), 1, 'round 1 ran the whole suite once');

  // round 2 (a fix that touches src/z.js, test/c.test.js still red): the failed file and the files the
  // change since the whole suite reaches, no whole suite
  r.commit('src/z.js', 'module.exports = 2;\n');
  const before2 = suite.calls.length;
  const two = await round();
  assert.equal(two.status, 'fail', two.message);
  assert.equal(two.scope, 'files');
  assert.equal(suite.calls.length - before2, 1, 'one command in round 2');
  const files2 = lastCall(suite).files || [];
  assert.ok(files2.includes('test/c.test.js'), `the file that failed runs again: ${files2}`);
  assert.ok(files2.includes('test/z.test.js'), `the file the change since the whole suite reaches runs: ${files2}`);
  assert.equal(files2.includes('test/x.test.js'), false, `a file only the change before the whole suite reaches does not run again: ${files2}`);

  // round 3 (the fix of test/c.test.js): green, filtered, no whole suite
  suite.failing.delete('test/c.test.js');
  r.commit('test/c.test.js', "require('node:test');\n// fixed\n");
  const three = await round();
  assert.equal(three.status, 'pass', three.message);
  assert.equal(three.scope, 'files');
  assert.ok((lastCall(suite).files || []).includes('test/c.test.js'), 'the fixed file runs');

  // round 4 (another change): green, filtered, no whole suite
  r.commit('src/z.js', 'module.exports = 3;\n');
  const four = await round();
  assert.equal(four.status, 'pass', four.message);
  assert.equal(four.scope, 'files');

  assert.equal(suite.wholeRuns(), 1, `one whole suite in the run: ${JSON.stringify(suite.calls.map((c) => c.files ? `${c.files.length} file(s)` : 'whole'))}`);
  assert.deepEqual(fullLogs(runDir), ['suite-1-full.log'], 'one suite-*-full.log in the run');
});

test('#553 a fix round whose change touches a shared root (package.json) runs the whole suite again, and its output says why', async (t) => {
  machineFolder(t);
  const r = repo(t);
  r.commit('src/x.js', 'module.exports = 2;\n');
  const { suite, round } = engineRun(t, r.dir);

  suite.failing.add('test/c.test.js');
  const one = await round();
  assert.equal(one.status, 'fail', one.message);
  assert.equal(suite.wholeRuns(), 1);

  suite.failing.delete('test/c.test.js');
  r.commit('package.json', JSON.stringify({ name: 'p', version: '1.0.1', scripts: { test: 'node --test' } }));
  const two = await round();
  assert.equal(suite.wholeRuns(), 2, 'the shared root brings the whole suite back');
  assert.equal(two.status, 'pass', two.message);
  assert.notEqual(two.scope, 'files');
  const said = `${two.selection?.why || ''}\n${two.message || ''}\n${suiteStep.suiteMessage(two)}`;
  assert.match(said, /package\.json/, `the output names the shared root: ${said}`);
  assert.match(said, /whole suite/i, `the output says the whole suite runs: ${said}`);
});

test('#553 a whole suite that fails is not repeated when the next round\'s affected files pass', async (t) => {
  machineFolder(t);
  const r = repo(t);
  r.commit('src/x.js', 'module.exports = 2;\n');
  const { suite, runDir, round } = engineRun(t, r.dir);

  suite.failing.add('test/c.test.js');
  await round();
  suite.failing.delete('test/c.test.js');
  r.commit('test/c.test.js', "require('node:test');\n// fixed\n");
  const two = await round();
  assert.equal(two.status, 'pass', two.message);
  assert.equal(two.scope, 'files', 'the green fix round stands without a whole suite');
  assert.equal(suite.wholeRuns(), 1);
  assert.equal(fs.existsSync(path.join(runDir, 'logs', 'suite-2-full.log')), false, 'no suite-2-full.log');
});

// A whole suite that does not stand for every file (#364's rule) is not the run's whole suite: the
// next round whose affected files pass runs the whole suite again, never a green round of 0 files.
for (const [kind, label] of [['timeout', 'times out'], ['unreadable', 'fails without a failing test in its log ("(unrecognized failure)")']]) {
  test(`#553 a whole suite that ${label} does not count: the next round runs the whole suite again`, async (t) => {
    machineFolder(t);
    const r = repo(t);
    r.commit('src/x.js', 'module.exports = 2;\n');
    const { suite, runDir, round } = engineRun(t, r.dir);

    suite.opts.whole = kind;
    const one = await round();
    assert.notEqual(one.status, 'pass', one.message);
    assert.equal(suite.wholeRuns(), 1, 'round 1 ran the whole suite');

    r.commit('src/z.js', 'module.exports = 2;\n');
    const two = await round();
    assert.equal(suite.wholeRuns(), 2, `round 2 runs the whole suite again: ${JSON.stringify(suite.calls.map((c) => (c.files ? c.files : 'whole')))}`);
    assert.equal(fs.existsSync(path.join(runDir, 'logs', 'suite-2-full.log')), true, 'suite-2-full.log');
    assert.equal(two.status, 'pass', two.message);
    assert.notEqual(two.scope, 'files', 'the round\'s result is the whole suite');
    assert.ok((two.passed || 0) > 0, `the round ran tests, not 0 files: ${two.passed}`);
  });
}

test('#553 a fix round through the list whose runner ignored it (as many tests as the run\'s whole suite) is reported as a whole run', async (t) => {
  machineFolder(t);
  // 300 test files of src/z.js with long paths: a selection over the Windows command line; a runner
  // that reads the list (scripts/test.js, as this repository's)
  const extra = { 'scripts/test.js': '// the files: the command line or process.env.MULTIAGENT_TEST_FILES\n' };
  for (let i = 0; i < 300; i++) extra[`test/service/area-name-${String(i).padStart(4, '0')}.test.js`] = "require('../../src/z');\n";
  const r = repo(t, { scripts: { test: 'node scripts/test.js' }, extra });
  r.commit('src/x.js', 'module.exports = 2;\n');
  const { suite, round } = engineRun(t, r.dir, { platform: 'win32' });

  suite.failing.add('test/c.test.js');
  const one = await round();
  assert.equal(one.status, 'fail', one.message);
  assert.equal(suite.wholeRuns(), 1);

  // round 2: the change reaches the 300 files; the selection goes through the list, which the runner ignores
  suite.failing.delete('test/c.test.js');
  suite.opts.ignoreList = true;
  r.commit('src/z.js', 'module.exports = 2;\n');
  const two = await round();
  const last = lastCall(suite);
  assert.equal(last.listed, true, `round 2's command got the list: ${last.command}`);
  assert.equal(two.scope, 'full', 'reported as a whole run');
  assert.equal(two.list_ignored, true);
  assert.match(String(two.selection?.why), /ignored the list/i, `selection.why says so: ${two.selection?.why}`);
});

test('#553 after the run\'s whole suite, a slow test file the new changes reach joins the selection', async (t) => {
  machineFolder(t);
  const r = repo(t, { extra: { 'test/slow/z.slow.test.js': "require('../../src/z');\n" } });
  r.commit('src/x.js', 'module.exports = 2;\n');
  const { suite, round } = engineRun(t, r.dir);

  suite.failing.add('test/c.test.js');
  await round();
  assert.equal(suite.wholeRuns(), 1);

  r.commit('src/z.js', 'module.exports = 2;\n');
  const two = await round();
  assert.equal(suite.wholeRuns(), 1, 'no second whole suite');
  const files = lastCall(suite).files || [];
  assert.ok(files.includes('test/slow/z.slow.test.js'), `the slow file runs with the selection: ${files}`);
  assert.ok((two.selection?.files || []).includes('test/slow/z.slow.test.js'), 'selection.files names it');
});
