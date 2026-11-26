// #82, acceptance tests: the rule check finds the usual checker of each language the suite knows (Rust's
// cargo clippy, else cargo check; Go's go vet), sends back only what the change added, says which checker it
// looked for when none is installed, and the suite step records cargo test's (and dotnet's, Maven's) counts.
// Installed tools are stub files on a fake PATH; commands run through runCheck's / runSuite's fake runner.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCheck } = require('../engine/check-step');
const { foundChecks } = require('../engine/check-tools');
const { parseCounts, runSuite } = require('../engine/suite-step');

function tmp(t, files = {}) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'check-tools-82-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, { mode: 0o755 });
  }
  return dir;
}
// a PATH where only these programs are installed (stub files, never run)
function installed(t, ...names) {
  const bin = tmp(t, Object.fromEntries(names.flatMap((n) => [[n, '#!/bin/sh\nexit 0\n'], [`${n}.cmd`, '']])));
  return { PATH: bin, PATHEXT: '.CMD' };
}
const NO_PATH = { PATH: '' };
const commands = (dir, env) => foundChecks(dir, { env }).checks.map((c) => c.command);

// a plain library: no clippy.toml, no [lints.clippy]
const RUST = { 'Cargo.toml': '[package]\nname = "lib"\nversion = "0.1.0"\nedition = "2021"\n', 'src/lib.rs': 'pub fn f() {}\n' };
const GO = { 'go.mod': 'module svc\n\ngo 1.22\n', 'svc.go': 'package svc\n' };

// ---- Rust ----------------------------------------------------------------------------------------

test('#82 rust: with clippy installed, cargo clippy runs on a project with no clippy configuration', (t) => {
  const found = commands(tmp(t, RUST), installed(t, 'cargo', 'cargo-clippy'));
  assert.equal(found.filter((c) => /^cargo clippy\b/.test(c)).length, 1, JSON.stringify(found));
  assert.equal(found.some((c) => /^cargo check\b/.test(c)), false, JSON.stringify(found));
});

test('#82 rust: cargo without clippy runs cargo check', (t) => {
  const found = commands(tmp(t, RUST), installed(t, 'cargo'));
  assert.equal(found.filter((c) => /^cargo check\b/.test(c)).length, 1, JSON.stringify(found));
  assert.equal(found.some((c) => /clippy/.test(c)), false, JSON.stringify(found));
});

test('#82 rust: the checks found never change Cargo.lock or download (offline or frozen)', (t) => {
  for (const env of [installed(t, 'cargo', 'cargo-clippy'), installed(t, 'cargo')]) {
    for (const lock of [{}, { 'Cargo.lock': 'version = 3\n' }]) {
      const [cmd] = commands(tmp(t, { ...RUST, ...lock }), env).filter((c) => /^cargo\b/.test(c));
      assert.match(cmd || '', /--(offline|frozen|locked)\b/);
      assert.doesNotMatch(cmd, /--fix\b|--allow-dirty/);
    }
  }
});

test('#82 rust: no cargo installed, the step is skipped and says it looked for cargo', async (t) => {
  const dir = tmp(t, RUST);
  assert.deepEqual(commands(dir, NO_PATH), []);
  const run = async () => { throw new Error('nothing should run'); };
  const out = await runCheck({ dir, command: '', logFile: path.join(tmp(t), 'check-1.log'), env: NO_PATH, run });
  assert.equal(out.status, 'skipped', out.message);
  assert.match(out.message, /\bcargo\b/);
});

// clippy's --message-format short: `file:line:col: level: text`
const CLIPPY_OLD = 'src/lib.rs:1:1: warning: this function could be const\n';
const CLIPPY_NEW = 'src/new.rs:3:9: warning: unused variable: `x`\n';
async function rustCheck(t, { now, before, beforeCode = 101 }) {
  const env = installed(t, 'cargo', 'cargo-clippy');
  const dir = tmp(t, { ...RUST, 'src/new.rs': 'fn g() { let x = 1; }\n' });
  const baseDir = tmp(t, RUST);
  const ran = [];
  const run = async ({ command, cwd, logFile }) => {
    ran.push(command);
    const onBase = cwd === baseDir;
    fs.writeFileSync(logFile, `    Checking lib v0.1.0\n${onBase ? before : now}error: could not compile \`lib\` due to previous warnings\n`);
    return { code: onBase ? beforeCode : 101, timedOut: false, error: null };
  };
  const out = await runCheck({ dir, command: '', logFile: path.join(tmp(t), 'check-1.log'), env, run, baseCheckout: async () => ({ dir: baseDir }) });
  return { out, ran };
}

