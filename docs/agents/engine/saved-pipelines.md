# Saved pipelines (#135)

Saved pipelines (`<workspace>/pipelines/*.yaml`): their shape, how they are checked, and how they run as a chain.

- `packages/engine/domains/workflow/pipelines.js`: `<workspace>/pipelines/*.yaml` (bundled `pipelines/`, seeded and restorable like
  the workflows). `parsePipeline` checks the shape (≥ 2 stages, the first a workflow, a `product_owner` /
  `queue` target only last, `on: success` only); `validatePipeline` checks each stage against its
  workflows: fixed `inputs` and `map` keys are inputs of the stage's workflow, `map` values are outputs
  the previous workflow declares (or `'@run'`), a target follows a workflow with an `issues`/`issue`
  output. No `map` → chain-model `defaultMap`. The error names the pipeline, the stage, the workflow and
  the missing name; `listPipelines` returns it per file.
- It runs as a phase-1 chain (no engine change but `from.pipeline`): `pipelineThen(p)` is the first run's
  `then`, stage 2 with the rest nested in `then.then`, each with `pipeline: { id, file, name, stage,
  stages }`. `startNext` (areas/chain.js) hands the nested `then` to the run it starts and records
  `from.pipeline` there, stamping the pipeline run's id (the first run's id) on the rest
  (`withPipelineId`). `chain-model pipelineOf(chain, runId)` says which pipeline and stage a run is.
  Pauses, Resume / Edit / Drop are the chain's; an Edit that keeps the next workflow keeps the stages
  after it.
- Service `packages/engine/service/areas/pipelines.js`, channels `workflows:pipelines` (list), `pipelines:run`,
  `pipelines:estimate`, `pipelines:get-run` (a pipeline run's stages and runs), `pipelines:save` (a run's
  chain → `fromChain` → a new file, never over an existing one), `pipelines:restore`; `backlog:assign`
  takes `pipeline` (its first workflow, fixed inputs and chain for each queued issue).
