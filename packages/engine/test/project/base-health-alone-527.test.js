// #527 the base check re-runs alone before filing: acceptance tests written before the code.
//
// A failure of the base check's whole suite whose error is `test timed out` (or a timing assertion)
// is re-run alone with the per-test budget; only a test red alone is recorded, filed or reopened. A
// test green alone is logged as "red under load, green alone" (with the load seen), nothing filed.
// Any other failure is filed as before (#405).
//
// Seams: `runSuite` (the whole suite, faked), `runAlone` (one test file alone, faked), `exec` (the
// issue CLI, faked: creates return a new issue URL), the store read back with knownFailures, the
// roadmap read back with packages/engine/domains/roadmap/roadmap.js.
//
// Contract assumed for the developer:
// - runBaseCheck(ws, { ..., runAlone }) where
//   runAlone({ cwd, env, file, test, timeoutMs, commit }) → Promise<{ status: 'pass' | 'fail' | 'hang',
//   failures: [{ test, file, error }], ms }> — the shape of suite-step's runFileAlone result (#396),
//   which the service wires (runFileAlone exported from packages/engine/engine/suite-step.js or a shared module).
//   cwd is the check's base checkout (still present while the alone runs happen); timeoutMs is the
//   per-test budget (a positive number).
// - A test is red alone when runAlone's status is not 'pass' (its failures list it, or it hangs).
// - The green-alone log line goes through `log(level, message)` and matches /red under load, green alone/,
//   naming the test.
// #613 widened the rule: every failure goes through one second round (rerunFiles({ cwd, env, files, commit })
// → { failures, log?, error? }, base-health-rerun.test.js) in place of runAlone; these tests use it.
// - runBaseCheck also takes the suite slot (base-health-slot-527.test.js): the slot folder is a temp
//   MULTIAGENT_LOCKS_DIR here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixture } = require('../worktree-helpers');

const load = () => require('../../domains/project/base-health');
const loadRoadmap = () => require('../../domains/roadmap/roadmap');

const PROJECT = 'proj-527-alone';
const SLOW = { test: 'renders the big board', file: 'test/board.test.js', error: 'test timed out after 30000ms' };
const SLOW2 = { test: 'imports the archive', file: 'test/archive.test.js', error: 'test timed out after 30000ms' };
const PLAIN = { test: 'cart totals include tax', file: 'test/cart.test.js', error: 'expected 110, got 100' };

let savedLocks;
test.beforeEach(() => { savedLocks = process.env.MULTIAGENT_LOCKS_DIR; });
test.afterEach(() => { if (savedLocks === undefined) delete process.env.MULTIAGENT_LOCKS_DIR; else process.env.MULTIAGENT_LOCKS_DIR = savedLocks; });

function tmpWs(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bh527a-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true, maxRetries: 3 }));
  fs.mkdirSync(path.join(ws, 'backlog'), { recursive: true });
  const locks = path.join(ws, 'locks');
  fs.mkdirSync(locks, { recursive: true });
  process.env.MULTIAGENT_LOCKS_DIR = locks;
  return { ws, locks };
}

/** The issue CLI, faked: creates return incrementing URLs; each create's title/args kept as one string. */
function fakeExec() {
  const creates = [];
  let next = 701;
  const exec = async (cli, args) => {
    const list = (Array.isArray(args) ? args : String(args || '').split(/\s+/)).map(String);
    if (!(list.includes('issue') && list.includes('create'))) return '';
    const url = `https://github.com/o/r/issues/${next++}`;
    creates.push(list.join(' '));
    return url;
  };
  return { exec, creates };
}

/**
 * #613: the second round (rerunFiles, one call for the failed tests' files) replaced the re-run alone.
 * `outcome[file]` is 'pass' or 'fail'; each file of each call recorded with whether its cwd exists.
 */
function fakeAlone(outcome) {
  const calls = [];
  const rounds = [];
  const rerunFiles = async ({ cwd, files }) => {
    const list = Array.from(files || [], String);
    rounds.push(list);
    for (const file of list) calls.push({ file, cwdExists: !!cwd && fs.existsSync(cwd), cwd: String(cwd) });
    const failures = [SLOW, SLOW2, PLAIN].filter((f) => list.includes(f.file) && outcome[f.file] === 'fail').map((f) => ({ test: f.test, file: f.file, error: 'still failing' }));
    return { failures, log: 'rerun log' };
  };
  return { rerunFiles, calls, rounds };
}

