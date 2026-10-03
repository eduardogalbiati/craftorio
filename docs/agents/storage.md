# Storage: files and the SQLite index

Read this before touching run listings, the Backlog queue, pending gates, notifications or
`src/store.js` (#76).

## Files are the source of truth

- `runs/<id>/` (`events.jsonl`, `summary.json`, `meta.json`, `sessions/`, `handoffs/`, `decisions.tsv`,
  `evidence/<step>/round-<n>/` screenshots with `evidence/manifest.json`, see engine.md,
  `attachments/<input>/` and `attachments/<gate>-feedback/` images given to agents (#129),
  `supervisor/attachments/` the images of questions about the run),
  `backlog/<project>.json`, `projects/`, `agents/`, `skills/`, `workflows/`, `pipelines/` (#135), `settings.json`,
  `active-run.json`: plain files, readable by the owner, agents and the supervisor, and portable.
- `runs/po-<project>-<stamp>/`: a Product Owner issue thread (#117: `conversation.jsonl`,
  `analysis/`, `attachments/`, `filed/`), not a run; it has no `events.jsonl` or `summary.json`,
  so run listings skip it.
- `oracle/` (#122, `src/oracle.js`): the Oracle's conversation `messages.jsonl` (kept across
  resets), `state.json` (provider session, context size, compaction due), `memory.md` (saved only
  by the owner), `session.md` (the current session's opening prompt), `handoffs/<stamp>-<reason>.md`,
  `usage.jsonl` (one line per real answer; added to Usage and the monthly budgets as one
  summary-like run per day, `usageRuns`) and `owner.json` (the one app process that answers, a
  run-owner heartbeat). Written by the service, never by the model.
- Never make the database the only copy of something a run produced.

## Issues: the git platform is the source of truth (#168)

GitHub/GitLab own the issues; everything local is a read-only replica, and issue changes are
never made locally nor flow back from local data to the platform. Only the explicit, previewed
owner actions write to the platform (Save to issue, create, close, epics: `src/backlog.js`,
`src/po-split.js`, `src/epics.js`).

- `backlog/<project>.json`: the sync cache (`syncedAt`, every issue with its PRs/MRs and epic),
  rewritten by each sync (`syncBacklog`); a save to an issue re-reads that one issue into it.
- Queue items (`<project>.queue.json` / the index) and roadmap items (`<project>.roadmap.json`)
  keep a **copy** of each issue (`number`, `url`, `title`, `body`, `labels`, `updatedAt`,
  `knownPullRequests`) so the screen and the Product Owner can show it. Each sync refreshes the
  copies of the items not started yet (`refreshQueuedCopies`, `roadmap.refreshCopies`); an item
  with a run keeps the text its run used.
- The roadmap file also holds the **Live roadmap** switch (#164, `src/live-roadmap.js`): `live`
  (true/false), `liveSince` and `liveBy` (when and who turned it on), `liveRefill` (the last refill:
  `status` refilling | added | empty | budget | failed | off, `at`, `added`, `costUsd`, `message`)
  and `liveRefills` (`[{ at, costUsd }]` of the last 24 h, for the daily budget). It is a file
  field like the state, so it survives a restart: the next dispatch refills a live roadmap whose
  last stage ended. Stop and Clear turn it off.
- Right before a queued or roadmap item starts, the service reads its issues again
  (`backlog.freshIssues`: `gh issue view` / `glab issue view`), builds the task from them, updates
  the item's copy, and skips issues found closed. If the read fails, the latest cache (or the copy,
  when it is newer) is used and said: a `log` warn "Issue #n read from the cache of HH:MM: …" and
  the issue recorded with `fallback` (the run card's "issue from cache" badge). Simulations never
  call the platform: they use the newest of the cache and the copy.
- `workflow.started.issues` records each issue's `updatedAt` as read, so a run can be traced to
  the issue text it used.

### Who writes the backlog files, and the change event (#204)

- Writers of `backlog/`: the sync (`<project>.json`, `<project>.local.json`), the queue snapshot
  (`writeQueueFile`), the roadmap (`writeRoadmap`, `src/roadmap.js`: the screen, the service's
  dispatch and live refill, the Oracle's `roadmap.stages`, the Product Owner), the refresh banner's
  dismissal (`<project>.refresh.json`), and anything outside the app (another window, a script).
  The roadmap and the queue go through `src/state-file.js` (temp file + rename, `.bak`).
- `src/service/areas/backlog-watch.js` watches the folder (one `fs.watch` per workspace, started by
  `setWorkspace`, closed on a switch and on `shutdown`) and pushes `backlog:changed { projectId,
  file: roadmap | queue | issues | local | refresh, watching: true }` once per file, 300 ms after
  its last write; a write that leaves the same mtime and size pushes nothing. A watcher error
  pushes `{ projectId: null, watching: false }` (`backlogWatching()` answers the same): the Backlog
  screen then polls every 5 s while its Roadmap tab is visible.
- The Backlog screen reloads the project's data on its project's event, unless the owner types in
  one of its fields, drags, or edits a roadmap item or a stage's note: the reload waits until they
  are done (an open Edit form shows "The roadmap changed. Reload"). Scroll and expanded rows stay.

## `<workspace>/index.db`: what it adds

`node:sqlite` (`DatabaseSync`, built into Node 24 / Electron 44: no dependency, nothing to unpack in
the packaged app). WAL mode, `busy_timeout` 5 s, schema in `MIGRATIONS` (`PRAGMA user_version`).

| Table | What | Rebuilt from files? |
|---|---|---|
| `runs` | one row per run (list fields, the `readRun` object, `summary.json`, file signature) | yes: a stale or missing row is read again on the next listing; `RUNS_CACHE` bump empties it at startup |
| `queues`, `queue_items`, `queue_claims` | Backlog queues; claims of items a dispatcher is starting | yes: a project with no row is imported from `backlog/<id>.queue.json` (a snapshot written under the same lock) |
| `gates` | one row per `approval.requested`; `open` → `resolved` / `withdrawn` / `closed` (run end) / `interrupted` (startup) | no: history only, the live gates are in the engine |
| `notifications` | every notice (`type` = `<kind>.<event>`, run/project/issue, title, body, target, created/read at) | no: deleting `index.db` loses the history |
| `run_files` | the files each run's own commits changed, keyed by the commit range read (`src/repo-performance.js`) | yes: read again from the clone's git history when missing |
| `run_artifacts`, `artifact_paths` | each run's artifact list (`src/run-artifacts.js`, #200), keyed by `events.jsonl`'s and the run folder's size + mtime, with how far `events.jsonl` was read (a live run reads only what was appended); the project copies' paths → their runs (finding one artifact checks only its run) | yes: computed again from the run folder when missing |

Why: listing runs read every run folder on each call; the queue files were read-modify-written by
concurrent runs without a lock; gates and notifications lived only in memory.

## Repository performance: where the numbers come from (#159)

Analytics › Repository performance and the Product Owner's conflict map (the "Files most runs edit"
section of its report, #150) share `src/repo-performance.js` (`sharedFiles` = `fileCounts` of
`filesEditedByRuns`):

- **A run's files**: its own commits in the project's local clone. Local merge: `git log --name-only
  <local_merge.commit> ^<worktree.ready commit> ^<the tips other runs merged while it ran>` (a
  rebased run's range also holds what landed meanwhile). PR/MR run: the merge commit found in the
  clone's `git log` by its number (`Merge pull request #N`, a squash's `(#N)`, GitLab's
  `See merge request …!N`), `git diff <commit>^1 <commit>`: an unpulled merge is not counted. A
  resumed run starts from the base of the run it resumes. Cached in `run_files` by range.
- **Conflicts**: `events.jsonl`: a `step.started` of `resolve_merge` / `resolve_conflict`, or an
  `action.executed` of `gh pr merge` / `glab mr merge` with a non-zero exit; the files are the paths
  named by the run's conflict messages. Cost: the sessions' `cost_usd` (`readRun`).
- **Parallel work**: `started_at` / `finished_at` (local time); roadmap stages from the project's
  current `backlog/<id>.roadmap.json` (items' `runId` / `runs`): a cleared roadmap loses them.
- **Generated files**: a file whose first 64 KB has a `<!-- generated:` marker or "generated by" /
  "do not edit".

## The Night watch: the Oracle's log (#172)

Files only, in `<workspace>/oracle/` (no index.db table): `night-watch.json` (the switch: `on`,
`until`, `startedAt`, `by`), `night-permissions.json` (the owner's checklist; missing = the
defaults) and `night-log.jsonl`, appended by the service, never by the model: `oracle.watch`
(on, end time moved, off), `oracle.detected` (`src/service/channels/nightwatch.js`, from run events
and a one-minute roadmap check), `oracle.action` / `oracle.blocked` / `oracle.escalated` /
`oracle.undone` (`src/oracle.js`). The nights are the `oracle.watch` windows; every metric
(`src/night-watch.js` `nightMetrics`) is recomputed on read from that log, the runs'
`events.jsonl` (start, end, status, cost, progress events, gates) and the Oracle's `usage.jsonl`.
Lines unblocked come from `git diff --shortstat` of a run's local merge commit.

## Rules

- **Only the service opens it** (`openIndex` in `src/service/areas/index-db.js`, on `setWorkspace`; closed in
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
