// #87 Night watch: Skip is off by default, Retry stays on; a saved list (with Skip) is kept.
//
// Seams: packages/engine/domains/night/night-watch.js PERMISSIONS, readPermissions, savePermissions,
// gateDecision.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/night/night-watch');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-skip-87-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('#87 PERMISSIONS: skip is off by default, retry on', () => {
  const byId = Object.fromEntries(load().PERMISSIONS.map((p) => [p.id, p.default === true]));
  assert.deepEqual({ skip: byId.skip, retry: byId.retry }, { skip: false, retry: true });
});

test('#87 a workspace that never saved its permissions allows Retry and not Skip', (t) => {
  const p = load().readPermissions(tmpDir(t));
  assert.deepEqual({ retry: p.allowed.includes('retry'), skip: p.allowed.includes('skip'), defaults: p.defaults }, { retry: true, skip: false, defaults: true });
});

test('#87 a saved list with Skip is kept', (t) => {
  const dir = tmpDir(t);
  load().savePermissions(dir, ['skip', 'retry']);
  const p = load().readPermissions(dir);
  assert.deepEqual({ allowed: [...p.allowed], defaults: p.defaults }, { allowed: ['retry', 'skip'], defaults: false });
});

test('#87 with the default permissions a run waiting at a gate is never parked, whatever parkAfterMinutes says', (t) => {
  const { allowed } = load().readPermissions(tmpDir(t));
  const now = Date.parse('2026-11-26T04:00:00Z');
  const decisions = [1, 15, 600].map((parkAfterMinutes) => load().gateDecision({
    waitingSince: '2026-11-25T22:00:00Z', now, allowed, othersRunning: false, settings: { oracle: { parkAfterMinutes } },
  }));
  assert.deepEqual(decisions, ['escalate', 'escalate', 'escalate']);
});
