// #413: the fix item of a Fix the base stage runs the project's default development workflow
// (Settings › General › Backlog, settings.defaultWorkflow, #195), not a fixed one.
//
// Seams:
// - The area's afterStepFinished (a run's pre-existing failures) and afterBaseMerge (the base
//   check), built from a small ctx like test/service/base-health-wiring-405.test.js, with the
//   service's own workflow listing (ctx.listWorkflows = workflows:list) and its settings (settings:set).
// - The roadmap the fix item lands in (src/domains/roadmap/roadmap.js readRoadmap): its item's workflow.
//
// Assumptions:
// - In simulation the area's issue CLI is a no-op, so no issue number and no fix item would come
//   out. The only fake is at that boundary: the calls into src/domains/project/base-health.js go through unchanged
//   except for the issue CLI (a fake gh that returns a new issue URL) and, for the base check, a red
//   suite instead of the project's (it has no test command). What the area decides (the workflow,
//   onRed) is left untouched.
// - The default's fallback is DefaultWorkflow.resolve's: the local workflow when the workspace has
//   it (the bundled software-development-local-hero.yaml is installed in a new workspace).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService, gitRepo } = require('./helpers');

// #540: the check takes the `suite` slot (#527) in MULTIAGENT_LOCKS_DIR; each test gets its own
// folder, so it never waits for a whole suite holding the machine's slot (the one running this file)
let savedSlot;
test.beforeEach(() => {
  savedSlot = { locks: process.env.MULTIAGENT_LOCKS_DIR, inherit: process.env.MULTIAGENT_SUITE_SLOT };
  delete process.env.MULTIAGENT_SUITE_SLOT;
  const locks = fs.mkdtempSync(path.join(os.tmpdir(), 'bh413-locks-'));
  process.env.MULTIAGENT_LOCKS_DIR = locks;
  savedSlot.dir = locks;
});
test.afterEach(() => {
  for (const [k, v] of [['MULTIAGENT_LOCKS_DIR', savedSlot.locks], ['MULTIAGENT_SUITE_SLOT', savedSlot.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(savedSlot.dir, { recursive: true, force: true, maxRetries: 3 });
});

const loadArea = () => require('../../src/service/areas/base-health');
const loadHealth = () => require('../../src/domains/project/base-health');
const loadRoadmap = () => require('../../src/domains/roadmap/roadmap');

const AI_DEV = 'ai-development-local-hero.yaml';
const LOCAL = 'software-development-local-hero.yaml';
const FAILURE = { test: 'cart totals include tax', file: 'test/cart.test.js', reason: 'fails on the base too' };

/** The issue CLI, faked: creates return incrementing URLs, everything else returns ''. */
function fakeExec() {
  let next = 701;
  return async (cli, args) => {
    const list = (Array.isArray(args) ? args : String(args || '').split(/\s+/)).map(String);
    return list.includes('issue') && list.includes('create') ? `https://github.com/o/r/issues/${next++}` : '';
  };
}

async function setup(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  for (const f of [AI_DEV, LOCAL]) assert.ok(fs.existsSync(path.join(ws.workflows, f)), `the workspace has ${f}`);
  const repo = gitRepo(t);
  const project = await api['projects:create']({ name: 'bh413', folder: repo.dir });
  const ctx = { ws, active: new Map(), isReleaseRun: (r) => !!r.release, notify: () => {}, listWorkflows: () => api['workflows:list']() };
  // the boundary: the issue CLI (and the base check's suite) faked, the area's options otherwise as given
  const health = loadHealth();
  const exec = fakeExec();
  const realRecord = health.recordPreexisting;
  const realCheck = health.runBaseCheck;
  t.mock.method(health, 'recordPreexisting', (root, opts) => realRecord(root, { ...opts, platform: 'github', repo: 'o/r', exec }));
  t.mock.method(health, 'runBaseCheck', (root, opts) => realCheck(root, {
    ...opts, platform: 'github', ghRepo: 'o/r', exec, releaseHoldsBase: () => false,
    runSuite: async () => ({ failures: [{ test: FAILURE.test, file: FAILURE.file, error: 'expected 110, got 100' }], log: 'red' }),
  }));
  const area = loadArea()(ctx);
  return { api, ws, project, area };
}

const stepFinished = { type: 'step.finished', output: { preexisting_failures: [FAILURE], base_check: { commit: 'abc1234' } } };

// two distinct real runs count the failure as pre-existing: the second files its issue and the fix item
async function fixItemFromRuns(area, ws, project) {
  await area.afterStepFinished({ projectId: project.id, runId: 'run-1', mock: false }, stepFinished);
  const out = await area.afterStepFinished({ projectId: project.id, runId: 'run-2', mock: false }, stepFinished);
  assert.ok(out?.fixItem, 'a fix item was added');
  return fixItems(ws, project);
}

function fixItems(ws, project) {
  const stages = loadRoadmap().readRoadmap(ws.backlog, project.id).stages;
  return stages.filter((s) => s.name === 'Fix the base').flatMap((s) => s.items).map((i) => ({ workflow: i.workflow, mode: i.inputs?.mode }));
}

test('#413 a run\'s pre-existing failure gets a fix item that runs the default development workflow set in Settings', async (t) => {
  const { api, ws, project, area } = await setup(t);
  api['settings:set']({ defaultWorkflow: AI_DEV });
  assert.deepEqual(await fixItemFromRuns(area, ws, project), [{ workflow: AI_DEV, mode: 'auto' }]);
});

test('#413 the default development workflow unset: the fix item runs the fallback (the local workflow)', async (t) => {
  const { api, ws, project, area } = await setup(t);
  api['settings:set']({ defaultWorkflow: null });
  assert.deepEqual(await fixItemFromRuns(area, ws, project), [{ workflow: LOCAL, mode: 'auto' }]);
});

test('#413 the default development workflow names a missing workflow: the fix item runs the fallback (the local workflow)', async (t) => {
  const { api, ws, project, area } = await setup(t);
  api['settings:set']({ defaultWorkflow: 'deleted-workflow.yaml' });
  assert.deepEqual(await fixItemFromRuns(area, ws, project), [{ workflow: LOCAL, mode: 'auto' }]);
});

test('#413 a red base check after a merge gets a fix item that runs the default development workflow set in Settings', async (t) => {
  const { api, ws, project, area } = await setup(t);
  api['settings:set']({ defaultWorkflow: AI_DEV });
  const r = await area.afterBaseMerge({ projectId: project.id, runId: 'run-1', mock: false }, { base: 'main' });
  assert.equal(r.status, 'red');
  assert.ok(r.fixItem, 'a fix item was added');
  assert.deepEqual(fixItems(ws, project), [{ workflow: AI_DEV, mode: 'auto' }]);
});

// The service's own wiring: the area as createService builds it (its shared ctx, with the workflows
// area's listWorkflows), not a hand-made ctx. The area module's export is wrapped in the require
// cache only to keep hold of the ctx the service gives it.
test('#413 through the service\'s own wiring, a run\'s pre-existing failure gets a fix item that runs the default workflow', async (t) => {
  const areaFile = require.resolve('../../src/service/areas/base-health');
  const factory = loadArea();
  let shared = null;
  require.cache[areaFile].exports = (ctx) => { shared = ctx; return factory(ctx); };
  t.after(() => { require.cache[areaFile].exports = factory; });
  const { service, api } = makeService(t);
  require.cache[areaFile].exports = factory;
  assert.ok(shared && typeof shared.afterStepFinished === 'function', 'the service built the area');
  const ws = service.workspace();
  const repo = gitRepo(t);
  const project = await api['projects:create']({ name: 'bh413w', folder: repo.dir });
  const health = loadHealth();
  const realRecord = health.recordPreexisting;
  t.mock.method(health, 'recordPreexisting', (root, opts) => realRecord(root, { ...opts, platform: 'github', repo: 'o/r', exec: fakeExec() }));
  api['settings:set']({ defaultWorkflow: AI_DEV });
  assert.deepEqual(await fixItemFromRuns(shared, ws, project), [{ workflow: AI_DEV, mode: 'auto' }]);
});

test('#413 onRed \'issue\' with a default workflow set: the issue is filed, no fix item', async (t) => {
  const { api, ws, project, area } = await setup(t);
  api['settings:set']({ defaultWorkflow: AI_DEV, baseCheck: { onRed: 'issue' } });
  await area.afterStepFinished({ projectId: project.id, runId: 'run-1', mock: false }, stepFinished);
  const out = await area.afterStepFinished({ projectId: project.id, runId: 'run-2', mock: false }, stepFinished);
  assert.equal(out.issues.length, 1);
  assert.equal(out.fixItem, null);
  assert.deepEqual(fixItems(ws, project), []);
});
