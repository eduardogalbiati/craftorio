// #695 "one base issue per cause": acceptance tests written before the code
// (packages/engine/domains/project/base-health.js).
//
// The base check groups the failures of one check by test file and first red commit and files one
// issue per group, titled by the file (`Red on the base: test/doc-editor-646.test.js (19 tests)`),
// listing every failing test in its body. A group that already has an open `Red on the base` issue
// updates it instead of opening another; the roadmap's "Fix the base" item holds one issue per group.
//
// Seams (as in base-health-405.test.js): runBaseCheck(ws, opts) with a faked `exec` (the issue CLI:
// every call recorded, a create returns a new URL) and a faked `runSuite`; a real git fixture repo.
//
// Assumptions:
// - The GitHub create command carries the title after `--title` (backlog.issueCreateCommand).
// - The count in the title is written `(<n> tests)` for a group of several tests; a group of one
//   test is only checked to start with `Red on the base: <file>`.
// - An "update" is any exec call naming 'issue' that is not a create (comment or edit).
// Modules are required inside each test, so this file loads before the code exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixture, commit } = require('../worktree-helpers');

const load = () => require('../../domains/project/base-health');
const loadRoadmap = () => require('../../domains/roadmap/roadmap');

// #528: runBaseCheck takes the `suite` slot in MULTIAGENT_LOCKS_DIR; each test gets its own folder
let saved;
test.beforeEach(() => {
  saved = { locks: process.env.MULTIAGENT_LOCKS_DIR, inherit: process.env.MULTIAGENT_SUITE_SLOT };
  delete process.env.MULTIAGENT_SUITE_SLOT;
  saved.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh695-locks-'));
  process.env.MULTIAGENT_LOCKS_DIR = saved.dir;
});
test.afterEach(() => {
  for (const [k, v] of [['MULTIAGENT_LOCKS_DIR', saved.locks], ['MULTIAGENT_SUITE_SLOT', saved.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(saved.dir, { recursive: true, force: true, maxRetries: 3 });
});

const PROJECT = 'proj-695';
const EDITOR = 'test/doc-editor-646.test.js';
const VIEWS = 'apps/desktop/test/view-folders.test.js';
const editorTests = Array.from({ length: 19 }, (_, i) => `doc editor section ${i + 1} maps between languages`);
const editorFailures = () => editorTests.map((name) => ({ test: name, file: EDITOR, error: 'anchor moved' }));
const viewsFailure = () => ({ test: 'views/: all 24 screens have moved into their own folders', file: VIEWS, error: 'docs is missing' });

function tmpWs(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bh695-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true, maxRetries: 3 }));
  fs.mkdirSync(path.join(ws, 'backlog'), { recursive: true });
  return ws;
}

/** The issue CLI, faked: every call recorded with its body and title; creates return incrementing URLs. */
function fakeExec() {
  const calls = [];
  let next = 701;
  const exec = async (cli, args) => {
    const list = Array.isArray(args) ? args.map(String) : String(args || '').split(/\s+/);
    let body = '';
    const bf = list.indexOf('--body-file');
    if (bf >= 0) { try { body = fs.readFileSync(list[bf + 1], 'utf8'); } catch { body = ''; } }
    for (const flag of ['--body', '--description', '-b']) {
      const i = list.indexOf(flag);
      if (i >= 0 && list[i + 1] != null) body += `\n${list[i + 1]}`;
    }
    const ti = list.indexOf('--title');
    const title = ti >= 0 ? list[ti + 1] : '';
    const create = list.includes('issue') && list.includes('create');
    const url = create ? `https://github.com/o/r/issues/${next++}` : '';
    calls.push({ cli: String(cli), args: list, body, title, create, url });
    return url;
  };
  const creates = () => calls.filter((c) => c.create);
  const updates = () => calls.filter((c) => !c.create && c.args.includes('issue'));
  return { exec, calls, creates, updates };
}

function writeRoadmapFixture(ws) {
  loadRoadmap().writeRoadmap(path.join(ws, 'backlog'), PROJECT, {
    state: 'running', simulated: false, error: null, pausedBy: null, scope: null,
    stages: [
      { id: 's1', name: 'Stage one', note: '', items: [{ id: 'i1', workflow: 'software-development.yaml', inputs: { task: 'build docs' }, status: 'running', runId: 'r1' }] },
    ],
  });
}
const fixItems = (ws) => loadRoadmap().readRoadmap(path.join(ws, 'backlog'), PROJECT).stages
  .flatMap((s) => s.items).filter((x) => x?.inputs?.mode === 'auto');

const checkArgs = (f, extra = {}) => ({ projectId: PROJECT, repo: f.repo, base: 'main', platform: 'github', ghRepo: 'o/r', trigger: 'merge', onRed: 'fix', releaseHoldsBase: () => false, ...extra });
const suite = (failures) => async () => ({ failures, log: `${failures.length} failing` });

