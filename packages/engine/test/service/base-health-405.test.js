// #405 "main stays green": what the service exposes (acceptance tests written before the code).
//
// Seams:
// - settings:get / settings:set (DEFAULT_SETTINGS.baseCheck, Settings › Execution).
// - backlog:get for a project: its `baseFailures` (packages/engine/domains/project/base-health.js knownFailures of that project),
//   after recordPreexisting wrote into the service's workspace root (service.workspace().root).
//
// Assumptions:
// - The key is `baseCheck: { onRed: 'fix' }` ('off' | 'issue' | 'fix'); settings:set validates nothing.
// - A project is registered with the shared roadmapProject helper (projects:create + a backlog file).
// Modules are required inside each test, so this file loads before the code exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService, roadmapProject } = require('./helpers');

const load = () => require('../../domains/project/base-health');

test('#405 settings: baseCheck.onRed defaults to \'fix\' and settings:set { onRed: \'issue\' } reads back', (t) => {
  const { api } = makeService(t);
  assert.equal(api['settings:get']().baseCheck?.onRed, 'fix');
  const saved = api['settings:set']({ baseCheck: { onRed: 'issue' } });
  assert.equal(saved.baseCheck?.onRed, 'issue');
  assert.equal(api['settings:get']().baseCheck?.onRed, 'issue');
});

test('#405 backlog:get returns the project\'s known base failures, not another project\'s', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1], 'bh405a');
  const other = await roadmapProject(api, ws, t, [2], 'bh405b');
  const { recordPreexisting } = load();
  await recordPreexisting(ws.root, { projectId: p.id, runId: 'run-1', commit: 'abc1234', failures: [{ test: 'cart totals include tax', file: 'test/cart.test.js', reason: 'fails on base' }] });
  const got = api['backlog:get']({ projectId: p.id }).baseFailures;
  assert.ok(Array.isArray(got), 'baseFailures is a list');
  assert.equal(got.length, 1);
  assert.equal(got[0].test, 'cart totals include tax');
  assert.equal(got[0].file, 'test/cart.test.js');
  assert.equal((api['backlog:get']({ projectId: other.id }).baseFailures || []).length, 0);
});
