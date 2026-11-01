// #405 "main stays green": acceptance tests written before the code (packages/engine/domains/project/base-health.js).
//
// Pre-existing failures are recorded per project (recordPreexisting / knownFailures); a test counted
// by two distinct runs gets one bug issue (later sightings update it). After a merge (or a run that
// did not end green) the base check runs the suite on a clean checkout of the base: a red test files
// one issue naming the commit range and the log and, with onRed 'fix', one fix item in a new stage
// before the roadmap's current stage. It never pushes and never touches a running item.
//
// Seams:
// - `exec(cli, args)`: the issue CLI (gh/glab), faked here: it records each call and returns a new
//   issue URL for a create (args with 'issue' and 'create'), '' otherwise; the body is captured from
//   `--body-file <path>` (read at call time) or the arg after `--body` / `--description`.
// - `runSuite({ cwd, env })`: the project's test suite, faked here (it reports failures and a log,
//   and records where and how it was called).
// - The base repository: a real git repo with a bare origin (test/worktree-helpers.js fixture,
//   default branch 'main'); the roadmap file is written with packages/engine/domains/roadmap/roadmap.js writeRoadmap.
//
// Assumptions:
// - `ws` is a workspace ROOT folder (a temp folder here); roadmaps live in <ws>/backlog.
// - An "update" of an issue is any exec call naming 'issue' that is not a create (comment or edit).
// - "The log" in the issue body: either the log text itself or the path of a file holding it.
// - The last green commit is the commit of the previous green runBaseCheck of the same project.
// Modules are required inside each test, so this file loads before the code exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixture, git, commit } = require('../worktree-helpers');

const load = () => require('../../domains/project/base-health');
const loadRoadmap = () => require('../../domains/roadmap/roadmap');

// #528: runBaseCheck takes the `suite` slot (#527) in MULTIAGENT_LOCKS_DIR; each test gets its own
// folder, so it never waits for a whole suite holding the machine's slot (the one running this file)
let savedSlot;
test.beforeEach(() => {
  savedSlot = { locks: process.env.MULTIAGENT_LOCKS_DIR, inherit: process.env.MULTIAGENT_SUITE_SLOT };
  delete process.env.MULTIAGENT_SUITE_SLOT;
  const locks = fs.mkdtempSync(path.join(os.tmpdir(), 'bh405-locks-'));
  process.env.MULTIAGENT_LOCKS_DIR = locks;
  savedSlot.dir = locks;
});
test.afterEach(() => {
  for (const [k, v] of [['MULTIAGENT_LOCKS_DIR', savedSlot.locks], ['MULTIAGENT_SUITE_SLOT', savedSlot.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(savedSlot.dir, { recursive: true, force: true, maxRetries: 3 });
});

const PROJECT = 'proj-405';
const RED = { test: 'cart totals include tax', file: 'test/cart.test.js', error: 'expected 110, got 100' };
const LOG_MARKER = 'LOG-405-MARKER cart totals include tax failed';

function tmpWs(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bh405-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true, maxRetries: 3 }));
  fs.mkdirSync(path.join(ws, 'backlog'), { recursive: true });
  return ws;
}

/** The issue CLI, faked: every call recorded with its body; creates return incrementing URLs. */
function fakeExec() {
  const calls = [];
  let next = 501;
  const exec = async (cli, args) => {
    const list = Array.isArray(args) ? args.map(String) : String(args || '').split(/\s+/);
    let body = '';
    const bf = list.indexOf('--body-file');
    if (bf >= 0) { try { body = fs.readFileSync(list[bf + 1], 'utf8'); } catch { body = ''; } }
    for (const flag of ['--body', '--description', '-b']) {
      const i = list.indexOf(flag);
      if (i >= 0 && list[i + 1] != null) body += `\n${list[i + 1]}`;
    }
    const create = list.includes('issue') && list.includes('create');
    const url = create ? `https://github.com/o/r/issues/${next++}` : '';
    calls.push({ cli: String(cli), args: list, body, create, url });
    return url;
  };
  const creates = () => calls.filter((c) => c.create);
  const updates = () => calls.filter((c) => !c.create && c.args.includes('issue'));
  return { exec, calls, creates, updates };
}

