// The categories a workflow or a pipeline files itself under (metadata.category, #137), one list for
// the modules that check them: packages/engine/domains/workflow/pipelines.js, packages/engine/domains/workflow/workflow-builder.js and a repository's manifest
// (packages/engine/domains/project/project-manifest.js, #485, which adds its four flows next to them). The renderer names them
// in app.js (CATEGORIES).
// Browser (the Builder on a static page, #488): window.WorkflowCategories; Node: module.exports.

(function (root) {
  const WORKFLOW_CATEGORIES = ['build', 'monitor', 'plan'];

  const api = {
    WORKFLOW_CATEGORIES,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkflowCategories = api;
})(typeof window !== 'undefined' ? window : globalThis);
