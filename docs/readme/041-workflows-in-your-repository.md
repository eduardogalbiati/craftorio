## Workflows in your repository

A repository can declare the workflows it is worked on with in `.multiagent/project.yaml`:
`{ name }` for a bundled or workspace workflow, `{ name, file: workflows/<x>.yaml }` for its own
copy in `.multiagent/workflows/`, each with an optional `category` (`intake`, `solo`, `team`,
`release`). Open the project in the app and the Workflows screen shows them in their sections with
a "repository @ <sha>" badge. A repository's own workflow is code from the checkout: it stays off
until you accept it for that commit (a later change shows the diff and asks again), and even then
it cannot ship, runs its `action:`s only in the run's worktree and gets only the tools your
workspace allows. Your per-agent model choices stay in the workspace: a workflow you edited in the
workspace runs instead of the repository's copy of the same name (both cards say which one runs),
and when the repository's copy runs (no edited copy, or the project's "Prefer the repository's
workflows" setting) your models still apply on top. This repository declares its
four flows this way. Details: [`docs/agents/engine/repository-workflows.md`](docs/agents/engine/repository-workflows.md).
