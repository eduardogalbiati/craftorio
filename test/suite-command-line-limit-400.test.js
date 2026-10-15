// #400: a selection of test files too long for the platform's command line (src/engine/suite-step.js).
// - runSuite with `files` (the affected tests, the release's focused E2E rounds #324): when the filtered
//   command, with the coverage and workers wrappers, would be over the command-line limit (Windows
//   cmd.exe: 8,191 characters; macOS / Linux: their ARG_MAX), the whole suite runs instead, and
//   `selection.why` and the round's message say why. A selection that fits still runs only its files.
// - checkOnBase: a list of files too long to check on the base is skipped, like a command that cannot
//   run single files; each timed-out file reruns alone with a command that fits.
// - A round where no test ran (the shell refused the command: no report, no test result in the log)
//   is `blocked` ("could not run", with the log's last line), not `fail` with 0 failing tests.
// Machine-independent: the platform is injected (`platform`), the child-process boundary (`run`) is
// stubbed; nothing is spawned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runSuite, checkOnBase, suiteMessage } = require('../src/engine/suite-step');

const WIN_LIMIT = 8191;

function tmp(t, prefix = 'suite-400-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

// the worktree: a package.json with a coverage script (as this repository has), the run folder
function setup(t) {
  const cwd = tmp(t, 'suite-400-cwd-');
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'node scripts/test.js', 'test:coverage': 'node scripts/test.js --coverage' } }));
  return { cwd, runDir: tmp(t, 'suite-400-run-') };
}

// n test paths of about 34 characters each, like the 319 files of run 20261015-103917-113af36c
// (`npm run test:coverage -- <319 files>`: 10,931 characters)
const longSelection = (n, dir = 'test') => Array.from({ length: n }, (_, i) => `${dir}/service/area-name-${String(i).padStart(4, '0')}.test.js`);
const selectionOf = (files) => ({ mode: 'affected', files, reasons: {}, why: `${files.length} test files reach the changed files` });

// The stubbed child-process boundary: every command passes, its log holds one test result.
function passingRun() {
  const calls = [];
  const run = async ({ command, cwd, logFile }) => {
    calls.push({ command, cwd });
    if (logFile) fs.appendFileSync(logFile, 'ℹ tests 1\nℹ pass 1\nℹ fail 0\n');
    return { code: 0, timedOut: false, error: null };
  };
  return { run, calls };
}

const namesAny = (command, files) => files.some((f) => String(command).includes(f));

// ---------------------------------------------------------------------------
// The suite round
// ---------------------------------------------------------------------------

test('#400 win32: 319 selected test files over the command-line limit run the whole suite, and the selection and the message say why', async (t) => {
  const s = setup(t);
  const { run, calls } = passingRun();
  const files = longSelection(319);
  const out = await runSuite({ command: 'npm test', cwd: s.cwd, runDir: s.runDir, round: 1, run, files, selection: selectionOf(files), platform: 'win32' });
  assert.equal(calls.length, 1, `one command ran: ${calls.map((c) => c.command.length)}`);
  assert.ok(calls[0].command.length <= WIN_LIMIT, `the command fits cmd.exe (got ${calls[0].command.length} characters)`);
  assert.equal(namesAny(calls[0].command, files), false, 'the whole suite ran: the command names no selected file');
  assert.equal(out.scope, 'full');
  assert.equal(out.status, 'pass');
  assert.match(out.selection.why, /319 test files/, `selection.why counts the files: ${out.selection.why}`);
  assert.match(out.selection.why, /command[- ]line limit/i, `selection.why names the limit: ${out.selection.why}`);
  assert.match(out.selection.why, /whole suite/i, `selection.why says the whole suite ran: ${out.selection.why}`);
  assert.match(`${out.message}\n${suiteMessage(out)}`, /command[- ]line limit/i, `the round's message says why: ${out.message}`);
});

test('#400 win32: a short selection still runs only the selected files', async (t) => {
  const s = setup(t);
  const { run, calls } = passingRun();
  const files = ['test/a.test.js', 'test/b.test.js', 'test/c.test.js'];
  const out = await runSuite({ command: 'npm test', cwd: s.cwd, runDir: s.runDir, round: 1, run, files, selection: selectionOf(files), platform: 'win32' });
  assert.equal(out.scope, 'files');
  assert.equal(calls.length, 1);
  for (const f of files) assert.ok(calls[0].command.includes(f), `${f} is on the command: ${calls[0].command}`);
});

