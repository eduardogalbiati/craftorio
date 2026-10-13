// Saved pipelines (#135, src/service/areas/pipelines.js): start one like a workflow, its rough cost, a
// pipeline run's stages and runs, save a run's chain as a pipeline, and restore a bundled default.
// The list is workflows:pipelines (channels/workflows.js); Assign takes a pipeline in backlog:assign.

const { requireId } = require('../common');

module.exports = (ctx) => [
  // inputs: the first stage's (over its fixed ones) → { runId, runDir, pipelineId }
  { channel: 'pipelines:run', method: 'runPipeline', params: ['file', 'inputs', 'mock', 'projectId'], fn: (opts) => ctx.runPipeline({ ...opts, file: requireId(opts.file, 'pipeline file') }) },
  // → { items, costUsd, complete, text, productOwner } (an estimate from past runs)
  { channel: 'pipelines:estimate', method: 'pipelineEstimate', params: ['file'], fn: (opts) => ctx.pipelineEstimate({ ...opts, file: requireId(opts.file, 'pipeline file') }) },
  // id: the pipeline run's (its first run's) → { id, file, name, stages, runs, current, state, reason }
  { channel: 'pipelines:get-run', method: 'pipelineRun', params: ['id'], fn: (opts) => ctx.pipelineRun({ ...opts, id: requireId(opts.id, 'pipeline run id') }) },
  // the chain of run `runId` as a new pipeline file → { file, name }
  { channel: 'pipelines:save', method: 'savePipeline', params: ['runId', 'name', 'description', 'category'], fn: (opts) => ctx.savePipeline(opts) },
  { channel: 'pipelines:restore', method: 'restorePipeline', params: 'file', fn: (file) => ctx.restorePipeline(requireId(file, 'pipeline file')) },
];
