---
order: 255
---

<!-- section:workflows -->
## Test backfill (`workflows/test-backfill.yaml`)

Code & Build (#203, #631; the old `test-batch.yaml` name still runs it). Write features first and test
them later, all together: for runs made with unit or E2E tests off, it covers a range of local commits
(since `since`, else since the last green backfill, `refs/multiagent/test-batch-last-green`, a local
ref; or the commits that close the run's issues) in its own worktree of the local base. One test
writer session writes the missing unit tests (and E2E scenarios when `e2e_tests` is on) on the branch
`test-batch-<run_id>`; the orchestrator runs the whole suite once per round (`suite` step, no agent)
and sends the failing tests back to the test writer, at most `max_rounds`, then a human gate. A
failure caused by the production code goes to the developer; then you approve the merge (nothing
reviewed the fix). Green: the branch merges into the local base and the commit becomes the last green
backfill. Start it by hand, from the Backlog or as a roadmap item: the Product Owner's Cost step
(Economy) follows the untested issues of a stage with a `test-backfill.yaml` item. It never pushes,
tags or publishes.
