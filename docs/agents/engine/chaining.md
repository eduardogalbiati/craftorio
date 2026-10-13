# Chaining: declared outputs and `then` (#134)

Declared run outputs and `then`: what a finished run hands to the next one, and how the service starts it.

- `outputs:` (top level, `validateOutputs`): `{ <name>: { type, description, value } }`, type one of
  string, number, integer, boolean, array, object. `value` is a template over the run's context plus
  `run` (`run.issues`, `run.local_merge`); a type other than string is rendered as JSON (`| to_json`) and
  parsed. `computeOutputs` fills them in `finish()`: `workflow.finished.outputs` and `summary.outputs`.
  Empty or unparsable → `null` (a `log` warn, never a failed run). Filter `filed_issues(analysis)`: the
  issue tracker's created issues with complexity and grouping advice (`grouping`, `group_with`).
  The visual builder flags `outputs` (it would drop it on save): such a workflow is edited as YAML.
- Bundled contracts: issue-tracker `issues`; writer-reviewer `document`, `issue`; ai-arena `document`;
  software-development(-local-hero) `branch`, `merged_commit`, `issues`, `pr_url`; run-retrospective `findings`.
- `WorkflowRun` options `then` (what follows, `src/shared/chain-model.js normalizeThen`: `{ action:
  'workflow', workflow, map: { <next input>: <output name> | '@run' }, inputs }`, `{ action:
  'product_owner' }`, `{ action: 'queue', workflow, inputs }`) and `from: { run_id, workflow }`, both in
  `workflow.started` and `summary.json`. A gate choice with `then:` (issue-tracker's `create_assign`:
  `{ action: queue, workflow: "{{ inputs.assign_workflow }}" }`) sets it when picked (`thenFromChoice`);
  the owner edits it with `setThen` (Run screen). Each change is a `run.then` event.
- The service acts on it (`src/service/areas/chain.js`), never the engine: on `workflow.finished`
  with `success` (and, when the workflow declares `merged_commit`, a non-empty one; simulated runs are
  exempt) it starts the next run (`nextInputs`: the then's values, the mapped outputs, the previous
  run's path/branch/language/platform inputs; the produced issues linked), queues the produced issues
  (`queueBatches`, like the old "Create and queue"; a simulated run queues nothing), or asks the
  Product Owner and adds its plan as planned roadmap stages (`roadmaps.propose`, never started by
  itself). Anything else pauses the chain (`runs/<id>/chain.json`: `then`, `state` waiting | started |
  paused | dropped | done, `reason`, `nextRunId`) with a notification; channels `chain:get`,
  `chain:set`, `chain:resume`, `chain:drop`, `chain:estimate`. Chaining never answers a gate: the
  next run's gates wait for the owner. A simulated run only chains simulated runs.
