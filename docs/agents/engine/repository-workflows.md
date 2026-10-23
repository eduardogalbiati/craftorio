# Repository workflows (#485)

A repository's `.multiagent/project.yaml`: the workflows a project is worked on with, how a name resolves, and why a repository's own workflow is accepted per commit and capped.

- **The manifest** (`src/project-manifest.js`, pure): `workflows: [{ name, file?, category?, description? }]`,
  `version`, `requires` (an app version range, e.g. `>=1.2`). `{ name }` names a bundled or workspace
  workflow; `{ name, file: workflows/<x>.yaml }` the repository's own copy in `.multiagent/workflows/`
  (a file outside that folder is an error). `category` is `intake`, `solo`, `team`, `release` or a
  bundled one (`plan`, `build`, `monitor`). Invalid YAML, a non-list `workflows`, an entry without a
  name, a duplicate name, an unknown category or an unmet `requires` make the manifest malformed: the
  Workflows screen shows the error and the project runs on the workspace's workflows. No manifest: no error.
- **Resolution** (`src/workflows.js` `resolveWorkflow`): a project's workflow of a name resolves
  repository → workspace → bundled. The list (`workflows:list { projectId }`) carries the repository's
  entries with `origin: 'repository'`, the commit and `accepted`.
- **Read at HEAD** (`src/service/areas/repository-workflows.js`): the committed text, never an
  uncommitted edit, copied to `<workspace>/repository-workflows/<project>/<sha>/` for the engine and the
  builder (read-only there; Clone makes a workspace copy).
- **Accepted per commit**: `workflows:accept { projectId, file, commit }` writes
  `acceptedWorkflows: { <file>: { commit, blob } }` into `<workspace>/projects/<id>.json`. A later commit
  that changes the file asks again and the screen shows the diff since the accepted commit; one that
  leaves the file unchanged keeps the acceptance (the owner's own repository asks once).
- **Caps** (`src/engine/run/load.js` `loadRepositoryWorkflow`): an unaccepted workflow is refused by
  name; an accepted one cannot `ship`, runs `action:`s only with `orchestrator.worktree` (in the run's
  worktree), and every agent and step must list `capabilities.tools` within the workspace's policy
  (`repositoryWorkflowTools` in `settings.json`, edited by hand: Settings has no field for it; else
  `repositoryToolPolicy()`, the tools the bundled workflows give their agents: `read`, `edit`, `write`
  and their `bash:<toolchain>` commands, never a bare `bash`). Each refusal names the reason.
- **Which file a run takes**: the roadmap and `run:start { projectId }` take the repository's entry of
  the name; the Start drawer passes `workspace: true` and runs the workspace's file, as before.
- **Read at creation** (#486, `src/projects.js` `projectManifest`, channel `projects:manifest { url | folder }`):
  a folder's manifest from disk; a remote one through `gh api .../contents/` or `glab api .../files/.../raw`,
  else an unauthenticated raw read; never clones. No manifest: `null`; a repository nothing can read:
  `{ workflows: [], pending: true }` ("will be read after cloning"). The project record keeps the checked
  `workflows: [{ name, origin, category }]` and `defaultWorkflow` (a name, the first solo or team one);
  `projectDefaultWorkflow(p)` gives the roadmap, the Product Owner, the chain and the Oracle that default
  before Settings' one.
- The owner's per-agent model choices stay in the workspace: a repository copy carries none.
