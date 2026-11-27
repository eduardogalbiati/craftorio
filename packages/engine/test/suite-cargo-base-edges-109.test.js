// #109 edges of the cargo base check (the reviewer's uncovered cases): a round with a confirmed list
// (#527), the last green recheck (#736), a command that already has `--` and a command line too long
// for the platform (#400), logs without "Running" lines, doctests ("Doc-tests <crate>") and a
// `should_panic` test (" - should panic" after its name).
//
// Seams: suite-step `runSuite` / `checkOnBase` / `parseFailures`, with a faked command runner `run` that
// prints a canned libtest log into logFile, and real temp folders for the branch, the base and its last
// green commit (as suite-cargo-base-109.test.js).
//
// Assumptions: a store entry has no `bin` (base-health-store keeps test + file), so a confirmed entry
// matches the failure of any test binary with that name; a log without "Running" lines gives failures
// with no binary, which match the same name in any binary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkOnBase, parseFailures, runSuite } = require('../engine/suite-step');

const LEGACY = 'tests::legacy_rounding';
const NEW = 'tests::new_discount';

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// one libtest binary's output; `header` the cargo line that starts it (none: a log without it)
function binary(failing, { header = '     Running unittests src/lib.rs (target/debug/deps/cart-1a2b3c4d5e6f7a8b)', passing = ['tests::adds'] } = {}) {
  const lines = header ? [header] : [];
  lines.push(`running ${failing.length + passing.length} tests`);
  for (const p of passing) lines.push(`test ${p} ... ok`);
  for (const f of failing) lines.push(`test ${f} ... FAILED`);
  if (failing.length) {
    lines.push('', 'failures:', '');
    for (const f of failing) lines.push(`---- ${f.replace(/ - should panic$/, '')} stdout ----`, `thread '${f}' panicked at src/lib.rs:9:5:`, 'assertion failed', '');
    lines.push('', 'failures:', ...failing.map((f) => `    ${f}`));
  }
  lines.push('', `test result: ${failing.length ? 'FAILED' : 'ok'}. ${passing.length} passed; ${failing.length} failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s`, '');
  return lines.join('\n') + '\n';
}

function rustDir(t, prefix) {
  const dir = tmp(t, prefix);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "cart"\nversion = "0.1.0"\nedition = "2021"\n');
  fs.writeFileSync(path.join(dir, 'src', 'lib.rs'), '// printed by the fake runner\n');
  return dir;
}

/** folders → the log each prints; returns the runner and its calls ({ command, where }) */
function fakeCargo(logs) {
  const calls = [];
  const run = async ({ command, cwd, logFile }) => {
    const where = Object.keys(logs).find((k) => logs[k].dir && cwd && path.resolve(cwd) === path.resolve(logs[k].dir)) || 'branch';
    calls.push({ command: String(command), where });
    const text = logs[where].log;
    if (logFile) { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, text); }
    return { code: /FAILED/.test(text) ? 101 : 0, timedOut: false, error: null };
  };
  return { run, calls };
}

const names = (list) => (list || []).map((f) => String(f.test));

function roundWith(t, { branchLog, baseLog, greenLog = null, extra = {} }) {
  const cwd = rustDir(t, 'cargo109e-branch-');
  const baseDir = rustDir(t, 'cargo109e-base-');
  const greenDir = greenLog == null ? null : rustDir(t, 'cargo109e-green-');
  const fake = fakeCargo({ branch: { dir: cwd, log: branchLog }, base: { dir: baseDir, log: baseLog }, ...(greenDir ? { green: { dir: greenDir, log: greenLog } } : {}) });
  const runDir = tmp(t, 'cargo109e-run-');
  const out = runSuite({
    command: 'cargo test', cwd, runDir, round: 1, run: fake.run, timeoutMs: 30e3,
    base: async () => ({ dir: baseDir, commit: 'abc1234def5678' }),
    ...(greenDir ? { lastGreenBase: async () => ({ dir: greenDir, commit: 'feed5678beef1234' }) } : {}),
    ...extra,
  });
  return { out, calls: fake.calls };
}

// ---- #527: confirmed on the base ------------------------------------------------------------------

test('#109 #527 a cargo failure red on the base but not in the confirmed list stays the change\'s', async (t) => {
  const { out } = roundWith(t, { branchLog: binary([LEGACY]), baseLog: binary([LEGACY]), extra: { confirmedOnBase: [] } });
  const o = await out;
  assert.equal(o.status, 'fail');
  assert.deepEqual(names(o.failures), [LEGACY]);
  assert.deepEqual(names(o.preexisting_failures), []);
});

test('#109 #527 a confirmed store entry (no binary) excuses the cargo failure of a named binary', async (t) => {
  const { out } = roundWith(t, { branchLog: binary([LEGACY]), baseLog: binary([LEGACY]), extra: { confirmedOnBase: [{ test: LEGACY, file: '' }] } });
  const o = await out;
  assert.equal(o.status, 'pass', `failures: ${JSON.stringify(names(o.failures))}`);
  assert.deepEqual(names(o.preexisting_failures), [LEGACY]);
});

// ---- #736: the last green base -----------------------------------------------------------------------

