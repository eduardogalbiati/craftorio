// #465 a live terminal on the deterministic steps: the follower of a plain log (acceptance tests
// written before the code).
// - src/session-tail.js exports followFile(file, write) → stop(), like followSession: it prints a
//   plain log as it grows (no JSON, no formatting of its lines), waits for a file that does not exist
//   yet, and keeps following it.
// - as a script, and its Rust twin multiagent-tail (native/, as test/session-tail-342.test.js builds
//   and runs it): `<tail> <runDir> --file <path relative to the run folder>` follows that file; the
//   binary prints exactly what the script prints. Without cargo the binary's cases are skipped with
//   one line (CI never skips them), as in test/session-tail-342.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'src', 'session-tail.js');
const NATIVE = path.join(ROOT, 'native');
const BINARY_NAME = process.platform === 'win32' ? 'multiagent-tail.exe' : 'multiagent-tail';
const BINARY = path.join(process.env.CARGO_TARGET_DIR || path.join(NATIVE, 'target'), 'release', BINARY_NAME);

const hasCargo = () => spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status === 0;
const SKIP_BINARY = !process.env.CI && !hasCargo() ? 'cargo is not installed: multiagent-tail\'s cases are skipped (CI runs them)' : false;

let built = null;
function buildBinary() {
  if (built) return built;
  const r = spawnSync('cargo', ['build', '--release', '--manifest-path', path.join(NATIVE, 'Cargo.toml'), '-p', 'multiagent-tail'], { encoding: 'utf8', timeout: 9 * 60 * 1000 });
  if (r.status !== 0) built = { error: `cargo build of multiagent-tail failed: ${(r.stderr || r.error?.message || '').slice(-1500)}` };
  else if (!fs.existsSync(BINARY)) built = { error: `cargo built multiagent-tail but ${BINARY} does not exist` };
  else built = { file: BINARY };
  return built;
}

const TAILS = [
  { label: 'session-tail.js (Node)', command: () => ({ file: process.execPath, args: [SCRIPT] }) },
  {
    label: 'multiagent-tail (Rust binary)',
    skip: SKIP_BINARY,
    command: () => {
      const b = buildBinary();
      if (b.error) throw new Error(b.error);
      return { file: b.file, args: [] };
    },
  },
];
const [JS, BIN] = TAILS;

function runFolder(t) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tail-465-'));
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  return runDir;
}

const until = async (fn, what, timeoutMs = 2500) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`timed out after ${timeoutMs} ms waiting for ${what}`);
};

// ---- the module ---------------------------------------------------------------------------------

test('#465 followFile prints a log created after it started, then the lines appended to it', async (t) => {
  const { followFile } = require('../src/session-tail');
  assert.equal(typeof followFile, 'function', 'session-tail.js exports followFile');
  const runDir = runFolder(t);
  const file = path.join(runDir, 'logs', 'suite-1.log');
  let out = '';
  const stop = followFile(file, (text) => { out += String(text); });
  t.after(() => { if (typeof stop === 'function') stop(); else stop?.stop?.(); });
  await new Promise((r) => setTimeout(r, 300));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '$ npm test\n# first line of the suite\n');
  await until(() => out.includes('first line of the suite'), 'the first lines of a file created after followFile started');
  fs.appendFileSync(file, 'ok 12 - appended later {"not":"json-formatted"}\n');
  await until(() => out.includes('ok 12 - appended later {"not":"json-formatted"}'), 'a line appended later, printed as it is');
  assert.equal(out.split('first line of the suite').length, 2, 'each line printed once');
});

test('#465 followFile returns a stop function: nothing is printed after stop()', async (t) => {
  const { followFile } = require('../src/session-tail');
  const runDir = runFolder(t);
  const file = path.join(runDir, 'check-1.log');
  fs.writeFileSync(file, 'before\n');
  let out = '';
  const stop = followFile(file, (text) => { out += String(text); });
  await until(() => out.includes('before'), 'the existing content');
  assert.equal(typeof stop, 'function', 'followFile returns stop(), as followSession does');
  stop();
  fs.appendFileSync(file, 'after stop\n');
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(out.includes('after stop'), false);
});

// ---- the script and the binary: `<tail> <runDir> --file <relative path>` --------------------------

function startTail(t, tail, runDir, rel, env = {}) {
  const { file, args } = tail.command();
  const childEnv = { ...process.env, ...env };
  if (!('FORCE_COLOR' in env)) delete childEnv.FORCE_COLOR;
  const child = spawn(file, [...args, runDir, '--file', rel], { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  child.on('error', () => {});
  const hard = setTimeout(() => child.kill('SIGKILL'), 30000);
  t.after(() => { clearTimeout(hard); child.kill('SIGKILL'); });
  const waitFor = async (text, timeoutMs = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (stdout.includes(text)) return stdout;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`timed out waiting for ${JSON.stringify(text)} (stdout ${JSON.stringify(stdout.slice(-800))}, stderr ${JSON.stringify(stderr.slice(-800))})`);
  };
  return { child, waitFor, out: () => stdout };
}

for (const tail of TAILS) {
  test(`#465 ${tail.label}: --file follows a log of the run folder created after it started`, { skip: tail.skip }, async (t) => {
    const runDir = runFolder(t);
    const run = startTail(t, tail, runDir, 'logs/suite-1.log');
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(run.child.exitCode, null, 'still running while the file does not exist');
    fs.mkdirSync(path.join(runDir, 'logs'));
    fs.writeFileSync(path.join(runDir, 'logs', 'suite-1.log'), '$ npm test\n');
    await run.waitFor('$ npm test');
    fs.appendFileSync(path.join(runDir, 'logs', 'suite-1.log'), 'ok 3 - later\n');
    await run.waitFor('ok 3 - later');
  });
}

for (const [label, env] of [['FORCE_COLOR=1', { FORCE_COLOR: '1' }], ['no FORCE_COLOR', {}]]) {
  test(`#465 multiagent-tail --file prints a log byte for byte like session-tail.js (${label})`, { skip: BIN.skip }, async (t) => {
    const runDir = runFolder(t);
    fs.mkdirSync(path.join(runDir, 'logs'));
    fs.writeFileSync(path.join(runDir, 'logs', 'check-2.log'), '$ npm run check\nlayers: src/a.js:2 requires src/b.js\nchecks: 1 finding ✓ café\nEND-OF-LOG\n');
    const printed = async (tail) => {
      const run = startTail(t, tail, runDir, 'logs/check-2.log', env);
      await run.waitFor('END-OF-LOG');
      await new Promise((r) => setTimeout(r, 200));
      run.child.kill('SIGKILL');
      return run.out();
    };
    const expected = await printed(JS);
    const actual = await printed(BIN);
    assert.equal(actual, expected);
  });
}