// two stages: stage 1 runs item i1 (run r1), stage 2 is planned
function writeRoadmapFixture(ws) {
  const { writeRoadmap } = loadRoadmap();
  writeRoadmap(path.join(ws, 'backlog'), PROJECT, {
    state: 'running', simulated: false, error: null, pausedBy: null, scope: null,
    stages: [
      { id: 's1', name: 'Stage one', note: '', items: [{ id: 'i1', workflow: 'software-development.yaml', inputs: { task: 'build cart' }, status: 'running', runId: 'r1' }] },
      { id: 's2', name: 'Stage two', note: '', items: [{ id: 'i2', workflow: 'software-development.yaml', inputs: { task: 'build checkout' }, status: 'planned' }] },
    ],
  });
}
const readStages = (ws) => loadRoadmap().readRoadmap(path.join(ws, 'backlog'), PROJECT).stages;
const fixItems = (stages) => stages.flatMap((s) => s.items).filter((x) => x?.inputs?.mode === 'auto');

const green = async () => ({ failures: [], log: 'all green' });
const red = async () => ({ failures: [{ ...RED }], log: LOG_MARKER });

function checkArgs(f, extra = {}) {
  return { projectId: PROJECT, repo: f.repo, base: 'main', platform: 'github', ghRepo: 'o/r', trigger: 'merge', onRed: 'fix', releaseHoldsBase: () => false, ...extra };
}

