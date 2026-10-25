// The workspace's SQLite index (packages/engine/domains/workspace/store.js, #76): migrations, the runs cache, the Backlog queue
// tables (claims), pending gates and notifications. packages/engine/domains/run/runs.js and packages/engine/domains/backlog/backlog.js already cover
// reading/writing through the store from their own seams; this file tests the store's own API and
// its migration/restart/concurrency guarantees directly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { openStore, MIGRATIONS, RUNS_CACHE, CLAIM_TTL_MS } = require('../../domains/workspace/store');
const { setupWorkspace } = require('../../domains/workspace/workspace');
const runs = require('../../domains/run/runs');

// A fresh workspace. Removed by `closeAndRemove`, registered as the *last* `t.after`: an index.db
// still open when its folder is removed fails with EPERM on Windows (#76), and node:test runs
// `t.after` hooks in the order they were registered.
function tempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  return setupWorkspace(dir, { persist: false });
}
function closeAndRemove(t, ws, ...stores) {
  t.after(() => {
    for (const s of stores) { try { s.close(); } catch { /* already closed */ } }
    fs.rmSync(ws.root, { recursive: true, force: true });
  });
}

// A finished run folder (summary.json only, no events needed beyond workflow.started): deterministic
// fields so a rebuilt listing can be compared byte-for-byte with a live one.
function addRun(ws, id, { workflow = 'software-development', projectId = null, status = 'success', issues = null, prUrl = null, startedAt = '2026-09-27T10:00:00Z' } = {}) {
  const dir = path.join(ws.runs, id);
  fs.mkdirSync(dir, { recursive: true });
  const started = { ts: startedAt, type: 'workflow.started', workflow, version: '1.0.0', file: `${workflow}.yaml`, project_id: projectId, inputs: {}, mock: true };
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify(started)}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: id, workflow, project_id: projectId, status, mock: true, started_at: startedAt,
    finished_at: '2026-09-27T10:05:00Z', duration_ms: 300000, inputs: {}, sessions: [],
    ...(issues ? { issues } : {}), ...(prUrl ? { pr_url: prUrl, pr_number: 1 } : {}),
  }));
}

test('openStore creates index.db on an empty workspace with the current schema, usable right away', (t) => {
  const ws = tempWorkspace();
  assert.equal(fs.existsSync(ws.index), false);
  const store = openStore(ws);
  closeAndRemove(t, ws, store);
  assert.ok(fs.existsSync(ws.index));
  assert.deepEqual(store.runRows(), []);
  assert.equal(store.queuedProjects().length, 0);
  assert.deepEqual(store.gates(), []);
  assert.deepEqual(store.notifications(), []);
  assert.equal(store.unreadCount(), 0);
});

test('a schema from a newer version of the app refuses to open and tells the owner to delete index.db', (t) => {
  const ws = tempWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));
  const db = new DatabaseSync(ws.index);
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
  db.close();
  assert.throws(() => openStore(ws), new RegExp(`schema ${MIGRATIONS.length + 1}, this one knows ${MIGRATIONS.length}.*Delete it`));
});

test('putRun indexes exactly the fields the run lists and Usage/Analytics read', (t) => {
  const ws = tempWorkspace();
  const store = openStore(ws);
  closeAndRemove(t, ws, store);
  const info = {
    runId: 'r1', workflow: 'software-development', version: '1.2.0', projectId: 'proj-1',
    issues: [{ number: 7, url: 'https://x/7', title: 'T7' }], status: 'success', mock: false,
    startedAt: '2026-09-27T10:00:00Z', finishedAt: '2026-09-27T10:05:00Z', durationMs: 300000,
    tokens: { input: 100, output: 50, cache_read: 0, cache_write: 0, reasoning: 0, total: 150 },
    costUsd: 1.5, pr: { number: 9, url: 'https://x/pull/9' }, resumedFrom: 'r0',
  };
  store.putRun(info, 'sig-1', JSON.stringify({ run_id: 'r1' }));
  const [row] = store.runRows();
  assert.deepEqual(row, {
    runId: 'r1', workflow: 'software-development', version: '1.2.0', projectId: 'proj-1',
    issues: [{ number: 7, url: 'https://x/7', title: 'T7' }], status: 'success', mock: false,
    startedAt: '2026-09-27T10:00:00Z', finishedAt: '2026-09-27T10:05:00Z', durationMs: 300000,
    tokens: 150, costUsd: 1.5, prUrl: 'https://x/pull/9', resumedFrom: 'r0',
  });
  assert.deepEqual(store.runSummaries({ mock: false }), [{ run_id: 'r1' }]);
  assert.deepEqual(store.runSummaries({ mock: true }), []);
  const entries = store.runEntries();
  assert.equal(entries.get('r1').sig, 'sig-1');
  assert.equal(entries.get('r1').info.runId, 'r1');

  store.deleteRuns(['r1']);
  assert.deepEqual(store.runRows(), []);
});

