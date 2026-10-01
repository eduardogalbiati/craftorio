const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService } = require('./helpers');

// #83: the restart banner and the safe-restart refusals.
test('app:codeVersion reports this process\'s own version, unchanged right after start', async (t) => {
  const { api } = makeService(t);
  const v = api['app:codeVersion']();
  assert.deepEqual(Object.keys(v).sort(), ['changed', 'disk', 'loaded', 'running'].sort());
  assert.equal(v.changed, false);
  assert.equal(v.disk, v.running);
});
