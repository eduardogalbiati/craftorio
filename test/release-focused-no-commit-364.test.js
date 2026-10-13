// A fix round that changed nothing (#364): a suite step with `scope: failed` (release.yaml's e2e step,
// #324) records per round the worktree's commit (`commit`, HEAD) and whether the tree was clean
// (`clean`) when the round started. On a later visit, when HEAD equals the commit of the round that
// last ran the whole suite and the tree is clean, a green focused rerun of the failed files completes
// the round: the whole suite is not rerun. A commit or an uncommitted change since that whole run, a
// red focused rerun, or a first visit keep the #324 behaviour. The engine methods are called on
// WorkflowRun.prototype with a small run state and a throwaway git repository in os.tmpdir(), like
// test/release-rounds-internals-324-325.test.js; the suite itself is a fake `once` (focused when it
// gets `files`), or the mock suite in suiteRound.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../src/engine/workflow');
const { suiteScope } = require('../src/engine/suite-step');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const tmp = (t, prefix) => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
};

// main with the files committed, then the run's branch (no fix commit on it)
function repo(t, files = { 'features/a.feature': 'Feature: a\n', 'test/a.test.js': '1\n', 'src/x.js': '1\n' }) {
  const dir = tmp(t, 'release-364-');
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'release-fix-run1');
  return dir;
}

const runState = (dir) => {
  const events = [];
  return { events, state: { mock: false, runDir: dir, worktree: { repo: dir, base: 'main' }, ctx: { worktree_dir: dir }, emitEvent: (type, data) => events.push({ type, ...data }) } };
};

// the suite: focused runs (with `files`) give `focused`, whole runs give `whole`
function fakeSuite({ focused = 'pass', whole = 'pass' } = {}) {
  const calls = [];
  const once = async (extra = {}) => {
    const files = extra.files ? [...extra.files] : null;
    calls.push({ files });
    const status = files ? focused : whole;
    return { kind: 'suite', status, scope: files ? 'files' : 'full', passed: status === 'pass' ? 1 : 0, failed: status === 'pass' ? 0 : 1, duration_ms: 1000, failures: status === 'pass' ? [] : [{ test: 'x', file: files?.[0] || 'features/a.feature' }], message: status };
  };
  return { calls, once, wholeRuns: () => calls.filter((c) => !c.files).length, focusedRuns: () => calls.filter((c) => c.files).length };
}

const wholeRound = (round, commit, file = 'features/a.feature') => ({ status: 'fail', round, scope: 'full', commit, clean: true, failures: [{ test: 'x', file }] });
const logs = (events) => events.filter((e) => e.type === 'log').map((e) => String(e.message));

