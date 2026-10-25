// The default development workflow (#195): the one used wherever a workflow is not picked by hand
// (the Product Owner's plans and its heuristic plan, Split + roadmap, Create + roadmap, the Assign
// dialog with nothing remembered). Settings › General › Backlog saves it in the workspace
// (settings.defaultWorkflow); unset, or naming a workflow that no longer exists, it falls back to the
// local workflow when the workspace has it (no push, no PR, no CI minutes), else the GitHub one.
// - resolve(setting, files): { file, missing } (missing: the saved file that no longer exists);
// - mergeOf(wf): how a workflow's work lands: 'local' (merged into the local base, no push),
//   'remote' (pushed: a branch and a PR/MR) or 'none' (no worktree, or it never merges);
// - current(): the renderer's default from state.settings and state.workflows (app.js globals);
//   #486: the header project's own defaultWorkflow (state.projects) wins over Settings';
// - firstBuild(set): a project's default without a given one (#486, packages/engine/domains/project/projects.js and the Overview);
// - projectFirst(list): the pickers' workflows with the header project's set first (#486).
// Browser: window.DefaultWorkflow; Node: module.exports (packages/engine/domains/po/product-owner.js).
(function (root) {
  const LOCAL = 'software-development-local-hero.yaml';
  const REMOTE = 'software-development.yaml';

  /** The default among `files` (workflow file names): the setting when it exists, else the fallback. */
  function resolve(setting, files = []) {
    const list = (files || []).map(String);
    const saved = setting ? String(setting) : '';
    if (saved && list.includes(saved)) return { file: saved, missing: null };
    const file = [LOCAL, REMOTE].find((f) => list.includes(f)) || list[0] || LOCAL;
    return { file, missing: saved || null };
  }

  /** How a loaded workflow (engine shape: orchestrator, steps with transitions) merges its work. */
  function mergeOf(wf) {
    const tree = wf?.orchestrator?.worktree;
    if (!tree) return 'none';
    if (tree.remote === false || (wf.steps || []).some((s) => (s.transitions || []).some((t) => t.merge === 'local'))) return 'local';
    return wf.metadata?.merges === false ? 'none' : 'remote';
  }

  // #486: the categories of a development workflow (the manifest's solo/team, the bundled ones' build)
  const BUILD = ['solo', 'team', 'build'];
  /** #486: a project's default without a given one: the first development workflow of its set ([{ name, category }]). */
  const firstBuild = (workflows) => (workflows || []).find((w) => BUILD.includes(w?.category))?.name || null;

  // #486: the header's project record (window.CurrentProject, state.projects), null in Node
  function headerProject(g) {
    const id = root.CurrentProject?.get?.();
    return id ? (g.projects || []).find((p) => p.id === id) || null : null;
  }

  // The renderer's default: the workflows listed by api.listWorkflows (state.workflows, no pipelines).
  // #486: the header project's defaultWorkflow first (project: false for Settings' own default).
  function current({ project = true } = {}) {
    const g = typeof state !== 'undefined' ? state : {};
    const list = (g.workflows || []).filter((w) => !w.error);
    const files = list.map((w) => w.file);
    const own = project && headerProject(g)?.defaultWorkflow ? `${label(headerProject(g).defaultWorkflow)}.yaml` : null;
    const out = own && files.includes(own) ? { file: own, missing: null } : resolve(g.settings?.defaultWorkflow, files);
    const wf = list.find((w) => w.file === out.file);
    return { ...out, name: wf?.name || out.file, merge: wf?.merge || null };
  }

  /** #486: `list` (workflows with a file) with the header project's set first, each part in its order. */
  function projectFirst(list) {
    const g = typeof state !== 'undefined' ? state : {};
    const set = new Set((headerProject(g)?.workflows || []).map((w) => label(w.name)));
    if (!set.size) return list;
    const own = (w) => set.has(label(w.file));
    return [...list.filter(own), ...list.filter((w) => !own(w))];
  }

  /** "software-development-local-hero" for a button's tooltip. */
  const label = (file) => String(file || '').replace(/\.ya?ml$/i, '');

  const api = {
    BUILD,
    LOCAL,
    REMOTE,
    current,
    firstBuild,
    label,
    mergeOf,
    projectFirst,
    resolve,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DefaultWorkflow = api;
})(typeof window !== 'undefined' ? window : globalThis);
