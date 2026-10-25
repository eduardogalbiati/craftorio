// #445 the queue's pause by a failure, at the storage seam (src/domains/backlog/backlog.js readQueue / setPaused /
// pauseForFailure, src/store.js's index): the owner's legacy file (an English sentence over an empty
// queue) is not paused any more when read, a pause by hand stays, and the structured `reason` survives
// the SQLite index (a reopen, the import of a .queue.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backlog = require('../../src/domains/backlog/backlog');
const { openStore } = require('../../src/store');
const { setupWorkspace } = require('../../src/workspace');

const LEGACY = '#330 failed: resume to start the next issues.';
const item = (number) => ({ number, url: `u${number}`, title: `T${number}`, body: '', workflow: 'sd.yaml', inputs: {}, addedAt: '2026-10-16T00:00:00.000Z' });

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-pause-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const backlogDir = path.join(dir, 'backlog');
  fs.mkdirSync(backlogDir, { recursive: true });
  return backlogDir;
}
const writeFile = (dir, queue) => fs.writeFileSync(path.join(dir, 'p.queue.json'), JSON.stringify({ inputs: {}, skipped: [], ...queue }));

// a workspace with its index open; the store is closed before the folder goes (#76: EPERM on Windows)
function indexed(t) {
  const ws = setupWorkspace(fs.mkdtempSync(path.join(os.tmpdir(), 'queue-pause-ws-')), { persist: false });
  const stores = [];
  t.after(() => {
    for (const s of stores) { try { s.close(); } catch { /* already closed */ } }
    fs.rmSync(ws.root, { recursive: true, force: true });
  });
  const open = () => { const s = openStore(ws); stores.push(s); return s; };
  return { ws, open };
}

test('#445 the owner\'s legacy queue file (English sentence, no items) reads as not paused, with no error', (t) => {
  const dir = tmp(t);
  writeFile(dir, { paused: true, error: LEGACY, items: [] });
  const q = backlog.readQueue(dir, 'p');
  assert.deepEqual([q.paused, q.error, q.items.length], [false, null, 0]);
});

test('#445 a legacy failure pause over issues still waiting stays paused (resume is still the owner\'s)', (t) => {
  const dir = tmp(t);
  writeFile(dir, { paused: true, error: LEGACY, items: [item(331)] });
  const q = backlog.readQueue(dir, 'p');
  assert.deepEqual([q.paused, q.error], [true, LEGACY]);
});

test('#445 the next write of the legacy file drops the stale pause from the file too', (t) => {
  const dir = tmp(t);
  writeFile(dir, { paused: true, error: LEGACY, items: [] });
  backlog.unqueue(dir, 'p', 999); // any change of the queue (here: taking out an issue it does not hold)
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'p.queue.json'), 'utf8'));
  assert.deepEqual([onDisk.paused, onDisk.error], [false, null]);
});

test('#445 a pause by hand (a sentence that is not a failure) stays on an empty queue', (t) => {
  const dir = tmp(t);
  backlog.setPaused(dir, 'p', true, 'stopped by the owner');
  const q = backlog.readQueue(dir, 'p');
  assert.deepEqual([q.paused, q.error], [true, 'stopped by the owner']);
});

test('#445 a failure pause with a waiting issue keeps its reason in the index across a reopen', (t) => {
  const { ws, open } = indexed(t);
  open();
  backlog.enqueue(ws.backlog, 'p', { issues: [{ number: 331, url: 'u331', title: 'T331', body: '' }], workflow: 'sd.yaml' });
  backlog.pauseForFailure(ws.backlog, 'p', [330]);
  const row = open().readQueue('p'); // the index's own read, not the file
  assert.equal(row.paused, true);
  assert.equal(row.reason?.key, 'backlog.queue_failed');
  assert.deepEqual(Array.from(row.reason?.values?.issues || []), [330]);
  assert.equal(row.error, null, 'the reason is not mistaken for an error sentence');
  const q = backlog.readQueue(ws.backlog, 'p');
  assert.deepEqual([q.paused, q.reason?.key], [true, 'backlog.queue_failed']);
});

test('#445 resuming a failure pause drops its reason from the index', (t) => {
  const { ws, open } = indexed(t);
  open();
  backlog.enqueue(ws.backlog, 'p', { issues: [{ number: 331, url: 'u331', title: 'T331', body: '' }], workflow: 'sd.yaml' });
  backlog.pauseForFailure(ws.backlog, 'p', [330]);
  backlog.setPaused(ws.backlog, 'p', false);
  const row = open().readQueue('p');
  assert.deepEqual([row.paused, row.error, row.reason ?? null], [false, null, null]);
});

test('#445 a .queue.json with a structured reason is imported into the index with it', (t) => {
  const { ws, open } = indexed(t);
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, 'p.queue.json'), JSON.stringify({
    paused: true, error: null, reason: { key: 'backlog.queue_failed', values: { issues: [330] } }, inputs: {}, skipped: [], items: [item(331)],
  }));
  const row = open().readQueue('p');
  assert.equal(row.paused, true);
  assert.equal(row.reason?.key, 'backlog.queue_failed');
  assert.deepEqual(Array.from(row.reason?.values?.issues || []), [330]);
});
