// Projects screen: the projects (a git folder or a cloned repository) and the runs of each.
// projects:inputHints: what the workflow input forms prefill (detected language, local branches).

const projects = require('../../projects');
const projectInputs = require('../../project-inputs');

// A project's folder, or null when the project is unknown.
const folderOf = (ctx, id) => { try { return projects.readProject(ctx.ws.projects, id).folder; } catch { return null; } };

module.exports = (ctx) => [
  { channel: 'projects:list', method: 'listProjects', fn: () => projects.listProjects(ctx.ws.projects) },
  { channel: 'projects:create', method: 'createProject', params: 'data', fn: (data) => projects.createProject(ctx.ws.projects, data, { reposDir: ctx.ws.repos }) },
  { channel: 'projects:update', method: 'updateProject', params: ['id', 'patch'], fn: ({ id, patch }) => projects.updateProject(ctx.ws.projects, id, patch) },
  { channel: 'projects:remove', method: 'removeProject', params: 'id', fn: (id) => projects.removeProject(ctx.ws.projects, id) },
  { channel: 'projects:runs', method: 'listProjectRuns', params: ['id'], fn: (opts) => ctx.projectRuns(opts) },
  { channel: 'projects:inputHints', method: 'projectInputHints', params: 'id', fn: (id) => projectInputs.inputHints(folderOf(ctx, id)) },
];
