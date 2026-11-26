// #78 the base check files nothing it did not see red twice: acceptance tests written before the code.
//
// - A second round (rerunFiles) that times out or does not start confirms nothing: the failures stay in
//   the store as sightings without confirmed_at, no issue is filed, no fix item, the check is `error`
//   (inconclusive), not `red`.
// - A real failure, red in both rounds, still files its issue and gets its fix item, as before.
// - `gh issue create` answering an error while the issue was created: the check looks the issue up by
//   its title (the platform's issue list) before recording `issue: null`.
//
// Seams: runBaseCheck (packages/engine/domains/project/base-health.js) with faked runSuite / rerunFiles /
// exec (the issue CLI, the system boundary), the store read back (packages/engine/engine/base-health-store.js
// readStore), the roadmap read back (packages/engine/domains/roadmap/roadmap.js). Same setup as
// test/project/base-health-rerun.test.js (#613).
//
// Assumptions for the developer:
// - the inconclusive check is `status: 'error'`, its store lastCheck.status 'error';
// - the lookup after a failed create runs the platform's `issue list` (github.js searchCommand or
//   issueListCommand, both `gh issue list ... --json ...`) and takes the issue whose title is the one the
//   create sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixture } = require('../worktree-helpers');

const load = () => require('../../domains/project/base-health');
const loadStore = () => require('../../engine/base-health-store');
const loadRoadmap = () => require('../../domains/roadmap/roadmap');

const PROJECT = 'proj-78-cancelled';
const BROKEN = { test: 'cart totals include tax', file: 'test/cart.test.js', error: 'expected 110, got 100' };

let savedLocks;
test.beforeEach(() => { savedLocks = process.env.CRAFTORIO_LOCKS_DIR; });
test.afterEach(() => { if (savedLocks === undefined) delete process.env.CRAFTORIO_LOCKS_DIR; else process.env.CRAFTORIO_LOCKS_DIR = savedLocks; });

function tmpWs(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bh78-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true, maxRetries: 3 }));
  fs.mkdirSync(path.join(ws, 'backlog'), { recursive: true });
  const locks = path.join(ws, 'locks');
  fs.mkdirSync(locks, { recursive: true });
  process.env.CRAFTORIO_LOCKS_DIR = locks;
  return { ws, locks };
}

const argsOf = (args) => (Array.isArray(args) ? args : String(args || '').split(/\s+/)).map(String);
const isCreate = (list) => list.includes('issue') && list.includes('create');
const isList = (list) => list.includes('issue') && list.includes('list');

// the issue CLI, faked: each create gets a new URL
function fakeExec() {
  const creates = [];
  let next = 801;
  const exec = async (cli, args) => {
    const list = argsOf(args);
    if (!isCreate(list)) return list.includes('label') ? '[{"name":"bug"}]' : '[]';
    creates.push(list.join(' '));
    return `https://github.com/o/r/issues/${next++}`;
  };
  return { exec, creates };
}

const suiteOf = (failures) => async () => ({ failures: failures.map((f) => ({ ...f })), log: 'ℹ tests 3\nℹ pass 2\nℹ fail 1\n' });

function checkArgs(f, locks, extra = {}) {
  return {
    projectId: PROJECT, repo: f.repo, base: 'main', platform: 'github', ghRepo: 'o/r', trigger: 'merge', onRed: 'fix',
    releaseHoldsBase: () => false, slot: { dir: locks, holder: 'base-check', pollMs: 20 }, ...extra,
  };
}

const fixStages = (ws) => loadRoadmap().readRoadmap(path.join(ws, 'backlog'), PROJECT).stages.filter((s) => s.name === 'Fix the base').length;
const sightings = (ws) => loadStore().readStore(ws, PROJECT).failures.map((e) => [e.test, e.confirmed_at ?? null]);

for (const [name, rerunFiles] of [
  ['times out', async ({ files }) => ({ failures: [], log: 'killed', error: `the re-run of ${files.length} file(s) timed out` })],
  ['does not start (no test command)', async () => ({ failures: [], log: '', error: 'no test command found' })],
]) {
  test(`#78 a second round that ${name} confirms nothing: the check is error, no issue, no fix item`, async (t) => {
    const { ws, locks } = tmpWs(t);
    const f = fixture(t, 'canonical');
    const fx = fakeExec();
    const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([BROKEN]), rerunFiles, exec: fx.exec });
    assert.equal(r.status, 'error');
    assert.equal(fx.creates.length, 0, 'no issue filed');
    assert.equal(r.fixItem ?? null, null, 'no fix item');
    assert.equal(fixStages(ws), 0, 'no "Fix the base" stage');
    assert.equal(loadStore().readStore(ws, PROJECT).lastCheck?.status, 'error');
  });

  test(`#78 a second round that ${name} leaves the failures in the store as sightings without confirmed_at`, async (t) => {
    const { ws, locks } = tmpWs(t);
    const f = fixture(t, 'canonical');
    await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([BROKEN]), rerunFiles, exec: fakeExec().exec });
    assert.deepEqual(sightings(ws), [['cart totals include tax', null]]);
  });
}

