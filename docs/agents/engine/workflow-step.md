# A workflow as a step: `type: workflow` (#174)

A step that runs another workflow as child runs: inputs, `foreach`, output, limits, stop and resume, parent and child links.

- `{ type: workflow, workflow: <file>, inputs: {...}, foreach?, max_parallel?, on_error?, transitions? }`
  (src/engine/workflow-step.js, `runChildWorkflows` in workflow.js). `inputs` are templates over the
  run, plus `item` / `index` with `foreach`; a whole `{{ expr }}` keeps its type (a list stays a list).
  `foreach` (a list or a template giving one) starts one child per item, at most `max_parallel`
  (default 1) at a time, and never two items whose `files` overlap.
- Output: once `{ kind: 'workflow', workflow, status, run_id, outputs, error }`; foreach `{ ..., status,
  runs: [{ index, item, run_id, status, error, outputs }], outputs: [per item], succeeded, failed }`.
  `status` is success when every child succeeded. Not a success: `on_error` (a route or a gate) when
  set, else the transitions (they see `output.status`), else the run fails. Children run to the end
  even when one fails.
- Children are normal runs, started through the `startChild` option: the service starts them with
  `startWorkflowRun({ parent, onFinished, signal })`; without it (CLI, engine tests) `startChildRun`
  builds a `WorkflowRun` and emits it as `'child'` (record its events, answer its gates). Their gates
  wait for the owner, the parent waits too (orchestrator session `waiting`) and never answers them.
- Limits (#175): a child takes a Settings › Execution slot like any run (`slotProblem`), and its
  parent lends it its own: a waiting parent counts neither for its descendants nor, while one of its
  children holds the slot, for anyone. With no slot free a child waits (`waitForSlot`, a log line on
  the parent) instead of failing; a limit of 1 runs the children one at a time. Children count in the
  monthly budgets like any run (peers, then their summary). Each child has its own
  `max_total_context` (the parent's counts only its own sessions); the parent's `max_total_cost_usd`
  includes its children's cost (checked between steps). `workflow.child_finished` carries the child's
  `cost_usd` (its own children included, `childRunCost`); the parent records it in `child_runs` and
  `summary.children_cost_usd` (readRun `childrenCostUsd`, not in `costUsd`), shown in the run lists
  and the Run screen.
- Stop and resume (#175): stopping the parent stops its children (the Run screen's Stop asks first
  when children are running); a child still waiting for a slot ends `cancelled`. Resuming the parent
  from the `type: workflow` step (`resume.childRuns`, from `supervisor.resumeSpec`) hands each item
  its previous child (`previous`, matched by index and label, first visit only): the service reuses
  one that succeeded (its outputs, event `reused: true`) and resumes any other one from the step
  Resume from step… suggests (its gate instead when that step lies past a decided gate: the gate asks
  again), event `resumed_from`; a child that cannot be resumed starts afresh. The default
  `startChildRun` only reuses successes.
- Links: `parent_run: { run_id, workflow, step_id, index?, depth }` in the child's workflow.started and
  summary; the parent's `workflow.child_started` / `workflow.child_finished` events and
  `summary.child_runs: [{ run_id, step_id, visit, index?, label?, workflow, status, cost_usd,
  resumed_from?, reused? }]` (readRun `parentRun` / `childRuns`). Run lists nest children under their
  parent; the Run screen's chain banner links both ways. Children nest at most 3 deep; a workflow
  cannot name itself.
