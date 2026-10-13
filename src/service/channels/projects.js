// Projects screen: the projects (a git folder or a cloned repository) and the runs of each.
// projects:inputHints: what the workflow input forms prefill (detected language, local branches).

const projects = require('../../projects');
const projectInputs = require('../../project-inputs');
const { requireId, requireObject } = require('../common');

// A project's folder, or null when the project is unknown.
const folderOf = (ctx, id) => { try { return projects.readProject(ctx.ws.projects, id).folder; } catch { return null; } };

module.exports = (ctx) => [
  { channel: 'projects:list', method: 'listProjects', fn: () => projects.listProjects(ctx.ws.projects) },
  { channel: 'projects:create', method: 'createProject', params: 'data', fn: (data) => projects.createProject(ctx.ws.projects, requireObject(data, 'project'), { reposDir: ctx.ws.repos }) },
  { channel: 'projects:update', method: 'updateProject', params: ['id', 'patch'], fn: ({ id, patch }) => projects.updateProject(ctx.ws.projects, requireId(id, 'project id'), patch) },
  { channel: 'projects:remove', method: 'removeProject', params: 'id', fn: (id) => projects.removeProject(ctx.ws.projects, requireId(id, 'project id')) },
  // the page options of runs:list (#200) as the second argument
  { channel: 'projects:runs', method: 'listProjectRuns', params: ['id', '...opts'], fn: (opts) => ctx.projectRuns({ ...opts, id: requireId(opts.id, 'project id') }) },
  { channel: 'projects:inputHints', method: 'projectInputHints', params: 'id', fn: (id) => projectInputs.inputHints(folderOf(ctx, id)) },
];
