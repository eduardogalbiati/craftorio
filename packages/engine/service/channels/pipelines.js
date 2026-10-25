// Saved pipelines (#135, packages/engine/service/areas/pipelines.js): start one like a workflow, its rough cost, a
// pipeline run's stages and runs, save a run's chain as a pipeline, and restore a bundled default.
// The list is workflows:pipelines (channels/workflows.js); Assign takes a pipeline in backlog:assign.

const { requireId } = require('../common');
const {
  args,
  BOOL,
  FLAG,
  nullable,
  OBJECT,
  orNone,
  PIPELINE_FILE,
  PROJECT_ID,
  RUN_ID,
  shape,
  STRING,
  text,
} = require('../schemas');

module.exports = (ctx) => [
  // inputs: the first stage's (over its fixed ones) → { runId, runDir, pipelineId }
  {
    channel: 'pipelines:run',
    method: 'runPipeline',
    params: ['file', 'inputs', 'mock', 'projectId'],
    schema: {
      params: args({ file: PIPELINE_FILE, inputs: nullable(OBJECT), mock: FLAG, projectId: orNone(PROJECT_ID) }, ['file']),
      result: shape({ runId: RUN_ID, runDir: STRING, pipelineId: RUN_ID }, ['runId']),
    },
    fn: (opts) => ctx.runPipeline({ ...opts, file: requireId(opts.file, 'pipeline file') }),
  },
  // → { items, costUsd, complete, text, productOwner } (an estimate from past runs)
  { channel: 'pipelines:estimate', method: 'pipelineEstimate', params: ['file'], schema: { params: args({ file: PIPELINE_FILE }, ['file']), result: OBJECT }, fn: (opts) => ctx.pipelineEstimate({ ...opts, file: requireId(opts.file, 'pipeline file') }) },
  // id: the pipeline run's (its first run's) → { id, file, name, stages, runs, current, state, reason }
  { channel: 'pipelines:get-run', method: 'pipelineRun', params: ['id'], schema: { params: args({ id: RUN_ID }, ['id']), result: OBJECT }, fn: (opts) => ctx.pipelineRun({ ...opts, id: requireId(opts.id, 'pipeline run id') }) },
  // the chain of run `runId` as a new pipeline file → { file, name }
  {
    channel: 'pipelines:save',
    method: 'savePipeline',
    params: ['runId', 'name', 'description', 'category'],
    schema: {
      params: args({ runId: RUN_ID, name: nullable(text(200)), description: nullable(STRING), category: nullable(STRING) }, ['runId']),
      result: shape({ file: STRING, name: STRING }, ['file']),
    },
    fn: (opts) => ctx.savePipeline(opts),
  },
  { channel: 'pipelines:restore', method: 'restorePipeline', params: 'file', schema: { params: PIPELINE_FILE, result: BOOL }, fn: (file) => ctx.restorePipeline(requireId(file, 'pipeline file')) },
];
