const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeService } = require('./helpers');

test('agents: the supervisor comes built in; removing an agent goes through the host trash', async (t) => {
  const { api, trashed, service } = makeService(t);
  const ids = api['agents:list']().map((a) => a.id);
  assert.deepEqual(ids.slice(0, 2), ['supervisor', 'product-owner']);
  const a = api['agents:create']({ name: 'Tester', prompt: 'You write tests.', skills: ['unit-test-writer-js'] });
  assert.equal(api['agents:save']({ id: a.id, data: { ...a, description: 'Writes tests' } }).description, 'Writes tests');
  await api['agents:remove'](a.id);
  assert.deepEqual(trashed, [path.join(service.workspace().agents, 'tester.json')]);
  await assert.rejects(async () => api['agents:remove']('supervisor'), /can't be removed/);
  await assert.rejects(async () => api['agents:remove']('product-owner'), /can't be removed/);
});

// #68: the workspace's workflows (the bundled ones plus the fixture written by makeService) list
// their own agents too, read-only, after the user's.
test('agents: the workflows\' own agents are listed too, read-only', async (t) => {
  const { api } = makeService(t);
  const ids = api['agents:list']().map((a) => a.id);
  assert.ok(ids.includes('workflow:fixture-service.yaml:a'));
  const fixtureAgent = api['agents:list']().find((a) => a.id === 'workflow:fixture-service.yaml:a');
  assert.equal(fixtureAgent.readOnly, true);
  await assert.rejects(async () => api['agents:remove']('workflow:fixture-service.yaml:a'), /belongs to its workflow/);
});
