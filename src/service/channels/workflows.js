// Workflows screen and the visual builder: the workflow files (workspace copies over the bundled
// defaults) and the builder's load / save / clone.

const { requireId } = require('../common');
const {
  ANY,
  args,
  BOOL,
  listOf,
  OBJECT,
  orNone,
  shape,
  STRING,
  WORKFLOW_FILE,
} = require('../schemas');

// builder:save's file: none saves a new workflow under a name from its spec
const optionalFile = (file) => (file == null || file === '' ? file : requireId(file, 'workflow file'));

const SAVED = shape({ file: WORKFLOW_FILE }, ['file']);

module.exports = (ctx) => [
  { channel: 'workflows:list', method: 'listWorkflows', schema: { result: listOf(OBJECT) }, fn: () => ctx.listWorkflows() },
  { channel: 'workflows:pipelines', method: 'listPipelines', schema: { result: listOf(OBJECT) }, fn: () => ctx.listPipelines() },
  { channel: 'workflows:restore', method: 'restoreWorkflow', params: 'file', schema: { params: WORKFLOW_FILE, result: BOOL }, fn: (file) => ctx.restoreWorkflow(requireId(file, 'workflow file')) },
  // → { file, mode, problems, spec }: the workflow as the builder edits it
  { channel: 'builder:load', method: 'loadBuilderWorkflow', params: 'file', schema: { params: WORKFLOW_FILE, result: shape({ file: STRING, mode: STRING, problems: listOf(ANY), spec: OBJECT }, ['spec']) }, fn: (file) => ctx.loadBuilderWorkflow(requireId(file, 'workflow file')) },
  // spec: the builder's workflow (src/workflow-builder.js turns it into YAML and checks it)
  { channel: 'builder:save', method: 'saveBuilderWorkflow', params: ['file', 'spec'], schema: { params: args({ file: orNone(WORKFLOW_FILE), spec: OBJECT }, ['spec']), result: SAVED }, fn: (arg) => ctx.saveBuilderWorkflow({ ...arg, file: optionalFile(arg.file) }) },
  { channel: 'builder:clone', method: 'cloneWorkflow', params: 'file', schema: { params: WORKFLOW_FILE, result: SAVED }, fn: (file) => ctx.cloneBuilderWorkflow(requireId(file, 'workflow file')) },
];