test('#400 win32: the coverage and workers wrappers count: a selection that fits bare but not wrapped runs the whole suite, never an over-limit command', async (t) => {
  const s = setup(t);
  const { run, calls } = passingRun();
  // `npm test -- <files>` just under 8,191 characters; `npm run test:coverage -- <files>` is over
  const files = [];
  for (const f of longSelection(400)) {
    if (`npm test -- ${[...files, f].join(' ')}`.length > WIN_LIMIT - 5) break;
    files.push(f);
  }
  assert.ok(`npm test -- ${files.join(' ')}`.length > WIN_LIMIT - 60, 'the bare command is close to the limit');
  const out = await runSuite({ command: 'npm test', cwd: s.cwd, runDir: s.runDir, round: 1, run, files, selection: selectionOf(files), platform: 'win32', coverage: true, testWorkers: 4 });
  for (const c of calls) assert.ok(c.command.length <= WIN_LIMIT, `no command over cmd.exe's limit (got ${c.command.length} characters)`);
  assert.equal(out.scope, 'full');
  assert.equal(namesAny(calls[0].command, files), false, 'the whole suite ran');
  assert.match(calls[0].command, /test:coverage/, `the whole suite still runs with coverage: ${calls[0].command}`);
});

test('#400 linux: 319 selected test files fit ARG_MAX and run as files', async (t) => {
  const s = setup(t);
  const { run, calls } = passingRun();
  const files = longSelection(319);
  const out = await runSuite({ command: 'npm test', cwd: s.cwd, runDir: s.runDir, round: 1, run, files, selection: selectionOf(files), platform: 'linux' });
  assert.equal(out.scope, 'files');
  assert.equal(calls.length, 1);
  assert.ok(files.every((f) => calls[0].command.includes(f)), 'every selected file is on the command');
});

for (const platform of ['linux', 'darwin']) {
  test(`#400 ${platform}: a selection of several MB, over ARG_MAX, runs the whole suite`, async (t) => {
    const s = setup(t);
    const { run, calls } = passingRun();
    const files = longSelection(100000);
    const out = await runSuite({ command: 'npm test', cwd: s.cwd, runDir: s.runDir, round: 1, run, files, selection: selectionOf(files), platform });
    assert.equal(out.scope, 'full');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].command.length < 1000, `the whole suite's command (got ${calls[0].command.length} characters)`);
    assert.match(out.selection.why, /command[- ]line limit/i, out.selection.why);
  });
}

test('#400 win32: the release\'s focused E2E round (#324) with too many feature files runs the whole E2E suite', async (t) => {
  const s = setup(t);
  const { run, calls } = passingRun();
  const files = Array.from({ length: 319 }, (_, i) => `features/an-area-of-the-application-${String(i).padStart(4, '0')}.feature`);
  const selection = { mode: 'affected', files, reasons: {}, why: 'failed in round 1' };
  const out = await runSuite({ command: 'npm run test:e2e', cwd: s.cwd, runDir: s.runDir, round: 2, run, files, selection, logName: 'e2e-2', platform: 'win32' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].command.length <= WIN_LIMIT, `the command fits cmd.exe (got ${calls[0].command.length} characters)`);
  assert.equal(namesAny(calls[0].command, files), false, 'the whole E2E suite ran');
  assert.equal(out.scope, 'full');
  assert.match(out.selection.why, /command[- ]line limit/i, out.selection.why);
});

test('#400 win32: the release\'s focused E2E round with a few feature files still runs only them', async (t) => {
  const s = setup(t);
  const { run, calls } = passingRun();
  const files = ['features/discovery.feature', 'features/backlog.feature'];
  const out = await runSuite({ command: 'npm run test:e2e', cwd: s.cwd, runDir: s.runDir, round: 2, run, files, selection: { mode: 'affected', files, reasons: {}, why: 'failed in round 1' }, logName: 'e2e-2', platform: 'win32' });
  assert.equal(out.scope, 'files');
  assert.deepEqual(calls.map((c) => c.command), ['npm run test:e2e -- features/discovery.feature features/backlog.feature']);
});

// ---------------------------------------------------------------------------
// The base check (#211, #396) and the rerun of timed-out files
// ---------------------------------------------------------------------------

