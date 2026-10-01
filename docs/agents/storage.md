# Storage: files and the SQLite index

Read this before touching run listings, the Backlog queue, pending gates, notifications or
`src/store.js` (#76).

## Files are the source of truth

- `runs/<id>/` (`events.jsonl`, `summary.json`, `meta.json`, `sessions/`, `handoffs/`, `decisions.tsv`),
  `backlog/<project>.json`, `projects/`, `agents/`, `skills/`, `workflows/`, `settings.json`,
  `active-run.json`: plain files, readable by the owner, agents and the supervisor, and portable.
- `runs/po-<project>-<stamp>/`: a Product Owner issue thread (#117: `conversation.jsonl`,
  `analysis/`, `attachments/`, `filed/`), not a run; it has no `events.jsonl` or `summary.json`,
  so run listings skip it.
- Never make the database the only copy of something a run produced.

## `<workspace>/index.db`: what it adds

`node:sqlite` (`DatabaseSync`, built into Node 24 / Electron 44: no dependency, nothing to unpack in
the packaged app). WAL mode, `busy_timeout` 5 s, schema in `MIGRATIONS` (`PRAGMA user_version`).

| Table | What | Rebuilt from files? |
|---|---|---|
| `runs` | one row per run (list fields, the `readRun` object, `summary.json`, file signature) | yes: a stale or missing row is read again on the next listing; `RUNS_CACHE` bump empties it at startup |
| `queues`, `queue_items`, `queue_claims` | Backlog queues; claims of items a dispatcher is starting | yes: a project with no row is imported from `backlog/<id>.queue.json` (a snapshot written under the same lock) |
| `gates` | one row per `approval.requested`; `open` → `resolved` / `withdrawn` / `closed` (run end) / `interrupted` (startup) | no: history only, the live gates are in the engine |
| `notifications` | every notice (`type` = `<kind>.<event>`, run/project/issue, title, body, target, created/read at) | no: deleting `index.db` loses the history |

Why: listing runs read every run folder on each call; the queue files were read-modify-written by
concurrent runs without a lock; gates and notifications lived only in memory.

## Rules

- **Only the service opens it** (`openIndex` in `src/service/index.js`, on `setWorkspace`; closed in
  `shutdown`). The engine emits, the service writes (`indexEvent`, `notify`). The renderer and the
  browser UI use channels (`src/service/channels/storage.js`), never the file.
- `storeFor(dir)` lets `src/runs.js` and `src/backlog.js` use the open store and fall back to the
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
