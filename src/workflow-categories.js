// The categories a workflow or a pipeline files itself under (metadata.category, #137), one list for
// the modules that check them: src/pipelines.js, src/workflow-builder.js and a repository's manifest
// (src/project-manifest.js, #485, which adds its four flows next to them). The renderer names them
// in app.js (CATEGORIES).

const WORKFLOW_CATEGORIES = ['build', 'monitor', 'plan'];

module.exports = {
  WORKFLOW_CATEGORIES,
};