test('#78 a real failure, red in both rounds, still files its issue and records its number', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const fx = fakeExec();
  const rerunFiles = async () => ({ failures: [{ ...BROKEN, error: 'still red' }], log: 'ℹ tests 1\nℹ pass 0\nℹ fail 1\n' });
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([BROKEN]), rerunFiles, exec: fx.exec });
  assert.equal(r.status, 'red');
  assert.equal(fx.creates.length, 1, 'one issue');
  assert.equal(loadStore().readStore(ws, PROJECT).failures[0]?.issue?.number, 801);
  assert.equal(fixStages(ws), 1, 'a "Fix the base" stage');
});

test('#78 gh issue create answers an error but the issue exists: the check looks it up by title and records its number', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const listed = [
    { number: 900, title: 'Red on the base: test/other.test.js (another test)', url: 'https://github.com/o/r/issues/900', state: 'OPEN', labels: [], updatedAt: '2026-11-26T06:00:00Z' },
    { number: 901, title: 'Red on the base: test/cart.test.js (cart totals include tax)', url: 'https://github.com/o/r/issues/901', state: 'OPEN', labels: [], updatedAt: '2026-11-26T06:00:00Z' },
  ];
  const exec = async (cli, args) => {
    const list = argsOf(args);
    if (isCreate(list)) throw new Error('HTTP 502: Bad Gateway (https://api.github.com/graphql)');
    if (isList(list)) return JSON.stringify(listed);
    return list.includes('label') ? '[{"name":"bug"}]' : '';
  };
  const rerunFiles = async () => ({ failures: [{ ...BROKEN, error: 'still red' }], log: 'ℹ fail 1\n' });
  await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([BROKEN]), rerunFiles, exec });
  assert.equal(loadStore().readStore(ws, PROJECT).failures[0]?.issue?.number ?? null, 901);
});

test('#78 glab issue create answers an error but the issue exists: the lookup reads GitLab\'s iid and web_url', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  const listed = [
    { iid: 41, title: 'Red on the base: test/other.test.js (another test)', web_url: 'https://gitlab.com/o/r/-/issues/41', state: 'opened' },
    { iid: 42, title: 'Red on the base: test/cart.test.js (cart totals include tax)', web_url: 'https://gitlab.com/o/r/-/issues/42', state: 'opened' },
  ];
  const lists = [];
  const exec = async (cli, args) => {
    const list = argsOf(args);
    if (isCreate(list)) throw new Error('glab: 502 Bad Gateway');
    if (isList(list)) { lists.push(list.join(' ')); return JSON.stringify(listed); }
    return '';
  };
  const rerunFiles = async () => ({ failures: [{ ...BROKEN, error: 'still red' }], log: 'ℹ fail 1\n' });
  await load().runBaseCheck(ws, { ...checkArgs(f, locks, { platform: 'gitlab' }), runSuite: suiteOf([BROKEN]), rerunFiles, exec });
  const issue = loadStore().readStore(ws, PROJECT).failures[0]?.issue ?? null;
  assert.deepEqual(issue && { number: issue.number, url: issue.url }, { number: 42, url: 'https://gitlab.com/o/r/-/issues/42' });
  assert.equal(lists.length >= 1, true, 'the issue list was read');
});

test('#78 the create fails and the lookup finds no issue of that title: no issue is recorded, the check stays red', async (t) => {
  const { ws, locks } = tmpWs(t);
  const f = fixture(t, 'canonical');
  // an issue whose title only contains the searched one is not the same issue
  const listed = [{ number: 950, title: 'Red on the base: test/cart.test.js (cart totals include tax) — old', url: 'https://github.com/o/r/issues/950', state: 'CLOSED', labels: [], updatedAt: '2026-11-20T06:00:00Z' }];
  const exec = async (cli, args) => {
    const list = argsOf(args);
    if (isCreate(list)) throw new Error('HTTP 502: Bad Gateway (https://api.github.com/graphql)');
    if (isList(list)) return JSON.stringify(listed);
    return list.includes('label') ? '[{"name":"bug"}]' : '';
  };
  const rerunFiles = async () => ({ failures: [{ ...BROKEN, error: 'still red' }], log: 'ℹ fail 1\n' });
  const r = await load().runBaseCheck(ws, { ...checkArgs(f, locks), runSuite: suiteOf([BROKEN]), rerunFiles, exec });
  assert.equal(r.status, 'red');
  assert.equal(loadStore().readStore(ws, PROJECT).failures[0]?.issue?.number ?? null, null);
  assert.equal((r.issues || []).length, 0, 'no issue reported as filed');
});
