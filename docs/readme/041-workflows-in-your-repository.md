## Workflows in your repository

A repository can declare the workflows it is worked on with in `.craftorio/project.yaml`:
`{ name }` for a bundled or workspace workflow, `{ name, file: workflows/<x>.yaml }` for its own
copy in `.craftorio/workflows/`, each with an optional `category` (`intake`, `solo`, `team`,
`release`). Open the project in the app and the Workflows screen shows them in their sections with
a "repository @ <sha>" badge. A repository's own workflow is code from the checkout: it stays off
until you accept it for that commit (a later change shows the diff and asks again), and even then
it cannot ship, runs its `action:`s only in the run's worktree and gets only the tools your
workspace allows. Your per-agent model choices stay in the workspace: a workflow you edited in the
workspace runs instead of the repository's copy of the same name (both cards say which one runs),
and when the repository's copy runs (no edited copy, or the project's "Prefer the repository's
workflows" setting) your models still apply on top. This repository declares its
four flows this way. Details: [`docs/agents/engine/repository-workflows.md`](docs/agents/engine/repository-workflows.md).

### Triggers: runs started from the git platform

The same `.craftorio/project.yaml` may list `triggers:`, rules that start one of its workflows
from a platform event, GitHub or GitLab:

```yaml
triggers:
  - { on: issue_labeled, label: ready, workflow: feature, inputs: { issues: ["{{ event.issue.number }}"] } }
  - { on: pr_comment, mention: "@orchestrator", workflow: fix }
  - { on: ci_failed, branch: main, workflow: fix }
```

Nothing polls until you turn the project on in **Settings › Execution › Platform triggers**; the app
then reads the events with `gh api` / `glab api` every 2 minutes (no model call, a longer wait on a
rate limit) and starts one run per new event, never twice for the same one (restart or two apps).
The run comments once on the issue or pull request with its id, counts in the day's and the night's
budgets, waits for a free slot and the merge queue like a roadmap run, and its gates ask you: a
trigger starts work, it never merges. A rule that names a workflow outside the manifest or misses a
field is shown as "ignored" on the project's **Triggers** card, with the last event seen and the
runs started. Under `CRAFTORIO_SIMULATION_ONLY=1` the platform is neither read nor written.
Details: [`docs/agents/engine/repository-workflows.md`](docs/agents/engine/repository-workflows.md).