test('#695 runBaseCheck: 19 failures in one test file file one issue, titled by the file with its count, listing every test', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  writeRoadmapFixture(ws);
  const fx = fakeExec();
  commit(f.repo, 'b.txt', 'b\n', 'merge the docs');
  const r = await load().runBaseCheck(ws, { ...checkArgs(f), runSuite: suite(editorFailures()), exec: fx.exec });
  assert.equal(r.status, 'red');
  assert.equal(fx.creates().length, 1);
  const c = fx.creates()[0];
  assert.equal(c.title, `Red on the base: ${EDITOR} (19 tests)`);
  assert.deepEqual(editorTests.filter((name) => !c.body.includes(name)), [], 'the body lists every failing test');
  assert.equal(r.issues?.length, 1);
  assert.equal(r.issues[0].url, c.url);
  assert.equal(r.issues[0].action, 'created');
});

test('#695 runBaseCheck: two causes (two test files) give two issues and a Fix the base item holding one issue per group', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  writeRoadmapFixture(ws);
  const fx = fakeExec();
  commit(f.repo, 'b.txt', 'b\n', 'merge the docs');
  const r = await load().runBaseCheck(ws, { ...checkArgs(f), runSuite: suite([...editorFailures(), viewsFailure()]), exec: fx.exec });
  assert.equal(fx.creates().length, 2);
  const titles = fx.creates().map((c) => c.title).sort();
  assert.equal(titles[0].startsWith(`Red on the base: ${VIEWS}`), true, titles[0]);
  assert.equal(titles[1], `Red on the base: ${EDITOR} (19 tests)`);
  assert.equal(r.issues?.length, 2);
  const fix = fixItems(ws);
  assert.equal(fix.length, 1);
  const urls = (fix[0].issues || []).map((i) => i?.url).sort();
  assert.deepEqual(urls, fx.creates().map((c) => c.url).sort());
});

// A store from before #695: one issue per test. The group's entries share the file and first red
// commit but hold different issues; one is marked to reopen (red again), one has no issue yet.
test('#695 runBaseCheck: a group from a store before #695 comments on each of its issues, reopens the marked one and gives the first to the entry without one', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  writeRoadmapFixture(ws);
  const at = '2026-11-01T00:00:00.000Z';
  const entry = (test, issue, extra = {}) => ({ test, file: EDITOR, first_seen: at, last_seen: at, runs: [], issue, first_red_commit: 'ed976c3e', ...extra });
  const [a, b, c] = editorTests;
  fs.mkdirSync(path.join(ws, 'backlog', 'base-health'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'backlog', 'base-health', `${PROJECT}.json`), JSON.stringify({
    failures: [
      entry(a, { url: 'https://github.com/o/r/issues/672', number: 672 }),
      entry(b, { url: 'https://github.com/o/r/issues/673', number: 673 }, { reopen: true }),
      entry(c, null),
    ],
    lastGreen: null,
    flaky: [],
  }, null, 2));
  const fx = fakeExec();
  commit(f.repo, 'b.txt', 'b\n', 'another merge');
  const failures = editorFailures().filter((x) => [a, b, c].includes(x.test));
  const r = await load().runBaseCheck(ws, { ...checkArgs(f), runSuite: suite(failures), exec: fx.exec });
  assert.equal(fx.creates().length, 0, 'no new issue for a group that has issues');
  const touching = (n, verb) => fx.updates().filter((x) => x.args.includes(String(n)) && x.args.includes(verb)).length;
  assert.equal(touching(672, 'comment'), 1, 'one comment on #672');
  assert.equal(touching(673, 'comment'), 1, 'one comment on #673');
  assert.equal(touching(673, 'reopen'), 1, '#673 is reopened');
  assert.equal(touching(672, 'reopen'), 0, '#672 is not reopened');
  assert.equal(r.issues?.length, 1, 'one result per group');
  const known = Object.fromEntries(load().knownFailures(ws, PROJECT).map((e) => [e.test, e.issue?.number ?? null]));
  assert.deepEqual([known[a], known[b], known[c]], [672, 673, 672]);
});

test('#695 runBaseCheck: a later red check of the same group updates its open issue instead of opening another', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  writeRoadmapFixture(ws);
  const fx = fakeExec();
  commit(f.repo, 'b.txt', 'b\n', 'merge the docs');
  const { runBaseCheck } = load();
  await runBaseCheck(ws, { ...checkArgs(f), runSuite: suite(editorFailures()), exec: fx.exec });
  const url = fx.creates()[0]?.url;
  const before = fx.updates().length;
  commit(f.repo, 'c.txt', 'c\n', 'another merge');
  const r = await runBaseCheck(ws, { ...checkArgs(f), runSuite: suite(editorFailures()), exec: fx.exec });
  assert.equal(fx.creates().length, 1, 'no second issue for the same cause');
  assert.equal(fx.updates().length > before, true, 'the open issue is updated');
  assert.equal(r.issues?.length, 1);
  assert.equal(r.issues[0].action, 'updated');
  assert.equal(r.issues[0].url, url);
  assert.equal(fixItems(ws).length, 1);
});
