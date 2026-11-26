// #82, internals: rustup's clippy proxy without its component falls back to cargo check, a go.work root alone
// runs no go vet, the notes of a run say which other languages' checkers were looked for, the suite counts
// module sums its lines, and the suite's project files are shared with the rule check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCheck } = require('../engine/check-step');
const { foundChecks } = require('../engine/check-tools');
const { parseCounts } = require('../engine/suite-counts');
const suiteStep = require('../engine/suite-step');

function tmp(t, files = {}) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'check-tools-i82-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, { mode: 0o755 });
  }
  return dir;
}
function installed(t, ...names) {
  const bin = tmp(t, Object.fromEntries(names.flatMap((n) => [[n, '#!/bin/sh\nexit 0\n'], [`${n}.cmd`, '']])));
  return { PATH: bin, PATHEXT: '.CMD' };
}
const RUST = { 'Cargo.toml': '[package]\nname = "lib"\nversion = "0.1.0"\n', 'src/lib.rs': 'pub fn f() {}\n' };

test('#82 rust: clippy proxy without its component, cargo check runs instead and its log has its own name', async (t) => {
  const dir = tmp(t, RUST);
  const ran = [];
  const run = async ({ command, logFile }) => {
    ran.push({ command, logFile });
    const clippy = /clippy/.test(command);
    fs.writeFileSync(logFile, clippy ? "error: 'cargo-clippy' is not installed for the toolchain 'stable-x86_64'\n" : '    Finished dev\n');
    return { code: clippy ? 1 : 0, timedOut: false, error: null };
  };
  const out = await runCheck({ dir, command: '', logFile: path.join(tmp(t), 'check-1.log'), env: installed(t, 'cargo', 'cargo-clippy'), run });
  assert.deepEqual(ran.map((r) => r.command.split(' ').slice(0, 2).join(' ')), ['cargo clippy', 'cargo check']);
  assert.match(ran[1].logFile, /check-1-cargo-check\.log$/);
  assert.equal(out.status, 'pass', out.message);
  assert.match(out.command, /^cargo check\b/);
  assert.equal(out.notes.some((n) => /could not be compared/.test(n)), false, out.message);
});

test('#82 go: a go.work root alone runs no go vet and says what it looked for', (t) => {
  const found = foundChecks(tmp(t, { 'go.work': 'go 1.22\n' }), { env: installed(t, 'go') });
  assert.deepEqual(found.checks, []);
  assert.match(found.looked_for.join(' '), /golangci-lint/);
});

test('#82 notes: a check that runs also says which checker another language looked for', async (t) => {
  const dir = tmp(t, { ...RUST, 'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }) });
  const run = async ({ logFile }) => { fs.writeFileSync(logFile, ''); return { code: 0, timedOut: false, error: null }; };
  const out = await runCheck({ dir, command: '', logFile: path.join(tmp(t), 'check-1.log'), env: { PATH: '' }, run });
  assert.equal(out.status, 'pass', out.message);
  assert.match(out.notes.join(' '), /Also looked for: .*cargo/);
  assert.match(out.message, /Also looked for/);
});

test('#82 counts: Maven sums every module, errors fail; suite-step re-exports the same parser', () => {
  const text = 'Tests run: 3, Failures: 1, Errors: 1, Skipped: 0\nTests run: 4, Failures: 0, Errors: 0, Skipped: 1\n';
  assert.deepEqual(parseCounts(text), { passed: 4, failed: 2 });
  assert.equal(suiteStep.parseCounts, parseCounts);
});

test('#82 project files: the rule check and the suite share the Python and Gradle lists', () => {
  assert.ok(suiteStep.PYTHON_PROJECT_FILES.includes('pyproject.toml'));
  assert.ok(suiteStep.GRADLE_BUILD_FILES.includes('build.gradle.kts'));
});
