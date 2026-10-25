const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService } = require('@multiagent/engine/test/service/helpers');

// #83: the restart banner and the safe-restart refusals.
test('app:codeVersion reports this process\'s own version, unchanged right after start', async (t) => {
  const { api } = makeService(t);
  const v = api['app:codeVersion']();
  assert.deepEqual(Object.keys(v).sort(), ['changed', 'disk', 'loaded', 'running'].sort());
  assert.equal(v.changed, false);
  assert.equal(v.disk, v.running);
});

// #162: Keep awake (src/host/main.js) re-checks whether it should hold the blocker whenever a setting
// changes, from this event rather than from the settings:set call itself.
test('settings:set emits settings:changed with the new settings', (t) => {
  const { service, api } = makeService(t);
  const changes = [];
  service.events.on('settings:changed', (s) => changes.push(s));
  const s = api['settings:set']({ keepAwake: true });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].keepAwake, true);
  assert.equal(s.keepAwake, true);
});