// the body names the log: its text, or the path of an existing file that holds it
function namesLog(body) {
  if (body.includes(LOG_MARKER)) return true;
  return body.split(/[\s`'"()<>[\]]+/).some((tok) => {
    try { return tok && fs.statSync(tok).isFile() && fs.readFileSync(tok, 'utf8').includes(LOG_MARKER); } catch { return false; }
  });
}

// ---- recordPreexisting / knownFailures ----------------------------------------------------------

test('#405 recordPreexisting records the test, file, first_seen and runs for its project only', async (t) => {
  const ws = tmpWs(t);
  const { recordPreexisting, knownFailures } = load();
  const at = '2026-10-15T10:00:00.000Z';
  await recordPreexisting(ws, { projectId: PROJECT, runId: 'run-1', commit: 'abc1234', failures: [{ test: RED.test, file: RED.file, reason: 'fails on base' }], at });
  const known = knownFailures(ws, PROJECT);
  assert.equal(known.length, 1);
  assert.equal(known[0].test, RED.test);
  assert.equal(known[0].file, RED.file);
  assert.equal(known[0].first_seen, at);
  assert.deepEqual([...known[0].runs], ['run-1']);
  assert.equal(knownFailures(ws, 'other-project').length, 0);
});

test('#405 recordPreexisting: one run files no issue, a second distinct run files exactly one', async (t) => {
  const ws = tmpWs(t);
  const { recordPreexisting, knownFailures } = load();
  const fx = fakeExec();
  const failures = [{ test: RED.test, file: RED.file, reason: 'fails on base' }];
  const opts = { projectId: PROJECT, commit: 'abc1234', failures, onRed: 'fix', platform: 'github', repo: 'o/r', exec: fx.exec };
  await recordPreexisting(ws, { ...opts, runId: 'run-1' });
  assert.equal(fx.creates().length, 0, 'one run is not enough for an issue');
  assert.equal(knownFailures(ws, PROJECT)[0].issue ?? null, null);
  await recordPreexisting(ws, { ...opts, runId: 'run-2' });
  assert.equal(fx.creates().length, 1);
  const c = fx.creates()[0];
  assert.ok((c.args.join(' ') + c.body).includes(RED.test), 'the issue names the test');
  assert.equal(knownFailures(ws, PROJECT)[0].issue?.url, c.url);
});

test('#405 recordPreexisting: the same runId twice counts once (no issue)', async (t) => {
  const ws = tmpWs(t);
  const { recordPreexisting, knownFailures } = load();
  const fx = fakeExec();
  const opts = { projectId: PROJECT, runId: 'run-1', commit: 'abc1234', failures: [{ test: RED.test, file: RED.file, reason: 'x' }], onRed: 'fix', platform: 'github', repo: 'o/r', exec: fx.exec };
  await recordPreexisting(ws, opts);
  await recordPreexisting(ws, opts);
  assert.deepEqual([...knownFailures(ws, PROJECT)[0].runs], ['run-1']);
  assert.equal(fx.creates().length, 0);
});

test('#405 recordPreexisting: a third run updates the open issue, never a second create', async (t) => {
  const ws = tmpWs(t);
  const { recordPreexisting, knownFailures } = load();
  const fx = fakeExec();
  const opts = { projectId: PROJECT, commit: 'abc1234', failures: [{ test: RED.test, file: RED.file, reason: 'x' }], onRed: 'fix', platform: 'github', repo: 'o/r', exec: fx.exec };
  await recordPreexisting(ws, { ...opts, runId: 'run-1' });
  await recordPreexisting(ws, { ...opts, runId: 'run-2' });
  const url = fx.creates()[0]?.url;
  const before = fx.updates().length;
  await recordPreexisting(ws, { ...opts, runId: 'run-3' });
  assert.equal(fx.creates().length, 1);
  assert.ok(fx.updates().length > before, 'the third sighting updates the issue');
  assert.equal(knownFailures(ws, PROJECT)[0].issue?.url, url);
});

// ---- runBaseCheck --------------------------------------------------------------------------------

test('#405 runBaseCheck: a merge leaving a test red files one issue (test, commit range, log) and one auto fix item in a new stage before the current one; nothing pushed', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  writeRoadmapFixture(ws);
  const { runBaseCheck } = load();
  const fx = fakeExec();
  const lastGreen = git(f.repo, 'rev-parse', 'main');
  const g = await runBaseCheck(ws, { ...checkArgs(f), runSuite: green, exec: fx.exec });
  assert.equal(g.status, 'green');
  const now = commit(f.repo, 'b.txt', 'b\n', 'merge cart');
  const originRefs = git(f.origin, 'for-each-ref');
  // the running item as stored (#112: an item with a run is stored 'planned', its status comes from the run)
  const runningBefore = JSON.stringify(readStages(ws)[0].items[0]);

  const r = await runBaseCheck(ws, { ...checkArgs(f), runSuite: red, exec: fx.exec });
  assert.equal(r.status, 'red');
  assert.equal(fx.creates().length, 1);
  const c = fx.creates()[0];
  const all = c.args.join(' ') + '\n' + c.body;
  assert.ok(all.includes(RED.test), 'names the test');
  assert.ok(all.includes(RED.file), 'names the file');
  assert.ok(c.body.includes(lastGreen.slice(0, 7)), 'names the last green commit');
  assert.ok(c.body.includes(now.slice(0, 7)), 'names this commit');
  assert.ok(namesLog(c.body), 'names the log');
  assert.equal(r.issues?.length, 1);
  assert.equal(r.issues[0].url, c.url);
  assert.equal(r.issues[0].action, 'created');

  const stages = readStages(ws);
  assert.equal(stages.length, 3);
  assert.ok(!['s1', 's2'].includes(stages[0].id), 'a new stage comes first');
  assert.equal(stages[0].items.length, 1);
  const fix = stages[0].items[0];
  assert.equal(fix.inputs?.mode, 'auto');
  const urls = [fix.url, ...(fix.issues || []).map((i) => i?.url)];
  assert.ok(urls.includes(c.url), 'the fix item points to the filed issue');
  assert.equal(stages[1].id, 's1');
  assert.equal(JSON.stringify(stages[1].items[0]), runningBefore, 'the running item is untouched');
  assert.equal(stages[1].items[0].runId, 'r1');
  assert.equal(stages[2].id, 's2');

  assert.equal(git(f.origin, 'for-each-ref'), originRefs, 'the origin refs are unchanged');
  assert.ok(!fx.calls.some((x) => x.args.includes('push')), 'no push through exec');
});

test('#405 runBaseCheck: a second red check of the same test updates its issue and adds no second fix item', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  writeRoadmapFixture(ws);
  const { runBaseCheck } = load();
  const fx = fakeExec();
  await runBaseCheck(ws, { ...checkArgs(f), runSuite: red, exec: fx.exec });
  const url = fx.creates()[0]?.url;
  const before = fx.updates().length;
  commit(f.repo, 'c.txt', 'c\n', 'another merge');
  const r = await runBaseCheck(ws, { ...checkArgs(f), runSuite: red, exec: fx.exec });
  assert.equal(fx.creates().length, 1);
  assert.ok(fx.updates().length > before, 'the open issue is updated');
  assert.equal(r.issues?.[0]?.action, 'updated');
  assert.equal(r.issues[0].url, url);
  const stages = readStages(ws);
  assert.equal(fixItems(stages).length, 1);
  assert.equal(stages.length, 3);
});

test('#405 a run counting the base check\'s red test as pre-existing updates that same issue (no create)', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  writeRoadmapFixture(ws);
  const { runBaseCheck, recordPreexisting, knownFailures } = load();
  const fx = fakeExec();
  await runBaseCheck(ws, { ...checkArgs(f), runSuite: red, exec: fx.exec });
  const url = fx.creates()[0]?.url;
  assert.ok(url);
  const before = fx.updates().length;
  const opts = { projectId: PROJECT, commit: 'abc1234', failures: [{ test: RED.test, file: RED.file, reason: 'fails on base' }], onRed: 'fix', platform: 'github', repo: 'o/r', exec: fx.exec };
  await recordPreexisting(ws, { ...opts, runId: 'run-a' });
  await recordPreexisting(ws, { ...opts, runId: 'run-b' });
  assert.equal(fx.creates().length, 1);
  assert.ok(fx.updates().length > before, 'the same issue is updated');
  assert.equal(knownFailures(ws, PROJECT).find((k) => k.test === RED.test)?.issue?.url, url);
});

test('#405 runBaseCheck onRed \'issue\': files the issue, leaves the roadmap untouched', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  writeRoadmapFixture(ws);
  const before = JSON.stringify(readStages(ws));
  const { runBaseCheck } = load();
  const fx = fakeExec();
  const r = await runBaseCheck(ws, { ...checkArgs(f, { onRed: 'issue' }), runSuite: red, exec: fx.exec });
  assert.equal(r.status, 'red');
  assert.equal(fx.creates().length, 1);
  assert.equal(JSON.stringify(readStages(ws)), before);
});

// #413: the service resolves the default development workflow and passes it; the item runs it
test('#413 the fix item runs the workflow it is given (recordPreexisting and runBaseCheck), mode auto, in the front stage', async (t) => {
  const { recordPreexisting, runBaseCheck } = load();
  const workflow = 'feature.yaml';
  const fx = fakeExec();
  const ws1 = tmpWs(t);
  writeRoadmapFixture(ws1);
  const opts = { projectId: PROJECT, commit: 'abc1234', failures: [{ test: RED.test, file: RED.file, reason: 'x' }], onRed: 'fix', platform: 'github', repo: 'o/r', exec: fx.exec, workflow };
  await recordPreexisting(ws1, { ...opts, runId: 'run-1' });
  const out = await recordPreexisting(ws1, { ...opts, runId: 'run-2' });
  assert.ok(out.fixItem, 'a fix item');
  const first = readStages(ws1)[0];
  assert.equal(first.name, 'Fix the base');
  assert.deepEqual(first.items.map((i) => [i.workflow, i.inputs?.mode]), [[workflow, 'auto']]);

  const ws2 = tmpWs(t);
  writeRoadmapFixture(ws2);
  const f = fixture(t, 'canonical');
  const r = await runBaseCheck(ws2, { ...checkArgs(f), runSuite: red, exec: fx.exec, workflow });
  assert.equal(r.status, 'red');
  assert.deepEqual(readStages(ws2)[0].items.map((i) => [i.workflow, i.inputs?.mode]), [[workflow, 'auto']]);
});

test('#405 runBaseCheck onRed \'off\': no issue call, no roadmap change', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  writeRoadmapFixture(ws);
  const before = JSON.stringify(readStages(ws));
  const { runBaseCheck } = load();
  const fx = fakeExec();
  const r = await runBaseCheck(ws, { ...checkArgs(f, { onRed: 'off' }), runSuite: red, exec: fx.exec });
  assert.ok(r && typeof r.status === 'string', 'a result with a status');
  assert.equal(fx.calls.length, 0);
  assert.equal((r.issues || []).length, 0);
  assert.equal(JSON.stringify(readStages(ws)), before);
});

test('#405 runBaseCheck: while a release holds the base the check is deferred and the suite never runs', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  const { runBaseCheck } = load();
  const fx = fakeExec();
  let ran = 0;
  const r = await runBaseCheck(ws, { ...checkArgs(f, { releaseHoldsBase: () => true }), runSuite: async () => { ran++; return { failures: [], log: '' }; }, exec: fx.exec });
  assert.equal(r.status, 'deferred');
  assert.equal(ran, 0);
  assert.equal(fx.calls.length, 0);
});

test('#405 runBaseCheck: two checks started together never run their suites at the same time', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  const { runBaseCheck } = load();
  const fx = fakeExec();
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const runSuite = async () => {
    calls++;
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 80));
    active--;
    return { failures: [], log: 'green' };
  };
  const [a, b] = await Promise.all([
    runBaseCheck(ws, { ...checkArgs(f), runSuite, exec: fx.exec }),
    runBaseCheck(ws, { ...checkArgs(f, { trigger: 'not-green' }), runSuite, exec: fx.exec }),
  ]);
  assert.equal(a.status, 'green');
  assert.equal(b.status, 'green');
  assert.equal(calls, 2);
  assert.equal(maxActive, 1);
});

test('#405 runBaseCheck runs the suite on a clean checkout of the base tip, in simulation-only mode', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  const tip = commit(f.repo, 'b.txt', 'b\n', 'merge');
  fs.writeFileSync(path.join(f.repo, 'untracked-405.txt'), 'not committed\n');
  const { runBaseCheck } = load();
  const fx = fakeExec();
  const seen = {};
  const runSuite = async ({ cwd, env }) => {
    seen.cwd = fs.realpathSync.native(cwd).toLowerCase();
    seen.head = git(cwd, 'rev-parse', 'HEAD');
    seen.untracked = fs.existsSync(path.join(cwd, 'untracked-405.txt'));
    seen.tracked = fs.existsSync(path.join(cwd, 'b.txt'));
    seen.sim = env?.MULTIAGENT_SIMULATION_ONLY;
    return { failures: [], log: 'green' };
  };
  const r = await runBaseCheck(ws, { ...checkArgs(f), runSuite, exec: fx.exec });
  assert.equal(r.status, 'green');
  assert.notEqual(seen.cwd, fs.realpathSync.native(f.repo).toLowerCase(), 'not the repo itself');
  assert.equal(seen.head, tip);
  assert.equal(seen.tracked, true);
  assert.equal(seen.untracked, false);
  assert.equal(seen.sim, '1');
  assert.equal(r.commit, tip);
});

// ---- review round 1: reopen, record-only sightings ----------------------------------------------

test('#405 a test red again after a green check reopens its issue and gets a new fix item once the old one is done', async (t) => {
  const ws = tmpWs(t);
  const f = fixture(t, 'canonical');
  writeRoadmapFixture(ws);
  const { runBaseCheck, knownFailures } = load();
  const { updateRoadmap } = loadRoadmap();
  const fx = fakeExec();
  await runBaseCheck(ws, { ...checkArgs(f), runSuite: red, exec: fx.exec });
  const url = fx.creates()[0]?.url;
  assert.ok(url);
  // the fix item merged, the base went green: the test is no longer a known failure
  updateRoadmap(path.join(ws, 'backlog'), PROJECT, (r) => ({ ...r, stages: r.stages.map((s) => ({ ...s, items: s.items.map((x) => (x.inputs?.mode === 'auto' ? { ...x, status: 'done' } : x)) })) }));
  commit(f.repo, 'fix.txt', 'fixed\n', 'fix cart');
  assert.equal((await runBaseCheck(ws, { ...checkArgs(f), runSuite: green, exec: fx.exec })).status, 'green');
  assert.equal(knownFailures(ws, PROJECT).length, 0);

  commit(f.repo, 'again.txt', 'again\n', 'break cart again');
  const r = await runBaseCheck(ws, { ...checkArgs(f), runSuite: red, exec: fx.exec });
  assert.equal(r.status, 'red');
  assert.equal(fx.creates().length, 1, 'no second issue');
  assert.ok(fx.calls.some((c) => c.args.includes('reopen') && c.args.includes('501')), 'the issue is reopened');
  assert.equal(r.issues[0].url, url);
  assert.equal(knownFailures(ws, PROJECT).length, 1);
  const fixes = fixItems(readStages(ws));
  assert.equal(fixes.length, 2, 'a new fix item next to the done one');
  assert.equal(fixes.filter((x) => x.status !== 'done').length, 1);
});

test('#405 record-only sightings (no exec) never file; the same run reported with exec files once, never twice', async (t) => {
  const ws = tmpWs(t);
  const { recordPreexisting, knownFailures } = load();
  const fx = fakeExec();
  const base = { projectId: PROJECT, commit: 'abc1234', failures: [{ test: RED.test, file: RED.file, reason: 'fails on base' }] };
  // the engine's record (no exec): two runs, nothing filed
  await recordPreexisting(ws, { ...base, runId: 'run-1' });
  await recordPreexisting(ws, { ...base, runId: 'run-2' });
  assert.deepEqual([...knownFailures(ws, PROJECT)[0].runs], ['run-1', 'run-2']);
  assert.equal(knownFailures(ws, PROJECT)[0].issue ?? null, null);
  // the service's call for the same run files the issue that is due
  const withExec = { ...base, runId: 'run-2', onRed: 'fix', platform: 'github', repo: 'o/r', exec: fx.exec };
  await recordPreexisting(ws, withExec);
  assert.equal(fx.creates().length, 1);
  const after = fx.calls.length;
  await recordPreexisting(ws, withExec);
  assert.equal(fx.calls.length, after, 'the same run is not reported twice');
  assert.deepEqual([...knownFailures(ws, PROJECT)[0].runs], ['run-1', 'run-2']);
});

test('#405 the engine\'s real machine records a run\'s pre-existing failures in the project\'s store, without filing', async (t) => {
  const ws = tmpWs(t);
  const { knownFailures } = load();
  const machine = require('../../engine/machine-actions').real();
  const info = { projectId: PROJECT, commit: 'abc1234', failures: [{ test: RED.test, file: RED.file, reason: 'fails on base' }] };
  await machine.noteFailingOnMain(ws, { ...info, runId: 'run-1' });
  await machine.noteFailingOnMain(ws, { ...info, runId: 'run-2' });
  const known = knownFailures(ws, PROJECT);
  assert.equal(known.length, 1);
  assert.deepEqual([...known[0].runs], ['run-1', 'run-2']);
  assert.equal(known[0].issue ?? null, null, 'nothing filed by the engine');
});
