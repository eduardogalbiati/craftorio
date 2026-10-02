// The Oracle's actions (#123, src/oracle-actions.js): what a card may change, and the Night watch
// switch that lets a fixed list of repairs run without the owner's click. Pure, file-backed
// functions: no service, no model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const actions = require('../src/oracle-actions');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-actions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---- Night watch: a required, valid, near-term end time ---------------------------------------

test('setNightWatch: turning it on without an end time throws', (t) => {
  const dir = tmpDir(t);
  assert.throws(() => actions.setNightWatch(dir, { on: true }), /needs an end time/);
  assert.equal(actions.nightWatch(dir).active, false);
});

test('setNightWatch: turning it on with an end time that does not parse throws', (t) => {
  const dir = tmpDir(t);
  assert.throws(() => actions.setNightWatch(dir, { on: true, until: 'not a date' }), /needs an end time/);
  assert.equal(actions.nightWatch(dir).active, false);
});

test('setNightWatch: an end time already in the past throws', (t) => {
  const dir = tmpDir(t);
  const past = new Date(Date.now() - 3600e3).toISOString();
  assert.throws(() => actions.setNightWatch(dir, { on: true, until: past }), /must be in the future/);
  assert.equal(actions.nightWatch(dir).active, false);
});

test('setNightWatch: an end time more than 24 hours away throws', (t) => {
  const dir = tmpDir(t);
  const tooFar = new Date(Date.now() + 25 * 3600e3).toISOString();
  assert.throws(() => actions.setNightWatch(dir, { on: true, until: tooFar }), /at most 24 hours/);
  assert.equal(actions.nightWatch(dir).active, false);
});

test('setNightWatch: a valid end time (within 24 hours, in the future) turns it on, active', (t) => {
  const dir = tmpDir(t);
  const until = new Date(Date.now() + 3600e3).toISOString();
  const state = actions.setNightWatch(dir, { on: true, until });
  assert.equal(state.on, true);
  assert.equal(state.active, true);
  assert.equal(state.until, until);
  assert.equal(actions.nightWatch(dir).active, true);
});

test('nightWatch: an old state file with on:true but no until is never active (cannot grant unlimited autonomy)', (t) => {
  const dir = tmpDir(t);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'night-watch.json'), JSON.stringify({ on: true, startedAt: new Date().toISOString() }));
  const nw = actions.nightWatch(dir);
  assert.equal(nw.on, true);
  assert.equal(nw.active, false);
});

test('setNightWatch: turning it off never needs an end time, even while previously active', (t) => {
  const dir = tmpDir(t);
  const until = new Date(Date.now() + 3600e3).toISOString();
  actions.setNightWatch(dir, { on: true, until });
  const state = actions.setNightWatch(dir, { on: false });
  assert.equal(state.on, false);
  assert.equal(state.active, false);
  assert.equal(state.until, null);
});
