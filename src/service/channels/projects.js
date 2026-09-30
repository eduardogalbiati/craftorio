// Projects screen: the projects (a git folder or a cloned repository) and the runs of each.

const projects = require('../../projects');

module.exports = (ctx) => [
  { channel: 'projects:list', method: 'listProjects', fn: () => projects.listProjects(ctx.ws.projects) },
  { channel: 'projects:create', method: 'createProject', params: 'data', fn: (data) => projects.createProject(ctx.ws.projects, data, { reposDir: ctx.ws.repos }) },
  { channel: 'projects:update', method: 'updateProject', params: ['id', 'patch'], fn: ({ id, patch }) => projects.updateProject(ctx.ws.projects, id, patch) },
  { channel: 'projects:remove', method: 'removeProject', params: 'id', fn: (id) => projects.removeProject(ctx.ws.projects, id) },
  { channel: 'projects:runs', method: 'listProjectRuns', params: ['id'], fn: (opts) => ctx.projectRuns(opts) },
];
