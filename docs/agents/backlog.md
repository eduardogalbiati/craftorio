# Open ideas / backlog

Read this when planning new work, to avoid redoing a discussion.

- Dynamic model roles: role → provider/model map with fallbacks when a CLI is missing or over
  budget (discussed, not built; the owner accepted requiring all three CLIs for now). Portable
  permissions → per-provider flags is done: `capabilities` ([capabilities.md](capabilities.md)).
- Ticket slicer / planner step feeding fan-out implementers; arena "design-sketch" runs.
- Pop-out window for the supervisor chat; free-text feedback on the arena's gates (redo); the engine supports it now.
- Arena ideas not done: rubric hidden from contenders, contenders configurable by input.
- Visual builder (#26) follow-ups: draw loops, parallel desks, output schemas and custom inputs;
  drag to reorder; show the builder's robots in the run chat.
- Analytics screen (#27): the per-turn context metrics are in `summary.context` of every run, the
  active / waiting / stalled time per step in `summary.timing`.
- Idle agents (#46 → #41): the `agent_idle` warning wakes the supervisor (wait / interrupt) only on
  a step's turn, not on delegated turns; there is no UI for the `idleWarningMinutes` setting.
- Worktree follow-ups: see [worktrees.md](worktrees.md).
- Local merges not pushed (#89, done): `src/local-push.js` (`localStatus` / `pushBase` /
  `updateAndPush`), cached per project in `<workspace>/backlog/<id>.local.json`, column `local` in
  `linkRuns`, auto-push per project (`project.autoPush`). A conflict of Update and push goes to a
  run (`backlog:resolve-push`, task from `conflictTask`) of the last local workflow of the project:
  its developer merges `origin/<base>` into the run's branch (a merge, so the local commits stay and
  the next push is a fast-forward), then review, tests and the local merge. Not done: if the local
  base moves while that run works, `mergeLocally` rebases the branch and flattens the merge (the
  next push is rejected again); auto-push is per project, not per workflow; the Update and push
  rebase runs in the checkout where the base is checked out, so it refuses when that checkout has
  uncommitted changes.
- One run's figures (#228): `src/run-analysis.js` `runFigures` (cached in the index, `run_figures`)
  feeds Analytics › Run; the roadmap estimates (#206, #215) still compute their own durations and
  costs, so the two can disagree. Next: move the estimates onto `runFigures`.
- 24/7 meter (#188): a paused roadmap or a stall counts as blocked only inside a Night watch window
  (from its incident log); outside it, nothing records the pause, so that time counts as no work.
