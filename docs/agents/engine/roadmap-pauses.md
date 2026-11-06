# Roadmap pauses (#141, #368, #391)

The three ways to pause a roadmap, where each one is written and when each one stops.

| Control | Writer (`packages/engine/domains/roadmap/roadmap.js`) | Stops |
|---|---|---|
| Roadmap bar › Pause › **Pause after this stage** (#391, the default) | `pauseAfterStage`: `scope: { stage, pauseAfter: true }` on the current stage | When the current stage is over: every item of it still starts (also those waiting for a slot); then `advance` pauses with "Stage N done" (`scopeOver`, the scope cleared) |
| Roadmap bar › Pause › **Pause now** (#269's pause) | `setState(…, 'paused')` | At once: nothing new starts, runs in progress go on |
| Stage ⋮ › **Pause after current step** (#368) | `pauseStage` (`pausedStage`, `pausedAt`) and each run's `pause()` | Each run of the stage after its agents finish the current turn; the roadmap pauses at once |
| Stage ⋮ › **Run this stage** (#141, a start, not a pause) | `setState(…, 'running', { stage })`: `scope: { stage }` | When that stage is over, as Pause after this stage |

- `roadmap:pause` takes `after: 'stage' | 'now'`; nothing passed is `now`, so the budget cap (#206),
  the self-healing update cycle (#279) and the control channel (#336) pause at once as before.
  `roadmap:cancel-pause` drops a `pauseAfter` scope: the whole roadmap runs again.
- A pause after the stage is a scope, so the scope's rules apply: no cut line's release run (#260)
  and no live refill (#164) starts before Resume (on the last stage it pauses instead of ending,
  `advance`'s `more`); a failure in the stage pauses at once (`pausedBy`); human gates still wait.
- A running roadmap held by a cut line (no stage in progress) pauses now; a stage run on its own
  (#141) already stops after its stage, so `pauseAfterStage` leaves it as it is.
- The screen tells the two scopes apart through `RoadmapModel`: `scopedStage` ignores a `pauseAfter`
  scope ("stage N only" is #141's), `pausingAfterStage` is the bar's "Pausing after stage N" badge
  (with Cancel pause), read from the file so it survives a reload. Resume from a Pause now taken
  meanwhile runs the whole roadmap (the screen sends no stage).

## A skip of the item that paused the roadmap (#804)

`itemAction` sets a roadmap paused by the item back to `running` on a retry or a skip, and the channel's
`dispatchRoadmaps` starts the next work at once. So the screen asks first: `RoadmapModel.nextAfterSkip`
mirrors `advance` and names what would start (a stage's planned items, a release, a live refill), or
null when nothing would: no dialog, the skip as ever. `skipDialog` (`packages/ui-kit/kept-work-dialog.js`)
offers to go on or to stay paused; staying is `roadmap:item` with `keepPaused`: `pausedBy` and `error`
are cleared, the state stays `paused` and the bar reads plain Paused until Resume. `keepPaused` only
counts on a skip. A retry, a park and the roadmap's own skips (`skipClosed`, the base-health `skipItem`)
are as they were.

## A stage inserted before the running stage (#697)

A stage put before the stage whose run is in progress (a save, a drag, an add stage, a Product Owner
proposal) waits for it: `RoadmapModel.waitsFor` names the running stage while the first open stage is
an earlier one, and `advance` then only steps the running stage (its planned items still start, a
failure still pauses). Once that stage is finished, the inserted stage starts before any stage after
it. An item parked at a human gate (#395) is not running: it holds nothing. The screen shows the
inserted stage's "Waits for stage N" badge (`roadmap-stage-waits`) instead of Next; only the running
stage is current.

## An item that waits for its PR's merge (#797)

A run that succeeded with a PR it did not merge itself (`ai-development-remote-hero` stops at
`pr_review`, the merge happens on the platform) is no failure: its item is `waiting_merge` (derived in
`roadmap-status.js`, never stored), with `error: null` and `pr: { number, url, state, detail, checkedAt }`.
It is not finished, so it holds its stage and no later stage starts from a base without that work, and
the roadmap keeps running (`stageStep` does not pause on it). The owner's Skip goes on without the merge.

- `roadmapRun` only looks at the PR cache (`run-pr.js prCache`): it runs on every draw and poll.
- The PR is read on a dispatch and when the Roadmap opens (`backlog:get`, in the background), both
  under the cache's 5 minutes, and fresh on a `backlog:sync`. `roadmap:get` and `backlog:state` never
  read, and neither does the dispatch of a workspace that opens (its starts never wait for gh).
- Merged: the item is done, stored with `mergedCommit`. Closed: failed, "PR #n was closed without
  merging", and the roadmap pauses as for any failure. A failed read keeps it waiting (`pr.state:
  'unknown'`, `pr.detail` says why).
- Fork + PR (#738): a PR known only by its number is placed on the project's upstream (`prOnProject`).
- A roadmap the old rule paused (`pausedBy` this item, "finished without merging") goes on by itself
  (`advance`) once its item waits or is done. A parked item (#395) whose run ended this way stays
  parked until the PR merges or closes.
- Known limit: a closed PR stays in the cache until the app restarts, so a PR reopened meanwhile is
  only seen then.
