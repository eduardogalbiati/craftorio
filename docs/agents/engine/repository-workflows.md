# Repository workflows (#485)

A repository's `.multiagent/project.yaml`: the workflows a project is worked on with, how a name resolves, and why a repository's own workflow is accepted per commit and capped.

- **The manifest** (`packages/engine/domains/project/project-manifest.js`, pure): `workflows: [{ name, file?, category?, description? }]`,
  `version`, `requires` (an app version range, e.g. `>=1.2`). `{ name }` names a bundled or workspace
  workflow; `{ name, file: workflows/<x>.yaml }` the repository's own copy in `.multiagent/workflows/`
  (a file outside that folder is an error). `category` is `intake`, `solo`, `team`, `release` or a
  bundled one (`plan`, `build`, `monitor`). Invalid YAML, a non-list `workflows`, an entry without a
  name, a duplicate name, an unknown category or an unmet `requires` make the manifest malformed: the
  Workflows screen shows the error and the project runs on the workspace's workflows. No manifest: no error.
- **Resolution** (`packages/engine/domains/workflow/workflows.js` `resolveWorkflow`, #554): a project's workflow of a name resolves
  workspace (edited: `origin: modified` or `custom`) → repository → workspace (untouched `default`) →
  bundled: the owner's edited copy wins over the repository's copy of the same name. The project's
  setting "Prefer the repository's workflows" (`preferRepositoryWorkflows` in `<workspace>/projects/<id>.json`,
  the project dialog) puts the repository first. The list (`workflows:list { projectId }`) carries the
  repository's entries with `origin: 'repository'`, the commit, `accepted` and `runsCopy`
  (`workspace` | `repository`, from `runsCopies`); both cards of the pair show the "runs:" line
  (`workflow-runs-line`: "runs: workspace copy (your models)" / "runs: repository @ sha").
- **Read at HEAD** (`packages/engine/service/areas/repository-workflows.js`): the committed text, never an
  uncommitted edit, copied to `<workspace>/repository-workflows/<project>/<sha>/` for the engine and the
  builder (read-only there; Clone makes a workspace copy).
- **Accepted per commit**: `workflows:accept { projectId, file, commit }` writes
  `acceptedWorkflows: { <file>: { commit, blob } }` into `<workspace>/projects/<id>.json`. A later commit
  that changes the file asks again and the screen shows the diff since the accepted commit; one that
  leaves the file unchanged keeps the acceptance (the owner's own repository asks once).
- **Caps** (`packages/engine/engine/run/load.js` `loadRepositoryWorkflow`): an unaccepted workflow is refused by
  name; an accepted one cannot `ship`, runs `action:`s only with `orchestrator.worktree` (in the run's
  worktree), and every agent and step must list `capabilities.tools` within the workspace's policy
  (`repositoryWorkflowTools` in `settings.json`, edited by hand: Settings has no field for it; else
  `repositoryToolPolicy()`, the tools the bundled workflows give their agents: `read`, `edit`, `write`
  and their `bash:<toolchain>` commands, never a bare `bash`). Each refusal names the reason.
- **Which file a run takes** (`packages/engine/service/areas/runs.js` `runWorkflowFile`): the roadmap and
  `run:start { projectId }` take the copy the resolution picks, so a roadmap item that names the owner's
  edited file (created before #485 too) runs it and never pauses for a repository copy it does not use:
  acceptance is asked only when the repository copy is the one that runs, and the refusal names it
  ("from the repository @ sha7"). The Start drawer passes `workspace: true` and runs the workspace's file,
  as before. A resume reloads the file the run started with.
- **Read at creation** (#486, `packages/engine/domains/project/projects.js` `projectManifest`, channel `projects:manifest { url | folder }`):
  a folder's manifest from disk; a remote one through `gh api .../contents/` or `glab api .../files/.../raw`,
  else an unauthenticated raw read; never clones. No manifest: `null`; a repository nothing can read:
  `{ workflows: [], pending: true }` ("will be read after cloning"). The project record keeps the checked
  `workflows: [{ name, origin, category }]`, `defaultWorkflow` (#790: the manifest's `default`, else the
  first solo or team one) and `workflowKinds` (#791: the manifest's `kinds` map, `{ feature | fix:
  { name, inputs } }`; another key is a manifest error, a refactor uses the Feature entry; a `default`
  or a kind naming an entry whose `file` has another name is an error too); `projectDefaultWorkflow(p)` resolves the project's `defaultWorkflow`, then the
  manifest's `default`, then the first build workflow, then `feature`, for the roadmap, the Product Owner,
  the chain, the Oracle and Fix the base (no global setting); `workflowForKind(p, kind)` gives the
  workflow and inputs of a Feature or a Fix (the project's map, the manifest's, the wizard's picks).
- The owner's per-agent model choices stay in the workspace: a repository copy carries none. When the
  repository copy runs and the workspace holds an edited copy of the name, that copy's
  `agents.<name>.provider` / `model` / `effort` are layered onto the repository copy (`ownerCopy`,
  `packages/engine/engine/run/setup.js` `applyOwnerCopy`), under the run's own choices (#262).
  `workflow.started.agents.<name>.from` says where each agent's model came from.
