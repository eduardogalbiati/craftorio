const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeService } = require('./helpers');

test('deleting a skill goes through the host trash', async (t) => {
  const { api, trashed, service } = makeService(t);
  await api['skills:remove']('../../somewhere/my-skill');
  assert.deepEqual(trashed, [path.join(service.workspace().skills, 'my-skill')]);
});
