// #736 internals (the developer's tests): suite-last-green.js excusedOnBase, affected-tests.js
// guardFiles, the real machine's guards in an affected selection, and the run's checkout of the base's
// last green commit (run/checkout.js suiteLastGreenBase).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { excusedOnBase } = require('../engine/suite-last-green');
const { guardFiles } = require('../engine/affected-tests');
const machineActions = require('../engine/machine-actions');
const { WorkflowRun } = require('../engine/workflow');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-736i-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const tmp = (t, prefix) => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
};
const sameTest = (a, b) => a.test === b.test && a.file === b.file;
const A = { test: 'a', file: 'test/a.test.js' };
const B = { test: 'b', file: 'test/b.test.js' };

test('#736 excusedOnBase: without a last green base, the confirmed failures stay pre-existing (#527)', async () => {
  const out = {};
  assert.deepEqual(await excusedOnBase({ redOnBase: [A, B], confirmedOnBase: [A], lastGreenBase: null, sameTest, out }), [A]);
  assert.deepEqual(await excusedOnBase({ redOnBase: [A, B], confirmedOnBase: null, lastGreenBase: null, sameTest, out }), [A, B]);
  assert.equal(out.last_green_check, undefined);
});

test('#736 excusedOnBase: only the failures red on the last green base too stay pre-existing', async () => {
  const out = {};
  const lines = [];
  const recheck = async (failures) => ({ onBase: failures.filter((f) => f === A), info: { status: 'done', commit: 'abcdef123456' } });
  const kept = await excusedOnBase({ redOnBase: [A, B], confirmedOnBase: null, lastGreenBase: async () => ({}), recheck, sameTest, out, log: (l, m) => lines.push(m) });
  assert.deepEqual(kept, [A]);
  assert.equal(out.last_green_check.commit, 'abcdef123456');
  assert.ok(lines.some((m) => /green on its last green commit \(abcdef12\), counted as the run's: b/.test(m)), lines.join('\n'));
});

test('#736 excusedOnBase: a last green check that could not run or throws leaves the current base decide', async () => {
  const skipped = async () => ({ onBase: [], info: { status: 'skipped', reason: 'the run has no base checkout' } });
  assert.deepEqual(await excusedOnBase({ redOnBase: [A], confirmedOnBase: null, lastGreenBase: async () => null, recheck: skipped, sameTest, out: {} }), [A]);
  const broken = async () => { throw new Error('boom'); };
  assert.deepEqual(await excusedOnBase({ redOnBase: [A], confirmedOnBase: null, lastGreenBase: async () => null, recheck: broken, sameTest, out: {} }), [A]);
});

function project(t, guards) {
  const dir = tmp(t, 'guards-736i-');
  const write = (f, text) => { fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
  write('package.json', '{"name":"p"}');
  write('src/x.js', 'module.exports = 1;\n');
  write('test/x.test.js', "require('../src/x');\n");
  write('test/g.test.js', "require('node:test');\n");
  if (guards !== undefined) write('test/guards.json', typeof guards === 'string' ? guards : JSON.stringify(guards));
  return { dir, write };
}

test('#736 guardFiles: the existing test files of test/guards.json; none without a valid list', (t) => {
  assert.deepEqual(guardFiles(project(t, ['test/g.test.js', 'test/missing.test.js', 'README.md']).dir), ['test/g.test.js']);
  assert.deepEqual(guardFiles(project(t).dir), []);
  assert.deepEqual(guardFiles(project(t, '{"not":"a list"}').dir), []);
  assert.deepEqual(guardFiles(project(t, 'not json').dir), []);
});

test('#736 the real machine adds the guards to an affected selection, with their reason', (t) => {
  const { dir, write } = project(t, ['test/g.test.js']);
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'run');
  write('src/x.js', 'module.exports = 2;\n');
  const sel = machineActions.real().affectedTests({ root: dir, base: 'main' });
  assert.equal(sel.mode, 'affected');
  assert.deepEqual(sel.files, ['test/g.test.js', 'test/x.test.js']);
  assert.equal(sel.reasons['test/g.test.js'], 'repository-wide guard (test/guards.json)');
  assert.equal(machineActions.simulated({}).lastGreenOnMain(), null);
});

const MISSING_COMMIT = '0123456789abcdef0123456789abcdef01234567';

function checkoutState(t, { lastGreen, current }) {
  const repo = tmp(t, 'green-736i-repo-');
  fs.writeFileSync(path.join(repo, 'f.txt'), 'old\n');
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'one');
  const first = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'f.txt'), 'new\n');
  git(repo, 'commit', '-q', '-am', 'two');
  const second = git(repo, 'rev-parse', 'HEAD');
  const worktreesDir = tmp(t, 'green-736i-wt-');
  const state = Object.create(WorkflowRun.prototype);
  Object.assign(state, {
    runId: 'run-736i', projectId: 'p736', worktreesDir, worktree: { repo, base: 'main' },
    machine: { simulated: true, lastGreenOnMain: () => (lastGreen === 'first' ? first : lastGreen === 'second' ? second : lastGreen === 'missing' ? MISSING_COMMIT : null) },
    suiteBase: async () => ({ dir: repo, commit: current === 'first' ? first : second }),
    emitEvent: () => {},
  });
  return { state, first, repo };
}

