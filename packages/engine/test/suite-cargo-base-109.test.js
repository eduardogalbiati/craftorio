// #109 the base check reads cargo test: acceptance tests written before the code.
//
// A Rust project's suite (`cargo test`) with a failure that already fails on the base: the base check
// re-runs cargo's failing tests on the base checkout, reads their names, and counts the ones red there
// too as pre-existing (preexisting_failures), as it does for node and pytest. Only the change's own
// failure goes back to the developer; with nothing else red the round passes (no test_failed gate);
// the pre-existing ones are filed as configured (#78/#405, recordPreexisting).
//
// Seams:
// - suite-step `parseFailures(text, { cwd })`: the failures by test of a cargo test log.
// - suite-step `checkOnBase({ command, failures, base, run, ... })`: the base check of a round.
// - suite-step `runSuite({ command: 'cargo test', cwd, base, run, ... })`: a round, with a faked
//   command runner `run` (cargo is not run: it prints a canned libtest log into logFile) and real
//   branch / base checkout folders holding a Cargo.toml (as preexisting-confirmed-527.test.js).
// - domains/project/base-health `recordPreexisting` with a faked issue CLI `exec` (as
//   test/project/base-health-405.test.js).
//
// Assumptions:
// - A cargo failure is named as libtest prints it (`tests::rounds_tax`, the module path); an entry
//   may carry a binary prefix, so names are matched by their end.
// - How the base re-run filters the tests is the developer's choice (`cargo test <name>`, `-- --exact`,
//   or the whole `cargo test`): the fake runner prints, among the tests red on the base, those the
//   command names (all of them when it names none). It only checks that the base run is a cargo test
//   run in the base checkout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const loadSuite = () => require('../engine/suite-step');
const loadHealth = () => require('../domains/project/base-health');

const BASE_RED = { test: 'tests::legacy_rounding', error: 'left: 3' };
const CHANGE_RED = { test: 'tests::new_discount', error: 'left: 90' };

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// a libtest log for one test binary: `failing` red, `passing` green
function cargoLog(failing, passing = ['tests::adds']) {
  const lines = [`running ${failing.length + passing.length} tests`];
  for (const p of passing) lines.push(`test ${p} ... ok`);
  for (const f of failing) lines.push(`test ${f.test} ... FAILED`);
  if (failing.length) {
    lines.push('', 'failures:', '');
    for (const f of failing) {
      lines.push(`---- ${f.test} stdout ----`, `thread '${f.test}' panicked at src/lib.rs:12:9:`, 'assertion `left == right` failed', `  ${f.error}`, ' right: 100', 'note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace', '');
    }
    lines.push('', 'failures:');
    for (const f of failing) lines.push(`    ${f.test}`);
  }
  lines.push('', `test result: ${failing.length ? 'FAILED' : 'ok'}. ${passing.length} passed; ${failing.length} failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s`, '');
  if (failing.length) lines.push('error: test failed, to rerun pass `--lib`');
  return lines.join('\n') + '\n';
}

const names = (list) => (list || []).map((f) => String(f.test));
const has = (list, name) => (list || []).some((f) => String(f?.test || '').endsWith(name));

function rustProject(dir) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "cart"\nversion = "0.1.0"\nedition = "2021"\n');
  fs.writeFileSync(path.join(dir, 'src', 'lib.rs'), '#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() {}\n}\n');
}

/** A branch folder, a base checkout and a fake cargo: the branch fails `branchRed`, the base `baseRed`. */
function setup(t, { branchRed, baseRed }) {
  const cwd = tmp(t, 'cargo109-branch-');
  const baseDir = tmp(t, 'cargo109-base-');
  const runDir = tmp(t, 'cargo109-run-');
  rustProject(cwd);
  rustProject(baseDir);
  const calls = [];
  const run = async ({ command, cwd: where, logFile }) => {
    calls.push({ command: String(command), cwd: where });
    const onBase = where && path.resolve(where) === path.resolve(baseDir);
    let red = onBase ? baseRed : branchRed;
    if (onBase) {
      const named = red.filter((f) => String(command).includes(f.test.split('::').pop()));
      const namesAny = [...baseRed, ...branchRed].some((f) => String(command).includes(f.test.split('::').pop()));
      if (namesAny) red = named;
    }
    const text = cargoLog(red);
    if (logFile) { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, text); }
    return { code: red.length ? 101 : 0, timedOut: false, error: null, stdout: text, output: text };
  };
  const base = async () => ({ dir: baseDir, commit: 'abc1234def5678' });
  const baseCalls = () => calls.filter((c) => c.cwd && path.resolve(c.cwd) === path.resolve(baseDir));
  return { cwd, baseDir, runDir, run, base, calls, baseCalls };
}

