// Workflows screen and the visual builder: the workflow files (workspace copies over the bundled
// defaults) and the builder's load / save / clone.

const { requireId } = require('../common');
const {
  ANY,
  args,
  BOOL,
  FLAG,
  listOf,
  OBJECT,
  orNone,
  PROJECT_ID,
  shape,
  STRING,
  WORKFLOW_FILE,
} = require('../schemas');

// #485: a project's repository workflow (areas/repository-workflows.js); its channels take one
// object { projectId, file[, commit] } (params 'repo'), the way the Workflows screen calls them
const REPOSITORY_WORKFLOW = args({ projectId: PROJECT_ID, file: WORKFLOW_FILE }, ['projectId', 'file']);
const repositoryArg = (arg) => ({ projectId: requireId(arg.projectId, 'project id'), file: requireId(arg.file, 'workflow file') });

// builder:save's file: none saves a new workflow under a name from its spec
const optionalFile = (file) => (file == null || file === '' ? file : requireId(file, 'workflow file'));

const SAVED = shape({ file: WORKFLOW_FILE }, ['file']);

module.exports = (ctx) => [
  // projectId (#485): with the project's repository workflows (origin 'repository', commit, accepted);
  // repositoryOnly: those alone, with the manifest's categories (areas/workflows.js listWorkflows)
  { channel: 'workflows:list', method: 'listWorkflows', params: 'opts', schema: { params: orNone(args({ projectId: orNone(PROJECT_ID), repositoryOnly: FLAG })), result: listOf(OBJECT) }, fn: (opts) => ctx.listWorkflows(opts?.projectId ? { projectId: requireId(opts.projectId, 'project id'), repositoryOnly: !!opts.repositoryOnly } : {}) },
  // #485: the owner accepts a repository workflow for one commit (projects/<id>.json)
  { channel: 'workflows:accept', method: 'acceptWorkflow', params: 'repo', schema: { params: args({ projectId: PROJECT_ID, file: WORKFLOW_FILE, commit: STRING }, ['projectId', 'file', 'commit']), result: BOOL }, fn: (arg) => ctx.acceptWorkflow({ ...repositoryArg(arg), commit: String(arg.commit) }) },
  { channel: 'workflows:pipelines', method: 'listPipelines', schema: { result: listOf(OBJECT) }, fn: () => ctx.listPipelines() },
  { channel: 'workflows:restore', method: 'restoreWorkflow', params: 'file', schema: { params: WORKFLOW_FILE, result: BOOL }, fn: (file) => ctx.restoreWorkflow(requireId(file, 'workflow file')) },
  // → { file, mode, problems, spec }: the workflow as the builder edits it
  { channel: 'builder:load', method: 'loadBuilderWorkflow', params: 'file', schema: { params: WORKFLOW_FILE, result: shape({ file: STRING, mode: STRING, problems: listOf(ANY), spec: OBJECT }, ['spec']) }, fn: (file) => ctx.loadBuilderWorkflow(requireId(file, 'workflow file')) },
  // spec: the builder's workflow (src/workflow-builder.js turns it into YAML and checks it); trust: the
  // owner confirmed the warning that a workflow not bundled with the app is code (#474)
  { channel: 'builder:save', method: 'saveBuilderWorkflow', params: ['file', 'spec', 'trust'], schema: { params: args({ file: orNone(WORKFLOW_FILE), spec: OBJECT, trust: orNone(BOOL) }, ['spec']), result: SAVED }, fn: (arg) => ctx.saveBuilderWorkflow({ ...arg, file: optionalFile(arg.file) }) },
  { channel: 'builder:clone', method: 'cloneWorkflow', params: 'file', schema: { params: WORKFLOW_FILE, result: SAVED }, fn: (file) => ctx.cloneBuilderWorkflow(requireId(file, 'workflow file')) },
  // #485: a repository workflow in the builder (read-only) and its copy in the workspace (custom)
  { channel: 'builder:load-repository', method: 'loadRepositoryBuilderWorkflow', params: 'repo', schema: { params: REPOSITORY_WORKFLOW, result: shape({ file: STRING, mode: STRING, problems: listOf(ANY), spec: OBJECT }, ['spec']) }, fn: (arg) => ctx.loadRepositoryBuilderWorkflow(repositoryArg(arg)) },
  { channel: 'builder:clone-repository', method: 'cloneRepositoryWorkflow', params: 'repo', schema: { params: REPOSITORY_WORKFLOW, result: SAVED }, fn: (arg) => ctx.cloneRepositoryWorkflow(repositoryArg(arg)) },
];
