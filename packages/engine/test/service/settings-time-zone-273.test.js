// #273 acceptance tests (written before the code): the workspace's Time zone setting (Settings ›
// General), through the service's settings:get / settings:set. Default: the computer's zone.
// Asia/Tokyo is the saved value: it is neither CI's UTC nor the owner's UTC-3, so a save that does
// not happen cannot pass as the default.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { makeService } = require('./helpers');

test('#273 settings:get on a new workspace returns the system time zone', (t) => {
  const { api } = makeService(t);
  assert.equal(api['settings:get']().timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test('#273 settings:set { timeZone } is saved to settings.json and read back by settings:get', (t) => {
  const { service, api } = makeService(t);
  api['settings:set']({ timeZone: 'Asia/Tokyo' });
  assert.equal(JSON.parse(fs.readFileSync(service.workspace().settings, 'utf8')).timeZone, 'Asia/Tokyo');
  assert.equal(api['settings:get']().timeZone, 'Asia/Tokyo');
});
