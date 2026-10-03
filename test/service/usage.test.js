const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService } = require('./helpers');

test('analytics: computes a snapshot of the (empty) workspace and refuses a real supervisor call without mock', async (t) => {
  const { api } = makeService(t);
  const snapshot = api['analytics:get']({ scope: 'orchestrator' });
  assert.equal(snapshot.scope, 'orchestrator');
  assert.equal(snapshot.totals.sessions, 0);
  await assert.rejects(api['analytics:analyze']({ scope: 'orchestrator', mock: false }), /Simulation only .*supervisor's CLI/);
});