test('scope failed: a fix round without a commit and a clean tree, the failed files pass: no whole rerun, the round passes and the log says why (#364)', async (t) => {
  const dir = repo(t);
  const head = git(dir, 'rev-parse', 'HEAD');
  const { state, events } = runState(dir);
  const suite = fakeSuite();
  const st = { visits: 2, outputs: [wholeRound(1, head)] };
  const out = await WorkflowRun.prototype.failedFirstRound.call(state, { id: 'e2e' }, st, suite.once);
  assert.equal(suite.focusedRuns(), 1, 'the failed files run');
  assert.equal(suite.wholeRuns(), 0, 'no whole rerun on unchanged code');
  assert.equal(out.status, 'pass', 'the step routes on as passed');
  const line = logs(events).find((m) => /no commit since round 1's whole run/.test(m));
  assert.ok(line, `a log line says no commit since round 1's whole run; got: ${logs(events).join(' | ')}`);
  assert.ok(line.includes(head.slice(0, 7)), `the log line names the whole run's commit ${head.slice(0, 7)}: ${line}`);
});

test('scope failed: the commit compared is the one of the round that last ran the whole suite, not of a focused round (#364)', async (t) => {
  const dir = repo(t);
  const head = git(dir, 'rev-parse', 'HEAD');
  const { state, events } = runState(dir);
  const suite = fakeSuite();
  const st = { visits: 3, outputs: [wholeRound(1, head), { status: 'fail', round: 2, scope: 'files', commit: head, clean: true, failures: [{ test: 'x', file: 'features/a.feature' }] }] };
  const out = await WorkflowRun.prototype.failedFirstRound.call(state, { id: 'e2e' }, st, suite.once);
  assert.equal(suite.wholeRuns(), 0);
  assert.equal(out.status, 'pass');
  assert.ok(logs(events).some((m) => /no commit since round 1's whole run/.test(m)), `names round 1 (the last whole run); got: ${logs(events).join(' | ')}`);
});

test('scope failed: a commit since the last whole run reruns the whole suite after the failed files pass (#364)', async (t) => {
  const dir = repo(t);
  const before = git(dir, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'src', 'x.js'), '2\n');
  git(dir, 'commit', '-q', '-am', 'fix');
  const { state, events } = runState(dir);
  const suite = fakeSuite();
  const st = { visits: 2, outputs: [wholeRound(1, before)] };
  const out = await WorkflowRun.prototype.failedFirstRound.call(state, { id: 'e2e' }, st, suite.once);
  assert.equal(suite.focusedRuns(), 1);
  assert.equal(suite.wholeRuns(), 1, 'the whole suite runs once more');
  assert.equal(out.scope, 'full');
  assert.equal(out.status, 'pass');
  assert.equal(logs(events).some((m) => /no commit since/.test(m)), false);
});

test('scope failed: an uncommitted change in the worktree since the last whole run reruns the whole suite (#364)', async (t) => {
  const dir = repo(t);
  const head = git(dir, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'src', 'x.js'), 'changed, not committed\n');
  const { state, events } = runState(dir);
  const suite = fakeSuite();
  const st = { visits: 2, outputs: [wholeRound(1, head)] };
  const out = await WorkflowRun.prototype.failedFirstRound.call(state, { id: 'e2e' }, st, suite.once);
  assert.equal(suite.focusedRuns(), 1);
  assert.equal(suite.wholeRuns(), 1, 'a dirty tree is a change: the whole suite runs once more');
  assert.equal(out.scope, 'full');
  assert.equal(logs(events).some((m) => /no commit since/.test(m)), false);
});

test('scope failed: a red focused rerun on unchanged code fails the round as before, with no whole run (#364)', async (t) => {
  const dir = repo(t);
  const head = git(dir, 'rev-parse', 'HEAD');
  const { state } = runState(dir);
  const suite = fakeSuite({ focused: 'fail' });
  const st = { visits: 2, outputs: [wholeRound(1, head)] };
  const out = await WorkflowRun.prototype.failedFirstRound.call(state, { id: 'e2e' }, st, suite.once);
  assert.equal(suite.calls.length, 1);
  assert.equal(out.status, 'fail', 'never routes on with a red focused rerun');
});

test('scope failed: the unit step skips the whole rerun the same way when nothing changed (#364)', async (t) => {
  const dir = repo(t);
  const head = git(dir, 'rev-parse', 'HEAD');
  const { state, events } = runState(dir);
  const suite = fakeSuite();
  const st = { visits: 2, outputs: [wholeRound(1, head, 'test/a.test.js')] };
  const out = await WorkflowRun.prototype.failedFirstRound.call(state, { id: 'unit' }, st, suite.once);
  assert.deepEqual(suite.calls.map((c) => c.files), [['test/a.test.js']]);
  assert.equal(out.status, 'pass');
  assert.ok(logs(events).some((m) => /^unit: .*no commit since round 1's whole run/s.test(m)), `got: ${logs(events).join(' | ')}`);
});

test('scope failed: the first visit always runs the whole suite (#364)', async (t) => {
  const dir = repo(t);
  const { state } = runState(dir);
  const suite = fakeSuite();
  await WorkflowRun.prototype.failedFirstRound.call(state, { id: 'e2e' }, { visits: 1, outputs: [] }, suite.once);
  assert.deepEqual(suite.calls.map((c) => c.files), [null]);
});

test('scope failed: a previous whole round without a recorded commit (a run from before #364) reruns the whole suite (#364)', async (t) => {
  const dir = repo(t);
  const { state } = runState(dir);
  const suite = fakeSuite();
  const st = { visits: 2, outputs: [{ status: 'fail', round: 1, scope: 'full', failures: [{ test: 'x', file: 'features/a.feature' }] }] };
  await WorkflowRun.prototype.failedFirstRound.call(state, { id: 'e2e' }, st, suite.once);
  assert.equal(suite.wholeRuns(), 1);
});

// suiteRound with the mock suite (no command runs) on a real git worktree
function suiteRunState(t, dir) {
  const runDir = path.join(tmp(t, 'release-364-run-'), 'runs', 'r1');
  fs.mkdirSync(runDir, { recursive: true });
  const run = Object.create(WorkflowRun.prototype);
  Object.assign(run, {
    mock: true,
    mockSequences: { suite: { e2e: ['pass'] } },
    runDir,
    runId: 'r1',
    worktree: { repo: dir, base: 'main' },
    ctx: { worktree_dir: dir },
    abort: new AbortController(),
    preexisting: [],
    suiteRuns: { engine: 0 },
    suiteFailedFiles: [],
    fullSuitePassed: false,
    watchMemory: () => ({ stop() {} }),
    emitEvent: () => {},
  });
  return run;
}

test('a suite round records the worktree commit it tested and that the tree was clean (#364)', async (t) => {
  const dir = repo(t);
  const head = git(dir, 'rev-parse', 'HEAD');
  const run = suiteRunState(t, dir);
  const out = await run.suiteRound({ id: 'e2e', type: 'suite', command: 'npm run test:e2e', scope: 'failed', base_check: false }, { visits: 1, outputs: [] }, { execution: 1, reruns: 0, stopped: [] });
  assert.equal(typeof out.commit, 'string', `the output carries the commit; got ${JSON.stringify(out.commit)}`);
  assert.ok(out.commit.length >= 7 && head.startsWith(out.commit), `${out.commit} is HEAD (${head})`);
  assert.equal(out.clean, true);
});

test('a suite round on a worktree with an uncommitted change records it as not clean (#364)', async (t) => {
  const dir = repo(t);
  fs.writeFileSync(path.join(dir, 'src', 'x.js'), 'changed\n');
  const run = suiteRunState(t, dir);
  const out = await run.suiteRound({ id: 'e2e', type: 'suite', command: 'npm run test:e2e', scope: 'failed', base_check: false }, { visits: 1, outputs: [] }, { execution: 1, reruns: 0, stopped: [] });
  assert.equal(out.clean, false);
});

test('suiteScope: a round names the commit it tested, for the release summary (#364)', () => {
  const sha = 'abc1234def5678901234567890abcdef12345678';
  assert.match(suiteScope({ kind: 'suite', scope: 'full', passed: 193, failed: 0, duration_ms: 44 * 60e3, commit: sha }, 'scenario'), /abc1234/);
  assert.match(suiteScope({ kind: 'suite', scope: 'files', passed: 2, failed: 0, duration_ms: 60e3, selection: { files: ['features/a.feature'] }, commit: sha }, 'scenario'), /abc1234/);
});
