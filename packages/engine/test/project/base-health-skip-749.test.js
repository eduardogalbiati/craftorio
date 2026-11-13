// #749 "nothing new, no check": acceptance tests written before the code
// (packages/engine/domains/project/base-health.js runBaseCheck).
//
// The base check runs no suite when nothing a test reads merged since the last green check:
// - the base tip is the last green check's commit;
// - the commits since it touch only docs (docs/**, *.md).
// Any other file changed since the last green check runs the suite as today.
//
// Seams: runBaseCheck(ws, opts) with a fake `runSuite` that counts its calls; the base repository is
// a real git repo (test/worktree-helpers.js fixture, branch 'main'); the store is read through
// packages/engine/engine/base-health-store.js readStore (lastGreen.commit).
// Assumptions:
// - a skipped check resolves with `status: 'skipped'` (a reason is the code's to word) and the base
//   tip in `commit`; the store's lastGreen is not moved back.
// - the last green commit is set by a previous green runBaseCheck of the same project.
// Modules are required inside each test, so this file loads before the code exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixture, git, commit } = require('../worktree-helpers');

const load = () => require('../../domains/project/base-health');
const loadStore = () => require('../../engine/base-health-store');

// the check takes the `suite` slot (#527) in MULTIAGENT_LOCKS_DIR: each test gets its own folder
let savedSlot;
test.beforeEach(() => {
  savedSlot = { locks: process.env.MULTIAGENT_LOCKS_DIR, inherit: process.env.MULTIAGENT_SUITE_SLOT };
  delete process.env.MULTIAGENT_SUITE_SLOT;
  const locks = fs.mkdtempSync(path.join(os.tmpdir(), 'bh749-locks-'));
  process.env.MULTIAGENT_LOCKS_DIR = locks;
  savedSlot.dir = locks;
});
test.afterEach(() => {
  for (const [k, v] of [['MULTIAGENT_LOCKS_DIR', savedSlot.locks], ['MULTIAGENT_SUITE_SLOT', savedSlot.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(savedSlot.dir, { recursive: true, force: true, maxRetries: 3 });
});

const PROJECT = 'proj-749';

function tmpWs(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bh749-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true, maxRetries: 3 }));
  fs.mkdirSync(path.join(ws, 'backlog'), { recursive: true });
  return ws;
}

// a green suite that counts how many times it ran
function countingGreen() {
  const s = { ran: 0 };
  s.runSuite = async () => { s.ran++; return { failures: [], log: 'all green' }; };
  return s;
}

const exec = async () => '';
const checkArgs = (f, extra = {}) => ({
  projectId: PROJECT, repo: f.repo, base: 'main', platform: 'github', ghRepo: 'o/r', trigger: 'merge', onRed: 'fix', releaseHoldsBase: () => false, exec, ...extra,
});

function commitIn(repo, file, text, msg) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  return commit(repo, file, text, msg);
}

// a first green check at the current tip: the project's last green commit
async function greenAtTip(ws, f) {
  const s = countingGreen();
  const r = await load().runBaseCheck(ws, { ...checkArgs(f), runSuite: s.runSuite });
  assert.equal(r.status, 'green', 'fixture: the first check is green');
  assert.equal(s.ran, 1, 'fixture: the first check ran the suite');
  return git(f.repo, 'rev-parse', 'main');
}

test('#749 no check when the base tip is the last green check\'s commit: the suite does not run', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  const tip = await greenAtTip(ws, f);
  const s = countingGreen();
  const r = await load().runBaseCheck(ws, { ...checkArgs(f), runSuite: s.runSuite });
  assert.equal(s.ran, 0, 'nothing merged since the last green check: no suite');
  assert.equal(r.status, 'skipped');
  assert.equal(r.commit, tip, 'the skipped check names the base tip (the last green commit)');
  assert.equal(loadStore().readStore(ws, PROJECT).lastGreen?.commit, tip, 'the last green commit stays');
});

test('#749 no check when the commits since the last green check touch only docs and *.md files', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  await greenAtTip(ws, f);
  commitIn(f.repo, 'docs/guide.txt', 'how to\n', 'docs: guide');
  commitIn(f.repo, 'docs/agents/notes.md', '# notes\n', 'docs: notes');
  commitIn(f.repo, 'README.md', '# readme\n', 'readme');
  const s = countingGreen();
  const r = await load().runBaseCheck(ws, { ...checkArgs(f), runSuite: s.runSuite });
  assert.equal(s.ran, 0, 'only docs merged since the last green check: no suite');
  assert.equal(r.status, 'skipped');
});

test('#749 a check "not tested green" runs the suite even at the last green commit', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  const tip = await greenAtTip(ws, f);
  const s = countingGreen();
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, { trigger: 'not-green' }), runSuite: s.runSuite });
  assert.equal(s.ran, 1, '"not tested green" is never skipped');
  assert.equal(r.status, 'green');
  assert.equal(r.commit, tip);
});

test('#749 a last green commit the repository does not know runs the suite (no skip on a guess)', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  loadStore().writeStore(ws, PROJECT, { failures: [], flaky: [], lastGreen: { commit: 'a'.repeat(40), at: '2026-11-01T10:00:00.000Z' } });
  const s = countingGreen();
  const r = await load().runBaseCheck(ws, { ...checkArgs(f), runSuite: s.runSuite });
  assert.equal(s.ran, 1);
  assert.equal(r.status, 'green');
  assert.equal(r.commit, git(f.repo, 'rev-parse', 'main'));
});

test('#749 a code merge that lands while a skip is decided runs the suite on the new tip', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  await greenAtTip(ws, f);
  // the merge lands at the check's start (onStart: the moment the service stops coalescing into it)
  let landed = null;
  const onStart = () => { if (!landed) landed = commitIn(f.repo, 'src/late.js', 'module.exports = 2;\n', 'late merge'); };
  const s = countingGreen();
  const r = await load().runBaseCheck(ws, { ...checkArgs(f), runSuite: s.runSuite, onStart });
  assert.ok(landed, 'fixture: the check called onStart');
  assert.equal(s.ran, 1, 'the late code merge is checked, not skipped');
  assert.equal(r.status, 'green');
  assert.equal(r.commit, landed, 'on the tip with the late merge');
});

test('#749 a code file changed since the last green check still runs the whole suite on the tip', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  await greenAtTip(ws, f);
  commitIn(f.repo, 'docs/guide.md', '# guide\n', 'docs: guide');
  const tip = commitIn(f.repo, 'src/cart.js', 'module.exports = 1;\n', 'cart');
  const s = countingGreen();
  const r = await load().runBaseCheck(ws, { ...checkArgs(f), runSuite: s.runSuite });
  assert.equal(s.ran, 1, 'a code change since the last green check: the suite runs');
  assert.equal(r.status, 'green');
  assert.equal(r.commit, tip);
  assert.equal(loadStore().readStore(ws, PROJECT).lastGreen?.commit, tip, 'the new green commit is recorded');
});