test('#736 suiteLastGreenBase: a detached checkout of the last green commit, reused on the next call', async (t) => {
  const { state, first } = checkoutState(t, { lastGreen: 'first', current: 'second' });
  const green = await state.suiteLastGreenBase('/ws');
  assert.equal(green.commit, first);
  assert.equal(fs.readFileSync(path.join(green.dir, 'f.txt'), 'utf8').replace(/\r/g, ''), 'old\n');
  assert.equal(path.basename(state.greenWorktree.dir), 'run-736i-green');
  assert.deepEqual(await state.suiteLastGreenBase('/ws'), green);
  git(state.worktree.repo, 'worktree', 'remove', '--force', state.greenWorktree.dir);
});

test('#736 suiteLastGreenBase: null without a last green commit, without a project, or at the current base', async (t) => {
  assert.equal(await checkoutState(t, { lastGreen: null, current: 'second' }).state.suiteLastGreenBase('/ws'), null);
  assert.equal(await checkoutState(t, { lastGreen: 'second', current: 'second' }).state.suiteLastGreenBase('/ws'), null);
  const { state } = checkoutState(t, { lastGreen: 'first', current: 'second' });
  state.projectId = null;
  assert.equal(await state.suiteLastGreenBase('/ws'), null);
});

test('#736 a last green commit missing from the repository: its check is skipped and the current base decides (pre-existing)', async (t) => {
  const { state } = checkoutState(t, { lastGreen: 'missing', current: 'second' });
  const FILE = 'test/a.test.js';
  const cwd = tmp(t, 'green-736i-branch-');
  const baseDir = tmp(t, 'green-736i-base-');
  const runDir = tmp(t, 'green-736i-run-');
  for (const d of [cwd, baseDir]) { fs.mkdirSync(path.join(d, 'test'), { recursive: true }); fs.writeFileSync(path.join(d, FILE), "require('node:test');\n"); }
  const run = async ({ logFile }) => {
    fs.appendFileSync(logFile, `✖ failing tests:\n\ntest at ${FILE}:3:1\n✖ a (1ms)\n  Error: a broke\n\nℹ pass 0\nℹ fail 1\n`);
    return { code: 1, timedOut: false, error: null };
  };
  const out = await require('../engine/suite-step').runSuite({
    command: 'npm test', cwd, runDir, round: 1, run, timeoutMs: 30e3, baseCacheDir: tmp(t, 'green-736i-cache-'), confirmedOnBase: null,
    base: async () => ({ dir: baseDir, commit: 'bbbb2222red' }),
    lastGreenBase: () => state.suiteLastGreenBase('/ws'),
  });
  t.after(() => { try { git(state.worktree.repo, 'worktree', 'remove', '--force', path.join(state.worktreesDir, 'run-736i-green')); } catch { /* never created */ } });
  assert.equal(out.status, 'pass', out.message);
  assert.ok(out.preexisting.some((f) => f.test === 'a'), `pre-existing as before: ${JSON.stringify(out.preexisting)}`);
  assert.notEqual(out.last_green_check?.status, 'done', `the last green check did not run: ${JSON.stringify(out.last_green_check)}`);
});
