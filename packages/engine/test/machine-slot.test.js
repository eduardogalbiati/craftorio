// packages/engine/engine/machine-slot.js (#199): at most one holder of a named slot at once, across every run
// and agent on this machine. Used for Electron screenshots: several runs each starting the app at
// once made the machine stop responding. dir is injected (a temp folder) in every test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireSlot, slotFile, SCREENSHOT_SLOT_ENV } = require('../engine/machine-slot');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-slot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

test('acquireSlot: the second caller waits until the first releases, with onWait called once', async (t) => {
  const dir = tmpDir(t);
  const held = await acquireSlot('screenshot', { dir, holder: 'first' });
  let waited = 0;
  const pWait = acquireSlot('screenshot', { dir, holder: 'second', pollMs: 50, onWait: () => { waited++; } });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(waited, 1, 'onWait is called once, not once per poll');
  held.release();
  const second = await pWait;
  assert.ok(second.waitedMs >= 0);
  second.release();
});

test('acquireSlot: a slot file left by a dead pid is freed and taken over', async (t) => {
  const dir = tmpDir(t);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(slotFile('screenshot', dir), JSON.stringify({ pid: 999999, host: os.hostname(), token: 'x', started: Date.now(), holder: 'dead' }));
  const r = await acquireSlot('screenshot', { dir, waitMs: 2000 });
  assert.equal(typeof r.release, 'function');
  r.release();
});

test('acquireSlot: a slot older than maxHoldMs is freed even if its process is alive (a hung holder)', async (t) => {
  const dir = tmpDir(t);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(slotFile('screenshot', dir), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'x', started: Date.now() - 20 * 60e3, holder: 'stuck' }));
  const r = await acquireSlot('screenshot', { dir, maxHoldMs: 15 * 60e3, waitMs: 2000 });
  assert.equal(typeof r.release, 'function');
  r.release();
});

test('acquireSlot: inherit (a child of the current holder) returns the same token right away, without waiting', async (t) => {
  const dir = tmpDir(t);
  const held = await acquireSlot('screenshot', { dir, holder: 'parent' });
  let waited = false;
  const child = await acquireSlot('screenshot', { dir, inherit: held.token, onWait: () => { waited = true; } });
  assert.equal(child.inherited, true);
  assert.equal(child.token, held.token);
  assert.equal(waited, false);
  held.release();
});

test('release only removes the file when it still holds this token (never someone else\'s)', async (t) => {
  const dir = tmpDir(t);
  const first = await acquireSlot('screenshot', { dir, holder: 'first' });
  // someone else took over the slot (a dead holder) between acquiring and releasing
  fs.writeFileSync(slotFile('screenshot', dir), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'someone-else', started: Date.now(), holder: 'new' }));
  first.release();
  assert.ok(fs.existsSync(slotFile('screenshot', dir)), 'the current holder\'s file is left alone');
  const meta = JSON.parse(fs.readFileSync(slotFile('screenshot', dir), 'utf8'));
  assert.equal(meta.token, 'someone-else');
});

test('SCREENSHOT_SLOT_ENV names the variable a holder passes its token to its child in', () => {
  assert.equal(SCREENSHOT_SLOT_ENV, 'CRAFTORIO_SCREENSHOT_SLOT');
});
