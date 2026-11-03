# Storage rules

The rules every change to storage keeps.

## Rules

- **Only the service opens it** (`openIndex` in `packages/engine/service/areas/index-db.js`, on `setWorkspace`; closed in
  `shutdown`). The engine emits, the service writes (`indexEvent`, `notify`). The renderer and the
  browser UI use channels (`packages/engine/service/channels/storage.js`), never the file.
- `storeFor(dir)` lets `packages/engine/domains/run/runs.js` and `packages/engine/domains/backlog/backlog.js` use the open store and fall back to the
  plain files without one (`scripts/run.js`, unit tests, `node:sqlite` unavailable). Keep both paths.
- Planned work lives in the roadmap only: every change goes through `writeRoadmap`
  (`packages/engine/domains/roadmap/roadmap.js`, saved with `packages/engine/domains/workspace/state-file.js`).
  The retired queue (#446) is never written: a queue an older version left (`queue_items` rows or a
  `backlog/<id>.queue.json`) is planned once by `moveLeftoverQueues` on `setWorkspace`, and only then
  are its rows (`dropLeftoverQueue`) and its file removed.
- Schema change: append a migration to `MIGRATIONS`, never edit a shipped one. A change of the
  `readRun` object: bump `RUNS_CACHE`.
- Windows: an open `index.db` locks the workspace folder (EPERM on delete). Tests must call
  `service.shutdown()` (or `store.close()`) before removing a temporary workspace.
- Settings: `notificationRetentionDays` (0 = keep all), Settings › General › Index › **Rebuild index**
  (`index:rebuild`, empties the runs cache and lists `runs/` again).
