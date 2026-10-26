// #613 the base check re-runs the failed tests once before filing: acceptance tests written before the code.
//
// When the base check's whole suite has failures, it runs a second round with only the files of the
// failed tests (one call, in the same checkout, while it still holds the suite slot). Only a test red in
// both rounds is recorded and filed; a test red then green is logged ("red in the whole suite, green on
// the re-run") and kept as a flaky sighting. A second round that throws, errors or does not start counts
// as red for its tests. A failure without a file is filed as before. A green check runs no second round.
//
// Seams: runBaseCheck (packages/engine/domains/project/base-health.js) with faked runSuite / rerunFiles /
// exec (the issue CLI), the store read back (packages/engine/engine/base-health-store.js readStore,
// knownFailures), the roadmap read back (packages/engine/domains/roadmap/roadmap.js).
//
// Contract assumed for the developer:
// - runBaseCheck(ws, { ..., rerunFiles }) where
//   rerunFiles({ cwd, env, files, commit }) → Promise<{ failures: [{ test, file, error }], log?: string, error?: string }>
//   — the shape of runSuite's result; `files` the distinct files of the failed tests; cwd the check's base
//   checkout (still present). A test is red in the second round when its failures list it, or when the
//   round throws or returns an `error` (timed out, did not start). Without rerunFiles every failure is
//   filed after one round, as before (the other base-health tests pass none).
// - The flaky sightings: readStore(ws, projectId).flaky, a list of { test, file, commit, at }.
// - The log line goes through `log(level, message)`, matches /red in the whole suite, green on the re-run/
//   and names the test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixture } = require('../worktree-helpers');

const load = () => require('../../domains/project/base-health');
const loadStore = () => require('../../engine/base-health-store');
const loadRoadmap = () => require('../../domains/roadmap/roadmap');

const PROJECT = 'proj-613-rerun';
const FLAKY = { test: '#396 local hero, policy continue', file: 'test/slow/suite-red-396.slow.test.js', error: 'Command failed: git -c user.name=t commit -q -m base' };
const BROKEN = { test: 'cart totals include tax', file: 'test/cart.test.js', error: 'expected 110, got 100' };
const BROKEN2 = { test: 'cart applies the coupon', file: 'test/cart.test.js', error: 'expected 90, got 100' };
const SLOW = { test: 'renders the big board', file: 'test/board.test.js', error: 'test timed out after 30000ms' };
const NOFILE = { test: 'a test the parser found no file for', error: 'boom' };

let savedLocks;
test.beforeEach(() => { savedLocks = process.env.MULTIAGENT_LOCKS_DIR; });
test.afterEach(() => { if (savedLocks === undefined) delete process.env.MULTIAGENT_LOCKS_DIR; else process.env.MULTIAGENT_LOCKS_DIR = savedLocks; });

function tmpWs(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bh613-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true, maxRetries: 3 }));
  fs.mkdirSync(path.join(ws, 'backlog'), { recursive: true });
  const locks = path.join(ws, 'locks');
  fs.mkdirSync(locks, { recursive: true });
  process.env.MULTIAGENT_LOCKS_DIR = locks;
  return { ws, locks };
}

// the issue CLI, faked: each create gets a new URL and is kept as one string
function fakeExec() {
  const creates = [];
  let next = 801;
  const exec = async (cli, args) => {
    const list = (Array.isArray(args) ? args : String(args || '').split(/\s+/)).map(String);
    if (!(list.includes('issue') && list.includes('create'))) return '';
    creates.push(list.join(' '));
    return `https://github.com/o/r/issues/${next++}`;
  };
  return { exec, creates };
}

// the whole suite, faked: its cwd kept, called count kept
function suiteOf(failures) {
  const seen = { cwd: null, calls: 0 };
  const runSuite = async ({ cwd }) => { seen.calls++; seen.cwd = String(cwd); return { failures: failures.map((f) => ({ ...f })), log: failures.length ? 'suite red' : 'suite green' }; };
  return { runSuite, seen };
}