test('#109 #736 a cargo failure red on the base but green on its last green commit is the change\'s', async (t) => {
  const { out, calls } = roundWith(t, { branchLog: binary([LEGACY]), baseLog: binary([LEGACY]), greenLog: binary([]) });
  const o = await out;
  assert.equal(calls.some((c) => c.where === 'green' && /^cargo test --no-fail-fast\b/.test(c.command)), true, `the last green checkout ran cargo test: ${JSON.stringify(calls)}`);
  assert.equal(o.last_green_check?.status, 'done');
  assert.equal(o.status, 'fail');
  assert.deepEqual(names(o.failures), [LEGACY]);
});

test('#109 #736 a cargo failure red on the base and on its last green commit is pre-existing', async (t) => {
  const { out } = roundWith(t, { branchLog: binary([LEGACY, NEW]), baseLog: binary([LEGACY]), greenLog: binary([LEGACY]) });
  const o = await out;
  assert.equal(o.status, 'fail');
  assert.deepEqual(names(o.failures), [NEW]);
  assert.deepEqual(names(o.preexisting_failures), [LEGACY]);
});

// ---- the base command (#400) --------------------------------------------------------------------------

function baseCheck(t, { command, failures, baseLog, platform }) {
  const baseDir = rustDir(t, 'cargo109e-cb-');
  const runDir = tmp(t, 'cargo109e-cbrun-');
  const fake = fakeCargo({ base: { dir: baseDir, log: baseLog } });
  const done = checkOnBase({ command, failures, base: async () => ({ dir: baseDir, commit: 'abc1234def' }), run: fake.run, runDir, logFile: path.join(runDir, 'logs', 'suite-1-base.log'), platform });
  return { done, calls: fake.calls };
}

test('#109 a cargo command that already has `--` keeps one `--` and its own options, the names after them', async (t) => {
  const { done, calls } = baseCheck(t, { command: 'cargo test -- --test-threads=1', failures: [{ test: LEGACY, file: '', error: '' }], baseLog: binary([LEGACY]) });
  const { onBase, info } = await done;
  assert.equal(info.status, 'done');
  assert.equal(calls.length, 1);
  const cmd = calls[0].command;
  assert.equal(cmd.startsWith('cargo test --no-fail-fast'), true, cmd);
  assert.equal(cmd.split(/\s+/).filter((w) => w === '--').length, 1, `one -- in: ${cmd}`);
  assert.equal(cmd.includes('--test-threads=1'), true, cmd);
  assert.equal(cmd.indexOf(LEGACY) > cmd.indexOf('--test-threads=1'), true, `the name after the libtest options: ${cmd}`);
  assert.deepEqual(names(onBase), [LEGACY]);
});

test('#109 #400 too many cargo test names for the command line: the whole cargo test runs on the base', async (t) => {
  const many = Array.from({ length: 200 }, (_, i) => `integration::checkout::a_rather_long_module_path::case_number_${String(i).padStart(4, '0')}`);
  const { done, calls } = baseCheck(t, { command: 'cargo test', platform: 'win32', failures: many.map((n) => ({ test: n, file: '', error: '' })), baseLog: binary([many[0]]) });
  const { onBase, info } = await done;
  assert.equal(info.status, 'done');
  assert.deepEqual(calls.map((c) => c.command), ['cargo test --no-fail-fast']);
  assert.deepEqual(names(onBase), [many[0]]);
});

// ---- logs: no "Running" line, doctests, should_panic ----------------------------------------------------

test('#109 a base log without "Running" lines matches the branch failure of a named binary', async (t) => {
  const { out } = roundWith(t, { branchLog: binary([LEGACY, NEW]), baseLog: binary([LEGACY], { header: null }) });
  const o = await out;
  assert.deepEqual(names(o.preexisting_failures), [LEGACY]);
  assert.deepEqual(names(o.failures), [NEW]);
});

test('#109 a branch log without "Running" lines matches the base failure of a named binary', async (t) => {
  const { out } = roundWith(t, { branchLog: binary([LEGACY, NEW], { header: null }), baseLog: binary([LEGACY]) });
  const o = await out;
  assert.deepEqual(names(o.preexisting_failures), [LEGACY]);
  assert.deepEqual(names(o.failures), [NEW]);
});

test('#109 a failing doctest (after "Doc-tests <crate>") is named and is pre-existing when red on the base', async (t) => {
  const doc = 'src/lib.rs - add (line 3)';
  const log = binary([]) + binary([doc], { header: '   Doc-tests cart', passing: [] });
  const parsed = parseFailures(log);
  assert.deepEqual(names(parsed), [doc]);
  const { out } = roundWith(t, { branchLog: log, baseLog: log });
  const o = await out;
  assert.equal(o.status, 'pass', `failures: ${JSON.stringify(names(o.failures))}`);
  assert.deepEqual(names(o.preexisting_failures), [doc]);
});

test('#109 a should_panic cargo test that fails on the base too is pre-existing', async (t) => {
  const sp = 'tests::rejects_zero - should panic';
  const { out } = roundWith(t, { branchLog: binary([sp, NEW]), baseLog: binary([sp]) });
  const o = await out;
  assert.equal(o.status, 'fail');
  assert.equal(names(o.failures).length, 1, `only the change failure: ${JSON.stringify(names(o.failures))}`);
  assert.equal(names(o.failures)[0], NEW);
  assert.equal(names(o.preexisting_failures).length, 1);
  assert.equal(names(o.preexisting_failures)[0].includes('rejects_zero'), true);
});
