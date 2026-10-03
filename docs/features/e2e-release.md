---
order: 250
---

<!-- section:workflows -->
## E2E release (`workflows/e2e-release.yaml`)

Code & Build. Runs the project's whole end-to-end BDD suite once, before a release, in its own
worktree of the local base: one feature file at a time within `time_budget_minutes`, each
scenario's result and screenshots recorded in the run. A failed scenario goes to the developer
with its screenshots and what changed since the last green E2E run (commits, issues, runs), then
to review and the failed scenarios again, at most `max_rounds`, then a human gate. Green with
nothing fixed: the tested commit is recorded as the last green E2E (`refs/multiagent/e2e-last-green`,
a local ref). Green after fixes: you approve, then the fix merges into the local base. Development
runs only write their issue's scenarios and check that they parse ("written, run at release"); they
never wait for this workflow. It never pushes, tags or publishes.