function suiteOf(failures) {
  const seen = { cwd: null };
  const runSuite = async ({ cwd }) => { seen.cwd = String(cwd); return { failures: failures.map((f) => ({ ...f })), log: 'suite log' }; };
  return { runSuite, seen };
}

function checkArgs(f, locks, extra = {}) {
  return {
    projectId: PROJECT, repo: f.repo, base: 'main', platform: 'github', ghRepo: 'o/r', trigger: 'merge', onRed: 'fix',
    releaseHoldsBase: () => false, slot: { dir: locks, holder: 'base-check', pollMs: 20 }, ...extra,
  };
}

const fixStages = (ws) => loadRoadmap().readRoadmap(path.join(ws, 'backlog'), PROJECT).stages.filter((s) => s.name === 'Fix the base');

test('#527 a test timed out in the whole suite that passes alone files nothing, records nothing and adds no fix item', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const { rerunFiles, calls } = fakeAlone({ [SLOW.file]: 'pass' });
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([SLOW]).runSuite, rerunFiles, exec: fx.exec });
  assert.equal(fx.creates.length, 0, 'no issue filed');
  assert.equal(calls.length, 1, 'the timed-out test is re-run (#613: in the second round)');
  assert.equal(r.fixItem ? r.fixItem.id : null, null, 'no fix item');
  assert.equal(fixStages(ws).length, 0, 'no "Fix the base" stage');
  assert.equal(load().knownFailures(ws, PROJECT).length, 0, 'nothing recorded as failing on the base');
});

test('#527 a test red under load and green on the re-run is logged as such, naming the test', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const logs = [];
  const log = (level, message) => logs.push(String(message ?? level));
  const { rerunFiles } = fakeAlone({ [SLOW.file]: 'pass' });
  await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([SLOW]).runSuite, rerunFiles, exec: fakeExec().exec, log });
  // #613: the line of the second round
  const line = logs.find((l) => /red in the whole suite, green on the re-run/.test(l));
  assert.ok(line, `a "red in the whole suite, green on the re-run" line: ${JSON.stringify(logs)}`);
  assert.ok(line.includes(SLOW.test), `the line names the test: ${line}`);
});

test('#527 of two tests timed out in the whole suite, only the one red on the re-run files an issue', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const { rerunFiles, calls, rounds } = fakeAlone({ [SLOW.file]: 'fail', [SLOW2.file]: 'pass' });
  const suite = suiteOf([SLOW, SLOW2]);
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suite.runSuite, rerunFiles, exec: fx.exec });
  assert.equal(rounds.length, 1, '#613: one second round for both');
  assert.deepEqual(calls.map((c) => c.file).sort(), [SLOW2.file, SLOW.file].sort(), 'each timed-out test re-runs');
  assert.ok(calls.every((c) => c.cwdExists && path.resolve(c.cwd) === path.resolve(suite.seen.cwd)), 're-run in the check\'s base checkout, still there');
  assert.equal(fx.creates.length, 1, 'one issue');
  assert.ok(fx.creates[0].includes(SLOW.test), `the issue names the test red on the re-run: ${fx.creates[0]}`);
  assert.equal(r.status, 'red');
  assert.deepEqual(load().knownFailures(ws, PROJECT).map((x) => x.test), [SLOW.test], 'only the test red on the re-run is recorded');
});

// #613: an ordinary assertion failure goes through the second round too; red again, it is filed.
test('#527 an ordinary assertion failure is re-run too and, red again, filed', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const { rerunFiles, calls } = fakeAlone({ [PLAIN.file]: 'fail' });
  await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([PLAIN]).runSuite, rerunFiles, exec: fx.exec });
  assert.deepEqual(calls.map((c) => c.file), [PLAIN.file], 're-run in the second round');
  assert.equal(fx.creates.length, 1);
  assert.ok(fx.creates[0].includes(PLAIN.test));
});
