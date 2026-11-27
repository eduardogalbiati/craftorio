// #109 the service's base check (after a merge) on a Rust project: the suite runs as
// `cargo test --no-fail-fast`, so every test binary runs, and the failures of two red binaries are
// both recorded as red on the base and filed as configured (#78/#405).
//
// Seams: the service area (packages/engine/service/areas/base-health.js afterBaseMerge) on a real git
// repository with a Cargo.toml (detectTestCommand → `cargo test`), as base-health-cancelled-78.test.js;
// `cargo` itself is a fake on PATH (a node script that records its arguments and prints a libtest log
// of two red binaries, exit 101); the store read back (knownFailures).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService } = require('./helpers');
const { SUITE_SLOT_ENV } = require('../../engine/machine-slot');

const loadArea = () => require('../../service/areas/base-health');
const loadHealth = () => require('../../domains/project/base-health');

const binary = (header, name) => [
  header,
  'running 2 tests',
  'test tests::adds ... ok',
  `test ${name} ... FAILED`,
  '',
  'failures:',
  '',
  `---- ${name} stdout ----`,
  `thread '${name}' panicked at src/lib.rs:9:5:`,
  'assertion failed',
  '',
  'failures:',
  `    ${name}`,
  '',
  'test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s',
  '',
].join('\n');

const LOG = [
  binary('     Running unittests src/lib.rs (target/debug/deps/cart-1a2b3c4d5e6f7a8b)', 'tests::legacy_rounding'),
  binary('     Running tests/checkout.rs (target/debug/deps/checkout-8b7a6f5e4d3c2b1a)', 'applies_coupon'),
  'error: 2 targets failed:',
  '    `--lib`',
  '    `--test checkout`',
].join('\n');

let saved;
test.beforeEach(() => { saved = { locks: process.env.CRAFTORIO_LOCKS_DIR, inherit: process.env[SUITE_SLOT_ENV], path: process.env.PATH }; delete process.env[SUITE_SLOT_ENV]; });
test.afterEach(() => {
  for (const [k, v] of [['CRAFTORIO_LOCKS_DIR', saved.locks], [SUITE_SLOT_ENV, saved.inherit], ['PATH', saved.path]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// a fake `cargo` first on PATH: records its arguments (one call per line) and prints LOG
function fakeCargo(t) {
  // macOS and Linux (#316): the engine puts the login shell's PATH first, once per process, when it
  // first resolves a command; on a machine with a real cargo (a CI runner) that would win over the
  // fake. Merge it now, so the fake below stays first.
  require('../../engine/providers').resolveCommand('git');
  const bin = tmp(t, 'bh109-bin-');
  const calls = path.join(bin, 'calls.txt');
  const script = path.join(bin, 'cargo.js');
  fs.writeFileSync(script, `const fs = require('fs');\nfs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n');\nprocess.stdout.write(${JSON.stringify(`${LOG}\n`)});\nprocess.exitCode = 101;\n`);
  fs.writeFileSync(path.join(bin, 'cargo'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'cargo.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH || ''}`;
  return () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []);
}

function rustRepo(t) {
  const dir = tmp(t, 'bh109-repo-');
  const cfg = path.join(tmp(t, 'bh109-gitcfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "cart"\nversion = "0.1.0"\nedition = "2021"\n');
  fs.writeFileSync(path.join(dir, 'src', 'lib.rs'), '// printed by the fake cargo\n');
  fs.writeFileSync(path.join(dir, 'tests', 'checkout.rs'), '// printed by the fake cargo\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  return dir;
}

test('#109 the service base check runs cargo test --no-fail-fast and records the failures of both red binaries', async (t) => {
  const calls = fakeCargo(t);
  const { service, api } = makeService(t);
  process.env.CRAFTORIO_LOCKS_DIR = tmp(t, 'bh109-locks-');
  api['settings:set']({ baseCheck: { onRed: 'issue' } });
  const project = await api['projects:create']({ name: 'bh109', folder: rustRepo(t) });
  const area = loadArea()({ ws: service.workspace(), active: new Map(), isReleaseRun: () => false, notify: () => {}, events: { emit: () => {} } });
  const started = area.afterBaseMerge({ projectId: project.id, runId: 'run-109', mock: false }, { base: 'main', tested: 'merge' });
  assert.ok(started && typeof started.then === 'function', 'a check started (fixture check)');
  const r = await started;
  const seen = calls();
  assert.equal(seen.length >= 1, true, 'the fake cargo ran');
  assert.equal(/^test\b/.test(seen[0]) && /\s--no-fail-fast\b/.test(` ${seen[0]}`), true, `the whole suite is cargo test --no-fail-fast: ${JSON.stringify(seen)}`);
  assert.equal(r.status, 'red', `the check: ${JSON.stringify({ status: r.status, error: r.error })}`);
  const known = loadHealth().knownFailures(service.workspace().root, project.id).map((x) => x.test).sort();
  assert.deepEqual(known, ['applies_coupon', 'tests::legacy_rounding']);
});
