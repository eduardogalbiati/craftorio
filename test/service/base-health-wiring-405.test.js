// #405 "main stays green": the service's wiring (src/service/areas/base-health.js).
//
// Seams:
// - The area's functions, built from a small ctx (the service's workspace, its active runs, the
//   release test and the notifier): afterStepFinished (a run's step.finished), afterBaseMerge (its
//   worktree.merged), afterBaseReleased (a run ended).
// - The store, read back with src/base-health.js knownFailures; the base check's result (the promise
//   afterBaseMerge returns): its status and the base commit it checked.
//
// Assumptions:
// - The project's folder is a git repo without a test command: the check runs on its base tip and
//   ends with an error notice (no suite to run); what matters here is whether and when it runs.
// - In simulation the area's issue CLI is a no-op, so nothing is filed here (src/base-health.js tests
//   cover the filing).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService, gitRepo } = require('./helpers');

const loadArea = () => require('../../src/service/areas/base-health');
const loadHealth = () => require('../../src/base-health');

// #538, #539: the check takes the `suite` slot (#527) in MULTIAGENT_LOCKS_DIR; each test gets its
// own folder, so it never waits for a whole suite holding the machine's slot (the one running this file)
let savedSlot;
test.beforeEach(() => {
  savedSlot = { locks: process.env.MULTIAGENT_LOCKS_DIR, inherit: process.env.MULTIAGENT_SUITE_SLOT };
  delete process.env.MULTIAGENT_SUITE_SLOT;
  const locks = fs.mkdtempSync(path.join(os.tmpdir(), 'bh405w-locks-'));
  process.env.MULTIAGENT_LOCKS_DIR = locks;
  savedSlot.dir = locks;
});
test.afterEach(() => {
  for (const [k, v] of [['MULTIAGENT_LOCKS_DIR', savedSlot.locks], ['MULTIAGENT_SUITE_SLOT', savedSlot.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(savedSlot.dir, { recursive: true, force: true, maxRetries: 3 });
});

const FAILURE = { test: 'cart totals include tax', file: 'test/cart.test.js', reason: 'fails on the base too' };

async function setup(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const repo = gitRepo(t);
  const project = await api['projects:create']({ name: 'bh405', folder: repo.dir });
  const notices = [];
  const ctx = { ws, active: new Map(), isReleaseRun: (r) => !!r.release, notify: (n) => notices.push(n) };
  const area = loadArea()(ctx);
  const head = require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir }).toString().trim();
  return { api, ws, project, ctx, area, notices, head };
}

const stepFinished = { type: 'step.finished', output: { preexisting_failures: [FAILURE], base_check: { commit: 'abc1234' } } };

test('#405 a real run\'s step.finished with pre-existing failures records them for its project', async (t) => {
  const { ws, project, area } = await setup(t);
  await area.afterStepFinished({ projectId: project.id, runId: 'run-1', mock: false }, stepFinished);
  const known = loadHealth().knownFailures(ws.root, project.id);
  assert.equal(known.length, 1);
  assert.equal(known[0].test, FAILURE.test);
  assert.deepEqual([...known[0].runs], ['run-1']);
});

test('#405 a simulated (mock) run neither records pre-existing failures nor starts a base check', async (t) => {
  const { ws, project, area } = await setup(t);
  const run = { projectId: project.id, runId: 'run-m', mock: true };
  assert.equal(await area.afterStepFinished(run, stepFinished), null);
  assert.equal(loadHealth().knownFailures(ws.root, project.id).length, 0);
  assert.equal(area.afterBaseMerge(run, { base: 'main' }), null);
});

test('#405 a merge (also "not tested green") starts the base check on the base tip; onRed \'off\' starts none', async (t) => {
  const { api, project, area, head } = await setup(t);
  const run = { projectId: project.id, runId: 'run-1', mock: false };
  const check = area.afterBaseMerge(run, { base: 'main', tested: 'not green' });
  assert.ok(check && typeof check.then === 'function', 'a check started');
  const r = await check;
  assert.notEqual(r.status, 'deferred');
  assert.equal(r.commit, head);
  api['settings:set']({ baseCheck: { onRed: 'off' } });
  assert.equal(area.afterBaseMerge(run, { base: 'main' }), null);
});

test('#405 a check deferred by a release run runs once the release ends, and only once', async (t) => {
  const { project, ctx, area, notices, head } = await setup(t);
  ctx.active.set('rel-1', { runId: 'rel-1', projectId: project.id, release: true });
  const run = { projectId: project.id, runId: 'run-1', mock: false };
  assert.equal((await area.afterBaseMerge(run, { base: 'main' })).status, 'deferred');
  assert.equal(notices.length, 0, 'a deferred check is silent');
  // a run ends while the release still holds the base: still waiting
  assert.equal(area.afterBaseReleased({ projectId: project.id, runId: 'other' }), null);
  ctx.active.delete('rel-1');
  const check = area.afterBaseReleased({ projectId: project.id, runId: 'rel-1' });
  assert.ok(check && typeof check.then === 'function', 'the deferred check runs');
  const r = await check;
  assert.notEqual(r.status, 'deferred');
  assert.equal(r.commit, head);
  assert.equal(area.afterBaseReleased({ projectId: project.id, runId: 'rel-1' }), null, 'not twice');
});
