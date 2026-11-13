// #527 pre-existing only when confirmed: acceptance tests written before the code.
//
// A run's suite counts a failure as pre-existing (not counted against the run) only for a test the base
// check confirmed red ALONE after the last green check: the entry's first sighting is after lastGreen
// AND the base check confirmed it alone. A store entry without that confirmation (e.g. sightings by
// runs under load, packages/engine/engine/base-health-store.js recordSightings) does not excuse the failure.
//
// Seams: the base-health store (recordSightings, read back), runBaseCheck with faked runSuite /
// runAlone / exec (as base-health-alone-527.test.js), and suite-step runSuite with a faked `run`
// (the command runner) and a base checkout folder (as test/suite-outside-change-396.test.js).
//
// Contract assumed for the developer:
// - packages/engine/engine/base-health-store.js exports confirmedFailures(ws, projectId) → [{ test, file, ... }]:
//   the entries the base check confirmed red alone after the last green check (none after a later green).
// - suite-step runSuite({ ..., confirmedOnBase }) : confirmedOnBase is that list (the engine passes
//   confirmedFailures(root, projectId) for a run with a project; machine-actions wires it next to
//   recordSightings). When it is an array, a failure that also fails on the base checkout is pre-existing
//   only when confirmedOnBase lists it (same test + file); otherwise it counts as the run's failure.
//   When it is absent (null/undefined: no project), the #211 behaviour is unchanged.
// - runBaseCheck takes runAlone and the suite slot (see the other #527 files); the slot folder is a temp
//   MULTIAGENT_LOCKS_DIR here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  commit,
  fixture,
} = require('./worktree-helpers');
const { runSuite } = require('../engine/suite-step');

const loadStore = () => require('../engine/base-health-store');
const loadHealth = () => require('../domains/project/base-health');

const PROJECT = 'proj-527-pre';
const SLOW = { test: 'renders the big board', file: 'test/board.test.js', error: 'test timed out after 30000ms' };

let savedLocks;
test.beforeEach(() => { savedLocks = process.env.MULTIAGENT_LOCKS_DIR; });
test.afterEach(() => { if (savedLocks === undefined) delete process.env.MULTIAGENT_LOCKS_DIR; else process.env.MULTIAGENT_LOCKS_DIR = savedLocks; });

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

function tmpWs(t) {
  const ws = tmp(t, 'bh527p-');
  fs.mkdirSync(path.join(ws, 'backlog'), { recursive: true });
  const locks = path.join(ws, 'locks');
  fs.mkdirSync(locks, { recursive: true });
  process.env.MULTIAGENT_LOCKS_DIR = locks;
  return { ws, locks };
}

const confirmedTests = (ws) => {
  const fn = loadStore().confirmedFailures;
  assert.equal(typeof fn, 'function', 'base-health-store exports confirmedFailures(ws, projectId)');
  return fn(ws, PROJECT).map((x) => x.test);
};

// ---- the store --------------------------------------------------------------------------------------

test('#527 sightings by runs alone (two runs, no base check) are known but not confirmed', async (t) => {
  const { ws } = tmpWs(t);
  const { recordSightings } = loadStore();
  const failures = [{ test: SLOW.test, file: SLOW.file, reason: 'fails on the base too' }];
  await recordSightings(ws, { projectId: PROJECT, runId: 'run-1', commit: 'abc1234', failures });
  await recordSightings(ws, { projectId: PROJECT, runId: 'run-2', commit: 'abc1234', failures });
  assert.equal(loadStore().knownFailures(ws, PROJECT).length, 1, 'the store has the entry');
  assert.deepEqual(confirmedTests(ws), [], 'not confirmed: no base check saw it red alone');
});

