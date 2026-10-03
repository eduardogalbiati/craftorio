// The workspace's SQLite index (<workspace>/index.db, #76), next to the files and never instead of
// them: node:sqlite (built into Node 24 / Electron 44, no dependency), WAL mode, a busy timeout and a
// schema versioned with migrations (PRAGMA user_version). Only the service opens it (one handle per
// workspace; the engine emits, the service writes); the renderer and the browser UI reach it through
// the service's channels. What lives here and why: docs/agents/storage.md.
//
// Tables:
//   runs           a rebuildable cache of runs/<id>/ (src/runs.js listRuns/indexRun): one row per run
//                  with its list fields, the readRun object (`info`), its summary.json and the file
//                  signature it was read at; a row whose signature no longer matches is read again.
//                  Deleting index.db loses nothing: the next listing rebuilds it.
//   run_files      the files each run's own commits changed (src/repo-performance.js, Analytics'
//                  Repository performance and the Product Owner's conflict map), keyed by the commit
//                  range they were read from (commits never change); rebuilt from git when missing.
//   run_artifacts, artifact_paths
//                  each run's artifact list (src/run-artifacts.js, #200) with the size + mtime it was
//                  read at and how far its events.jsonl was read; artifact_paths maps a project copy's
//                  path to the runs that saved it. Rebuilt from runs/ when missing.
//   queues, queue_items, queue_claims
//                  the Backlog queues (src/backlog.js): every change is one IMMEDIATE transaction, and
//                  a dispatcher claims the item it starts so two never take the same issue. The
//                  backlog/<id>.queue.json files become a readable snapshot written under that lock;
//                  a project with no row yet (a new or deleted index.db) is imported from its file.
//   gates          a row per approval.requested, closed on approval.resolved or the run's end; the
//                  open gates of runs that did not survive a restart become `interrupted`.
//   notifications  every notice (run started/finished/failed, gate waiting, CLI session waiting, push
//                  merge conflict...),
//                  for the notification center; kept notificationRetentionDays days (settings).
//
// `openStore(ws)` opens (or reopens) the store of a workspace layout; `storeFor(dir)` finds the open
// store whose runs or backlog folder is `dir`, so src/runs.js and src/backlog.js use it when the
// service has one and fall back to the plain files otherwise (scripts/run.js, unit tests).

const fs = require('fs');
const path = require('path');

// loaded on first use: a process that never opens a store (scripts/run.js, unit tests) never loads it
let sqlite = null;
const databaseClass = () => (sqlite ??= require('node:sqlite')).DatabaseSync;

// Bump when the readRun object (`runs.info`) changes shape: the runs cache is emptied at the next
// start and rebuilt from runs/.
const RUNS_CACHE = 4;
// A claim older than this belongs to a dispatcher that died: its item can be taken again.
const CLAIM_TTL_MS = 10 * 60 * 1000;
const BUSY_TIMEOUT_MS = 5000;

