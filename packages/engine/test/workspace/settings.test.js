// #862: the workspace's Settings (settings.json) live in their own utility module,
// packages/engine/domains/workspace/settings.js; workspace.js re-exports them unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('../../domains/workspace/settings');
const workspace = require('../../domains/workspace/workspace');

// only the settings file matters to this module
function tmpWs(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-mod-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return { root: dir, settings: path.join(dir, 'settings.json') };
}

test('workspace.js re-exports the settings module\'s functions and defaults as they are', () => {
  for (const k of ['DEFAULT_SETTINGS', 'readSettings', 'savedSettings', 'writeSettings']) {
    assert.equal(workspace[k] === settings[k], true, k);
  }
});

test('with no settings.json, readSettings gives the defaults (memory guard on, 25% limit, 10% floor) and savedSettings null', (t) => {
  const ws = tmpWs(t);
  assert.equal(settings.savedSettings(ws), null);
  const s = settings.readSettings(ws);
  assert.deepEqual(s.memoryGuard, { enabled: true, limitPercent: 25, floorPercent: 10 });
  assert.equal(s.idleWarningMinutes, 5);
  assert.equal(s.accountCooldownMinutes, 60);
});

test('a memoryGuard written with writeSettings is read back as saved', (t) => {
  const ws = tmpWs(t);
  settings.writeSettings(ws, { memoryGuard: { enabled: false, limitPercent: 30, floorPercent: 5 } });
  assert.deepEqual(settings.savedSettings(ws).memoryGuard, { enabled: false, limitPercent: 30, floorPercent: 5 });
  assert.deepEqual(settings.readSettings(ws).memoryGuard, { enabled: false, limitPercent: 30, floorPercent: 5 });
});

test('writeSettings drops keys that are not settings', (t) => {
  const ws = tmpWs(t);
  settings.writeSettings(ws, { language: 'pt-BR', notASetting: 1 });
  const saved = settings.savedSettings(ws);
  assert.equal(saved.language, 'pt-BR');
  assert.equal('notASetting' in saved, false);
});

test('an invalid settings.json reads as no saved keys, the defaults still apply', (t) => {
  const ws = tmpWs(t);
  fs.writeFileSync(ws.settings, '{ not json');
  assert.deepEqual(settings.savedSettings(ws), {});
  assert.deepEqual(settings.readSettings(ws).memoryGuard, { enabled: true, limitPercent: 25, floorPercent: 10 });
});
