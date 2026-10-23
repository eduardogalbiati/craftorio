# Step fragments: `fragment: <name>` (#434)

Step bodies several workflows share, kept once in `fragments/<name>.yaml` and included by a step's `fragment:` key.

- A fragment file is `steps: { <step id>: <body> }` (`fragments/test-pipeline.yaml`: test, suite,
  test_failed, build, build_failed, evidence, verify_change). A workflow step
  `{ id, fragment: <name>, ...keys }` becomes the body under its id, merged by `expandFragments`
  (src/engine/run/load.js) before the checks: the step's own keys win over the body's and keep
  their place first in the step.
- Put in the workflow what differs per workflow (`agent`, `type`, `display`, the suite's
  `command`/`scope`/`coverage`), and only there: a key in both places is a copy that can drift.
- The fragments ship with the app: they are read from the app folder (`fragments/`), never from
  the workspace, so a workflow copied to the workspace or a scratch folder still finds them. An
  unknown fragment or a missing step id fails the load (`steps[i].fragment: ...`).
- The supervisor's `read_workflow` returns the workflow's YAML followed by the fragments it
  includes (`fragmentSources`), so the included prompts, schemas and transitions are in its answer.

## Composed workflows (#487)

`src/workflow-compose.js` builds a project's workflow set from its ways-of-working profile (the
`ways-of-working` seed, [seeds.md](../seeds.md)) and the interview's answers, out of fragments only:
`intake-pipeline` (write, review, file), `dev-pipeline` (develop, code_review, suite, verify_change,
validate, verify_failed), then `local-merge-pipeline` (resolve_merge, merge_blocked: the
`merge: local` style) or `pr-pipeline` (ci, ci_failed, pr_review: the `probe: pr_*` waits), and
`release-pipeline` (prepare, suite, notes, approve, tag_rc, soak, tag) wired per release style
(milestone, per-merge, train, rc-stable). The workflow keeps only what differs per project: the
transitions, the suite's `command` (the profile's test command), the agents with the project's
language skills and test command in their prompts, and no `ship:` (a repository workflow cannot
ship). `openQuestions(profile)` lists what the interview asks: validation, budget, screenshots and
review rigour always, the release and merge styles when the profile leaves them `null`.
`composeWorkflowSet` is pure (YAML texts and the `.multiagent/project.yaml` manifest);
`workflows:compose` (`src/service/areas/workflow-interview.js`) writes them into the project's
folder only with `write: true`, uncommitted. Every composed workflow loads with `loadWorkflow` and
`loadRepositoryWorkflow`, and opens in the Builder (`fixed` mode).
