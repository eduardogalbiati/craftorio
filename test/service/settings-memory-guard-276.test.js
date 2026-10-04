// #276 memory guard: its settings (src/workspace.js DEFAULT_SETTINGS.memoryGuard) and what the
// Settings › Execution screen needs from the service to show the limit in GB.
// Assumptions (acceptance tests written before the code):
//   - the key is `memoryGuard: { enabled: true, limitPercent: 25, floorPercent: 10 }`, one nested
//     object like `concurrentRuns` (limitPercent: % of total RAM one run's processes may use, 5..90;
//     floorPercent: % of free RAM under which suites and new runs are held, 0..50, 0 = no hold);
//   - the range checks live in the renderer (settings.js saves only valid values, the way
//     saveConcurrency/saveOracleSettings clamp there); the service's settings:set validates nothing
//     today, so these tests only hold the defaults and the save/load round trip;
//   - the renderer learns the machine's total memory from `app:info` (api.appInfo()), which gains
//     `totalMemoryBytes` (os.totalmem()).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const { makeService } = require('./helpers');

test('DEFAULT_SETTINGS.memoryGuard: on, a 25% limit and a 10% floor', () => {
  const workspace = require('../../src/workspace');
  assert.equal(typeof workspace.DEFAULT_SETTINGS.memoryGuard, 'object');
  assert.equal(workspace.DEFAULT_SETTINGS.memoryGuard?.enabled, true);
  assert.equal(workspace.DEFAULT_SETTINGS.memoryGuard?.limitPercent, 25);
  assert.equal(workspace.DEFAULT_SETTINGS.memoryGuard?.floorPercent, 10);
});

test('settings:get on a new workspace returns the memory guard defaults', (t) => {
  const { api } = makeService(t);
  const mg = api['settings:get']().memoryGuard;
  assert.equal(mg?.enabled, true);
  assert.equal(mg?.limitPercent, 25);
  assert.equal(mg?.floorPercent, 10);
});

test('settings:set { memoryGuard } is saved to settings.json and read back by settings:get', (t) => {
  const { service, api } = makeService(t);
  const saved = api['settings:set']({ memoryGuard: { enabled: false, limitPercent: 40, floorPercent: 0 } });
  assert.equal(saved.memoryGuard?.enabled, false);
  assert.equal(saved.memoryGuard?.limitPercent, 40);
  assert.equal(saved.memoryGuard?.floorPercent, 0);
  const onDisk = JSON.parse(fs.readFileSync(service.workspace().settings, 'utf8')).memoryGuard;
  assert.equal(onDisk?.enabled, false);
  assert.equal(onDisk?.limitPercent, 40);
  assert.equal(onDisk?.floorPercent, 0);
  const read = api['settings:get']().memoryGuard;
  assert.equal(read?.enabled, false);
  assert.equal(read?.limitPercent, 40);
  assert.equal(read?.floorPercent, 0);
});

test('settings:set of another key keeps the saved memoryGuard', (t) => {
  const { api } = makeService(t);
  api['settings:set']({ memoryGuard: { enabled: true, limitPercent: 50, floorPercent: 20 } });
  api['settings:set']({ keepAwake: true });
  const mg = api['settings:get']().memoryGuard;
  assert.equal(mg?.limitPercent, 50);
  assert.equal(mg?.floorPercent, 20);
});

test('app:info reports this machine\'s total memory in bytes (the Settings hint shows the limit in GB)', (t) => {
  const { api } = makeService(t);
  const info = api['app:info']();
  assert.equal(info.totalMemoryBytes, os.totalmem());
});