// the second round, faked: `stillRed` the failures it reports again; each call's files and cwd kept
function fakeRerun(stillRed) {
  const calls = [];
  const rerunFiles = async ({ cwd, files }) => {
    calls.push({ files: Array.from(files || [], String), cwd: String(cwd), cwdExists: !!cwd && fs.existsSync(cwd) });
    return { failures: stillRed.map((f) => ({ ...f, error: 'still red' })), log: 'rerun log' };
  };
  return { rerunFiles, calls };
}

function checkArgs(f, locks, extra = {}) {
  return {
    projectId: PROJECT, repo: f.repo, base: 'main', platform: 'github', ghRepo: 'o/r', trigger: 'merge', onRed: 'fix',
    releaseHoldsBase: () => false, slot: { dir: locks, holder: 'base-check', pollMs: 20 }, ...extra,
  };
}

const fixStages = (ws) => loadRoadmap().readRoadmap(path.join(ws, 'backlog'), PROJECT).stages.filter((s) => s.name === 'Fix the base');
const flakyOf = (ws) => {
  const list = loadStore().readStore(ws, PROJECT).flaky;
  return Array.isArray(list) ? list.map((x) => ({ test: x.test, file: x.file ?? null, commit: x.commit ?? null, at: x.at ?? null })) : [];
};

test('#613 a test red in the whole suite and green on the re-run files nothing, adds no fix item and leaves the check green', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const rr = fakeRerun([]);
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([FLAKY]).runSuite, rerunFiles: rr.rerunFiles, exec: fx.exec });
  assert.equal(rr.calls.length, 1, 'one second round');
  assert.equal(fx.creates.length, 0, 'no issue filed');
  assert.equal(r.fixItem ? 'fix item' : null, null, 'no fix item');
  assert.equal(fixStages(ws).length, 0, 'no "Fix the base" stage');
  assert.equal(load().knownFailures(ws, PROJECT).length, 0, 'nothing recorded as failing on the base');
  assert.equal(r.status, 'green');
  assert.equal(loadStore().readStore(ws, PROJECT).lastCheck?.status, 'green', 'lastCheck.status is green');
});

test('#613 a test red then green is kept as a flaky sighting with its test, file, commit and time', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const before = Date.now();
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([FLAKY]).runSuite, rerunFiles: fakeRerun([]).rerunFiles, exec: fakeExec().exec });
  const flaky = flakyOf(ws);
  assert.deepEqual(flaky.map((x) => ({ test: x.test, file: x.file, commit: x.commit })), [{ test: FLAKY.test, file: FLAKY.file, commit: r.commit }]);
  assert.ok(typeof r.commit === 'string' && r.commit.length >= 7, `the check names its commit: ${r.commit}`);
  const at = Date.parse(flaky[0].at);
  assert.ok(Number.isFinite(at) && at >= before - 1000 && at <= Date.now() + 1000, `a time of this check: ${flaky[0].at}`);
});

test('#613 a flaky sighting stays in the store after a later red check', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([FLAKY]).runSuite, rerunFiles: fakeRerun([]).rerunFiles, exec: fx.exec });
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([BROKEN]).runSuite, rerunFiles: fakeRerun([BROKEN]).rerunFiles, exec: fx.exec });
  assert.equal(r.status, 'red');
  assert.deepEqual(flakyOf(ws).map((x) => x.test), [FLAKY.test]);
});

test('#613 a test red then green is logged as "red in the whole suite, green on the re-run", naming the test', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const logs = [];
  const log = (level, message) => logs.push(String(message ?? level));
  await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([FLAKY]).runSuite, rerunFiles: fakeRerun([]).rerunFiles, exec: fakeExec().exec, log });
  const line = logs.find((l) => /red in the whole suite, green on the re-run/.test(l));
  assert.ok(line, `a "red in the whole suite, green on the re-run" line: ${JSON.stringify(logs)}`);
  assert.ok(line.includes(FLAKY.test), `the line names the test: ${line}`);
});

