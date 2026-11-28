// #129 the memory guard is off by default (packages/engine/domains/workspace/settings.js DEFAULT_SETTINGS.memoryGuard
// becomes { enabled: false, limitPercent: 25, floorPercent: 10 }). A settings.json saved by an earlier
// version holds the old default { enabled: true, limitPercent: 25, floorPercent: 10 } (writeSettings
// saves every key): it reads as off. A value the owner changed is kept, and so is the guard turned on
// by hand after this change, even with the default limit and floor (writeSettings marks it, however the
// developer chooses to: the test only writes and reads back through the module's functions).
// Seam: the settings module on a temp settings file, as test/workspace/settings.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/workspace/settings');
const OLD_DEFAULT = { enabled: true, limitPercent: 25, floorPercent: 10 };
const OFF = { enabled: false, limitPercent: 25, floorPercent: 10 };

function tmpWs(t, saved) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-129-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  const ws = { root: dir, settings: path.join(dir, 'settings.json') };
  if (saved) fs.writeFileSync(ws.settings, JSON.stringify(saved, null, 2));
  return ws;
}

// only the three values the screen shows (a marker the developer adds is not compared)
const guardOf = (s) => ({ enabled: s.memoryGuard?.enabled, limitPercent: s.memoryGuard?.limitPercent, floorPercent: s.memoryGuard?.floorPercent });

test('#129 DEFAULT_SETTINGS.memoryGuard is off, with the 25% limit and the 10% floor kept', () => {
  assert.deepEqual(guardOf(load().DEFAULT_SETTINGS), OFF);
});

test('#129 a new workspace (no settings.json) reads the memory guard as off', (t) => {
  assert.deepEqual(guardOf(load().readSettings(tmpWs(t))), OFF);
});

test('#129 a settings.json saved with the old default (on, 25%, 10%) reads the guard as off', (t) => {
  const ws = tmpWs(t, { keepAwake: false, memoryGuard: OLD_DEFAULT });
  assert.deepEqual(guardOf(load().readSettings(ws)), OFF);
});

test('#129 saving another setting over the old default keeps the guard off', (t) => {
  const { readSettings, writeSettings } = load();
  const ws = tmpWs(t, { keepAwake: false, memoryGuard: OLD_DEFAULT });
  writeSettings(ws, { keepAwake: true });
  assert.deepEqual(guardOf(readSettings(ws)), OFF);
});

test('#129 a saved memoryGuard the owner changed is kept as saved (floor 15, limit 30, on with no floor)', (t) => {
  for (const mg of [
    { enabled: true, limitPercent: 25, floorPercent: 15 },
    { enabled: true, limitPercent: 30, floorPercent: 10 },
    { enabled: true, limitPercent: 25, floorPercent: 0 },
  ]) {
    const ws = tmpWs(t, { memoryGuard: mg });
    assert.deepEqual(guardOf(load().readSettings(ws)), mg, JSON.stringify(mg));
  }
});

test('#129 the guard turned on by hand after the change (on, 25%, 10%) stays on when read back', (t) => {
  const { readSettings, writeSettings } = load();
  const ws = tmpWs(t);
  writeSettings(ws, { memoryGuard: { ...OLD_DEFAULT } });
  assert.deepEqual(guardOf(readSettings(ws)), OLD_DEFAULT);
  // and saving another setting later does not turn it off
  writeSettings(ws, { keepAwake: true });
  assert.deepEqual(guardOf(readSettings(ws)), OLD_DEFAULT);
});
