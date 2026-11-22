// #790: the fix item of a Fix the base stage runs the project's default workflow, in the project order,
// never settings.defaultWorkflow. Acceptance tests, written before the code.
// Seams, as base-health-workflow-413.test.js: the area's afterStepFinished and afterBaseMerge on a small
// ctx, the service's own workflow listing, and the roadmap the fix item lands in. The only fakes are the
// issue CLI and the base check's suite, at that boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ISSUE_WORKFLOW, makeService, gitRepo } = require('./helpers');

let saved;
test.beforeEach(() => {
  saved = { locks: process.env.CRAFTORIO_LOCKS_DIR, inherit: process.env.CRAFTORIO_SUITE_SLOT };
  delete process.env.CRAFTORIO_SUITE_SLOT;
  saved.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh790-locks-'));
  process.env.CRAFTORIO_LOCKS_DIR = saved.dir;
});
test.afterEach(() => {
  for (const [k, v] of [['CRAFTORIO_LOCKS_DIR', saved.locks], ['CRAFTORIO_SUITE_SLOT', saved.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(saved.dir, { recursive: true, force: true, maxRetries: 3 });
});

const loadArea = () => require('../../service/areas/base-health');
const loadHealth = () => require('../../domains/project/base-health');
const loadRoadmap = () => require('../../domains/roadmap/roadmap');

const FAILURE = { test: 'cart totals include tax', file: 'test/cart.test.js', reason: 'fails on the base too' };
const stepFinished = { type: 'step.finished', output: { preexisting_failures: [FAILURE], base_check: { commit: 'abc1234' } } };
const MANIFEST = 'version: 1\ndefault: fixture-manifest\nworkflows:\n  - name: fixture-manifest\n    category: solo\n';

function fakeExec() {
  let next = 701;
  return async (cli, args) => {
    const list = (Array.isArray(args) ? args : String(args || '').split(/\s+/)).map(String);
    return list.includes('issue') && list.includes('create') ? `https://github.com/o/r/issues/${next++}` : '';
  };
}

// a project on a real repository; `manifest`: its .multiagent/project.yaml; `extra`: fields of projects:create
async function setup(t, { manifest = null, extra = {} } = {}) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  for (const name of ['fixture-project', 'fixture-manifest', 'fixture-setting']) {
    fs.writeFileSync(path.join(ws.workflows, `${name}.yaml`), ISSUE_WORKFLOW.replace('name: fixture-issue', `name: ${name}`));
  }
  const repo = gitRepo(t);
  if (manifest) {
    fs.mkdirSync(path.join(repo.dir, '.multiagent'));
    fs.writeFileSync(path.join(repo.dir, '.multiagent', 'project.yaml'), manifest);
  }
  const project = await api['projects:create']({ name: 'bh790', folder: repo.dir, ...extra });
  // what an older settings.json holds: nothing but the migration may read it
  fs.writeFileSync(ws.settings, JSON.stringify({ defaultWorkflow: 'fixture-setting.yaml' }));
  const ctx = { ws, active: new Map(), isReleaseRun: (r) => !!r.release, notify: () => {}, listWorkflows: () => api['workflows:list']() };
  const health = loadHealth();
  const exec = fakeExec();
  const realRecord = health.recordPreexisting;
  const realCheck = health.runBaseCheck;
  t.mock.method(health, 'recordPreexisting', (root, opts) => realRecord(root, { ...opts, platform: 'github', repo: 'o/r', exec }));
  t.mock.method(health, 'runBaseCheck', (root, opts) => realCheck(root, {
    ...opts, platform: 'github', ghRepo: 'o/r', exec, releaseHoldsBase: () => false,
    runSuite: async () => ({ failures: [{ test: FAILURE.test, file: FAILURE.file, error: 'expected 110, got 100' }], log: 'red' }),
  }));
  return { ws, project, area: loadArea()(ctx) };
}

function fixItems(ws, project) {
  const stages = loadRoadmap().readRoadmap(ws.backlog, project.id).stages;
  return stages.filter((s) => s.name === 'Fix the base').flatMap((s) => s.items).map((i) => i.workflow);
}

// two distinct real runs count the failure as pre-existing: the second files its issue and the fix item
async function fixItemFromRuns({ area, ws, project }) {
  await area.afterStepFinished({ projectId: project.id, runId: 'run-1', mock: false }, stepFinished);
  await area.afterStepFinished({ projectId: project.id, runId: 'run-2', mock: false }, stepFinished);
  return fixItems(ws, project);
}

test('#790 a pre-existing failure\'s fix item runs the project\'s default, not the setting', { timeout: 60000 }, async (t) => {
  const s = await setup(t, { extra: { workflows: [{ name: 'fixture-project', origin: 'workspace' }], defaultWorkflow: 'fixture-project' } });
  assert.deepEqual(await fixItemFromRuns(s), ['fixture-project.yaml']);
});

test('#790 a project with no default of its own: the fix item runs its manifest\'s default', { timeout: 60000 }, async (t) => {
  const s = await setup(t, { manifest: MANIFEST });
  assert.deepEqual(await fixItemFromRuns(s), ['fixture-manifest.yaml']);
});

test('#790 a project with no default anywhere: the fix item runs feature, not the setting', { timeout: 60000 }, async (t) => {
  const s = await setup(t);
  assert.deepEqual(await fixItemFromRuns(s), ['feature.yaml']);
});

test('#790 a red base check\'s fix item runs the project\'s default, not the setting', { timeout: 60000 }, async (t) => {
  const s = await setup(t, { extra: { workflows: [{ name: 'fixture-project', origin: 'workspace' }], defaultWorkflow: 'fixture-project' } });
  await s.area.afterBaseMerge({ projectId: s.project.id, runId: 'run-1', mock: false }, { base: 'main' });
  assert.deepEqual(fixItems(s.ws, s.project), ['fixture-project.yaml']);
});
