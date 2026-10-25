// #527 the base check's re-run alone, its edges (review 1): a check whose only failures are green alone,
// a re-run alone that throws, a timing assertion (not a timeout), the load named in the log line, the
// slot freed when the repository is not a git repository, and runFileAlone's log header reason.
//
// Seams: runBaseCheck (src/domains/project/base-health.js) with faked runSuite / runAlone / exec, the store read back
// (src/engine/base-health-store.js), the slot read back (machine-slot slotHolder in a temp folder),
// runFileAlone (src/engine/suite-step.js) with a faked command runner.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixture } = require('../worktree-helpers');
const { runBaseCheck } = require('../../src/domains/project/base-health');
const { knownFailures, readStore } = require('../../src/engine/base-health-store');
const { runFileAlone } = require('../../src/engine/suite-step');
const { slotHolder, SUITE_SLOT, SUITE_SLOT_ENV } = require('../../src/engine/machine-slot');

const PROJECT = 'proj-527-edges';
const SLOW = { test: 'renders the big board', file: 'test/board.test.js', error: 'test timed out after 30000ms' };
const TIMING = { test: 'opens the board quickly', file: 'test/speed.test.js', error: 'expected the board in under 2000 ms, took 5321 ms' };
const PLAIN = { test: 'cart totals include tax', file: 'test/cart.test.js', error: 'expected 110, got 100' };

let saved;
test.beforeEach(() => { saved = { locks: process.env.MULTIAGENT_LOCKS_DIR, inherit: process.env[SUITE_SLOT_ENV] }; delete process.env[SUITE_SLOT_ENV]; });
test.afterEach(() => {
  for (const [k, v] of [['MULTIAGENT_LOCKS_DIR', saved.locks], [SUITE_SLOT_ENV, saved.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

function tmpWs(t) {
  const ws = tmp(t, 'bh527e-');
  fs.mkdirSync(path.join(ws, 'backlog'), { recursive: true });
  const locks = path.join(ws, 'locks');
  fs.mkdirSync(locks, { recursive: true });
  process.env.MULTIAGENT_LOCKS_DIR = locks;
  return { ws, locks };
}

// the issue CLI, faked: each create gets a new URL and is counted
function fakeExec() {
  const creates = [];
  let next = 901;
  const exec = async (cli, args) => {
    const list = (args || []).map(String);
    if (!list.includes('create')) return '';
    creates.push(list.join(' '));
    return `https://github.com/o/r/issues/${next++}`;
  };
  return { exec, creates };
}

const suite = (failures) => async () => ({ failures: failures.map((f) => ({ ...f })), log: failures.length ? 'red' : 'green' });
const passAlone = async () => ({ status: 'pass', failures: [], ms: 800 });

function checkArgs(repo, locks, extra = {}) {
  return {
    projectId: PROJECT, repo, base: 'main', platform: 'github', ghRepo: 'o/r', trigger: 'merge', onRed: 'issue',
    releaseHoldsBase: () => false, slot: { dir: locks, holder: 'base-check', pollMs: 20 }, ...extra,
  };
}

test('#527 a check whose only failures are green alone is green-alone: the last green and the open failures stay as they were', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const args = checkArgs(f.repo, locks, { exec: fx.exec, runAlone: passAlone });
  assert.equal((await runBaseCheck(ws, { ...args, runSuite: suite([]) })).status, 'green');
  const greenAt = readStore(ws, PROJECT).lastGreen?.at;
  assert.ok(greenAt, 'a green check sets the last green (fixture check)');
  assert.equal((await runBaseCheck(ws, { ...args, runSuite: suite([PLAIN]) })).status, 'red');

  const r = await runBaseCheck(ws, { ...args, runSuite: suite([SLOW]) });
  assert.deepEqual({ status: r.status, alone: r.alone === true, issues: (r.issues || []).length }, { status: 'green', alone: true, issues: 0 });
  assert.equal(readStore(ws, PROJECT).lastGreen?.at, greenAt, 'not a green suite: the last green does not move');
  assert.deepEqual(knownFailures(ws, PROJECT).map((x) => x.test), [PLAIN.test], 'the open failure is not marked fixed');
  assert.equal(fx.creates.length, 1, 'only the plain failure was ever filed');
});

test('#527 a timed-out test whose re-run alone throws is kept: recorded and filed', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const runAlone = async () => { throw new Error('spawn EPERM'); };
  const r = await runBaseCheck(ws, { ...checkArgs(f.repo, locks, { exec: fx.exec, runAlone }), runSuite: suite([SLOW]) });
  assert.equal(r.status, 'red');
  assert.equal(fx.creates.length, 1);
  assert.ok(fx.creates[0].includes(SLOW.test), fx.creates[0]);
  assert.deepEqual(knownFailures(ws, PROJECT).map((x) => x.test), [SLOW.test]);
});

test('#527 a timing assertion (a duration, not a timeout) is re-run alone and, green alone, files nothing', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const files = [];
  const runAlone = async ({ file }) => { files.push(String(file)); return { status: 'pass', failures: [], ms: 700 }; };
  await runBaseCheck(ws, { ...checkArgs(f.repo, locks, { exec: fx.exec, runAlone }), runSuite: suite([TIMING]) });
  assert.deepEqual(files, [TIMING.file], 're-run alone');
  assert.equal(fx.creates.length, 0, 'nothing filed');
  assert.equal(knownFailures(ws, PROJECT).length, 0, 'nothing recorded');
});

test('#527 the "red under load, green alone" line names the runs active at the time', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const logs = [];
  const log = (level, message) => logs.push(String(message));
  await runBaseCheck(ws, { ...checkArgs(f.repo, locks, { exec: fakeExec().exec, runAlone: passAlone, log, load: () => ['run-a', 'run-b'] }), runSuite: suite([SLOW]) });
  const line = logs.find((l) => /red under load, green alone/.test(l)) || '';
  assert.ok(line.includes('run-a') && line.includes('run-b'), `the load is named: ${line}`);
});

test('#527 the base check frees the suite slot when the project is not a git repository', async (t) => {
  const { ws, locks } = tmpWs(t);
  const notRepo = tmp(t, 'bh527e-norepo-');
  let ran = 0;
  const r = await runBaseCheck(ws, { ...checkArgs(notRepo, locks, { exec: fakeExec().exec }), runSuite: async () => { ran++; return { failures: [] }; } });
  assert.equal(r.status, 'error');
  assert.equal(ran, 0, 'no suite ran');
  assert.equal(slotHolder(SUITE_SLOT, { dir: locks }) === null, true, 'the slot is free');
});

test('#527 runFileAlone writes the reason it is given in its log header', async (t) => {
  const dir = tmp(t, 'bh527e-alone-');
  const logFile = path.join(dir, 'logs', 'alone.log');
  const run = async () => ({ code: 0, timedOut: false, error: null });
  const r = await runFileAlone({ command: 'npm test', file: SLOW.file, cwd: dir, where: 'in the base check', timeoutMs: 120e3, run, logFile, why: 'it timed out in the base check under load' });
  assert.equal(r.status, 'pass');
  const header = fs.readFileSync(logFile, 'utf8').split('\n').slice(0, 2).join('\n');
  assert.ok(header.includes('it timed out in the base check under load'), header);
  assert.ok(!header.includes('still running when the round timed out'), header);
});
