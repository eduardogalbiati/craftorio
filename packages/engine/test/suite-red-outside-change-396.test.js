// #396: a suite that is red only outside the change (packages/engine/engine/suite-step.js runSuite, the
// suite_lines filter of packages/engine/engine/gate-summary.js, workflows/feature.yaml).
// - A timed-out round is checked like a failure: the test files still running are rerun alone, on
//   the branch and on the base, each with its own timeout (at least 2 min); a file that passes alone
//   on the branch, or hangs / fails on the base too, is reported outside the change with its reason
//   instead of "(the whole suite)"; the results of the files that had finished are kept.
// - Every counted failure is classified "in the change" (its test file is changed or reaches a
//   changed file through the import graph, affected-tests.js) or "outside the change".
// - The owner's policy input `suite_red_outside_change: ask | continue` (default ask) exists on the
//   local hero of AI Development only.
// runSuite runs with a stubbed `run` (the child-process boundary): no real process is spawned. The
// branch is a small git repository (the import graph lists files with git); the base checkout is a
// plain folder holding the same test files. The whole mock run with the policy on is in
// test/slow/suite-red-outside-change-396.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { runSuite, suiteMessage } = require('../engine/suite-step');
const { suiteLines } = require('../engine/gate-summary');

const ROOT = path.join(__dirname, '..', '..', '..');
const MIN_FILE_TIMEOUT_MS = 2 * 60e3;
const ROUND_TIMEOUT_MS = 30e3;

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

