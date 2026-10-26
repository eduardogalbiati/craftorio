# The workspace index

What `<workspace>/index.db` adds over the files.

## `<workspace>/index.db`: what it adds

`node:sqlite` (`DatabaseSync`, built into Node 24 / Electron 44: no dependency, nothing to unpack in
the packaged app). WAL mode, `busy_timeout` 5 s, schema in `MIGRATIONS` (`PRAGMA user_version`).

| Table | What | Rebuilt from files? |
|---|---|---|
| `runs` | one row per run (list fields, the `readRun` object, `summary.json`, file signature) | yes: a stale or missing row is read again on the next listing; `RUNS_CACHE` bump empties it at startup |
| `queues`, `queue_items`, `queue_claims` | Backlog queues; claims of items a dispatcher is starting | yes: a project with no row is imported from `backlog/<id>.queue.json` (a snapshot written under the same lock) |
| `gates` | one row per `approval.requested`; `open` → `resolved` / `withdrawn` / `closed` (run end) / `interrupted` (startup) | no: history only, the live gates are in the engine |
| `notifications` | every notice (`type` = `<kind>.<event>`, run/project/issue, title, body, target, created/read at) | no: deleting `index.db` loses the history |
| `run_files` | the files each run's own commits changed, keyed by the commit range read (`packages/engine/domains/project/repo-performance.js`) | yes: read again from the clone's git history when missing |
| `run_artifacts`, `artifact_paths` | each run's artifact list (`packages/engine/domains/run/run-artifacts.js`, #200), keyed by `events.jsonl`'s and the run folder's size + mtime, with how far `events.jsonl` was read (a live run reads only what was appended); the project copies' paths → their runs (finding one artifact checks only its run) | yes: computed again from the run folder when missing |

Why: listing runs read every run folder on each call; the queue files were read-modify-written by
concurrent runs without a lock; gates and notifications lived only in memory.
