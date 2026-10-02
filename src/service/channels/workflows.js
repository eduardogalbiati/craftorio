// Workflows screen and the visual builder: the workflow files (workspace copies over the bundled
// defaults) and the builder's load / save / clone.

module.exports = (ctx) => [
  { channel: 'workflows:list', method: 'listWorkflows', fn: () => ctx.listWorkflows() },
  { channel: 'workflows:pipelines', method: 'listPipelines', fn: () => ctx.listPipelines() },
  { channel: 'workflows:restore', method: 'restoreWorkflow', params: 'file', fn: (file) => ctx.restoreWorkflow(file) },
  { channel: 'builder:load', method: 'loadBuilderWorkflow', params: 'file', fn: (file) => ctx.loadBuilderWorkflow(file) },
  { channel: 'builder:save', method: 'saveBuilderWorkflow', params: ['file', 'spec'], fn: (arg) => ctx.saveBuilderWorkflow(arg || {}) },
  { channel: 'builder:clone', method: 'cloneWorkflow', params: 'file', fn: (file) => ctx.cloneBuilderWorkflow(file) },
];