function round(s) {
  const { runSuite } = loadSuite();
  return runSuite({ command: 'cargo test', cwd: s.cwd, runDir: s.runDir, round: 1, run: s.run, timeoutMs: 30e3, base: s.base });
}

// ---- cargo test's failures by test ------------------------------------------------------------------

test('#109 parseFailures names each failing cargo test, across test binaries, with its panic message', () => {
  const { parseFailures } = loadSuite();
  const text = [
    '   Compiling cart v0.1.0',
    '     Running unittests src/lib.rs (target/debug/deps/cart-1a2b3c)',
    cargoLog([{ test: 'tests::rounds_tax', error: 'left: 110' }]),
    '     Running tests/checkout.rs (target/debug/deps/checkout-4d5e6f)',
    cargoLog([{ test: 'applies_coupon', error: 'left: 7' }], ['empty_cart']),
  ].join('\n');
  const failures = parseFailures(text, { cwd: process.cwd() });
  assert.equal(failures.length, 2, `two failing tests, got ${JSON.stringify(names(failures))}`);
  const tax = failures.find((f) => String(f.test).endsWith('tests::rounds_tax'));
  const coupon = failures.find((f) => String(f.test).endsWith('applies_coupon'));
  assert.equal(!!tax, true, `tests::rounds_tax is named, got ${JSON.stringify(names(failures))}`);
  assert.equal(!!coupon, true, `applies_coupon is named, got ${JSON.stringify(names(failures))}`);
  assert.equal(String(tax.error || '').includes('left: 110'), true, 'the error carries the panic message');
  assert.equal(names(failures).some((n) => /^(adds|tests::adds|empty_cart)$/.test(n)), false, 'passing tests are not failures');
});

test('#109 parseFailures finds nothing in a green cargo test log', () => {
  const { parseFailures } = loadSuite();
  assert.deepEqual(names(parseFailures(cargoLog([]), { cwd: process.cwd() })), []);
});

// ---- the base check ---------------------------------------------------------------------------------

test('#109 checkOnBase runs cargo test on the base checkout and keeps only the failures red there too', async (t) => {
  const s = setup(t, { branchRed: [BASE_RED, CHANGE_RED], baseRed: [BASE_RED] });
  const { checkOnBase } = loadSuite();
  const failures = [{ test: BASE_RED.test, file: '', error: BASE_RED.error }, { test: CHANGE_RED.test, file: '', error: CHANGE_RED.error }];
  const logFile = path.join(s.runDir, 'logs', 'suite-1-base.log');
  const { onBase, info } = await checkOnBase({ command: 'cargo test', failures, base: s.base, run: s.run, timeoutMs: 30e3, runDir: s.runDir, logFile, cwd: s.cwd });
  assert.equal(info.status, 'done', `the base check ran (reason: ${info.reason || '-'})`);
  assert.equal(s.baseCalls().length >= 1, true, 'a command ran in the base checkout');
  assert.equal(s.baseCalls().every((c) => /\bcargo\s+test\b/.test(c.command)), true, `the base run is cargo test: ${JSON.stringify(s.baseCalls().map((c) => c.command))}`);
  assert.equal(has(onBase, BASE_RED.test), true, `the base failure is red on the base: ${JSON.stringify(names(onBase))}`);
  assert.equal(has(onBase, CHANGE_RED.test), false, 'the change failure is not red on the base');
});

// ---- a suite round ----------------------------------------------------------------------------------