test('#82 rust: only the clippy findings the change added go back to the developer', async (t) => {
  const { out, ran } = await rustCheck(t, { now: CLIPPY_OLD + CLIPPY_NEW, before: CLIPPY_OLD });
  assert.equal(ran.every((c) => /^cargo clippy\b/.test(c)), true, JSON.stringify(ran));
  assert.equal(out.status, 'fail', out.message);
  assert.equal(out.failure_kind, 'rules');
  assert.deepEqual(out.findings.filter((f) => /src\/(lib|new)\.rs/.test(f)), ['src/new.rs:3:9: warning: unused variable: `x`']);
});

test('#82 rust: clippy findings already on the base do not fail the step', async (t) => {
  const { out } = await rustCheck(t, { now: CLIPPY_OLD, before: CLIPPY_OLD });
  assert.equal(out.status, 'pass', out.message);
});

// ---- Go (one more language) ------------------------------------------------------------------------

test('#82 go: with go installed and no golangci-lint configuration, go vet runs', (t) => {
  const found = commands(tmp(t, GO), installed(t, 'go'));
  assert.equal(found.filter((c) => /^go vet\b/.test(c)).length, 1, JSON.stringify(found));
});

test('#82 go: a configured golangci-lint still runs', (t) => {
  const found = commands(tmp(t, { ...GO, '.golangci.yml': 'version: "2"\n' }), installed(t, 'go', 'golangci-lint'));
  assert.equal(found.some((c) => /^golangci-lint run\b/.test(c)), true, JSON.stringify(found));
});

test('#82 go: no go installed, the step is skipped and says which checker it looked for', async (t) => {
  const dir = tmp(t, GO);
  const run = async () => { throw new Error('nothing should run'); };
  const out = await runCheck({ dir, command: '', logFile: path.join(tmp(t), 'check-1.log'), env: NO_PATH, run });
  assert.equal(out.status, 'skipped', out.message);
  assert.match(out.message, /go vet|golangci-lint/);
});

// ---- suite counts --------------------------------------------------------------------------------

const CARGO_PASS = [
  '   Compiling lib v0.1.0 (/x)',
  '    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.52s',
  '     Running unittests src/lib.rs (target/debug/deps/lib-1a2b)',
  '',
  'running 3 tests',
  'test tests::a ... ok',
  'test tests::b ... ok',
  'test tests::c ... ok',
  '',
  'test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s',
  '',
  '   Doc-tests lib',
  '',
  'running 2 tests',
  'test src/lib.rs - f (line 3) ... ok',
  'test src/lib.rs - g (line 9) ... ok',
  '',
  'test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.21s',
  '',
].join('\n');

test('#82 counts: cargo test sums the passed tests of every test binary', () => {
  assert.deepEqual(parseCounts(CARGO_PASS), { passed: 5, failed: 0 });
});

test('#82 counts: a failing cargo test records its failed tests', () => {
  const text = [
    'running 4 tests',
    'test tests::a ... ok',
    'test tests::b ... FAILED',
    '',
    'failures:',
    '    tests::b',
    '',
    'test result: FAILED. 2 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s',
    '',
    'error: test failed, to rerun pass `--lib`',
  ].join('\n');
  assert.deepEqual(parseCounts(text), { passed: 2, failed: 1 });
});

test('#82 counts: dotnet test summary lines', () => {
  assert.deepEqual(parseCounts('Passed!  - Failed:     0, Passed:     5, Skipped:     0, Total:     5, Duration: 12 ms - App.Tests.dll (net8.0)\n'), { passed: 5, failed: 0 });
  assert.deepEqual(parseCounts('Failed!  - Failed:     1, Passed:     4, Skipped:     0, Total:     5, Duration: 30 ms - App.Tests.dll (net8.0)\n'), { passed: 4, failed: 1 });
});

test('#82 counts: Maven Surefire takes the total line, not each class, failures and errors both fail', () => {
  const text = [
    '[INFO] Running a.AppTest',
    '[ERROR] Tests run: 3, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.05 s <<< FAILURE! -- in a.AppTest',
    '[INFO] Running a.OtherTest',
    '[ERROR] Tests run: 3, Failures: 0, Errors: 1, Skipped: 0, Time elapsed: 0.02 s <<< FAILURE! -- in a.OtherTest',
    '[INFO] Results:',
    '[ERROR] Tests run: 6, Failures: 1, Errors: 1, Skipped: 0',
    '[INFO] BUILD FAILURE',
  ].join('\n');
  assert.deepEqual(parseCounts(text), { passed: 4, failed: 2 });
});

test('#82 counts: a passing cargo test run records its counts, never null', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t, RUST);
  const run = async ({ logFile }) => {
    fs.appendFileSync(logFile, CARGO_PASS);
    return { code: 0, timedOut: false, error: null };
  };
  const out = await runSuite({ command: 'cargo test', cwd, runDir, round: 1, run });
  assert.equal(out.status, 'pass');
  assert.deepEqual([out.passed, out.failed], [5, 0]);
});