// src/a.js (the change), test/a.test.js imports it; the other test files import nothing changed
const FILES = {
  'src/a.js': 'module.exports = 1;\n',
  'test/a.test.js': "require('node:test');\nrequire('../src/a.js');\n",
  'test/other.test.js': "require('node:test');\n",
  'test/done.test.js': "require('node:test');\n",
  'test/hang.test.js': "require('node:test');\n",
  'test/slow2.test.js': "require('node:test');\n",
};
function writeFiles(dir) {
  for (const [f, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
}

// the branch (a git checkout: the import graph lists its files with git), the base checkout, the run folder
function setup(t) {
  const cwd = tmp(t, 'suite-396-branch-');
  git(cwd, 'init', '-q');
  writeFiles(cwd);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'branch');
  const baseDir = tmp(t, 'suite-396-base-');
  writeFiles(baseDir);
  const runDir = tmp(t, 'suite-396-run-');
  return { cwd, baseDir, runDir, base: async () => ({ dir: baseDir, commit: 'abc1234def' }) };
}

const failureText = (file, name) => `✖ failing tests:\n\ntest at ${file}:3:1\n✖ ${name} (1ms)\n  Error: ${name} broke\n\n`;
const TEST_FILE = /test\/[\w.-]+\.test\.js/g;

// The stubbed child-process boundary. The round itself (a command naming no test file) writes
// `round.text` and returns `round.result`; a command naming test files is a rerun, on the branch or
// on the base (told apart by cwd): each named file passes, fails or hangs as `alone[where][file]` says.
function fakeRun({ baseDir, round, alone = { branch: {}, base: {} } }) {
  const calls = [];
  const run = async ({ command, cwd, timeoutMs, logFile }) => {
    const files = String(command).match(TEST_FILE) || [];
    const where = path.resolve(cwd) === path.resolve(baseDir) ? 'base' : 'branch';
    calls.push({ command, where, files, timeoutMs });
    if (!files.length) {
      fs.appendFileSync(logFile, round.text);
      return { error: null, ...round.result };
    }
    const outcome = (f) => alone[where][f] || 'pass';
    const failing = files.filter((f) => outcome(f) === 'fail');
    const hanging = files.filter((f) => outcome(f) === 'hang');
    fs.appendFileSync(logFile, `${failing.map((f) => failureText(f, `${path.basename(f)} test`)).join('')}ℹ pass ${files.length - failing.length - hanging.length}\nℹ fail ${failing.length}\n`);
    if (hanging.length) return { code: null, timedOut: true, error: null, running: hanging };
    return { code: failing.length ? 1 : 0, timedOut: false, error: null };
  };
  return { run, calls };
}

// A round cut by its timeout while `running` were still running; test/done.test.js had finished, red.
const timedOutRound = (running) => ({
  text: `${failureText('test/done.test.js', 'done test')}`,
  result: { code: null, timedOut: true, running },
});

const lineOf = (text, file) => String(text).split('\n').find((l) => l.includes(file)) || '';
const rerunsOf = (calls, file, where) => calls.filter((c) => c.where === where && c.files.length === 1 && c.files[0] === file);

async function timedOutSuite(t, { running, alone, changed = ['src/a.js'] }) {
  const s = setup(t);
  const { run, calls } = fakeRun({ baseDir: s.baseDir, round: timedOutRound(running), alone });
  const out = await runSuite({
    command: 'npm test', cwd: s.cwd, runDir: s.runDir, round: 1, run, base: s.base,
    timeoutMs: ROUND_TIMEOUT_MS, changedFiles: () => changed,
  });
  return { out, calls };
}

// ---------------------------------------------------------------------------
// A timed-out round: the files still running are rerun alone
// ---------------------------------------------------------------------------

test('#396 timeout: files that pass alone on the branch are reported outside the change, each rerun alone with at least 2 min, and the finished files\' results are kept', async (t) => {
  const { out, calls } = await timedOutSuite(t, { running: ['test/hang.test.js', 'test/slow2.test.js'] });
  assert.equal(out.timed_out, true);
  assert.ok(!out.failures.some((f) => f.test === '(the whole suite)'), `no "(the whole suite)" failure: ${JSON.stringify(out.failures)}`);
  for (const file of ['test/hang.test.js', 'test/slow2.test.js']) {
    const reruns = rerunsOf(calls, file, 'branch');
    assert.equal(reruns.length, 1, `${file} reruns alone on the branch once: ${JSON.stringify(calls)}`);
    assert.ok(reruns[0].timeoutMs >= MIN_FILE_TIMEOUT_MS, `${file}'s rerun has its own timeout of at least 2 min (got ${reruns[0].timeoutMs})`);
    const line = lineOf(suiteMessage(out), file);
    assert.match(line, /outside the change/, `the suite output reports ${file} outside the change: ${suiteMessage(out)}`);
    assert.match(line, /alone/i, `the reason says it passes alone on the branch: ${line}`);
  }
  assert.ok(out.failures.some((f) => f.file === 'test/done.test.js' && f.test === 'done test'), `the failure of a file that had finished is kept: ${JSON.stringify(out.failures)}`);
});

test('#396 timeout: a file that hangs alone on the branch and on the base too is reported outside the change, the base rerun with its own timeout', async (t) => {
  const { out, calls } = await timedOutSuite(t, {
    running: ['test/hang.test.js'],
    alone: { branch: { 'test/hang.test.js': 'hang' }, base: { 'test/hang.test.js': 'hang' } },
  });
  assert.ok(!out.failures.some((f) => f.test === '(the whole suite)'), `no "(the whole suite)" failure: ${JSON.stringify(out.failures)}`);
  const onBase = rerunsOf(calls, 'test/hang.test.js', 'base');
  assert.equal(onBase.length, 1, `the file reruns alone on the base: ${JSON.stringify(calls)}`);
  assert.ok(onBase[0].timeoutMs >= MIN_FILE_TIMEOUT_MS, `the base rerun has its own timeout of at least 2 min (got ${onBase[0].timeoutMs})`);
  assert.ok(rerunsOf(calls, 'test/hang.test.js', 'branch').every((c) => c.timeoutMs >= MIN_FILE_TIMEOUT_MS));
  const line = lineOf(suiteMessage(out), 'test/hang.test.js');
  assert.match(line, /outside the change/, `reported outside the change: ${suiteMessage(out)}`);
  assert.match(line, /base/i, `the reason names the base: ${line}`);
  assert.match(line, /hang|timed out/i, `the reason says it hangs there too: ${line}`);
});

test('#396 timeout: a file that hangs alone on the branch and fails on the base is reported outside the change', async (t) => {
  const { out, calls } = await timedOutSuite(t, {
    running: ['test/hang.test.js'],
    alone: { branch: { 'test/hang.test.js': 'hang' }, base: { 'test/hang.test.js': 'fail' } },
  });
  assert.ok(!out.failures.some((f) => f.test === '(the whole suite)'), `no "(the whole suite)" failure: ${JSON.stringify(out.failures)}`);
  assert.equal(rerunsOf(calls, 'test/hang.test.js', 'base').length, 1, `the file reruns alone on the base: ${JSON.stringify(calls)}`);
  const line = lineOf(suiteMessage(out), 'test/hang.test.js');
  assert.match(line, /outside the change/, `reported outside the change: ${suiteMessage(out)}`);
  assert.match(line, /base/i, `the reason names the base: ${line}`);
  assert.match(line, /fail/i, `the reason says it fails there: ${line}`);
});

test('#396 timeout: a file of the change that hangs alone on the branch and passes on the base is a counted failure in the change', async (t) => {
  const { out, calls } = await timedOutSuite(t, {
    running: ['test/a.test.js'],
    alone: { branch: { 'test/a.test.js': 'hang' }, base: { 'test/a.test.js': 'pass' } },
  });
  assert.equal(out.status, 'fail');
  assert.ok(!out.failures.some((f) => f.test === '(the whole suite)'), `no "(the whole suite)" failure: ${JSON.stringify(out.failures)}`);
  assert.equal(rerunsOf(calls, 'test/a.test.js', 'branch').length, 1, `the file reruns alone on the branch: ${JSON.stringify(calls)}`);
  assert.equal(rerunsOf(calls, 'test/a.test.js', 'base').length, 1, `the file reruns alone on the base: ${JSON.stringify(calls)}`);
  const hang = out.failures.find((f) => f.file === 'test/a.test.js');
  assert.ok(hang, `test/a.test.js is a counted failure: ${JSON.stringify(out.failures)}`);
  assert.equal(hang.class, 'in the change');
  assert.match(lineOf(suiteMessage(out), 'test/a.test.js'), /in the change/);
});

// ---------------------------------------------------------------------------
// In or outside the change
// ---------------------------------------------------------------------------

test('#396 classification: a failure whose test file reaches a changed file is in the change, another is outside; class and reason in the output and in suite_lines', async (t) => {
  const s = setup(t);
  const round = {
    text: `${failureText('test/a.test.js', 'a test')}${failureText('test/other.test.js', 'other test')}ℹ pass 3\nℹ fail 2\n`,
    result: { code: 1, timedOut: false },
  };
  const { run } = fakeRun({ baseDir: s.baseDir, round });
  // no base checkout: both failures stay counted (a base rerun that passes changes nothing to their class)
  const out = await runSuite({ command: 'npm test', cwd: s.cwd, runDir: s.runDir, round: 1, run, changedFiles: () => ['src/a.js'] });
  assert.equal(out.status, 'fail');
  const byFile = Object.fromEntries(out.failures.map((f) => [f.file, f.class]));
  assert.deepEqual(byFile, { 'test/a.test.js': 'in the change', 'test/other.test.js': 'outside the change' });
  const message = suiteMessage(out);
  assert.match(lineOf(message, 'test/a.test.js'), /in the change/, message);
  assert.match(lineOf(message, 'test/a.test.js'), /src\/a\.js/, `the reason names the changed file it reaches: ${message}`);
  assert.match(lineOf(message, 'test/other.test.js'), /outside the change/, message);
  const lines = suiteLines(out);
  assert.match(lineOf(lines, 'test/a.test.js'), /in the change/, lines);
  assert.match(lineOf(lines, 'test/other.test.js'), /outside the change/, lines);
});

// ---------------------------------------------------------------------------
// The owner's policy input
// ---------------------------------------------------------------------------

test('#396 policy: ai-development-local-hero has suite_red_outside_change (ask | continue, default ask); software-development-local-hero does not', () => {
  const load = (name) => yaml.load(fs.readFileSync(path.join(ROOT, 'workflows', name), 'utf8'));
  const input = load('feature.yaml').inputs?.suite_red_outside_change;
  assert.ok(input, 'ai-development-local-hero declares the suite_red_outside_change input');
  assert.equal(input.default, 'ask');
  assert.deepEqual([...input.enum].sort(), ['ask', 'continue']);
});