// ---- A run's cached artifact index (packages/engine/domains/run/run-artifacts.js, #200) -------------------------------

test('MIGRATIONS has one entry per schema version; the current schema (usage_files, #389) is 5', () => {
  assert.equal(MIGRATIONS.length, 5);
});

test('putRunArtifacts writes run_artifacts and, for each external file, artifact_paths; artifactRunIds finds the run; deleteRuns and clearRuns remove both tables\' rows', (t) => {
  const ws = tempWorkspace();
  const store = openStore(ws);
  closeAndRemove(t, ws, store);
  const copy = path.join(os.tmpdir(), 'never-really-created.md'); // only the path is read here
  const entry = {
    quick: '10:1700000000000|1700000000000', finished: true, offset: 10, saved: [],
    files: [
      { path: path.join(ws.runs, 'r1', 'out.md'), rel: 'out.md', location: 'run' },
      { path: copy, rel: 'out.md', location: 'external' },
    ],
    count: 2, images: 0,
  };
  store.putRunArtifacts('r1', entry);
  assert.deepEqual(store.runArtifacts('r1'), entry);
  assert.deepEqual(store.artifactRunIds(copy), ['r1']);
  assert.deepEqual(store.artifactRunIds(path.join(ws.runs, 'r1', 'out.md')), [], 'a run-folder file is not recorded in artifact_paths: only its external (project) copies are');

  store.putRunArtifacts('r2', { ...entry, files: [{ path: copy, rel: 'out.md', location: 'external' }], count: 1 });
  assert.deepEqual(store.artifactRunIds(copy), ['r2', 'r1'], 'both runs recorded it as a project copy, newest run id first');

  store.deleteRuns(['r1']);
  assert.equal(store.runArtifacts('r1'), null);
  assert.deepEqual(store.artifactRunIds(copy), ['r2'], 'r1\'s row in artifact_paths went with it');

  store.clearRuns();
  assert.equal(store.runArtifacts('r2'), null);
  assert.deepEqual(store.artifactRunIds(copy), []);
});

test('closing and reopening the store (an already-migrated, existing workspace) keeps the runs cache, a queue, open gates and notifications', (t) => {
  const ws = tempWorkspace();
  const first = openStore(ws);
  first.putRun({ runId: 'r1', workflow: 'w', status: 'success', tokens: {} }, 'sig', null);
  first.writeQueue('proj', { paused: false, error: null, inputs: {}, items: [{ number: 1, url: 'u1', title: 'T1', body: '', addedAt: '2026-01-01T00:00:00.000Z' }], skipped: [] });
  first.openGate('run-a', { approval_id: 'ap1', step_id: 'review', message: 'Accept?', choices: null, requested_at: '2026-01-01T00:00:00.000Z' });
  const notice = first.addNotification({ type: 'run.started', kind: 'run', runId: 'run-a', title: 'Run started' });
  first.close();

  const reopened = openStore(ws); // a fresh connection, as the next app start would open
  closeAndRemove(t, ws, reopened);
  assert.equal(reopened.runEntries().get('r1').info.runId, 'r1');
  assert.deepEqual(reopened.readQueue('proj').items.map((i) => i.number), [1]);
  assert.deepEqual(reopened.openGates('run-a').map((g) => g.approval_id), ['ap1']);
  assert.deepEqual(reopened.notifications().map((n) => n.id), [notice.id]);
});

test('a bump of the runs cache (RUNS_CACHE) empties only the runs table at the next open', (t) => {
  const ws = tempWorkspace();
  const first = openStore(ws);
  first.putRun({ runId: 'r1', workflow: 'w', status: 'success', tokens: {} }, 'sig', null);
  first.writeQueue('proj', { paused: false, error: null, inputs: {}, items: [], skipped: [] });
  first.openGate('run-a', { approval_id: 'ap1', step_id: 'review', requested_at: '2026-01-01T00:00:00.000Z' });
  first.addNotification({ type: 'run.started', title: 'Run started' });
  first.close();

  // simulates a future build with a different `readRun` shape (RUNS_CACHE bumped)
  const db = new DatabaseSync(ws.index);
  db.prepare("UPDATE meta SET value = ? WHERE key = 'runs_cache'").run(String(RUNS_CACHE + 1));
  db.close();

  const reopened = openStore(ws);
  closeAndRemove(t, ws, reopened);
  assert.deepEqual(reopened.runRows(), [], 'the runs cache is emptied: the next listing rebuilds it from runs/');
  assert.ok(reopened.readQueue('proj'), 'the queue survives');
  assert.equal(reopened.openGates('run-a').length, 1, 'gates survive');
  assert.equal(reopened.notifications().length, 1, 'notifications survive');
});

