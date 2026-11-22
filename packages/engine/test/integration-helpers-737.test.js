// #737: the integration tests' shared helpers (packages/engine/test/helpers/, registers no test).
// - git-fixture.js `repoFromTemplate(t)`: the git repository a test starts from is built once per
//   test process (init, initial commit, config) and copied per test, instead of `git init` +
//   commits in every test; each copy is independent (tests of a file can run concurrently).
// - run-watch.js `runUntilStall(run, { stallMs })`: starts a WorkflowRun and fails as soon as it
//   stops progressing (no event for stallMs), naming the step it stopped at, instead of waiting for
//   the test's 60-90 s timeout.
// The helpers are created by the change: they are required inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.05';

const loadFixture = () => require('./helpers/git-fixture');
const loadWatch = () => require('./helpers/run-watch');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const real = (p) => fs.realpathSync.native(p).toLowerCase();

test('repoFromTemplate gives a git repository on main with a commit and a clean tree', (t) => {
  const { repoFromTemplate } = loadFixture();
  const dir = repoFromTemplate(t);
  assert.equal(typeof dir, 'string');
  assert.equal(path.isAbsolute(dir), true);
  assert.equal(real(git(dir, 'rev-parse', '--show-toplevel')), real(dir), 'the copy is its own repository, not inside the template');
  assert.equal(git(dir, 'branch', '--show-current'), 'main');
  assert.match(git(dir, 'rev-parse', 'HEAD'), /^[0-9a-f]{40}$/);
  assert.equal(git(dir, 'status', '--porcelain'), '', 'nothing left uncommitted');
});

test('every copy starts from the same template commit, built once per process', async (t) => {
  const { repoFromTemplate } = loadFixture();
  const first = repoFromTemplate(t);
  // a second `git init` + commit a second later would get another commit date, so another hash
  await sleep(1100);
  const second = repoFromTemplate(t);
  assert.notEqual(real(first), real(second), 'each call gives its own folder');
  assert.equal(git(second, 'rev-parse', 'HEAD'), git(first, 'rev-parse', 'HEAD'));
});

test('copies are independent: a commit in one is not seen in the other or in later copies', (t) => {
  const { repoFromTemplate } = loadFixture();
  const a = repoFromTemplate(t);
  const b = repoFromTemplate(t);
  const base = git(b, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(a, 'only-in-a-737.txt'), 'a\n');
  git(a, 'add', 'only-in-a-737.txt');
  git(a, 'commit', '-q', '-m', 'only in a');
  git(a, 'switch', '-q', '-c', 'feat-737');
  assert.equal(git(b, 'rev-parse', 'HEAD'), base);
  assert.equal(fs.existsSync(path.join(b, 'only-in-a-737.txt')), false);
  const c = repoFromTemplate(t);
  assert.equal(git(c, 'rev-parse', 'HEAD'), base, 'a later copy still starts from the template');
  assert.equal(git(c, 'branch', '--list', 'feat-737'), '', 'a branch made in one copy is not in a later one');
});

test('a copy is removed when its test ends', async (t) => {
  const { repoFromTemplate } = loadFixture();
  let dir = null;
  await t.test('uses a copy', (st) => {
    dir = repoFromTemplate(st);
    assert.equal(fs.existsSync(dir), true);
  });
  assert.equal(typeof dir, 'string');
  assert.equal(fs.existsSync(dir), false, 'the copy is deleted after the test that asked for it');
});

// A small mock workflow: one agent step, then a human gate nobody answers in the stall test.
const GATE_YAML = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: stall-737 }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do it"
  - id: waiting_gate_737
    type: human_approval
    message: "ok?"
`;

function gateRun(t) {
  const { WorkflowRun } = require('../engine/workflow');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-737-'));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, GATE_YAML);
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, skillsDirs: [] });
  t.after(() => {
    try { run.stop(); } catch { /* already ended */ }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  return run;
}

test('runUntilStall fails soon after a run stops progressing, naming the step it stopped at', { timeout: 30000 }, async (t) => {
  const { runUntilStall } = loadWatch();
  const run = gateRun(t);
  const started = Date.now();
  await assert.rejects(runUntilStall(run, { stallMs: 500 }), (err) => {
    assert.match(String(err && err.message), /waiting_gate_737/, 'the error names the step the run stopped at');
    return true;
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 15000, `failed within seconds of the stall, not at a test timeout (took ${elapsed} ms)`);
});

test('runUntilStall lets a run that keeps progressing finish', { timeout: 30000 }, async (t) => {
  const { runUntilStall } = loadWatch();
  const run = gateRun(t);
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  await runUntilStall(run, { stallMs: 5000 });
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(Boolean(finished), true, 'the run reached workflow.finished');
});
