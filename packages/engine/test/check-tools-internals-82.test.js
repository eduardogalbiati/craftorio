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

// ---- what each language says it looked for --------------------------------------------------------

const POM = '<project><modelVersion>4.0.0</modelVersion><artifactId>b</artifactId></project>\n';
const POM_CHECKSTYLE = '<project><build><plugins><plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin></plugins></build></project>\n';
const CSPROJ = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n';
for (const [what, files, tools, said] of [
  ['python with neither ruff nor mypy configured', { 'pyproject.toml': '[project]\nname = "a"\n' }, ['ruff', 'mypy'], /ruff.*mypy|mypy.*ruff/],
  ['maven without maven-checkstyle-plugin', { 'pom.xml': POM }, ['mvn'], /maven-checkstyle-plugin/],
  ['maven with checkstyle but no mvn', { 'pom.xml': POM_CHECKSTYLE }, [], /\bmvn\b/],
  ['gradle', { 'build.gradle.kts': 'plugins { java }\n' }, ['gradle'], /Gradle/],
  ['c# without dotnet', { 'App.csproj': CSPROJ }, [], /\bdotnet\b/],
  ['c# without analyzers configured', { 'App.csproj': CSPROJ }, ['dotnet'], /analyzers/],
]) {
  test(`#82 looked for: ${what} runs nothing and says what it looked for`, async (t) => {
    const dir = tmp(t, files);
    const env = tools.length ? installed(t, ...tools) : { PATH: '' };
    const found = foundChecks(dir, { env });
    assert.deepEqual(found.checks.map((c) => c.command), []);
    assert.match(found.looked_for.join(' '), said);
    const run = async () => { throw new Error('nothing should run'); };
    const out = await runCheck({ dir, command: '', logFile: path.join(tmp(t), 'check-1.log'), env, run });
    assert.equal(out.status, 'skipped', out.message);
    assert.match(out.message, said);
  });
}

test('#82 go: golangci-lint configured but not installed, go vet runs', (t) => {
  const found = foundChecks(tmp(t, { 'go.mod': 'module a\n', '.golangci.yml': 'version: "2"\n' }), { env: installed(t, 'go') });
  assert.deepEqual(found.checks.map((c) => c.command.split(' ').slice(0, 2).join(' ')), ['go vet']);
});

// ---- Rust: the fallback compared with the base, what cargo prints when it cannot run, warnings -------

test('#82 rust: when the fallback cargo check fails, the base runs cargo check too and only new findings come back', async (t) => {
  const env = installed(t, 'cargo', 'cargo-clippy');
  const dir = tmp(t, { ...RUST, 'src/new.rs': 'fn g() {}\n' });
  const baseDir = tmp(t, RUST);
  const OLD = 'src/lib.rs:1:1: error: old one\n';
  const NEW = 'src/new.rs:2:3: error[E0425]: cannot find value `y`\n';
  const ran = [];
  const run = async ({ command, cwd, logFile }) => {
    ran.push(`${cwd === baseDir ? 'base' : 'run'}: ${command.split(' ').slice(0, 2).join(' ')}`);
    const text = /clippy/.test(command) ? "error: 'cargo-clippy' is not installed for the toolchain 'stable'\n" : cwd === baseDir ? OLD : OLD + NEW;
    fs.writeFileSync(logFile, text);
    return { code: 101, timedOut: false, error: null };
  };
  const out = await runCheck({ dir, command: '', logFile: path.join(tmp(t), 'check-1.log'), env, run, baseCheckout: async () => ({ dir: baseDir }) });
  assert.equal(ran.includes('base: cargo check'), true, JSON.stringify(ran));
  assert.equal(out.status, 'fail', out.message);
  assert.deepEqual(out.findings.filter((f) => /\.rs:/.test(f)), [NEW.trim()]);
});

for (const [what, text] of [
  ['a dependency never downloaded under --frozen', 'error: failed to get `serde` as a dependency of package `lib v0.1.0`\n\nCaused by:\n  attempting to make an HTTP request, but --frozen was specified\n'],
  ['a Cargo.lock that would have to change', 'error: the lock file /x/Cargo.lock needs to be updated but --frozen was passed to prevent this\n'],
]) {
  test(`#82 rust: ${what} is no finding and the base is not asked`, async (t) => {
    const dir = tmp(t, { ...RUST, 'Cargo.lock': 'version = 3\n' });
    const baseDir = tmp(t, { ...RUST, 'Cargo.lock': 'version = 3\n' });
    const cwds = [];
    const run = async ({ cwd, logFile }) => { cwds.push(cwd === baseDir ? 'base' : 'run'); fs.writeFileSync(logFile, text); return { code: 101, timedOut: false, error: null }; };
    const out = await runCheck({ dir, command: '', logFile: path.join(tmp(t), 'check-1.log'), env: installed(t, 'cargo', 'cargo-clippy'), run, baseCheckout: async () => ({ dir: baseDir }) });
    assert.equal(out.status, 'pass', out.message);
    assert.deepEqual(cwds, ['run']);
    assert.match(out.message, /did not run to its end/);
  });
}

test('#82 rust: clippy exiting 0 with warnings only passes with nothing sent back (the exit code decides)', async (t) => {
  const run = async ({ logFile }) => { fs.writeFileSync(logFile, 'src/lib.rs:1:1: warning: this could be const\nwarning: `lib` (lib) generated 1 warning\n'); return { code: 0, timedOut: false, error: null }; };
  const out = await runCheck({ dir: tmp(t, RUST), command: '', logFile: path.join(tmp(t), 'check-1.log'), env: installed(t, 'cargo', 'cargo-clippy'), run });
  assert.equal(out.status, 'pass', out.message);
  assert.deepEqual(out.findings, []);
});

// ---- counts: several projects, CRLF, Surefire's flakes -----------------------------------------------

test('#82 counts: dotnet test sums every test project', () => {
  const text = [
    'Passed!  - Failed:     0, Passed:     5, Skipped:     0, Total:     5, Duration: 12 ms - A.Tests.dll (net8.0)',
    'Failed!  - Failed:     2, Passed:     3, Skipped:     1, Total:     6, Duration: 40 ms - B.Tests.dll (net8.0)',
  ].join('\n');
  assert.deepEqual(parseCounts(text), { passed: 8, failed: 2 });
});

test('#82 counts: a Windows log with CRLF line endings is read the same (cargo, Maven)', () => {
  assert.deepEqual(parseCounts('running 2 tests\r\ntest result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\r\n'), { passed: 2, failed: 0 });
  assert.deepEqual(parseCounts('[INFO] Results:\r\n[INFO] Tests run: 4, Failures: 0, Errors: 0, Skipped: 1\r\n'), { passed: 3, failed: 0 });
});

test('#82 counts: a Surefire total line with Flakes is read', () => {
  assert.deepEqual(parseCounts('[INFO] Results:\n[WARNING] Tests run: 5, Failures: 0, Errors: 0, Skipped: 0, Flakes: 1\n'), { passed: 5, failed: 0 });
});
