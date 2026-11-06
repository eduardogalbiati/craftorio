// Workflows screen and the visual builder: the workflow files (workspace copies over the bundled
// defaults) and the builder's load / save / clone.

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
const {
  requireId,
  requireObject,
} = require('../common');

// #485: a project's repository workflow (areas/repository-workflows.js); its channels take one
// object { projectId, file[, commit] } (params 'repo'), the way the Workflows screen calls them
const REPOSITORY_WORKFLOW = args({ projectId: PROJECT_ID, file: WORKFLOW_FILE }, ['projectId', 'file']);
const repositoryArg = (arg) => {
  const repo = requireObject(arg, 'repository workflow');
  return { projectId: requireId(repo.projectId, 'project id'), file: requireId(repo.file, 'workflow file') };
};

// builder:save's file: none saves a new workflow under a name from its spec
const optionalFile = (file) => (file == null || file === '' ? file : requireId(file, 'workflow file'));

const SAVED = shape({ file: WORKFLOW_FILE }, ['file']);

module.exports = (ctx) => [
  // projectId (#485): with the project's repository workflows (origin 'repository', commit, accepted);
  // repositoryOnly: those alone, with the manifest's categories (areas/workflows.js listWorkflows)
  { channel: 'workflows:list', method: 'listWorkflows', params: 'opts', schema: { params: orNone(args({ projectId: orNone(PROJECT_ID), repositoryOnly: FLAG })), result: listOf(OBJECT) }, fn: (opts) => ctx.listWorkflows(opts?.projectId ? { projectId: requireId(opts.projectId, 'project id'), repositoryOnly: !!opts.repositoryOnly } : {}) },
  // #485: the owner accepts a repository workflow for one commit (projects/<id>.json)
  { channel: 'workflows:accept', method: 'acceptWorkflow', params: 'repo', schema: { params: args({ projectId: PROJECT_ID, file: WORKFLOW_FILE, commit: STRING }, ['projectId', 'file', 'commit']), result: BOOL }, fn: (arg) => ctx.acceptWorkflow({ ...repositoryArg(arg), commit: requireId(arg.commit, 'commit') }) },
  { channel: 'workflows:pipelines', method: 'listPipelines', schema: { result: listOf(OBJECT) }, fn: () => ctx.listPipelines() },
  { channel: 'workflows:restore', method: 'restoreWorkflow', params: 'file', schema: { params: WORKFLOW_FILE, result: BOOL }, fn: (file) => ctx.restoreWorkflow(requireId(file, 'workflow file')) },
  // #488: Download, the YAML as it is on disk (a workspace or a repository workflow)
  { channel: 'workflows:export', method: 'exportWorkflow', params: 'file', schema: { params: WORKFLOW_FILE, result: STRING }, fn: (file) => ctx.exportWorkflow(requireId(file, 'workflow file')) },
  { channel: 'workflows:export-repository', method: 'exportRepositoryWorkflow', params: 'repo', schema: { params: REPOSITORY_WORKFLOW, result: STRING }, fn: (arg) => ctx.exportRepositoryWorkflow(repositoryArg(arg)) },
  // #488: Import, a text or an https url checked by the loader and `requires`; preview: the summary
  // only (the trust dialog) and the text's fingerprint, else written as custom under name (replace:
  // over an existing file; fingerprint: refused when the text is no longer the one previewed)
  { channel: 'workflows:import', method: 'importWorkflow', params: 'workflow', schema: { params: args({ text: orNone(STRING), url: orNone(STRING), name: orNone(STRING), replace: FLAG, preview: FLAG, fingerprint: orNone(STRING) }), result: OBJECT }, fn: (arg) => ctx.importWorkflow(requireObject(arg, 'workflow import')) },
  // #487: the Ways of working interview (areas/workflow-interview.js): the analysis seed's profile,
  // its evidence and the open questions, or { refused } (the Oracle's budget)
  { channel: 'workflows:interview', method: 'workflowInterview', params: 'opts', schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: OBJECT }, fn: (opts) => ctx.workflowInterview({ projectId: requireId(opts?.projectId, 'project id') }) },
  // #733: the last saved interview (the onboarding's or the drawer's), read without running it, or none
  { channel: 'workflows:interviewLast', method: 'workflowInterviewLast', params: 'opts', schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: orNone(OBJECT) }, fn: (opts) => ctx.workflowInterviewLast({ projectId: requireId(opts?.projectId, 'project id') }) },
  // #733: the running interview's state ({ running: { since, items, last } | null, error }), for the drawer's loader; #781: and its phases, for the wizard
  { channel: 'workflows:interviewState', method: 'workflowInterviewState', params: 'opts', schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: OBJECT }, fn: (opts) => ctx.workflowInterviewState({ projectId: requireId(opts?.projectId, 'project id') }) },
  // #487: the workflow set composed from the profile and the answers; write: into the project's
  // .multiagent/ (not committed) and its workflow set, else nothing is written
  { channel: 'workflows:compose', method: 'workflowCompose', params: 'opts', schema: { params: args({ projectId: PROJECT_ID, answers: orNone(OBJECT), write: FLAG }, ['projectId']), result: OBJECT }, fn: (opts) => ctx.workflowCompose({ projectId: requireId(opts?.projectId, 'project id'), answers: opts.answers || {}, write: !!opts.write }) },
  // → { file, mode, problems, spec }: the workflow as the builder edits it
  { channel: 'builder:load', method: 'loadBuilderWorkflow', params: 'file', schema: { params: WORKFLOW_FILE, result: shape({ file: STRING, mode: STRING, problems: listOf(ANY), spec: OBJECT }, ['spec']) }, fn: (file) => ctx.loadBuilderWorkflow(requireId(file, 'workflow file')) },
  // spec: the builder's workflow (packages/engine/domains/workflow/workflow-builder.js turns it into YAML and checks it); trust: the
  // owner confirmed the warning that a workflow not bundled with the app is code (#474)
  { channel: 'builder:save', method: 'saveBuilderWorkflow', params: ['file', 'spec', 'trust'], schema: { params: args({ file: orNone(WORKFLOW_FILE), spec: OBJECT, trust: orNone(BOOL) }, ['spec']), result: SAVED }, fn: (arg) => ctx.saveBuilderWorkflow({ ...arg, file: optionalFile(arg.file) }) },
  { channel: 'builder:clone', method: 'cloneWorkflow', params: 'file', schema: { params: WORKFLOW_FILE, result: SAVED }, fn: (file) => ctx.cloneBuilderWorkflow(requireId(file, 'workflow file')) },
  // #485: a repository workflow in the builder (read-only) and its copy in the workspace (custom)
  { channel: 'builder:load-repository', method: 'loadRepositoryBuilderWorkflow', params: 'repo', schema: { params: REPOSITORY_WORKFLOW, result: shape({ file: STRING, mode: STRING, problems: listOf(ANY), spec: OBJECT }, ['spec']) }, fn: (arg) => ctx.loadRepositoryBuilderWorkflow(repositoryArg(arg)) },
  { channel: 'builder:clone-repository', method: 'cloneRepositoryWorkflow', params: 'repo', schema: { params: REPOSITORY_WORKFLOW, result: SAVED }, fn: (arg) => ctx.cloneRepositoryWorkflow(repositoryArg(arg)) },
];