// One entry per schema version, applied in order inside a transaction.
const MIGRATIONS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
   CREATE TABLE runs (
     run_id TEXT PRIMARY KEY, workflow TEXT, version TEXT, project_id TEXT, issues TEXT, status TEXT,
     mock INTEGER NOT NULL DEFAULT 0, started_at TEXT, finished_at TEXT, duration_ms INTEGER,
     tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, pr_url TEXT, resumed_from TEXT,
     sig TEXT, info TEXT NOT NULL, summary TEXT, indexed_at TEXT NOT NULL);
   CREATE INDEX runs_started ON runs(started_at);
   CREATE INDEX runs_project ON runs(project_id);
   CREATE TABLE queues (
     project_id TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0, error TEXT,
     inputs TEXT NOT NULL DEFAULT '{}', skipped TEXT NOT NULL DEFAULT '[]');
   CREATE TABLE queue_items (
     project_id TEXT NOT NULL, position INTEGER NOT NULL, number INTEGER, added_at TEXT, item TEXT NOT NULL,
     PRIMARY KEY (project_id, position));
   CREATE TABLE queue_claims (
     project_id TEXT NOT NULL, number INTEGER NOT NULL, owner TEXT, claimed_at TEXT NOT NULL,
     PRIMARY KEY (project_id, number));
   CREATE TABLE gates (
     run_id TEXT NOT NULL, approval_id TEXT NOT NULL, step_id TEXT, message TEXT, choices TEXT, gate TEXT,
     requested_at TEXT, state TEXT NOT NULL DEFAULT 'open', closed_at TEXT,
     PRIMARY KEY (run_id, approval_id));
   CREATE INDEX gates_state ON gates(state);
   CREATE TABLE notifications (
     id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, kind TEXT, run_id TEXT, project_id TEXT,
     issue TEXT, title TEXT NOT NULL, body TEXT, target TEXT, created_at TEXT NOT NULL, read_at TEXT);
   CREATE INDEX notifications_created ON notifications(created_at);`,
  `CREATE TABLE run_files (run_id TEXT PRIMARY KEY, range_key TEXT NOT NULL, files TEXT NOT NULL);`,
  `CREATE TABLE run_artifacts (
     run_id TEXT PRIMARY KEY, quick TEXT NOT NULL, finished INTEGER NOT NULL DEFAULT 0, events_offset INTEGER NOT NULL DEFAULT 0,
     saved TEXT NOT NULL, files TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, images INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE artifact_paths (path TEXT NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY (path, run_id));
   CREATE INDEX artifact_paths_run ON artifact_paths(run_id);`,
];

const open = new Map(); // workspace root → store
const norm = (p) => {
  const r = path.resolve(String(p));
  return process.platform === 'win32' ? r.toLowerCase() : r;
};
const json = (v) => (v === undefined ? null : JSON.stringify(v));
const parse = (s, fallback = null) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};
const now = () => new Date().toISOString();

/** The open store whose workspace has `dir` as its runs or backlog folder, or null. */
function storeFor(dir) {
  if (!dir) return null;
  const key = norm(dir);
  for (const s of open.values()) if (norm(s.ws.runs) === key || norm(s.ws.backlog) === key) return s;
  return null;
}

/** Opens the index of a workspace layout (src/workspace.js layout), migrating it to the current schema. */
function openStore(ws) {
  const prev = open.get(norm(ws.root));
  // two services of one process on the same workspace share the handle; the last close() closes it
  if (prev) { prev.refs++; return prev; }
  const Database = databaseClass();
  const db = new Database(ws.index || path.join(ws.root, 'index.db'));
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');

  let depth = 0;
  // fn inside one IMMEDIATE transaction (the write lock is taken at BEGIN, so two processes never
  // read the same state and both write); nested calls join the outer transaction
  function transaction(fn) {
    if (depth) return fn();
    db.exec('BEGIN IMMEDIATE');
    depth++;
    try {
      const out = fn();
      depth--;
      db.exec('COMMIT');
      return out;
    } catch (e) {
      depth--;
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    }
  }

  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > MIGRATIONS.length) {
    db.close();
    throw new Error(`index.db is from a newer version of the app (schema ${version}, this one knows ${MIGRATIONS.length}). Delete it to rebuild it.`);
  }
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }

  const getMeta = (key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  const setMeta = (key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  // the runs cache from another readRun shape: emptied, rebuilt by the next listing
  if (getMeta('runs_cache') !== String(RUNS_CACHE)) {
    transaction(() => {
      db.exec('DELETE FROM runs');
      setMeta('runs_cache', RUNS_CACHE);
    });
  }

  // ---- runs (a cache of runs/<id>/) ------------------------------------------------------------
  const runRow = (r) => ({ runId: r.run_id, sig: r.sig, info: parse(r.info), summary: r.summary });
  const store = {
    ws,
    path: ws.index || path.join(ws.root, 'index.db'),
    transaction,

    /** run id → { sig, info } of every indexed run. */
    runEntries() {
      return new Map(db.prepare('SELECT run_id, sig, info FROM runs').all().map((r) => [r.run_id, runRow(r)]));
    },
    /** Indexes one run: `info` is runs.readRun's object, `summary` the text of its summary.json (or null). */
    putRun(info, sig, summary = null) {
      db.prepare(`INSERT INTO runs (run_id, workflow, version, project_id, issues, status, mock, started_at, finished_at,
          duration_ms, tokens, cost_usd, pr_url, resumed_from, sig, info, summary, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET workflow = excluded.workflow, version = excluded.version, project_id = excluded.project_id,
          issues = excluded.issues, status = excluded.status, mock = excluded.mock, started_at = excluded.started_at,
          finished_at = excluded.finished_at, duration_ms = excluded.duration_ms, tokens = excluded.tokens, cost_usd = excluded.cost_usd,
          pr_url = excluded.pr_url, resumed_from = excluded.resumed_from, sig = excluded.sig, info = excluded.info,
          summary = excluded.summary, indexed_at = excluded.indexed_at`).run(
        info.runId, info.workflow ?? null, info.version ?? null, info.projectId ?? null, json(info.issues ?? null), info.status ?? null,
        info.mock ? 1 : 0, info.startedAt ?? null, info.finishedAt ?? null, Math.round(info.durationMs || 0), info.tokens?.total || 0,
        info.costUsd || 0, info.pr?.url ?? null, info.resumedFrom ?? null, sig ?? null, JSON.stringify(info), summary, now());
    },
    /** { sig, info } of one indexed run, or null. */
    runEntry(runId) {
      const r = db.prepare('SELECT run_id, sig, info FROM runs WHERE run_id = ?').get(String(runId));
      return r ? runRow(r) : null;
    },
    deleteRuns(ids) {
      const del = db.prepare('DELETE FROM runs WHERE run_id = ?');
      const delArts = db.prepare('DELETE FROM run_artifacts WHERE run_id = ?');
      const delPaths = db.prepare('DELETE FROM artifact_paths WHERE run_id = ?');
      transaction(() => { for (const id of ids) { del.run(id); delArts.run(id); delPaths.run(id); } });
    },
    clearRuns() { db.exec('DELETE FROM runs; DELETE FROM run_artifacts; DELETE FROM artifact_paths;'); },
    /** The indexed list rows (no `info`), newest first: what Analytics and lists can query without the files. */
    runRows({ projectId } = {}) {
      const rows = projectId ? db.prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC').all(projectId)
        : db.prepare('SELECT * FROM runs ORDER BY started_at DESC').all();
      return rows.map((r) => ({
        runId: r.run_id, workflow: r.workflow, version: r.version, projectId: r.project_id, issues: parse(r.issues),
        status: r.status, mock: !!r.mock, startedAt: r.started_at, finishedAt: r.finished_at, durationMs: r.duration_ms,
        tokens: r.tokens, costUsd: r.cost_usd, prUrl: r.pr_url, resumedFrom: r.resumed_from,
      }));
    },
    /** The summary.json of every indexed finished run (the shape src/usage.js reads), `mock: false` = real runs only. */
    runSummaries({ mock } = {}) {
      const rows = db.prepare('SELECT summary, mock FROM runs WHERE summary IS NOT NULL').all();
      return rows.filter((r) => mock === undefined || !!r.mock === mock).map((r) => parse(r.summary)).filter(Boolean);
    },
    /** The files a run's commits changed ({ key, files }, src/repo-performance.js), or null. */
    runFiles(runId) {
      const r = db.prepare('SELECT range_key, files FROM run_files WHERE run_id = ?').get(String(runId));
      return r ? { key: r.range_key, files: parse(r.files, []) } : null;
    },
    putRunFiles(runId, key, files) {
      db.prepare(`INSERT INTO run_files (run_id, range_key, files) VALUES (?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET range_key = excluded.range_key, files = excluded.files`).run(String(runId), String(key), JSON.stringify(files || []));
    },
    /** A run's cached artifact index (src/run-artifacts.js): { quick, finished, offset, saved, files, count, images }, or null. */
    runArtifacts(runId) {
      const r = db.prepare('SELECT * FROM run_artifacts WHERE run_id = ?').get(String(runId));
      return r ? { quick: r.quick, finished: !!r.finished, offset: r.events_offset, saved: parse(r.saved, []), files: parse(r.files, []), count: r.count, images: r.images } : null;
    },
    /** Stores a run's artifact index and the paths of its project copies (`norm` paths, for artifactRunIds). */
    putRunArtifacts(runId, e) {
      const id = String(runId);
      transaction(() => {
        db.prepare(`INSERT INTO run_artifacts (run_id, quick, finished, events_offset, saved, files, count, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET quick = excluded.quick, finished = excluded.finished, events_offset = excluded.events_offset,
            saved = excluded.saved, files = excluded.files, count = excluded.count, images = excluded.images`).run(
          id, String(e.quick), e.finished ? 1 : 0, Math.max(0, Math.floor(e.offset || 0)), JSON.stringify(e.saved || []), JSON.stringify(e.files || []), e.count || 0, e.images || 0);
        db.prepare('DELETE FROM artifact_paths WHERE run_id = ?').run(id);
        const add = db.prepare('INSERT OR IGNORE INTO artifact_paths (path, run_id) VALUES (?, ?)');
        for (const f of e.files || []) if (f.location === 'external') add.run(norm(f.path), id);
      });
    },
    /** The runs whose artifact index lists `file` as a project copy. */
    artifactRunIds(file) {
      return db.prepare('SELECT run_id FROM artifact_paths WHERE path = ? ORDER BY run_id DESC').all(norm(file)).map((r) => r.run_id);
    },

    // ---- Backlog queues ------------------------------------------------------------------------
    /** A project's queue ({ paused, error, inputs, items, skipped }), or null when it has none. */
    readQueue(projectId) {
      const q = db.prepare('SELECT * FROM queues WHERE project_id = ?').get(String(projectId));
      if (!q) return null;
      const items = db.prepare('SELECT item FROM queue_items WHERE project_id = ? ORDER BY position').all(String(projectId)).map((r) => parse(r.item)).filter(Boolean);
      return { paused: !!q.paused, error: q.error ?? null, inputs: parse(q.inputs, {}), items, skipped: parse(q.skipped, []) };
    },
    writeQueue(projectId, queue) {
      const id = String(projectId);
      transaction(() => {
        db.prepare(`INSERT INTO queues (project_id, paused, error, inputs, skipped) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(project_id) DO UPDATE SET paused = excluded.paused, error = excluded.error, inputs = excluded.inputs, skipped = excluded.skipped`)
          .run(id, queue.paused ? 1 : 0, queue.error ?? null, JSON.stringify(queue.inputs || {}), JSON.stringify(queue.skipped || []));
        db.prepare('DELETE FROM queue_items WHERE project_id = ?').run(id);
        const add = db.prepare('INSERT INTO queue_items (project_id, position, number, added_at, item) VALUES (?, ?, ?, ?, ?)');
        (queue.items || []).forEach((item, i) => add.run(id, i, Number.isFinite(+item.number) ? +item.number : null, item.addedAt ?? null, JSON.stringify(item)));
        // a claim whose item left the queue (started, unqueued, skipped) is over
        db.prepare('DELETE FROM queue_claims WHERE project_id = ? AND number NOT IN (SELECT number FROM queue_items WHERE project_id = ? AND number IS NOT NULL)').run(id, id);
      });
      return queue;
    },
    queuedProjects() {
      return db.prepare('SELECT project_id FROM queues ORDER BY project_id').all().map((r) => r.project_id);
    },
    /** Numbers of the items of a project that a dispatcher is starting (claims younger than CLAIM_TTL_MS). */
    claimedNumbers(projectId) {
      const since = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
      return new Set(db.prepare('SELECT number FROM queue_claims WHERE project_id = ? AND claimed_at > ?').all(String(projectId), since).map((r) => r.number));
    },
    claim(projectId, number, owner = String(process.pid)) {
      db.prepare(`INSERT INTO queue_claims (project_id, number, owner, claimed_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id, number) DO UPDATE SET owner = excluded.owner, claimed_at = excluded.claimed_at`).run(String(projectId), +number, owner, now());
    },
    release(projectId, number) {
      db.prepare('DELETE FROM queue_claims WHERE project_id = ? AND number = ?').run(String(projectId), +number);
    },

    // ---- pending gates -------------------------------------------------------------------------
    /** Records a gate a run waits at (the engine's gate object: approval_id, step_id, message, choices, requested_at...). */
    openGate(runId, gate) {
      db.prepare(`INSERT INTO gates (run_id, approval_id, step_id, message, choices, gate, requested_at, state, closed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NULL)
        ON CONFLICT(run_id, approval_id) DO UPDATE SET step_id = excluded.step_id, message = excluded.message, choices = excluded.choices,
          gate = excluded.gate, requested_at = excluded.requested_at, state = 'open', closed_at = NULL`).run(
        String(runId), String(gate.approval_id), gate.step_id ?? null, gate.message ?? null, json(gate.choices ?? null),
        JSON.stringify(gate), gate.requested_at ?? now());
    },
    closeGate(runId, approvalId, state = 'resolved') {
      db.prepare("UPDATE gates SET state = ?, closed_at = ? WHERE run_id = ? AND approval_id = ? AND state = 'open'").run(state, now(), String(runId), String(approvalId));
    },
    closeRunGates(runId, state = 'closed') {
      db.prepare("UPDATE gates SET state = ?, closed_at = ? WHERE run_id = ? AND state = 'open'").run(state, now(), String(runId));
    },
    /** The gates a run waits at, as the engine described them, oldest first. */
    openGates(runId) {
      return db.prepare("SELECT gate FROM gates WHERE run_id = ? AND state = 'open' ORDER BY requested_at").all(String(runId)).map((r) => parse(r.gate)).filter(Boolean);
    },
    /**
     * Marks `interrupted` the open gates of every run not in `liveRunIds` (at startup: their runs did
     * not survive, so nobody can answer them). Returns them ({ runId, approvalId, stepId, message, requestedAt }).
     */
    interruptGates(liveRunIds = []) {
      const live = new Set([...liveRunIds].map(String));
      return transaction(() => {
        const rows = db.prepare("SELECT run_id, approval_id, step_id, message, requested_at FROM gates WHERE state = 'open'").all().filter((r) => !live.has(r.run_id));
        const upd = db.prepare("UPDATE gates SET state = 'interrupted', closed_at = ? WHERE run_id = ? AND approval_id = ?");
        for (const r of rows) upd.run(now(), r.run_id, r.approval_id);
        return rows.map((r) => ({ runId: r.run_id, approvalId: r.approval_id, stepId: r.step_id, message: r.message, requestedAt: r.requested_at }));
      });
    },
    /** Gates by state ('open' | 'resolved' | 'closed' | 'interrupted'), newest first. */
    gates({ state, limit = 100 } = {}) {
      const rows = state ? db.prepare('SELECT * FROM gates WHERE state = ? ORDER BY requested_at DESC LIMIT ?').all(state, limit)
        : db.prepare('SELECT * FROM gates ORDER BY requested_at DESC LIMIT ?').all(limit);
      return rows.map((r) => ({
        runId: r.run_id, approvalId: r.approval_id, stepId: r.step_id, message: r.message, choices: parse(r.choices),
        requestedAt: r.requested_at, state: r.state, closedAt: r.closed_at,
      }));
    },

    // ---- notifications -------------------------------------------------------------------------
    /** Records a notice ({ kind, event, title, body, target } of src/notifications.js) plus its run/project/issue. */
    addNotification({ type, kind = null, runId = null, projectId = null, issue = null, title, body = '', target = null }) {
      const createdAt = now();
      const r = db.prepare(`INSERT INTO notifications (type, kind, run_id, project_id, issue, title, body, target, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(String(type), kind, runId, projectId, issue == null ? null : String(issue), String(title || ''), String(body || ''), json(target), createdAt);
      return { id: Number(r.lastInsertRowid), type: String(type), kind, runId, projectId, issue: issue == null ? null : String(issue), title: String(title || ''), body: String(body || ''), target, createdAt, readAt: null };
    },
    notifications({ limit = 100, unread = false } = {}) {
      const rows = db.prepare(`SELECT * FROM notifications ${unread ? 'WHERE read_at IS NULL' : ''} ORDER BY id DESC LIMIT ?`).all(Math.max(1, Math.floor(+limit) || 100));
      return rows.map((r) => ({
        id: r.id, type: r.type, kind: r.kind, runId: r.run_id, projectId: r.project_id, issue: r.issue, title: r.title,
        body: r.body, target: parse(r.target), createdAt: r.created_at, readAt: r.read_at,
      }));
    },
    unreadCount() {
      return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL').get().n;
    },
    /** Marks notifications as read: the given ids, or every unread one when `ids` is empty or absent. */
    markRead(ids) {
      const at = now();
      if (!ids?.length) return Number(db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(at).changes);
      const upd = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL');
      return transaction(() => ids.reduce((n, id) => n + Number(upd.run(at, +id).changes), 0));
    },
    /** Deletes the notifications older than `days` days (0 or less: keeps everything). */
    pruneNotifications(days) {
      if (!(+days > 0)) return 0;
      const before = new Date(Date.now() - +days * 86400000).toISOString();
      return Number(db.prepare('DELETE FROM notifications WHERE created_at < ?').run(before).changes);
    },

    refs: 1,
    close() {
      if (--store.refs > 0) return;
      open.delete(norm(ws.root));
      try { db.close(); } catch { /* already closed */ }
    },
  };

  open.set(norm(ws.root), store);
  migrateQueueFiles(store);
  return store;
}

// The queue files (backlog/<id>.queue.json: written before the index, or the snapshot of a deleted
// index.db): a project the table does not have yet is imported; the table is the queue from then on.
function migrateQueueFiles(store) {
  let files = [];
  try { files = fs.readdirSync(store.ws.backlog).filter((f) => f.endsWith('.queue.json')); } catch { return; }
  for (const f of files) {
    const file = path.join(store.ws.backlog, f);
    const projectId = f.slice(0, -'.queue.json'.length);
    try {
      const q = JSON.parse(fs.readFileSync(file, 'utf8'));
      store.transaction(() => {
        if (!store.readQueue(projectId)) {
          store.writeQueue(projectId, { paused: !!q.paused, error: q.error ?? null, inputs: q.inputs || {}, items: q.items || [], skipped: q.skipped || [] });
        }
      });
    } catch (e) { console.error(`backlog queue import (${f}):`, e.message); }
  }
}

module.exports = {
  CLAIM_TTL_MS,
  MIGRATIONS,
  openStore,
  RUNS_CACHE,
  storeFor,
};
