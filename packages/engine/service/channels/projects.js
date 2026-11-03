// Projects screen: the projects (a git folder or a cloned repository) and the runs of each.
// projects:inputHints: what the workflow input forms prefill (detected language, local branches).

const projects = require('../../domains/project/projects');
const projectInputs = require('../../domains/project/project-inputs');
const { runDefaultsOf } = require('../seed-runs');
const { withAliases } = require('../../domains/project/project-run-defaults');
const { clientError, requireId, requireObject } = require('../common');
const {
  ANY,
  args,
  BOOL,
  FLAG,
  listOf,
  nullable,
  NUMBER,
  OBJECT,
  oneOf,
  PROJECT_ID,
  STRING,
  text,
} = require('../schemas');

// A project, or null when the project is unknown.
const projectOf = (ctx, id) => { try { return id ? projects.readProject(ctx.ws.projects, id) : null; } catch { return null; } };

// a project's fields ({ name, folder, repo, workflows: [{ name, origin }], defaultWorkflow, ... }),
// checked by packages/engine/domains/project/projects.js
const PROJECT_DATA = OBJECT;

// #486: projects:manifest's one object, { url } (a remote repository) or { folder }
const manifestTarget = (arg) => {
  const target = requireObject(arg, 'manifest target');
  if (typeof target.url === 'string' && target.url.trim()) return { url: target.url.trim() };
  if (typeof target.folder === 'string' && target.folder.trim()) return { folder: target.folder.trim() };
  throw clientError('Invalid manifest target: expected { url } or { folder }.');
};

module.exports = (ctx) => [
  { channel: 'projects:list', method: 'listProjects', schema: { result: listOf(OBJECT) }, fn: () => projects.listProjects(ctx.ws.projects) },
  { channel: 'projects:create', method: 'createProject', params: 'data', schema: { params: PROJECT_DATA, result: OBJECT }, fn: (data) => projects.createProject(ctx.ws.projects, requireObject(data, 'project'), { reposDir: ctx.ws.repos }) },
  { channel: 'projects:update', method: 'updateProject', params: ['id', 'patch'], schema: { params: args({ id: PROJECT_ID, patch: PROJECT_DATA }, ['id']), result: OBJECT }, fn: ({ id, patch }) => projects.updateProject(ctx.ws.projects, requireId(id, 'project id'), patch) },
  // #742: a bare id (the record only) or { id, deleteFolder, confirmed, confirmName } (service/areas/project-remove.js)
  {
    channel: 'projects:remove',
    method: 'removeProject',
    params: 'id',
    schema: {
      // the id's own check (requireId) names it in its 400, as projects:update's does (#333)
      params: oneOf(text(200, 'The project id: the record only.'), args({ id: text(200, 'The project id.'), deleteFolder: FLAG, confirmed: FLAG, confirmName: text(200, 'The project\'s name, typed to delete a folder the app did not make.') }, ['id'])),
      result: oneOf(BOOL, OBJECT),
    },
    fn: (arg) => ctx.projectRemove(arg),
  },
  // the page options of runs:list (#200) as the second argument
  {
    channel: 'projects:runs',
    method: 'listProjectRuns',
    params: ['id', '...opts'],
    schema: { params: args({ id: PROJECT_ID, offset: NUMBER, limit: NUMBER, filter: ANY, showSim: FLAG, q: nullable(text(1000)) }, ['id']), result: OBJECT },
    fn: (opts) => ctx.projectRuns({ ...opts, id: requireId(opts.id, 'project id') }),
  },
  // #486: a repository's workflows manifest before Create Project clones it: its entries, or null
  { channel: 'projects:manifest', method: 'projectManifest', params: 'target', schema: { params: args({ url: STRING, folder: STRING }), result: nullable(OBJECT) }, fn: (target) => projects.projectManifest(manifestTarget(target)) },
  // #735: and the project's run defaults (`runDefaults`), what the run dialog prefills before the workflow's own
  {
    channel: 'projects:inputHints',
    method: 'projectInputHints',
    params: 'id',
    schema: { params: nullable(STRING), result: OBJECT },
    fn: async (id) => {
      const p = projectOf(ctx, id);
      const hints = await projectInputs.inputHints(p?.folder || null);
      return { ...hints, runDefaults: p ? withAliases(await runDefaultsOf(ctx, p)) : null };
    },
  },
];
