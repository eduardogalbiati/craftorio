// #465 a live terminal on the deterministic steps (acceptance tests written before the code). When a
// suite / e2e / check / screenshots step starts its command, the run emits
//   step.log { step_id, path, command }
// with `path` relative to the run folder (forward slashes): logs/suite-<round>.log for the `suite`
// step, logs/<step>-<round>.log for another suite step (an e2e step), logs/check-<visit>.log for a
// check step, logs/screenshots-<visit>.log for a screenshots step (whose `npm run screenshot` output
// now goes to that file). It is emitted before the command runs (the terminal can follow the file
// from its first line); file.saved at the end is unchanged. While a whole-suite round waits (another
// run's suite slot, the memory guard), its log says so.
// Seams (as test/engine-suite-slot.test.js): WorkflowRun.prototype's step methods called on a small
// run state (suiteRound, suiteRounds, runCheckStep, runScreenshots) whose machine runs the real
// runSuite / captureScreenshots with a stubbed `run` (nothing spawned, except the check step's
// `node ok.js` in a temp folder: local and fast, as test/check-step-internals-404.test.js runs it).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const suiteStep = require('../engine/suite-step');
const { WorkflowRun } = require('../engine/workflow');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-465-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const tmp = (t, prefix = 'step-log-465-') => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
};

// the machine-wide locks folder in a temp folder (the suite slot of #455 is taken there)
function machineFolder(t) {
  const root = tmp(t, 'step-log-465-machine-');
  const dir = path.join(root, 'craftorio', 'locks');
  const saved = {};
  for (const k of ['TEMP', 'TMP', 'TMPDIR', 'MULTIAGENT_LOCKS_DIR']) saved[k] = process.env[k];
  process.env.TEMP = root;
  process.env.TMP = root;
  process.env.TMPDIR = root;
  process.env.MULTIAGENT_LOCKS_DIR = dir;
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  return dir;
}

// a repository whose whole suite is `npm test`, a check script and a screenshot script
function repo(t) {
  const dir = tmp(t, 'step-log-465-repo-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node --test', check: 'node ok.js', screenshot: 'node shot.js' } }));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), '1\n');
  fs.writeFileSync(path.join(dir, 'ok.js'), "console.log('checks: pass');\n");
  fs.writeFileSync(path.join(dir, 'shot.js'), '\n');
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'run-branch');
  return dir;
}

// a stubbed suite command: records the events emitted before it was called, writes a line to its log
function fakeRun(events) {
  const calls = [];
  const run = async (opts) => {
    calls.push({ eventsBefore: events.map((e) => ({ ...e })), logFile: opts.logFile });
    if (opts.logFile) fs.appendFileSync(opts.logFile, 'ok 1 - a\n');
    return { code: 0, timedOut: false, error: null };
  };
  return { run, calls };
}