test('#613 a test red in both rounds is recorded, filed and gets a fix item as before', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const rr = fakeRerun([BROKEN]);
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([BROKEN]).runSuite, rerunFiles: rr.rerunFiles, exec: fx.exec });
  assert.equal(rr.calls.length, 1, 'one second round');
  assert.equal(r.status, 'red');
  assert.equal(fx.creates.length, 1, 'one issue');
  assert.ok(fx.creates[0].includes(BROKEN.test), fx.creates[0]);
  assert.equal(fixStages(ws).length, 1, 'a "Fix the base" stage');
  const known = load().knownFailures(ws, PROJECT);
  assert.deepEqual(known.map((x) => x.test), [BROKEN.test]);
  assert.ok(known[0].confirmed_at, 'confirmed by the check');
  assert.equal(loadStore().readStore(ws, PROJECT).lastCheck?.status, 'red');
  assert.deepEqual(flakyOf(ws), [], 'no flaky sighting');
});

test('#613 of one test red twice and one red then green, only the first is filed; the second is a flaky sighting', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([BROKEN, FLAKY]).runSuite, rerunFiles: fakeRerun([BROKEN]).rerunFiles, exec: fx.exec });
  assert.equal(r.status, 'red');
  assert.equal(fx.creates.length, 1, 'one issue');
  assert.ok(fx.creates[0].includes(BROKEN.test) && !fx.creates[0].includes(FLAKY.test), fx.creates[0]);
  assert.deepEqual(load().knownFailures(ws, PROJECT).map((x) => x.test), [BROKEN.test]);
  assert.deepEqual(flakyOf(ws).map((x) => x.test), [FLAKY.test]);
});

test('#613 the second round gets only the files of the failed tests, each once, in the check\'s checkout', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const suite = suiteOf([BROKEN, BROKEN2, FLAKY]);
  const rr = fakeRerun([]);
  await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suite.runSuite, rerunFiles: rr.rerunFiles, exec: fakeExec().exec });
  assert.equal(rr.calls.length, 1, 'one call for all the files');
  assert.deepEqual(rr.calls[0].files.map((x) => x.replace(/\\/g, '/')).sort(), [BROKEN.file, FLAKY.file].sort());
  assert.ok(rr.calls[0].cwdExists, 'the checkout is still there');
  assert.equal(path.resolve(rr.calls[0].cwd), path.resolve(suite.seen.cwd), 'the same checkout as the whole suite');
});

test('#613 a green check runs no second round', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const rr = fakeRerun([]);
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([]).runSuite, rerunFiles: rr.rerunFiles, exec: fakeExec().exec });
  assert.equal(r.status, 'green');
  assert.equal(rr.calls.length, 0);
});

test('#613 a timing failure goes through the same second round and runs no third time', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const suite = suiteOf([SLOW]);
  const rr = fakeRerun([]);
  let alone = 0;
  const runAlone = async () => { alone++; return { status: 'pass', failures: [], ms: 100 }; };
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suite.runSuite, rerunFiles: rr.rerunFiles, runAlone, exec: fx.exec });
  assert.deepEqual({ suite: suite.seen.calls, rerun: rr.calls.length, alone }, { suite: 1, rerun: 1, alone: 0 }, 'two rounds, no third');
  assert.deepEqual(rr.calls[0].files, [SLOW.file]);
  assert.equal(fx.creates.length, 0, 'green on the re-run: nothing filed');
  assert.equal(r.status, 'green');
});

for (const [name, rerunFiles] of [
  ['throws', async () => { throw new Error('spawn EPERM'); }],
  ['times out', async ({ files }) => ({ failures: [], log: 'killed', error: `the re-run of ${files.length} file(s) timed out` })],
  ['does not start (no test command)', async () => ({ failures: [], log: '', error: 'no test command' })],
]) {
  test(`#613 a second round that ${name} counts as red for its tests: filed as before`, async (t) => {
    const { ws, locks } = tmpWs(t);
    const f = fixture(t, 'canonical');
    const fx = fakeExec();
    const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([FLAKY]).runSuite, rerunFiles, exec: fx.exec });
    assert.equal(r.status, 'red');
    assert.equal(fx.creates.length, 1);
    assert.ok(fx.creates[0].includes(FLAKY.test), fx.creates[0]);
    assert.deepEqual(load().knownFailures(ws, PROJECT).map((x) => x.test), [FLAKY.test]);
    assert.deepEqual(flakyOf(ws), [], 'no flaky sighting');
  });
}

