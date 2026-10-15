// #319 (acceptance tests, written before the code): the first-run Setup's settings in the
// workspace's settings.json (src/workspace.js, existing).
//
// Contract:
// - New settings `setupDone` (default false) and `hiddenWorkflows` (default [], workflow ids hidden
//   from Start), both kept by writeSettings.
// - Upgrade: an existing settings.json without `setupDone` reads setupDone true (a workspace that
//   was already in use does not see the Setup again); an explicit `setupDone: false` stays false.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const workspace = require('../src/workspace');

// a fresh workspace in a temp dir; an in-memory store so no global registry file is touched
function freshWs(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-settings-319-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = { get: () => null, set() {} };
  return workspace.setupWorkspace(dir, { store, persist: false });
}

test('a fresh workspace (no settings.json) reads setupDone false and no hidden workflows', (t) => {
  const ws = freshWs(t);
  assert.equal(fs.existsSync(ws.settings), false);
  const s = workspace.readSettings(ws);
  assert.equal(s.setupDone, false);
  assert.deepEqual(s.hiddenWorkflows, []);
});

test('writeSettings keeps setupDone and hiddenWorkflows on disk', (t) => {
  const ws = freshWs(t);
  workspace.writeSettings(ws, { setupDone: true, hiddenWorkflows: ['ai-arena'] });
  const raw = JSON.parse(fs.readFileSync(ws.settings, 'utf8'));
  assert.equal(raw.setupDone, true);
  assert.deepEqual(raw.hiddenWorkflows, ['ai-arena']);
  const s = workspace.readSettings(ws);
  assert.equal(s.setupDone, true);
  assert.deepEqual(s.hiddenWorkflows, ['ai-arena']);
});

test('upgrade: an existing settings.json without setupDone reads setupDone true', (t) => {
  const ws = freshWs(t);
  fs.writeFileSync(ws.settings, JSON.stringify({ developerMode: false }));
  assert.equal(workspace.readSettings(ws).setupDone, true);
  assert.deepEqual(workspace.readSettings(ws).hiddenWorkflows, []);
});

test('an existing settings.json with an explicit setupDone false stays false', (t) => {
  const ws = freshWs(t);
  fs.writeFileSync(ws.settings, JSON.stringify({ developerMode: false, setupDone: false }));
  const s = workspace.readSettings(ws);
  assert.equal(s.setupDone, false);
  assert.deepEqual(s.hiddenWorkflows, []);
});
