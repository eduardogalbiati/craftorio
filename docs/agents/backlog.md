# Open ideas / backlog

Read this when planning new work, to avoid redoing a discussion. Ideas the owner already decided
(built or ruled out) are in [decisions.md](decisions.md), not here.

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
- Local merges not pushed (#89, done): `packages/engine/domains/local/local-push.js` (`localStatus` / `pushBase` /
  `updateAndPush`), cached per project in `<workspace>/backlog/<id>.local.json`, column `local` in
  `linkRuns`, auto-push per project (`project.autoPush`). A conflict of Update and push goes to a
  run (`backlog:resolve-push`, task from `conflictTask`) of the last local workflow of the project:
  its developer merges `origin/<base>` into the run's branch (a merge, so the local commits stay and
  the next push is a fast-forward), then review, tests and the local merge. Not done: if the local
  base moves while that run works, `mergeLocally` rebases the branch and flattens the merge (the
  next push is rejected again); auto-push is per project, not per workflow; the Update and push
  rebase runs in the checkout where the base is checked out, so it refuses when that checkout has
  uncommitted changes.
- One run's figures (#228): `packages/engine/domains/run/run-analysis.js` `runFigures` (cached in the index, `run_figures`)
  feeds Analytics › Run; the roadmap estimates (#206, #215) still compute their own durations and
  costs, so the two can disagree. Next: move the estimates onto `runFigures`.
- 24/7 meter (#188): a paused roadmap or a stall counts as blocked only inside a Night watch window
  (from its incident log); outside it, nothing records the pause, so that time counts as no work.
- Untested production files (#306): the follow-ups (one issue each, not filed yet) and the map's
  blind spot for the service loader are listed in [simulated-runs.md](testing/simulated-runs.md), "Production files no
  test reaches".
- Reorganisation into an engine package and modular fronts (Project Analyser, Code & Build,
  Design & Plan, AI; Settings as the shell): measurements, target layout, phased plan and the
  owner's open decisions in [docs/reorganisation-study-2026-10.md](../reorganisation-study-2026-10.md);
  `scripts/dep-map.js` re-measures.
- A step registry the fronts contribute (phase 4 of the reorganisation, #590): the engine's machine
  steps call four domain modules that a front's screens also read (`supervisor`, `release-city`,
  `project-map`, `refactor-proposals-run`), so they stay in the engine kernel and a bundled workflow
  runs on any engine whatever fronts it ships. The day a front ships a workflow of its own, its
  `engine/` could register the steps that workflow needs (`fronts.md`, "What stays in the engine
  kernel"), and a one-front engine would refuse a workflow whose steps no served front provides.
- First project onboarding (#ISSUE, epic): a four-step wizard (import or create, a background clone,
  the Ways of working profile with the city and refactor analysis, suggested feature / fix /
  release workflows, a review), ways of working as Local or Local + remote with CI as its own axis,
  the bundled workflows cut from 15 to 11 with aliases (Planning left for a later proposal), and a
  per-project work model aligned with Anthropic's AI-native SDLC (intent, spec, plan committed in the repo),
  and last a Monitor menu group where production errors become intents. The
  proposal, its decisions D1-D19 and the phased plan:
  [docs/first-project-onboarding-proposal-2026-10/](../first-project-onboarding-proposal-2026-10/README.md)
  (also in pt-BR). Waiting for the owner's decisions.