test('#613 a failure without a file is filed as before and is not part of the second round', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const rr = fakeRerun([]);
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([NOFILE, FLAKY]).runSuite, rerunFiles: rr.rerunFiles, exec: fx.exec });
  assert.equal(r.status, 'red');
  assert.equal(rr.calls.length, 1);
  assert.deepEqual(rr.calls[0].files, [FLAKY.file], 'only the files there are');
  assert.equal(fx.creates.length, 1);
  assert.ok(fx.creates[0].includes(NOFILE.test), fx.creates[0]);
  assert.deepEqual(load().knownFailures(ws, PROJECT).map((x) => x.test), [NOFILE.test]);
});

test('#613 a test the second round names with backslashes in its file is still red twice: filed, not flaky', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const rerunFiles = async () => ({ failures: [{ ...BROKEN, file: BROKEN.file.replace(/\//g, '\\'), error: 'still red' }], log: 'rerun log' });
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([BROKEN]).runSuite, rerunFiles, exec: fx.exec });
  assert.equal(r.status, 'red');
  assert.equal(fx.creates.length, 1);
  assert.deepEqual(load().knownFailures(ws, PROJECT).map((x) => x.test), [BROKEN.test]);
  assert.deepEqual(flakyOf(ws), [], 'no flaky sighting');
});

test('#613 the store reads back the flaky sightings already written, and none for a store without them', (t) => {
  const { ws } = tmpWs(t);
  const store = loadStore();
  const file = path.join(ws, 'backlog', 'base-health', `${PROJECT}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ failures: [], lastGreen: null }));
  assert.deepEqual(store.readStore(ws, PROJECT).flaky, []);
  const seen = { test: FLAKY.test, file: FLAKY.file, commit: 'abc1234', at: '2026-10-26T16:48:09.923Z' };
  fs.writeFileSync(file, JSON.stringify({ failures: [], lastGreen: null, flaky: [seen] }));
  assert.deepEqual(store.readStore(ws, PROJECT).flaky, [seen]);
});

test('#613 the store keeps the latest 100 flaky sightings', () => {
  const { addFlaky } = loadStore();
  const store = { failures: [], lastGreen: null, flaky: Array.from({ length: 99 }, (_, i) => ({ test: `old ${i}`, file: 'test/a.test.js', commit: 'c0', at: '2026-10-25T00:00:00.000Z' })) };
  addFlaky(store, [{ test: 'new 1', file: 'test/b.test.js' }, { test: 'new 2', file: 'test/c.test.js' }], { commit: 'c1', at: '2026-10-26T00:00:00.000Z' });
  assert.equal(store.flaky.length, 100);
  assert.deepEqual([store.flaky[0].test, store.flaky[98].test, store.flaky[99].test], ['old 1', 'new 1', 'new 2'], 'the oldest dropped first');
  assert.deepEqual({ ...store.flaky[99] }, { test: 'new 2', file: 'test/c.test.js', commit: 'c1', at: '2026-10-26T00:00:00.000Z' });
});

test('#613 a deferred check (a release holds the base) runs neither round', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const suite = suiteOf([FLAKY]);
  const rr = fakeRerun([]);
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks, { releaseHoldsBase: () => true }), runSuite: suite.runSuite, rerunFiles: rr.rerunFiles, exec: fakeExec().exec });
  assert.equal(r.status, 'deferred');
  assert.deepEqual({ suite: suite.seen.calls, rerun: rr.calls.length }, { suite: 0, rerun: 0 });
});
