# Storage rules

The rules every change to storage keeps.

## Rules

- **Only the service opens it** (`openIndex` in `packages/engine/service/areas/index-db.js`, on `setWorkspace`; closed in
  `shutdown`). The engine emits, the service writes (`indexEvent`, `notify`). The renderer and the
  browser UI use channels (`packages/engine/service/channels/storage.js`), never the file.
- `storeFor(dir)` lets `packages/engine/domains/run/runs.js` and `packages/engine/domains/backlog/backlog.js` use the open store and fall back to the
  plain files without one (`scripts/run.js`, unit tests, `node:sqlite` unavailable). Keep both paths.
- Every queue change goes through `updateQueue` (one `BEGIN IMMEDIATE` transaction). The dispatcher
  uses `claimQueued` (pick + claim atomically) and `releaseQueued` when a start fails; a claim expires
  after `CLAIM_TTL_MS` (a dead dispatcher).
- Schema change: append a migration to `MIGRATIONS`, never edit a shipped one. A change of the
  `readRun` object: bump `RUNS_CACHE`.
- Windows: an open `index.db` locks the workspace folder (EPERM on delete). Tests must call
  `service.shutdown()` (or `store.close()`) before removing a temporary workspace.
- Settings: `notificationRetentionDays` (0 = keep all), Settings › General › Index › **Rebuild index**
  (`index:rebuild`, empties the runs cache and lists `runs/` again).
