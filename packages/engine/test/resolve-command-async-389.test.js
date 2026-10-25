// #389 internals: resolveCommandAsync finds what resolveCommand finds, without blocking the process.
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCommand, resolveCommandAsync } = require('../engine/providers');

test('resolveCommandAsync answers what resolveCommand answers, for an installed and a missing command', async () => {
  for (const cmd of ['node', 'git', 'no-such-cli-389']) {
    assert.deepEqual(await resolveCommandAsync(cmd), resolveCommand(cmd), cmd);
  }
  assert.equal(await resolveCommandAsync('no-such-cli-389'), null);
});
