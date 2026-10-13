// Projects screen: the projects (a git folder or a cloned repository) and the runs of each.
// projects:inputHints: what the workflow input forms prefill (detected language, local branches).

const projects = require('../../projects');
const projectInputs = require('../../project-inputs');
const { requireId, requireObject } = require('../common');
const {
  ANY,
  args,
  BOOL,
  FLAG,
  listOf,
  nullable,
  NUMBER,
  OBJECT,
  PROJECT_ID,
  STRING,
  text,
} = require('../schemas');

// A project's folder, or null when the project is unknown.
const folderOf = (ctx, id) => { try { return projects.readProject(ctx.ws.projects, id).folder; } catch { return null; } };

// a project's fields ({ name, folder, repo, ... }), checked by src/projects.js
const PROJECT_DATA = OBJECT;

module.exports = (ctx) => [
  { channel: 'projects:list', method: 'listProjects', schema: { result: listOf(OBJECT) }, fn: () => projects.listProjects(ctx.ws.projects) },
  { channel: 'projects:create', method: 'createProject', params: 'data', schema: { params: PROJECT_DATA, result: OBJECT }, fn: (data) => projects.createProject(ctx.ws.projects, requireObject(data, 'project'), { reposDir: ctx.ws.repos }) },
  { channel: 'projects:update', method: 'updateProject', params: ['id', 'patch'], schema: { params: args({ id: PROJECT_ID, patch: PROJECT_DATA }, ['id']), result: OBJECT }, fn: ({ id, patch }) => projects.updateProject(ctx.ws.projects, requireId(id, 'project id'), patch) },
  { channel: 'projects:remove', method: 'removeProject', params: 'id', schema: { params: PROJECT_ID, result: BOOL }, fn: (id) => projects.removeProject(ctx.ws.projects, requireId(id, 'project id')) },
  // the page options of runs:list (#200) as the second argument
  {
    channel: 'projects:runs',
    method: 'listProjectRuns',
    params: ['id', '...opts'],
    schema: { params: args({ id: PROJECT_ID, offset: NUMBER, limit: NUMBER, filter: ANY, showSim: FLAG, q: nullable(text(1000)) }, ['id']), result: OBJECT },
    fn: (opts) => ctx.projectRuns({ ...opts, id: requireId(opts.id, 'project id') }),
  },
  { channel: 'projects:inputHints', method: 'projectInputHints', params: 'id', schema: { params: nullable(STRING), result: OBJECT }, fn: (id) => projectInputs.inputHints(folderOf(ctx, id)) },
];