test('#527 a test the base check found red alone after a green check is confirmed, until the next green check', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const exec = async (cli, args) => ((args || []).map(String).includes('create') ? 'https://github.com/o/r/issues/801' : '');
  const args = { projectId: PROJECT, repo: f.repo, base: 'main', platform: 'github', ghRepo: 'o/r', onRed: 'issue', releaseHoldsBase: () => false, exec, slot: { dir: locks, pollMs: 20 } };
  const runAlone = async ({ file }) => ({ status: 'fail', failures: [{ test: SLOW.test, file, error: 'still failing alone' }], ms: 900 });
  const { runBaseCheck } = loadHealth();
  assert.equal((await runBaseCheck(ws, { ...args, runSuite: async () => ({ failures: [], log: 'green' }), runAlone })).status, 'green');
  commit(f.repo, 'board.js', 'module.exports = 2;\n', 'board'); // #749: a check at the last green commit is skipped
  assert.equal((await runBaseCheck(ws, { ...args, runSuite: async () => ({ failures: [{ ...SLOW }], log: 'red' }), runAlone })).status, 'red');
  assert.deepEqual(confirmedTests(ws), [SLOW.test], 'confirmed red alone after the last green');
  assert.equal((await runBaseCheck(ws, { ...args, runSuite: async () => ({ failures: [], log: 'green' }), runAlone })).status, 'green');
  assert.deepEqual(confirmedTests(ws), [], 'a later green check ends the confirmation');
});

// ---- a run's suite --------------------------------------------------------------------------------

const TEST_FILE = /test\/[\w.-]+\.test\.js/g;
const failureText = (file, name) => `✖ failing tests:\n\ntest at ${file}:3:1\n✖ ${name} (1ms)\n  Error: ${name} broke\n\nℹ pass 0\nℹ fail 1\n`;

// A project with test/board.test.js, on the branch and in the base checkout, where SLOW fails everywhere.
async function runSuiteFailingOnBaseToo(t, extra) {
  const files = { 'package.json': JSON.stringify({ name: 'p527', scripts: { test: 'node --test' } }), [SLOW.file]: "require('node:test')('x', () => {});\n" };
  const write = (dir) => { for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); } };
  const cwd = tmp(t, 'suite527-branch-');
  const baseDir = tmp(t, 'suite527-base-');
  const runDir = tmp(t, 'suite527-run-');
  write(cwd);
  write(baseDir);
  const run = async ({ command, logFile }) => {
    const named = String(command).match(TEST_FILE) || [];
    // the whole suite, or the base's re-run of the failing file: the same test fails
    if (!named.length || named.includes(SLOW.file)) fs.appendFileSync(logFile, failureText(SLOW.file, SLOW.test));
    return { code: 1, timedOut: false, error: null };
  };
  return runSuite({
    command: 'npm test', cwd, runDir, round: 1, run, timeoutMs: 30e3,
    base: async () => ({ dir: baseDir, commit: 'abc1234def' }), ...extra,
  });
}

test('#527 a run\'s suite fails on a test that fails on the base too when the store has no confirmation for it', async (t) => {
  const out = await runSuiteFailingOnBaseToo(t, { confirmedOnBase: [] });
  assert.equal(out.base_check?.status, 'done', 'the base checkout was checked (fixture check)');
  assert.ok(out.failures.some((f) => f.test === SLOW.test), `counted as the run's failure: ${JSON.stringify(out.failures.map((f) => f.test))}`);
  assert.equal(out.status, 'fail');
});

// Guard (green before the change): a confirmed failure is still pre-existing.
test('#527 guard: a run\'s suite counts a test confirmed red alone on the base as pre-existing', async (t) => {
  const out = await runSuiteFailingOnBaseToo(t, { confirmedOnBase: [{ test: SLOW.test, file: SLOW.file }] });
  assert.ok(!out.failures.some((f) => f.test === SLOW.test), `not counted: ${JSON.stringify(out.failures.map((f) => f.test))}`);
  assert.ok(out.preexisting.some((f) => f.test === SLOW.test), 'listed as pre-existing');
  assert.equal(out.status, 'pass');
});

test('#527 a run\'s suite says which failures were red on the base too but not confirmed', async (t) => {
  const logs = [];
  await runSuiteFailingOnBaseToo(t, { confirmedOnBase: [], log: (level, message) => logs.push(String(message)) });
  const line = logs.find((l) => /red on the base too but not confirmed/.test(l)) || '';
  assert.ok(line.includes(SLOW.test), `the line names the test: ${JSON.stringify(logs)}`);
});

test('#527 a run\'s suite without a project (no confirmation list) keeps the #211 rule: red on the base is pre-existing', async (t) => {
  const out = await runSuiteFailingOnBaseToo(t, { confirmedOnBase: null });
  assert.ok(out.preexisting.some((f) => f.test === SLOW.test), 'listed as pre-existing');
  assert.equal(out.status, 'pass');
});
