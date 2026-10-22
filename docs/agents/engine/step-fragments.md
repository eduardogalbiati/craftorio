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
