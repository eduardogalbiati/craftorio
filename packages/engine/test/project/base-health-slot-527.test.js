// #527 the base check takes the machine-wide `suite` slot: acceptance tests written before the code.
//
// runBaseCheck (packages/engine/domains/project/base-health.js) waits for the `suite` slot (packages/engine/engine/machine-slot.js, as the
// suite step does for #455) before its suite, holds it while the suite runs and frees it however the
// check ends (green, red, the suite throwing). While another holder has it, the check waits and says so.
//
// Seams: `runSuite` (the project's suite, faked: it looks at the slot while it runs), `exec` (the issue
// CLI, faked), the slot file observed with machine-slot's slotHolder in a temp folder.
//
// Contract assumed for the developer:
// - runBaseCheck(ws, { ..., slot: { dir, holder, onWait, pollMs } }): the same shape as runSuite's `slot`
//   (#455). `dir` defaults to machine-slot slotDir() (CRAFTORIO_LOCKS_DIR when set, else the machine
//   folder); these tests pass `slot.dir` AND set CRAFTORIO_LOCKS_DIR to the same temp folder, so the
//   machine's real slot is never touched. Unlike runSuite, the base check always takes the slot.
// - While it waits, `log(level, message)` gets a line matching /waiting for the suite slot/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixture } = require('../worktree-helpers');
const { acquireSlot, slotHolder, SUITE_SLOT, SUITE_SLOT_ENV } = require('../../engine/machine-slot');

const load = () => require('../../domains/project/base-health');

const PROJECT = 'proj-527-slot';
const RED = { test: 'cart totals include tax', file: 'test/cart.test.js', error: 'expected 110, got 100' };

let saved;
test.beforeEach(() => { saved = { locks: process.env.CRAFTORIO_LOCKS_DIR, inherit: process.env[SUITE_SLOT_ENV] }; delete process.env[SUITE_SLOT_ENV]; });
test.afterEach(() => {
  for (const [k, v] of [['CRAFTORIO_LOCKS_DIR', saved.locks], [SUITE_SLOT_ENV, saved.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

function tmpWs(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bh527s-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true, maxRetries: 3 }));
  fs.mkdirSync(path.join(ws, 'backlog'), { recursive: true });
  const locks = path.join(ws, 'locks');
  fs.mkdirSync(locks, { recursive: true });
  process.env.CRAFTORIO_LOCKS_DIR = locks;
  return { ws, locks };
}

async function fakeExec() { return ''; }

function checkArgs(f, locks, extra = {}) {
  return {
    projectId: PROJECT, repo: f.repo, base: 'main', platform: 'github', ghRepo: 'o/r', trigger: 'merge', onRed: 'issue',
    releaseHoldsBase: () => false, exec: fakeExec, slot: { dir: locks, holder: 'base-check', pollMs: 20 }, ...extra,
  };
}

// a suite that notes whether the suite slot is held while it runs
function watchingSuite(locks, result) {
  const seen = { calls: 0, held: false };
  const runSuite = async () => {
    seen.calls++;
    seen.held = !!slotHolder(SUITE_SLOT, { dir: locks });
    if (result instanceof Error) throw result;
    return result;
  };
  return { seen, runSuite };
}

test('#527 runBaseCheck holds the suite slot while its suite runs and frees it after a green check', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const { seen, runSuite } = watchingSuite(locks, { failures: [], log: 'all green' });
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite });
  assert.equal(r.status, 'green');
  assert.equal(seen.calls, 1);
  assert.equal(seen.held, true, 'the suite slot is held while the suite runs');
  assert.equal(slotHolder(SUITE_SLOT, { dir: locks }), null, 'freed after the check');
});

test('#527 runBaseCheck frees the suite slot after a red check', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const { seen, runSuite } = watchingSuite(locks, { failures: [{ ...RED }], log: 'red' });
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite });
  assert.equal(r.status, 'red');
  assert.equal(seen.held, true, 'the suite slot is held while the suite runs');
  assert.equal(slotHolder(SUITE_SLOT, { dir: locks }), null, 'freed after the check');
});

test('#527 runBaseCheck frees the suite slot when its suite throws', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const { seen, runSuite } = watchingSuite(locks, new Error('npm exploded'));
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite });
  assert.equal(r.status, 'error');
  assert.equal(seen.held, true, 'the suite slot is held while the suite runs');
  assert.equal(slotHolder(SUITE_SLOT, { dir: locks }), null, 'freed after the error');
});

test('#527 runBaseCheck waits while another holder has the suite slot, says so, and runs its suite once the slot is free', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  // another run's whole suite holds the slot (this live process, so it is not stale)
  const other = await acquireSlot(SUITE_SLOT, { dir: locks, holder: 'run-other', waitMs: 1000 });
  const { seen, runSuite } = watchingSuite(locks, { failures: [], log: 'all green' });
  const logs = [];
  const log = (level, message) => logs.push(String(message ?? level));
  let check;
  try {
    check = load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite, log });
    for (let i = 0; i < 40 && !logs.some((l) => /waiting for the suite slot/.test(l)) && seen.calls === 0; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(seen.calls, 0, 'the suite does not start while another holder has the slot');
    assert.ok(logs.some((l) => /waiting for the suite slot/.test(l)), `the wait is logged: ${JSON.stringify(logs)}`);
  } finally {
    other.release();
  }
  const r = await check;
  assert.equal(r.status, 'green');
  assert.equal(seen.calls, 1, 'the suite runs once the slot is free');
  assert.equal(seen.held, true);
});