function baseSetup(t, files) {
  const baseDir = tmp(t, 'suite-400-base-');
  for (const f of files) {
    fs.mkdirSync(path.join(baseDir, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(baseDir, f), "require('node:test');\n");
  }
  const runDir = tmp(t, 'suite-400-run-');
  return { baseDir, runDir, base: async () => ({ dir: baseDir, commit: 'abc1234def' }) };
}

test('#400 win32: failures in too many files to check on the base skip the base check with the reason, never an over-limit command', async (t) => {
  const files = longSelection(319);
  const b = baseSetup(t, files);
  const { run, calls } = passingRun();
  const failures = files.map((file) => ({ test: `${path.basename(file)} test`, file, error: 'broke' }));
  const { onBase, info } = await checkOnBase({
    command: 'npm test', failures, base: b.base, run, timeoutMs: 60e3,
    logFile: path.join(b.runDir, 'logs', 'suite-1-base.log'), runDir: b.runDir, platform: 'win32',
  });
  for (const c of calls) assert.ok(c.command.length <= WIN_LIMIT, `no command over cmd.exe's limit (got ${c.command.length} characters)`);
  assert.equal(onBase.length, 0);
  assert.equal(info.status, 'skipped');
  assert.match(String(info.reason), /command[- ]line limit/i, `the reason names the limit: ${info.reason}`);
});

test('#400 win32: failures in a few files are still checked on the base', async (t) => {
  const files = ['test/a.test.js', 'test/b.test.js'];
  const b = baseSetup(t, files);
  const { run, calls } = passingRun();
  const failures = files.map((file) => ({ test: `${path.basename(file)} test`, file, error: 'broke' }));
  const { info } = await checkOnBase({
    command: 'npm test', failures, base: b.base, run, timeoutMs: 60e3,
    logFile: path.join(b.runDir, 'logs', 'suite-1-base.log'), runDir: b.runDir, platform: 'win32',
  });
  assert.equal(calls.length, 1);
  assert.equal(path.resolve(calls[0].cwd), path.resolve(b.baseDir));
  for (const f of files) assert.ok(calls[0].command.includes(f), `${f} is checked on the base: ${calls[0].command}`);
  assert.deepEqual(info.ran, files);
});

test('#400 win32: when 319 test files were still running at the timeout, each reruns alone with a command that fits', async (t) => {
  const s = setup(t);
  const running = longSelection(319);
  const calls = [];
  const run = async ({ command, logFile }) => {
    calls.push(command);
    if (!namesAny(command, running)) return { code: null, timedOut: true, error: null, running };
    fs.appendFileSync(logFile, 'ℹ tests 1\nℹ pass 1\nℹ fail 0\n');
    return { code: 0, timedOut: false, error: null };
  };
  const out = await runSuite({ command: 'npm test', cwd: s.cwd, runDir: s.runDir, round: 1, run, timeoutMs: 30e3, platform: 'win32' });
  assert.equal(out.timed_out, true);
  const reruns = calls.filter((c) => namesAny(c, running));
  assert.equal(reruns.length, 319, 'each file still running reruns alone on the branch');
  for (const c of calls) assert.ok(c.length <= WIN_LIMIT, `no command over cmd.exe's limit (got ${c.length} characters)`);
  assert.equal(Array.isArray(out.alone) && out.alone.length, 319);
});

// ---------------------------------------------------------------------------
// A round where no test ran
// ---------------------------------------------------------------------------

for (const refusal of ['The command line is too long.', 'Linha de comando muito longa.']) {
  test(`#400 a suite log that ends with the shell's refusal ("${refusal}") and no test result is blocked, not a failure`, async (t) => {
    const s = setup(t);
    const run = async ({ logFile }) => {
      fs.appendFileSync(logFile, `${refusal}\r\n`);
      return { code: 1, timedOut: false, error: null };
    };
    const out = await runSuite({ command: 'npm test', cwd: s.cwd, runDir: s.runDir, round: 1, run, platform: 'win32' });
    assert.equal(out.status, 'blocked');
    assert.equal(out.failures.length, 0, `no failing test is reported: ${JSON.stringify(out.failures)}`);
    assert.ok(String(out.reason).includes(refusal), `the reason quotes the log's last line: ${out.reason}`);
    assert.match(out.message, /could not run/i, out.message);
    assert.match(suiteMessage(out), /could not run|did not run/i, suiteMessage(out));
  });
}

test('#400 a red round with test results in the log is still a failure', async (t) => {
  const s = setup(t);
  const run = async ({ logFile }) => {
    fs.appendFileSync(logFile, '✖ failing tests:\n\ntest at test/a.test.js:3:1\n✖ a test (1ms)\n  Error: a test broke\n\nℹ tests 2\nℹ pass 1\nℹ fail 1\n');
    return { code: 1, timedOut: false, error: null };
  };
  const out = await runSuite({ command: 'npm test', cwd: s.cwd, runDir: s.runDir, round: 1, run, platform: 'win32' });
  assert.equal(out.status, 'fail');
  assert.ok(out.failures.some((f) => f.test === 'a test'), JSON.stringify(out.failures));
});
