# Roadmap pauses (#141, #368, #391)

The three ways to pause a roadmap, where each one is written and when each one stops.

| Control | Writer (`src/domains/roadmap/roadmap.js`) | Stops |
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