function engineRun(t, worktree, runId = 'run-465') {
  const runDir = path.join(tmp(t, 'step-log-465-run-'), 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const events = [];
  const { run, calls } = fakeRun(events);
  const state = Object.create(WorkflowRun.prototype);
  Object.assign(state, {
    mock: false,
    mockSequences: {},
    machine: { simulated: false, runSuite: (opts) => suiteStep.runSuite({ ...opts, run }), noteFailingOnMain: () => {} },
    runDir,
    runId,
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
  return { state, events, calls, runDir };
}

const stepLogs = (events, stepId) => events.filter((e) => e.type === 'step.log' && e.step_id === stepId);

test('#465 a suite round emits step.log { step_id, path: logs/suite-<round>.log, command } before its command runs', async (t) => {
  machineFolder(t);
  const { state, events, calls } = engineRun(t, repo(t));
  const out = await state.suiteRound({ id: 'suite', type: 'suite', command: 'npm test' }, { visits: 2, outputs: [] }, { execution: 2, reruns: 0, stopped: [] });
  assert.equal(out.status, 'pass', out.message);
  const logs = stepLogs(events, 'suite');
  assert.equal(logs.length, 1, `one step.log for the round: ${JSON.stringify(events.map((e) => e.type))}`);
  assert.equal(logs[0].path, 'logs/suite-2.log', 'relative to the run folder, forward slashes');
  assert.match(String(logs[0].command), /npm test/);
  assert.equal(calls.length, 1);
  assert.ok(stepLogs(calls[0].eventsBefore, 'suite').length === 1, 'emitted before the command was started');
  assert.ok(events.some((e) => e.type === 'file.saved' && e.step_id === 'suite'), 'file.saved at the end is unchanged');
});

test('#465 an e2e suite step\'s step.log names its own log: logs/e2e-<round>.log', async (t) => {
  machineFolder(t);
  const { state, events } = engineRun(t, repo(t));
  await state.suiteRound({ id: 'e2e', type: 'suite', command: 'npm test' }, { visits: 1, outputs: [] }, { execution: 1, reruns: 0, stopped: [] });
  const logs = stepLogs(events, 'e2e');
  assert.equal(logs.length, 1, `one step.log: ${JSON.stringify(events.map((e) => e.type))}`);
  assert.equal(logs[0].path, 'logs/e2e-1.log');
  assert.match(String(logs[0].command), /npm test/);
});

test('#465 a check step emits step.log { path: logs/check-<visit>.log, command } before its result', async (t) => {
  const { state, events } = engineRun(t, repo(t));
  const out = await state.runCheckStep({ id: 'rule_check', type: 'check', command: 'node ok.js' }, { visits: 3 });
  assert.equal(out.status, 'pass', out.message);
  const logs = stepLogs(events, 'rule_check');
  assert.equal(logs.length, 1, `one step.log: ${JSON.stringify(events.map((e) => e.type))}`);
  assert.equal(logs[0].path, 'logs/check-3.log');
  assert.match(String(logs[0].command), /node ok\.js/);
  const result = events.findIndex((e) => e.type === 'log' && e.step_id === 'rule_check');
  assert.ok(events.indexOf(logs[0]) < result, 'before the check\'s result line');
});

test('#465 a screenshots step emits step.log { path: logs/screenshots-<visit>.log } and its command\'s output goes to that file', async (t) => {
  const { captureScreenshots } = require('../engine/screenshot-step');
  const { state, events, runDir } = engineRun(t, repo(t));
  const shots = [];
  // the capture command, stubbed as runShot would run it: its output to the log it is given (if any)
  const run = async (opts) => {
    shots.push(stepLogs(events, 'screens').length);
    const text = `SHOT-OUTPUT ${opts.args.join(' ')}\n`;
    if (opts.logFile) fs.appendFileSync(opts.logFile, text);
    return { code: 1, output: text, timedOut: false };
  };
  const slot = async () => ({ token: 'tok', release() {} });
  state.machine.captureScreenshots = (opts) => captureScreenshots({ ...opts, run, slot });
  state.ctx.steps = { develop: { output: { screenshots: [{ name: '465-run', caption: 'The Run screen', args: ['--view', 'run'] }] } } };
  await state.runScreenshots({ id: 'screens', type: 'screenshots', from: 'develop' }, { visits: 1 });
  const logs = stepLogs(events, 'screens');
  assert.equal(logs.length, 1, `one step.log: ${JSON.stringify(events.map((e) => e.type))}`);
  assert.equal(logs[0].path, 'logs/screenshots-1.log');
  assert.match(String(logs[0].command), /npm run screenshot/);
  assert.ok(shots.length >= 1 && shots[0] === 1, 'emitted before the first capture ran');
  const file = path.join(runDir, 'logs', 'screenshots-1.log');
  assert.ok(fs.existsSync(file), 'the log file exists');
  assert.match(fs.readFileSync(file, 'utf8'), /SHOT-OUTPUT/, 'the command\'s output is in it');
});

test('#465 while a whole-suite round waits for another run\'s suite slot, its log already says so', async (t) => {
  const dir = path.join(tmp(t), 'locks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'suite.slot'), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'other', started: Date.now(), holder: 'run-a' }));
  const cwd = repo(t);
  const runDir = tmp(t);
  const run = async () => ({ code: 0, timedOut: false, error: null });
  const round = suiteStep.runSuite({ command: 'npm test', cwd, runDir, round: 1, run, timeoutMs: 120e3, slot: { dir, holder: 'run-b', pollMs: 50 } });
  await new Promise((r) => setTimeout(r, 600));
  const log = path.join(runDir, 'logs', 'suite-1.log');
  const during = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  fs.rmSync(path.join(dir, 'suite.slot'), { force: true });
  await round;
  assert.match(during, /wait\w* for the suite slot/i, `the log while waiting: ${JSON.stringify(during)}`);
});

test('#465 scope failed after a wait for memory: the focused round\'s log keeps the wait, the -full round\'s log starts clean', async (t) => {
  machineFolder(t);
  const { state, runDir } = engineRun(t, repo(t));
  const prev = { round: 1, status: 'fail', scope: 'full', failures: [{ file: 'test/a.test.js', test: 'a' }] };
  const out = await state.suiteRound(
    { id: 'suite', type: 'suite', command: 'npm test', scope: 'failed' },
    { visits: 2, outputs: [prev] },
    { execution: 2, reruns: 0, stopped: [], logPrefix: '# suite waits for memory before it starts\n' },
  );
  assert.equal(out.status, 'pass', out.message);
  const focused = fs.readFileSync(path.join(runDir, 'logs', 'suite-2.log'), 'utf8');
  const full = fs.readFileSync(path.join(runDir, 'logs', 'suite-2-full.log'), 'utf8');
  assert.match(focused, /waits for memory/, `the focused round's log: ${JSON.stringify(focused.slice(0, 300))}`);
  assert.doesNotMatch(full, /waits for memory/, `the -full round's log: ${JSON.stringify(full.slice(0, 300))}`);
});

test('#465 two captures: the second capture\'s "$ command" line comes after all of the first capture\'s output', async (t) => {
  const { captureScreenshots } = require('../engine/screenshot-step');
  const { state, runDir } = engineRun(t, repo(t));
  // each capture writes its output in two parts, the second one late (as a stream flushing)
  const run = async (opts) => {
    const name = opts.args.join(' ');
    if (opts.logFile) fs.appendFileSync(opts.logFile, `OUT-START ${name}\n`);
    await new Promise((r) => setTimeout(r, 30));
    if (opts.logFile) fs.appendFileSync(opts.logFile, `OUT-END ${name}\n`);
    return { code: 1, output: '', timedOut: false };
  };
  const slot = async () => ({ token: 'tok', release() {} });
  state.machine.captureScreenshots = (opts) => captureScreenshots({ ...opts, run, slot });
  state.ctx.steps = { develop: { output: { screenshots: [
    { name: '465-one', caption: 'One', args: ['--view', 'one'] },
    { name: '465-two', caption: 'Two', args: ['--view', 'two'] },
  ] } } };
  await state.runScreenshots({ id: 'screens', type: 'screenshots', from: 'develop' }, { visits: 1 });
  const lines = fs.readFileSync(path.join(runDir, 'logs', 'screenshots-1.log'), 'utf8').split(/\r?\n/);
  const firstEnd = lines.findIndex((l) => l.includes('OUT-END') && l.includes('one'));
  const secondCmd = lines.findIndex((l) => l.startsWith('$ ') && l.includes('two'));
  assert.ok(firstEnd >= 0 && secondCmd >= 0, `both lines in the log: ${JSON.stringify(lines)}`);
  assert.ok(firstEnd < secondCmd, `the first capture's output ends before the second command: ${JSON.stringify(lines)}`);
});

test('#465 while a suite step waits for memory (the memory guard), its log says so', async (t) => {
  machineFolder(t);
  const { state, runDir } = engineRun(t, repo(t));
  state.memoryGuard = {
    waitForMemory: async ({ onWait }) => {
      onWait({ freeBytes: 1 * 2 ** 30, floorBytes: 2 * 2 ** 30 });
      return { waitedMs: 1500, recovered: true };
    },
    incidentsBetween: () => [],
  };
  await state.suiteRounds({ id: 'suite', type: 'suite', command: 'npm test' }, { visits: 1, outputs: [] });
  const text = fs.readFileSync(path.join(runDir, 'logs', 'suite-1.log'), 'utf8');
  assert.match(text, /wait\w* for memory|memory guard/i, `the round's log names the wait for memory: ${JSON.stringify(text.slice(0, 600))}`);
});