test('the index rebuilt from runs/ matches the one built live, run by run', (t) => {
  const ws = tempWorkspace();
  const store = openStore(ws);
  closeAndRemove(t, ws, store);
  addRun(ws, 'r1', { projectId: 'proj', prUrl: 'https://x/pull/1', startedAt: '2026-09-27T09:00:00Z' });
  addRun(ws, 'r2', { workflow: 'ai-arena', status: 'failed', issues: [{ number: 3, url: 'https://x/3', title: 'T3' }], startedAt: '2026-09-27T10:00:00Z' });

  const live = runs.listRuns(ws.runs); // builds the cache run by run as a listing would
  assert.deepEqual(live.map((r) => r.runId), ['r2', 'r1']); // newest first

  runs.rebuildIndex(ws.runs); // clears the cache, then rebuilds it whole
  const rebuilt = runs.listRuns(ws.runs);
  assert.deepEqual(rebuilt, live);
});

test('deleting index.db and restarting opens an empty index, which the next listing rebuilds from runs/', (t) => {
  const ws = tempWorkspace();
  const first = openStore(ws);
  addRun(ws, 'r1');
  const before = runs.listRuns(ws.runs);
  assert.equal(before.length, 1);
  first.close();

  fs.rmSync(ws.index);
  fs.rmSync(`${ws.index}-wal`, { force: true });
  fs.rmSync(`${ws.index}-shm`, { force: true });

  const reopened = openStore(ws);
  closeAndRemove(t, ws, reopened);
  assert.deepEqual(reopened.runRows(), [], 'index.db was deleted: nothing indexed yet');
  const after = runs.listRuns(ws.runs); // the files were never touched: the rebuild finds the same run
  assert.deepEqual(after, before);
});

test('two separate connections to the index never claim the same queued item', (t) => {
  const ws = tempWorkspace();
  const a = openStore(ws);
  // a second, independent DatabaseSync connection to the same index.db: two services (two windows,
  // or a server and the app) opening the same workspace, as #49 and #76 describe. Each process has
  // its own require cache in real life; reloading the module here gets a second connection the same way.
  const storePath = require.resolve('../../domains/workspace/store');
  const original = require.cache[storePath];
  delete require.cache[storePath];
  const freshStoreModule = require('../../domains/workspace/store');
  require.cache[storePath] = original; // restore the shared instance for the rest of this file
  const b = freshStoreModule.openStore(ws);
  closeAndRemove(t, ws, a, b);

  a.writeQueue('proj', {
    paused: false, error: null, inputs: {}, skipped: [],
    items: [
      { number: 1, url: 'u1', title: 'T1', body: '', addedAt: '2026-01-01T00:00:00.000Z' },
      { number: 2, url: 'u2', title: 'T2', body: '', addedAt: '2026-01-01T00:00:01.000Z' },
    ],
  });

  // the read-then-claim a dispatcher does in one transaction before starting an item (backlog.claimQueued)
  const claimNext = (store) => store.transaction(() => {
    const claimed = store.claimedNumbers('proj');
    const item = store.readQueue('proj').items.find((i) => !claimed.has(i.number));
    if (item) store.claim('proj', item.number);
    return item || null;
  });

  const first = claimNext(a);
  const second = claimNext(b);
  assert.equal(first.number, 1);
  assert.equal(second.number, 2, 'B sees A\'s committed claim and takes the other item');
  assert.equal(claimNext(a), null, 'nothing left for either dispatcher');
  assert.equal(claimNext(b), null);
});

test('a claim older than CLAIM_TTL_MS belongs to a dead dispatcher: the item can be claimed again', (t) => {
  const ws = tempWorkspace();
  const store = openStore(ws);
  closeAndRemove(t, ws, store);
  store.writeQueue('proj', { paused: false, error: null, inputs: {}, skipped: [], items: [{ number: 1, url: 'u1', title: 'T1', body: '', addedAt: '2026-01-01T00:00:00.000Z' }] });
  store.claim('proj', 1);
  assert.deepEqual([...store.claimedNumbers('proj')], [1]);

  // backdates the claim past CLAIM_TTL_MS, as if its dispatcher died long ago
  const db = new DatabaseSync(ws.index);
  db.prepare('UPDATE queue_claims SET claimed_at = ? WHERE project_id = ? AND number = ?')
    .run(new Date(Date.now() - CLAIM_TTL_MS - 1000).toISOString(), 'proj', 1);
  db.close();

  assert.deepEqual([...store.claimedNumbers('proj')], [], 'an expired claim no longer blocks the item');
});