test('#109 a cargo round: the failure red on the base is pre-existing, the change failure still fails the round', async (t) => {
  const s = setup(t, { branchRed: [BASE_RED, CHANGE_RED], baseRed: [BASE_RED] });
  const out = await round(s);
  assert.equal(out.base_check?.status, 'done', `the base check ran (reason: ${out.base_check?.reason || '-'})`);
  assert.equal(out.status, 'fail');
  assert.deepEqual(names(out.failures).filter((n) => n.endsWith('legacy_rounding')), [], 'the base failure is not the change\'s');
  assert.equal(has(out.failures, CHANGE_RED.test), true, `the change failure goes back to the developer: ${JSON.stringify(names(out.failures))}`);
  assert.equal(has(out.preexisting_failures, BASE_RED.test), true, `preexisting_failures names the base failure: ${JSON.stringify(names(out.preexisting_failures))}`);
  assert.equal(has(out.preexisting_failures, CHANGE_RED.test), false);
});

test('#109 a cargo round whose only failure is red on the base passes (no suite round back, no test_failed gate)', async (t) => {
  const s = setup(t, { branchRed: [BASE_RED], baseRed: [BASE_RED] });
  const out = await round(s);
  assert.equal(out.base_check?.status, 'done', `the base check ran (reason: ${out.base_check?.reason || '-'})`);
  assert.equal(out.status, 'pass', `the round passes: failures ${JSON.stringify(names(out.failures))}`);
  assert.deepEqual(names(out.failures), []);
  assert.equal(has(out.preexisting_failures, BASE_RED.test), true, `preexisting_failures: ${JSON.stringify(names(out.preexisting_failures))}`);
  assert.equal(String(out.preexisting_failures.find((f) => String(f.test).endsWith(BASE_RED.test))?.reason || '').includes('abc1234d'), true, 'the reason names the base commit');
});

test('#109 a cargo failure that is green on the base stays the change\'s', async (t) => {
  const s = setup(t, { branchRed: [CHANGE_RED], baseRed: [] });
  const out = await round(s);
  assert.equal(out.base_check?.status, 'done', `the base check ran (reason: ${out.base_check?.reason || '-'})`);
  assert.equal(out.status, 'fail');
  assert.equal(has(out.failures, CHANGE_RED.test), true);
  assert.deepEqual(names(out.preexisting_failures), []);
});

// ---- red on the base: filed as configured (#78/#405) --------------------------------------------------

test('#109 the cargo failures red on the base are filed as configured: an issue naming the test', async (t) => {
  const ws = tmp(t, 'cargo109-ws-');
  fs.mkdirSync(path.join(ws, 'backlog'), { recursive: true });
  const { recordPreexisting, knownFailures } = loadHealth();
  const creates = [];
  const exec = async (cli, args) => {
    const list = (Array.isArray(args) ? args : String(args || '').split(/\s+/)).map(String);
    if (!(list.includes('issue') && list.includes('create'))) return '';
    let body = '';
    const bf = list.indexOf('--body-file');
    if (bf >= 0) { try { body = fs.readFileSync(list[bf + 1], 'utf8'); } catch { body = ''; } }
    const url = `https://github.com/o/r/issues/${900 + creates.length}`;
    creates.push({ text: list.join(' ') + body, url });
    return url;
  };
  const failuresOf = async (runId) => {
    const s = setup(t, { branchRed: [BASE_RED, CHANGE_RED], baseRed: [BASE_RED] });
    const out = await round(s);
    assert.equal(has(out.preexisting_failures, BASE_RED.test), true, `${runId}: the round reports the base failure as pre-existing`);
    return out.preexisting_failures;
  };
  const opts = { projectId: 'proj-109', commit: 'abc1234def5678', onRed: 'issue', platform: 'github', repo: 'o/r', exec };
  await recordPreexisting(ws, { ...opts, runId: 'run-1', failures: await failuresOf('run-1') });
  await recordPreexisting(ws, { ...opts, runId: 'run-2', failures: await failuresOf('run-2') });
  assert.equal(creates.length, 1, 'two runs seeing it file one issue');
  assert.equal(creates[0].text.includes('legacy_rounding'), true, 'the issue names the cargo test');
  const known = knownFailures(ws, 'proj-109');
  assert.equal(known.some((k) => String(k.test).endsWith(BASE_RED.test)), true, 'recorded as a known failure of the project');
  assert.equal(known.some((k) => String(k.test).endsWith(CHANGE_RED.test)), false, 'the change failure is never recorded');
});
