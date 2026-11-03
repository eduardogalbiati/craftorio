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
  write-doc `document`, `issue`, `issues` (#651: the issues filed from an accepted plan's steps);
  feature and fix `branch`, `merged_commit`, `issues`, `pr_url`, `evidence` (#651: an object with the
  `suite`, `e2e`, `screenshots` and `axe` of the run; a fix has no E2E, screenshots or axe);
  analyze-project `issues`, `report`; retrospective `findings`. #651, the SDLC post-flow: sdlc-record
  takes `run` (`type: run`, mapped with `'@run'`), `merged_commit`, `pr_url`, `issues` and `evidence`
  (a `then` from a successful feature/fix run, `then.inputs.item` the work item) and writes plan.md's
  Progress row and test.md's evidence row. A remote run (a PR, no `merged_commit`) pauses the chain
  (see below), so its PR is recorded by starting sdlc-record by hand. A `type: object` input takes the output object as it is
  (`convertValue`; a JSON text is parsed).
- `WorkflowRun` options `then` (what follows, `packages/shared/chain-model.js normalizeThen`: `{ action:
  'workflow', workflow, map: { <next input>: <output name> | '@run' }, inputs }`, `{ action:
  'product_owner' }`, `{ action: 'queue', workflow, inputs }`) and `from: { run_id, workflow }`, both in
  `workflow.started` and `summary.json`. A gate choice with `then:` (issue-tracker's `create_assign`:
  `{ action: queue, workflow: "{{ inputs.assign_workflow }}" }`) sets it when picked (`thenFromChoice`);
  the owner edits it with `setThen` (Run screen). Each change is a `run.then` event.
- The service acts on it (`packages/engine/service/areas/chain.js`), never the engine: on `workflow.finished`
  with `success` (and, when the workflow declares `merged_commit`, a non-empty one; simulated runs are
  exempt) it starts the next run (`nextInputs`: the then's values, the mapped outputs, the previous
  run's path/branch/language/platform inputs; the produced issues linked), plans the produced issues
  as a new last roadmap stage (the `queue` action, "Create and plan": the plain queue is retired,
  #446, and an older `chain.json` with that target plans the stage too; a simulated run plans
  simulated items; produced issues not open in the synced backlog are left out, and when none is
  left the chain ends done with "nothing planned"; a run without a project pauses with "no roadmap
  to plan in"), or asks the
  Product Owner and adds its plan as planned roadmap stages (`roadmaps.propose`, never started by
  itself). Anything else pauses the chain (`runs/<id>/chain.json`: `then`, `state` waiting | started |
  paused | dropped | done, `reason`, `nextRunId`) with a notification; channels `chain:get`,
  `chain:set`, `chain:resume`, `chain:drop`, `chain:estimate`. Chaining never answers a gate: the
  next run's gates wait for the owner. A simulated run only chains simulated runs.