test('gates: open, resolve and the run\'s end close them; a run\'s gates are listed oldest first', (t) => {
  const ws = tempWorkspace();
  const store = openStore(ws);
  closeAndRemove(t, ws, store);
  store.openGate('run-a', { approval_id: 'ap1', step_id: 'review', message: 'Accept?', choices: ['yes', 'no'], requested_at: '2026-01-01T00:00:00.000Z' });
  store.openGate('run-a', { approval_id: 'ap2', step_id: 'review2', requested_at: '2026-01-01T00:00:01.000Z' });
  assert.deepEqual(store.openGates('run-a').map((g) => g.approval_id), ['ap1', 'ap2']);

  store.closeGate('run-a', 'ap1', 'resolved');
  assert.deepEqual(store.openGates('run-a').map((g) => g.approval_id), ['ap2']);
  assert.equal(store.gates({ state: 'resolved' })[0].approvalId, 'ap1');

  store.closeRunGates('run-a', 'closed');
  assert.deepEqual(store.openGates('run-a'), []);
  assert.equal(store.gates({ state: 'closed' })[0].approvalId, 'ap2');
});

test('interruptGates marks only the open gates of runs that did not survive, once, never a phantom gate', (t) => {
  const ws = tempWorkspace();
  const store = openStore(ws);
  closeAndRemove(t, ws, store);
  store.openGate('live-run', { approval_id: 'ap1', step_id: 'review', message: 'Accept?', requested_at: '2026-01-01T00:00:00.000Z' });
  store.openGate('dead-run', { approval_id: 'ap2', step_id: 'review', message: 'Merge?', requested_at: '2026-01-01T00:00:01.000Z' });

  const interrupted = store.interruptGates(['live-run']);
  assert.deepEqual(interrupted.map((g) => ({ runId: g.runId, approvalId: g.approvalId })), [{ runId: 'dead-run', approvalId: 'ap2' }]);
  assert.equal(store.openGates('live-run').length, 1, 'the live run\'s gate is left open');
  assert.equal(store.gates({ state: 'interrupted' })[0].approvalId, 'ap2');

  assert.deepEqual(store.interruptGates(['live-run']), [], 'already closed: not reported again as a phantom gate');
});

test('notifications: unread count, marking read (specific ids, already-read ids, or every unread one)', (t) => {
  const ws = tempWorkspace();
  const store = openStore(ws);
  closeAndRemove(t, ws, store);
  const a = store.addNotification({ type: 'run.started', title: 'Run A started' });
  const b = store.addNotification({ type: 'run.started', title: 'Run B started' });
  assert.equal(store.unreadCount(), 2);
  assert.deepEqual(store.notifications({ unread: true }).map((n) => n.id), [b.id, a.id]); // newest first

  assert.equal(store.markRead([a.id]), 1);
  assert.equal(store.unreadCount(), 1);
  assert.equal(store.markRead([a.id]), 0, 'already read: nothing changes');

  // ids omitted or empty marks every unread notification, not none
  assert.equal(store.markRead([]), 1);
  assert.equal(store.unreadCount(), 0);
});

test('pruneNotifications deletes what is older than N days; 0 or less keeps everything', (t) => {
  const ws = tempWorkspace();
  const store = openStore(ws);
  closeAndRemove(t, ws, store);
  const old = store.addNotification({ type: 'run.started', title: 'Old' });
  const recent = store.addNotification({ type: 'run.started', title: 'Recent' });
  const db = new DatabaseSync(ws.index);
  db.prepare('UPDATE notifications SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 40 * 86400000).toISOString(), old.id);
  db.close();

  assert.equal(store.pruneNotifications(0), 0, 'retention off: nothing deleted');
  assert.equal(store.notifications().length, 2);

  assert.equal(store.pruneNotifications(30), 1);
  assert.deepEqual(store.notifications().map((n) => n.id), [recent.id]);
});

test('a project\'s .queue.json is imported into the index once; a reopen never overwrites a row already there', (t) => {
  const ws = tempWorkspace();
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, 'proj.queue.json'), JSON.stringify({
    paused: false, error: null, inputs: {}, skipped: [],
    items: [{ number: 1, url: 'u1', title: 'From file', body: '', addedAt: '2026-01-01T00:00:00.000Z' }],
  }));

  const first = openStore(ws); // imports the file: the project has no row yet
  assert.deepEqual(first.readQueue('proj').items.map((i) => i.title), ['From file']);

  first.writeQueue('proj', { paused: false, error: null, inputs: {}, skipped: [], items: [] }); // started: now empty
  first.close();

  const reopened = openStore(ws); // the file still says one item, but the project already has a row
  closeAndRemove(t, ws, reopened);
  assert.deepEqual(reopened.readQueue('proj').items, [], 'the stale file is not imported again over the table');
});
