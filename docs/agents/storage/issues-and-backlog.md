# Issues and the backlog files

The git platform is the source of truth for issues (#168); who writes the backlog files and the change event (#204).

## Issues: the git platform is the source of truth (#168)

GitHub/GitLab own the issues; everything local is a read-only replica, and issue changes are
never made locally nor flow back from local data to the platform. Only the explicit, previewed
owner actions write to the platform (Save to issue, create, close, epics: `packages/engine/domains/backlog/backlog.js`,
`packages/engine/domains/po/po-split.js`, `packages/engine/domains/backlog/epics.js`,
`packages/engine/domains/po/po-file-issues.js`).

- Mockups (#670): an issue the Product Owner writes from a spec, plan or design doc with mockups
  (`docs/work/<item>/`, `po-mockups.js`) names and embeds the mockup of each screen task
  ("matches `mock-1.jpg`: layout, icons, texts, controls, order"), never requirement numbers
  alone. A split's child carries the mockups of its tasks (`po-split.js` `normalizeSplit`,
  `childBody`), and `checkSplit` refuses a child whose tasks cite a mockup it lacks. A proposal
  from a spec (`answer.spec`, `po:file-spec` / `fileSpec`) lists every mockup and the issue that
  covers it (`checkMockupCoverage`); one in scope with no issue blocks it, the `## Later phases`
  ones are listed as later.

- `backlog/<project>.json`: the sync cache (`syncedAt`, every issue with its PRs/MRs and epic),
  rewritten by each sync (`syncBacklog`); a save to an issue re-reads that one issue into it.
- Queue items (`<project>.queue.json` / the index) and roadmap items (`<project>.roadmap.json`)
  keep a **copy** of each issue (`number`, `url`, `title`, `body`, `labels`, `updatedAt`,
  `knownPullRequests`) so the screen and the Product Owner can show it. Each sync refreshes the
  copies of the items not started yet (`refreshQueuedCopies`, `roadmap.refreshCopies`); an item
  with a run keeps the text its run used.
- The roadmap file also holds the **Live roadmap** switch (#164, `packages/engine/domains/roadmap/live-roadmap.js`): `live`
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
  (`writeQueueFile`), the roadmap (`writeRoadmap`, `packages/engine/domains/roadmap/roadmap.js`: the screen, the service's
  dispatch and live refill, the Oracle's `roadmap.stages`, the Product Owner), the refresh banner's
  dismissal (`<project>.refresh.json`), and anything outside the app (another window, a script).
  The roadmap and the queue go through `packages/engine/domains/workspace/state-file.js` (temp file + rename, `.bak`).
- The conflict map (#150, `packages/engine/domains/project/conflict-map.js`): `<project>.conflict-map.json`, written (temp file +
  rename) when the Product Owner plans and finds none, and after a real run of a git project merges
  (`packages/engine/service/areas/conflict-map.js`, on `workflow.finished`). The Backlog payload (`conflictMap`)
  and a simulated Product Owner only read it; deleting it makes the next plan rebuild it.
- Releases (#260): `<workspace>/releases/<project>.json` (`packages/engine/domains/releases/releases.js`, through
  `packages/engine/domains/workspace/state-file.js` too) holds the shipped releases and the next release's notes. It is the only
  record of what a release shipped: an issue's "Released" badge is read from it on every Backlog
  read (`releasedIssues`), never written into the synced `<project>.json`, which each sync rewrites.
  A roadmap's cut line keeps its release run in `<project>.roadmap.json` (`stage.release`).
- **A disabled stage** (#284) is `disabled: true` on the stage in `<project>.roadmap.json`; an
  enabled stage has no such field. `cleanStages` changes it only on an explicit `disabled: true` /
  `false`: a save that does not mention it (the Oracle's `roadmap.stages`, a proposal, an outside
  script) keeps what is stored. Undo and "Restore an earlier version…" put the stage back with the
  switch it had (`roadmap-undo.js` `head`). A save or an Undo that would disable a stage while one
  of its items runs is refused with the reason (`saveStages`, `restoreStages`), whoever writes it.
- **The roadmap's history** (#281, `packages/engine/domains/roadmap/roadmap-history.js`): before each owner edit of a roadmap
  (a save from the screen, a proposal added or replacing it, the queue moved in, Clear, an Undo, a
  Restore) the roadmap channels keep its stages as they were in
  `backlog/<project>.roadmap.history/<time>-<n>.json` (`{ at, label, stages }`, the label being what
  the edit did: "Removed #279 from the roadmap"), the last 20 per project. The Roadmap's ⋮ menu
  lists them ("Restore an earlier version…"). The engine's own writes (a run started or finished, a
  live refill) and the Oracle's actions (their own backup, `oracle/backups/`) are not kept there.
  **Undo** (the toast after an edit) does not read the history: the service keeps the last edit of
  each project in memory (`{ before, after, label }`, `packages/engine/domains/roadmap/roadmap-undo.js`) until the next edit or
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
  one seen, so two writes in the same millisecond differ), and `packages/engine/domains/roadmap/roadmap.js` keeps in memory the
  stages of the last 50 reads and writes of each file by `updatedAt` (`readRoadmapAt`). A save from
  the screen carries the `updatedAt` it read (`roadmap:save` `base`); the Product Owner's move
  carries its read too (the Oracle's `roadmap.stages` `base`). When the file was written since
  (another writer, another window, a script), `packages/engine/domains/roadmap/roadmap-merge.js` applies only what the edit
  changed against that read to the stored stages, by item and stage id: a stage's name, note, cut
  line or switch; an item's workflow, simulation, chain, each input, its issues (the ones the edit
  added or took out); a move, a removal, a new item or stage. Everything else stays as stored. It
  refuses, writing nothing, when the item or stage it changes is gone, the same field changed on
  both sides, an item it removes changed elsewhere, or the read is no longer known (after a
  restart): the screen gets the Backlog with `conflict: { reason }`. A merged save keeps one
  history version with its label, and its Undo takes back only that edit. An Oracle
  `roadmap.stages` without `base` still replaces the stages (it is the whole list it means).
- `packages/engine/service/areas/backlog-watch.js` watches the folder (one `fs.watch` per workspace, started by
  `setWorkspace`, closed on a switch and on `shutdown`) and pushes `backlog:changed { projectId,
  file: roadmap | queue | issues | local | refresh, watching: true }` once per file, 300 ms after
  its last write; a write that leaves the same mtime and size pushes nothing. A watcher error
  pushes `{ projectId: null, watching: false }` (`backlogWatching()` answers the same): the Backlog
  screen then polls every 5 s while the Roadmap screen is visible.
- The Backlog screen reloads the project's data on its project's event, unless the owner types in
  one of its fields, drags, or edits a roadmap item or a stage's note: the reload waits until they
  are done (an open Edit form shows "The roadmap changed: 1 item updated elsewhere. Reload", #287:
  what changed against what is shown). Scroll and expanded rows stay.
