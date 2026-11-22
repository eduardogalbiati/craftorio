// The app's project (#254): one project for every screen, chosen in the header's selector
// (#header-project) and remembered. The Backlog, the Roadmap, Analytics and the Product Owner read
// it (window.CurrentProject.get()); choosing another opens the current screen again for it. The
// default is the last one chosen, else the last a run used (settings.lastProject), else the first
// with a repository. "New project…" opens the new-project wizard (#741: openProjectWizard, project-wizard.js).
// Uses app.js globals at call time (esc, state, showView).
// Browser: window.CurrentProject; Node: module.exports (pickDefault, for a test).
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('@craftorio/shared/i18n') : root.I18n)?.t(...a) ?? a[0];
  const KEY = 'multiagent.currentProject';
  const NEW = '__new__';

  /** The project to show: `lastId` when it still exists, else the first with a repository, else the first; null with no project. */
  function pickDefault(projects, lastId) {
    if (projects.some((p) => p.id === lastId)) return lastId;
    return (projects.find((p) => p.repo) || projects[0])?.id || null;
  }
  if (typeof module === 'object' && module.exports) { module.exports = { pickDefault }; return; }

  const select = () => document.querySelector('#header-project');
  let projects = [];
  let current = null;
  try { current = localStorage.getItem(KEY) || null; } catch { /* storage unavailable */ }

  function render() {
    const sel = select();
    sel.innerHTML = `${projects.length
      ? projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
      : `<option value="">${t('current_project.no_project')}</option>`}<option value="${NEW}">${t('current_project.new_project')}</option>`;
    sel.value = current || '';
  }

  // The projects changed (the app started, one was created or removed): the choice stays while it exists.
  function refresh(list = state.projects) {
    const before = current;
    const known = projects.length > 0;
    projects = list || [];
    current = pickDefault(projects, projects.some((p) => p.id === current) ? current : state.settings?.lastProject);
    render();
    // #794: the sidebar's count follows the project: the first list (the app's start, a screen
    // opened before it) and a choice moved by a project created or removed
    if (current !== before || !known) {
      window.refreshWorkflowsAcceptance?.();
      window.PullsView?.refreshCount?.(); // #812: the PRs entry's count follows the project too
    }
    return current;
  }

  // redraw: false when the caller opens a screen right after (a notification's click)
  function set(id, { redraw = true } = {}) {
    if (!id || id === current) return;
    current = id;
    try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ }
    render();
    window.refreshWorkflowsAcceptance?.(); // #794: the sidebar's count follows the project
    window.PullsView?.refreshCount?.(); // #812: the PRs entry's count too
    if (redraw) showView(state.view);
  }

  select().onchange = (e) => {
    if (e.target.value !== NEW) { set(e.target.value); return; }
    // the selector keeps the current project; the new one is chosen once it is created
    render();
    window.Actions.call('openProjectWizard'); // #741: creating a project is the wizard only
  };

  // #671 the header's project, also before the app's start has listed the projects (a screen opened
  // first, a seeded screenshot): the list read once, then the same choice as refresh()
  async function resolve() {
    if (current && projects.length) return current;
    try {
      const list = await api.listProjects();
      if (!state.projects?.length) state.projects = list;
      return refresh(list);
    } catch { return current; }
  }

  root.CurrentProject = { get: () => current, refresh, resolve, set };
})(typeof window !== 'undefined' ? window : globalThis);
