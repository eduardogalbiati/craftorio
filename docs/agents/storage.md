# Storage: files and the SQLite index

Read this before touching run listings, the Backlog queue, pending gates, notifications or
`src/store.js` (#76).

## Files are the source of truth

- `runs/<id>/` (`events.jsonl`, `summary.json`, `meta.json`, `sessions/`, `handoffs/`, `decisions.tsv`,
  `evidence/<step>/round-<n>/` screenshots with `evidence/manifest.json`, see engine/evidence.md,
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
- The three conversational agents' usage (#280, `src/agents-usage.js`): every real turn appends one line
  (a simulated turn records nothing; nothing is ever rewritten) to `oracle/usage.jsonl` (the Oracle),
  `backlog/product-owner.usage.jsonl` (the Product Owner, every project; Clear keeps it) or
  `supervisor/usage.jsonl` (the Supervisor chat; Clear keeps it). Fields: `ts`, `agent` (`oracle`,
  `product-owner`, `supervisor`), `projectId` (Product Owner), `provider`, `model`,
  `tokens { input, output, cache_read, cache_write }` (#308: every model call of the turn, sub-agents
  included), `costUsd` (the turn's own cost), `sessionId` (the
  CLI session), `session` (`fresh` or `resumed`), `startReason` on a fresh session (`first`, `compaction`,
  `model-change`, `idle`, `reset`, `cleared`, `one-shot`) and `contextTokens` (the context after the turn,
  when known); the Oracle's and the Supervisor chat's lines also hold `cumulativeUsd` (the CLI session's total,
  #244) and the Oracle's `wake` (a wake-up's turn). Lines from
  before #280 lack `agent`, `session` and `startReason` (the Product Owner's, `sessionId` too) and are
  read as they are; the Supervisor chat's turns from before its file are read from the answers' `costUsd`
  in `supervisor/chat.jsonl` (cost only, until Clear removes them). Readers: Analytics' Agents tab
  (`analytics:agents`), Usage and the monthly budgets (the Oracle's and the Supervisor chat's days as
  summary-like runs, the Product Owner's month through `usage.withPeerUsage`).
- `phone-gates/devices.json` (#226, `src/mobile-gates.js`): the phones paired with the gates page
  (`id`, `name`, `tokenHash` (SHA-256; the token itself is only on the phone), `pairedAt`,
  `lastSeen`); Revoke removes the entry. `phone-gates/secret`: the key that signs the gate links,
  created once, so a link keeps working across restarts until it expires. Pairing codes live in
  memory only: a restart voids them.
- `discovery/<project id>/` (#256, `src/discovery.js`): the discovery cards, private to the
  workspace (`discovery/.gitignore` ignores everything; never committed, never sent to the git
  platform). `board.json` (columns `{ id, title, wip }`, the card order per column),
  `cards/<card id>/` (`<yyyymmdd>-<4 hex>`) with `card.json` (id, title, type `idea | prd | rfc | bug |
  hotfix`, column, author, created, updated, tags, clarity, estimate, links, history `[{ ts, from,
  to, by }]`), `document.md`, `acceptance.md`, `versions/<iso ts>-<reason>.md` (a snapshot of the
  document on each column move and before a merge; `snapshotVersion` is there for agent outputs),
  the Discovery board's (#257) columns `inbox, triage, shape, define, ready` with `wip` 5 on Shape
  and Define (`setWip`; the store never refuses a move past a limit, the screen asks), a card's
  place in `order[column]` (`moveCard`'s `index`; a move within its column adds no history entry
  and no version), the versions `before-restore` / `before-result` (the document a restored version
  or a run's result replaced, unless the newest version already holds it) and `result-<source>`
  (`recordResult`, source `write-review` | `ai-arena`, with a thread entry `{ kind: 'result',
  source, runId, version }`), read with `listVersions` / `readVersion` (a name that is not a
  version file is refused),
  `attachments/` (any file up to 50 MB, original names, a taken name gets a `-2` suffix, the same
  content is stored once) and `conversation.jsonl` (the thread, appended). `archive/<card id>/`: a
  discarded or merged card, same layout, `card.archived = { ts, reason, by, mergedInto? }`.
  A committed card (#258, `src/discovery-commit.js`): `card.column = 'committed'` (no board column,
  in no `order`; `moveCard` and `mergeCard` refuse it, `restoreCard` keeps it committed, and it is
  kept as it was committed: `updateCard` only takes `links.release`, a new document, attachment,
  restored version, run result or Grill me interview is refused; its thread still takes notes),
  `links.issues` the numbers of the issues filed from it (`markCommitted`; `issueCards` gives the
  Backlog each issue's card from the `card.json` files alone), `filed/<iso ts>-issue-<n>.md` the
  text of each issue, a thread entry `{ kind: 'commit', issues }`; `links.from` on a card created
  from another (`createCard`'s `from`). Its delivery is never stored: the `discovery:board`
  channel computes it on each read from the synced backlog and the release history. Every
  file is written whole (temp file + rename, `writeFileAtomic` in `src/state-file.js`); project
  ids, card ids and attachment names are checked before a path is built, so nothing outside a
  card's folder is read or written. No index row: the folders are read directly. Screens, the
  Oracle and agents reach a card only through the `discovery:` channels
  (`src/service/channels/discovery.js`), never by reading the folder.
- **The gate answer record**: a gate's `approval.resolved` event in `events.jsonl` carries
  `approval_id`, `step_id`, `choice` (or `approved`), `by`, `wait_ms`, `feedback?`, `commit?`;
  answered from a paired phone it adds `answered_by: "owner"`, `via: "mobile"`, `device` (the
  device id of `phone-gates/devices.json`) next to the event's `ts`. Only the phone page writes
  them (`answerPhoneGate`, never a channel); the `gates` index row is closed by the same event.
- **Costs and memory events** (#277, #276): a Claude turn with several `result` events keeps them
  as `raw` items of `session.stream` and records its highest total once; `summary.json` carries
  `turn_cost: 'max_result'`. A per-turn run without it is read through its `usage` stream items
  (the run record's `#277 multi-result turn` upgrade, below); the files are never rewritten. The
  memory guard writes `process.killed` and `memory.hold` events (engine/agents-and-steps.md,
  "Memory guard").
- Never make the database the only copy of something a run produced.

### Old runs: the run record upgrades them on read (#350)

A run's files keep the shape they were recorded in, forever: no migration rewrites a run folder.
`readRunRecord(runDir)` (`src/run-record.js`) reads `summary.json` and `events.jsonl` and returns
`{ summary, events }` in the **current shape** (summary null while the run has none);
`readRunSummary(runDir)` returns the summary alone and reads the events only when it needs them.
The upgrade itself, `upgradeRunRecord({ summary, events })` in `src/shared/run-record.js`, is pure
(the record given is never changed), idempotent, and works on in-memory events too: the renderer
(`app.js`) upgrades a past run's live events with it. Its `UPGRADES` list has one entry per change
of a run's shape, in order: `single issue: issues`, `#233 stopped attempt`, `#233 per-turn cost`,
`#277 multi-result turn`, `sessions in the summary`. The readers (`runFigures`, `analyzeRun`,
`runs.readRun` and the run index, `usage.readRuns` and Analytics, the cost estimates through the
run list, the Oracle's focus) read the current shape only: they never test for an older one. The
run index stores the upgraded summary; bump `READ_VERSION` in `src/runs.js` (and the figures' sig
in `src/service/areas/insights.js`) when an upgrade changes what was indexed.

When a change alters what a run records (a field renamed, a cost counted another way, a list moved):
1. Change the engine to write the new shape, with a marker an older record lacks when the shape
   cannot tell by itself (as `cost_accounting: 'per_turn'`, `turn_cost: 'max_result'`).
2. Add one entry to `UPGRADES`, after the ones it builds on, named after its issue
   (`#<n> <what changed>`): `applies(record)` says whether the record has the older shape,
   `upgrade(record)` returns a new record in the newer one (copy what it changes, never mutate) and
   sets the marker, so a second pass does not apply it again.
3. Add a fixture of the older shape to `test/run-record-fixtures-350.js`, its own test, and check
   that the readers give the same figures on it as before.
4. Don't add a branch for the older shape to any reader.

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
- The conflict map (#150, `src/conflict-map.js`): `<project>.conflict-map.json`, written (temp file +
  rename) when the Product Owner plans and finds none, and after a real run of a git project merges
  (`src/service/areas/conflict-map.js`, on `workflow.finished`). The Backlog payload (`conflictMap`)
  and a simulated Product Owner only read it; deleting it makes the next plan rebuild it.
- Releases (#260): `<workspace>/releases/<project>.json` (`src/releases.js`, through
  `src/state-file.js` too) holds the shipped releases and the next release's notes. It is the only
  record of what a release shipped: an issue's "Released" badge is read from it on every Backlog
  read (`releasedIssues`), never written into the synced `<project>.json`, which each sync rewrites.
  A roadmap's cut line keeps its release run in `<project>.roadmap.json` (`stage.release`).
- **A disabled stage** (#284) is `disabled: true` on the stage in `<project>.roadmap.json`; an
  enabled stage has no such field. `cleanStages` changes it only on an explicit `disabled: true` /
  `false`: a save that does not mention it (the Oracle's `roadmap.stages`, a proposal, an outside
  script) keeps what is stored. Undo and "Restore an earlier version…" put the stage back with the
  switch it had (`roadmap-undo.js` `head`). A save or an Undo that would disable a stage while one
  of its items runs is refused with the reason (`saveStages`, `restoreStages`), whoever writes it.
- **The roadmap's history** (#281, `src/roadmap-history.js`): before each owner edit of a roadmap
  (a save from the screen, a proposal added or replacing it, the queue moved in, Clear, an Undo, a
  Restore) the roadmap channels keep its stages as they were in
  `backlog/<project>.roadmap.history/<time>-<n>.json` (`{ at, label, stages }`, the label being what
  the edit did: "Removed #279 from the roadmap"), the last 20 per project. The Roadmap's ⋮ menu
  lists them ("Restore an earlier version…"). The engine's own writes (a run started or finished, a
  live refill) and the Oracle's actions (their own backup, `oracle/backups/`) are not kept there.
  **Undo** (the toast after an edit) does not read the history: the service keeps the last edit of
  each project in memory (`{ before, after, label }`, `src/roadmap-undo.js`) until the next edit or
  a restart. Undo and Restore put back what changed, never the whole file: an item that exists now
  keeps its run (`status`, `runId`, `runs`, `error`), one that is running or done is not changed,
  items and stages added since stay, and both refuse (changing nothing) when an issue they bring
  back is planned in another unfinished item. They write through `roadmap.restoreStages` (ids and
  run states kept), never stop a run and never answer a gate. The roadmap's state is kept: stages
  that come back after a Clear are planned again (Start is the owner's), and a roadmap that was done
  and gets unfinished items back is paused, never started by itself.
- **How the roadmap file is written** (#287): every writer reads the file, changes it and writes
  it in one synchronous step (`updateRoadmap`: `readRoadmap` → change → `writeRoadmap`, no `await`
  between), so the service's writers (the screen's save, the Product Owner, the Oracle, the
  dispatch) never interleave in the service process. `updatedAt` only grows (+1 ms over the last
  one seen, so two writes in the same millisecond differ), and `src/roadmap.js` keeps in memory the
  stages of the last 50 reads and writes of each file by `updatedAt` (`readRoadmapAt`). A save from
  the screen carries the `updatedAt` it read (`roadmap:save` `base`); the Product Owner's move
  carries its read too (the Oracle's `roadmap.stages` `base`). When the file was written since
  (another writer, another window, a script), `src/roadmap-merge.js` applies only what the edit
  changed against that read to the stored stages, by item and stage id: a stage's name, note, cut
  line or switch; an item's workflow, simulation, chain, each input, its issues (the ones the edit
  added or took out); a move, a removal, a new item or stage. Everything else stays as stored. It
  refuses, writing nothing, when the item or stage it changes is gone, the same field changed on
  both sides, an item it removes changed elsewhere, or the read is no longer known (after a
  restart): the screen gets the Backlog with `conflict: { reason }`. A merged save keeps one
  history version with its label, and its Undo takes back only that edit. An Oracle
  `roadmap.stages` without `base` still replaces the stages (it is the whole list it means).
- `src/service/areas/backlog-watch.js` watches the folder (one `fs.watch` per workspace, started by
  `setWorkspace`, closed on a switch and on `shutdown`) and pushes `backlog:changed { projectId,
  file: roadmap | queue | issues | local | refresh, watching: true }` once per file, 300 ms after
  its last write; a write that leaves the same mtime and size pushes nothing. A watcher error
  pushes `{ projectId: null, watching: false }` (`backlogWatching()` answers the same): the Backlog
  screen then polls every 5 s while the Roadmap screen is visible.
- The Backlog screen reloads the project's data on its project's event, unless the owner types in
  one of its fields, drags, or edits a roadmap item or a stage's note: the reload waits until they
  are done (an open Edit form shows "The roadmap changed: 1 item updated elsewhere. Reload", #287:
  what changed against what is shown). Scroll and expanded rows stay.

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

Analytics › Repository performance and the Product Owner's conflict map (`src/conflict-map.js`, the
"## Conflict map" section of its report, #150) share `src/repo-performance.js` (`commitRanges`,
`filesEditedByRuns`; the map adds per-line counts from `git -U0` hunks carried to HEAD, and falls back
to the last commits of the branch when no real run merged yet):

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
Self-healing (#278): the switch is `settings.oracle.selfHealing` (settings.json);
`self-healing.json` (`since`) records when the standing watch was turned on and is removed when it
is turned off. Each change writes an `oracle.watch` entry with `selfHealing: true` and `until:
null`; those are not nights but days of the report (`selfHealingDays`: one window per UTC day).
A detector's `oracle.detected` carries its `evidence` and is written once per run and kind (the
log is read at the first finding after a start, so a restart does not log it again).
An app update (#279, `src/app-update.js`) writes `oracle/app-update.json` `{ from, to, subjects,
roadmaps, appDir, at }` right before its restart, and an `oracle.action` entry of kind `app.update`
(`from`, `to`, `subjects`). The next start reads it before the roadmap dispatch: within 2 minutes of
`at` it resumes the listed roadmaps and deletes it; later it is kept for the failed-update banner
until the owner dismisses it (`app-update:dismiss`). Setting: `oracle.appUpdate` (a stored
`oracle.appUpdateWhen` is ignored and an item's `updateAfter` is dropped at the roadmap's next save:
both removed by #285).

## Times: stored in UTC, cut and shown in the owner's zone (#273)

- **Stamps stay UTC ISO** (`…Z`) everywhere: events, summaries, usage lines, the night log, the
  index. Nothing is rewritten when the zone changes.
- **The zone** is `settings.timeZone` (Settings › General › Time zone, an IANA name). Unset, it is
  the computer's: `readSettings` fills it in, `writeSettings` does not save it until one is chosen.
- **One helper** cuts and formats: `src/shared/time-zone.js` (`window.TimeZone`; `src/time-zone.js`
  in the main process). Day keys, local midnights, weeks, months and visible times go through it.
- **What follows the zone**: Analytics and Usage days and months, the agents' usage days, the
  Oracle's daily budget and its reset, the day budget (#206), the Product Owner's month, GitHub
  Actions' month, the 24/7 meter's days and nights, Home's today, the issue update date, every
  screen's times. The Oracle, the Product Owner and the Supervisor chat get a `[Time]` line (zone and
  local time) in each turn, not in the skill, so the prompt cache stays.
- **What stays UTC**: the Self-healing report's days (`selfHealingDays`, `watchSince`'s loop cap) and
  ids or file names built from a stamp. A pure function given no zone cuts in UTC (the service always
  passes one), so its tests do not depend on the machine's zone.

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
