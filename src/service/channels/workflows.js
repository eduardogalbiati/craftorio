// Workflows screen and the visual builder: the workflow files (workspace copies over the bundled
// defaults) and the builder's load / save / clone.

const { requireId } = require('../common');

// builder:save's file: none saves a new workflow under a name from its spec
const optionalFile = (file) => (file == null || file === '' ? file : requireId(file, 'workflow file'));

module.exports = (ctx) => [
  { channel: 'workflows:list', method: 'listWorkflows', fn: () => ctx.listWorkflows() },
  { channel: 'workflows:pipelines', method: 'listPipelines', fn: () => ctx.listPipelines() },
  { channel: 'workflows:restore', method: 'restoreWorkflow', params: 'file', fn: (file) => ctx.restoreWorkflow(requireId(file, 'workflow file')) },
  { channel: 'builder:load', method: 'loadBuilderWorkflow', params: 'file', fn: (file) => ctx.loadBuilderWorkflow(requireId(file, 'workflow file')) },
  { channel: 'builder:save', method: 'saveBuilderWorkflow', params: ['file', 'spec'], fn: (arg) => ctx.saveBuilderWorkflow({ ...arg, file: optionalFile(arg.file) }) },
  { channel: 'builder:clone', method: 'cloneWorkflow', params: 'file', fn: (file) => ctx.cloneBuilderWorkflow(requireId(file, 'workflow file')) },
];
