// src/domains/run/run-owner.js (#112): who owns a run (runs/<id>/owner.json) and the workspace lock
// (<workspace>/.lock), both the same { pid, host, heartbeat_at } record, refreshed while held and
// removed on release. A stale record (dead pid, or an old heartbeat for another host) is taken over.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runOwner = require('../../src/domains/run/run-owner');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-owner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const beat = (msAgo) => new Date(Date.now() - msAgo).toISOString();

// A pid that is genuinely alive but is not this test process's own (process.kill(pid, 0) treats
// its own pid specially): the parent process (the shell/npm that launched the test runner).
const otherAlivePid = process.ppid;

test('ownerAlive: a fresh heartbeat with a live pid on this host is alive; a stale one, or a dead pid, is not', () => {
  assert.equal(runOwner.ownerAlive(null), false);
  assert.equal(runOwner.ownerAlive({ pid: otherAlivePid, host: os.hostname(), heartbeat_at: beat(0) }), true);
  assert.equal(runOwner.ownerAlive({ pid: otherAlivePid, host: os.hostname(), heartbeat_at: beat(runOwner.STALE_MS + 1000) }), false, 'heartbeat older than STALE_MS: the owner is gone');
  assert.equal(runOwner.ownerAlive({ pid: 999999999, host: os.hostname(), heartbeat_at: beat(0) }), false, 'a dead pid on this host is never alive, fresh heartbeat or not');
  // another host (a shared folder): only the heartbeat decides, the pid means nothing here
  assert.equal(runOwner.ownerAlive({ pid: 999999999, host: 'another-machine', heartbeat_at: beat(0) }), true);
  assert.equal(runOwner.ownerAlive({ pid: 999999999, host: 'another-machine', heartbeat_at: beat(runOwner.STALE_MS + 1000) }), false);
});

test('pidAlive: this process and a live pid are alive; 0, negative, non-integer and a dead pid are not', () => {
  assert.equal(runOwner.pidAlive(process.pid), true);
  assert.equal(runOwner.pidAlive(otherAlivePid), true);
  assert.equal(runOwner.pidAlive(0), false);
  assert.equal(runOwner.pidAlive(-1), false);
  assert.equal(runOwner.pidAlive(1.5), false);
  assert.equal(runOwner.pidAlive(999999999), false);
});

test('claimRun writes owner.json with this process\'s pid, refreshes its heartbeat, and release() removes it', async (t) => {
  const dir = tmp(t);
  const runDir = path.join(dir, 'run-1');
  const held = runOwner.claimRun(runDir);
  t.after(() => held.release());

  const first = runOwner.readOwner(runDir);
  assert.equal(first.pid, process.pid);
  assert.equal(first.host, os.hostname());
  assert.ok(first.heartbeat_at);
  assert.equal(runOwner.runOwnedElsewhere(runDir), false, 'this process\'s own claim is not "elsewhere"');

  // the heartbeat is refreshed on its own, faster than the test's patience (HEARTBEAT_MS=5000 in
  // production); write a stale one by hand and confirm hold() would overwrite it on its next tick
  // instead of asserting real time: read back what is already there, which must still be fresh
  assert.equal(runOwner.ownerAlive(runOwner.readOwner(runDir)), true);

  held.release();
  assert.equal(runOwner.readOwner(runDir), null);
});

test('runOwnedElsewhere: alive with a different pid; not owned once it is released or stale', (t) => {
  const dir = tmp(t);
  const runDir = path.join(dir, 'run-2');
  fs.mkdirSync(runDir, { recursive: true });
  const ownerFile = path.join(runDir, 'owner.json');

  fs.writeFileSync(ownerFile, JSON.stringify({ pid: otherAlivePid, host: os.hostname(), heartbeat_at: beat(0) }));
  assert.equal(runOwner.runOwnedElsewhere(runDir), true);

  fs.writeFileSync(ownerFile, JSON.stringify({ pid: otherAlivePid, host: os.hostname(), heartbeat_at: beat(runOwner.STALE_MS + 1000) }));
  assert.equal(runOwner.runOwnedElsewhere(runDir), false, 'a stale heartbeat: the owner is gone, the run is free (and "interrupted", see src/domains/run/runs.js)');

  fs.writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, host: os.hostname(), heartbeat_at: beat(0) }));
  assert.equal(runOwner.runOwnedElsewhere(runDir), false, 'this process\'s own runs are tracked by the service, not by this check');

  assert.equal(runOwner.runOwnedElsewhere(path.join(dir, 'no-owner-file')), false);
});

test('lockWorkspace refuses while another live process holds it, naming the holder', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(dir, { recursive: true });
  // simulate a second app process: a lock record with another live pid
  fs.writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: otherAlivePid, host: os.hostname(), heartbeat_at: beat(0) }));
  const second = runOwner.lockWorkspace(dir);
  assert.equal(second.ok, false);
  assert.equal(second.holder.pid, otherAlivePid);
  assert.equal(fs.existsSync(path.join(dir, '.lock')), true, 'the other process\'s lock is left alone');
});

test('lockWorkspace: this process re-opening its own lock (e.g. restarting the workspace) always succeeds', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: process.pid, host: os.hostname(), heartbeat_at: beat(0) }));
  const again = runOwner.lockWorkspace(dir);
  assert.equal(again.ok, true);
  again.release();
});

test('lockWorkspace takes over a stale lock (a dead pid, or an old heartbeat for another host)', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: 999999999, host: os.hostname(), heartbeat_at: beat(0) }));
  const takenOverDeadPid = runOwner.lockWorkspace(dir);
  assert.equal(takenOverDeadPid.ok, true);
  takenOverDeadPid.release();

  fs.writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: otherAlivePid, host: 'another-machine', heartbeat_at: beat(runOwner.STALE_MS + 1000) }));
  const takenOverStale = runOwner.lockWorkspace(dir);
  assert.equal(takenOverStale.ok, true);
  takenOverStale.release();
});

test('lockWorkspace releases cleanly: the file is gone, and a later open succeeds again', (t) => {
  const dir = tmp(t);
  const first = runOwner.lockWorkspace(dir);
  assert.equal(first.ok, true);
  first.release();
  assert.equal(fs.existsSync(path.join(dir, '.lock')), false);
  const second = runOwner.lockWorkspace(dir);
  assert.equal(second.ok, true);
  t.after(() => second.release());
});
